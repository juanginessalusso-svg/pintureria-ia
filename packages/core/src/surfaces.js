// Detección automática de superficies (paredes y techo) para que el cliente no tenga que tocar nada.
// Sin modelos nuevos: se buscan zonas lisas de la foto, el centro de cada una se usa como "toque" automático
// para el segmentador (MobileSAM) y las máscaras resultantes se ordenan, se hacen disjuntas y se clasifican.
// Todo es puro (sin DOM ni ONNX): `segment` lo inyecta quien llama.
import { removeSmallIslands } from './recolor.js';

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
export function growIntoGaps(regions, img, { step = 1.6, maxGrow = Math.round(img.width * 0.07), chromaTol = 0.018, maxBrighter = 12, blocked = null } = {}) {
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
  for (let i = 0; i < n; i++) if (owner[i] >= 0) {
    const x = i % width;
    if ((x > 0 && owner[i - 1] < 0) || (x < width - 1 && owner[i + 1] < 0) || (i >= width && owner[i - width] < 0) || (i < n - width && owner[i + width] < 0)) frontier.push(i);
  }
  for (let depth = 0; depth < maxGrow && frontier.length; depth++) {
    const next = [];
    for (const i of frontier) {
      const x = i % width, k = owner[i], [mr, mg, ml] = mean[k];
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < n - width ? i + width : -1]) {
        if (j < 0 || owner[j] >= 0 || (blocked && blocked[j]) || Math.abs(L[j] - L[i]) > step) continue;
        if (Math.abs(chr[j] - mr) + Math.abs(chg[j] - mg) > chromaTol) continue;
        if (L[j] > ml + maxBrighter) continue; // más brillante que la pared: una lamparita, un reflejo, un objeto blanco
        owner[j] = k; regions[k].mask[j] = 1; next.push(j);
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
export function refineEdges(regions, G, width, height, { band = Math.max(4, Math.round(width / 100)), edgeCost = 1.5 } = {}) {
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
  for (let i = 0; i < N; i++) if (near[i] > 1e-4) inBand[i] = 1;
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
export async function partitionBySmallest(regions, segment, width, height, { grid = 5, frac = 0.3, maxLoss = 0.5, minArea = 0.025, minWall = 0.08, onlyWalls = false, debug = null } = {}) {
  const N = width * height, veto = new Uint8Array(N), extra = [];
  const paredes = regions.filter((r) => r.kind === 'pared' && r.area >= minWall);
  if (!paredes.length) return { extra, veto, seeds: 0 };
  const inWall = new Uint8Array(N);
  for (const r of paredes) for (let i = 0; i < N; i++) if (r.mask[i]) inWall[i] = 1;
  const small = new Float32Array(N).fill(Infinity);
  let seeds = 0;
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    const x = Math.min(width - 1, Math.floor(((gx + 0.5) / grid) * width)), y = Math.min(height - 1, Math.floor(((gy + 0.5) / grid) * height));
    if (onlyWalls && !inWall[y * width + x]) continue; // por defecto toda la foto: un objeto suele tener semillas buenas FUERA de la pared (la parte gris de la tabla)
    const m = await segment([{ x, y }]);
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
 * Detecta las superficies de la foto.
 *  img      : {data RGBA, width, height} (foto de trabajo)
 *  segment  : async (points: [{x, y}]) => Uint8Array(width*height) 0/1, ya limpia — región que contiene TODOS esos puntos
 *             (todos son "esto es pared", como los toques verdes de la app)
 * Devuelve [{ kind: 'pared'|'techo', name, mask, area, cx, cy, texture }], máscaras DISJUNTAS, paredes de izquierda a derecha.
 */
export async function detectSurfaces(img, segment, opts = {}) {
  const { maxSeeds = 9, gradMax = 7, minDist = 2.5, minArea = 0.025, maxPared = 5, maxTexture = 0.12, refineMin = 2, minLumaRatio = 0.55, grow = true, snap = true, partition = true, splitMax = 2.2, splitEdge = 4.5, maxLine = 0.004, minCoverage = 0.35, relaxFactor = 1.8 } = opts;
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
    if (!kind) { rechazadas.push({ ...g, texture: f.texture, luma: f.luma, lines: f.lines }); continue; }
    for (let i = 0; i < clean.length; i++) if (clean[i]) taken[i] = 1;
    out.push({ kind, mask: clean, ...g, texture: f.texture, luma: f.luma, lines: f.lines });
  }

  // Un hueco de puerta o pasillo oscuro se ve mucho más oscuro que las paredes de la habitación: no es una pared a pintar.
  const refLuma = Math.max(0, ...out.filter((s) => s.kind === 'pared').slice(0, 1).map((s) => s.luma)); // `out` ya viene del más grande al más chico
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].kind === 'pared' && out[i].luma < refLuma * minLumaRatio) { rechazadas.push(out[i]); out.splice(i, 1); }
  }
  let veto = null;
  if (partition && out.length) { // "la máscara más chica gana": objetos y otros planos pegados a la pared
    const pr = await partitionBySmallest(out, segment, width, height, { ...opts.partitionOpts, debug: opts.debugPartition });
    out.push(...pr.extra);
    veto = pr.veto;
  }
  if (grow) growIntoGaps(out, img, { blocked: veto });
  if (snap && out.length) {
    refineEdges(out, fullGrad(), width, height);
    for (const s of out) s.mask = removeSmallIslands(s.mask, width, height, Math.round(width * height * 0.002));
  }
  for (const s of out) Object.assign(s, maskGeometry(s.mask, width, height));
  const paredes = out.filter((s) => s.kind === 'pared').sort((a, b) => b.area - a.area).slice(0, maxPared).sort((a, b) => a.cx - b.cx);
  const techo = out.filter((s) => s.kind === 'techo').sort((a, b) => b.area - a.area).slice(0, 1);
  const nombre = (i, n) => (n === 1 ? 'Pared' : n === 2 ? ['Pared izquierda', 'Pared derecha'][i] : n === 3 ? ['Pared izquierda', 'Pared del medio', 'Pared derecha'][i] : `Pared ${i + 1}`);
  const lista = [...paredes.map((s, i) => ({ ...s, name: nombre(i, paredes.length) })), ...techo.map((s) => ({ ...s, name: 'Techo' }))];
  lista.rechazadas = rechazadas;
  return lista;
}
