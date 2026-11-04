import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recolorWall, estimateWhiteBalance, featherMask, maskFraction, hexToLab, rgbToLab, removeSmallIslands, cleanMask } from '../src/index.js';

const W = 40, H = 30;

/** Imagen RGBA a partir de una función (x,y) -> [r,g,b]. */
function makeImage(fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y), p = (y * W + x) * 4;
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = 255;
  }
  return { data, width: W, height: H };
}
const labAt = (img, x, y) => { const p = (y * W + x) * 4; return rgbToLab([img.data[p], img.data[p + 1], img.data[p + 2]]); };
const leftHalf = () => { const m = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) m[y * W + x] = 1; return m; };
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b} (±${eps})`);

test('L puro: conserva la luminancia y toma a/b del color elegido', () => {
  const img = makeImage(() => [175, 175, 175]); // pared gris claro uniforme (L ≈ 72)
  const before = labAt(img, 5, 5);
  const target = hexToLab('#a3b18a'); // verde salvia, dentro de gamut a ese L
  const { image } = recolorWall(img, leftHalf(), '#a3b18a', { mode: 'pure' });
  const after = labAt(image, 5, 5);
  close(after.L, before.L, 1.5, 'L');
  close(after.a, target.a, 3, 'a');
  close(after.b, target.b, 3, 'b');
});

test('L relativo: un color oscuro sobre pared clara sale oscuro (L puro lo lavaría)', () => {
  const img = makeImage(() => [235, 235, 230]); // casi blanco
  const dark = hexToLab('#1f3a5f');
  const rel = recolorWall(img, leftHalf(), '#1f3a5f', { mode: 'relative' }).image;
  const pure = recolorWall(img, leftHalf(), '#1f3a5f', { mode: 'pure' }).image;
  close(labAt(rel, 5, 5).L, dark.L, 4, 'relativo ≈ L del color');
  assert.ok(labAt(pure, 5, 5).L > 80, 'el L puro queda claro (pastel)');
});

test('conserva textura: sombras y luces siguen en el mismo orden', () => {
  const img = makeImage((x) => { const v = 120 + x * 3; return [v, v, v]; }); // gradiente de luz
  const { image } = recolorWall(img, leftHalf(), '#d9c3a0', { mode: 'relative' });
  let prev = -1;
  for (let x = 0; x < W / 2; x += 2) {
    const L = labAt(image, x, 10).L;
    assert.ok(L >= prev - 0.6, `L debe crecer con la luz (x=${x}: ${L} < ${prev})`);
    prev = L;
  }
  assert.ok(labAt(image, 18, 10).L - labAt(image, 0, 10).L > 5, 'se mantiene el contraste');
});

test('no toca los píxeles fuera de la máscara', () => {
  const img = makeImage((x, y) => [100 + x, 90 + y, 80]);
  const { image } = recolorWall(img, leftHalf(), '#b9694a');
  for (let y = 0; y < H; y++) for (let x = W / 2; x < W; x++) {
    const p = (y * W + x) * 4;
    assert.deepEqual([...image.data.slice(p, p + 4)], [...img.data.slice(p, p + 4)]);
  }
  assert.notDeepEqual([...image.data.slice(0, 4)], [...img.data.slice(0, 4)]); // sí cambió dentro
});

test('intensidad 0 deja la imagen igual', () => {
  const img = makeImage(() => [200, 190, 180]);
  const { image } = recolorWall(img, leftHalf(), '#3a5a40', { intensity: 0 });
  assert.deepEqual([...image.data], [...img.data]);
});

test('balance de blancos: detecta dominante azul y la corrige', () => {
  const img = makeImage((x, y) => [150 + (x % 7), 160 + (y % 5), 200]); // cast azul
  const [gr, gg, gb] = estimateWhiteBalance(img);
  assert.ok(gr > 1 && gb < 1, `gR=${gr} gB=${gb}`);
  assert.ok(gr <= 1.35 + 1e-9 && gb >= 1 / 1.35 - 1e-9, 'respeta el límite');
  const neutral = makeImage(() => [150, 150, 150]);
  const g = estimateWhiteBalance(neutral);
  g.forEach((v) => close(v, 1, 0.01));
});

test('con balance de blancos la pared mantiene la dominante de la foto', () => {
  const img = makeImage(() => [150, 160, 200]);
  const gains = estimateWhiteBalance(img);
  const { image } = recolorWall(img, leftHalf(), '#d9c3a0', { gains });
  const p = 5 * 4 + 5 * W * 4;
  assert.ok(image.data[p + 2] > image.data[p] * 0.6, 'el azul no desaparece');
});

test('featherMask suaviza el borde y conserva el interior; maskFraction cuenta bien', () => {
  const m = leftHalf();
  const f = featherMask(m, W, H, 2);
  assert.equal(f[10 * W + 2], 1);
  assert.equal(f[10 * W + 37], 0);
  const edge = f[10 * W + W / 2];
  assert.ok(edge > 0 && edge < 1, `borde suave: ${edge}`);
  close(maskFraction(m), 0.5, 0.001);
});

test('removeSmallIslands: saca puntitos sueltos, conserva la pared y NO rellena huecos', () => {
  const m = new Uint8Array(W * H);
  for (let y = 5; y < 25; y++) for (let x = 5; x < 30; x++) m[y * W + x] = 1; // pared 25x20
  m[12 * W + 15] = 0; m[12 * W + 16] = 0; // hueco (tomacorriente): debe seguir sin pintar
  m[1 * W + 35] = 1; m[1 * W + 36] = 1; // islita de 2 px
  m[28 * W + 2] = 1; // punto de 1 px
  const out = require_count(removeSmallIslands(m, W, H, 10));
  assert.equal(out.islita, 0);
  assert.equal(out.punto, 0);
  assert.equal(out.hueco, 0);
  assert.equal(out.pared, 25 * 20 - 2);
  function require_count(o) {
    let pared = 0;
    for (let y = 5; y < 25; y++) for (let x = 5; x < 30; x++) pared += o[y * W + x];
    return { pared, islita: o[1 * W + 35] + o[1 * W + 36], punto: o[28 * W + 2], hueco: o[12 * W + 15] + o[12 * W + 16] };
  }
});

test('cleanMask: corta un hilo fino que une una mancha a la pared, y conserva la pared', () => {
  const w = 200, h = 100, m = new Uint8Array(w * h);
  for (let y = 20; y < 90; y++) for (let x = 10; x < 150; x++) m[y * w + x] = 1; // pared 140x70
  for (let x = 150; x < 185; x++) m[19 * w + x] = 1; // hilo de 1 px pegado al borde...
  for (let y = 14; y < 17; y++) for (let x = 183; x < 186; x++) m[y * w + x] = 1; // ...que lleva a una manchita de 3x3
  for (let y = 17; y < 20; y++) m[y * w + 184] = 1; // conexión vertical fina
  const c = cleanMask(m, w, h);
  let wall = 0;
  for (let y = 20; y < 90; y++) for (let x = 10; x < 150; x++) wall += c[y * w + x];
  assert.ok(wall >= 0.99 * 140 * 70, `la pared se conserva (${wall})`);
  let stray = 0;
  for (let y = 0; y < 20; y++) for (let x = 150; x < w; x++) stray += c[y * w + x];
  assert.equal(stray, 0, 'hilo y manchita eliminados');
});

test('rechaza máscara de otro tamaño', () => {
  const img = makeImage(() => [100, 100, 100]);
  assert.throws(() => recolorWall(img, new Float32Array(10), '#ffffff'));
});
