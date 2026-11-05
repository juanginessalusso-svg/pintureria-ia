// Fidelidad de color del recoloreo: ¿el color MEDIO de la pared pintada se parece al color de la carta?
// Sin modelos ni navegador: usa paredes sintéticas y las máscaras de eval/visualizador/verdad/*.json (+ 2 rectángulos a mano en o01).
//
// Uso (desde la raíz del repo):
//   TERSUAVE_JSON=ruta/colores-tersuave.json node eval/visualizador/color-eval.mjs [--n 60] [--ancho 400] [--json salida.json] [--sin-reales]
//   Opciones: --opts '{"wallStats":"p50"}'  → opciones extra de recolorWall (para comparar mejoras con flag)
//
// Mide, para cada pared x color x modo x balance de blancos (intensidad 1):  ΔE00( color de la carta , color medio del resultado ).
// Ver docs/FIDELIDAD-COLOR.md para la metodología y los supuestos (sRGB, D65, medias en LAB, etc.).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { decodeMask, deltaE00, estimateWhiteBalance, hexToLab, recolorWall, whiteBalanceFor, wallVsRestChroma, unionMasks } from '@pintureria/core';
import { workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, def) => { const i = process.argv.indexOf(k); return i < 0 ? def : (process.argv[i + 1] ?? true); };
const N_COLORES = Number(arg('--n', 60));
const ANCHO = Number(arg('--ancho', 400));
const EXTRA = arg('--opts', null) ? JSON.parse(arg('--opts')) : {};
const SOLO_SINT = process.argv.includes('--sin-reales');
const DETECTADAS = arg('--detectadas', null); // carpeta con las máscaras de auto.mjs (DUMP_MASKS): suma las paredes que detecta la app
const POL = {}; // umbrales de la política (default: los de whitebalance.js)
if (arg('--umbral', null)) POL.threshold = Number(arg('--umbral'));
if (arg('--croma', null)) POL.minChroma = Number(arg('--croma'));
const cartaPath = process.env.TERSUAVE_JSON;
if (!cartaPath) { console.error('Falta TERSUAVE_JSON=ruta/a/colores-tersuave.json (carta pública, no se versiona)'); process.exit(2); }
const cartaJson = JSON.parse(fs.readFileSync(cartaPath, 'utf8'));
const carta = Array.isArray(cartaJson) ? cartaJson : cartaJson.colors ?? cartaJson.colores;

// ---------- sRGB -> LAB rápido (para promediar miles de píxeles) ----------
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
const EPS = 216 / 24389, KAP = 24389 / 27;
const fw = (t) => (t > EPS ? Math.cbrt(t) : (KAP * t + 16) / 116);
function pixLab(d, p) {
  const r = LIN[d[p]], g = LIN[d[p + 1]], b = LIN[d[p + 2]];
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = fw(X), fy = fw(Y), fz = fw(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz), Y };
}

function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t * t * t > EPS ? t * t * t : (116 * t - 16) / KAP);
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  const lin = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
  return lin.map((v) => { v = Math.min(1, Math.max(0, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); });
}

// ---------- paredes ----------
function boxDown(raw, f) {
  const w = Math.floor(raw.width / f), h = Math.floor(raw.height / f), data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += raw.data[((y * f + j) * raw.width + x * f + i) * 4 + c];
    data[(y * w + x) * 4 + c] = Math.round(s / (f * f));
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: w, height: h };
}
function maskDown(m, W, H, f) {
  const w = Math.floor(W / f), h = Math.floor(H / f), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += m[(y * f + j) * W + x * f + i] ? 1 : 0;
    out[y * w + x] = s / (f * f) > 0.5 ? 1 : 0;
  }
  return out;
}
/** Erosiona la máscara r píxeles (cuadrado): se evalúa el interior, sin el borde donde la máscara "borrador" puede ser imprecisa. */
function erode(m, w, h, r) {
  const out = new Float32Array(m.length);
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    let ok = 1;
    for (let j = -r; j <= r && ok; j++) for (let i = -r; i <= r; i++) if (!m[(y + j) * w + x + i]) { ok = 0; break; }
    out[y * w + x] = ok;
  }
  return out;
}

/** Dilata la máscara r píxeles (cuadrado). Para `exclude` conviene pasar la pared un poco agrandada (el borde de la máscara es impreciso). */
function dilate(m, w, h, r) {
  const out = new Float32Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) out[j * w + i] = 1;
  return out;
}

const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
/** Pared sintética: 160x120, pared a la izquierda (x<110) y "resto del ambiente" gris neutro a la derecha. fnPared(x,y)->[r,g,b]. */
function sintetica(id, fnPared, { soloPared = false } = {}) {
  const W = 160, H = 120, data = new Uint8ClampedArray(W * H * 4), mask = new Float32Array(W * H), rnd = rng(7);
  const pared = soloPared ? W : 110;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, ruido = (rnd() - 0.5) * 4;
    const [r, g, b] = x < pared ? fnPared(x, y) : [60 + (x * 7 + y * 3) % 170, 60 + (x * 7 + y * 3) % 170, 60 + (x * 7 + y * 3) % 170];
    data[p] = r + ruido; data[p + 1] = g + ruido; data[p + 2] = b + ruido; data[p + 3] = 255;
    if (x < pared && x > 2 && y > 2 && y < H - 3 && x < pared - 3) mask[y * W + x] = 1;
  }
  return { id, origen: 'sintética', img: { data, width: W, height: H }, mask };
}
const grisY = (v) => () => [v, v, v];
function paredesSinteticas() {
  return [
    sintetica('sint-neutra-clara (L≈72)', grisY(176)),
    sintetica('sint-neutra-media (L≈55)', grisY(130)),
    sintetica('sint-sombra (L≈35)', grisY(84)),
    sintetica('sint-calida (L≈66, b≈+17)', () => [190, 168, 136]),
    sintetica('sint-degrade (L 85→35, lado a lado)', (x) => { const v = Math.round(222 - (x / 110) * 138); return [v, v, v]; }),
    sintetica('sint-verde (L≈66) + resto neutro', () => [150, 175, 140]),
    sintetica('sint-azul (L≈62) + resto neutro', () => [128, 150, 178]),
    sintetica('sint-verde sola (todo el cuadro)', () => [150, 175, 140], { soloPared: true }),
  ];
}
function paredesReales() {
  const out = [];
  const cargar = (foto) => { const raw = jpeg.decode(fs.readFileSync(path.join(here, 'fotos', foto)), { useTArray: true, formatAsRGBA: true }); const f = Math.max(1, Math.round(raw.width / ANCHO)); return { raw, f, img: boxDown(raw, f) }; };
  const verdad = [['r1-living-estante', 'Pared izquierda'], ['r2-ventanal-tv', 'Pared izquierda'], ['r2-ventanal-tv', 'Pared derecha'], ['r3-puerta', 'Pared'], ['r4-pasillo', 'Pared izquierda'],
    ['s1', 'Pared'], ['s2', 'Pared izquierda'], ['s3', 'Pared izquierda'], ['s3', 'Pared derecha'], ['t4', 'Pared izquierda'], ['t4', 'Pared derecha'], ['t5', 'Pared izquierda']];
  const fotos = {};
  for (const [base, nombre] of verdad) {
    const t = JSON.parse(fs.readFileSync(path.join(here, 'verdad', `${base}.json`), 'utf8'));
    const s = t.superficies.find((x) => x.nombre === nombre);
    const c = (fotos[t.foto] ??= cargar(t.foto));
    const full = decodeMask(s.rle, c.raw.width * c.raw.height);
    const m = erode(maskDown(full, c.raw.width, c.raw.height, c.f), c.img.width, c.img.height, 2);
    out.push({ id: `${base} · ${nombre}`, origen: `real (máscara ${t.estado})`, img: c.img, mask: m });
  }
  // Pared REAL pero teñida (mismas luces, sombras y resto de la foto): simula repintar una pared que ya tiene color. La luz real de la foto no cambió.
  {
    const t = JSON.parse(fs.readFileSync(path.join(here, 'verdad', 'r1-living-estante.json'), 'utf8')), s = t.superficies.find((x) => x.nombre === 'Pared izquierda');
    const c = fotos[t.foto];
    const m = erode(maskDown(decodeMask(s.rle, c.raw.width * c.raw.height), c.raw.width, c.raw.height, c.f), c.img.width, c.img.height, 2);
    for (const [nombre, da, db] of [['verde', -22, 18], ['azul', -4, -24]]) {
      const data = new Uint8ClampedArray(c.img.data);
      for (let i = 0; i < m.length; i++) if (m[i]) {
        const l = pixLab(data, i * 4);
        const [r, g, b] = labToRgb(l.L, l.a + da, l.b + db);
        data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b;
      }
      out.push({ id: `r1 · pared izquierda teñida de ${nombre}`, origen: 'real + teñido sintético', img: { ...c.img, data }, mask: m });
    }
  }
  // o01 no tiene máscara anotada: rectángulos a mano dentro de la pared (coordenadas en la foto de 960x720)
  const o = cargar('o01-cuarto-ventana.jpg');
  const rect = (x0, y0, x1, y1) => { const m = new Float32Array(o.img.width * o.img.height); for (let y = Math.round(y0 / o.f); y < y1 / o.f; y++) for (let x = Math.round(x0 / o.f); x < x1 / o.f; x++) m[y * o.img.width + x] = 1; return m; };
  out.push({ id: 'o01 · pared izquierda (rect)', origen: 'real (rectángulo a mano)', img: o.img, mask: rect(60, 230, 480, 500) });
  out.push({ id: 'o01 · pared derecha en sombra (rect)', origen: 'real (rectángulo a mano)', img: o.img, mask: rect(660, 110, 900, 600) });
  return out;
}

/** Remuestreo bilineal (igual que auto.mjs) al tamaño de trabajo de la app. */
function resizeBilineal(src, w, h, nw, nh) {
  if (w === nw && h === nh) return src;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, ((y + 0.5) * h) / nh - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, ((x + 0.5) * w) / nw - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
      for (let c = 0; c < 4; c++) {
        const a = src[(y0 * w + x0) * 4 + c], b = src[(y0 * w + x1) * 4 + c], d = src[(y1 * w + x0) * 4 + c], e = src[(y1 * w + x1) * 4 + c];
        out[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}
/** Paredes que detecta la app (máscaras volcadas por auto.mjs con DUMP_MASKS), a tamaño de trabajo reducido a ~ANCHO px. `todas` = unión de todas las superficies de la foto (lo que recibe la política en la app). */
function paredesDetectadas(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!d.superficies?.length) continue;
    const raw = jpeg.decode(fs.readFileSync(path.join(here, 'fotos', d.foto)), { useTArray: true, formatAsRGBA: true });
    const { width, height } = workingSize(raw.width, raw.height);
    const full = { data: resizeBilineal(raw.data, raw.width, raw.height, width, height), width, height };
    const ms = d.superficies.map((s) => ({ ...s, mask: Float32Array.from(decodeMask(s.rle, width * height)) }));
        for (const s of ms) {
      if (s.tipo === 'techo') continue; // se mide solo el color de las paredes
      const m = erode(s.mask, width, height, 2);
      out.push({ id: `auto ${f.replace(".json", "")} · ${s.nombre}`, origen: 'detectada por la app', img: full, mask: m, todas: ms.filter((x) => x.tipo !== 'techo').map((x) => x.mask), foto: f });
    }
  }
  return out;
}

/** Tipo de pared, por regla sobre las estadísticas de la pared original (L medio, b medio, ancho p5-p95 de L). */
function clasificar(w) {
  const { img, mask } = w, Ls = []; let b = 0, n = 0;
  const step = Math.max(1, Math.floor(mask.length / 6000));
  for (let i = 0; i < mask.length; i += step) if (mask[i] > 0.5) { const l = pixLab(img.data, i * 4); Ls.push(l.L); b += l.b; n++; }
  Ls.sort((x, y) => x - y);
  const med = Ls[Math.floor(n / 2)], spread = Ls[Math.floor(n * 0.95)] - Ls[Math.floor(n * 0.05)], bm = b / n;
  w.stats = { medL: med, spread, b: bm, n };
  if (/sola|\+ resto neutro|teñida/.test(w.id)) return 'de color (verde/azul)';
  if (w.origen === 'detectada por la app') return 'detectada por la app';
  if (spread >= 30) return 'degradé fuerte';
  if (med < 55) return 'en sombra';
  if (bm >= 10) return 'cálida';
  return 'bien expuesta';
}

// ---------- muestra de colores ----------
function muestra(n) {
  const cs = carta.map((c) => ({ ...c, lab: hexToLab(c.hex) })).map((c) => ({ ...c, C: Math.hypot(c.lab.a, c.lab.b) }));
  const fam = {}; for (const c of cs) (fam[c.family] ??= []).push(c);
  const pick = new Map();
  for (const f of Object.keys(fam).sort()) {
    const a = fam[f].sort((x, y) => x.lab.L - y.lab.L || x.code - y.code);
    for (const q of [0.04, 0.34, 0.66, 0.96]) pick.set(a[Math.min(a.length - 1, Math.round(q * (a.length - 1)))].code, a[Math.min(a.length - 1, Math.round(q * (a.length - 1)))]);
  }
  const porL = [...cs].sort((x, y) => x.lab.L - y.lab.L), porC = [...cs].sort((x, y) => y.C - x.C);
  for (const c of [porL[0], porL[1], porL[porL.length - 1], porL[porL.length - 2], ...porC.slice(0, 6)]) pick.set(c.code, c);
  for (const c of porC) { if (pick.size >= n) break; pick.set(c.code, c); }
  return [...pick.values()].slice(0, n);
}

// ---------- medición ----------
function medir(w, color, opts, gains) {
  const { img, mask } = w;
  const res = recolorWall(img, mask, color.hex, { ...opts, gains, ...EXTRA }).image;
  const step = Math.max(1, Math.floor(mask.length / 5000));
  let n = 0, L = 0, a = 0, b = 0;
  const Ls = [], Lorig = [], Yo = [];
  for (let i = 0; i < mask.length; i += step) if (mask[i] > 0.5) {
    const l = pixLab(res.data, i * 4), o = pixLab(img.data, i * 4);
    n++; L += l.L; a += l.a; b += l.b; Ls.push(l.L); Yo.push(o.Y);
  }
  const mean = { L: L / n, a: a / n, b: b / n };
  const target = color.lab ?? hexToLab(color.hex);
  // "Ideal" físico: la pintura nueva con la misma luz -> Y_nuevo = Y_color * (Y_pix / Y_medio_pared). Su dispersión de L es la referencia de "sombra bien conservada".
  const Ym = Yo.reduce((s, v) => s + v, 0) / n, Yt = ((target.L + 16) / 116) ** 3; // aprox. válida para L>8
  const Lideal = Yo.map((y) => { const Y = Math.min(1, Yt * (y / Ym)); return 116 * fw(Y) - 16; });
  const sd = (v) => { const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length); };
  const Cm = Math.hypot(mean.a, mean.b), Ct = Math.hypot(target.a, target.b);
  let dh = Math.atan2(mean.b, mean.a) - Math.atan2(target.b, target.a); dh = Math.abs(((dh + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI;
  return { dE: deltaE00(target, mean), dL: mean.L - target.L, dC: Cm - Ct, dh: Ct > 3 ? dh : 0, meanL: mean.L, sdRatio: sd(Ls) / Math.max(0.01, sd(Lideal)), mean };
}

const q = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const f1 = (v) => v.toFixed(1).padStart(6);

const paredes = [...paredesSinteticas(), ...(SOLO_SINT ? [] : paredesReales()), ...(DETECTADAS ? paredesDetectadas(DETECTADAS) : [])];
for (const w of paredes) w.tipo = clasificar(w);
const colores = muestra(N_COLORES);
console.log(`Paredes: ${paredes.length} · colores de la carta: ${colores.length} (de ${carta.length}) · ancho de trabajo ${ANCHO}px`);
for (const w of paredes) console.log(`  [${w.tipo.padEnd(22)}] ${w.id.padEnd(42)} ${w.origen.padEnd(28)} L̃=${w.stats.medL.toFixed(0)} spread(p5-p95)=${w.stats.spread.toFixed(0)} b̄=${w.stats.b.toFixed(1)}`);

// Balance de blancos: 'no' = sin corrección · 'foto' = gray-world sobre toda la foto (lo que hace la app hoy) · 'sin pared' = gray-world ignorando la pared a pintar (opción `exclude`)
const CONFIGS = [['relative', 'no'], ['relative', 'foto'], ['relative', 'sin pared'], ['relative', 'política'], ['pure', 'no'], ['pure', 'foto']];
const grupoColor = (c) => (c.lab.L >= 88 ? 'muy clara (L*≥88)' : c.lab.L <= 30 ? 'muy oscura (L*≤30)' : c.C >= 55 ? 'muy saturada (C*≥55)' : 'media');
const filas = []; // una por pared x color x config
for (const w of paredes) {
  const gains = { no: [1, 1, 1], foto: estimateWhiteBalance(w.img), 'sin pared': estimateWhiteBalance(w.img, { exclude: dilate(w.mask, w.img.width, w.img.height, 4) }) };
  // 'política': lo que hace la app con whiteBalanceFor sobre las superficies de la foto (en las sintéticas/verdad, la pared medida)
  const pol = whiteBalanceFor(w.img, w.todas ?? [w.mask], POL);
  gains['política'] = pol.gains; w.pol = pol;
  w.gains = { foto: gains.foto.map((v) => +v.toFixed(2)), 'sin pared': gains['sin pared'].map((v) => +v.toFixed(2)) };
  for (const c of colores) for (const [mode, wb] of CONFIGS) {
    const r = medir(w, c, { mode, intensity: 1 }, gains[wb]);
    filas.push({ pared: w.id, tipo: w.tipo, code: c.code, name: c.name, family: c.family, hex: c.hex, targetL: c.lab.L, grupo: grupoColor(c), mode, wb, ...r });
  }
}

const tipos = [...new Set(paredes.map((w) => w.tipo))];
const cab = '  med    p90    máx   |ΔL| med  sdL/ideal';
const linea = (sel) => `${f1(q(sel.map((x) => x.dE), 0.5))} ${f1(q(sel.map((x) => x.dE), 0.9))} ${f1(Math.max(...sel.map((x) => x.dE)))}   ${f1(q(sel.map((x) => Math.abs(x.dL)), 0.5))}   ${q(sel.map((x) => x.sdRatio), 0.5).toFixed(2)}`;
console.log('\n== Ganancias de balance de blancos estimadas (R,G,B) por pared ==');
for (const w of paredes) console.log(`  ${w.id.padEnd(46)} foto=${w.gains.foto.join('/')}  sin pared=${w.gains['sin pared'].join('/')}`);
console.log('\n== ΔE00 (color de la carta vs. color medio del resultado): mediana / p90 / máx por tipo de pared x modo x balance ==');
console.log('tipo de pared'.padEnd(24), 'modo'.padEnd(9), 'WB'.padEnd(10), cab);
for (const t of [...tipos, 'TODAS']) for (const [mode, wb] of CONFIGS) {
  const sel = filas.filter((x) => (t === 'TODAS' || x.tipo === t) && x.mode === mode && x.wb === wb);
  if (sel.length) console.log(t.padEnd(24), mode.padEnd(9), wb.padEnd(10), linea(sel));
}
console.log("\n== Por grupo de color (modo 'relative'), todas las paredes ==");
console.log('grupo de color'.padEnd(24), 'WB'.padEnd(10), cab);
for (const g of ['muy clara (L*≥88)', 'media', 'muy saturada (C*≥55)', 'muy oscura (L*≤30)']) for (const wb of ['no', 'foto']) {
  const sel = filas.filter((x) => x.grupo === g && x.mode === 'relative' && x.wb === wb);
  if (sel.length) console.log(g.padEnd(24), wb.padEnd(10), linea(sel));
}
console.log("\n== Por grupo de color x tipo de pared (modo 'relative', sin balance) ==");
for (const t of tipos) for (const g of ['muy clara (L*≥88)', 'media', 'muy saturada (C*≥55)', 'muy oscura (L*≤30)']) {
  const sel = filas.filter((x) => x.tipo === t && x.grupo === g && x.mode === 'relative' && x.wb === 'no');
  if (sel.length) console.log(`${t.padEnd(24)} ${g.padEnd(22)}`, linea(sel));
}
console.log("\n== Por pared (modo 'relative'): ΔE00 mediana / p90 ==");
for (const w of paredes) console.log(`  ${w.id.padEnd(46)} ` + ['no', 'foto', 'sin pared', 'política'].map((wb) => { const sel = filas.filter((x) => x.pared === w.id && x.mode === 'relative' && x.wb === wb); return `${wb}: ${q(sel.map((x) => x.dE), 0.5).toFixed(1)}/${q(sel.map((x) => x.dE), 0.9).toFixed(1)}`; }).join('   '));

// Colores problemáticos: modo 'relative' sin WB, paredes bien expuestas + cálidas (donde el modelo debería funcionar), peor mediana
console.log("\n== Colores con peor ΔE00 en 'relative' sin balance, sobre paredes bien expuestas y cálidas (mediana entre paredes) ==");
const porColor = new Map();
for (const x of filas.filter((x) => x.mode === 'relative' && x.wb === 'no' && (x.tipo === 'bien expuesta' || x.tipo === 'cálida'))) { const k = x.code; (porColor.get(k) ?? porColor.set(k, []).get(k)).push(x); }
const rank = [...porColor.values()].map((a) => ({ c: a[0], dE: q(a.map((x) => x.dE), 0.5), dL: q(a.map((x) => x.dL), 0.5), dC: q(a.map((x) => x.dC), 0.5), dh: q(a.map((x) => x.dh), 0.5) })).sort((a, b) => b.dE - a.dE);
console.log('código  nombre'.padEnd(36), 'familia'.padEnd(10), 'hex      L*     ΔE    ΔL    ΔC    Δh°');
for (const r of rank.slice(0, 20)) console.log(`${r.c.code.padStart(6)}  ${r.c.name.padEnd(26)} ${r.c.family.padEnd(10)} ${r.c.hex} ${r.c.targetL.toFixed(0).padStart(3)} ${f1(r.dE)}${f1(r.dL)}${f1(r.dC)}${f1(r.dh)}`);

console.log("\n== Política: distancia (a*,b*) pared vs. resto, decisión y ΔE00 mediano (relative) con balance sobre toda la foto / sin pared / política ==");
for (const w of paredes) {
  const med = (wb) => q(filas.filter((x) => x.pared === w.id && x.mode === 'relative' && x.wb === wb).map((x) => x.dE), 0.5);
  const st = w.pol.stats;
  console.log(`  ${w.id.padEnd(46)} dist=${st ? (st.dist===Infinity?99:st.dist).toFixed(1).padStart(5) : '  n/a'} Cpared=${st ? st.wall.C.toFixed(1).padStart(5) : '  n/a'} ${w.pol.excluded ? 'EXCLUYE ' : 'incluye '} foto=${med('foto').toFixed(1).padStart(5)} sinPared=${med('sin pared').toFixed(1).padStart(5)} política=${med('política').toFixed(1).padStart(5)}  ${med('sin pared') - med('foto') > 0.5 ? '<- exclusión EMPEORA' : med('sin pared') - med('foto') < -0.5 ? '<- exclusión mejora' : ''}`);
}
const jsonOut = arg('--json', null);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify({ paredes: paredes.map((w) => ({ id: w.id, tipo: w.tipo, origen: w.origen, stats: w.stats })), colores: colores.map((c) => ({ code: c.code, name: c.name, family: c.family, hex: c.hex })), filas }, null, 1)); console.log(`\nResultados completos en ${jsonOut}`); }
