import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { createTenant, seedDemo } from '../src/tenants.js';

let server, base, db;

before(() => {
  db = openDb(':memory:');
  const a = createTenant(db, { slug: 'a', name: 'Pinturería A', domains: ['a.test'], username: 'admin', password: 'clave-de-prueba-A1' });
  createTenant(db, { slug: 'b', name: 'Pinturería B', domains: ['b.test'], username: 'admin', password: 'clave-de-prueba-B1' });
  seedDemo(db, a);
  server = createApp({ db, allowTenantParam: true }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** Mini cliente con cookie de sesión y CSRF. */
function client() {
  let cookie = '', csrf = '';
  const call = async (method, path, body, extra = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...(csrf && method !== 'GET' && { 'x-csrf-token': csrf }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
    call,
    async login(tenant, password) {
      const r = await call('POST', '/api/admin/login', { tenant, username: 'admin', password });
      if (r.status === 200) csrf = r.body.csrf;
      return r;
    },
    noCsrf() { csrf = ''; },
  };
}

test('login correcto e incorrecto', async () => {
  const c = client();
  assert.equal((await c.login('a', 'mala')).status, 401);
  assert.equal((await c.login('a', 'clave-de-prueba-A1')).status, 200);
  assert.equal((await c.call('GET', '/api/admin/me')).body.tenant.slug, 'a');
});

test('sin sesión no se accede al admin', async () => {
  assert.equal((await client().call('GET', '/api/admin/colors')).status, 401);
});

test('escrituras sin token CSRF se rechazan', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  c.noCsrf();
  const r = await c.call('POST', '/api/admin/colors', { code: 'X', name: 'X', hex: '#fff' });
  assert.equal(r.status, 403);
});

test('límite de intentos de login (5 fallos -> 429)', async () => {
  const c = client();
  let last;
  for (let i = 0; i < 6; i++) last = await c.call('POST', '/api/admin/login', { tenant: 'b', username: 'intruso', password: 'x' });
  assert.equal(last.status, 429);
});

test('color: calcula LAB en el servidor y valida el hex', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  const ok = await c.call('POST', '/api/admin/colors', { code: 'R-1', name: 'Rojo puro', hex: '#FF0000' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.hex, '#ff0000');
  assert.ok(Math.abs(ok.body.lab_l - 53.24) < 0.1);
  assert.equal((await c.call('POST', '/api/admin/colors', { code: 'R-2', name: 'Mal', hex: 'nope' })).status, 400);
  assert.equal((await c.call('POST', '/api/admin/colors', { code: 'R-1', name: 'Repetido', hex: '#000' })).status, 409);
});

test('producto: CRUD con presentaciones y embedding_stale al editar', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  const created = await c.call('POST', '/api/admin/products', {
    sku: 'T-1', name: 'Producto test', yield_m2_per_l: 10, sizes: [{ liters: 4, price_cents: 100000 }, { liters: 10, price_cents: 200000 }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.sizes.length, 2);
  const id = created.body.id;
  db.prepare('UPDATE products SET embedding_stale = 0 WHERE id = ?').run(id);
  const upd = await c.call('PUT', `/api/admin/products/${id}`, { sku: 'T-1', name: 'Editado', yield_m2_per_l: 12, sizes: [{ liters: 20, price_cents: 5 }] });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.body.sizes, [{ liters: 20, price_cents: 5 }]);
  assert.equal(db.prepare('SELECT embedding_stale FROM products WHERE id = ?').get(id).embedding_stale, 1);
  assert.equal((await c.call('DELETE', `/api/admin/products/${id}`)).status, 204);
});

test('AISLAMIENTO: una pinturería no ve ni toca los datos de otra', async () => {
  const a = client(), b = client();
  await a.login('a', 'clave-de-prueba-A1');
  await b.login('b', 'clave-de-prueba-B1');
  const colorsA = (await a.call('GET', '/api/admin/colors')).body;
  assert.ok(colorsA.length > 0);
  assert.equal((await b.call('GET', '/api/admin/colors')).body.length, 0);
  assert.equal((await b.call('PUT', `/api/admin/colors/${colorsA[0].id}`, { code: 'H', name: 'Hack', hex: '#000000' })).status, 404);
  assert.equal((await b.call('DELETE', `/api/admin/colors/${colorsA[0].id}`)).status, 404);
  const prodA = (await a.call('GET', '/api/admin/products')).body[0];
  assert.equal((await b.call('DELETE', `/api/admin/products/${prodA.id}`)).status, 404);
  assert.equal((await b.call('GET', '/api/admin/products')).body.length, 0);
});

test('público: tenant por dominio (Host) y por ?tenant; no filtra datos internos', async () => {
  const noTenant = await fetch(`${base}/api/public/colors`);
  assert.equal(noTenant.status, 404);
  const viaParam = await (await fetch(`${base}/api/public/colors?tenant=a`)).json();
  assert.ok(viaParam.length > 0 && viaParam[0].lab.L !== undefined);
  assert.equal((await (await fetch(`${base}/api/public/colors?tenant=b`)).json()).length, 0);
  const prods = await (await fetch(`${base}/api/public/products?tenant=a`)).json();
  assert.ok(prods.length > 0);
  assert.equal(prods[0].tech_sheet, undefined);
  assert.equal(prods[0].embedding_stale, undefined);
});

test('público: colores inactivos no aparecen', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  const created = await c.call('POST', '/api/admin/colors', { code: 'OFF-1', name: 'Oculto', hex: '#123456', active: false });
  const list = await (await fetch(`${base}/api/public/colors?tenant=a`)).json();
  assert.ok(!list.some((x) => x.code === 'OFF-1'));
  await c.call('DELETE', `/api/admin/colors/${created.body.id}`);
});
