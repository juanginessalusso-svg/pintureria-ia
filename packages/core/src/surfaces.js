// Detección automática de superficies (paredes y techo) para que el cliente no tenga que tocar nada.
// Sin modelos nuevos: se buscan zonas lisas de la foto, el centro de cada una se usa como "toque" automático
// para el segmentador (MobileSAM) y las máscaras resultantes se ordenan, se hacen disjuntas y se clasifican.
// Todo es puro (sin DOM ni ONNX): `segment` lo inyecta quien llama.
import { openMask, removeSmallIslands } from './recolor.js';

/** Reduce a lado largo <= maxSide promediando cajas; devuelve la luminancia (0..255) y el tamaño. */
export function downscaleLuma(img, maxSide = 192) {
  const { data, width, height } = img;
  const s = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * s)), h = Math.max(1, Math.round(height * s));
  const luma = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let acc = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const p = (yy * width + xx) * 4;
        acc += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
        n++;
      }
      luma[y * w + x] = acc / n;
    }
  }
  return { luma, w, h };
}

/** Módulo del gradiente (Sobel) suavizado con una caja 3x3: chico = zona lisa (pared, techo), grande = bordes y textura. */
export function gradientMap(luma, w, h) {
  const g = new Float32Array(w * h);
  const at = (x, y) => luma[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    g[y * w + x] = Math.hypot(gx, gy);
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      acc += g[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
    out[y * w + x] = acc / 9;
  }
  return out;
}

/** Distancia (aprox. euclídea, chamfer 3-4) de cada píxel "libre" (1) al píxel no libre más cercano. */
export function distanceTransform(free, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = free[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - w] + 3);
      if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
      if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
    }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < h - 1) {
      v = Math.min(v, d[i + w] + 3);
      if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
    }
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] = d[i] >= INF ? 0 : d[i] / 3; // en píxeles
  return d;
}

/** Estadísticas geométricas de una máscara 0/1 (coordenadas relativas 0..1). */
export function maskGeometry(mask, width, height) {
  let n = 0, sx = 0, sy = 0, x0 = width, x1 = -1, y0 = height, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    n++; sx += x; sy += y;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!n) return { area: 0, cx: 0, cy: 0, top: 0, bottom: 0, left: 0, right: 0, touchesTop: false, touchesBottom: false };
  return {
    area: n / (width * height), cx: sx / n / width, cy: sy / n / height,
    top: y0 / height, bottom: (y1 + 1) / height, left: x0 / width, right: (x1 + 1) / width,
    touchesTop: y0 <= height * 0.01, touchesBottom: y1 >= height * 0.99,
  };
}

/**
 * ¿Qué es esta región? 'techo' | 'pared' | null (piso, objeto, cosa chica).
 *  - techo: arriba de todo, apoyado en el borde superior y de poca altura.
 *  - piso: abajo de todo y chato (el suelo se ve como una franja inferior).
 *  - objeto: baja y sin llegar a ser una pared (muebles, puertas, ventanas…).
 */
export function classifySurface(g) {
  if (g.area < 0.025) return null;
  const h = g.bottom - g.top;
  if (g.cy < 0.3 && g.top < 0.04 && h < 0.45) return 'techo';
  if (g.cy > 0.7 && h < 0.4) return null; // piso
  if (g.cy > 0.62 && g.top > 0.35) return null; // algo bajo y chico: mueble, piso
  if (g.area / Math.max(0.01, g.bottom - g.top) < 0.06) return null; // tira angosta (ancho medio < 6 % de la foto): un marco o una puerta cortados por el encuadre
  if (g.cy < 0.45 && g.right - g.left > 0.5 && g.area > 0.08) return 'pared'; // banda ancha en la mitad de arriba: la pared sobre los azulejos
  if (h < 0.25) return null; // franja baja o angosta: no es una pared
  return 'pared';
}

const iouAndContain = (a, b) => {
  let inter = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { if (a[i]) na++; if (b[i]) nb++; if (a[i] && b[i]) inter++; }
  return { iou: inter / Math.max(1, na + nb - inter), inA: inter / Math.max(1, na), inB: inter / Math.max(1, nb) };
};

/** Máscara de la foto de trabajo -> grilla chica (muestreo del centro de cada celda). */
function toLow(mask, width, height, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const mx = Math.min(width - 1, Math.floor(((x + 0.5) / w) * width)), my = Math.min(height - 1, Math.floor(((y + 0.5) / h) * height));
    out[y * w + x] = mask[my * width + mx];
  }
  return out;
}

/** Componente conexa (4 vecinos) de `free` que contiene a `start`. */
function component(free, w, h, start) {
  const seen = new Uint8Array(w * h), q = [start];
  seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w;
    if (x > 0 && free[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; q.push(i - 1); }
    if (x < w - 1 && free[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; q.push(i + 1); }
    if (i >= w && free[i - w] && !seen[i - w]) { seen[i - w] = 1; q.push(i - w); }
    if (i < w * h - w && free[i + w] && !seen[i + w]) { seen[i + w] = 1; q.push(i + w); }
  }
  return seen;
}

/**
 * Qué tan "con textura" es una región: fracción de su interior (sin el borde) donde el gradiente supera `gradMax`.
 * Una pared es lisa (casi 0); un vidrio con el paisaje, una puerta con paneles o un mueble dan valores altos.
 */
export function textureRatio(lowMask, grad, w, h, gradMax) {
  let n = 0, t = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!lowMask[i] || !lowMask[i - 1] || !lowMask[i + 1] || !lowMask[i - w] || !lowMask[i + w]) continue; // solo interior
    n++; if (grad[i] > gradMax) t++;
  }
  return n ? t / n : 1;
}

/** Box blur separable sobre un Float32Array (radio r), borde replicado. */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc / win; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / win; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

/**
 * Rellena los huecos que el segmentador deja en zonas de sombra suave: cada superficie avanza sobre píxeles que no son de ninguna otra
 * mientras la luminancia cambie poco de un píxel al vecino (una sombra cambia de a poco; un zócalo, un marco o el piso, de golpe).
 * `maxGrow` limita cuánto puede avanzar (en píxeles) para que no se escape por una unión pared/techo de bajo contraste.
 */
export function growIntoGaps(regions, img, { step = 1.6, maxGrow = Math.round(img.width * 0.07), chromaTol = 0.018, maxBrighter = 12, localChroma = 0.012, blocked = null } = {}) {
  const { data, width, height } = img;
  const n = width * height;
  const lum = new Float32Array(n), R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = data[i * 4]; G[i] = data[i * 4 + 1]; B[i] = data[i * 4 + 2];
    lum[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
  }
  const L = boxBlur(lum, width, height, 2); // sin el ruido de la foto
  const [Rs, Gs, Bs] = [R, G, B].map((c) => boxBlur(c, width, height, 2));
  // Cromaticidad (r, g normalizados): una sombra oscurece sin cambiarla; un zócalo, el piso o un marco sí la cambian.
  const chr = new Float32Array(n), chg = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = Rs[i] + Gs[i] + Bs[i] + 1e-3; chr[i] = Rs[i] / t; chg[i] = Gs[i] / t; }
  const owner = new Int16Array(n).fill(-1);
  const mean = regions.map((r, k) => {
    let sr = 0, sg = 0, sl = 0, c = 0;
    for (let i = 0; i < n; i += 5) if (r.mask[i]) { sr += chr[i]; sg += chg[i]; sl += L[i]; c++; }
    for (let i = 0; i < n; i++) if (r.mask[i]) owner[i] = k;
    return [c ? sr / c : 0, c ? sg / c : 0, c ? sl / c : 255];
  });
  let frontier = [];
  // "Origen" de cada píxel que crece: el píxel de contorno de donde arrancó su cadena de avance. Se compara contra él además de contra
  // la media de la región, porque un objeto pegado al contorno (la tapa crema de un termotanque, una bombilla) cambia de a poco en
  // cada paso pero termina lejos del origen, y contra la media de toda la pared eso no se nota.
  const oR = new Float32Array(n), oG = new Float32Array(n);
  for (let i = 0; i < n; i++) if (owner[i] >= 0) {
    const x = i % width;
    if ((x > 0 && owner[i - 1] < 0) || (x < width - 1 && owner[i + 1] < 0) || (i >= width && owner[i - width] < 0) || (i < n - width && owner[i + width] < 0)) { frontier.push(i); oR[i] = chr[i]; oG[i] = chg[i]; }
  }
  for (let depth = 0; depth < maxGrow && frontier.length; depth++) {
    const next = [];
    for (const i of frontier) {
      const x = i % width, k = owner[i], [mr, mg, ml] = mean[k];
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < n - width ? i + width : -1]) {
        if (j < 0 || owner[j] >= 0 || (blocked && blocked[j]) || Math.abs(L[j] - L[i]) > step) continue;
        if (Math.abs(chr[j] - mr) + Math.abs(chg[j] - mg) > chromaTol) continue;
        if (L[j] > ml + maxBrighter) continue; // más brillante que la pared: una lamparita, un reflejo, un objeto blanco
        if (localChroma && Math.abs(chr[j] - oR[i]) + Math.abs(chg[j] - oG[i]) > localChroma) continue; // se corrió de color respecto de donde arrancó
        owner[j] = k; regions[k].mask[j] = 1; next.push(j); oR[j] = oR[i]; oG[j] = oG[i];
      }
    }
    frontier = next;
  }
  return regions;
}

/**
 * Divide una máscara que fusionó varias superficies (pared + pared + techo del mismo color, con aristas muy suaves).
 * Busca "núcleos" muy lisos dentro de la máscara; si hay más de uno, cada píxel va al núcleo al que llega con menor
 * costo de gradiente (cuenca de aguas): una arista, por tenue que sea, hace de divisoria. Devuelve una lista de máscaras
 * (la original si no hay nada que dividir).
 */
export function splitMerged(mask, grad, w, h, width, height, { strictMax = 2.2, minFrac = 0.04, edgeCost = 1.5, minEdge = 4.5, debug = null, fullGrad = null } = {}) {
  const low = toLow(mask, width, height, w, h);
  let total = 0;
  for (let i = 0; i < low.length; i++) total += low[i];
  if (!total) return [mask];
  const strict = new Uint8Array(w * h);
  for (let i = 0; i < strict.length; i++) strict[i] = low[i] && grad[i] < strictMax ? 1 : 0;
  // núcleos = componentes conexas de la zona muy lisa
  const lab = new Int16Array(w * h).fill(-1), sizes = [];
  for (let i = 0; i < strict.length; i++) {
    if (!strict[i] || lab[i] >= 0) continue;
    const id = sizes.length, q = [i];
    lab[i] = id;
    for (let k = 0; k < q.length; k++) {
      const j = q[k], x = j % w;
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j >= w ? j - w : -1, j < w * h - w ? j + w : -1])
        if (n >= 0 && strict[n] && lab[n] < 0) { lab[n] = id; q.push(n); }
    }
    sizes.push(q.length);
  }
  const keep = sizes.map((n, id) => (n >= minFrac * total ? id : -1)).filter((id) => id >= 0);
  if (keep.length < 2) return [mask];
  const remap = new Int16Array(sizes.length).fill(-1);
  keep.forEach((id, k) => { remap[id] = k; });

  // Dijkstra multi-fuente (cola binaria) con costo = 1 + edgeCost·gradiente del píxel al que se entra
  const dist = new Float32Array(w * h).fill(Infinity), own = new Int16Array(w * h).fill(-1);
  const heap = []; // [dist, idx]
  const push = (d, i) => { heap.push([d, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0 && remap[lab[i]] >= 0) { dist[i] = 0; own[i] = remap[lab[i]]; push(0, i); }
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * h - w ? i + w : -1]) {
      if (n < 0 || !low[n]) continue;
      const nd = d + 1 + edgeCost * grad[n];
      if (nd < dist[n]) { dist[n] = nd; own[n] = own[i]; push(nd, n); }
    }
  }
  // Fuerza del borde entre núcleos vecinos: gradiente medio justo en la frontera. Un degradé de sombra no tiene borde (débil, se fusiona
  // de nuevo); una arista de esquina o un zócalo sí (fuerte, se conserva).
  const pairs = new Map();
  for (let i = 0; i < w * h; i++) {
    if (own[i] < 0) continue;
    const x = i % w;
    for (const n of [x < w - 1 ? i + 1 : -1, i < w * h - w ? i + w : -1]) {
      if (n < 0 || own[n] < 0 || own[n] === own[i]) continue;
      const key = Math.min(own[i], own[n]) * 1000 + Math.max(own[i], own[n]);
      const e = pairs.get(key) ?? { sum: 0, n: 0 };
      e.sum += Math.max(grad[i], grad[n]); e.n++;
      pairs.set(key, e);
    }
  }
  const root = keep.map((_, k) => k);
  const find = (k) => (root[k] === k ? k : (root[k] = find(root[k])));
  for (const [key, e] of pairs) {
    const a = Math.floor(key / 1000), b = key % 1000, str = e.sum / e.n;
    if (debug) debug({ a, b, strength: str, len: e.n });
    if (e.n >= 3 && str < minEdge) root[find(a)] = find(b);
  }
  for (let i = 0; i < own.length; i++) if (own[i] >= 0) own[i] = find(own[i]);
  const finalIds = [...new Set(keep.map((_, k) => find(k)))];
  if (finalIds.length < 2) return [mask];
  const slot = new Map(finalIds.map((id, j) => [id, j]));
  for (let i = 0; i < own.length; i++) if (own[i] >= 0) own[i] = slot.get(own[i]);

  // de vuelta a la foto de trabajo (por muestreo); lo que cae fuera de lo etiquetado va al vecino más cercano en la grilla chica
  const N = width * height, lab2 = new Int16Array(N).fill(-1);
  for (let y = 0; y < height; y++) {
    const ly = Math.min(h - 1, Math.floor((y / height) * h));
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const lx = Math.min(w - 1, Math.floor((x / width) * w));
      let o = own[ly * w + lx];
      for (let r = 1; o < 0 && r <= 3; r++) for (let dy = -r; dy <= r && o < 0; dy++) for (let dx = -r; dx <= r && o < 0; dx++) {
        const yy = ly + dy, xx = lx + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) o = own[yy * w + xx];
      }
      if (o >= 0) lab2[i] = o; // los píxeles sin núcleo alcanzable (islas sueltas) se descartan en vez de pegarlos a otra parte
    }
  }
  // Refinado en alta resolución, solo en una franja alrededor de cada corte: el contorno se pega a la arista real de la foto
  // (en la grilla chica queda dentado, con "dientes" de varios píxeles).
  if (fullGrad) {
    const G = fullGrad(), bnd = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (lab2[i] < 0) continue;
      const x = i % width, r = x < width - 1 ? lab2[i + 1] : -1, d = i < N - width ? lab2[i + width] : -1;
      if ((r >= 0 && r !== lab2[i]) || (d >= 0 && d !== lab2[i])) bnd[i] = 1;
    }
    const R = Math.max(4, Math.round(width / 100)), near = boxBlur(bnd, width, height, R);
    const band = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (lab2[i] >= 0 && near[i] > 1e-4) band[i] = 1;
    const dist2 = new Float32Array(N).fill(Infinity), own2 = new Int16Array(N).fill(-1), heap2 = [];
    const push2 = (d, i) => { heap2.push([d, i]); let c = heap2.length - 1; while (c > 0) { const q = (c - 1) >> 1; if (heap2[q][0] <= heap2[c][0]) break; [heap2[q], heap2[c]] = [heap2[c], heap2[q]]; c = q; } };
    const pop2 = () => { const top = heap2[0], last = heap2.pop(); if (heap2.length) { heap2[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, rr = l + 1; let m = c; if (l < heap2.length && heap2[l][0] < heap2[m][0]) m = l; if (rr < heap2.length && heap2[rr][0] < heap2[m][0]) m = rr; if (m === c) break; [heap2[m], heap2[c]] = [heap2[c], heap2[m]]; c = m; } } return top; };
    const nb = (i) => { const x = i % width; return [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < N - width ? i + width : -1]; };
    for (let i = 0; i < N; i++) {
      if (lab2[i] < 0 || band[i]) continue;
      if (nb(i).some((n) => n >= 0 && band[n])) { dist2[i] = 0; own2[i] = lab2[i]; push2(0, i); }
    }
    while (heap2.length) {
      const [d, i] = pop2();
      if (d > dist2[i]) continue;
      for (const n of nb(i)) {
        if (n < 0 || !band[n]) continue;
        const nd = d + 1 + edgeCost * G[n];
        if (nd < dist2[n]) { dist2[n] = nd; own2[n] = own2[i]; push2(nd, n); }
      }
    }
    for (let i = 0; i < N; i++) if (band[i] && own2[i] >= 0) lab2[i] = own2[i];
  }
  const parts = finalIds.map(() => new Uint8Array(N));
  for (let i = 0; i < N; i++) if (lab2[i] >= 0) parts[lab2[i]][i] = 1;
  return parts;
}

/**
 * ¿Hay una ESQUINA vertical suave dentro de esta pared? Dos paredes que se juntan casi sin arista (mismo color, solo cambia la sombra)
 * llegan fusionadas desde SAM y `splitMerged` no las separa porque no hay gradiente fuerte. Se busca, solo con la imagen:
 *  1. Luminancia: en cada fila, se ajusta una recta a la ventana de la izquierda y otra a la de la derecha de la columna candidata y se
 *     mide cuánto se aparta cada lado de lo que predice el otro. Solo cuenta si los dos lados coinciden en signo (salto de nivel, con o sin
 *     cambio de pendiente): un degradé liso (una sola pared con sombra) se predice a sí mismo y da error ≈ 0.
 *  2. Que ese quiebre sea de signo consistente en casi todas las filas (`minFrac`), cubra casi toda la altura de la pared en esa columna
 *     (`minCov`), no sea un pedacito (`minRows`) y forme una recta casi vertical (`maxSpread`, `maxTilt`).
 *  3. Que la unión con el techo cambie de dirección justo ahí (`minAngle`): es lo que distingue una esquina de una sombra proyectada,
 *     que también da un escalón vertical de luz pero no dobla la línea del techo.
 * Si algo no se cumple con claridad devuelve null (pintar de más es peor que dejar la pared entera). Devuelve { x0, tilt, ... } en
 * píxeles de la foto de trabajo: la esquina es la recta x = x0 + tilt·(y − ym).
 * Con `debug`, informa siempre el mejor candidato y por qué se aceptó o se rechazó.
 */
export function findVerticalCorner(mask, img, { win = 10, gap = 2, minE = 5, minFrac = 0.65, minCov = 0.8, minRows = 0.08, maxSpread = 2.5, maxTilt = 0.12, minAngle = 10, maxAngleOffset = 0.06, minPart = 0.004, debug = null } = {}) {
  const { width, height, data } = img;
  const f = Math.max(1, Math.round(Math.max(width, height) / 400));
  const lw = Math.floor(width / f), lh = Math.floor(height / f), full = f * f;
  if (lw < 2 * (win + gap) + 4) return null;
  const L = new Float32Array(lw * lh), M = new Uint8Array(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    let s = 0, m = 0;
    for (let yy = y * f; yy < (y + 1) * f; yy++) for (let xx = x * f; xx < (x + 1) * f; xx++) {
      const p = yy * width + xx;
      s += 0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2];
      m += mask[p];
    }
    L[y * lw + x] = s / full;
    M[y * lw + x] = m >= full * 0.99 ? 1 : 0;
  }
  // sumas acumuladas por fila: Σ L, Σ x·L y Σ máscara
  const S = lw + 1, cl = new Float64Array(lh * S), cx = new Float64Array(lh * S), cm = new Int32Array(lh * S);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const i = y * S + x, v = L[y * lw + x];
    cl[i + 1] = cl[i] + v; cx[i + 1] = cx[i] + x * v; cm[i + 1] = cm[i] + M[y * lw + x];
  }
  const sxx = (win * (win * win - 1)) / 12, dist = 2 * gap + win;
  const E = new Float32Array(lw * lh).fill(NaN);
  const stats = [];
  const col = [];
  for (let x = gap + win; x <= lw - gap - win; x++) {
    const l0 = x - gap - win, l1 = x - gap, r0 = x + gap, r1 = x + gap + win;
    col.length = 0;
    let extent = 0;
    for (let y = 0; y < lh; y++) {
      const b = y * S;
      if (M[y * lw + x]) extent++;
      if (cm[b + l1] - cm[b + l0] !== win || cm[b + r1] - cm[b + r0] !== win) continue;
      const mL = (cl[b + l1] - cl[b + l0]) / win, mR = (cl[b + r1] - cl[b + r0]) / win;
      const cL = (l0 + l1 - 1) / 2, cR = (r0 + r1 - 1) / 2;
      const sL = (cx[b + l1] - cx[b + l0] - cL * (cl[b + l1] - cl[b + l0])) / sxx, sR = (cx[b + r1] - cx[b + r0] - cR * (cl[b + r1] - cl[b + r0])) / sxx;
      const eR = mR - (mL + sL * dist), eL = mR - sR * dist - mL; // los dos: "derecha menos izquierda", predicho desde cada lado
      const e = Math.sign(eR) === Math.sign(eL) ? (eR + eL) / 2 : 0;
      E[y * lw + x] = e; col.push(e);
    }
    if (col.length < 5) continue;
    const sorted = Float64Array.from(col).sort();
    const med = sorted[sorted.length >> 1];
    if (!med) continue;
    let ok = 0;
    for (const v of col) if (Math.sign(v) === Math.sign(med) && Math.abs(v) >= 0.5 * Math.abs(med)) ok++;
    stats.push({ x, med, n: col.length, frac: ok / col.length, cov: col.length / Math.max(1, extent) });
  }
  stats.sort((a, b) => Math.abs(b.med) - Math.abs(a.med));
  const cand = [];
  for (const s of stats) { if (cand.every((c) => Math.abs(c.x - s.x) >= 8)) cand.push(s); if (cand.length >= 3) break; }

  // contorno superior (unión con el techo) en resolución completa
  const top = new Int32Array(width).fill(-1);
  let lastCol = -1;
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) if (mask[y * width + x]) { top[x] = y; lastCol = x; break; }
  const fit = (xa, xb) => { // Theil–Sen sobre el contorno: pendiente, ordenada y residuo mediano
    const pts = [];
    const step = Math.max(1, Math.round(width / 300));
    for (let x = xa; x <= xb; x += step) if (x >= 0 && x < width && top[x] > height * 0.01) pts.push([x, top[x]]);
    if (pts.length < 0.7 * ((xb - xa) / step) || pts.length < 8) return null;
    const sl = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j][0] - pts[i][0] >= 10) sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    if (!sl.length) return null;
    sl.sort((a, b) => a - b);
    const b = sl[sl.length >> 1];
    const ic = pts.map(([x, y]) => y - b * x).sort((a, c) => a - c), a = ic[ic.length >> 1];
    const res = pts.map(([x, y]) => Math.abs(y - a - b * x)).sort((p, q) => p - q);
    return { a, b, res: res[res.length >> 1] };
  };

  let found = null;
  for (const c of cand) {
    const info = { ...c, x: c.x };
    const why = [];
    if (Math.abs(c.med) < minE) why.push('e');
    if (c.n < minRows * lh) why.push('filas');
    if (c.frac < minFrac) why.push('signo');
    if (c.cov < minCov) why.push('cobertura');
    // recta casi vertical: la mejor columna de cada fila cerca de la candidata
    const xs = [], ys = [];
    const sg = Math.sign(c.med);
    for (let y = 0; y < lh; y++) {
      let bx = -1, bv = 0;
      for (let x = Math.max(0, c.x - 6); x <= Math.min(lw - 1, c.x + 6); x++) { const v = sg * E[y * lw + x]; if (v > bv) { bv = v; bx = x; } }
      if (bx >= 0) { xs.push(bx); ys.push(y); }
    }
    if (xs.length < 5) why.push('recta');
    else {
      const med = Float64Array.from(xs).sort()[xs.length >> 1];
      const dev = xs.map((x) => Math.abs(x - med)).sort((p, q) => p - q);
      info.spread = dev[dev.length >> 1];
      const kept = xs.map((x, i) => i).filter((i) => Math.abs(xs[i] - med) <= 4);
      const my = kept.reduce((a, i) => a + ys[i], 0) / kept.length, mx = kept.reduce((a, i) => a + xs[i], 0) / kept.length;
      let num = 0, den = 0;
      for (const i of kept) { num += (ys[i] - my) * (xs[i] - mx); den += (ys[i] - my) ** 2; }
      info.tilt = den ? num / den : 0; info.ym = my * f; info.xm = mx;
      if (info.spread > maxSpread) why.push('recta');
      if (Math.abs(info.tilt) > maxTilt) why.push('inclinada');
    }
    // unión con el techo: ¿cambia de dirección justo en la esquina?
    const xc = Math.round((info.xm ?? c.x) * f);
    const gl = Math.round(0.08 * width), wl = Math.round(0.15 * width), gr = Math.round(0.01 * width);
    const wr = Math.min(Math.round(0.15 * width), lastCol - xc - 2);
    const left = fit(xc - gl - wl, xc - gl), right = wr - gr >= 0.04 * width ? fit(xc + gr, xc + wr) : null;
    if (!left || !right) why.push('techo?');
    else {
      info.angle = Math.abs(Math.atan(right.b) - Math.atan(left.b)) * 180 / Math.PI;
      info.resTop = Math.max(left.res, right.res);
      info.xInt = Math.abs(left.b - right.b) > 1e-6 ? (right.a - left.a) / (left.b - right.b) : NaN;
      info.offInt = Math.abs(info.xInt - xc) / width;
      if (info.angle < minAngle) why.push('quiebre');
      else if (!(info.offInt <= maxAngleOffset)) why.push('quiebre-lejos');
      if (info.resTop > 0.006 * height) why.push('contorno');
    }
    info.why = why;
    info.xFull = xc;
    if (debug) debug(info);
    if (!why.length && !found) found = info;
  }
  if (!found) return null;
  const x0 = found.xFull, tilt = found.tilt, ym = found.ym;
  let nl = 0, nr = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { if (x < x0 + tilt * (y - ym)) nl++; else nr++; }
  if (Math.min(nl, nr) < minPart * width * height) { if (debug) debug({ why: ['parte-chica'], nl, nr }); return null; }
  return { x0, tilt, ym };
}

/** Parte la máscara por la recta de la esquina (ver `findVerticalCorner`): [izquierda, derecha]. */
export function splitAtCorner(mask, width, height, { x0, tilt, ym }) {
  const a = new Uint8Array(width * height), b = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const xl = x0 + tilt * (y - ym);
    for (let x = 0; x < width; x++) if (mask[y * width + x]) (x < xl ? a : b)[y * width + x] = 1;
  }
  return [a, b];
}

/**
 * Fracción del interior de una región (a ≥ 5 px del borde) con gradiente fuerte a resolución completa: las juntas de un azulejo
 * son líneas finas y rectas que una pared no tiene. Una pared lisa da ≈ 0; un paño de azulejo da bastante más.
 */
export function lineRatio(mask, G, width, height, thr, inset = 5) {
  let n = 0, t = 0;
  for (let y = inset; y < height - inset; y++) for (let x = inset; x < width - inset; x++) {
    const i = y * width + x;
    if (!mask[i] || !mask[i - inset] || !mask[i + inset] || !mask[i - inset * width] || !mask[i + inset * width]) continue;
    n++; if (G[i] > thr) t++;
  }
  return n ? t / n : 0;
}

/**
 * Pega el contorno de cada superficie al borde real de la foto. SAM dibuja el contorno "a ojo" y a veces se pasa sobre un objeto de color
 * parecido (una tabla blanca, una puerta, un marco). En una franja de ±`band` px alrededor de cada contorno, cada píxel va a la superficie
 * (o al "afuera") a la que llega con menor costo de gradiente (cuenca de aguas con marcadores): donde hay un borde real el contorno se
 * asienta sobre él; donde no hay borde (sombra suave) se queda donde estaba. Modifica las máscaras de `regions` y las devuelve.
 */
export function refineEdges(regions, G, width, height, { band = Math.max(4, Math.round(width / 100)), edgeCost = 1.5, locked = null } = {}) {
  const N = width * height, OUT = regions.length;
  const lab = new Int16Array(N).fill(OUT);
  regions.forEach((r, k) => { for (let i = 0; i < N; i++) if (r.mask[i]) lab[i] = k; });
  const bnd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % width;
    if ((x < width - 1 && lab[i + 1] !== lab[i]) || (i < N - width && lab[i + width] !== lab[i])) bnd[i] = 1;
  }
  const near = boxBlur(bnd, width, height, band);
  const inBand = new Uint8Array(N);
  // `locked`: objetos ya identificados (veto). Un objeto más angosto que la banda (un foco, un cable, una lámpara) no tendría ningún píxel
  // interior fuera de la banda y la pared se lo comería entero; sus píxeles quedan fijos y hacen de semilla.
  for (let i = 0; i < N; i++) if (near[i] > 1e-4 && !(locked && locked[i])) inBand[i] = 1;
  const dist = new Float32Array(N).fill(Infinity), own = new Int16Array(N).fill(-1);
  const heap = makeHeap(1 << 16);
  for (let i = 0; i < N; i++) {
    if (inBand[i]) continue;
    const x = i % width;
    if ((x > 0 && inBand[i - 1]) || (x < width - 1 && inBand[i + 1]) || (i >= width && inBand[i - width]) || (i < N - width && inBand[i + width])) { dist[i] = 0; own[i] = lab[i]; heap.push(0, i); }
  }
  const relax = (i, n, d) => { if (!inBand[n]) return; const nd = d + 1 + edgeCost * G[n]; if (nd < dist[n]) { dist[n] = nd; own[n] = own[i]; heap.push(nd, n); } };
  while (heap.size) {
    const i = heap.pop(), d = heap.lastKey;
    if (d > dist[i]) continue;
    const x = i % width;
    if (x > 0) relax(i, i - 1, d);
    if (x < width - 1) relax(i, i + 1, d);
    if (i >= width) relax(i, i - width, d);
    if (i < N - width) relax(i, i + width, d);
  }
  for (let i = 0; i < N; i++) if (inBand[i] && own[i] >= 0) lab[i] = own[i];
  regions.forEach((r, k) => { r.mask.fill(0); for (let i = 0; i < N; i++) if (lab[i] === k) r.mask[i] = 1; });
  return regions;
}

/** Cola de prioridad mínima con arreglos tipados (clave Float32, valor Int32). `pop()` devuelve el valor y deja la clave en `lastKey`. */
function makeHeap(cap) {
  let n = 0, keys = new Float32Array(cap), vals = new Int32Array(cap), lastKey = 0;
  return {
    get size() { return n; },
    get lastKey() { return lastKey; },
    push(key, val) {
      if (n === keys.length) { const k2 = new Float32Array(n * 2), v2 = new Int32Array(n * 2); k2.set(keys); v2.set(vals); keys = k2; vals = v2; }
      let c = n++;
      while (c > 0) { const p = (c - 1) >> 1; if (keys[p] <= key) break; keys[c] = keys[p]; vals[c] = vals[p]; c = p; }
      keys[c] = key; vals[c] = val;
    },
    pop() {
      lastKey = keys[0];
      const top = vals[0];
      n--;
      if (n > 0) {
        const key = keys[n], val = vals[n];
        let c = 0;
        for (;;) {
          const l = 2 * c + 1;
          if (l >= n) break;
          const r = l + 1, m = r < n && keys[r] < keys[l] ? r : l;
          if (keys[m] >= key) break;
          keys[c] = keys[m]; vals[c] = vals[m]; c = m;
        }
        keys[c] = key; vals[c] = val;
      }
      return top;
    },
  };
}

/** Semillas a ambos lados de los bordes largos que hay DENTRO de las paredes (puertas, marcos, cuadros). Ver partitionBySmallest. */
function edgeSeeds(paredes, G, width, height, { edgeThr, edgeBudget, edgeMinLen, debug }) {
  const w = 192, h = Math.max(1, Math.round((192 * height) / width)), N = width * height;
  const wall = new Uint8Array(N);
  for (const r of paredes) for (let i = 0; i < N; i++) if (r.mask[i]) wall[i] = 1;
  const low = toLow(wall, width, height, w, h), dt = distanceTransform(low, w, h);
  const E = new Uint8Array(w * h);
  const bx = width / w, by = height / h;
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    if (!low[cy * w + cx] || dt[cy * w + cx] < 3) continue; // interior de la pared, no su contorno
    let mx = 0;
    for (let y = Math.floor(cy * by); y < Math.min(height, Math.ceil((cy + 1) * by)); y++) for (let x = Math.floor(cx * bx); x < Math.min(width, Math.ceil((cx + 1) * bx)); x++) if (G[y * width + x] > mx) mx = G[y * width + x];
    if (mx > edgeThr) E[cy * w + cx] = 1;
  }
  const lab = new Int32Array(w * h).fill(-1), comps = [];
  for (let i = 0; i < E.length; i++) {
    if (!E[i] || lab[i] >= 0) continue;
    const id = comps.length, q = [i];
    lab[i] = id;
    for (let k = 0; k < q.length; k++) {
      const j = q[k], x = j % w, y = Math.floor(j / w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = yy * w + xx;
        if (E[n] && lab[n] < 0) { lab[n] = id; q.push(n); }
      }
    }
    comps.push(q);
  }
  const largos = comps.filter((c) => {
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (const j of c) { const x = j % w, y = Math.floor(j / w); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return Math.max(x1 - x0, y1 - y0) >= edgeMinLen;
  }).sort((a, b) => b.length - a.length).slice(0, edgeBudget);
  debug?.({ bordesInternos: comps.length, largos: largos.map((c) => c.length) });
  const out = [], D = 3;
  for (const c of largos) {
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (const j of c) { const x = j % w, y = Math.floor(j / w); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const vertical = y1 - y0 >= x1 - x0;
    // varias posiciones a lo largo del borde (SAM cambia de máscara según el punto exacto) y los dos lados del borde
    const orden = c.slice().sort((a, b) => (vertical ? Math.floor(a / w) - Math.floor(b / w) : (a % w) - (b % w)));
    for (const q of [0.2, 0.5, 0.8]) {
      const rep = orden[Math.floor(q * (orden.length - 1))], rx = rep % w, ry = Math.floor(rep / w);
      for (const [dx, dy] of vertical ? [[-D, 0], [D, 0]] : [[0, -D], [0, D]]) {
        const x = rx + dx, y = ry + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || !low[y * w + x] || E[y * w + x]) continue;
        out.push({ x: ((x + 0.5) / w) * width, y: ((y + 0.5) / h) * height });
      }
    }
  }
  return out.slice(0, edgeBudget * 6);
}

/**
 * Objetos que CUELGAN o se APOYAN contra el borde de las superficies (un foco o una lámpara en la unión pared/techo, una cortina, un
 * cuadro, un enchufe): SAM los deja afuera de la pared, pero el relleno de sombras (`growIntoGaps`) los vuelve a pintar por abajo
 * porque se parecen a la pared en luz y color. No tienen bordes internos de pared que `edgeSeeds` pueda ver: están en el CONTORNO.
 * Se detectan como lo que "rellena" una clausura morfológica de la unión de superficies: píxeles sin dueño rodeados de superficie
 * (muescas y huecos angostos del contorno). Devuelve semillas (una por muesca, las más grandes primero) con el área de la muesca.
 */
export function hangingSeeds(regions, width, height, { grid = 192, closeR = 0.026, minCells = 10, minThick = 2, maxFrac = 0.03, budget = 4, maxSeeds = 3, debug = null } = {}) {
  const w = grid, h = Math.max(1, Math.round((grid * height) / width)), N = width * height;
  const U = new Uint8Array(N);
  for (const r of regions) for (let i = 0; i < N; i++) if (r.mask[i]) U[i] = 1;
  const low = toLow(U, width, height, w, h), R = closeR * w;
  const notU = new Uint8Array(w * h);
  for (let i = 0; i < notU.length; i++) notU[i] = low[i] ? 0 : 1;
  const dil = distanceTransform(notU, w, h); // distancia a la superficie
  const D = new Uint8Array(w * h);
  for (let i = 0; i < D.length; i++) D[i] = !low[i] && dil[i] > R ? 0 : 1; // dilatada
  const ero = D.includes(0) ? distanceTransform(D, w, h) : new Float32Array(w * h).fill(Infinity); // distancia a lo que quedó afuera de la dilatada (sin nada afuera, todo queda cerrado)
  const notch = new Uint8Array(w * h);
  for (let i = 0; i < notch.length; i++) if (!low[i] && ero[i] > R) notch[i] = 1;
  for (let x = 0; x < w; x++) { notch[x] = 0; notch[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { notch[y * w] = 0; notch[y * w + w - 1] = 0; } // el borde de la foto no es un objeto: el cierre ahí es un artefacto
  const seen = new Uint8Array(w * h), out = [];
  for (let st = 0; st < notch.length; st++) {
    if (!notch[st] || seen[st]) continue;
    const q = [st]; seen[st] = 1;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w;
      if (x > 0 && notch[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; q.push(i - 1); }
      if (x < w - 1 && notch[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; q.push(i + 1); }
      if (i >= w && notch[i - w] && !seen[i - w]) { seen[i - w] = 1; q.push(i - w); }
      if (i < w * h - w && notch[i + w] && !seen[i + w]) { seen[i + w] = 1; q.push(i + w); }
    }
    if (q.length < minCells || q.length > maxFrac * w * h) continue;
    const comp = new Uint8Array(w * h);
    for (const i of q) comp[i] = 1;
    const dt = distanceTransform(comp, w, h);
    let best = q[0];
    for (const i of q) if (dt[i] > dt[best]) best = i;
    if (dt[best] < minThick) continue; // una tira fina (la unión pared/techo, una sombra) no es un objeto
    // semillas: los "máximos" de grosor de la muesca (el plato, el portalámparas y la bombilla de un foco son tres), separados entre sí
    const pt = (i) => ({ x: (((i % w) + 0.5) / w) * width, y: ((Math.floor(i / w) + 0.5) / h) * height });
    const picks = [best];
    for (const i of q.slice().sort((a, b) => dt[b] - dt[a])) {
      if (picks.length >= maxSeeds || dt[i] < Math.max(1.5, dt[best] * 0.4)) break;
      if (picks.every((j) => Math.hypot((i % w) - (j % w), Math.floor(i / w) - Math.floor(j / w)) >= 5)) picks.push(i);
    }
    out.push({ ...pt(best), cells: q.length, thick: dt[best], more: picks.slice(1).map(pt), comp, w, h });
  }
  out.sort((a, b) => b.cells - a.cells);
  debug?.({ muescas: out.map((o) => [+(o.x / width).toFixed(3), +(o.y / height).toFixed(3), o.cells, +o.thick.toFixed(1)]) });
  return out.slice(0, budget);
}

/**
 * Partición por "la máscara más chica gana" (idea: segmentar todo con SAM). Se reparte una grilla de semillas sobre las paredes y se pide la
 * máscara de cada una; cada píxel de pared se queda con el ÁREA de la máscara más chica que lo contiene. Un objeto (tabla, cuadro, estufa),
 * otro plano (techo fusionado, panel) o un hueco aparecen como máscaras bastante más chicas que la pared que los rodea.
 *  - Lo separado con forma de pared o de techo y de tamaño razonable se devuelve como SUPERFICIE NUEVA (`extra`): no se pierde nada, el
 *    cliente decide si la pinta.
 *  - Lo demás (chico, o sin forma de pared) se saca de la pared y queda en `veto` para que el relleno de sombras no lo vuelva a pintar.
 * Conservador: umbral `frac` bajo y, si se llevaría más de `maxLoss` de una pared, no se toca (no es confiable). Guarda solo un mapa de
 * áreas (no las máscaras): la memoria no depende de la cantidad de semillas.
 */
export async function partitionBySmallest(regions, segment, width, height, { grid = 5, frac = 0.3, maxLoss = 0.5, minArea = 0.025, minWall = 0.08, G = null, edgeThr = 4, edgeBudget = 4, edgeMinLen = 14, debug = null } = {}) {
  const N = width * height, veto = new Uint8Array(N), extra = [];
  const paredes = regions.filter((r) => r.kind === 'pared' && r.area >= minWall);
  if (!paredes.length) return { extra, veto, seeds: 0 };
  const inWall = new Uint8Array(N);
  for (const r of paredes) for (let i = 0; i < N; i++) if (r.mask[i]) inWall[i] = 1;
  const small = new Float32Array(N).fill(Infinity);
  let seeds = 0;
  const pts = [];
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    pts.push({ x: Math.min(width - 1, Math.floor(((gx + 0.5) / grid) * width)), y: Math.min(height - 1, Math.floor(((gy + 0.5) / grid) * height)) });
  }
  // Semillas guiadas por bordes: una puerta, un marco o un cuadro del color de la pared son angostos y la grilla no cae encima, pero dejan bordes
  // LARGOS dentro de la pared. Se buscan esos bordes (lejos del contorno de la pared) y se ponen semillas a ambos lados: SAM devuelve el objeto solo.
  if (G && edgeBudget > 0) pts.push(...edgeSeeds(paredes, G, width, height, { edgeThr, edgeBudget, edgeMinLen, debug }));
  for (const [pi, { x, y }] of pts.entries()) {
    const m = await segment([{ x, y }]);
    if (debug && pi >= grid * grid) { let c = 0; for (let i = 0; i < N; i++) if (m[i]) c++; debug({ semillaBorde: [+(x / width).toFixed(3), +(y / height).toFixed(3)], mascara: +(c / N).toFixed(4) }); }
    seeds++;
    let a = 0;
    for (let i = 0; i < N; i++) if (m[i]) a++;
    if (a < N * 0.002) continue;
    for (let i = 0; i < N; i++) if (m[i] && a < small[i]) small[i] = a;
  }
  for (const r of paredes) {
    let wa = 0;
    for (let i = 0; i < N; i++) if (r.mask[i]) wa++;
    let carved = new Uint8Array(N), c = 0;
    for (let i = 0; i < N; i++) if (r.mask[i] && small[i] < frac * wa) { carved[i] = 1; c++; }
    debug?.({ pared: r.name, semillas: seeds, separado: +(c / wa).toFixed(3) });
    if (!c) continue;
    if (c / wa > maxLoss) { debug?.({ pared: r.name, veredicto: 'no se toca: se llevaría demasiado', perdida: +(c / wa).toFixed(2) }); continue; }
    carved = removeSmallIslands(carved, width, height, Math.round(N * 0.0008)); // motas sueltas: ruido, no un objeto
    // componentes conexas de lo separado
    const seen = new Uint8Array(N), q = new Int32Array(N);
    for (let st = 0; st < N; st++) {
      if (!carved[st] || seen[st]) continue;
      let head = 0, tail = 0;
      q[tail++] = st; seen[st] = 1;
      while (head < tail) {
        const i = q[head++], x = i % width;
        if (x > 0 && carved[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; q[tail++] = i - 1; }
        if (x < width - 1 && carved[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; q[tail++] = i + 1; }
        if (i >= width && carved[i - width] && !seen[i - width]) { seen[i - width] = 1; q[tail++] = i - width; }
        if (i < N - width && carved[i + width] && !seen[i + width]) { seen[i + width] = 1; q[tail++] = i + width; }
      }
      const comp = new Uint8Array(N);
      for (let k = 0; k < tail; k++) comp[q[k]] = 1;
      const g = maskGeometry(comp, width, height);
      const kind = g.area >= minArea ? classifySurface(g) : null;
      for (let k = 0; k < tail; k++) r.mask[q[k]] = 0;
      debug?.({ pared: r.name, area: +g.area.toFixed(3), destino: kind ? `superficie nueva (${kind})` : 'se saca (objeto)' });
      if (kind) extra.push({ kind, mask: comp, ...g, texture: 0, luma: r.luma });
      else for (let k = 0; k < tail; k++) veto[q[k]] = 1;
    }
    r.mask = removeSmallIslands(r.mask, width, height, Math.round(N * 0.002));
  }
  return { extra, veto, seeds };
}

/**
 * Rellena la pared que se ve a través de huecos FINOS de un objeto (entre los listones de una silla, una reja, una baranda). SAM trata el
 * objeto como sólido y deja afuera esos huecos aunque ahí se vea la pared de atrás. Un píxel sin dueño se suma a la pared si: (1) tiene el
 * color y la luz de esa pared, (2) está cerca de ella (`maxDist`) y (3) pertenece a una tira fina (no sobrevive a una apertura de radio
 * `thinR`): un objeto grande del color de la pared (un refrigerador blanco, una tabla) NO es fino y queda afuera. Con tope por pared.
 */
export function fillThinGaps(regions, img, { blocked = null, maxDist = Math.round(img.width * 0.2), thinR = Math.max(6, Math.round(img.width * 0.03)), tolLuma = 22, tolChroma = 0.03, maxAdd = 0.03, darkDelta = 45, minDarkRing = 0.75, minDarkAll = 0.4, sandwich = Math.round(img.width * 0.06), debug = null } = {}) {
  const { data, width, height } = img;
  const N = width * height;
  const owner = new Uint8Array(N);
  for (const r of regions) for (let i = 0; i < N; i++) if (r.mask[i]) owner[i] = 1;
  const lum = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2], t = R + G + B + 1e-3;
    lum[i] = 0.2126 * R + 0.7152 * G + 0.0722 * B; cr[i] = R / t; cg[i] = G / t;
  }
  for (const r of regions) {
    if (r.kind !== 'pared') continue;
    const sl = [], sr = [], sg = [];
    for (let i = 0; i < N; i += 7) if (r.mask[i]) { sl.push(lum[i]); sr.push(cr[i]); sg.push(cg[i]); }
    if (sl.length < 50) continue;
    const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
    const ml = med(sl), mr = med(sr), mg = med(sg);
    const notWall = new Uint8Array(N);
    for (let i = 0; i < N; i++) notWall[i] = r.mask[i] ? 0 : 1;
    const d = distanceTransform(notWall, width, height); // distancia (px) a la pared, para los píxeles que no lo son
    // Encajonado por un objeto oscuro: el hueco entre listones queda entre dos partes oscuras del mismo objeto (arriba y abajo, o a los costados),
    // a una distancia corta. El marco de una puerta, el borde de un mueble o una sábana tienen lo oscuro de un solo lado: no se rellenan.
    const BIG = 65535, dark = new Uint8Array(N);
    for (let i = 0; i < N; i++) dark[i] = lum[i] < ml - darkDelta ? 1 : 0;
    const dl = new Uint16Array(N).fill(BIG), dr = new Uint16Array(N).fill(BIG), du = new Uint16Array(N).fill(BIG), dd = new Uint16Array(N).fill(BIG);
    for (let y = 0; y < height; y++) {
      let last = -1;
      for (let x = 0; x < width; x++) { const i = y * width + x; if (dark[i]) last = x; else if (last >= 0) dl[i] = Math.min(BIG - 1, x - last); }
      last = -1;
      for (let x = width - 1; x >= 0; x--) { const i = y * width + x; if (dark[i]) last = x; else if (last >= 0) dr[i] = Math.min(BIG - 1, last - x); }
    }
    for (let x = 0; x < width; x++) {
      let last = -1;
      for (let y = 0; y < height; y++) { const i = y * width + x; if (dark[i]) last = y; else if (last >= 0) du[i] = Math.min(BIG - 1, y - last); }
      last = -1;
      for (let y = height - 1; y >= 0; y--) { const i = y * width + x; if (dark[i]) last = y; else if (last >= 0) dd[i] = Math.min(BIG - 1, last - y); }
    }
    const cand = new Uint8Array(N);
    let nc = 0;
    for (let i = 0; i < N; i++) {
      if (owner[i] || (blocked && blocked[i]) || d[i] > maxDist) continue;
      if (!((dl[i] <= sandwich && dr[i] <= sandwich) || (du[i] <= sandwich && dd[i] <= sandwich))) continue;
      if (Math.abs(lum[i] - ml) > tolLuma || Math.abs(cr[i] - mr) + Math.abs(cg[i] - mg) > tolChroma) continue;
      cand[i] = 1; nc++;
    }
    if (!nc) continue;
    const opened = openMask(cand, width, height, thinR);
    let add = new Uint8Array(N), na = 0;
    for (let i = 0; i < N; i++) if (cand[i] && !opened[i]) { add[i] = 1; na++; }
    const etapaFinos = na;
    add = removeSmallIslands(add, width, height, Math.round(N * 0.0004));
    let etapaIslas = 0;
    for (let i = 0; i < N; i++) if (add[i]) etapaIslas++;
    const addAntes = debug ? add.slice() : null; // (solo para diagnóstico)
    // Por cada hueco: qué parte de su contorno toca algo oscuro (3 px afuera). Rodeado casi por completo por lo oscuro = hueco de un objeto.
    // Contra la pared de un lado y el pasillo del otro (marco de puerta), o contra tela y sombras (una sábana), no alcanza.
    {
      const seen = new Uint8Array(N), q = new Int32Array(N), K = 3;
      for (let st = 0; st < N; st++) {
        if (!add[st] || seen[st]) continue;
        let head = 0, tail = 0, ring = 0, ringDark = 0, ringAll = 0;
        q[tail++] = st; seen[st] = 1;
        while (head < tail) {
          const i = q[head++], x = i % width, y = (i - x) / width;
          if (x > 0 && add[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; q[tail++] = i - 1; }
          if (x < width - 1 && add[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; q[tail++] = i + 1; }
          if (y > 0 && add[i - width] && !seen[i - width]) { seen[i - width] = 1; q[tail++] = i - width; }
          if (y < height - 1 && add[i + width] && !seen[i + width]) { seen[i + width] = 1; q[tail++] = i + width; }
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { // pixel de contorno: tiene un vecino que no es del hueco
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || add[ny * width + nx]) continue;
            const fx = Math.min(width - 1, Math.max(0, x + dx * K)), fy = Math.min(height - 1, Math.max(0, y + dy * K));
            const j = fy * width + fx;
            // Qué hay del otro lado del contorno: lo oscuro (el objeto) suma; la pared YA pintada resta (el hueco no sigue contra la pared: es un marco o un
            // borde); pared sin pintar con color parecido (la prolongación del mismo hueco, apenas fuera de tolerancia) no cuenta; el resto resta.
            ringAll++;
            if (dark[j]) { ring++; ringDark++; }
            else if (r.mask[j]) ring++;
            else if (Math.abs(lum[j] - ml) <= tolLuma * 2 && Math.abs(cr[j] - mr) + Math.abs(cg[j] - mg) <= tolChroma * 2) { /* neutro */ }
            else ring++;
          }
        }
        if (!ring || ringDark / ring < minDarkRing || ringDark / ringAll < minDarkAll) for (let k = 0; k < tail; k++) add[q[k]] = 0;
      }
    }
    na = 0;
    for (let i = 0; i < N; i++) if (add[i]) na++;
    debug?.({ pared: r.name, candidatos: +(nc / N).toFixed(4), finos: +(etapaFinos / N).toFixed(4), traslaslas: +(etapaIslas / N).toFixed(4), traselcontorno: +(na / N).toFixed(4), add: addAntes });
    if (!na || na > maxAdd * N) continue;
    for (let i = 0; i < N; i++) if (add[i]) { r.mask[i] = 1; owner[i] = 1; }
  }
  return regions;
}

/**
 * Saca de las paredes la franja angosta que queda ENCERRADA entre un objeto con textura (el vidrio con paisaje de un ventanal) y una arista
 * larga: el marco de aluminio. SAM lo agrupa con la pared porque es del mismo gris liso, pero un marco siempre está entre el vidrio y la pared.
 * Desde píxeles lisos pegados al objeto (a `seedDist` px) se inunda la pared SIN cruzar aristas (gradiente > `edgeThr`) y sin alejarse más de
 * `maxDist` del objeto. Si la zona inundada está cerrada por una arista (casi no se escapa: `maxLeak`) y la arista es larga (`minEdge` px),
 * es un marco: se saca de la pared. Si la pared llega al vidrio sin arista de por medio, la inundación se escapa y no se toca nada.
 * Modifica las máscaras de `regions` y devuelve un mapa 0/1 de lo sacado (para que nada lo vuelva a pintar).
 */
export function cutFramesBesideObjects(regions, objects, G, width, height, { maxDist = Math.round(width * 0.05), edgeThr = 3, seedMax = 2, seedDist = [3, 14], minArea = 0.002, maxArea = 0.05, maxLeak = 0.1, minEdge = Math.round(height * 0.06), pad = 2, debug = null } = {}) {
  const N = width * height, cut = new Uint8Array(N);
  if (!objects.length) return cut;
  const T = new Uint8Array(N);
  for (const o of objects) for (let i = 0; i < N; i++) if (o[i]) T[i] = 1;
  const notT = new Uint8Array(N);
  for (let i = 0; i < N; i++) notT[i] = T[i] ? 0 : 1;
  const dT = distanceTransform(notT, width, height); // px hasta el objeto
  const q = new Int32Array(N);
  for (const r of regions) {
    if (r.kind !== 'pared') continue;
    // dominio: la pared misma y lo que no es de ninguna superficie (el marco puede haber quedado afuera de la máscara de SAM, pero igual hay que
    // marcarlo para que el relleno de sombras no lo pinte). Lo que es de otra superficie y el objeto quedan afuera.
    const dom = new Uint8Array(N), seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) dom[i] = T[i] ? 0 : 1;
    for (const o of regions) if (o !== r) for (let i = 0; i < N; i++) if (o.mask[i]) dom[i] = 0;
    const inB = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i++) if (dom[i] && dT[i] <= maxDist) { inB[i] = 1; if (r.mask[i]) any = true; }
    if (!any) continue;
    for (let st = 0; st < N; st++) {
      if (!inB[st] || seen[st] || G[st] >= seedMax || dT[st] < seedDist[0] || dT[st] > seedDist[1] || !r.mask[st]) continue;
      let head = 0, tail = 0;
      q[tail++] = st; seen[st] = 1;
      while (head < tail) {
        const i = q[head++], x = i % width;
        for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < N - width ? i + width : -1]) {
          if (n < 0 || seen[n] || !inB[n] || G[n] > edgeThr) continue;
          seen[n] = 1; q[tail++] = n;
        }
      }
      // ¿cerrada por una arista? se mira con qué se topa la zona inundada (el objeto y las otras superficies no cuentan)
      const inC = new Uint8Array(N);
      for (let k = 0; k < tail; k++) inC[q[k]] = 1;
      let edge = 0, leak = 0;
      for (let k = 0; k < tail; k++) {
        const i = q[k], x = i % width;
        for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < N - width ? i + width : -1]) {
          if (n < 0 || inC[n] || !dom[n]) continue;
          if (G[n] > edgeThr) edge++; else leak++;
        }
      }
      const area = tail / N, leakFrac = leak / Math.max(1, edge + leak);
      debug?.({ pared: r.name, area: +area.toFixed(4), arista: edge, escape: +leakFrac.toFixed(3) });
      if (area < minArea || area > maxArea || edge < minEdge || leakFrac > maxLeak) continue;
      // se saca la zona y `pad` px alrededor (la arista misma)
      let front = Array.from(q.subarray(0, tail));
      for (let d = 0; d < pad; d++) {
        const next = [];
        for (const i of front) {
          const x = i % width;
          for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < N - width ? i + width : -1]) {
            if (n < 0 || inC[n] || !dom[n]) continue;
            inC[n] = 1; next.push(n);
          }
        }
        front = next;
      }
      for (let i = 0; i < N; i++) if (inC[i]) { r.mask[i] = 0; cut[i] = 1; }
      r.mask = removeSmallIslands(r.mask, width, height, Math.round(N * 0.002));
    }
  }
  return cut;
}

/**
 * Suma a la pared la franja angosta de pared en sombra que quedó huérfana junto a una puerta o un marco (la cara lateral de una esquina, a un
 * lado del marco de una puerta). SAM la agrupa con la puerta y, al sacar la puerta, queda sin dueño. Una puerta entera NO se puede distinguir por
 * color ni por luz (ya se intentó: se pintó la puerta); lo que distingue a la franja es la forma y la continuidad con la pared:
 *  - se inunda desde píxeles lisos pegados al contorno de la pared sobre lo que no es de nadie, SIN cruzar aristas ni alejarse más de `maxDist`;
 *  - la zona tiene que ser una tira (angosta, larga y recta) pegada a la pared a lo largo de casi todo su largo y cerrada por una arista del otro
 *    lado (`maxLeak`): una puerta o un mueble está a más distancia de la pared o se escapa;
 *  - tiene que ser neutra como la pared (croma casi igual: `maxChroma`) y no más clara que ella (una sombra la oscurece; un marco iluminado, una
 *    puerta blanca o un objeto brillante, no) ni demasiado oscura (un zócalo, un hueco).
 * Devuelve la cantidad de zonas sumadas. Modifica las máscaras de `regions`.
 */
export function addShadowStrips(regions, img, G, blocked, { maxDist = Math.round(img.width * 0.035), edgeThr = 2.5, seedMax = 2, seedDist = [3, 14], minWidth = Math.round(img.width * 0.009), maxWidth = Math.round(img.width * 0.025), minLength = 0.17, minElong = 3, minContact = 0.8, near = 8, maxLeak = 0.1, minEdge = Math.round(img.height * 0.05), maxChroma = 0.01, lumaRange = [0.5, 0.88], pad = 2, debug = null } = {}) {
  const { data, width, height } = img, N = width * height;
  const lum = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N);
  for (let i = 0; i < N; i++) { const R = data[i * 4], Gc = data[i * 4 + 1], B = data[i * 4 + 2], t = R + Gc + B + 1e-3; lum[i] = 0.2126 * R + 0.7152 * Gc + 0.0722 * B; cr[i] = R / t; cg[i] = Gc / t; }
  const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  const owned = new Uint8Array(N);
  for (const r of regions) for (let i = 0; i < N; i++) if (r.mask[i]) owned[i] = 1;
  const q = new Int32Array(N);
  let added = 0;
  for (const r of regions) {
    if (r.kind !== 'pared') continue;
    const notW = new Uint8Array(N);
    for (let i = 0; i < N; i++) notW[i] = r.mask[i] ? 0 : 1;
    const dW = distanceTransform(notW, width, height);
    const dom = new Uint8Array(N), seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) dom[i] = !owned[i] && !(blocked && blocked[i]) && dW[i] <= maxDist ? 1 : 0;
    const wl = [], wr = [], wg = [];
    for (let i = 0; i < N; i += 11) if (r.mask[i]) { wl.push(lum[i]); wr.push(cr[i]); wg.push(cg[i]); }
    if (wl.length < 50) continue;
    const ml = med(wl), mr = med(wr), mg = med(wg);
    for (let st = 0; st < N; st++) {
      if (!dom[st] || seen[st] || G[st] >= seedMax || dW[st] < seedDist[0] || dW[st] > seedDist[1]) continue;
      let head = 0, tail = 0;
      q[tail++] = st; seen[st] = 1;
      while (head < tail) {
        const i = q[head++], x = i % width;
        for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < N - width ? i + width : -1]) {
          if (n < 0 || seen[n] || !dom[n] || G[n] > edgeThr) continue;
          seen[n] = 1; q[tail++] = n;
        }
      }
      if (tail < 0.0015 * N) continue;
      const inC = new Uint8Array(N);
      let x0 = width, x1 = 0, y0 = height, y1 = 0;
      const sl = [], sr = [], sg = [];
      for (let k = 0; k < tail; k++) {
        const i = q[k], x = i % width, y = (i - x) / width;
        inC[i] = 1;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (k % 3 === 0) { sl.push(lum[i]); sr.push(cr[i]); sg.push(cg[i]); }
      }
      let edge = 0, leak = 0, contact = 0;
      for (let k = 0; k < tail; k++) {
        const i = q[k], x = i % width;
        for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < N - width ? i + width : -1]) {
          if (n < 0 || inC[n]) continue;
          if (r.mask[n]) { contact++; continue; }
          if (owned[n] || (blocked && blocked[n])) continue;
          if (G[n] > edgeThr) edge++; else leak++;
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, major = Math.max(bw, bh), ancho = tail / major;
      // pegada a la pared a lo largo de la tira: en cuántas filas (o columnas, si es horizontal) algún píxel de la zona está a <= `near` px de la pared
      // (no se pide contacto directo: entre la franja y la pared hay una arista suave, la esquina)
      const rowsNear = new Uint8Array(major), rowsAll = new Uint8Array(major);
      for (let k = 0; k < tail; k++) { const i = q[k], x = i % width, y = (i - x) / width, t = bh >= bw ? y - y0 : x - x0; rowsAll[t] = 1; if (dW[i] <= near) rowsNear[t] = 1; }
      let nNear = 0, nAll = 0;
      for (let t = 0; t < major; t++) { nAll += rowsAll[t]; nNear += rowsNear[t]; }
      const lr = med(sl) / ml, dchr = Math.abs(med(sr) - mr) + Math.abs(med(sg) - mg), escape = leak / Math.max(1, edge + leak), contactFrac = nNear / Math.max(1, nAll);
      const f = { pared: r.name, area: +(tail / N).toFixed(4), bbox: [x0 / width, y0 / height, x1 / width, y1 / height].map((v) => +v.toFixed(2)), ancho: +ancho.toFixed(1), largo: +(major / Math.max(width, height)).toFixed(2), alarg: +(major / ancho).toFixed(1), contacto: +contactFrac.toFixed(2), arista: edge, escape: +escape.toFixed(2), luz: +lr.toFixed(2), croma: +dchr.toFixed(3) };
      const ok = ancho >= minWidth && ancho <= maxWidth && major >= minLength * Math.max(width, height) && major / ancho >= minElong && contactFrac >= minContact && escape <= maxLeak && edge >= minEdge && dchr <= maxChroma && lr >= lumaRange[0] && lr <= lumaRange[1];
      debug?.({ ...f, ok });
      if (!ok) continue;
      for (let k = 0; k < tail; k++) { r.mask[q[k]] = 1; owned[q[k]] = 1; }
      added++;
    }
  }
  return added;
}

/**
 * Detecta las superficies de la foto.
 *  img      : {data RGBA, width, height} (foto de trabajo)
 *  segment  : async (points: [{x, y}]) => Uint8Array(width*height) 0/1, ya limpia — región que contiene TODOS esos puntos
 *             (todos son "esto es pared", como los toques verdes de la app)
 * Devuelve [{ kind: 'pared'|'techo', name, mask, area, cx, cy, texture }], máscaras DISJUNTAS, paredes de izquierda a derecha.
 */
export async function detectSurfaces(img, segment, opts = {}) {
  const { maxSeeds = 9, gradMax = 7, minDist = 2.5, minArea = 0.025, maxPared = 5, maxTexture = 0.12, refineMin = 2, minLumaRatio = 0.55, grow = true, snap = true, partition = true, hang = true, lockObjects = true, thinGaps = true, frames = true, strips = true, blockRejected = true, splitMax = 2.2, splitEdge = 4.5, maxLine = 0.004, minCoverage = 0.35, relaxFactor = 1.8, corner = true } = opts;
  const { width, height } = img;
  const { luma, w, h } = downscaleLuma(img);
  const grad = gradientMap(luma, w, h);
  const freeOrig = new Uint8Array(w * h); // (se reutiliza en la segunda pasada)
  for (let i = 0; i < freeOrig.length; i++) freeOrig[i] = grad[i] < gradMax ? 1 : 0;
  const free = Uint8Array.from(freeOrig);
  const toFull = (x, y) => ({ x: ((x + 0.5) / w) * width, y: ((y + 0.5) / h) * height });

  let fullGradCache = null; // gradiente a resolución completa: se calcula solo si hace falta dividir una máscara
  const fullGrad = () => {
    if (!fullGradCache) {
      const lum = new Float32Array(width * height);
      for (let i = 0; i < lum.length; i++) lum[i] = 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
      fullGradCache = gradientMap(lum, width, height);
    }
    return fullGradCache;
  };
  const found = []; // {mask, g}
  const seedPass = async (texGrad) => {
  for (let it = 0; it < maxSeeds; it++) {
    const d = distanceTransform(free, w, h);
    let best = -1, bd = minDist;
    for (let i = 0; i < d.length; i++) if (d[i] > bd) { bd = d[i]; best = i; }
    if (best < 0) break;
    const sx = best % w, sy = Math.floor(best / w);
    const pts = [toFull(sx, sy)];
    let mask = await segment(pts);
    let low = toLow(mask, width, height, w, h);
    // Refinado (como un segundo toque del usuario): si en la misma zona lisa queda un pedazo grande sin cubrir, se suma como punto.
    const comp = component(freeOrig, w, h, best);
    for (let r = 0; r < 2; r++) {
      const left = new Uint8Array(w * h);
      let nLeft = 0;
      for (let i = 0; i < left.length; i++) if (comp[i] && !low[i]) { left[i] = 1; nLeft++; }
      if (nLeft / (w * h) < refineMin) break;
      const dl = distanceTransform(left, w, h);
      let b2 = -1, v2 = 2;
      for (let i = 0; i < dl.length; i++) if (dl[i] > v2) { v2 = dl[i]; b2 = i; }
      if (b2 < 0) break;
      pts.push(toFull(b2 % w, Math.floor(b2 / w)));
      mask = await segment(pts);
      low = toLow(mask, width, height, w, h);
    }
    // lo cubierto (por el segmentador y por un disco alrededor del toque) ya no genera más toques
    for (let i = 0; i < free.length; i++) if (low[i]) free[i] = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - sx, y - sy) <= bd) free[y * w + x] = 0;
    // Solo se divide lo que ya parece pared: un techo con una franja de sombra no es dos superficies.
    const partes = classifySurface(maskGeometry(mask, width, height)) === 'techo' ? [mask] : splitMerged(mask, grad, w, h, width, height, { strictMax: splitMax, minEdge: splitEdge, debug: opts.debugSplit, fullGrad });
    for (const parte of partes) {
      const g = maskGeometry(parte, width, height);
      if (g.area < minArea) continue;
      if (found.some((f) => { const r = iouAndContain(f.mask, parte); return r.iou > 0.6 || r.inB > 0.85; })) continue;
      const lp = toLow(parte, width, height, w, h);
      let ls = 0, ln = 0;
      for (let i = 0; i < lp.length; i++) if (lp[i]) { ls += luma[i]; ln++; }
      found.push({ mask: parte, g, texture: textureRatio(lp, grad, w, h, texGrad * 1.5), luma: ln ? ls / ln : 0, line: lineRatio(parte, fullGrad(), width, height, 10) });
      if (opts.debugLines) { const G = fullGrad(); found[found.length - 1].lines = opts.debugLines.map((t) => lineRatio(parte, G, width, height, t)); }
    }
  }
  };
  await seedPass(gradMax);

  // Segunda pasada: una pared rugosa (revoque salpicado, pintura con textura) no tiene zonas "lisas" con el umbral normal y se queda sin
  // semilla. Si lo detectado cubre poco, se vuelve a buscar donde falta con un umbral más tolerante. En las fotos que ya cubren bien
  // no corre, así que no cambia nada de lo que ya funciona.
  const cobertura = () => found.filter((f) => classifySurface(f.g) && !(f.texture > maxTexture) && !(f.line > maxLine)).reduce((a, f) => a + f.g.area, 0);
  if (cobertura() < minCoverage) {
    const relaxed = gradMax * relaxFactor;
    const cubierto = new Uint8Array(w * h);
    for (const f of found) { const lo = toLow(f.mask, width, height, w, h); for (let i = 0; i < lo.length; i++) if (lo[i]) cubierto[i] = 1; }
    for (let i = 0; i < freeOrig.length; i++) { freeOrig[i] = grad[i] < relaxed && !cubierto[i] ? 1 : 0; free[i] = freeOrig[i]; }
    await seedPass(relaxed);
  }

  // disjuntas: lo más grande manda; lo que queda de cada una se limpia
  found.sort((a, b) => b.g.area - a.g.area);
  const taken = new Uint8Array(width * height);
  const out = [], rechazadas = [];
  for (const f of found) {
    const m = new Uint8Array(width * height);
    for (let i = 0; i < m.length; i++) if (f.mask[i] && !taken[i]) m[i] = 1;
    const clean = removeSmallIslands(m, width, height, Math.round(width * height * 0.002));
    const g = maskGeometry(clean, width, height);
    let kind = classifySurface(g);
    if (kind === 'pared' && f.texture > maxTexture) kind = null; // vidrio con paisaje, puerta con paneles, mueble…
    if (kind === 'pared' && f.line > maxLine) kind = null; // azulejo: las juntas son líneas finas y rectas que una pared no tiene
    if (!kind) { rechazadas.push({ ...g, mask: clean, texture: f.texture, luma: f.luma, lines: f.lines }); continue; }
    for (let i = 0; i < clean.length; i++) if (clean[i]) taken[i] = 1;
    out.push({ kind, mask: clean, ...g, texture: f.texture, luma: f.luma, lines: f.lines });
  }

  // Un hueco de puerta o pasillo oscuro se ve mucho más oscuro que las paredes de la habitación: no es una pared a pintar.
  const refLuma = Math.max(0, ...out.filter((s) => s.kind === 'pared').slice(0, 1).map((s) => s.luma)); // `out` ya viene del más grande al más chico
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].kind === 'pared' && out[i].luma < refLuma * minLumaRatio) { rechazadas.push(out[i]); out.splice(i, 1); }
  }
  let veto = null;
  if (frames && out.length) { // marco de un ventanal pegado al vidrio: se saca de la pared y no se vuelve a pintar
    const objetos = rechazadas.filter((r) => r.mask && r.texture > maxTexture && r.area >= 0.02).map((r) => r.mask);
    const cortado = cutFramesBesideObjects(out, objetos, fullGrad(), width, height, { ...opts.frameOpts, debug: opts.debugFrames });
    if (cortado.some((v) => v)) veto = cortado;
  }
  if (partition && out.length) { // "la máscara más chica gana": objetos y otros planos pegados a la pared
    const pr = await partitionBySmallest(out, segment, width, height, { G: fullGrad(), ...opts.partitionOpts, debug: opts.debugPartition });
    out.push(...pr.extra);
    if (veto) for (let i = 0; i < veto.length; i++) { if (pr.veto[i]) veto[i] = 1; }
    else veto = pr.veto;
  }
  if (hang && out.length) { // objetos que cuelgan o se apoyan en el contorno: se vetan para que el relleno no los pinte
    const N = width * height, ho = opts.hangOpts ?? {};
    let left = ho.decodes ?? 4;
    for (const sd of hangingSeeds(out, width, height, { ...ho, debug: opts.debugHang })) {
      veto = veto ?? new Uint8Array(N);
      for (const pt of [sd, ...sd.more]) {
        if (left <= 0) break;
        if (veto[Math.min(height - 1, Math.floor(pt.y)) * width + Math.min(width - 1, Math.floor(pt.x))]) continue; // ya cubierto por la máscara de otra semilla: no hace falta decodificar
        left--;
        const m = await segment([{ x: pt.x, y: pt.y }]);
        let a = 0;
        for (let i = 0; i < N; i++) if (m[i]) a++;
        const muesca = sd.cells / (sd.w * sd.h);
        const ok = a > 0 && a <= (ho.maxGrowth ?? 8) * muesca * N && a < N * (ho.maxFrac ?? 0.05);
        opts.debugHang?.({ semilla: [+(pt.x / width).toFixed(3), +(pt.y / height).toFixed(3)], muesca: +muesca.toFixed(4), mascara: +(a / N).toFixed(4), ok });
        if (!ok) break; // SAM devolvió la pared o el techo entero (la semilla no cayó sobre un objeto): las otras semillas de la muesca tampoco sirven
        for (let i = 0; i < N; i++) if (m[i]) veto[i] = 1;
      }
    }
  }
  if (grow) {
    // El relleno de sombras no entra en el piso que el segmentador ya encontró (una franja chica pegada al borde de abajo, rechazada): una pared no se
    // estira sobre el zócalo y el piso. Solo el piso: bloquear cualquier región rechazada le sacaba a las paredes hasta 3 puntos legítimos.
    let bloqueo = veto;
    if (blockRejected && rechazadas.length) {
      for (const r of rechazadas) {
        if (!r.mask || r.area < 0.02 || r.cy < 0.85 || r.top < 0.7) continue;
        if (bloqueo === veto) bloqueo = veto ? Uint8Array.from(veto) : new Uint8Array(width * height);
        for (let i = 0; i < bloqueo.length; i++) if (r.mask[i]) bloqueo[i] = 1;
      }
    }
    growIntoGaps(out, img, { blocked: bloqueo, ...opts.growOpts });
  }
  if (thinGaps) fillThinGaps(out, img, { blocked: veto, ...opts.gapOpts, debug: opts.debugGaps }); // pared que se ve entre los listones de una silla
  if (strips && out.length) addShadowStrips(out, img, fullGrad(), veto, { ...opts.stripOpts, debug: opts.debugStrips }); // franja de pared en sombra junto a una puerta
  if (snap && out.length) {
    refineEdges(out, fullGrad(), width, height, { locked: lockObjects ? veto : null });
    for (const s of out) s.mask = removeSmallIslands(s.mask, width, height, Math.round(width * height * 0.002));
  }
  for (const s of out) Object.assign(s, maskGeometry(s.mask, width, height));
  if (corner) { // esquina vertical suave (dos paredes que se juntan sin arista): solo con la imagen, sin decodificaciones extra
    for (const s of [...out]) {
      if (s.kind !== 'pared') continue;
      const c = findVerticalCorner(s.mask, img, { ...opts.cornerOpts, debug: opts.debugCorner });
      if (!c) continue;
      const partes = splitAtCorner(s.mask, width, height, c).map((m) => removeSmallIslands(m, width, height, Math.round(width * height * 0.002)));
      out.splice(out.indexOf(s), 1, ...partes.map((m) => ({ ...s, mask: m, ...maskGeometry(m, width, height) })));
    }
  }
  const paredes = out.filter((s) => s.kind === 'pared').sort((a, b) => b.area - a.area).slice(0, maxPared).sort((a, b) => a.cx - b.cx);
  const techo = out.filter((s) => s.kind === 'techo').sort((a, b) => b.area - a.area).slice(0, 1);
  const nombre = (i, n) => (n === 1 ? 'Pared' : n === 2 ? ['Pared izquierda', 'Pared derecha'][i] : n === 3 ? ['Pared izquierda', 'Pared del medio', 'Pared derecha'][i] : `Pared ${i + 1}`);
  const lista = [...paredes.map((s, i) => ({ ...s, name: nombre(i, paredes.length) })), ...techo.map((s) => ({ ...s, name: 'Techo' }))];
  lista.rechazadas = rechazadas;
  return lista;
}
