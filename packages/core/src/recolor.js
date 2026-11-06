// Recoloreo determinístico de paredes en espacio LAB. Sin IA generativa, sin dependencias.
// Trabaja sobre {data: Uint8ClampedArray RGBA, width, height} y una máscara Float32Array (0..1).
import { hexToLab } from './color.js';

// ---- tablas para no llamar a Math.pow por píxel ----
const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
const LIN_STEPS = 4096;
const LIN_TO_SRGB = new Uint8ClampedArray(LIN_STEPS + 1);
for (let i = 0; i <= LIN_STEPS; i++) {
  const v = i / LIN_STEPS;
  LIN_TO_SRGB[i] = Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
}
const toSrgb8 = (lin) => LIN_TO_SRGB[Math.min(LIN_STEPS, Math.max(0, Math.round(lin * LIN_STEPS)))];

const XN = 0.95047, ZN = 1.08883;
const EPS = 216 / 24389, KAPPA = 24389 / 27;
const fwd = (t) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const inv = (t) => { const t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAPPA; };

/** Lineal (r,g,b en 0..1) -> LAB. Escribe en out[0..2]. */
function linToLab(r, g, b, out) {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN;
  const fx = fwd(x), fy = fwd(y), fz = fwd(z);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
}
/** LAB -> lineal sin recortar (puede salir de gamut). */
function labToLin(L, a, b, out) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const x = inv(fx) * XN, y = inv(fy), z = inv(fz) * ZN;
  out[0] = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  out[1] = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  out[2] = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
}

// ---------------------------------------------------------------------------
// Balance de blancos (gray-world robusto)
// ---------------------------------------------------------------------------

/**
 * Estima ganancias [gR,gG,gB] que neutralizan la dominante de color de la foto.
 * Ignora píxeles muy oscuros o quemados (no informan el color de la luz) y limita la
 * corrección (maxGain) para no "arreglar" de más una habitación legítimamente cálida.
 * `exclude` (opcional, Float32Array/Uint8Array del tamaño de la imagen): píxeles a ignorar, p. ej. la pared que se va a repintar.
 * Sin esto, una pared ya pintada de verde se lee como "luz verdosa" y el color nuevo sale con dominante verde.
 */
export function estimateWhiteBalance(img, { maxGain = 1.35, strength = 1, exclude = null } = {}) {
  const { data } = img;
  let r = 0, g = 0, b = 0, n = 0;
  // submuestreo: con ~40k píxeles alcanza para estimar la media
  const step = Math.max(1, Math.floor((data.length / 4) / 40000));
  for (let p = 0; p < data.length; p += 4 * step) {
    if (exclude && exclude[p >> 2] > 0.5) continue; // `exclude`: máscara de la pared a pintar; su color propio no informa la luz
    const R = data[p], G = data[p + 1], B = data[p + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mx > 240 || mx < 25 || (mx - mn) > 120) continue; // quemado / oscuro / muy saturado
    r += SRGB_TO_LIN[R]; g += SRGB_TO_LIN[G]; b += SRGB_TO_LIN[B]; n++;
  }
  if (n < 100) return [1, 1, 1];
  const avg = (r + g + b) / 3 / n;
  const clamp = (x) => Math.min(maxGain, Math.max(1 / maxGain, x));
  const gain = (c) => 1 + (clamp(avg / (c / n)) - 1) * strength;
  return [gain(r), gain(g), gain(b)];
}

// ---------------------------------------------------------------------------
// Máscara
// ---------------------------------------------------------------------------

/** Suaviza el borde de una máscara binaria con un box-blur separable (radio en píxeles). */
export function featherMask(mask, width, height, radius = 2) {
  if (radius <= 0) return mask;
  const tmp = new Float32Array(mask.length), out = new Float32Array(mask.length);
  const win = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += mask[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = acc / win;
      acc += mask[row + Math.min(width - 1, x + radius + 1)] - mask[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = acc / win;
      acc += tmp[Math.min(height - 1, y + radius + 1) * width + x] - tmp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

/**
 * Elimina "islas" sueltas de la máscara binaria (Uint8Array 0/1) más chicas que `minPixels` (conectividad 4).
 * SAM a veces deja puntitos aislados en bordes de bajo contraste (ej. unión pared/cielorraso).
 * NO rellena huecos: un tomacorriente o una moldura sin pintar dentro de la pared es correcto.
 */
export function removeSmallIslands(mask, width, height, minPixels) {
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(mask.length);
  if (queueScratch.length < mask.length) queueScratch = new Int32Array(mask.length); // se reutiliza entre llamadas (son ~5 MB en una foto de 1600 px)
  const queue = queueScratch;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++], x = i % width;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
      if (x < width - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
      if (i >= width && mask[i - width] && !seen[i - width]) { seen[i - width] = 1; queue[tail++] = i - width; }
      if (i < mask.length - width && mask[i + width] && !seen[i + width]) { seen[i + width] = 1; queue[tail++] = i + width; }
    }
    if (tail < minPixels) for (let k = 0; k < tail; k++) out[queue[k]] = 0;
  }
  return out;
}
let queueScratch = new Int32Array(0);

/**
 * Erosión (erode=true) o dilatación de una máscara 0/1 con kernel cuadrado (2r+1), separable. Borde = se replica.
 * Ventana deslizante en las dos pasadas; la vertical avanza por filas (con sumas por columna) para recorrer la memoria en orden.
 */
function morph(mask, width, height, r, erode) {
  const win = 2 * r + 1, N = mask.length, tmp = new Uint8Array(N), out = new Uint8Array(N);
  const thr = erode ? win : 1; // erosión: toda la ventana encendida; dilatación: alguna encendida
  const last = width - 1;
  for (let y = 0; y < height; y++) { // horizontal
    const row = y * width;
    let s = 0;
    for (let k = -r; k <= r; k++) s += mask[row + (k < 0 ? 0 : k > last ? last : k)];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = s >= thr ? 1 : 0;
      s += mask[row + (x + r + 1 > last ? last : x + r + 1)] - mask[row + (x - r < 0 ? 0 : x - r)];
    }
  }
  const cs = new Int32Array(width); // vertical: suma de la ventana en cada columna
  for (let k = -r; k <= r; k++) { const row = Math.min(height - 1, Math.max(0, k)) * width; for (let x = 0; x < width; x++) cs[x] += tmp[row + x]; }
  for (let y = 0; y < height; y++) {
    const row = y * width, add = Math.min(height - 1, y + r + 1) * width, sub = Math.max(0, y - r) * width;
    for (let x = 0; x < width; x++) { const c = cs[x]; out[row + x] = c >= thr ? 1 : 0; cs[x] = c + tmp[add + x] - tmp[sub + x]; }
  }
  return out;
}

/** Apertura: erosión + dilatación. Corta puentes y filamentos finos (< 2r+1 px) sin cambiar el resto del borde. */
export const openMask = (mask, width, height, r) => morph(morph(mask, width, height, r, true), width, height, r, false);

/**
 * Post-proceso estándar de una máscara de SAM: apertura (corta hilos finos) + sacar islas chicas.
 * Se usa igual en la app y en el script de evaluación.
 */
export function cleanMask(mask, width, height) {
  const r = Math.max(1, Math.round(width / 400));
  return removeSmallIslands(openMask(mask, width, height, r), width, height, Math.round(width * height * 0.0005));
}

/** Fracción (0..1) de la imagen cubierta por la máscara. */
export function maskFraction(mask) {
  let s = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0.5) s++;
  return s / mask.length;
}

/** Une varias máscaras (máximo por píxel). */
export function unionMasks(masks, size) {
  const out = new Float32Array(size);
  for (const m of masks) for (let i = 0; i < size; i++) if (m[i] > out[i]) out[i] = m[i];
  return out;
}

// ---------------------------------------------------------------------------
// Recoloreo
// ---------------------------------------------------------------------------

function wallStats(img, mask, gains) {
  // Luminancia media de la pared (en espacio ya balanceado), recortando 5% de extremos
  // para que brillos especulares y sombras muy duras no arrastren la media.
  const { data } = img;
  const hist = new Uint32Array(101);
  const lab = [0, 0, 0];
  let n = 0;
  const step = Math.max(1, Math.floor(mask.length / 60000));
  for (let i = 0; i < mask.length; i += step) {
    if (mask[i] <= 0.5) continue;
    const p = i * 4;
    linToLab(Math.min(1, SRGB_TO_LIN[data[p]] * gains[0]), Math.min(1, SRGB_TO_LIN[data[p + 1]] * gains[1]),
      Math.min(1, SRGB_TO_LIN[data[p + 2]] * gains[2]), lab);
    hist[Math.max(0, Math.min(100, Math.round(lab[0])))]++;
    n++;
  }
  if (!n) return { meanL: 50, p98L: 50, n: 0, hist, pct: () => 50 };
  let p98 = 100, c98 = 0;
  for (let l = 0; l <= 100; l++) { c98 += hist[l]; if (c98 >= n * 0.98) { p98 = l; break; } } // el 2 % más claro de la pared
  let lo = Math.floor(n * 0.05), hi = Math.ceil(n * 0.95), acc = 0, sum = 0, cnt = 0;
  for (let l = 0; l <= 100; l++) {
    const inRange = Math.max(0, Math.min(acc + hist[l], hi) - Math.max(acc, lo));
    sum += l * inRange; cnt += inRange; acc += hist[l];
  }
  // percentil q (0..1) de L de la pared, con interpolación lineal dentro del casillero del histograma
  const pct = (q) => {
    const target = q * n;
    let c = 0;
    for (let l = 0; l <= 100; l++) {
      if (c + hist[l] >= target && hist[l] > 0) return l - 0.5 + (target - c) / hist[l];
      c += hist[l];
    }
    return 100;
  };
  return { meanL: cnt ? sum / cnt : 50, p98L: p98, n, hist, pct };
}

/** Percentil de L de la pared usado como referencia de luz en el modo 'luz' (ver recolorWall). */
export const LUZ_REF_PCT = 0.8;
/** Fuerza del balance de blancos recomendada junto al modo 'luz' (estimateWhiteBalance(img, { strength })). Ver docs/FIDELIDAD-COLOR.md. */
export const LUZ_WB_STRENGTH = 0.5;

/**
 * Pinta la pared con `targetHex`.
 *  - mode 'luz'      : como 'relative' pero la referencia es el percentil `refPct` de L de la pared (en vez de la media) y sin piso.
 *  - mode 'pure'     : conserva L de cada píxel; solo reemplaza a/b por los del color elegido.
 *  - mode 'relative' : escala L por (L_color / L_media_pared): conserva las luces y sombras RELATIVAS pero
 *                      los colores oscuros se ven oscuros y los claros claros (L puro los lava).
 *  - gains           : balance de blancos. La pared se neutraliza, se recolorea y se vuelve a aplicar la
 *                      dominante de la foto, así la pintura nueva respeta la luz del ambiente.
 *  - intensity       : 0..1, mezcla entre original y resultado.
 * Devuelve una imagen nueva (no modifica la de entrada) y estadísticas.
 */
export function recolorWall(img, mask, targetHex, { mode = 'relative', gains = [1, 1, 1], intensity = 1, minWallL = 45, maxL = 98, refPct = LUZ_REF_PCT, refY = null } = {}) {
  const { data, width, height } = img;
  if (mask.length !== width * height) throw new Error('la máscara no coincide con el tamaño de la imagen');
  const target = hexToLab(targetHex);
  const { meanL, p98L, pct } = wallStats(img, mask, gains);
  // Cociente de luminancia. Dos salvaguardas para fotos con poca luz o paredes en sombra:
  //  - piso `minWallL`: una pared en sombra (L medio muy bajo) no se trata como si ese fuera su tono real; sin piso el cociente se
  //    dispara (L 22 -> 63 = ×2,9) y amplifica el ruido y los degradados de luz;
  //  - tope `maxL`: lo más claro de la pared no pasa de L≈98 (un blanco sobre un techo en sombra no debe quemarse).
  // En paredes bien expuestas ninguna de las dos actúa y el resultado es el de siempre.
  let ratio = 1;
  let yRef = 1, yCap = 1;
  if (mode === 'luz') {
    // Modo 'luz': sombreado MULTIPLICATIVO EN LUZ LINEAL. La pintura nueva en cada punto recibe la misma luz que la vieja:
    // XYZ_nuevo = XYZ_carta x (Y_píxel / Y_ref), con Y_ref = la parte bien iluminada de la pared (percentil `refPct`, no la media).
    //  - Con la media, una pared mayormente en sombra se "levanta" a la luminosidad de la carta; con el percentil la sombra queda en sombra.
    //  - Escalar XYZ (y no L*) baja también el croma de a*/b* en la sombra, como pasa con una pintura real a la sombra.
    //  - Sin piso `minWallL` (el piso era lo que levantaba la sombra). Tope `maxL`: lo más claro (p98) de la pared no pasa de L = maxL.
    yRef = inv((pct(refPct) + 16) / 116);
    if (refY != null) yRef = refY; // referencia ABSOLUTA (Y lineal 0..1, p. ej. 1 = blanco): la pared de la foto se toma como albedo ~1 y la luz de la foto se conserva sin normalizar
    yRef = Math.max(yRef, 1e-4);
    // lo más claro de la pared (p98) no pasa de L = maxL: si hace falta se achica todo el cociente (no se recorta, así no se pierde la textura)
    yCap = Math.min(1, inv((maxL + 16) / 116) / Math.max(inv((target.L + 16) / 116) * inv((p98L + 16) / 116) / yRef, 1e-6));
  } else if (mode === 'relative') {
    ratio = target.L / Math.max(meanL, minWallL, 1);
    ratio = Math.min(ratio, maxL / Math.max(p98L, 1));
  }

  const out = new Uint8ClampedArray(data);
  const lab = [0, 0, 0], lin = [0, 0, 0];
  const [gr, gg, gb] = gains;
  for (let i = 0; i < mask.length; i++) {
    const alpha = mask[i] * intensity;
    if (alpha <= 0.002) continue;
    const p = i * 4;
    // 1) neutralizar la luz de la foto
    linToLab(Math.min(1, SRGB_TO_LIN[data[p]] * gr), Math.min(1, SRGB_TO_LIN[data[p + 1]] * gg),
      Math.min(1, SRGB_TO_LIN[data[p + 2]] * gb), lab);
    // 2) nuevo L y nuevos a/b
    let L, a = target.a, b = target.b;
    if (mode === 'luz') {
      const k = (inv((lab[0] + 16) / 116) / yRef) * yCap; // cociente de luz lineal de este píxel
      const fy = (target.L + 16) / 116, fx = fy + target.a / 500, fz = fy - target.b / 200;
      const X = inv(fx) * k, Y = inv(fy) * k, Z = inv(fz) * k;
      const gx = fwd(X), gy = fwd(Y), gz = fwd(Z);
      L = Math.min(100, Math.max(0, 116 * gy - 16)); a = 500 * (gx - gy); b = 200 * (gy - gz);
    } else L = Math.min(100, Math.max(0, lab[0] * ratio));
    // 3) volver a RGB; si el color queda fuera de gamut se reduce el croma de a poco (mantiene el tono)
    for (let k = 0; k < 6; k++) {
      labToLin(L, a, b, lin);
      if (lin[0] >= -0.002 && lin[0] <= 1.002 && lin[1] >= -0.002 && lin[1] <= 1.002 && lin[2] >= -0.002 && lin[2] <= 1.002) break;
      a *= 0.85; b *= 0.85;
    }
    // 4) reaplicar la dominante original de la foto
    const R = toSrgb8(lin[0] / gr), G = toSrgb8(lin[1] / gg), B = toSrgb8(lin[2] / gb);
    out[p] = data[p] + (R - data[p]) * alpha;
    out[p + 1] = data[p + 1] + (G - data[p + 1]) * alpha;
    out[p + 2] = data[p + 2] + (B - data[p + 2]) * alpha;
  }
  return { image: { data: out, width, height }, wallMeanL: meanL, targetL: target.L };
}
