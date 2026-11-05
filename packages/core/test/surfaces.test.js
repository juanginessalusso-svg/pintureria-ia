import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSurfaces, classifySurface, maskGeometry, textureRatio, distanceTransform, findVerticalCorner, splitAtCorner } from '../src/index.js';

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
