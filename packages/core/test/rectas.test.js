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

import { growIntoShadow } from '../src/sombras.js';

test('growIntoShadow: el techo crece sobre su sombra suave pero no sobre un objeto con arista', () => {
  const w = 120, h = 80, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 220;
    if (y >= 30 && y < 50) v = 220 - Math.round(((y - 30) / 20) * 60); // sombra que se degrada suave (220 → 160)
    if (y >= 50) v = 60; // objeto oscuro con arista fuerte
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  const mask = new Uint8Array(w * h); for (let y = 0; y < 30; y++) for (let x = 0; x < w; x++) mask[y * w + x] = 1;
  growIntoShadow([{ kind: 'techo', mask }], { data, width: w, height: h }, { maxGrow: 0.3, brighter: 3 });
  assert.equal(mask[40 * w + 60], 1, 'la sombra suave quedó en el techo');
  assert.equal(mask[60 * w + 60], 0, 'el objeto oscuro no');
});
