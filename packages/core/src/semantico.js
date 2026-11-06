// Detección guiada por un segmentador semántico de interiores (clases 0 otro, 1 pared, 2 techo, 3 piso).
// El modelo da un mapa de clases grueso (1/8 de resolución); SAM lo afina. Todo puro y determinista: `segment` lo inyecta quien llama.
import { removeSmallIslands } from './recolor.js';
// Diseño completo en training/DISENO-INTEGRACION.md (rama agente/g-modelos).

export const CLASE = { otro: 0, pared: 1, techo: 2, piso: 3 };

/** Componentes conexas (4 vecinos) de `mask` (Uint8Array w*h). Devuelve [{ id, area, bbox:[x0,y0,x1,y1], pixels:Int32Array }] y el mapa de etiquetas. */
export function componentes(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1), out = [], stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = out.length, px = [];
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(); px.push(i);
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && lab[i - 1] < 0) { lab[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && lab[i + 1] < 0) { lab[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && lab[i - w] < 0) { lab[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && lab[i + w] < 0) { lab[i + w] = id; stack.push(i + w); }
    }
    out.push({ id, area: px.length, bbox: [x0, y0, x1, y1], pixels: Int32Array.from(px) });
  }
  return { comps: out, lab };
}

/** Transformada de distancia (chamfer 3-4, en px aprox.) al borde de la componente, solo dentro de sus píxeles. */
export function distanciaInterior(comp, w, h) {
  const [x0, y0, x1, y1] = comp.bbox, bw = x1 - x0 + 1, bh = y1 - y0 + 1, INF = 1e9;
  const inside = new Uint8Array(bw * bh);
  for (const i of comp.pixels) { const x = i % w, y = (i - x) / w; inside[(y - y0) * bw + (x - x0)] = 1; }
  const d = new Float32Array(bw * bh);
  for (let k = 0; k < d.length; k++) d[k] = inside[k] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= bw || y >= bh ? 0 : d[y * bw + x]); // fuera de la caja = borde
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
  }
  for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
    const k = y * bw + x; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
  }
  return { d, bw, bh, x0, y0 };
}

/**
 * Semillas para SAM desde un mapa de clases. Por cada componente de pared/techo de al menos `minFrac` del área: hasta `maxPuntos`
 * puntos en los máximos de la distancia al borde, separados al menos `minSep` (fracción del lado mayor) y con distancia >= 40 % de la máxima.
 * Devuelve [{ kind, area, bbox, points:[{x,y}] (px) , mask (Uint8Array de la componente) }] de mayor a menor área.
 */
export function semillasDesdeMapa(classMap, w, h, { minFrac = 0.02, maxPuntos = 3, minSep = 0.12 } = {}) {
  const N = w * h, res = [];
  for (const [kind, cls] of [['pared', CLASE.pared], ['techo', CLASE.techo]]) {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (classMap[i] === cls) m[i] = 1;
    const { comps } = componentes(m, w, h);
    for (const c of comps) {
      if (c.area < minFrac * N) continue;
      const { d, bw, x0, y0 } = distanciaInterior(c, w, h);
      const cand = [];
      for (const i of c.pixels) { const x = i % w, y = (i - x) / w; cand.push([d[(y - y0) * bw + (x - x0)], x, y]); }
      cand.sort((a, b) => b[0] - a[0]);
      const dmax = cand[0][0], sep = minSep * Math.max(w, h), pts = [];
      for (const [dv, x, y] of cand) {
        if (dv < 0.4 * dmax || pts.length >= maxPuntos) break;
        if (pts.every((p) => Math.hypot(p.x - x, p.y - y) >= sep)) pts.push({ x, y });
      }
      const mask = new Uint8Array(N); for (const i of c.pixels) mask[i] = 1;
      res.push({ kind, area: c.area / N, bbox: c.bbox, points: pts, mask });
    }
  }
  return res.sort((a, b) => b.area - a.area);
}

function dilatar(mask, w, h, r) {
  const out = new Uint8Array(mask.length), tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && mask[y * w + xx]) v = 1; } tmp[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1; } out[y * w + x] = v; }
  return out;
}

/**
 * Superficies a partir del mapa de clases del modelo, afinadas por SAM.
 *  - cada componente -> SAM con sus semillas; la máscara de SAM se recorta a la componente dilatada (`dilate` px) y se acepta si su área
 *    está entre `minRatio` y `maxRatio` veces la de la componente y la máscara COMPLETA de SAM no pasa `maxFull` veces su área (SAM que se desborda se descarta); si no, se usa la propia componente (más tosca pero fiel al modelo).
 *  - máscaras disjuntas: gana la más chica (mismo criterio que el detector clásico).
 * Devuelve [{ kind, name, area, mask }] (mismo formato que detectSurfaces, sin el resto de los campos geométricos).
 */
export async function detectSurfacesSemantico(classMap, w, h, segment, { dilate = 6, minRatio = 0.5, maxRatio = 1.6, maxFull = 2.5, ...seedOpts } = {}) {
  const N = w * h, seeds = semillasDesdeMapa(classMap, w, h, seedOpts), out = [];
  for (const s of seeds) {
    const lim = dilatar(s.mask, w, h, dilate);
    let m = null;
    if (s.points.length) {
      const r = await segment(s.points);
      if (r) { m = new Uint8Array(N); let n = 0, full = 0; for (let i = 0; i < N; i++) { if (r[i]) full++; if (r[i] && lim[i]) { m[i] = 1; n++; } } if (n < minRatio * s.area * N || n > maxRatio * s.area * N || full > maxFull * s.area * N) m = null; }
    }
    out.push({ kind: s.kind, mask: m ?? s.mask, fuente: m ? 'sam' : 'modelo' });
  }
  out.sort((a, b) => count(a.mask) - count(b.mask)); // la más chica primero: gana lo específico
  const taken = new Uint8Array(N);
  for (const o of out) for (let i = 0; i < N; i++) { if (o.mask[i] && taken[i]) o.mask[i] = 0; else if (o.mask[i]) taken[i] = 1; }
  let np = 0;
  return out.filter((o) => count(o.mask) > 0.01 * N).map((o) => ({ kind: o.kind, name: o.kind === 'techo' ? 'Techo' : `Pared ${++np}`, area: count(o.mask) / N, mask: o.mask, fuente: o.fuente }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pared' ? -1 : 1));
}

const count = (m) => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; };

/**
 * Híbrido modelo + clásico. Las PAREDES las define el modelo; el TECHO lo dibuja el detector clásico (bordes más prolijos con la pared) cuando
 * el modelo también ve techo ahí (el clásico a veces marca una pared como techo: ese techo se descarta). Además se limpian las manchas sueltas de las paredes.
 * `found` = superficies del camino con modelo, `clasico` = superficies de detectSurfaces. Devuelve la lista nueva (no modifica las de entrada).
 * Opciones: minTechoModelo (fracción del techo clásico que el modelo también ve como techo, 0,4), islaMin (fracción de la foto bajo la cual una mancha suelta de pared se borra, 0,004).
 */
export function hibridar(found, clasico, classMap, w, h, { minTechoModelo = 0.4, islaMin = 0.004 } = {}) {
  const N = w * h, techo = new Uint8Array(N);
  let hayTecho = false;
  for (const c of clasico) {
    if (c.kind !== 'techo') continue;
    let sol = 0, tot = 0;
    for (let i = 0; i < N; i++) if (c.mask[i]) { tot++; if (classMap[i] === CLASE.techo) sol++; }
    if (tot && sol / tot >= minTechoModelo) { for (let i = 0; i < N; i++) if (c.mask[i]) techo[i] = 1; hayTecho = true; }
  }
  const out = [];
  for (const f of found) {
    if (f.kind === 'techo' && hayTecho) continue; // lo reemplaza el techo del clásico
    let m = f.mask;
    if (f.kind === 'pared') {
      if (hayTecho) { m = new Uint8Array(m); for (let i = 0; i < N; i++) if (techo[i]) m[i] = 0; }
      m = removeSmallIslands(m, w, h, Math.round(islaMin * N));
    }
    let a = 0; for (let i = 0; i < N; i++) if (m[i]) a++;
    if (a / N > 0.01) out.push({ ...f, mask: m, area: a / N });
  }
  if (hayTecho) {
    let a = 0; for (let i = 0; i < N; i++) if (techo[i]) a++;
    out.push({ name: 'Techo', kind: 'techo', area: a / N, mask: techo, fuente: 'clasico' });
  }
  return out;
}
