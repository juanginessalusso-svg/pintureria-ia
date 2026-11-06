import test from 'node:test';
import assert from 'node:assert/strict';
import { straightenPair, fitLine } from '../src/rectas.js';

const W = 200, H = 120;

test('straightenPair: una frontera rasgada entre techo y pared pasa a ser recta', () => {
  const A = new Uint8Array(W * H), B = new Uint8Array(W * H); // A = techo (arriba), B = pared (abajo)
  for (let x = 0; x < W; x++) {
    const y0 = 50 + Math.round(((x * 7) % 5) - 2); // frontera a y≈50 con dientes de ±2 px
    for (let y = 0; y < H; y++) (y < y0 ? A : B)[y * W + x] = 1;
  }
  const r = straightenPair(A, B, W, H, { minLen: 0.3 });
  assert.ok(r && r.moved > 0, 'ajustó una recta');
  for (let x = 5; x < W - 5; x++) { // cada columna: una sola transición A→B
    let t = 0; for (let y = 1; y < H; y++) if (A[(y - 1) * W + x] && B[y * W + x]) t++;
    assert.equal(t, 1);
    let yb = 0; while (A[yb * W + x]) yb++;
    assert.ok(Math.abs(yb - 50) <= 1, `x=${x} y=${yb}`);
  }
});

test('straightenPair: no toca píxeles fuera de A ∪ B ni una frontera corta', () => {
  const A = new Uint8Array(W * H), B = new Uint8Array(W * H);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) (y < 5 ? A : B)[y * W + x] = 1;
  assert.equal(straightenPair(A, B, W, H), null);
});

test('fitLine: ignora puntos atípicos', () => {
  const pts = [];
  for (let x = 0; x < 100; x++) pts.push(x, 30);
  for (let k = 0; k < 10; k++) pts.push(10 * k, 80);
  const L = fitLine(pts, 2);
  assert.ok(Math.abs(L.nx * 50 + L.ny * 30 - L.c) < 1);
});
