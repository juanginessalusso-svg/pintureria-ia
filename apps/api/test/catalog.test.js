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

test('?tenant= tiene prioridad sobre el dominio solo si allowTenantParam; si no, se ignora', async () => {
  // El Host del test (127.0.0.1) no está mapeado: sin param -> 404 en ambos modos.
  db.prepare("INSERT INTO tenant_domains (domain, tenant_id) VALUES ('127.0.0.1', (SELECT id FROM tenants WHERE slug='b'))").run();
  try {
    // staging (param permitido): ?tenant=a pisa al dominio (que apunta a b)
    assert.equal((await (await fetch(`${base}/api/public/tenant?tenant=a`)).json()).name, 'Pinturería A');
    assert.equal((await (await fetch(`${base}/api/public/tenant`)).json()).name, 'Pinturería B'); // sin param -> dominio
    // producción (param NO permitido): ?tenant=a se ignora, manda el dominio
    const prod = createApp({ db, allowTenantParam: false }).listen(0);
    const r = await (await fetch(`http://127.0.0.1:${prod.address().port}/api/public/tenant?tenant=a`)).json();
    prod.close();
    assert.equal(r.name, 'Pinturería B');
  } finally {
    db.prepare("DELETE FROM tenant_domains WHERE domain = '127.0.0.1'").run();
  }
});

const CSV_OK = ['sku;nombre;rendimiento;manos;litros;precio', 'IMP-1;Importado uno;10,5;2;4;$ 48.000', 'IMP-1;;;;10;$ 110.000', 'IMP-2;Importado dos;8;;1;19.000,50'].join('\r\n');

test('importar CSV: vista previa no escribe; aplicar crea; reimportar actualiza (y marca el embedding viejo)', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  const antes = (await c.call('GET', '/api/admin/products')).body.length;

  const prev = await c.call('POST', '/api/admin/products/import', { csv: CSV_OK, dryRun: true });
  assert.equal(prev.status, 200);
  assert.deepEqual([prev.body.summary.create, prev.body.summary.update, prev.body.summary.sizes, prev.body.applied], [2, 0, 3, false]);
  assert.equal((await c.call('GET', '/api/admin/products')).body.length, antes); // no escribió

  const ok = await c.call('POST', '/api/admin/products/import', { csv: CSV_OK });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.applied, true);
  const list = (await c.call('GET', '/api/admin/products')).body;
  assert.equal(list.length, antes + 2);
  const uno = list.find((p) => p.sku === 'IMP-1');
  assert.equal(uno.yield_m2_per_l, 10.5);
  assert.deepEqual(uno.sizes, [{ liters: 4, price_cents: 4800000 }, { liters: 10, price_cents: 11000000 }]);

  db.prepare('UPDATE products SET embedding_stale = 0 WHERE id = ?').run(uno.id);
  const again = await c.call('POST', '/api/admin/products/import', { csv: CSV_OK.replace('48.000', '50.000') });
  assert.deepEqual([again.body.summary.create, again.body.summary.update], [0, 2]);
  const uno2 = (await c.call('GET', '/api/admin/products')).body.find((p) => p.sku === 'IMP-1');
  assert.equal(uno2.sizes[0].price_cents, 5000000);
  assert.equal(db.prepare('SELECT embedding_stale FROM products WHERE id = ?').get(uno.id).embedding_stale, 1);
});

test('importar CSV: todo o nada ante un error, con la línea del problema', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  const antes = (await c.call('GET', '/api/admin/products')).body.length;
  const bad = ['sku;nombre;rendimiento;litros;precio', 'OK-1;Bueno;10;4;100', 'MAL-1;Malo;abc;4;100'].join('\n');
  const r = await c.call('POST', '/api/admin/products/import', { csv: bad });
  assert.equal(r.status, 400);
  assert.equal(r.body.applied, false);
  assert.deepEqual(r.body.errors.map((e) => e.line), [3]);
  assert.equal((await c.call('GET', '/api/admin/products')).body.length, antes); // OK-1 tampoco entró
});

test('importar CSV: reemplazo borra solo lo de MI pinturería; la otra no se toca; exige sesión y CSRF', async () => {
  const a = client(), b = client();
  await a.login('a', 'clave-de-prueba-A1');
  await b.login('b', 'clave-de-prueba-B1');
  await b.call('POST', '/api/admin/products/import', { csv: CSV_OK });
  const bAntes = (await b.call('GET', '/api/admin/products')).body.length;

  const prev = await a.call('POST', '/api/admin/products/import', { csv: CSV_OK, mode: 'replace', dryRun: true });
  assert.ok(prev.body.summary.remove > 0); // borraría los demás productos de A
  assert.ok(prev.body.summary.removeNames.length > 0);
  const rep = await a.call('POST', '/api/admin/products/import', { csv: CSV_OK, mode: 'replace' });
  assert.equal(rep.status, 200);
  assert.deepEqual((await a.call('GET', '/api/admin/products')).body.map((p) => p.sku).sort(), ['IMP-1', 'IMP-2']);
  assert.equal((await b.call('GET', '/api/admin/products')).body.length, bAntes); // B intacta

  assert.equal((await client().call('POST', '/api/admin/products/import', { csv: CSV_OK })).status, 401);
  a.noCsrf();
  assert.equal((await a.call('POST', '/api/admin/products/import', { csv: CSV_OK })).status, 403);
});

test('importar CSV: un catálogo grande (más de 100 KB) entra; el límite general sigue en 100 KB', async () => {
  const c = client();
  await c.login('b', 'clave-de-prueba-B1');
  const filas = ['sku;nombre;rendimiento;ficha_tecnica;litros;precio'];
  for (let i = 0; i < 400; i++) filas.push(`BIG-${i};Producto grande ${i};10;"${'x'.repeat(300)}";4;1000`);
  const csv = filas.join('\n');
  assert.ok(csv.length > 120_000);
  const r = await c.call('POST', '/api/admin/products/import', { csv });
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.create, 400);
  // el resto de la API sigue con el límite de 100 KB
  const grande = await c.call('POST', '/api/admin/products', { sku: 'X', name: 'X', yield_m2_per_l: 10, tech_sheet: 'y'.repeat(150_000) });
  assert.equal(grande.status, 413);
});

test('sucursales: CRUD, normaliza el WhatsApp, valida y es público solo lo activo', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  const rc = await c.call('POST', '/api/admin/branches', { name: 'Río Cuarto', address: 'Av. Ejemplo 123', whatsapp: '+54 358 490-7406' });
  assert.equal(rc.status, 201);
  assert.equal(rc.body.whatsapp, '543584907406'); // solo dígitos
  const ch = await c.call('POST', '/api/admin/branches', { name: 'Chivilcoy', whatsapp: '5492346362231', position: 1 });
  assert.equal(ch.status, 201);
  const off = await c.call('POST', '/api/admin/branches', { name: 'Cerrada', active: false });
  assert.equal(off.status, 201);
  assert.equal((await c.call('POST', '/api/admin/branches', { name: 'Mala', whatsapp: '123' })).status, 400);
  assert.equal((await c.call('POST', '/api/admin/branches', { name: 'Río Cuarto' })).status, 409);

  const pub = await (await fetch(`${base}/api/public/branches?tenant=a`)).json();
  assert.deepEqual(pub.map((b) => b.name), ['Río Cuarto', 'Chivilcoy']); // sin la inactiva, ordenadas por posición
  assert.equal(pub[0].active, undefined);

  const upd = await c.call('PUT', `/api/admin/branches/${ch.body.id}`, { name: 'Chivilcoy', whatsapp: '', position: 1 });
  assert.equal(upd.body.whatsapp, ''); // vacío = usa el de la pinturería
  assert.equal((await c.call('DELETE', `/api/admin/branches/${off.body.id}`)).status, 204);
});

test('AISLAMIENTO sucursales: otra pinturería no las ve ni las toca', async () => {
  const a = client(), b = client();
  await a.login('a', 'clave-de-prueba-A1');
  await b.login('b', 'clave-de-prueba-B1');
  const mine = (await a.call('GET', '/api/admin/branches')).body[0];
  assert.ok(mine);
  assert.equal((await b.call('GET', '/api/admin/branches')).body.length, 0);
  assert.equal((await b.call('PUT', `/api/admin/branches/${mine.id}`, { name: 'Hack' })).status, 404);
  assert.equal((await b.call('DELETE', `/api/admin/branches/${mine.id}`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/public/branches?tenant=b`)).json()).length, 0);
});

test('público: colores inactivos no aparecen', async () => {
  const c = client();
  await c.login('a', 'clave-de-prueba-A1');
  const created = await c.call('POST', '/api/admin/colors', { code: 'OFF-1', name: 'Oculto', hex: '#123456', active: false });
  const list = await (await fetch(`${base}/api/public/colors?tenant=a`)).json();
  assert.ok(!list.some((x) => x.code === 'OFF-1'));
  await c.call('DELETE', `/api/admin/colors/${created.body.id}`);
});
