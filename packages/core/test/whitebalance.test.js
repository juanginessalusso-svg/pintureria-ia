import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whiteBalanceFor, wallVsRestChroma, estimateWhiteBalance, dilateMask } from '../src/index.js';

const W = 60, H = 40;
/** Imagen: pared (x < 30) con color `wall`, resto con color `rest`; ruido leve determinístico para que no sea plano. */
function scene(wall, rest) {
  const data = new Uint8ClampedArray(W * H * 4), mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = x < 30 ? wall : rest, n = ((x * 7 + y * 3) % 5) - 2, p = (y * W + x) * 4;
    data[p] = c[0] + n; data[p + 1] = c[1] + n; data[p + 2] = c[2] + n; data[p + 3] = 255;
    if (x < 30) mask[y * W + x] = 1;
  }
  return { img: { data, width: W, height: H }, mask };
}
const near = (g, v, eps = 0.02) => g.every((x, i) => Math.abs(x - v[i]) <= eps);

test('sin máscaras (o sin superficies): idéntico a estimateWhiteBalance', () => {
  const { img } = scene([150, 175, 140], [128, 128, 128]);
  assert.deepEqual(whiteBalanceFor(img, null).gains, estimateWhiteBalance(img));
  assert.deepEqual(whiteBalanceFor(img, []).gains, estimateWhiteBalance(img));
  assert.equal(whiteBalanceFor(img, []).excluded, false);
});

test('pared ya verde en un ambiente neutro: se excluye y la luz queda neutra', () => {
  const { img, mask } = scene([150, 175, 140], [128, 128, 128]);
  const r = whiteBalanceFor(img, [mask]);
  assert.equal(r.excluded, true);
  assert.ok(near(r.gains, [1, 1, 1]), `gains ${r.gains}`);
  // y sin la política gray-world la tomaba por luz teñida:
  assert.ok(!near(estimateWhiteBalance(img), [1, 1, 1], 0.1));
});

test('pared azul y pared cálida en ambiente neutro: también se excluyen', () => {
  for (const wall of [[128, 150, 178], [190, 168, 136]]) {
    const { img, mask } = scene(wall, [128, 128, 128]);
    assert.equal(whiteBalanceFor(img, [mask]).excluded, true, `pared ${wall}`);
  }
});

test('pared neutra en un ambiente con dominante (luz teñida): NO se excluye, se corrige como antes', () => {
  const { img, mask } = scene([128, 128, 128], [150, 128, 105]); // resto cálido, pared gris
  const r = whiteBalanceFor(img, [mask]);
  assert.equal(r.excluded, false);
  assert.deepEqual(r.gains, estimateWhiteBalance(img));
  assert.ok(r.stats.dist > 12, 'la distancia sola habría excluido: el veto es el croma de la pared');
});

test('toda la foto con la misma dominante (luz cálida, pared incluida): NO se excluye', () => {
  const { img, mask } = scene([190, 165, 135], [185, 160, 130]);
  const r = whiteBalanceFor(img, [mask]);
  assert.equal(r.excluded, false);
  assert.deepEqual(r.gains, estimateWhiteBalance(img));
});

test('pared que ocupa toda la foto: solo cuenta su croma', () => {
  const colored = scene([150, 175, 140], [150, 175, 140]);
  const all = new Float32Array(W * H).fill(1);
  const r = whiteBalanceFor(colored.img, [all]);
  assert.equal(r.excluded, true);
  assert.deepEqual(r.gains, [1, 1, 1]); // nada con qué estimar la luz: sin corrección
  const gray = scene([128, 128, 128], [128, 128, 128]);
  assert.equal(whiteBalanceFor(gray.img, [all]).excluded, false);
});

test('paredes chicas (< minWallFrac) no deciden; el umbral es configurable', () => {
  const { img, mask } = scene([150, 175, 140], [128, 128, 128]);
  const tiny = new Float32Array(W * H); for (let i = 0; i < 90; i++) tiny[i] = 1; // 90 px (menos de 100 muestras): ignorada
  assert.equal(wallVsRestChroma(img, tiny), null);
  assert.equal(whiteBalanceFor(img, [tiny]).excluded, false);
  assert.equal(whiteBalanceFor(img, [mask], { threshold: 80 }).excluded, false);
  assert.equal(whiteBalanceFor(img, [mask], { minChroma: 80 }).excluded, false);
});

test('la franja de borde de la pared no contamina el "resto"', () => {
  const { img, mask } = scene([150, 175, 140], [128, 128, 128]);
  const s = wallVsRestChroma(img, Uint8Array.from(mask), { dilate: 4 });
  assert.ok(s.rest.C < 1.5, `resto neutro, C=${s.rest.C}`);
  const d = dilateMask(Uint8Array.from(mask), W, H, 4);
  assert.equal(d[5 * W + 33], 1); assert.equal(d[5 * W + 35], 0);
});
