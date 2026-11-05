// Política de balance de blancos: ¿se excluyen las superficies a pintar al estimar la luz?
// Ver docs/FIDELIDAD-COLOR.md ("Política de exclusión"). No cambia estimateWhiteBalance ni recolorWall: solo decide
// con qué opciones llamar a estimateWhiteBalance.
import { rgbToLab } from './color.js';
import { estimateWhiteBalance, unionMasks } from './recolor.js';

/** Umbrales por defecto de "la pared ya tiene color": distancia (a*,b*) pared-resto >= threshold Y croma de la pared >= minChroma. Ver docs. */
export const WB_EXCLUDE_DEFAULTS = { threshold: 15, minChroma: 15, minWallFrac: 0.03, dilate: 4 };

/** Dilata una máscara binaria `r` píxeles (cuadrado, separable). El borde de la máscara es impreciso: conviene excluir un poco de más. */
export function dilateMask(m, width, height, r) {
  if (r <= 0) return m;
  const tmp = new Uint8Array(m.length), out = new Uint8Array(m.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) if (m[row + x]) for (let i = Math.max(0, x - r); i <= Math.min(width - 1, x + r); i++) tmp[row + i] = 1;
  }
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) if (tmp[y * width + x]) for (let j = Math.max(0, y - r); j <= Math.min(height - 1, y + r); j++) out[j * width + x] = 1;
  return out;
}

/**
 * Color (a*, b*) medio de la pared y del resto de la foto, ignorando píxeles quemados/oscuros (mismo criterio que el balance).
 * `wall`: máscara binaria de las superficies a pintar. Devuelve null si alguna de las dos partes tiene muy pocos píxeles.
 */
export function wallVsRestChroma(img, wall, { minWallFrac = WB_EXCLUDE_DEFAULTS.minWallFrac, dilate = WB_EXCLUDE_DEFAULTS.dilate } = {}) {
  const { data, width, height } = img;
  const grown = dilateMask(wall, width, height, dilate);
  const step = Math.max(1, Math.floor((data.length / 4) / 40000));
  const acc = { w: [0, 0, 0, 0], r: [0, 0, 0, 0] }; // a, b, n (+ libre)
  for (let p = 0; p < data.length; p += 4 * step) {
    const R = data[p], G = data[p + 1], B = data[p + 2];
    const mx = Math.max(R, G, B);
    if (mx > 240 || mx < 25) continue;
    const i = p >> 2;
    if (wall[i]) { /* pared (sin dilatar) */ } else if (grown[i]) continue; // franja de borde: ni pared ni resto
    const t = wall[i] ? acc.w : acc.r;
    const lab = rgbToLab([R, G, B]);
    t[0] += lab.a; t[1] += lab.b; t[2]++;
  }
  const total = acc.w[2] + acc.r[2];
  if (acc.w[2] < 100 || acc.w[2] / total < minWallFrac) return null;
  const wa = acc.w[0] / acc.w[2], wb = acc.w[1] / acc.w[2];
  // La pared ocupa (casi) toda la foto: no hay "resto" con qué compararla -> solo cuenta su croma (dist = Infinity).
  if (acc.r[2] < 100) return { wall: { a: wa, b: wb, C: Math.hypot(wa, wb) }, rest: null, dist: Infinity, wallFrac: 1 };
  const ra = acc.r[0] / acc.r[2], rb = acc.r[1] / acc.r[2];
  return { wall: { a: wa, b: wb, C: Math.hypot(wa, wb) }, rest: { a: ra, b: rb, C: Math.hypot(ra, rb) }, dist: Math.hypot(wa - ra, wb - rb), wallFrac: acc.w[2] / total };
}

/**
 * Ganancias de balance de blancos con política de exclusión.
 * - Sin máscaras (o sin superficies detectadas): igual que `estimateWhiteBalance(img)` (todo lo que había antes).
 * - Con máscaras: si la pared se separa del resto de la foto en más de `threshold` (plano a*b*), se la considera
 *   "pared ya de color" y se la excluye al estimar la luz; si no, se estima sobre toda la foto como antes.
 * Devuelve { gains, excluded, stats } (stats = wallVsRestChroma, para diagnóstico/UI).
 */
export function whiteBalanceFor(img, masks, opts = {}) {
  const { threshold = WB_EXCLUDE_DEFAULTS.threshold, minChroma = WB_EXCLUDE_DEFAULTS.minChroma, minWallFrac = WB_EXCLUDE_DEFAULTS.minWallFrac, dilate = WB_EXCLUDE_DEFAULTS.dilate, ...wbOpts } = opts;
  const size = img.width * img.height;
  const wall = masks?.length ? unionMasks(masks, size) : null;
  const stats = masks?.length ? wallVsRestChroma(img, wall, { minWallFrac, dilate }) : null;
  if (!stats || stats.dist < threshold || stats.wall.C < minChroma) return { gains: estimateWhiteBalance(img, wbOpts), excluded: false, stats };
  const exclude = dilateMask(wall, img.width, img.height, dilate);
  return { gains: estimateWhiteBalance(img, { ...wbOpts, exclude }), excluded: true, stats };
}
