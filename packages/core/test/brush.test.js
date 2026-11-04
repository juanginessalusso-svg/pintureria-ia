import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintStroke, maskCount } from '../src/index.js';

const W = 100, H = 80;
const blank = () => new Uint8Array(W * H);

test('un toque pinta un disco del radio pedido (≈ πr²)', () => {
  const m = paintStroke(blank(), W, H, [{ x: 50, y: 40 }], 10, 1);
  const n = maskCount(m);
  assert.ok(Math.abs(n - Math.PI * 100) < 25, `área ${n}`);
  assert.equal(m[40 * W + 50], 1);
  assert.equal(m[40 * W + 62], 0); // fuera del radio
});

test('un trazo rápido (puntos muy separados) no deja huecos', () => {
  const m = paintStroke(blank(), W, H, [{ x: 10, y: 40 }, { x: 90, y: 40 }], 4, 1);
  for (let x = 10; x <= 90; x++) assert.equal(m[40 * W + x], 1, `hueco en x=${x}`);
  assert.equal(m[30 * W + 50], 0); // y no se sale del grosor
});

test('el borrador (value 0) quita lo pintado y no toca el resto', () => {
  const m = blank().fill(1);
  paintStroke(m, W, H, [{ x: 50, y: 40 }], 6, 0);
  assert.equal(m[40 * W + 50], 0);
  assert.equal(m[10 * W + 10], 1);
  assert.ok(maskCount(m) < W * H && maskCount(m) > W * H - 150);
});

test('se recorta en los bordes sin salirse de la máscara', () => {
  const m = paintStroke(blank(), W, H, [{ x: 0, y: 0 }, { x: -20, y: -20 }, { x: W + 30, y: H + 30 }], 8, 1);
  assert.equal(m.length, W * H);
  assert.ok(maskCount(m) > 0);
  assert.equal(m[0], 1);
  assert.equal(m[(H - 1) * W + (W - 1)], 1);
});

test('sin puntos devuelve la máscara intacta; solo escribe 0 o 1', () => {
  const m = blank();
  assert.equal(paintStroke(m, W, H, [], 5, 1), m);
  assert.equal(maskCount(m), 0);
  paintStroke(m, W, H, [{ x: 20, y: 20 }, { x: 40, y: 30 }], 5, 1);
  assert.ok(m.every((v) => v === 0 || v === 1));
});
