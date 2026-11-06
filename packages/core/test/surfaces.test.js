import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSurfaces, classifySurface, maskGeometry, textureRatio, distanceTransform, findVerticalCorner, splitAtCorner, ceilingWallContact, colorStats, cutEnclosedObjects } from '../src/index.js';

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

test('splitMerged cornerOnly: una arista corta y no vertical (repisa) se fusiona; las largas o verticales se conservan', () => {
  const { w, h, grad, mask } = twoPlanes(9);
  assert.equal(splitMerged(mask, grad, w, h, w, h, { minEdge: 4.5, cornerOnly: true }).length, 2); // arista vertical de todo el alto
  // arista horizontal larga (unión techo/pared): se conserva
  const g2 = new Float32Array(w * h), m2 = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g2[y * w + x] = Math.abs(y - 30) <= 1 ? 9 : 0.5;
  assert.equal(splitMerged(m2, g2, w, h, w, h, { minEdge: 4.5, cornerOnly: true }).length, 2);
  // la misma arista horizontal pero CORTA (el canto de una repisa en una pared lisa): se fusiona
  const g3 = new Float32Array(w * h).fill(0.5);
  for (let y = 29; y <= 31; y++) for (let x = 20; x < 28; x++) g3[y * w + x] = 9;
  const nucleos = (gr, o) => splitMerged(m2, gr, w, h, w, h, { minEdge: 4.5, strictMax: 2.2, ...o }).length;
  assert.equal(nucleos(g3, { cornerOnly: true }), 1);
});

import { rescueTextured } from '../src/index.js';

test('rescueTextured: de una máscara con ventanas rescata solo la pared del color dominante', () => {
  const W = 120, H = 100, data = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H).fill(1), G = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, ventana = x >= 50 && x < 70 && y >= 30 && y < 60;
    [data[i], data[i + 1], data[i + 2], data[i + 3]] = ventana ? [40, 60, 90, 255] : [220, 120, 100, 255];
    G[y * W + x] = ventana ? 30 : 1;
  }
  const out = rescueTextured(mask, { data, width: W, height: H }, G, { minPix: 500 });
  assert.equal(out.length, 1);
  assert.equal(out[0][(45 * W) + 60], 0, 'la ventana queda afuera');
  assert.equal(out[0][(10 * W) + 10], 1, 'la pared queda adentro');
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

test('lineRatio con loneLine: una sola arista larga (zócalo adentro de la máscara) se tolera; una grilla de juntas no', () => {
  const w = 100, h = 100, mask = new Uint8Array(w * h).fill(1);
  const una = new Float32Array(w * h);
  for (let x = 0; x < w; x++) una[80 * w + x] = 40; // solo el borde del zócalo
  assert.ok(lineRatio(mask, una, w, h, 10) > 0.004);
  assert.equal(lineRatio(mask, una, w, h, 10, 5, { loneLine: true }), 0);
  const juntas = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x % 25 === 12 || y % 25 === 12) juntas[y * w + x] = 40;
  assert.equal(lineRatio(mask, juntas, w, h, 10, 5, { loneLine: true }), lineRatio(mask, juntas, w, h, 10));
  const dos = new Float32Array(w * h);
  for (let x = 0; x < w; x++) { dos[30 * w + x] = 40; dos[70 * w + x] = 40; }
  assert.equal(lineRatio(mask, dos, w, h, 10, 5, { loneLine: true }), lineRatio(mask, dos, w, h, 10)); // dos líneas = enlosado
});

test('classifySurface: una banda ancha en la mitad de arriba es la pared sobre los azulejos', () => {
  const g = { area: 0.22, cx: 0.5, cy: 0.27, top: 0.17, bottom: 0.38, left: 0, right: 1, touchesTop: false, touchesBottom: false };
  assert.equal(classifySurface(g), 'pared');
  assert.equal(classifySurface({ ...g, cy: 0.6, top: 0.5, bottom: 0.7 }), null); // la misma banda más abajo sigue siendo "franja baja"
});

// ---- refinado de bordes y tira angosta ----
import { refineEdges } from '../src/index.js';

test('refineEdges: el contorno se asienta sobre el borde real cuando SAM se pasó', () => {
  const w = 100, h = 40, G = new Float32Array(w * h).fill(0.3);
  for (let y = 0; y < h; y++) G[y * w + 60] = 40; // borde fuerte (el límite real de la pared) en x = 60
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < 66; x++) mask[y * w + x] = 1; // SAM se pasó 6 px
  const [r] = refineEdges([{ mask }], G, w, h, { band: 10 });
  let ancho = 0;
  for (let x = 0; x < w; x++) if (r.mask[20 * w + x]) ancho = x + 1;
  assert.ok(Math.abs(ancho - 61) <= 2, `el contorno quedó en ${ancho}, se esperaba cerca de 61`);
});

test('refineEdges: sin borde real el contorno no se mueve', () => {
  const w = 100, h = 40, G = new Float32Array(w * h).fill(0.3);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < 50; x++) mask[y * w + x] = 1;
  const antes = mask.slice();
  const [r] = refineEdges([{ mask }], G, w, h, { band: 10 });
  let dif = 0;
  for (let i = 0; i < mask.length; i++) if (r.mask[i] !== antes[i]) dif++;
  assert.ok(dif / (w * h) < 0.02, `se movió ${dif} píxeles`);
});

test('refineEdges: dos superficies pegadas se reparten la franja sin solaparse', () => {
  const w = 100, h = 30, G = new Float32Array(w * h).fill(0.3);
  for (let y = 0; y < h; y++) G[y * w + 55] = 40;
  const a = new Uint8Array(w * h), b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { for (let x = 0; x < 50; x++) a[y * w + x] = 1; for (let x = 50; x < w; x++) b[y * w + x] = 1; }
  const [ra, rb] = refineEdges([{ mask: a }, { mask: b }], G, w, h, { band: 12 });
  for (let i = 0; i < w * h; i++) assert.ok(!(ra.mask[i] && rb.mask[i]), 'solapadas');
  let ancho = 0;
  for (let x = 0; x < w; x++) if (ra.mask[15 * w + x]) ancho = x + 1;
  assert.ok(Math.abs(ancho - 56) <= 2, `límite en ${ancho}`);
});

test('classifySurface: una tira angosta (ancho medio < 6 %) no es una pared', () => {
  const g = { area: 0.03, cx: 0.02, cy: 0.5, top: 0.2, bottom: 0.8, left: 0, right: 0.09, touchesTop: false, touchesBottom: false };
  assert.equal(classifySurface(g), null); // 0,03 / 0,6 = 5 %
  assert.equal(classifySurface({ ...g, area: 0.05 }), 'pared'); // 0,05 / 0,6 = 8 %
});

// ---- partición "la máscara más chica gana" ----
import { partitionBySmallest } from '../src/index.js';

// 100x100: pared grande (todo menos el techo, y=0..19) + un objeto cuadrado chico dentro, + un panel ancho de otro plano.
const PW = 100, PH = 100;
const rectM = (x0, y0, x1, y1) => { const m = new Uint8Array(PW * PH); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * PW + x] = 1; return m; };
const unionM = (...ms) => { const o = new Uint8Array(PW * PH); for (const m of ms) for (let i = 0; i < o.length; i++) if (m[i]) o[i] = 1; return o; };
const objeto = rectM(60, 50, 72, 62);              // 12x12 = 144 px (~2 % de la foto): chico
const panel = rectM(10, 20, 40, 100);              // 30x80: un panel de pared real en otro plano
const pared = unionM(rectM(0, 20, 100, 100));       // lo que "detectó" el detector: todo junto
const hasPt = (m, p) => m[Math.floor(p.y) * PW + Math.floor(p.x)] === 1;
// SAM de mentira: desde un punto sobre el objeto devuelve el objeto; sobre el panel, el panel; en otro lado, la pared entera.
const fakeSam = async ([p]) => (hasPt(objeto, p) ? objeto : hasPt(panel, p) ? panel : pared);

test('partición: un objeto chico dentro de la pared se saca y no queda como superficie', async () => {
  const w = { kind: 'pared', name: 'Pared', area: 0.8, luma: 150, mask: pared.slice() };
  const r = await partitionBySmallest([w], fakeSam, PW, PH, { grid: 10, frac: 0.3, minArea: 0.05 });
  assert.equal(w.mask[55 * PW + 65], 0, 'el centro del objeto ya no está en la pared');
  assert.equal(r.veto[55 * PW + 65], 1, 'queda vedado para que no se vuelva a pintar');
  assert.equal(w.mask[90 * PW + 90], 1, 'la pared de verdad sigue');
  assert.equal(r.extra.filter((e) => e.kind === 'pared' && e.mask[55 * PW + 65]).length, 0, 'un objeto no es una superficie nueva');
});

test('partición: un panel grande de otro plano pasa a ser una superficie NUEVA (no se pierde)', async () => {
  const w = { kind: 'pared', name: 'Pared', area: 0.8, luma: 150, mask: pared.slice() };
  const r = await partitionBySmallest([w], fakeSam, PW, PH, { grid: 10, frac: 0.5, minArea: 0.05 });
  const nuevo = r.extra.find((e) => e.mask[60 * PW + 20]);
  assert.ok(nuevo, 'el panel apareció como superficie nueva');
  assert.equal(nuevo.kind, 'pared');
  assert.equal(w.mask[60 * PW + 20], 0, 'ya no está duplicado en la pared original');
});

test('partición: sin nada que separar no toca la pared', async () => {
  const w = { kind: 'pared', name: 'Pared', area: 0.8, luma: 150, mask: pared.slice() };
  const antes = w.mask.slice();
  const r = await partitionBySmallest([w], async () => pared, PW, PH, { grid: 6 });
  assert.deepEqual([...w.mask], [...antes]);
  assert.equal(r.extra.length, 0);
});

test('partición: si se llevaría demasiado de la pared (maxLoss) no se toca', async () => {
  const w = { kind: 'pared', name: 'Pared', area: 0.8, luma: 150, mask: pared.slice() };
  const antes = w.mask.slice();
  const mitad = rectM(0, 20, 100, 70); // una "máscara más chica" que cubre 62 % de la pared
  const r = await partitionBySmallest([w], async ([p]) => (p.y < 70 ? mitad : pared), PW, PH, { grid: 8, frac: 0.7, maxLoss: 0.3 });
  assert.deepEqual([...w.mask], [...antes]);
  assert.equal(r.extra.length, 0);
});

// ---- relleno de huecos finos (pared entre los listones de una silla) ----
import { fillThinGaps } from '../src/index.js';

// 200x160: pared gris (150) con una "silla" oscura (40) con 2 huecos finos entre listones; un "marco" claro y fino pegado a un pasillo oscuro;
// y un objeto grande del color de la pared (un refrigerador blanco) que NO es fino.
const GW = 200, GH = 160;
function escena() {
  const data = new Uint8ClampedArray(GW * GH * 4);
  const set = (x, y, v) => { const i = (y * GW + x) * 4; data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255; };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) set(x, y, 150); // pared
  const silla = (x, y) => x >= 70 && x < 130 && y >= 60;                     // silla: poste izq., poste der. y listones
  const hueco1 = (x, y) => x >= 76 && x < 124 && y >= 80 && y < 92;
  const hueco2 = (x, y) => x >= 76 && x < 124 && y >= 108 && y < 120;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (silla(x, y) && !hueco1(x, y) && !hueco2(x, y)) set(x, y, 40);
  for (let y = 20; y < GH; y++) for (let x = 0; x < 20; x++) set(x, y, 40);    // pasillo oscuro a la izquierda
  for (let y = 20; y < GH; y++) for (let x = 20; x < 28; x++) set(x, y, 150);  // "marco" del color de la pared, fino, entre el pasillo y la pared
  for (let y = 10; y < 70; y++) for (let x = 150; x < 190; x++) set(x, y, 150); // objeto grande del color de la pared
  return { data, width: GW, height: GH };
}
const paredSinSilla = () => {
  const m = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const enSilla = x >= 70 && x < 130 && y >= 60;
    const enPasillo = y >= 20 && x < 28;
    const enObjeto = x >= 150 && x < 190 && y >= 10 && y < 70;
    if (!enSilla && !enPasillo && !enObjeto) m[y * GW + x] = 1;
  }
  return m;
};

test('relleno de huecos: pinta la pared que se ve entre los listones, no el marco ni el objeto grande', () => {
  const w = { kind: 'pared', name: 'Pared', mask: paredSinSilla() };
  fillThinGaps([w], escena(), { thinR: 8, maxDist: 80, sandwich: 20, maxAdd: 0.2 });
  assert.equal(w.mask[85 * GW + 100], 1, 'hueco 1 (entre listones) relleno');
  assert.equal(w.mask[114 * GW + 100], 1, 'hueco 2 (entre listones) relleno');
  assert.equal(w.mask[100 * GW + 72], 0, 'el poste de la silla sigue afuera');
  assert.equal(w.mask[100 * GW + 24], 0, 'el marco (fino, pegado al pasillo) NO se rellena');
  assert.equal(w.mask[40 * GW + 170], 0, 'un objeto grande del color de la pared NO se rellena');
});

test('relleno de huecos: una franja VERTICAL entre dos partes oscuras (marco/puerta) no se rellena, una chica tampoco', () => {
  const data = new Uint8ClampedArray(GW * GH * 4), m = new Uint8Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const oscuro = (x >= 60 && x < 150 && y >= 20 && y < 140) && !(x >= 100 && x < 108 && y >= 30 && y < 130) && !(x >= 125 && x < 135 && y >= 60 && y < 66);
    const v = oscuro ? 40 : 150, i = (y * GW + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    if (!(x >= 60 && x < 150 && y >= 20 && y < 140)) m[y * GW + x] = 1;
  }
  const w = { kind: 'pared', name: 'Pared', mask: m };
  fillThinGaps([w], { data, width: GW, height: GH }, { thinR: 8, maxDist: 80, sandwich: 20, maxAdd: 0.2 });
  assert.equal(w.mask[80 * GW + 104], 0, 'franja vertical (ancho/alto < 1): no es un hueco de silla');
  assert.equal(w.mask[63 * GW + 130], 0, 'hueco chico: no se rellena');
  fillThinGaps([w], { data, width: GW, height: GH }, { thinR: 8, maxDist: 80, sandwich: 20, maxAdd: 0.2, minAspect: 0 });
  assert.equal(w.mask[80 * GW + 104], 1, 'con minAspect = 0 la condición de forma se apaga (comportamiento anterior)');
});

test('relleno de huecos: sin objetos oscuros no toca nada', () => {
  const data = new Uint8ClampedArray(GW * GH * 4).fill(150);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const m = new Uint8Array(GW * GH).fill(1);
  const w = { kind: 'pared', name: 'Pared', mask: m.slice() };
  fillThinGaps([w], { data, width: GW, height: GH }, { thinR: 8 });
  assert.deepEqual([...w.mask], [...m]);
});

// --- esquina vertical suave (dos paredes que se juntan sin arista) ---
// Escena: pared desde la unión con el techo hasta el piso. `kink` hace que la unión con el techo cambie de dirección en x=150;
// `lum(x, y)` da la luminancia de cada píxel.
function wallScene({ kink, lum, topFlat = false }) {
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8Array(W * H);
  const topY = (x) => (topFlat ? 0 : kink ? (x < 150 ? 40 + 0.2 * x : 40 + 0.2 * 150 - 0.2 * (x - 150)) : 40 + 0.05 * x);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = Math.round(lum(x, y));
    px(data, x, y, v, v, v);
    if (y > topY(x) + 1 && y < H - 20) mask[y * W + x] = 1;
  }
  return { img: { data, width: W, height: H }, mask };
}
const esquina = (x) => (x < 150 ? 200 - 0.35 * (x - 60) : 200 - 0.35 * 90 + 12 + 0.15 * (x - 150)); // el degradé salta (+12) y cambia de pendiente en x=150

test('esquina vertical: salto de pendiente + la unión con el techo cambia de dirección → se divide', () => {
  const { img, mask } = wallScene({ kink: true, lum: esquina });
  const c = findVerticalCorner(mask, img);
  assert.ok(c, 'tendría que encontrar la esquina');
  assert.ok(Math.abs(c.x0 - 150) <= 4, `x0=${c.x0}`);
  const [a, b] = splitAtCorner(mask, W, H, c);
  const na = a.reduce((s, v) => s + v, 0), nb = b.reduce((s, v) => s + v, 0), nm = mask.reduce((s, v) => s + v, 0);
  assert.equal(na + nb, nm);
  assert.ok(na > 0 && nb > 0);
});

test('esquina vertical: un degradé de sombra liso sobre una pared no se divide', () => {
  const { img, mask } = wallScene({ kink: false, lum: (x) => 215 - 0.4 * x });
  assert.equal(findVerticalCorner(mask, img), null);
});

test('esquina vertical: una sombra proyectada (escalón recto) sin quiebre en el techo no se divide', () => {
  const { img, mask } = wallScene({ kink: false, lum: (x) => (x < 150 ? 205 : 160) });
  assert.equal(findVerticalCorner(mask, img), null);
});

test('esquina vertical: sin unión con el techo visible (pared contra el borde de arriba) no se arriesga', () => {
  const { img, mask } = wallScene({ kink: false, topFlat: true, lum: esquina });
  assert.equal(findVerticalCorner(mask, img), null);
});

test('esquina vertical: el quiebre del techo solo, sin cambio de luz, no alcanza', () => {
  const { img, mask } = wallScene({ kink: true, lum: () => 200 });
  assert.equal(findVerticalCorner(mask, img), null);
});

// ---- objetos que cuelgan o se apoyan en el contorno (foco, termotanque) ----
import { growIntoGaps, hangingSeeds } from '../src/index.js';

test('relleno de sombras: no se desliza de a poco hacia un objeto de otro color (tapa crema de un termotanque)', () => {
  const w = 120, h = 20, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = Math.max(0, x - 20); // desde x=20 el color vira de a poco hacia el crema, con luminancia casi constante
    const i = (y * w + x) * 4;
    data[i] = 150 + t * 0.5; data[i + 1] = 150 - t * 0.1; data[i + 2] = 150 - t * 0.4; data[i + 3] = 255;
  }
  const extent = (opts) => {
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 20; x++) mask[y * w + x] = 1;
    growIntoGaps([{ mask }], { data, width: w, height: h }, { maxGrow: 100, ...opts });
    let e = 0;
    for (let x = 0; x < w; x++) if (mask[10 * w + x]) e = x + 1;
    return e;
  };
  const sinLocal = extent({ localChroma: 0 }), conLocal = extent({});
  assert.ok(conLocal < sinLocal, `con el tope local llegó a ${conLocal}, sin él ${sinLocal}`);
  assert.ok(conLocal < 40, `se coló ${conLocal - 20} px dentro del objeto`);
});

test('refineEdges: un objeto más angosto que la banda no se lo come la pared si está fijado (locked)', () => {
  const w = 100, h = 40, G = new Float32Array(w * h).fill(0.3);
  const base = new Uint8Array(w * h).fill(1), locked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 47; x < 54; x++) { base[y * w + x] = 0; locked[y * w + x] = 1; } // objeto de 7 px; banda de 10
  const [libre] = refineEdges([{ mask: base.slice() }], G, w, h, { band: 10 });
  assert.equal(libre.mask[20 * w + 50], 1, 'sin fijar, la banda se lo come (el caso que se corrige)');
  const [fijo] = refineEdges([{ mask: base.slice() }], G, w, h, { band: 10, locked });
  assert.equal(fijo.mask[20 * w + 50], 0, 'fijado, el objeto queda afuera de la pared');
});

test('hangingSeeds: un foco colgado entre pared y techo da una semilla; una tira fina o un hueco enorme, ninguna', () => {
  const W2 = 192, H2 = 192;
  const surf = (hueco) => { const m = new Uint8Array(W2 * H2).fill(1); for (const [x0, y0, x1, y1] of hueco) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W2 + x] = 0; return [{ mask: m }]; };
  const foco = hangingSeeds(surf([[90, 60, 96, 74]]), W2, H2);
  assert.equal(foco.length, 1);
  assert.ok(foco[0].x >= 90 && foco[0].x < 96 && foco[0].y >= 60 && foco[0].y < 74, 'la semilla cae sobre el objeto');
  assert.equal(hangingSeeds(surf([[20, 100, 170, 101]]), W2, H2).length, 0, 'una tira de 1 px (la unión de dos superficies) no es un objeto');
  assert.equal(hangingSeeds(surf([[40, 40, 120, 120]]), W2, H2).length, 0, 'un hueco grande no es una muesca');
});

// ---- marco de ventanal (cutFramesBesideObjects) y franja de pared en sombra (addShadowStrips) ----
import { cutFramesBesideObjects, addShadowStrips } from '../src/index.js';
const FW = 600, FH = 800;
function lumaEscena(f) {
  const data = new Uint8ClampedArray(FW * FH * 4), lum = new Float32Array(FW * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const [r, g, b] = f(x, y), i = y * FW + x;
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return { img: { data, width: FW, height: FH }, G: gradientMap(lum, FW, FH) };
}
const mascara = (f) => { const m = new Uint8Array(FW * FH); for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (f(x, y)) m[y * FW + x] = 1; return m; };
const paisaje = (x, y) => ((x * 7 + y * 13) % 5 < 2 ? [60, 120, 200] : [200, 220, 240]);

test('marco de ventanal: la columna lisa entre el vidrio y una arista larga se saca de la pared', () => {
  // vidrio con paisaje (textura) x<100; marco gris liso 100..123; pared clara x>=124 con una arista fuerte en x=124
  const { G } = lumaEscena((x, y) => (x < 100 ? paisaje(x, y) : x < 124 ? [90, 92, 90] : [200, 202, 198]));
  const vidrio = mascara((x) => x < 100);
  const pared = { kind: 'pared', name: 'Pared', mask: mascara((x) => x >= 100) }; // SAM metió el marco en la pared
  const cortado = cutFramesBesideObjects([pared], [vidrio], G, FW, FH);
  assert.equal(pared.mask[400 * FW + 120], 0, 'el marco ya no es pared');
  assert.equal(cortado[400 * FW + 120], 1, 'y queda marcado para que nada lo vuelva a pintar');
  assert.equal(pared.mask[400 * FW + 200], 1, 'la pared de verdad no se toca');
  assert.equal(pared.mask[400 * FW + 130], 1, 'ni la pared pegada al marco');
});

test('marco de ventanal: si la pared llega al vidrio sin arista de por medio no se corta nada', () => {
  const { G } = lumaEscena((x, y) => (x < 100 ? paisaje(x, y) : [200, 202, 198]));
  const vidrio = mascara((x) => x < 100);
  const pared = { kind: 'pared', name: 'Pared', mask: mascara((x) => x >= 100) };
  const antes = pared.mask.slice();
  cutFramesBesideObjects([pared], [vidrio], G, FW, FH);
  assert.deepEqual([...pared.mask], [...antes]);
});

// Pared clara a la derecha (x>=300); a su izquierda una franja en sombra (x 286..299), una arista y un marco claro (x 270..285); después la puerta (cremosa).
const escenaFranja = (franja) => lumaEscena((x) => (x >= 300 ? [150, 152, 148] : x >= 286 ? franja : x >= 270 ? [200, 196, 180] : [170, 160, 130]));
const paredFranja = () => ({ kind: 'pared', name: 'Pared', mask: mascara((x) => x >= 300) });

test('franja en sombra: la tira neutra y más oscura pegada a la pared se suma; la puerta y el marco no', () => {
  const { img, G } = escenaFranja([112, 114, 110]);
  const w = paredFranja();
  const n = addShadowStrips([w], img, G, null);
  assert.equal(n, 1);
  assert.equal(w.mask[400 * FW + 292], 1, 'la franja se suma');
  assert.equal(w.mask[400 * FW + 276], 0, 'el marco no');
  assert.equal(w.mask[400 * FW + 200], 0, 'la puerta no');
});

test('franja en sombra: una tira más CLARA que la pared (marco iluminado, puerta blanca) no se suma', () => {
  const { img, G } = escenaFranja([200, 202, 198]);
  const w = paredFranja();
  assert.equal(addShadowStrips([w], img, G, null), 0);
  assert.equal(w.mask[400 * FW + 292], 0);
});

test('franja en sombra: una tira de otro color (cálida, como una puerta) no se suma', () => {
  const { img, G } = escenaFranja([125, 112, 90]);
  const w = paredFranja();
  assert.equal(addShadowStrips([w], img, G, null), 0);
});

test('franja en sombra: lo vetado (un objeto ya sacado de la pared) no se vuelve a sumar', () => {
  const { img, G } = escenaFranja([112, 114, 110]);
  const w = paredFranja();
  const veto = mascara((x) => x >= 286 && x < 300);
  assert.equal(addShadowStrips([w], img, G, veto), 0);
});

// ---- aceleración: las podas y las reescrituras no cambian lo que se detecta ----
test('gradientMap: el camino rápido del interior da lo mismo que la definición con bordes replicados', () => {
  const w = 23, h = 17, luma = new Float32Array(w * h);
  for (let i = 0; i < luma.length; i++) luma[i] = ((i * 2654435761) >>> 7) % 256;
  const at = (x, y) => luma[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    g[y * w + x] = Math.hypot(gx, gy);
  }
  const ref = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) acc += g[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
    ref[y * w + x] = acc / 9;
  }
  assert.deepEqual([...gradientMap(luma, w, h)], [...ref]);
});

test('detectSurfaces: con las podas pide menos decodificaciones y detecta lo mismo', async () => {
  const img = { data: room(), width: W, height: H };
  let con = 0, sin = 0;
  const a = await detectSurfaces(img, async (pts) => { con++; return fakeSegment(pts); });
  const b = await detectSurfaces(img, async (pts) => { sin++; return fakeSegment(pts); }, { patience: 0, partitionOpts: { skipPlain: false, skipNonWall: false, dedupe: false, edgeEarlyStop: false } });
  assert.ok(con < sin, `con podas ${con}, sin podas ${sin}`);
  assert.deepEqual(a.map((s) => [s.name, s.kind]), b.map((s) => [s.name, s.kind]));
  for (let k = 0; k < a.length; k++) assert.deepEqual([...a[k].mask], [...b[k].mask]);
});

test('partición: una pared pelada no gasta decodificaciones, pero un objeto adentro se sigue encontrando', async () => {
  // pared gris lisa de 100x100 con un objeto oscuro de 12x12 (centro en 66,56)
  const data = new Uint8ClampedArray(PW * PH * 4);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const o = x >= 60 && x < 72 && y >= 50 && y < 62, v = o ? 40 : 190, i = (y * PW + x) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  const luma = new Float32Array(PW * PH);
  for (let i = 0; i < luma.length; i++) luma[i] = data[i * 4];
  const G = gradientMap(luma, PW, PH);
  const todo = rectM(0, 0, 100, 100);
  const corrida = async (opts) => {
    let n = 0;
    const w = { kind: 'pared', name: 'Pared', area: 1, luma: 190, mask: todo.slice() };
    const r = await partitionBySmallest([w], async ([p]) => { n++; return hasPt(objeto, p) ? objeto : todo; }, PW, PH, { grid: 10, frac: 0.3, minArea: 0.05, G, img: { data, width: PW, height: PH }, edgeBudget: 0, ...opts });
    return { n, w, r };
  };
  const sin = await corrida({ skipPlain: false, dedupe: false });
  const con = await corrida({});
  assert.ok(con.n < sin.n, `con podas ${con.n}, sin podas ${sin.n}`);
  assert.equal(con.w.mask[56 * PW + 66], 0, 'el objeto se sacó de la pared');
  assert.deepEqual([...con.w.mask], [...sin.w.mask]);
});

// --- cielo, vidrio y luz de ventana (veto de techo/pared que en realidad es luz o paisaje) ---
const roomWith = (techoRgb, paredFn) => {
  const data = room();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y < H * 0.2) { const c = techoRgb(x, y); px(data, x, y, c[0], c[1], c[2]); }
    else if (paredFn && !(x > 90 && x < 150 && y > H * 0.4 && y < H * 0.85)) { const c = paredFn(x, y); px(data, x, y, c[0], c[1], c[2]); }
  }
  return { data, width: W, height: H };
};
const nombres = (l) => l.map((s) => s.name);

test('cielo: un "techo" azul sobre la pared no se acepta; la pared sí', async () => {
  const l = await detectSurfaces(roomWith(() => [120, 170, 235]), async (pts) => fakeSegment(pts));
  assert.ok(!l.some((s) => s.kind === 'techo'), nombres(l).join());
  assert.ok(l.some((s) => s.kind === 'pared'));
  assert.ok(l.rechazadas.some((r) => r.why === 'cielo azul'));
  const sin = await detectSurfaces(roomWith(() => [120, 170, 235]), async (pts) => fakeSegment(pts), { sky: false });
  assert.ok(sin.some((s) => s.kind === 'techo'), 'con sky:false se comporta como antes');
});

test('luz quemada: una "pared" casi toda en 255 (ventana, cielo blanco) no se pinta', async () => {
  const l = await detectSurfaces(roomWith(() => [235, 235, 235], () => [255, 255, 255]), async (pts) => fakeSegment(pts));
  assert.ok(!l.some((s) => s.kind === 'pared'), nombres(l).join());
  assert.ok(l.rechazadas.some((r) => r.why === 'quemado'));
});

test('techo con textura (persiana, paisaje) no se acepta', async () => {
  const l = await detectSurfaces(roomWith((x) => (Math.floor(x / 3) % 2 ? [235, 235, 235] : [110, 110, 110])), async (pts) => fakeSegment(pts));
  assert.ok(!l.some((s) => s.kind === 'techo'), nombres(l).join());
});

test('techo oscuro (madera, hueco): no se acepta; con techoMinLuma:0 se comporta como antes', async () => {
  const l = await detectSurfaces(roomWith(() => [45, 35, 30]), async (pts) => fakeSegment(pts));
  assert.ok(!l.some((s) => s.kind === 'techo'), nombres(l).join());
  assert.ok(l.rechazadas.some((r) => r.why === 'techo oscuro'));
  assert.ok(l.some((s) => s.kind === 'pared'), 'la pared sigue');
  const sin = await detectSurfaces(roomWith(() => [45, 35, 30]), async (pts) => fakeSegment(pts), { techoMinLuma: 0 });
  assert.ok(sin.some((s) => s.kind === 'techo'));
  const claro = await detectSurfaces(roomWith(() => [150, 140, 130]), async (pts) => fakeSegment(pts));
  assert.ok(claro.some((s) => s.kind === 'techo'), 'un techo de luma ~140 se mantiene');
});

test('techoRelax: un techo oscuro con pared debajo se acepta (apagado: no); demasiado oscuro, no', async () => {
  const seg = async (pts) => fakeSegment(pts);
  const l = await detectSurfaces(roomWith(() => [60, 52, 48]), seg, { techoRelax: {} });
  assert.ok(l.some((s) => s.kind === 'techo'), nombres(l).join());
  const apagado = await detectSurfaces(roomWith(() => [60, 52, 48]), seg);
  assert.ok(!apagado.some((s) => s.kind === 'techo'));
  const negro = await detectSurfaces(roomWith(() => [20, 18, 16]), seg, { techoRelax: {} });
  assert.ok(!negro.some((s) => s.kind === 'techo'), 'casi negro sigue siendo hueco');
});

test('techoRelax: un techo con textura moderada se acepta, una persiana de alto contraste no', async () => {
  const seg = async (pts) => fakeSegment(pts);
  const ligero = (x) => (Math.floor(x / 6) % 2 ? [150, 150, 150] : [136, 136, 136]); // vigas de poco contraste

  const rel = await detectSurfaces(roomWith(ligero), seg, { techoRelax: {} });
  assert.ok(rel.some((s) => s.kind === 'techo'), 'con techoRelax: ' + nombres(rel).join());
  const persiana = await detectSurfaces(roomWith((x) => (Math.floor(x / 3) % 2 ? [235, 235, 235] : [110, 110, 110])), seg, { techoRelax: {} });
  assert.ok(!persiana.some((s) => s.kind === 'techo'), nombres(persiana).join());
});

test('classifySurface con techoAlto: trapecio que baja hasta la mitad es techo; un rectángulo apoyado arriba sigue siendo pared', () => {
  const trap = { area: 0.2, cy: 0.2, top: 0, bottom: 0.55, left: 0, right: 1, touchesTop: true, touchesBottom: false };
  assert.equal(classifySurface(trap), 'pared');
  assert.equal(classifySurface(trap, { techoAlto: true }), 'techo');
  const rect = { area: 0.3, cy: 0.28, top: 0, bottom: 0.56, left: 0, right: 1, touchesTop: true, touchesBottom: false };
  assert.equal(classifySurface(rect, { techoAlto: true }), 'pared');
});

test('techo claro sin pared debajo (cielo, luz) se descarta; con pared debajo se mantiene', async () => {
  const sinPared = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (y < H * 0.2) px(sinPared.data, x, y, 235, 235, 235); else px(sinPared.data, x, y, 30 + ((x * 37 + y * 11) % 90), 40 + ((x * 13 + y * 29) % 80), 20 + ((x * 7 + y * 3) % 100)); }
  const l = await detectSurfaces(sinPared, async (pts) => fakeSegment(pts), { lineGrid: false }); // el fondo es ruido puro: sin grilla de juntas; aísla la regla del techo
  assert.ok(!l.some((s) => s.kind === 'techo'), nombres(l).join());
  assert.ok(l.rechazadas.some((r) => r.why === 'techo sin pared'));
  const con = await detectSurfaces({ data: room(), width: W, height: H }, async (pts) => fakeSegment(pts));
  assert.ok(con.some((s) => s.kind === 'techo'));
});

test('ceilingWallContact y colorStats', () => {
  const techo = new Uint8Array(W * H), pared = new Uint8Array(W * H), lejos = new Uint8Array(W * H);
  for (let y = 0; y < 60; y++) for (let x = 0; x < W; x++) techo[y * W + x] = 1;
  for (let y = 61; y < 200; y++) for (let x = 0; x < W; x++) pared[y * W + x] = 1;
  for (let y = 150; y < 200; y++) for (let x = 0; x < W; x++) lejos[y * W + x] = 1;
  assert.ok(ceilingWallContact(techo, [pared], W, H) > 0.95);
  assert.equal(ceilingWallContact(techo, [lejos], W, H), 0);
  assert.equal(ceilingWallContact(techo, [], W, H), 0);
  const img = { data: new Uint8ClampedArray(W * H * 4).fill(255), width: W, height: H };
  const st = colorStats(techo, img);
  assert.equal(st.hot, 1);
  assert.equal(st.chroma, 0);
});

// --- vetos de objetos: superficie horizontal (tapa de escritorio), pared casi negra, objeto cerrado dentro de la pared ---
function bandaInferior(v) { // arriba ruido (fondo con textura), desde 34 % hasta abajo una zona lisa de luz v que llega a TODO el borde inferior
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y < H * 0.34 ? ((x * 7 + y * 13) % 2 ? 250 : 10) : v; px(data, x, y, k, k, k); }
  const segment = async () => { const m = new Uint8Array(W * H); for (let y = Math.ceil(H * 0.34); y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = 1; return m; };
  return { img: { data, width: W, height: H }, segment };
}

test('tapa de escritorio: una zona lisa que llena todo el borde inferior y tiene su masa abajo no es pared (tableVeto)', async () => {
  const { img, segment } = bandaInferior(200);
  assert.equal((await detectSurfaces(img, segment, { tableVeto: false })).filter((s) => s.kind === 'pared').length, 1, 'sin el veto se pinta (control)');
  assert.equal((await detectSurfaces(img, segment)).filter((s) => s.kind === 'pared').length, 0);
});

test('pared casi negra (hueco de puerta, marco oscuro): no se pinta (minWallLuma)', async () => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y < 40 ? ((x * 7 + y * 13) % 2 ? 250 : 10) : 8; px(data, x, y, k, k, k); } // franja con textura arriba, lo demás casi negro
  const segment = async () => { const m = new Uint8Array(W * H); for (let y = 40; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = 1; return m; };
  assert.equal((await detectSurfaces({ data, width: W, height: H }, segment, { minWallLuma: 0, tableVeto: false })).filter((s) => s.kind === 'pared').length, 1, 'control');
  assert.equal((await detectSurfaces({ data, width: W, height: H }, segment, { tableVeto: false })).filter((s) => s.kind === 'pared').length, 0);
});

test('objeto cerrado por un lazo de aristas dentro de la pared (cuadro): se saca; una mancha del mismo color no', () => {
  const data = new Uint8ClampedArray(W * H * 4), G = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(data, x, y, 200, 200, 200);
  const cuadro = (x, y) => x >= 80 && x < 120 && y >= 100 && y < 140, mancha = (x, y) => x >= 160 && x < 200 && y >= 100 && y < 140;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cuadro(x, y)) { px(data, x, y, 90, 120, 160); if (!cuadro(x - 4, y) || !cuadro(x + 4, y) || !cuadro(x, y - 4) || !cuadro(x, y + 4)) G[y * W + x] = 20; } // contorno de aristas
    else if (mancha(x, y) && (!mancha(x - 4, y) || !mancha(x + 4, y) || !mancha(x, y - 4) || !mancha(x, y + 4))) G[y * W + x] = 20; // lazo sin cambio de color
  }
  const w = { kind: 'pared', name: 'Pared', mask: new Uint8Array(W * H).fill(1) };
  const cut = cutEnclosedObjects([w], { data, width: W, height: H }, G);
  assert.equal(w.mask[120 * W + 100], 0, 'el cuadro sale');
  assert.equal(cut[120 * W + 100], 1);
  assert.equal(w.mask[120 * W + 180], 1, 'la mancha del color de la pared se queda');
  assert.equal(w.mask[20 * W + 20], 1, 'la pared se queda');
});

// ---- marcos y zócalos más claros que la pared (trimBrightBands) y tiras angostas (dropThinStrips) ----
import { trimBrightBands, dropThinStrips } from '../src/index.js';

test('trimBrightBands: el marco blanco entre dos paredes se saca y la pared con degradé no', () => {
  // pared gris con degradé suave de 175 a 190; marco blanco (240) de 24 px en x 280..303 (largo: toda la altura)
  const { img } = lumaEscena((x) => { const v = x >= 280 && x < 304 ? 240 : 175 + (x / FW) * 15; return [v, v, v]; });
  const pared = { kind: 'pared', name: 'Pared', mask: mascara(() => true) };
  const cortado = trimBrightBands([pared], img);
  assert.equal(pared.mask[400 * FW + 290], 0, 'el marco ya no es pared');
  assert.equal(cortado[400 * FW + 290], 1, 'y queda vetado');
  assert.equal(pared.mask[400 * FW + 100], 1, 'la pared no se toca');
  assert.equal(pared.mask[400 * FW + 500], 1, 'la pared con degradé tampoco');
});

test('trimBrightBands: una pared sola, lisa y con degradé, no se toca', () => {
  const { img } = lumaEscena((x, y) => { const v = 170 + (x / FW) * 25 + (y / FH) * 10; return [v, v, v]; });
  const pared = { kind: 'pared', name: 'Pared', mask: mascara(() => true) };
  const cortado = trimBrightBands([pared], img);
  assert.ok(!cortado.some((v) => v));
  assert.equal(pared.mask[100 * FW + 100], 1);
});

test('dropThinStrips: la tira angosta y larga deja de ser pared; una pared ancha no', () => {
  const fina = { kind: 'pared', name: 'Pared 1', mask: mascara((x) => x >= 100 && x < 125) };
  const ancha = { kind: 'pared', name: 'Pared 2', mask: mascara((x) => x >= 300 && x < 500) };
  const regiones = [fina, ancha];
  const cortado = dropThinStrips(regiones, FW, FH, { maxArea: 0.5 });
  assert.deepEqual(regiones, [ancha]);
  assert.equal(cortado[400 * FW + 110], 1);
  assert.equal(cortado[400 * FW + 400], 0);
});

// paredRescate (agente B): la máscara grande de SAM une la pared lisa con un objeto muy texturado y se rechaza por textura; con otra pared chica
// ya aceptada, el rescate por color no corría. Con la opción, sí: recupera la parte lisa de la máscara.
test('paredRescate: rescata la pared de una máscara rechazada por textura aunque haya otra pared aceptada', async () => {
  const data = new Uint8ClampedArray(W * H * 4);
  const inA = (x, y) => x < 40 && y >= 40, inObj = (x, y) => x >= 150 && y >= 40, inTop = (x, y) => y < 40;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (inTop(x, y)) px(data, x, y, 230, 230, 230);
    else if (inA(x, y)) px(data, x, y, 200, 190, 170);
    else if (inObj(x, y)) { const v = (x + y) % 6 < 3 ? 40 : 190; px(data, x, y, v, v, v); } // objeto rugoso
    else px(data, x, y, 150, 150, 160); // pared grande lisa
  }
  const region = (x, y) => (inTop(x, y) ? 0 : inA(x, y) ? 1 : 2);
  const seg = async (pts) => { const r = region(pts[0].x, pts[0].y), m = new Uint8Array(W * H); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (region(i, j) === r) m[j * W + i] = 1; return m; };
  const img = { data, width: W, height: H };
  const area = (l) => l.filter((s) => s.kind === 'pared').reduce((a, s) => a + s.area, 0);
  const sin = await detectSurfaces(img, seg), con = await detectSurfaces(img, seg, { paredRescate: true });
  assert.ok(area(con) >= area(sin), 'la opción nunca quita pared');
  // la parte lisa de la pared grande (x 40..150) aparece solo con la opción
  const lisa = (l) => l.some((s) => s.kind === 'pared' && s.mask[200 * W + 100]);
  assert.equal(lisa(con), true);
  assert.equal(con.some((s) => s.kind === 'pared' && s.mask[200 * W + 200]), false, 'el objeto rugoso no es pared');
});

// lineGrid: el veto por líneas (azulejo) solo corresponde a una grilla de juntas (líneas en las dos orientaciones). Una pared con una moldura o un
// riel de silla (dos líneas horizontales) no es azulejo.
import { hayGrilla } from '../src/index.js';

test('hayGrilla: horizontales solas no son grilla; horizontales y verticales sí; muchísimas líneas también', () => {
  assert.equal(hayGrilla({ rows: 2, cols: 0 }), false);
  assert.equal(hayGrilla({ rows: 1, cols: 1 }), false);
  assert.equal(hayGrilla({ rows: 3, cols: 2 }), true);
  assert.equal(hayGrilla({ rows: 9, cols: 0 }), true);
  assert.equal(hayGrilla(undefined), false);
});

test('lineRatio devuelve en stats la cantidad de líneas largas por orientación', () => {
  const w = 100, h = 100, mask = new Uint8Array(w * h).fill(1), G = new Float32Array(w * h);
  for (let x = 0; x < w; x++) { G[30 * w + x] = 40; G[70 * w + x] = 40; }
  const st = {};
  lineRatio(mask, G, w, h, 10, 5, { stats: st });
  assert.deepEqual(st, { rows: 2, cols: 0 });
  for (let y = 0; y < h; y++) G[y * w + 50] = 40;
  const st2 = {};
  lineRatio(mask, G, w, h, 10, 5, { stats: st2 });
  assert.deepEqual(st2, { rows: 2, cols: 1 });
});

test('lineGrid: una pared con dos molduras horizontales se acepta con la opción y se rechaza sin ella', async () => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (y < 40) px(data, x, y, 235, 235, 235);
    else if (y >= 150 && y < 154) px(data, x, y, 60, 60, 60); // moldura 1
    else if (y >= 280 && y < 284) px(data, x, y, 60, 60, 60); // moldura 2
    else px(data, x, y, 160, 150, 140);
  }
  const seg = async (pts) => { const top = pts[0].y < 40, m = new Uint8Array(W * H); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if ((j < 40) === top) m[j * W + i] = 1; return m; };
  const img = { data, width: W, height: H };
  const pared = (l) => l.filter((s) => s.kind === 'pared').reduce((a, s) => a + s.area, 0);
  const base = { splitMax: 99, partition: false, hang: false }; // sin dividir la máscara en las molduras ni repartir semillas
  const sin = await detectSurfaces(img, seg, { ...base, lineGrid: false }), con = await detectSurfaces(img, seg, { ...base, lineGrid: true });
  assert.ok(pared(con) > 0.3 && pared(sin) < 0.1, `con lineGrid ${pared(con).toFixed(2)}, sin ${pared(sin).toFixed(2)}`);
  assert.ok(pared(sin) < pared(con), 'sin la opción el veto por líneas la saca');
});

import { lineGridGuarda } from '../src/index.js';

test('lineGridGuarda: lo oscuro, lo chico y lo que cuelga arriba conservan el veto por líneas', () => {
  const ok = { luma: 120 }, g = { area: 0.2, cy: 0.45 };
  assert.equal(lineGridGuarda(ok, g), false);
  assert.equal(lineGridGuarda({ luma: 30 }, g), true); // hueco oscuro
  assert.equal(lineGridGuarda(ok, { area: 0.05, cy: 0.45 }), true); // chico
  assert.equal(lineGridGuarda(ok, { area: 0.2, cy: 0.15 }), true); // cielorraso
  assert.equal(lineGridGuarda(ok, { area: 0.06, cy: 0.45 }, { minArea: 0.05 }), false); // se puede aflojar
});
