// Crecimiento de superficies hacia SU PROPIA SOMBRA. Un techo o una pared en sombra tiene la misma crominancia (a, b) que la zona iluminada pero menos luz,
// y SAM + las reglas por color/luma suelen dejarla afuera ("el techo se corta donde empieza la sombra"). Desde el borde de cada superficie se crece sobre
// píxeles LIBRES (de ninguna superficie) que cumplan: crominancia parecida a la mediana de la superficie, menos luminosos que ella (sombra, no un objeto
// claro), sin borde fuerte de luminosidad (la sombra se degrada suave; un objeto tiene arista) y a poca distancia del borde original.
// Puro y determinista. Opciones: abTol (ΔE en a,b), gradMax (gradiente de L por píxel, caja 3x3), maxGrow (fracción del lado mayor), minDark/maxDark (L relativa).
import { rgbToLab } from './color.js';

function labPlanes(img) {
  const { data, width, height } = img, N = width * height;
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { const c = rgbToLab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]); L[i] = c.L; A[i] = c.a; B[i] = c.b; }
  return { L, A, B };
}

/** Gradiente de L (Sobel sobre L suavizada con caja 3x3), magnitud por píxel. */
export function lGradient(L, w, h) {
  const S = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; s += L[yy * w + xx]; n++; } }
    S[y * w + x] = s / n;
  }
  const G = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (S[i + 1] - S[i - 1]) / 2, gy = (S[i + w] - S[i - w]) / 2;
    G[i] = Math.hypot(gx, gy);
  }
  return G;
}

const median = (arr) => { const s = Float32Array.from(arr).sort(); return s[s.length >> 1]; };

/**
 * Crece cada superficie de `surfaces` ([{kind, mask}], máscaras Uint8Array w*h) sobre píxeles libres que parecen su propia sombra.
 * Modifica las máscaras en el lugar. Devuelve [{ name, added }].
 */
export function growIntoShadow(surfaces, img, { abTol = 6, gradMax = 3.5, maxGrow = 0.08, minDark = 0.4, brighter = 3, kinds = ['techo'] } = {}) {
  const { width: w, height: h } = img, N = w * h;
  if (!surfaces.length) return [];
  const { L, A, B } = labPlanes(img), G = lGradient(L, w, h);
  const taken = new Uint8Array(N);
  for (const s of surfaces) for (let i = 0; i < N; i++) if (s.mask[i]) taken[i] = 1;
  const limit = Math.max(4, Math.round(maxGrow * Math.max(w, h))), info = [];
  for (const s of surfaces) {
    if (!kinds.includes(s.kind)) continue;
    const la = [], aa = [], bb = [];
    for (let i = 0; i < N; i += 7) if (s.mask[i]) { la.push(L[i]); aa.push(A[i]); bb.push(B[i]); }
    if (la.length < 200) continue;
    const L0 = median(la), a0 = median(aa), b0 = median(bb);
    const dist = new Int16Array(N).fill(-1), queue = [];
    const ok = (j) => !taken[j] && dist[j] < 0 && L[j] <= L0 + brighter && L[j] >= L0 * minDark && Math.hypot(A[j] - a0, B[j] - b0) <= abTol && G[j] <= gradMax;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!s.mask[i]) continue;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && ok(j)) { dist[j] = 1; queue.push(j); }
    }
    let added = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], d = dist[i];
      s.mask[i] = 1; taken[i] = 1; added++;
      if (d >= limit) continue;
      const x = i % w, y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && ok(j)) { dist[j] = d + 1; queue.push(j); }
    }
    info.push({ name: s.name, added });
  }
  return info;
}
