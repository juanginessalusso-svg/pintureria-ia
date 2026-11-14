import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recolorWall, rgbToLab, hexToLab } from '../src/index.js';

const W = 40, H = 30;
function makeImage(fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y), p = (y * W + x) * 4;
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
  }
  return { data, width: W, height: H };
}
const full = () => new Float32Array(W * H).fill(1);
const labAt = (img, x, y) => { const p = (y * W + x) * 4; return rgbToLab([img.data[p], img.data[p + 1], img.data[p + 2]]); };
const meanL = (img) => { let s = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s += labAt(img, x, y).L; return s / (W * H); };
// pared con 70 % de columnas en sombra (gris 60) y 30 % iluminadas (gris 180)
const mixta = () => makeImage((x) => (x < 28 ? [60, 60, 60] : [180, 180, 180]));

test("modo 'luz': con pared uniforme da lo mismo que 'relative' (la referencia coincide con la media)", () => {
  const img = makeImage(() => [150, 150, 150]);
  const a = recolorWall(img, full(), '#a3b18a', { mode: 'relative' }).image;
  const b = recolorWall(img, full(), '#a3b18a', { mode: 'luz' }).image;
  assert.ok(Math.abs(labAt(a, 3, 3).L - labAt(b, 3, 3).L) < 1.5);
});

test("modo 'luz': la zona iluminada recibe ~ el L de la carta y la sombra queda más oscura que con 'relative'", () => {
  const img = mixta(), tgt = hexToLab('#c0a090').L;
  const luz = recolorWall(img, full(), '#c0a090', { mode: 'luz', refPct: 0.95 }).image;
  const rel = recolorWall(img, full(), '#c0a090', { mode: 'relative' }).image;
  assert.ok(Math.abs(labAt(luz, 38, 5).L - tgt) < 3, 'la parte iluminada = L de la carta');
  assert.ok(labAt(luz, 5, 5).L < labAt(rel, 5, 5).L - 5, 'la sombra no se levanta');
  assert.ok(meanL(luz) < meanL(rel));
});

test("modo 'luz': mantiene el orden de luces (sombra < luz) y el tono de la carta", () => {
  const luz = recolorWall(mixta(), full(), '#c0a090', { mode: 'luz' }).image;
  assert.ok(labAt(luz, 5, 5).L < labAt(luz, 38, 5).L);
  const t = hexToLab('#c0a090'), o = labAt(luz, 38, 5);
  assert.ok(Math.hypot(o.a - t.a, o.b - t.b) < 6);
});

test("modo 'luz': refPct más alto -> resultado más oscuro (monótono) y los modos existentes no cambian", () => {
  const img = mixta();
  const bajo = meanL(recolorWall(img, full(), '#c0a090', { mode: 'luz', refPct: 0.5 }).image);
  const alto = meanL(recolorWall(img, full(), '#c0a090', { mode: 'luz', refPct: 0.95 }).image);
  assert.ok(alto <= bajo);
  const r1 = recolorWall(img, full(), '#c0a090'), r2 = recolorWall(img, full(), '#c0a090', { mode: 'relative', refPct: 0.5 });
  assert.deepEqual(r1.image.data, r2.image.data); // refPct es inocuo fuera del modo 'luz'
});

test("modo 'luz': el croma baja en la sombra (se escala la luz lineal, no solo L*)", () => {
  const luz = recolorWall(mixta(), full(), '#c0a090', { mode: 'luz' }).image;
  const rel = recolorWall(mixta(), full(), '#c0a090', { mode: 'relative' }).image;
  const C = (l) => Math.hypot(l.a, l.b);
  assert.ok(C(labAt(luz, 5, 5)) < C(labAt(luz, 38, 5)) - 2);
  assert.ok(C(labAt(luz, 5, 5)) < C(labAt(rel, 5, 5)));
});

test("modo 'sinte': conserva la variación de luz de la foto y el blanco sobre blanco queda blanco", async () => {
  const { recolorSinte } = await import('../src/recolor.js');
  const w = 40, h = 10, N = w * h, data = new Uint8ClampedArray(N * 4), mask = new Float32Array(N).fill(1);
  for (let i = 0; i < N; i++) { const v = 150 + ((i % w) < 20 ? -20 : 20); data.set([v, v, v, 255], i * 4); }
  const L = (img, i) => { const q = i * 4; return (img.data[q] + img.data[q + 1] + img.data[q + 2]) / 3; };
  const r = recolorSinte({ data, width: w, height: h }, mask, '#4c585a').image;
  assert.ok(L(r, 30) - L(r, 5) > 15, 'la parte clara sigue más clara que la oscura');
  const blanco = new Uint8ClampedArray(N * 4); for (let i = 0; i < N; i++) blanco.set([235, 235, 235, 255], i * 4);
  const rb = recolorSinte({ data: blanco, width: w, height: h }, mask, '#f5f5f5').image;
  assert.ok(Math.abs(L(rb, 0) - 235) < 8, 'blanco sobre blanco casi no cambia');
});
