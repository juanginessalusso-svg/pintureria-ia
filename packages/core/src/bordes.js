// Ajuste de bordes por color (opt-in). SAM dibuja el contorno "a ojo": a veces se pasa sobre un objeto de otro color (azulejos, un marco,
// el techo sobre una columna) y otras deja una franja de pared sin cubrir. `refineByColor` mira solo una franja de `band` px alrededor del
// contorno de cada superficie y decide pixel a pixel con el color de la propia superficie:
//  - referencia LOCAL: promedio Lab de los píxeles interiores (a más de `band` px del contorno) en una ventana de ~3*band, así una pared con
//    degradé de sombra tiene una referencia que acompaña el degradé;
//  - distancia d = sqrt((0.5*dL)² + da² + db²) (la luz pesa la mitad: la sombra cambia L, no a/b);
//  - SACA (pela desde afuera) los píxeles de la franja con d > 1.5*tol alcanzables desde el exterior pasando solo por píxeles así; los
//    puntitos sueltos de adentro (grano, brillo) NO se tocan;
//  - (grow: true, apagado por defecto: en las pruebas contra Sinteplast empeoró) AGREGA (crece desde el contorno) píxeles libres de la franja con d ≤ tol conectados a la máscara; nunca roba píxeles de otra superficie
//    ni de un objeto bloqueado (`locked`), y no cruza bordes (gradiente de luma > GRAD_MAX).
// Sin referencia suficiente (superficie fina: < MIN_REF px interiores) la superficie se deja como está. Con tol = 0 / falsy no se hace nada.
import { rgbToLab } from './color.js';
import { distanceTransform, boxBlur, gradientMap } from './surfaces.js';

const GRAD_MAX = 4; // el crecimiento no cruza bordes: solo píxeles con gradiente de luma suavizado ≤ 4 (el mismo umbral de borde que usa el resto del detector)

const MIN_REF = 80;

export function refineByColor(regions, img, { tol = 7, band = Math.max(6, Math.round(img.width * 0.012)), locked = null, debug = null, peel = true, grow = false } = {}) {
  if (!tol || !regions.length) return regions;
  const { width, height, data } = img, N = width * height;
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { const q = rgbToLab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]); L[i] = q.L; A[i] = q.a; B[i] = q.b; }
  const lum = new Float32Array(N); for (let i = 0; i < N; i++) lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const G = gradientMap(lum, width, height);
  const Ls = L, As = A, Bs = B; // sin suavizar: un blur contamina 1 px a cada lado de un borde real y encogería el contorno
  const owner = new Int16Array(N).fill(-1);
  regions.forEach((r, k) => { for (let i = 0; i < N; i++) if (r.mask[i]) owner[i] = k; });
  const win = Math.max(3 * band, 12), plan = [];
  regions.forEach((r, k) => {
    const M = r.mask, dIn = distanceTransform(M, width, height);
    const out = new Uint8Array(N); for (let i = 0; i < N; i++) out[i] = M[i] ? 0 : 1;
    const dOut = distanceTransform(out, width, height);
    const deep = new Float32Array(N); let nDeep = 0;
    for (let i = 0; i < N; i++) if (dIn[i] > band) { deep[i] = 1; nDeep++; }
    if (nDeep < MIN_REF) return;
    const wgt = boxBlur(deep, width, height, win), dl = new Float32Array(N), da = new Float32Array(N), db = new Float32Array(N);
    for (let i = 0; i < N; i++) { dl[i] = deep[i] * Ls[i]; da[i] = deep[i] * As[i]; db[i] = deep[i] * Bs[i]; }
    const bl = boxBlur(dl, width, height, win), ba = boxBlur(da, width, height, win), bb = boxBlur(db, width, height, win);
    let gl = 0, ga = 0, gb = 0; for (let i = 0; i < N; i++) if (deep[i]) { gl += Ls[i]; ga += As[i]; gb += Bs[i]; } gl /= nDeep; ga /= nDeep; gb /= nDeep;
    const dist = (i) => {
      const w = wgt[i], rl = w > 1e-3 ? bl[i] / w : gl, ra = w > 1e-3 ? ba[i] / w : ga, rb = w > 1e-3 ? bb[i] / w : gb;
      return Math.hypot(0.5 * (Ls[i] - rl), As[i] - ra, Bs[i] - rb);
    };
    // 1) pelado: desde afuera, por píxeles de la franja interior que no encajan con la referencia
    const drop = new Uint8Array(N), add = new Uint8Array(N), q = new Int32Array(N);
    let head = 0, tail = 0;
    const nb = (i, f) => { const x = i % width; if (x > 0) f(i - 1); if (x < width - 1) f(i + 1); if (i >= width) f(i - width); if (i < N - width) f(i + width); };
    for (let i = 0; i < N; i++) if (M[i] && dIn[i] <= 1.5) { let touch = false; nb(i, (j) => { if (!M[j]) touch = true; }); if (peel && touch && dist(i) > 1.5 * tol) { drop[i] = 1; q[tail++] = i; } }
    while (head < tail) { const i = q[head++]; nb(i, (j) => { if (M[j] && !drop[j] && dIn[j] <= band && dist(j) > 1.5 * tol) { drop[j] = 1; q[tail++] = j; } }); }
    // 2) crecimiento: píxeles libres de la franja exterior parecidos a la referencia, conectados a la máscara
    head = 0; tail = 0;
    const free = (j) => !M[j] && owner[j] < 0 && !(locked && locked[j]) && dOut[j] <= band && !add[j] && G[j] <= GRAD_MAX && dist(j) <= tol;
    for (let i = 0; grow && i < N; i++) if (M[i] && !drop[i]) nb(i, (j) => { if (free(j)) { add[j] = 1; q[tail++] = j; } });
    while (head < tail) { const i = q[head++]; nb(i, (j) => { if (free(j)) { add[j] = 1; q[tail++] = j; } }); }
    plan.push({ k, drop, add });
  });
  for (const { k, drop, add } of plan) {
    const M = regions[k].mask;
    let nd = 0, na = 0;
    for (let i = 0; i < N; i++) { if (drop[i]) { M[i] = 0; nd++; } else if (add[i]) { M[i] = 1; na++; } }
    debug?.({ region: regions[k].name, quitados: nd, agregados: na, areaPrevia: M.reduce((s2, v) => s2 + v, 0) - na + nd, drop, add });
  }
  return regions;
}
