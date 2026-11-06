import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classMapFromLogits, rgbaToNchw, runSegmenter } from '../src/seg.js';

test('classMapFromLogits: argmax por píxel, agrandado al tamaño de trabajo', () => {
  // 2 clases... 4 clases en una grilla 2x2: arriba clase 2 (techo), abajo-izq 1 (pared), abajo-der 0
  const K = 4, lh = 2, lw = 2, L = new Float32Array(K * lh * lw).fill(-5);
  const set = (k, y, x) => { L[k * lh * lw + y * lw + x] = 5; };
  set(2, 0, 0); set(2, 0, 1); set(1, 1, 0); set(0, 1, 1);
  const m = classMapFromLogits(L, [1, K, lh, lw], 8, 8);
  assert.equal(m.length, 64);
  assert.equal(m[0], 2); assert.equal(m[7], 2); assert.equal(m[7 * 8 + 0], 1); assert.equal(m[7 * 8 + 7], 0);
});

test('rgbaToNchw: planos R, G, B en 0..1', () => {
  const t = rgbaToNchw(Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 2);
  assert.equal(t.length, 12);
  assert.equal(t[0], 1); assert.equal(t[4], 0); assert.equal(t[5], 1); assert.equal(t[11], 1);
});

test('runSegmenter: arma el tensor y devuelve el mapa de clases', async () => {
  const ort = { Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } } };
  let visto = null;
  const session = { run: async ({ rgb }) => { visto = rgb; const d = new Float32Array(4); d[2] = 3; return { logits: { data: new Float32Array(4 * 1 * 1).map((_, i) => (i === 2 ? 3 : 0)), dims: [1, 4, 1, 1] } }; } };
  const m = await runSegmenter(ort, session, new Uint8ClampedArray(4 * 4).fill(128), 2, 4, 4);
  assert.deepEqual(visto.dims, [1, 3, 2, 2]);
  assert.equal(m.length, 16); assert.ok(m.every((v) => v === 2));
});
