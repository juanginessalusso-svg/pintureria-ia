// Fidelidad de color: ΔE00 entre el color de la carta y el color MEDIO de la pared recoloreada (paredes sintéticas).
// La evaluación completa (60 colores de la carta, paredes reales, tablas) está en eval/visualizador/color-eval.mjs y docs/FIDELIDAD-COLOR.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recolorWall, estimateWhiteBalance, hexToLab, rgbToLab, deltaE00 } from '../src/index.js';

const W = 80, H = 60;
/** Imagen: pared (x < 56) con color fnPared(x,y) y resto del ambiente gris neutro. Devuelve imagen y máscara del interior de la pared. */
function escena(fnPared) {
  const data = new Uint8ClampedArray(W * H * 4), mask = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, [r, g, b] = x < 56 ? fnPared(x, y) : [70 + ((x * 5 + y * 3) % 150), 70 + ((x * 5 + y * 3) % 150), 70 + ((x * 5 + y * 3) % 150)];
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
    if (x > 2 && x < 53 && y > 2 && y < H - 3) mask[y * W + x] = 1;
  }
  const pared = new Float32Array(W * H); // la pared completa (incluido el margen que la máscara de pintado deja afuera)
  for (let y = 0; y < H; y++) for (let x = 0; x < 56; x++) pared[y * W + x] = 1;
  return { img: { data, width: W, height: H }, mask, pared };
}
/** Color medio (promedio en LAB) del resultado dentro de la máscara. */
function medio(img, mask) {
  let n = 0, L = 0, a = 0, b = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0.5) { const l = rgbToLab([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]); n++; L += l.L; a += l.a; b += l.b; }
  return { L: L / n, a: a / n, b: b / n };
}
const dE = (hex, img, mask) => deltaE00(hexToLab(hex), medio(img, mask));

const CARTA = ['#8a6e46', '#ffc94f', '#a3b18a', '#1f3a5f', '#b9694a', '#d9c3a0', '#4a4d52', '#7fa7c9', '#e8d5d0', '#006470'];

test('fidelidad: pared bien expuesta, modo relative sin balance -> el color medio coincide con la carta (ΔE00 < 1,5)', () => {
  const { img, mask } = escena(() => [176, 176, 176]); // L ≈ 72, uniforme
  for (const hex of CARTA) {
    const { image } = recolorWall(img, mask, hex, { mode: 'relative' });
    const d = dE(hex, image, mask);
    assert.ok(d < 1.5, `${hex}: ΔE00 ${d.toFixed(2)}`);
  }
});

test('fidelidad: modo pure NO reproduce la luminancia de la carta (queda con la L de la pared)', () => {
  const { img, mask } = escena(() => [176, 176, 176]);
  const { image } = recolorWall(img, mask, '#1f3a5f', { mode: 'pure' });
  assert.ok(dE('#1f3a5f', image, mask) > 20, 'un azul oscuro en modo puro sale pastel: ΔE00 alto');
});

test('fidelidad: la pared en sombra (L≈35) queda más oscura que la carta por el piso minWallL (comportamiento documentado)', () => {
  const { img, mask } = escena(() => [84, 84, 84]); // L ≈ 35
  const { image } = recolorWall(img, mask, '#d9c3a0', { mode: 'relative' }); // beige claro, L ≈ 79
  assert.ok(medio(image, mask).L < hexToLab('#d9c3a0').L - 10, 'una sombra sigue siendo sombra');
  const sinPiso = recolorWall(img, mask, '#d9c3a0', { mode: 'relative', minWallL: 1, maxL: 100 }).image;
  assert.ok(dE('#d9c3a0', sinPiso, mask) < 3, 'sin el piso el medio coincide con la carta');
});

test('estimateWhiteBalance({ exclude }): una pared ya verde no se confunde con una luz verdosa', () => {
  const { img, pared } = escena(() => [150, 175, 140]); // pared verde, resto neutro
  const conPared = estimateWhiteBalance(img), sinPared = estimateWhiteBalance(img, { exclude: pared });
  const desvio = (g) => Math.max(...g) - Math.min(...g);
  assert.ok(desvio(conPared) > 0.2, `sin excluir, la dominante de la pared se toma por luz: ${conPared.map((v) => v.toFixed(2))}`);
  assert.ok(desvio(sinPared) < 0.12, `excluyendo la pared las ganancias quedan casi neutras: ${sinPared.map((v) => v.toFixed(2))}`);
});

test('fidelidad: repintar una pared verde con balance de blancos mejora mucho si se ignora la pared al estimar la luz', () => {
  const { img, mask, pared } = escena(() => [150, 175, 140]);
  const g0 = estimateWhiteBalance(img), g1 = estimateWhiteBalance(img, { exclude: pared });
  let peor0 = 0, peor1 = 0, suma0 = 0, suma1 = 0;
  for (const hex of CARTA) {
    const d0 = dE(hex, recolorWall(img, mask, hex, { gains: g0 }).image, mask), d1 = dE(hex, recolorWall(img, mask, hex, { gains: g1 }).image, mask);
    peor0 = Math.max(peor0, d0); peor1 = Math.max(peor1, d1); suma0 += d0; suma1 += d1;
  }
  assert.ok(suma1 / CARTA.length < (suma0 / CARTA.length) / 2, `ΔE00 medio ${(suma0 / CARTA.length).toFixed(1)} -> ${(suma1 / CARTA.length).toFixed(1)}`);
  assert.ok(peor1 < peor0, `peor caso ${peor0.toFixed(1)} -> ${peor1.toFixed(1)}`);
});

test('estimateWhiteBalance: sin `exclude` el resultado es idéntico al de siempre', () => {
  const { img } = escena((x, y) => [120 + x, 110 + y, 100]);
  assert.deepEqual(estimateWhiteBalance(img), estimateWhiteBalance(img, { exclude: null }));
});
