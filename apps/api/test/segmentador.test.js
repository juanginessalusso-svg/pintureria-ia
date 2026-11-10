import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { createTenant } from '../src/tenants.js';
import { crearLimitador, segmentarEnRunpod } from '../src/segmentador.js';

const FOTO = Buffer.alloc(500, 7); // bytes de mentira: el intermediario no decodifica la foto
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
let server, base, llamadas = [];

before(() => {
  const db = openDb(':memory:');
  createTenant(db, { slug: 'a', name: 'Pinturería A', domains: ['a.test'], username: 'admin', password: 'clave-de-prueba-A1' });
  const segmentarFn = async (foto, opts) => { llamadas.push({ n: foto.length, opts }); return { png: PNG, segundos: 1.5 }; };
  server = createApp({ db, allowTenantParam: true, segmentarFn }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); delete process.env.RUNPOD_API_KEY; delete process.env.RUNPOD_ENDPOINT_ID; });

const post = (body, type = 'image/jpeg') => fetch(`${base}/api/public/segmentar?tenant=a`, { method: 'POST', headers: { 'content-type': type }, body });

test('sin claves de RunPod responde 503 (la app sigue con el modelo del celular)', async () => {
  const r = await post(FOTO);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'segmentador_no_configurado');
});

test('con claves reenvía la foto y devuelve el PNG; la clave no viaja al cliente', async () => {
  process.env.RUNPOD_API_KEY = 'clave-falsa'; process.env.RUNPOD_ENDPOINT_ID = 'ep1';
  const r = await post(FOTO);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(r.headers.get('x-segundos'), '1.5');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG);
  assert.equal(llamadas.at(-1).n, FOTO.length);
  assert.equal(llamadas.at(-1).opts.endpointId, 'ep1');
});

test('sin foto o con otro tipo de contenido: 400', async () => {
  process.env.RUNPOD_API_KEY = 'clave-falsa'; process.env.RUNPOD_ENDPOINT_ID = 'ep1';
  assert.equal((await post(Buffer.alloc(10))).status, 400);
  assert.equal((await post('{"a":1}', 'application/json')).status, 400);
});

test('crearLimitador corta después de max pedidos en la ventana y se libera después', () => {
  let t = 0; const l = crearLimitador({ max: 2, ventanaMs: 1000, ahora: () => t });
  assert.ok(l.permitir('ip')); assert.ok(l.permitir('ip')); assert.ok(!l.permitir('ip'));
  assert.ok(l.permitir('otra'));
  t = 1500; assert.ok(l.permitir('ip'));
});

test('segmentarEnRunpod: runsync que queda en cola se consulta por /status hasta COMPLETED', async () => {
  const urls = [];
  const resp = (x) => ({ ok: true, json: async () => x });
  const fetchFn = async (url, init) => {
    urls.push(url);
    if (url.endsWith('/runsync')) { assert.equal(init.headers.Authorization, 'Bearer k'); return resp({ id: 'j1', status: 'IN_QUEUE' }); }
    return urls.length < 3 ? resp({ id: 'j1', status: 'IN_PROGRESS' }) : resp({ id: 'j1', status: 'COMPLETED', output: { png: PNG.toString('base64'), ancho: 4, alto: 3, segundos: 2 } });
  };
  const out = await segmentarEnRunpod(FOTO, { apiKey: 'k', endpointId: 'ep', fetchFn, dormir: async () => {} });
  assert.deepEqual(out.png, PNG);
  assert.equal(out.ancho, 4);
  assert.equal(urls[0], 'https://api.runpod.ai/v2/ep/runsync');
  assert.equal(urls[1], 'https://api.runpod.ai/v2/ep/status/j1');
});

test('segmentarEnRunpod: un error del worker se propaga', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ id: 'j', status: 'COMPLETED', output: { error: 'foto_invalida' } }) });
  await assert.rejects(segmentarEnRunpod(FOTO, { apiKey: 'k', endpointId: 'ep', fetchFn }), /foto_invalida/);
});

test('diagnóstico (solo staging): pasa los textos al segmentador y devuelve sus mapas', async () => {
  process.env.RUNPOD_API_KEY = 'clave-falsa'; process.env.RUNPOD_ENDPOINT_ID = 'ep1';
  const r = await fetch(`${base}/api/public/segmentar/diag?tenant=a&textos=brick%20wall,sky`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: FOTO });
  assert.equal(r.status, 200);
  assert.deepEqual(llamadas.at(-1).opts.textos, ['brick wall', 'sky']);
});

test('diagnóstico: no existe si la API no está en modo staging', async () => {
  const db = openDb(':memory:');
  createTenant(db, { slug: 'a', name: 'A', domains: ['a.test'], username: 'admin', password: 'clave-de-prueba-A1' });
  const s = createApp({ db, segmentarFn: async () => ({}) }).listen(0);
  const r = await fetch(`http://127.0.0.1:${s.address().port}/api/public/segmentar/diag?textos=x`, { method: 'POST', headers: { 'content-type': 'image/jpeg', host: 'a.test' }, body: FOTO });
  assert.equal(r.status, 404);
  s.close();
});
