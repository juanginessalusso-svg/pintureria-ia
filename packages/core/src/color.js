// Utilidades de color. sRGB (D65) -> CIE LAB. Sin dependencias.

/** Devuelve '#rrggbb' en minúsculas, o null si no es un hex válido (acepta 3 o 6 dígitos, con o sin #). */
export function normalizeHex(input) {
  let s = String(input ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return '#' + s.toLowerCase();
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) throw new Error(`hex inválido: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const linear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** [r,g,b] 0..255 -> {L,a,b} (iluminante D65). */
export function rgbToLab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(linear);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const [fx, fy, fz] = [X, Y, Z].map(f);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export const hexToLab = (hex) => rgbToLab(hexToRgb(hex));

const finv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const gamma = (v) => { const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
/** {L,a,b} -> [r,g,b] 0..255 (D65; lo que cae fuera de sRGB se recorta). */
export function labToRgb({ L, a, b }) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = finv(fx) * 0.95047, Y = finv(fy), Z = finv(fz) * 1.08883;
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return [gamma(R), gamma(G), gamma(B)];
}
export const labToHex = (lab) => '#' + labToRgb(lab).map((v) => v.toString(16).padStart(2, '0')).join('');
