import test from 'node:test';
import assert from 'node:assert/strict';
import { marcarZocalos } from '../src/zocalo.js';

const W = 120, H = 100, N = W * H;
function foto(colorDe) { const d = new Uint8ClampedArray(N * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = colorDe(x, y), i = y * W + x; d.set([r, g, b, 255], i * 4); } return { data: d, width: W, height: H }; }
const todo = () => { const m = new Uint8Array(N); for (let y = 20; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = 1; return m; };

test('una pared crema con zócalo rojo abajo se parte en pared + "Zócalo"', () => {
  const img = foto((x, y) => (y >= 82 ? [150, 40, 35] : [235, 220, 180]));
  const s = marcarZocalos([{ name: 'Pared 1', kind: 'pared', area: 0.8, mask: todo() }], img);
  const z = s.find((f) => f.kind === 'zocalo'), p = s.find((f) => f.kind === 'pared');
  assert.ok(z && p, 'hay pared y zócalo');
  assert.equal(z.name, 'Zócalo');
  assert.equal(z.mask[90 * W + 50], 1); assert.equal(z.mask[50 * W + 50], 0);
  assert.equal(p.mask[50 * W + 50], 1);
});

test('una sombra que oscurece la pared hacia el piso NO es zócalo', () => {
  const img = foto((x, y) => { const k = Math.max(0.55, 1 - Math.max(0, y - 40) / 110); return [235 * k, 220 * k, 180 * k]; });
  const s = marcarZocalos([{ name: 'Pared 1', kind: 'pared', area: 0.8, mask: todo() }], img);
  assert.equal(s.filter((f) => f.kind === 'zocalo').length, 0);
});

test('una franja baja y ancha al pie de otra pared (instancia propia) pasa a ser "Zócalo"', () => {
  const img = foto((x, y) => (y >= 85 ? [30, 110, 50] : [235, 220, 180]));
  const arriba = new Uint8Array(N), franja = new Uint8Array(N);
  for (let y = 20; y < H; y++) for (let x = 0; x < W; x++) (y >= 85 ? franja : arriba)[y * W + x] = 1;
  const s = marcarZocalos([{ name: 'Pared 1', kind: 'pared', area: 0.65, mask: arriba }, { name: 'Pared 2', kind: 'pared', area: 0.15, mask: franja }], img);
  assert.deepEqual(s.map((f) => [f.kind, f.name]), [['pared', 'Pared 1'], ['zocalo', 'Zócalo']]);
});
