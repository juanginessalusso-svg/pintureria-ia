import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('GET /api/health responde ok', async () => {
  const server = createApp().listen(0);
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  server.close();
});
