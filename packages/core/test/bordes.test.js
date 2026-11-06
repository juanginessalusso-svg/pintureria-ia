import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refineByColor, detectSurfaces } from '../src/index.js';

const W = 160, H = 120;
// Pared verde claro a la izquierda (x < 100) con una franja de azulejo blanco pegada abajo (y >= 90); resto: puerta oscura.
function scene() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const c = x >= 100 ? [40, 40, 44] : y >= 90 ? [245, 245, 245] : [170, 200, 150];
    data.set([...c, 255], i * 4);
  }
  return { data, width: W, height: H };
}
const rect = (x0, y0, x1, y1) => { const m = new Uint8Array(W * H); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1; return m; };
const count = (m) => m.reduce((s, v) => s + v, 0);

test('refineByColor saca el azulejo que la máscara se comió (filtración) y no toca lo demás', () => {
  const img = scene(), r = [{ name: 'Pared', mask: rect(0, 0, 100, 100) }]; // se pasó 10 px sobre el azulejo
  refineByColor(r, img, { tol: 6, band: 14 });
  assert.equal(count(r[0].mask.subarray(90 * W, 100 * W)), 0); // las filas 90..99 (azulejo) ya no están
  assert.equal(count(r[0].mask.subarray(0, 90 * W)), 100 * 90); // el resto de la pared, intacto
});

test('refineByColor rellena un golfo de pared sin cubrir en el borde, sin invadir otra superficie ni cruzar bordes', () => {
  const img = scene(), mask = rect(0, 0, 100, 90), otra = rect(100, 0, 160, 120);
  for (let y = 30; y < 50; y++) for (let x = 90; x < 100; x++) mask[y * W + x] = 0; // golfo de 10 px
  const r = [{ name: 'Pared', mask }, { name: 'Puerta', mask: otra }];
  refineByColor(r, img, { tol: 6, band: 14, grow: true });
  assert.ok(count(r[0].mask) >= 8950); // golfo relleno salvo ~2 px pegados al borde real (el crecimiento no cruza gradientes)
  assert.equal(r[0].mask[40 * W + 94], 1);
  assert.equal(count(r[1].mask), 60 * 120); // la otra superficie no cambia
  assert.equal(r[0].mask[95 * W + 50], 0); // y no se fue al azulejo
});

test('tol 0 / sin superficies no hace nada, y detectSurfaces con colorSnap apagado no lo invoca', () => {
  const img = scene(), m = rect(0, 0, 100, 100), r = [{ name: 'P', mask: Uint8Array.from(m) }];
  refineByColor(r, img, { tol: 0 });
  assert.deepEqual(r[0].mask, m);
  assert.deepEqual(refineByColor([], img), []);
});

test('superficie sin interior suficiente (franja fina) queda como está', () => {
  const img = scene(), m = rect(0, 10, 100, 14), r = [{ name: 'P', mask: Uint8Array.from(m) }];
  refineByColor(r, img, { tol: 6, band: 14 });
  assert.deepEqual(r[0].mask, m);
});
