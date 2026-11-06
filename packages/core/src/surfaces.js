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
  const sobel = (x, y, i) => {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    g[i] = Math.hypot(gx, gy);
  };
  for (let y = 0; y < h; y++) {
    const border = y === 0 || y === h - 1;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (border || x === 0 || x === w - 1) { sobel(x, y, i); continue; }
      const a = luma[i - w - 1], b = luma[i - w], c = luma[i - w + 1], d = luma[i - 1], f = luma[i + 1], e = luma[i + w - 1], k = luma[i + w], l = luma[i + w + 1];
      const gx = (c + 2 * f + l - a - 2 * d - e) / 8;
      const gy = (e + 2 * k + l - a - 2 * b - c) / 8;
      g[i] = Math.hypot(gx, gy);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        acc += g[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
    } else {
      const i = y * w + x;
      acc = 0 + g[i - w - 1] + g[i - w] + g[i - w + 1] + g[i - 1] + g[i] + g[i + 1] + g[i + w - 1] + g[i + w] + g[i + w + 1];
    }
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
export function classifySurface(g, { techoAlto = false } = {}) {
  if (g.area < 0.025) return null;
  const h = g.bottom - g.top;
  if (g.cy < 0.3 && g.top < 0.04 && h < 0.45) return 'techo';
  // techoAlto (opt-in): un techo visto en perspectiva puede bajar hasta la mitad de la foto, pero es un trapecio ancho arriba: su centroide cae en el 40 % superior de su caja
  // (un rectángulo, como una pared sobre una mesada, lo tiene en el 50 %).
  if (techoAlto && g.area >= 0.15 && g.cy < 0.3 && g.top < 0.04 && h < 0.62 && (g.cy - g.top) / h < 0.42) return 'techo';
  if (g.cy > 0.7 && h < 0.4) return null; // piso
  if (g.cy > 0.62 && g.top > 0.35) return null; // algo bajo y chico: mueble, piso
  if (g.area / Math.max(0.01, g.bottom - g.top) < 0.06) return null; // tira angosta (ancho medio < 6 % de la foto): un marco o una puerta cortados por el encuadre
  if (g.cy < 0.45 && g.right - g.left > 0.5 && g.area > 0.08) return 'pared'; // banda ancha en la mitad de arriba: la pared sobre los azulejos
  if (h < 0.25) return null; // franja baja o angosta: no es una pared
  return 'pared';
}


/**
 * Estadísticas de color de una región (máscara a resolución de la foto): croma medio (0..1), "azulez" B-R media (-1..1), fracción de píxeles casi
 * quemados (luma > 245) y luma media/p90. Sirven para distinguir cielo y vidrio (muy brillantes o azulados) de una pared o un techo pintados.
 */
export function colorStats(mask, img) {
  const { data, width, height } = img;
  let n = 0, ch = 0, bl = 0, hot = 0, ls = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n++; ls += l; hist[Math.min(255, Math.round(l))]++;
    ch += (Math.max(r, g, b) - Math.min(r, g, b)) / 255; bl += (b - r) / 255;
    if (l > 245) hot++;
  }
  if (!n) return { chroma: 0, blue: 0, hot: 0, luma: 0, p90: 0 };
  let acc = 0, p90 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.9) { p90 = v; break; } }
  return { chroma: ch / n, blue: bl / n, hot: hot / n, luma: ls / n, p90 };
}

/**
 * Fracción de las columnas del techo cuyo borde inferior apoya en una pared (hay pared justo debajo, hasta `reach` px). Un techo de verdad
 * se corta contra la pared que tiene debajo; un cielo, la luz de una ventana o una banda suelta no tienen pared debajo (0 = ninguna).
 */
export function ceilingWallContact(techo, paredes, width, height, reach = Math.max(3, Math.round(height * 0.03))) {
  let cols = 0, hit = 0;
  for (let x = 0; x < width; x++) {
    let yb = -1;
    for (let y = height - 1; y >= 0; y--) if (techo[y * width + x]) { yb = y; break; }
    if (yb < 0) continue;
    cols++;
    let ok = false;
    for (let y = yb + 1; y <= Math.min(height - 1, yb + reach) && !ok; y++) for (const p of paredes) if (p[y * width + x]) { ok = true; break; }
    if (ok) hit++;
  }
  return cols ? hit / cols : 0;
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
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), win = 2 * r + 1, last = w - 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + (x < 0 ? 0 : x > last ? last : x)];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc / win; acc += src[row + (x + r + 1 > last ? last : x + r + 1)] - src[row + (x - r < 0 ? 0 : x - r)]; }
  }
  // vertical: por filas (acumuladores por columna): misma secuencia de sumas por columna, pero recorriendo la memoria en orden
  const acc = new Float64Array(w);
  for (let y = -r; y <= r; y++) { const row = (y < 0 ? 0 : y > h - 1 ? h - 1 : y) * w; for (let x = 0; x < w; x++) acc[x] += tmp[row + x]; }
  for (let y = 0; y < h; y++) {
    const row = y * w, add = (y + r + 1 > h - 1 ? h - 1 : y + r + 1) * w, sub = (y - r < 0 ? 0 : y - r) * w;
    for (let x = 0; x < w; x++) { out[row + x] = acc[x] / win; acc[x] += tmp[add + x] - tmp[sub + x]; }
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
      for (let v = 0; v < 4; v++) {
        const j = v === 0 ? (x > 0 ? i - 1 : -1) : v === 1 ? (x < width - 1 ? i + 1 : -1) : v === 2 ? (i >= width ? i - width : -1) : (i < n - width ? i + width : -1);
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
 * Forma de la frontera entre dos núcleos (lista plana x,y de píxeles de la grilla chica): ángulo respecto de la vertical (0 = vertical, 90 = horizontal),
 * largo del eje principal y desvío típico respecto de la recta (una esquina de dos paredes es una recta larga y casi vertical; el borde de una
 * lámpara, una repisa o un cuadro es corto, curvo u horizontal). Medidas relativas al alto de la grilla.
 */
function boundaryShape(pts, w, h) {
  const n = pts.length / 2;
  let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { mx += pts[2 * k]; my += pts[2 * k + 1]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < n; k++) { const dx = pts[2 * k] - mx, dy = pts[2 * k + 1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // dirección del eje principal medida desde x
  const fromVertical = Math.abs(90 - Math.abs((theta * 180) / Math.PI));
  return { ang: +fromVertical.toFixed(1), lenY: +((Math.sqrt(l1) * 3.46) / h).toFixed(3), resid: +Math.sqrt(l2).toFixed(2), cx: +(mx / w).toFixed(2), cy: +(my / h).toFixed(2) };
}

/**
 * Divide una máscara que fusionó varias superficies (pared + pared + techo del mismo color, con aristas muy suaves).
 * Busca "núcleos" muy lisos dentro de la máscara; si hay más de uno, cada píxel va al núcleo al que llega con menor
 * costo de gradiente (cuenca de aguas): una arista, por tenue que sea, hace de divisoria. Devuelve una lista de máscaras
 * (la original si no hay nada que dividir).
 */
export function splitMerged(mask, grad, w, h, width, height, { strictMax = 2.2, minFrac = 0.04, edgeCost = 1.5, minEdge = 4.5, debug = null, fullGrad = null, cornerOnly = false, cornerMaxAng = 20, cornerMinLen = 0.12 } = {}) {
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

  // Dijkstra multi-fuente (cola binaria) con costo = 1 + edgeCost·gradiente del píxel al que se entra.
  // (Claves en Float64 y `dist` en Float32, como siempre: un nodo cuyo redondeo a Float32 baja ya no se expande; se conserva para no cambiar los cortes.)
  const dist = new Float32Array(w * h).fill(Infinity), own = new Int16Array(w * h).fill(-1);
  const heap = makeHeap(1 << 12, Float64Array);
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0 && remap[lab[i]] >= 0) { dist[i] = 0; own[i] = remap[lab[i]]; heap.push(0, i); }
  const relax1 = (i, n, d) => { if (!low[n]) return; const nd = d + 1 + edgeCost * grad[n]; if (nd < dist[n]) { dist[n] = nd; own[n] = own[i]; heap.push(nd, n); } };
  while (heap.size) {
    const i = heap.pop(), d = heap.lastKey;
    if (d > dist[i]) continue;
    const x = i % w;
    if (x > 0) relax1(i, i - 1, d);
    if (x < w - 1) relax1(i, i + 1, d);
    if (i >= w) relax1(i, i - w, d);
    if (i < w * h - w) relax1(i, i + w, d);
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
      const e = pairs.get(key) ?? { sum: 0, n: 0, pts: [] };
      e.sum += Math.max(grad[i], grad[n]); e.n++;
      e.pts.push(i % w, Math.floor(i / w));
      pairs.set(key, e);
    }
  }
  const root = keep.map((_, k) => k);
  const find = (k) => (root[k] === k ? k : (root[k] = find(root[k])));
  for (const [key, e] of pairs) {
    const a = Math.floor(key / 1000), b = key % 1000, str = e.sum / e.n;
    const shape = debug || cornerOnly ? boundaryShape(e.pts, w, h) : null;
    if (debug) debug({ a, b, strength: str, len: e.n, ...shape });
    if (e.n >= 3 && str < minEdge) root[find(a)] = find(b);
    // `cornerOnly`: una arista CORTA (menos de `cornerMinLen` del alto de la foto) y que no es casi vertical es el borde de una repisa, un cuadro o un
    // objeto apoyado, no la unión de dos paredes: se fusiona aunque sea fuerte. Las aristas largas (techo/pared) y las verticales (esquinas) se conservan.
    else if (cornerOnly && e.n >= 3 && shape.ang > cornerMaxAng && shape.lenY < cornerMinLen) root[find(a)] = find(b);
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
    // dist2 en Float64 (como las claves del heap): con Float32 el redondeo hacía que un nodo se pudiera reinsertar una y otra vez y el heap crecía sin límite
    // (foto interior-ig070: >25 millones de entradas, el análisis no terminaba nunca). Solo afecta esta pasada de refinado, no los cortes de la grilla chica.
    const band = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (lab2[i] >= 0 && near[i] > 1e-4) band[i] = 1;
    const dist2 = new Float64Array(N).fill(Infinity), own2 = new Int16Array(N).fill(-1), heap2 = makeHeap(1 << 16, Float64Array);
    for (let i = 0; i < N; i++) {
      if (lab2[i] < 0 || band[i]) continue;
      const x = i % width;
      if ((x > 0 && band[i - 1]) || (x < width - 1 && band[i + 1]) || (i >= width && band[i - width]) || (i < N - width && band[i + width])) { dist2[i] = 0; own2[i] = lab2[i]; heap2.push(0, i); }
    }
    const relax2 = (i, n, d) => { if (!band[n]) return; const nd = d + 1 + edgeCost * G[n]; if (nd < dist2[n]) { dist2[n] = nd; own2[n] = own2[i]; heap2.push(nd, n); } };
    while (heap2.size) {
      const i = heap2.pop(), d = heap2.lastKey;
      if (d > dist2[i]) continue;
      const x = i % width;
      if (x > 0) relax2(i, i - 1, d);
      if (x < width - 1) relax2(i, i + 1, d);
      if (i >= width) relax2(i, i - width, d);
      if (i < N - width) relax2(i, i + width, d);
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
/** Con lineGrid, el veto por líneas se mantiene (sin grilla igual) para lo oscuro, lo chico y lo que cuelga arriba (cielorraso): ahí no hay evidencia de pared. */
export function lineGridGuarda(f, g, { minLuma = 45, minArea = 0.08, minCy = 0.2 } = {}) {
  return f.luma < minLuma || g.area < minArea || g.cy < minCy;
}

/** ¿Las líneas largas de una máscara forman una grilla de juntas (azulejo, enlosado)? stats = {rows, cols} de lineRatio. */
export function hayGrilla(stats, { min = 2, total = 8 } = {}) {
  const r = stats?.rows ?? 0, c = stats?.cols ?? 0;
  return Math.min(r, c) >= min || r + c >= total;
}

export function lineRatio(mask, G, width, height, thr, inset = 5, { loneLine = false, minFrac = 0.25, stats = null } = {}) {
  let n = 0, t = 0;
  const rows = new Int32Array(height), rowW = new Int32Array(height), cols = new Int32Array(width), colW = new Int32Array(width);
  for (let y = inset; y < height - inset; y++) for (let x = inset; x < width - inset; x++) {
    const i = y * width + x;
    if (!mask[i] || !mask[i - inset] || !mask[i + inset] || !mask[i - inset * width] || !mask[i + inset * width]) continue;
    n++; rowW[y]++; colW[x]++;
    if (G[i] > thr) { t++; rows[y]++; cols[x]++; }
  }
  if (!n) return 0;
  if (stats) { // cantidad de líneas largas y casi enteras por orientación (una grilla de juntas tiene de las dos; un zócalo, una moldura o un marco, de una sola)
    const cl = (cnt, wid) => { let k = 0; for (let i = 0; i < cnt.length; i++) { if (!(wid[i] > 20 && cnt[i] > minFrac * wid[i])) continue; k++; while (i < cnt.length && wid[i] > 20 && cnt[i] > minFrac * wid[i]) i++; } return k; };
    stats.rows = cl(rows, rowW); stats.cols = cl(cols, colW);
  }
  if (!loneLine || t / n === 0) return t / n;
  // Una arista larga y recta SOLA dentro de la máscara (el borde de un zócalo o de un marco que SAM dejó adentro) no es un enlosado: el
  // azulejo tiene una grilla de juntas (al menos dos líneas). Se agrupan las filas/columnas casi enteras de borde; si hay una sola
  // agrupación, se descuenta; con dos o más se devuelve la proporción completa.
  const cluster = (cnt, wid) => {
    const out = [];
    for (let i = 0; i < cnt.length; i++) {
      if (!(wid[i] > 20 && cnt[i] > minFrac * wid[i])) continue;
      let j = i, sum = 0;
      while (j < cnt.length && wid[j] > 20 && cnt[j] > minFrac * wid[j]) { sum += cnt[j]; j++; }
      out.push(sum); i = j;
    }
    return out;
  };
  const lines = [...cluster(rows, rowW), ...cluster(cols, colW)];
  return lines.length === 1 ? Math.max(0, t - lines[0]) / n : t / n;
}

/**
 * Rescate de pared en una máscara "con textura": un SAM que une la fachada con sus ventanas (o un revoque rugoso) da una máscara rechazada por textura aunque
 * el grueso sea pared. Se queda solo con los píxeles del color y la luz típicos de la máscara (mediana tomada entre sus píxeles más lisos), se abre para
 * sacar ruido, y cada pedazo grande que sigue conectado es una candidata a pared. Ventanas, puertas, hiedra y sombras quedan afuera por color.
 * Pensado para correr SOLO cuando no se detectó ninguna pared (no cambia nada en las fotos que ya funcionan).
 */
export function rescueTextured(mask, img, G, { smoothThr = 4, tolLuma = 16, tolChroma = 0.025, openR = Math.max(2, Math.round(img.width * 0.006)), minPix = Math.round(img.width * img.height * 0.025) } = {}) {
  const { data, width, height } = img, N = width * height;
  const lum = (i) => 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const chr = (i) => { const t = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] + 1e-3; return [data[i * 4] / t, data[i * 4 + 1] / t]; };
  const L = [], R = [], Gc = [];
  for (let i = 0; i < N; i += 7) if (mask[i] && G[i] < smoothThr) { L.push(lum(i)); const [r, g] = chr(i); R.push(r); Gc.push(g); }
  if (L.length < 200) return [];
  const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
  const ml = med(L), mr = med(R), mg = med(Gc);
  const cand = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!mask[i] || Math.abs(lum(i) - ml) > tolLuma) continue;
    const [r, g] = chr(i);
    if (Math.abs(r - mr) + Math.abs(g - mg) <= tolChroma) cand[i] = 1;
  }
  const opened = removeSmallIslands(openMask(cand, width, height, openR), width, height, minPix);
  const out = [], seen = new Uint8Array(N), q = new Int32Array(N);
  for (let st = 0; st < N; st++) {
    if (!opened[st] || seen[st]) continue;
    let head = 0, tail = 0;
    q[tail++] = st; seen[st] = 1;
    while (head < tail) {
      const i = q[head++], x = i % width;
      if (x > 0 && opened[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; q[tail++] = i - 1; }
      if (x < width - 1 && opened[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; q[tail++] = i + 1; }
      if (i >= width && opened[i - width] && !seen[i - width]) { seen[i - width] = 1; q[tail++] = i - width; }
      if (i < N - width && opened[i + width] && !seen[i + width]) { seen[i + width] = 1; q[tail++] = i + width; }
    }
    if (tail < minPix) continue;
    const m = new Uint8Array(N);
    for (let k = 0; k < tail; k++) m[q[k]] = 1;
    out.push(m);
  }
  return out;
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

/** Cola de prioridad mínima con arreglos tipados (clave Float32 por defecto, valor Int32). `pop()` devuelve el valor y deja la clave en `lastKey`. */
function makeHeap(cap, Keys = Float32Array) {
  let n = 0, keys = new Keys(cap), vals = new Int32Array(cap), lastKey = 0;
  return {
    get size() { return n; },
    get lastKey() { return lastKey; },
    push(key, val) {
      if (n === keys.length) { const k2 = new Keys(n * 2), v2 = new Int32Array(n * 2); k2.set(keys); v2.set(vals); keys = k2; vals = v2; }
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
  for (const [ci, c] of largos.entries()) {
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (const j of c) { const x = j % w, y = Math.floor(j / w); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const vertical = y1 - y0 >= x1 - x0;
    // varias posiciones a lo largo del borde (SAM cambia de máscara según el punto exacto) y los dos lados del borde
    const orden = c.slice().sort((a, b) => (vertical ? Math.floor(a / w) - Math.floor(b / w) : (a % w) - (b % w)));
    for (const [si, q] of [0.5, 0.2, 0.8].entries()) { // el medio primero: si ahí no aparece nada, `partitionBySmallest` puede saltear las otras posiciones
      const rep = orden[Math.floor(q * (orden.length - 1))], rx = rep % w, ry = Math.floor(rep / w);
      for (const [dx, dy] of vertical ? [[-D, 0], [D, 0]] : [[0, -D], [0, D]]) {
        const x = rx + dx, y = ry + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || !low[y * w + x] || E[y * w + x]) continue;
        out.push({ x: ((x + 0.5) / w) * width, y: ((y + 0.5) / h) * height, edge: ci, step: si });
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
 * ¿Es la semilla (x, y) un pedazo de superficie "pelada" (pared o techo)? Devuelve una función: true si, alrededor del punto (cuadrado de lado 2·rad, 5x5 muestras),
 * todo está adentro de la MISMA superficie, sin bordes (gradiente < edgeThr) y con luz y color (luma, r/g normalizados) cercanos a la mediana de esa superficie.
 */
function plainTest(regiones, img, G, inWall, { edgeThr, plainLuma, plainChroma, rad }) {
  const { data, width, height } = img;
  const lumAt = (i) => 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const cands = [];
  // mediana aproximada con histograma (luma en pasos de 0,25; r y g normalizados en pasos de 1/2048): alcanza para tolerancias de decenas de niveles
  const histMed = (h, total) => { let acc = 0; for (let b = 0; b < h.length; b++) { acc += h[b]; if (acc * 2 >= total) return b; } return 0; };
  const add = (mask) => {
    let area = 0, enPared = 0, ns = 0;
    const hl = new Uint32Array(1024), hr = new Uint32Array(2048), hg = new Uint32Array(2048);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      area++; enPared += inWall[i];
      if (i % 11) continue;
      const R = data[i * 4], Gc = data[i * 4 + 1], t = R + Gc + data[i * 4 + 2] + 1e-3;
      hl[Math.min(1023, Math.floor(lumAt(i) * 4))]++; hr[Math.min(2047, Math.floor((R / t) * 2048))]++; hg[Math.min(2047, Math.floor((Gc / t) * 2048))]++; ns++;
    }
    if (ns >= 50) cands.push({ mask, area, wallFrac: enPared / Math.max(1, area), ml: histMed(hl, ns) / 4, mr: histMed(hr, ns) / 2048, mg: histMed(hg, ns) / 2048 });
  };
  for (const r of regiones) add(r.mask ?? r);
  const patchOk = ({ mask, ml, mr, mg }, x, y) => {
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const xx = x + Math.round((a * rad) / 2), yy = y + Math.round((b * rad) / 2);
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) return false;
      const j = yy * width + xx;
      if (!mask[j] || G[j] >= edgeThr || Math.abs(lumAt(j) - ml) > plainLuma) return false;
      const t = data[j * 4] + data[j * 4 + 1] + data[j * 4 + 2] + 1e-3;
      if (Math.abs(data[j * 4] / t - mr) + Math.abs(data[j * 4 + 1] / t - mg) > plainChroma) return false;
    }
    return true;
  };
  const test = (x, y) => cands.some((c) => c.mask[y * width + x] && patchOk(c, x, y));
  // Punto bien adentro (el parche entero) de una máscara ya conocida que casi no toca las paredes (el piso, un mueble grande): lo que devuelva SAM no puede sacarle nada a una pared.
  const insideOther = (x, y) => cands.some((c) => c.wallFrac < 0.05 && c.mask[y * width + x] && [[-2, -2], [2, -2], [-2, 2], [2, 2], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([a, b]) => { const xx = x + Math.round((a * rad) / 2), yy = y + Math.round((b * rad) / 2); return xx >= 0 && yy >= 0 && xx < width && yy < height && c.mask[yy * width + xx]; }));
  // suma una máscara devuelta por SAM, salvo que ya haya una casi igual que contenga el mismo punto (la misma pared devuelta por otra semilla)
  const addNew = (mask, area, x, y) => { if (!cands.some((c) => c.mask[y * width + x] && Math.abs(c.area - area) < 0.03 * area)) add(mask); };
  return { test, insideOther, addNew };
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
 * Cada semilla cuesta una decodificación de SAM (~0,3 s en una notebook, varias veces más en un celular), así que se podan las que casi seguro
 * devolverían una máscara ya conocida (ver `skipPlain`, `skipNonWall`, `dedupe`, `edgeEarlyStop`; todas se pueden apagar). Con las 4 apagadas
 * se hace exactamente la grilla completa + los bordes completos de antes.
 */
export async function partitionBySmallest(regions, segment, width, height, { grid = 5, frac = 0.3, maxLoss = 0.5, minArea = 0.025, minWall = 0.08, G = null, edgeThr = 4, edgeBudget = 4, edgeMinLen = 14, debug = null,
  img = null, known = [], skipOutside = false, skipPlain = true, dedupe = true, plainLuma = 24, plainChroma = 0.03, plainRadius = 0.03, edgeEarlyStop = true, skipNonWall = true } = {}) {
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
  // Podas (cada una evita una decodificación que casi seguro devolvería una máscara que ya conocemos):
  //  - skipOutside (APAGADA por defecto): una semilla fuera de toda pared. En o02 la semilla que encuentra la tabla de surf (4,6 % de la foto, 75 % adentro
  //    de la máscara de la pared) cae FUERA de la pared: apagarla evitaba -55 % de decodificaciones pero pintaba 5,9 puntos de más. Queda como opción.
  //  - skipNonWall: la semilla de la grilla cae bien adentro (el parche entero) de una máscara ya conocida que casi no toca las paredes (el piso).
  //  - skipPlain: la semilla de la grilla cae en un pedazo de pared "pelada" (todo el parche adentro de la pared, sin bordes y del color de la pared):
  //    SAM devolvería la pared entera, que no separa nada. (Las semillas de borde no se podan por esto: justamente buscan lo que tiene el color de la pared.)
  //  - dedupe: la semilla cae en una máscara CHICA que ya devolvió otra semilla (un objeto ya encontrado): la nueva sería el mismo objeto.
  //    Es la única que puede mover un borde unos píxeles (la máscara de la segunda semilla sobre el mismo objeto no es idéntica): en s2 cambia una pared en 0,1 punto.
  //  - edgeEarlyStop: de un borde interior, si la posición central (los dos lados) no separó nada, no se prueban las otras dos.
  const waList = paredes.map((r) => { let a = 0; for (let i = 0; i < N; i++) if (r.mask[i]) a++; return a; });
  const maxWa = Math.max(...waList);
  const seenSmall = new Uint8Array(N); // unión de las máscaras chicas ya devueltas
  const plain = skipPlain && img && G ? plainTest([...regions, ...known], img, G, inWall, { edgeThr, plainLuma, plainChroma, rad: Math.max(3, Math.round(width * plainRadius)) }) : null;
  let skipped = 0;
  const waAt = (ip) => { for (const [k, r] of paredes.entries()) if (r.mask[ip]) return waList[k]; return maxWa; };
  const edgeHit = new Map(), edgeRan = new Map(), edgeDead = new Set(); // por borde: ¿la posición central (primera) separó algo?
  for (const [pi, { x, y, edge, step }] of pts.entries()) {
    const ix = Math.min(width - 1, Math.floor(x)), iy = Math.min(height - 1, Math.floor(y)), ip = iy * width + ix, esGrilla = pi < grid * grid;
    if (skipOutside && !inWall[ip]) { skipped++; debug?.({ saltada: [+(x / width).toFixed(2), +(y / height).toFixed(2)], motivo: 'fuera' }); continue; }
    // Semillas de borde: si en la primera posición del borde (los dos lados) todo devolvió una máscara grande (la pared), las otras posiciones del mismo borde
    // casi seguro también: se saltean.
    if (edgeEarlyStop && edge !== undefined && step > 0) {
      if (!edgeDead.has(edge) && edgeRan.get(edge) && !edgeHit.get(edge)) edgeDead.add(edge);
      if (edgeDead.has(edge)) { skipped++; debug?.({ saltada: [+(x / width).toFixed(2), +(y / height).toFixed(2)], motivo: 'borde sin nada en el centro' }); continue; }
    }
    if (dedupe && seenSmall[ip]) { skipped++; debug?.({ saltada: [+(x / width).toFixed(2), +(y / height).toFixed(2)], motivo: 'objeto ya visto' }); continue; }
    if (plain && esGrilla && (plain.test(ix, iy) || (skipNonWall && !inWall[ip] && plain.insideOther(ix, iy)))) { skipped++; debug?.({ saltada: [+(x / width).toFixed(2), +(y / height).toFixed(2)], motivo: 'pared pelada' }); continue; }
    const m = await segment([{ x, y }]);
    if (debug && pi >= grid * grid) { let c = 0; for (let i = 0; i < N; i++) if (m[i]) c++; debug({ semillaBorde: [+(x / width).toFixed(3), +(y / height).toFixed(3)], mascara: +(c / N).toFixed(4) }); }
    seeds++;
    let a = 0;
    for (let i = 0; i < N; i++) if (m[i]) a++;
    if (edge !== undefined && step === 0) { edgeRan.set(edge, true); if (a < frac * waAt(ip)) edgeHit.set(edge, true); }
    if (a < N * 0.002) continue;
    if (a < frac * maxWa) for (let i = 0; i < N; i++) if (m[i] && a < small[i]) small[i] = a; // una máscara de ≥ frac·(la pared más grande) no puede cumplir `small < frac·pared` en ninguna: no hace falta anotarla
    if (dedupe && a < frac * maxWa) for (let i = 0; i < N; i++) if (m[i]) seenSmall[i] = 1;
    if (plain && a >= N * 0.05) plain.addNew(m, a, ix, iy);
  }
  debug?.({ semillasSaltadas: skipped });
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
export function fillThinGaps(regions, img, { blocked = null, maxDist = Math.round(img.width * 0.2), thinR = Math.max(6, Math.round(img.width * 0.03)), tolLuma = 22, tolChroma = 0.03, maxAdd = 0.03, darkDelta = 45, minDarkRing = 0.75, minDarkAll = 0.4, minAspect = 3.4, minFill = 0.5, minBox = 0.004, slatDark = 0.95, sandwich = Math.round(img.width * 0.06), debug = null } = {}) {
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
    const med = (a) => Float64Array.from(a).sort()[a.length >> 1]; // orden numérico, sin comparador (mucho más rápido que Array.sort con función)
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
    let debugComps = null;
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
        // Forma del hueco: los de una silla son tiras HORIZONTALES (ancho >= minAspect veces el alto), rectas (relleno de su caja >= minFill), grandes (caja >= minBox de la foto: un hueco chico no es el de una silla) y rodeadas
        // casi solo por lo oscuro del objeto (>= slatDark del contorno). Medido en 9 fotos: los aciertos (r1 x2, r3 x2) cumplen las tres; los errores (franja
        // vertical sobre una puerta o un marco de ventana, hojas/lámpara, zonas bajo un sillón) fallan por forma. minAspect = 0 desactiva la condición de forma.
        let x0 = width, x1 = 0, y0 = height, y1 = 0, sl = 0, sc = 0;
        for (let k = 0; k < tail; k++) { const i = q[k], x = i % width, y = (i - x) / width; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (debug) { sl += Math.abs(lum[i] - ml); sc += Math.abs(cr[i] - mr) + Math.abs(cg[i] - mg); } }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, aspect = bw / bh, fill = tail / (bw * bh);
        const forma = !minAspect || (aspect >= minAspect && fill >= minFill && bw * bh >= minBox * N && ringDark / Math.max(1, ring) >= slatDark);
        const keep = ring && ringDark / ring >= minDarkRing && ringDark / ringAll >= minDarkAll && forma;
        if (debug) (debugComps ??= []).push({ n: tail, caja: [x0, y0, x1, y1].map((v, k) => +(v / (k % 2 ? height : width)).toFixed(3)), aspect: +aspect.toFixed(2), fill: +fill.toFixed(2), oscuro: +(ringDark / Math.max(1, ring)).toFixed(3), dL: +(sl / tail).toFixed(1), dC: +(sc / tail).toFixed(4), keep: !!keep });
        if (!keep) for (let k = 0; k < tail; k++) add[q[k]] = 0;
      }
    }
    na = 0;
    for (let i = 0; i < N; i++) if (add[i]) na++;
    debug?.({ pared: r.name, candidatos: +(nc / N).toFixed(4), finos: +(etapaFinos / N).toFixed(4), traslaslas: +(etapaIslas / N).toFixed(4), traselcontorno: +(na / N).toFixed(4), comps: debugComps, add: addAntes });
    if (!na || na > maxAdd * N) continue;
    for (let i = 0; i < N; i++) if (add[i]) { r.mask[i] = 1; owner[i] = 1; }
  }
  return regions;
}

/** Dilatación cuadrada de radio r (separable). */
function dilateMask(mask, width, height, r) {
  const N = width * height, tmp = new Uint8Array(N), out = new Uint8Array(N);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k++) tmp[y * width + k] = 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (tmp[y * width + x]) for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k++) out[k * width + x] = 1;
  return out;
}

/**
 * Saca de las paredes los objetos CERRADOS por un contorno de aristas fuertes y de otro aspecto que la pared (un cuadro, un interruptor, un aire
 * acondicionado, un espejo, una luminaria): SAM los une a la pared lisa, pero adentro de la máscara dibujan un lazo de aristas. Dentro de cada pared se
 * buscan las zonas lisas (gradiente < `edgeThr`) que NO se conectan con la pared principal y cuyo borde nunca toca algo fuera de la máscara (un lazo
 * cerrado); si además su luz o su color difieren de la mediana de la pared (`dLuma`, `dChroma`) y su tamaño es el de un objeto (`minArea`..`maxArea`
 * de la foto), se sacan junto con el lazo (`pad` px) y se marcan en el mapa 0/1 que devuelve (para que nada lo vuelva a pintar).
 * Una mancha o una grieta de la pared forman lazos del mismo color que ella: no se tocan.
 */
export function cutEnclosedObjects(regions, img, G, { edgeThr = 3.5, minArea = 0.0004, maxArea = 0.04, dLuma = 14, dChroma = 0.035, pad = 3, debug = null } = {}) {
  const { data, width, height } = img, N = width * height, cut = new Uint8Array(N);
  const lum = new Float32Array(N), cr = new Float32Array(N), cg = new Float32Array(N);
  for (let i = 0; i < N; i++) { const R = data[i * 4], Gc = data[i * 4 + 1], B = data[i * 4 + 2], t = R + Gc + B + 1e-3; lum[i] = 0.2126 * R + 0.7152 * Gc + 0.0722 * B; cr[i] = R / t; cg[i] = Gc / t; }
  const med = (a) => Float64Array.from(a).sort()[a.length >> 1];
  for (const r of regions) {
    if (r.kind !== 'pared') continue;
    const sl = [], sr = [], sg = [];
    for (let i = 0; i < N; i += 5) if (r.mask[i] && G[i] < edgeThr) { sl.push(lum[i]); sr.push(cr[i]); sg.push(cg[i]); }
    if (sl.length < 50) continue;
    const ml = med(sl), mr = med(sr), mg = med(sg);
    const seen = new Uint8Array(N), q = new Int32Array(N), found = [];
    let bigStart = -1, bigN = 0;
    for (let st = 0; st < N; st++) {
      if (!r.mask[st] || G[st] >= edgeThr || seen[st]) continue;
      let head = 0, tail = 0, open = false, sL = 0, sR = 0, sG = 0;
      q[tail++] = st; seen[st] = 1;
      while (head < tail) {
        const i = q[head++], x = i % width, y = (i - x) / width;
        sL += lum[i]; sR += cr[i]; sG += cg[i];
        for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
          if (j < 0) { open = true; continue; } // llega al borde de la foto: no es un lazo cerrado
          if (!r.mask[j]) { open = true; continue; } // toca algo fuera de la pared: no es un lazo cerrado
          if (G[j] < edgeThr && !seen[j]) { seen[j] = 1; q[tail++] = j; }
        }
      }
      if (tail > bigN) { bigN = tail; bigStart = st; }
      if (!open && tail >= minArea * N && tail <= maxArea * N) found.push({ st, n: tail, dl: Math.abs(sL / tail - ml), dc: Math.abs(sR / tail - mr) + Math.abs(sG / tail - mg), pix: Int32Array.from(q.subarray(0, tail)) });
    }
    for (const f of found) {
      const ok = f.dl >= dLuma || f.dc >= dChroma;
      debug?.({ pared: r.name, n: +(f.n / N).toFixed(4), x: +((f.st % width) / width).toFixed(3), y: +(Math.floor(f.st / width) / height).toFixed(3), dl: +f.dl.toFixed(1), dc: +f.dc.toFixed(4), ok });
      if (!ok) continue;
      const m = new Uint8Array(N);
      for (const i of f.pix) m[i] = 1;
      const grown = pad > 0 ? dilateMask(m, width, height, pad) : m;
      for (let i = 0; i < N; i++) if (grown[i]) { cut[i] = 1; r.mask[i] = 0; }
    }
  }
  return cut;
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
 * Saca de las paredes las bandas angostas y MÁS CLARAS que la pared que las rodea: marcos de puerta y de abertura, zócalos y molduras del color
 * de la pared (blancos sobre una pared apenas gris), que SAM agrupa con ella porque son lisos y del mismo tono. Un "top-hat" de luminancia
 * restringido a la máscara (apertura con ventana cuadrada de `win` px: lo que sobresale de la apertura es más angosto que la ventana) marca lo
 * que es más claro que su entorno en más de `minDelta`; se queda con las zonas alargadas (elongación >= `minElong`), angostas (grosor <= `maxWidth`
 * px) y largas (>= `minLength` px). La pared grande con degradé de luz no sobresale (la apertura la sigue). Devuelve un mapa 0/1 de lo sacado
 * (para vetarlo y que nada lo vuelva a pintar). Modifica las máscaras de `regions`.
 */
export function trimBrightBands(regions, img, { win = Math.round(img.width * 0.035), minDelta = 11, maxWidth = Math.round(img.width * 0.07), minLength = Math.round(img.width * 0.08), minElong = 3, pad = 2, debug = null } = {}) {
  const { width, height, data } = img, N = width * height, cut = new Uint8Array(N);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
  const Y = boxBlur(lum, width, height, 1);
  const q = new Int32Array(N);
  // contexto: todas las superficies juntas (un marco suele ser una "pared" propia pegada a la pared grande: sin esa pared al lado no sobresale)
  const all = new Uint8Array(N), own = new Int16Array(N).fill(-1);
  regions.forEach((r, k) => { for (let i = 0; i < N; i++) if (r.mask[i]) { all[i] = 1; own[i] = k; } });
  if (!regions.some((r) => r.kind === 'pared')) return cut;
  const open = morphOpen(Y, all, width, height, win);
  const cand = new Uint8Array(N);
  let any = false;
  for (let i = 0; i < N; i++) if (own[i] >= 0 && regions[own[i]].kind === 'pared' && Y[i] - open[i] > minDelta) { cand[i] = 1; any = true; }
  if (!any) return cut;
  const seen = new Uint8Array(N);
  const tocadas = new Set();
  for (let st = 0; st < N; st++) {
    if (!cand[st] || seen[st]) continue;
    let head = 0, tail = 0;
    q[tail++] = st; seen[st] = 1;
    let sx = 0, sy = 0;
    while (head < tail) {
      const i = q[head++], x = i % width, y = (i - x) / width;
      sx += x; sy += y;
      for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (n < 0 || seen[n] || !cand[n]) continue;
        seen[n] = 1; q[tail++] = n;
      }
    }
    if (tail < minLength * 3) continue;
    const mx = sx / tail, my = sy / tail;
    let cxx = 0, cyy = 0, cxy = 0, dsum = 0;
    for (let k = 0; k < tail; k++) {
      const i = q[k], px = i % width, x = px - mx, y = (i - px) / width - my;
      cxx += x * x; cyy += y * y; cxy += x * y; dsum += Y[i] - open[i];
    }
    cxx /= tail; cyy /= tail; cxy /= tail;
    const tr = cxx + cyy, det = Math.sqrt(Math.max(0, (cxx - cyy) ** 2 / 4 + cxy * cxy));
    const l1 = tr / 2 + det, l2 = Math.max(1e-6, tr / 2 - det);
    const len = 3.46 * Math.sqrt(l1), wid = 3.46 * Math.sqrt(l2), elong = Math.sqrt(l1 / l2);
    debug?.({ area: +(tail / N).toFixed(4), cx: +(mx / width).toFixed(2), cy: +(my / height).toFixed(2), largo: Math.round(len), ancho: +wid.toFixed(1), elong: +elong.toFixed(1), delta: +(dsum / tail).toFixed(1) });
    if (len < minLength || wid > maxWidth || elong < minElong) continue;
    const comp = new Uint8Array(N);
    for (let k = 0; k < tail; k++) comp[q[k]] = 1;
    const grown = pad > 0 ? dilateMask(comp, width, height, pad) : comp;
    for (let i = 0; i < N; i++) if (grown[i] && own[i] >= 0 && regions[own[i]].kind === 'pared') { cut[i] = 1; regions[own[i]].mask[i] = 0; tocadas.add(own[i]); }
  }
  for (const k of tocadas) regions[k].mask = removeSmallIslands(regions[k].mask, width, height, Math.round(N * 0.002));
  return cut;
}

/**
 * Una "pared" que es una tira angosta y larga (grosor máximo <= `maxThick` del ancho de la foto, largo >= `minElong` veces el grosor) no es una pared:
 * es la cara lateral de un marco, una moldura o un zócalo que SAM tomó por separado. Se la saca y devuelve el mapa 0/1 de lo sacado.
 * El borde de la foto no cuenta como borde de la tira (una pared cortada por el costado de la foto no es angosta).
 */
export function dropThinStrips(regions, width, height, { maxThick = 0.05, minElong = 10, maxArea = 0.08, debug = null } = {}) {
  const N = width * height, cut = new Uint8Array(N);
  for (let k = regions.length - 1; k >= 0; k--) {
    const r = regions[k];
    if (r.kind !== 'pared') continue;
    let a = 0;
    for (let i = 0; i < N; i++) if (r.mask[i]) a++;
    if (!a) continue;
    if (a / N > maxArea) { debug?.({ tira: r.name, area: +(a / N).toFixed(4), grande: true }); continue; }
    const dt = distanceTransform(r.mask, width, height);
    let rmax = 0;
    for (let i = 0; i < N; i++) if (r.mask[i] && dt[i] > rmax) rmax = dt[i];
    const thick = 2 * rmax, elong = a / Math.max(1, thick * thick);
    debug?.({ tira: r.name, area: +(a / N).toFixed(4), grosor: +(thick / width).toFixed(4), elong: +elong.toFixed(1) });
    if (thick > maxThick * width || elong < minElong) continue;
    for (let i = 0; i < N; i++) if (r.mask[i]) cut[i] = 1;
    regions.splice(k, 1);
  }
  return cut;
}

// Apertura morfológica (erosión y después dilatación) de `src` con ventana cuadrada de lado 2*win+1, mirando solo los píxeles con mask=1.
function morphOpen(src, mask, width, height, win) {
  const N = width * height, BIG = 1e9;
  const pass = (inp, valid, isMin, horizontal) => {
    const out = new Float32Array(N), ok = new Uint8Array(N);
    const len = horizontal ? width : height, lines = horizontal ? height : width, step = horizontal ? 1 : width, lstep = horizontal ? width : 1;
    for (let l = 0; l < lines; l++) {
      for (let p = 0; p < len; p++) {
        let best = isMin ? BIG : -BIG, has = 0;
        const a = Math.max(0, p - win), b = Math.min(len - 1, p + win);
        for (let k = a; k <= b; k++) {
          const i = l * lstep + k * step;
          if (!valid[i]) continue;
          has = 1;
          const v = inp[i];
          if (isMin ? v < best : v > best) best = v;
        }
        const o = l * lstep + p * step;
        out[o] = has ? best : 0; ok[o] = has;
      }
    }
    return { out, ok };
  };
  const e1 = pass(src, mask, true, true), e2 = pass(e1.out, e1.ok, true, false);
  const d1 = pass(e2.out, e2.ok, false, true), d2 = pass(d1.out, d1.ok, false, false);
  return d2.out;
}

/**
 * Detecta las superficies de la foto.
 *  img      : {data RGBA, width, height} (foto de trabajo)
 *  opts.patience (3): en cada pasada de semillas lisas se corta tras tantas semillas seguidas que no aportan una superficie nueva (0 = nunca).
 *  opts.partitionOpts: ver `partitionBySmallest` (podas de decodificaciones).
 *  segment  : async (points: [{x, y}]) => Uint8Array(width*height) 0/1, ya limpia — región que contiene TODOS esos puntos
 *             (todos son "esto es pared", como los toques verdes de la app)
 * Devuelve [{ kind: 'pared'|'techo', name, mask, area, cx, cy, texture }], máscaras DISJUNTAS, paredes de izquierda a derecha.
 */
export async function detectSurfaces(img, segment, opts = {}) {
  const { maxSeeds = 9, gradMax = 7, minDist = 2.5, minArea = 0.025, maxPared = 5, maxTexture = 0.12, refineMin = 2, minLumaRatio = 0.55, grow = true, snap = true, partition = true, hang = true, lockObjects = true, thinGaps = true, enclosed = true, tableVeto = true, minWallLuma = 30, frames = true, strips = true, blockRejected = true, splitMax = 2.2, splitEdge = 4.5, maxLine = 0.004, minCoverage = 0.35, relaxFactor = 1.8, corner = true, patience = 3, sky = true, hotMax = 0.3, techoMaxTexture = 0.15, skyBlue = 0.12, techoNeedsWall = true, minTechoContact = 0.3, skyLuma = 210, loneLine = true, rescue = true, splitCornerOnly = true, techoMinLuma = 70, trim = false, techoRelax = false, techoAlto = false, paredRescate = false, lineGrid = false } = opts; // techoRelax: {minLuma, maxTexture} (opt-in): techo oscuro/con textura que apoya en una pared aceptada; techoAlto: techo que baja hasta ~60 % de la foto (opt-in) // paredRescate: opt-in (agente B): rescate de color también con paredes aceptadas si cubren poco, y en máscaras rechazadas por líneas // lineGrid: opt-in {min, total}: el veto por líneas (azulejo) solo vale si hay grilla (≥ min líneas largas por orientación o ≥ total en suma); una moldura, un zócalo o un marco dejan líneas de una sola orientación
  // trim: opt-in (AUTO_OPTS {"trim":true}); sin verificar en las 15 propias
  const { width, height } = img;
  const { luma, w, h } = downscaleLuma(img);
  const grad = gradientMap(luma, w, h);
  let gradFineCache = null; // gradiente de la luminancia suavizada (caja 5x5 de la grilla): el grano fino (revoque, papel con dibujo chico) desaparece, los bordes grandes (ventana, mueble) no
  const gradFine = () => (gradFineCache ??= gradientMap(boxBlur(luma, w, h, 2), w, h));
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
  let sinNada = 0; // semillas seguidas que no aportaron ninguna superficie nueva: las zonas lisas que quedan son cada vez más chicas, hay que cortar
  for (let it = 0; it < maxSeeds && !(patience > 0 && sinNada >= patience); it++) {
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
    const partes = classifySurface(maskGeometry(mask, width, height), { techoAlto }) === 'techo' ? [mask] : splitMerged(mask, grad, w, h, width, height, { strictMax: splitMax, minEdge: splitEdge, debug: opts.debugSplit, fullGrad, cornerOnly: splitCornerOnly, ...opts.splitOpts });
    let aporto = false;
    for (const parte of partes) {
      const g = maskGeometry(parte, width, height);
      if (g.area < minArea) continue;
      if (found.some((f) => { const r = iouAndContain(f.mask, parte); return r.iou > 0.6 || r.inB > 0.85; })) continue;
      aporto = true;
      const lp = toLow(parte, width, height, w, h);
      const gridStats = {};
      let ls = 0, ln = 0;
      for (let i = 0; i < lp.length; i++) if (lp[i]) { ls += luma[i]; ln++; }
      found.push({ mask: parte, g, texture: textureRatio(lp, grad, w, h, texGrad * 1.5), fine: textureRatio(lp, gradFine(), w, h, texGrad * 1.5), luma: ln ? ls / ln : 0, line: lineRatio(parte, fullGrad(), width, height, 10, 5, { loneLine, stats: gridStats }), grid: gridStats });
      if (opts.debugLines) { const G = fullGrad(); found[found.length - 1].lines = opts.debugLines.map((t) => lineRatio(parte, G, width, height, t)); }
    }
    sinNada = aporto ? 0 : sinNada + 1;
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
    let kind = classifySurface(g, { techoAlto }), why = kind ? null : 'forma', dudoso = false;
    if (kind === 'pared' && f.texture > maxTexture) { kind = null; why = 'textura'; } // vidrio con paisaje, puerta con paneles, mueble…
    if (kind === 'pared' && f.line > maxLine && (!lineGrid || hayGrilla(f.grid, lineGrid) || lineGridGuarda(f, g, lineGrid))) { kind = null; why = 'líneas'; } // azulejo: las juntas son líneas finas y rectas que una pared no tiene
    // Cielo, vidrio y luz de ventana: no son paredes aunque sean lisos y claros.
    //  - quemado: una pared fotografiada normal casi no tiene píxeles al tope de la escala (en las 15 fotos propias, 0 %); un cielo blanco, un vidrio o la luz
    //    de una ventana sí (n27 93 %, n20 99 %, n01 64–72 %, n17 35–68 %). Se descarta lo que tenga más de `hotMax` (una pared real con sol, n12: 25 %).
    //  - techo azul: ningún techo se pinta de azul cielo (n26: B−R = +0,47; los techos propios, ≤ +0,011).
    //  - techo con textura: el techo tampoco puede ser una persiana o un paisaje (la regla de `maxTexture` solo miraba paredes).
    let st = null;
    if ((kind || opts.debugCand) && (opts.debugCand || sky)) st = colorStats(clean, img);
    if (sky && kind) {
      if (st.hot > hotMax) why = 'quemado';
      else if (kind === 'techo' && st.blue > skyBlue) why = 'cielo azul';
      else if (kind === 'techo' && f.texture > techoMaxTexture) { if (techoRelax && f.texture <= (techoRelax.maxTexture ?? 0.35)) dudoso = true; else why = 'techo con textura'; }
      if (!why && kind === 'techo' && techoMinLuma && f.luma < techoMinLuma) { if (techoRelax && f.luma >= (techoRelax.minLuma ?? 45)) dudoso = true; else why = 'techo oscuro'; } // un techo de madera oscura o un hueco no es un techo a pintar (n34 luma 41, n09 49; los techos propios, ≥ 125: margen 2,5×)
      if (why) kind = null;
    }
    if (opts.debugCand && st) opts.debugCand({ mask: clean, kind: kind ?? `veto:${why}`, area: +g.area.toFixed(3), cx: +g.cx.toFixed(2), cy: +g.cy.toFixed(2), top: +g.top.toFixed(2), tex: +f.texture.toFixed(3), fine: +f.fine.toFixed(3), line: +f.line.toFixed(4), rows: f.grid?.rows, cols: f.grid?.cols, ...Object.fromEntries(Object.entries(st).map(([k, v]) => [k, +v.toFixed(3)])) });
    if (kind === 'pared' && tableVeto) { // una superficie horizontal vista desde arriba (tapa de escritorio, mesada): llena TODO el borde de abajo y su masa está en la mitad baja; una pared tiene piso o zócalo ahí
      let b = 0;
      for (let x = 0; x < width; x++) if (clean[(height - 2) * width + x]) b++;
      if (b / width >= 0.8 && g.cy > 0.65) { kind = null; why = 'tapa de mesa'; }
    }
    if (kind === 'pared' && minWallLuma && f.luma < minWallLuma) { kind = null; why = 'casi negro'; } // casi negro (hueco de puerta, marco oscuro, boca de pasillo): no es una pared a pintar
    if (!kind) { rechazadas.push({ ...g, mask: clean, texture: f.texture, luma: f.luma, lines: f.lines, line: f.line, why }); continue; }
    for (let i = 0; i < clean.length; i++) if (clean[i]) taken[i] = 1;
    out.push({ kind, mask: clean, ...g, texture: f.texture, luma: f.luma, lines: f.lines, dudoso });
  }

  const paredCubierta = out.filter((s) => s.kind === 'pared').reduce((a, s) => a + s.area, 0);
  const rescateExtra = rescue && paredRescate && paredCubierta < (paredRescate.cobertura ?? 0.2); // pared aceptada pero chica: la máscara grande rechazada suele ser pared + objetos
  if (rescue && (paredCubierta === 0 || rescateExtra)) { // ninguna pared aceptada (o muy poca): se prueba rescatar el color dominante de las máscaras rechazadas por textura (o por líneas con paredRescate)
    const ro = typeof rescue === 'object' ? rescue : {};
    for (const r of [...rechazadas]) {
      if (!(r.why === 'textura' || (rescateExtra && r.why === 'líneas')) || r.area < (ro.minAreaMask ?? 0.1) || r.texture > (ro.maxTex ?? 0.6) || !r.mask) continue;
      for (const m of rescueTextured(r.mask, img, fullGrad(), paredRescate ? { smoothThr: 10, tolLuma: 30, tolChroma: 0.04, ...(typeof paredRescate === 'object' ? paredRescate.rescate : null), ...ro } : ro)) { // paredRescate: tolerancias más anchas (una pared con sombra suave o luz degradada no es de un solo tono)
        const g = maskGeometry(m, width, height);
        if (classifySurface(g) !== 'pared') continue;
        const lp = toLow(m, width, height, w, h);
        let ls = 0, ln = 0;
        for (let i = 0; i < lp.length; i++) if (lp[i]) { ls += luma[i]; ln++; }
        const tex = textureRatio(lp, paredRescate?.fina ? gradFine() : grad, w, h, gradMax * 1.5), lu = ln ? ls / ln : 0; // paredRescate.fina: la textura del pedazo se mide con la luminancia suavizada (el grano fino de un revoque no cuenta, los bordes grandes sí)
        if (process.env.DEBUG_RESCUE) console.log('    [rescate]', g.area.toFixed(3), 'textura', tex.toFixed(3), 'luma', lu.toFixed(0));
        if (lu < (ro.minLuma ?? 80) || tex > (ro.maxCompTex ?? 0.05)) continue; // oscuro (madera, hueco) o con textura propia (reflejos de vidrio): no se arriesga
        out.push({ kind: 'pared', mask: m, ...g, texture: tex, luma: lu, rescatada: true });
      }
    }
    out.sort((a, b) => b.area - a.area);
  }

  // Un hueco de puerta o pasillo oscuro se ve mucho más oscuro que las paredes de la habitación: no es una pared a pintar.
  const refLuma = Math.max(0, ...out.filter((s) => s.kind === 'pared').slice(0, 1).map((s) => s.luma)); // `out` ya viene del más grande al más chico
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].kind === 'pared' && out[i].luma < refLuma * minLumaRatio) { rechazadas.push({ ...out[i], why: 'luma' }); out.splice(i, 1); }
  }
  if (sky && techoNeedsWall) { // un techo CLARO (luma > skyLuma; los techos propios ≤ 187, cielo n30 231, luz n02 218) solo vale si apoya en una pared aceptada: sin pared debajo es cielo o luz de una ventana
    const pm = out.filter((s) => s.kind === 'pared').map((s) => s.mask);
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].kind !== 'techo') continue;
      const contacto = pm.length ? ceilingWallContact(out[i].mask, pm, width, height) : 0;
      opts.debugCand?.({ kind: 'techo-contacto', area: +out[i].area.toFixed(3), contacto: +contacto.toFixed(3) });
      if (contacto < minTechoContact && out[i].luma > skyLuma) { rechazadas.push({ ...out[i], why: 'techo sin pared' }); out.splice(i, 1); }
    }
  }
  if (techoRelax) { // un techo oscuro o con textura (vigas, artesonado, lámpara) solo vale si apoya en una pared aceptada: sin pared debajo es un hueco, un paisaje o una persiana
    const pm = out.filter((s) => s.kind === 'pared').map((s) => s.mask);
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].kind !== 'techo' || !out[i].dudoso) continue;
      const contacto = pm.length ? ceilingWallContact(out[i].mask, pm, width, height) : 0;
      if (contacto < (techoRelax.minContact ?? minTechoContact)) { rechazadas.push({ ...out[i], why: 'techo dudoso sin pared' }); out.splice(i, 1); }
    }
  }
  let veto = null;
  if (frames && out.length) { // marco de un ventanal pegado al vidrio: se saca de la pared y no se vuelve a pintar
    const objetos = rechazadas.filter((r) => r.mask && r.texture > maxTexture && r.area >= 0.02).map((r) => r.mask);
    const cortado = cutFramesBesideObjects(out, objetos, fullGrad(), width, height, { ...opts.frameOpts, debug: opts.debugFrames });
    if (cortado.some((v) => v)) veto = cortado;
  }
  if (partition && out.length) { // "la máscara más chica gana": objetos y otros planos pegados a la pared
    const pr = await partitionBySmallest(out, segment, width, height, { G: fullGrad(), img, known: found.filter((f) => f.g.area >= minArea).map((f) => f.mask), ...opts.partitionOpts, debug: opts.debugPartition });
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
  if (enclosed && out.length) { // cuadros, interruptores, espejos, luminarias: objetos cerrados por un lazo de aristas adentro de la pared
    const cortado = cutEnclosedObjects(out, img, fullGrad(), { ...opts.enclosedOpts, debug: opts.debugEnclosed });
    if (cortado.some((v) => v)) { if (veto) for (let i = 0; i < cortado.length; i++) { if (cortado[i]) veto[i] = 1; } else veto = cortado; }
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
  if (trim && out.length) { // marcos, zócalos y molduras más claros que la pared: se sacan y se vetan
    for (const cortado of [trimBrightBands(out, img, { ...opts.trimOpts, debug: opts.debugTrim }), dropThinStrips(out, width, height, { ...opts.stripsThinOpts, debug: opts.debugTrim })]) {
      if (cortado.some((v) => v)) { if (veto) for (let i = 0; i < cortado.length; i++) { if (cortado[i]) veto[i] = 1; } else veto = cortado; }
    }
  }
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
