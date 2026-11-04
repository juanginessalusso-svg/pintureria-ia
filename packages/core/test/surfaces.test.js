import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSurfaces, classifySurface, maskGeometry, textureRatio, distanceTransform } from '../src/index.js';

const W = 240, H = 320;
const px = (data, x, y, r, g, b) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };

// Habitación sintética: techo claro arriba (0..20 %), pared grande clara con un degradé suave, y un "hueco de puerta" oscuro adentro.
function room() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y < H * 0.2) px(data, x, y, 235, 235, 235); // techo
    else if (x > 90 && x < 150 && y > H * 0.4 && y < H * 0.85) px(data, x, y, 40, 40, 44); // hueco oscuro
    else { const v = 200 - Math.round((x / W) * 12); px(data, x, y, v, v, v - 4); } // pared con sombra suave
  }
  return data;
}

// Segmentador de mentira: devuelve la "región" que contiene el punto, según la misma geometría con que se armó la foto.
function fakeSegment(pts) {
  const m = new Uint8Array(W * H), { x, y } = pts[0];
  const inTecho = y < H * 0.2, inHueco = x > 90 && x < 150 && y > H * 0.4 && y < H * 0.85;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const t = j < H * 0.2, h = i > 90 && i < 150 && j > H * 0.4 && j < H * 0.85;
    if (inTecho ? t : inHueco ? h : !t && !h) m[j * W + i] = 1;
  }
  return m;
}

test('detecta la pared y el techo, y descarta el hueco oscuro', async () => {
  const lista = await detectSurfaces({ data: room(), width: W, height: H }, async (pts) => fakeSegment(pts));
  assert.deepEqual(lista.map((s) => s.kind).sort(), ['pared', 'techo']);
  const pared = lista.find((s) => s.kind === 'pared'), techo = lista.find((s) => s.kind === 'techo');
  assert.equal(pared.name, 'Pared');
  assert.equal(techo.name, 'Techo');
  assert.ok(pared.area > 0.55, `pared ${pared.area}`);
  assert.ok(techo.area > 0.15 && techo.area < 0.25, `techo ${techo.area}`);
});

test('las máscaras detectadas son disjuntas', async () => {
  const lista = await detectSurfaces({ data: room(), width: W, height: H }, async (pts) => fakeSegment(pts));
  const seen = new Uint8Array(W * H);
  for (const s of lista) for (let i = 0; i < s.mask.length; i++) if (s.mask[i]) { assert.equal(seen[i], 0, 'píxel en dos superficies'); seen[i] = 1; }
});

test('una foto sin zonas lisas no inventa superficies', async () => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = (x * 7 + y * 13) % 2 ? 250 : 10; px(data, x, y, v, v, v); } // ruido de alto contraste
  let llamadas = 0;
  const lista = await detectSurfaces({ data, width: W, height: H }, async (pts) => { llamadas++; return fakeSegment(pts); });
  assert.equal(lista.length, 0);
  assert.equal(llamadas, 0);
});

test('classifySurface: techo, pared, piso y objetos chicos', () => {
  const g = (o) => ({ area: 0.2, cx: 0.5, cy: 0.5, top: 0.2, bottom: 0.8, left: 0, right: 1, touchesTop: false, touchesBottom: false, ...o });
  assert.equal(classifySurface(g({ cy: 0.08, top: 0, bottom: 0.18, touchesTop: true })), 'techo');
  assert.equal(classifySurface(g({})), 'pared');
  assert.equal(classifySurface(g({ cy: 0.85, top: 0.7, bottom: 1, touchesBottom: true })), null); // piso
  assert.equal(classifySurface(g({ area: 0.01 })), null); // muy chica
  assert.equal(classifySurface(g({ top: 0.4, bottom: 0.6, cy: 0.5 })), null); // franja baja: no es pared
});

test('maskGeometry y distanceTransform', () => {
  const m = new Uint8Array(10 * 10);
  for (let y = 2; y < 6; y++) for (let x = 3; x < 7; x++) m[y * 10 + x] = 1;
  const g = maskGeometry(m, 10, 10);
  assert.equal(g.area, 0.16);
  assert.equal(g.left, 0.3); assert.equal(g.right, 0.7);
  const d = distanceTransform(m, 10, 10);
  assert.ok(d[3 * 10 + 4] > d[2 * 10 + 3]); // el centro está más lejos del borde que una esquina
});

test('textureRatio: liso ≈ 0, con textura > 0', () => {
  const w = 20, h = 20, mask = new Uint8Array(w * h).fill(1);
  assert.equal(textureRatio(mask, new Float32Array(w * h), w, h, 5), 0);
  assert.ok(textureRatio(mask, new Float32Array(w * h).fill(30), w, h, 5) > 0.9);
});

// ---- división de máscaras fusionadas (splitMerged) ----
import { splitMerged, gradientMap } from '../src/index.js';

// Grilla chica sintética: dos "paredes" separadas por una arista vertical fuerte (o por un degradé suave).
function twoPlanes(edge) {
  const w = 60, h = 60, grad = new Float32Array(w * h), mask = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grad[y * w + x] = Math.abs(x - 30) <= 1 ? edge : 0.5;
  return { w, h, grad, mask };
}

test('splitMerged: una arista fuerte entre dos zonas lisas las divide en dos', () => {
  const { w, h, grad, mask } = twoPlanes(9);
  const partes = splitMerged(mask, grad, w, h, w, h, { minEdge: 4.5 });
  assert.equal(partes.length, 2);
  const [a, b] = partes.map((p) => p.reduce((s, v) => s + v, 0));
  assert.ok(a > w * h * 0.4 && b > w * h * 0.4, `partes ${a}/${b}`);
  assert.equal(partes[0].reduce((s, v, i) => s + (v && partes[1][i] ? 1 : 0), 0), 0, 'las partes no se solapan');
});

test('splitMerged: un degradé suave (sombra) NO divide la pared', () => {
  const { w, h, grad, mask } = twoPlanes(2.5);
  assert.equal(splitMerged(mask, grad, w, h, w, h, { minEdge: 4.5 }).length, 1);
});

test('splitMerged: una sola zona lisa devuelve la máscara tal cual', () => {
  const w = 40, h = 40, mask = new Uint8Array(w * h).fill(1);
  const r = splitMerged(mask, new Float32Array(w * h).fill(0.3), w, h, w, h);
  assert.equal(r.length, 1);
  assert.equal(r[0], mask);
});

// ---- azulejo y banda ancha sobre los azulejos ----
import { lineRatio } from '../src/index.js';

test('lineRatio: una pared lisa ≈ 0; un paño con juntas (líneas rectas finas) da más', () => {
  const w = 100, h = 100, mask = new Uint8Array(w * h).fill(1);
  const lisa = new Float32Array(w * h).fill(1);
  assert.equal(lineRatio(mask, lisa, w, h, 10), 0);
  const juntas = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x % 25 === 12 || y % 25 === 12) juntas[y * w + x] = 40; // grilla de azulejos
  assert.ok(lineRatio(mask, juntas, w, h, 10) > 0.05);
});

test('classifySurface: una banda ancha en la mitad de arriba es la pared sobre los azulejos', () => {
  const g = { area: 0.22, cx: 0.5, cy: 0.27, top: 0.17, bottom: 0.38, left: 0, right: 1, touchesTop: false, touchesBottom: false };
  assert.equal(classifySurface(g), 'pared');
  assert.equal(classifySurface({ ...g, cy: 0.6, top: 0.5, bottom: 0.7 }), null); // la misma banda más abajo sigue siendo "franja baja"
});
