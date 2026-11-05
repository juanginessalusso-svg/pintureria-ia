import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, crossOriginIsolationMode } from '../src/app.js';

test('crossOriginIsolationMode interpreta la variable de entorno', () => {
  assert.equal(crossOriginIsolationMode(undefined), false);
  assert.equal(crossOriginIsolationMode('0'), false);
  assert.equal(crossOriginIsolationMode('1'), 'require-corp');
  assert.equal(crossOriginIsolationMode('credentialless'), 'credentialless');
});

test('sin CROSS_ORIGIN_ISOLATION no se mandan COOP/COEP (por defecto)', async () => {
  const server = createApp().listen(0);
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(res.headers.get('cross-origin-opener-policy'), null);
  assert.equal(res.headers.get('cross-origin-embedder-policy'), null);
  server.close();
});

test('con aislamiento activado se mandan COOP y COEP', async () => {
  for (const [modo, esperado] of [['require-corp', 'require-corp'], ['credentialless', 'credentialless']]) {
    const server = createApp({ crossOriginIsolation: modo }).listen(0);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('cross-origin-embedder-policy'), esperado);
    server.close();
  }
});
