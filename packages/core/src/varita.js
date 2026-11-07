// "Varita mágica" para corregir a mano: desde un toque se crece una región por semejanza de color, tolerando el degradado suave de la luz
// (una pared con sombra sigue siendo la misma pared) pero frenándose en un borde o en un objeto de otro color. Puro y determinista.
//  - un píxel entra si su diferencia de color con la SEMILLA es <= tol, o si es casi igual a su vecino (<= step) y no se aleja de la semilla más de tol*lejos (el degradado)
//  - la diferencia pondera menos la luminosidad (la sombra) que el tono: dE = sqrt(wL*dL^2 + da^2 + db^2)

const SRGB = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; SRGB[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

/** sRGB 0..255 -> Lab (D65) en `out` = [L, a, b]. */
export function labRapido(r, g, b, out) {
  const R = SRGB[r], G = SRGB[g], B = SRGB[b];
  const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B), fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
}

/**
 * img: { data RGBA, width, height }; (x, y) en píxeles de la foto. Devuelve Uint8Array(width*height) con 1 en la región.
 * Opciones: tol (tolerancia respecto de la semilla, 8), step (salto máximo entre vecinos para seguir un degradado, 1,5), lejos (cuánto más lejos de la semilla puede llegar un degradado, 1,3),
 * wL (peso de la luminosidad, 0.5).
 */
export function varita(img, x, y, { tol = 8, step = 1.5, lejos = 1.3, wL = 0.5 } = {}) {
  const { data, width: w, height: h } = img, N = w * h, mask = new Uint8Array(N);
  x = Math.min(w - 1, Math.max(0, Math.round(x))); y = Math.min(h - 1, Math.max(0, Math.round(y)));
  // semilla = media de un entorno de 5x5 (un píxel suelto puede ser ruido)
  const tmp = [0, 0, 0], seed = [0, 0, 0];
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const p = (yy * w + xx) * 4; labRapido(data[p], data[p + 1], data[p + 2], tmp);
    seed[0] += tmp[0]; seed[1] += tmp[1]; seed[2] += tmp[2]; n++;
  }
  seed[0] /= n; seed[1] /= n; seed[2] /= n;
  const L = new Float32Array(N * 3), have = new Uint8Array(N);
  const lab = (i) => { if (!have[i]) { const p = i * 4; labRapido(data[p], data[p + 1], data[p + 2], tmp); L[i * 3] = tmp[0]; L[i * 3 + 1] = tmp[1]; L[i * 3 + 2] = tmp[2]; have[i] = 1; } return i * 3; };
  const dist = (a, b) => { const dl = L[a] - L[b], da = L[a + 1] - L[b + 1], db = L[a + 2] - L[b + 2]; return Math.sqrt(wL * dl * dl + da * da + db * db); };
  const dSeed = (a) => { const dl = L[a] - seed[0], da = L[a + 1] - seed[1], db = L[a + 2] - seed[2]; return Math.sqrt(wL * dl * dl + da * da + db * db); };
  const queue = new Int32Array(N); let head = 0, tail = 0;
  const start = y * w + x; mask[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++], a = lab(i), cx = i % w;
    for (const j of [cx > 0 ? i - 1 : -1, cx < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1]) {
      if (j < 0 || mask[j]) continue;
      const b = lab(j), ds = dSeed(b);
      if (ds <= tol || (ds <= tol * lejos && dist(a, b) <= step)) { mask[j] = 1; queue[tail++] = j; }
    }
  }
  return mask;
}
