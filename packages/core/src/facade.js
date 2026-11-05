// Detección de FACHADAS (exteriores): cielo, piso, paños lisos, ladrillo y aberturas.
//
// Por qué un detector aparte: el de interiores (surfaces.js) arranca de una zona lisa y le pide a SAM una máscara; en una fachada SAM devuelve
// TODO el frente de la casa (paños, ladrillo, portón, ventanas) y el filtro de textura lo descarta: 0 superficies en las fachadas medidas.
// Acá se usa una grilla de semillas y "la máscara más chica que contiene al píxel gana" (como `partitionBySmallest`): SAM separa muy bien
// cielo, franja superior, ladrillo, puertas, ventanas y piso; lo que queda fusionado (cielo + franja oscura; pared + portón blanco) se
// separa después por COLOR. Puro: `segment` lo inyecta quien llama (SAM en el Worker; un segmentador de mentira en los tests).
import { downscaleLuma, gradientMap } from './surfaces.js';
import { cleanMask } from './recolor.js';

// sRGB -> lineal (tabla) y LAB rápido (D65) para muestrear color por píxel sin Math.pow.
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
const fwd = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
export function pixelLab(r, g, b, out = [0, 0, 0]) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const fx = fwd((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), fy = fwd(0.2126729 * R + 0.7151522 * G + 0.072175 * B), fz = fwd((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
  return out;
}

/**
 * Regiones por grilla de semillas. `segment(pts)` -> Promise<Uint8Array|{mask}> (máscara 0/1 a resolución de la foto).
 * Devuelve { width, height, labels: Int16Array (id de la máscara más chica que contiene al píxel, -1 si ninguna), seeds: [{k, x, y, frac}] }.
 */
export async function facadeRegions(img, segment, { nx = 6, ny = 4, minMask = 0.003, onProgress = () => {}, isCancelled = () => false } = {}) {
  const { width, height } = img, N = width * height;
  const area = new Uint32Array(N).fill(0xffffffff), labels = new Int16Array(N).fill(-1), seeds = [];
  let k = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (isCancelled()) throw new Error('cancelado');
    onProgress(k);
    const x = ((i + 0.5) / nx) * width, y = ((j + 0.5) / ny) * height;
    const r = await segment([{ x, y, label: 1 }]);
    const mask = r.mask ?? r;
    let a = 0;
    for (let q = 0; q < N; q++) if (mask[q]) a++;
    seeds.push({ k, x: +(x / width).toFixed(3), y: +(y / height).toFixed(3), frac: +(a / N).toFixed(4) });
    if (a / N >= minMask) for (let q = 0; q < N; q++) if (mask[q] && a < area[q]) { area[q] = a; labels[q] = k; }
    k++;
  }
  return { width, height, labels, seeds };
}

const HB = 256; // histograma para medianas: L 0..100, a/b -128..127 (1 unidad por casilla)
const medianOf = (h, n, off = 0) => { let acc = 0; for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc >= n / 2) return i + off; } return off; };

/**
 * Estadísticas por región: área, posición, bordes tocados, color mediano (LAB), "azulez" (B−R), luma y textura (fracción de píxeles con gradiente alto,
 * misma escala que `textureRatio` de surfaces.js) y `grad50` (mediana del gradiente de luma a resolución completa, solo píxeles interiores). Devuelve [{k, frac, cx, cy, top, bottom, left, right, touchesTop, touchesBottom, L, a, b, chroma, blue, luma, texture, n}].
 */
export function regionStats(regions, img, { texThr = 10.5, stride = 2 } = {}) {
  const { width, height, labels } = regions, { data } = img;
  const { luma: lowLuma, w, h } = downscaleLuma(img);
  const grad = gradientMap(lowLuma, w, h);
  const K = regions.seeds.length;
  const acc = Array.from({ length: K }, () => ({ n: 0, sx: 0, sy: 0, x0: width, x1: -1, y0: height, y1: -1, hL: new Uint32Array(HB), ha: new Uint32Array(HB), hb: new Uint32Array(HB), hg: new Uint32Array(HB), sb: 0, sl: 0, tex: 0 }));
  const lab = [0, 0, 0];
  const lum = new Float32Array(width * height); // luma a resolución completa: el gradiente fino separa ladrillo/revoque rústico (p50 > 12) de paño liso (p50 < 10)
  for (let q = 0; q < lum.length; q++) lum[q] = 0.2126 * data[q * 4] + 0.7152 * data[q * 4 + 1] + 0.0722 * data[q * 4 + 2];
  for (let y = 0; y < height; y += stride) {
    const gy = Math.min(h - 1, Math.floor((y * h) / height));
    for (let x = 0; x < width; x += stride) {
      const q = y * width + x, id = labels[q];
      if (id < 0) continue;
      const s = acc[id], p = q * 4, r = data[p], g = data[p + 1], b = data[p + 2];
      s.n++; s.sx += x; s.sy += y;
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
      pixelLab(r, g, b, lab);
      s.hL[Math.max(0, Math.min(HB - 1, Math.round(lab[0] * 2.55)))]++; // L en 0..255 para más resolución
      s.ha[Math.max(0, Math.min(HB - 1, Math.round(lab[1]) + 128))]++;
      s.hb[Math.max(0, Math.min(HB - 1, Math.round(lab[2]) + 128))]++;
      s.sb += (b - r) / 255; s.sl += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (x >= 2 && y >= 2 && x < width - 2 && y < height - 2 && labels[q - 2] === id && labels[q + 2] === id && labels[q - 2 * width] === id && labels[q + 2 * width] === id) {
        s.hg[Math.min(HB - 1, Math.round(Math.hypot(lum[q + 1] - lum[q - 1], lum[q + width] - lum[q - width])))]++; s.ng = (s.ng ?? 0) + 1;
      }
      if (grad[gy * w + Math.min(w - 1, Math.floor((x * w) / width))] > texThr) s.tex++;
    }
  }
  const total = Math.ceil(width / stride) * Math.ceil(height / stride);
  return acc.map((s, k) => {
    if (!s.n) return { k, n: 0, frac: 0 };
    const L = medianOf(s.hL, s.n) / 2.55, a = medianOf(s.ha, s.n, -128), b = medianOf(s.hb, s.n, -128);
    return {
      k, n: s.n, frac: s.n / total, cx: s.sx / s.n / width, cy: s.sy / s.n / height,
      top: s.y0 / height, bottom: (s.y1 + stride) / height, left: s.x0 / width, right: (s.x1 + stride) / width,
      touchesTop: s.y0 <= height * 0.01, touchesBottom: s.y1 >= height * 0.985, touchesLeft: s.x0 <= width * 0.01, touchesRight: s.x1 >= width * 0.985,
      L, a, b, chroma: Math.hypot(a, b), blue: s.sb / s.n, luma: s.sl / s.n, texture: s.tex / s.n,
      grad50: s.ng ? medianOf(s.hg, s.ng) : 99,
    };
  });
}

/**
 * Rol de cada región según sus estadísticas (umbrales calibrados con 6 fachadas reales; ver eval/visualizador/fachada.mjs).
 * Devuelve [{k, role: 'cielo'|'piso'|'abertura'|'pared'|'ladrillo'|'chica', ...stats}].
 * 'ladrillo' = superficie rugosa (ladrillo, piedra, revoque muy rústico o muy sucio): se propone SIN color por defecto.
 */
export function classifyFacade(stats, { minFrac = 0.02, smooth = 3.5, rough = 12 } = {}) {
  const regs = stats.filter((s) => s.n);
  const roleOf = (s) => {
    if (s.frac < minFrac) return 'chica';
    if (s.touchesTop && s.cy < 0.45 && s.grad50 < smooth) return 'cielo';
    if (s.cy > 0.72 && s.bottom > 0.9) return 'piso';
    if (s.grad50 >= rough) return 'ladrillo';
    return 'pared';
  };
  const out = regs.map((s) => ({ ...s, role: roleOf(s) }));
  // Portón/puerta/ventana blanca y lisa que SAM separó: queda adentro de la caja de otra superficie más grande.
  for (const s of out) {
    if (s.role !== 'pared' || s.grad50 >= smooth || s.L < 78 || s.chroma > 8 || s.touchesTop) continue;
    if (out.some((o) => o !== s && (o.role === 'pared' || o.role === 'ladrillo') && o.frac > s.frac && s.top >= o.top - 0.01 && s.left >= o.left - 0.01 && s.right <= o.right + 0.01)) s.role = 'abertura';
  }
  return out;
}

const dE = (L, a, b, m) => Math.hypot(L - m.L, a - m.a, b - m.b);

/**
 * Saca de la máscara de una región las zonas de color muy distinto al de la región (ventanas con reja, puertas, medidores) que SAM dejó adentro:
 * un píxel es "hueco" si en su entorno (ventana de radio r) la mayoría es atípico (ΔE al color mediano > T).
 */
export function carveOutliers(img, mask, median, { T = 16, density = 0.4 } = {}) {
  const { data, width, height } = img, N = width * height, r = Math.max(3, Math.round(width / 150));
  const out = new Uint8Array(N), lab = [0, 0, 0], W1 = width + 1;
  const I = new Int32Array(W1 * (height + 1)); // imagen integral de atípicos
  const bad = new Uint8Array(N);
  for (let q = 0; q < N; q++) if (mask[q]) { pixelLab(data[q * 4], data[q * 4 + 1], data[q * 4 + 2], lab); if (dE(lab[0], lab[1], lab[2], median) > T) bad[q] = 1; }
  for (let y = 0; y < height; y++) { let row = 0; for (let x = 0; x < width; x++) { row += bad[y * width + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const q = y * width + x;
      if (!mask[q]) continue;
      const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1);
      const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      out[q] = sum < density * (x1 - x0) * (y1 - y0) ? 1 : 0;
    }
  }
  return out;
}

/**
 * Detección automática de fachadas. Misma forma de salida que `detectSurfaces`: [{ kind: 'pared'|'ladrillo', name, mask, area, cx, cy, texture, luma }]
 * con `.rechazadas` = [{ name, motivo, area }] (cielo, piso, aberturas). `segment(pts)` igual que en detectSurfaces.
 */
export async function detectFacade(img, segment, opts = {}) {
  const regions = await facadeRegions(img, segment, opts);
  return facadeSurfaces(img, regions, opts);
}

/** Segunda mitad de `detectFacade` (separada para poder cachear las regiones en la evaluación). */
export function facadeSurfaces(img, regions, { carve = true } = {}) {
  const { width, height, labels } = regions, N = width * height;
  const roles = classifyFacade(regionStats(regions, img));
  const found = [], rejected = [];
  const sorted = roles.filter((r) => r.role !== 'chica').sort((a, b) => b.frac - a.frac);
  const count = { pared: 0, ladrillo: 0 };
  for (const r of sorted) {
    if (r.role !== 'pared' && r.role !== 'ladrillo') { rejected.push({ name: { cielo: 'Cielo', piso: 'Piso', abertura: 'Abertura' }[r.role], motivo: r.role, area: r.frac }); continue; }
    let mask = new Uint8Array(N);
    for (let q = 0; q < N; q++) if (labels[q] === r.k) mask[q] = 1;
    if (carve) mask = carveOutliers(img, mask, r, r.role === 'ladrillo' ? { T: 32, density: 0.5 } : {});
    mask = cleanMask(mask, width, height);
    let a = 0; for (let q = 0; q < N; q++) if (mask[q]) a++;
    if (a / N < 0.01) { rejected.push({ name: 'Región', motivo: 'quedó chica tras sacar aberturas', area: a / N }); continue; }
    count[r.role]++;
    found.push({ kind: r.role, role: r.role, mask, area: a / N, cx: r.cx, cy: r.cy, top: r.top, texture: r.texture, luma: r.luma, grad50: r.grad50 });
  }
  const totals = { pared: found.filter((f) => f.kind === 'pared').length, ladrillo: found.filter((f) => f.kind === 'ladrillo').length };
  const seen = { pared: 0, ladrillo: 0 };
  for (const f of found) {
    seen[f.kind]++;
    f.name = f.kind === 'ladrillo' ? (totals.ladrillo > 1 ? `Ladrillo / rugoso ${seen.ladrillo}` : 'Ladrillo / rugoso')
      : f.cy < 0.3 && totals.pared > 1 ? 'Franja superior' : (totals.pared > 1 ? `Pared ${seen.pared}` : 'Pared');
  }
  found.rechazadas = rejected;
  return found;
}
