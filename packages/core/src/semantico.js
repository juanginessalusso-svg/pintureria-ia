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

function erosionar(mask, w, h, r) { // erosión = complemento de dilatar el complemento
  const inv = new Uint8Array(mask.length); for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilatar(inv, w, h, r); for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

/**
 * Completar con el modelo (opt-in): lo que el modelo ve como pared/techo y quedó SIN cubrir por ninguna superficie se vuelve a pedir.
 * Pasa cuando el modelo ve varias paredes como UNA mancha conectada (se tocan por una esquina o por arriba): SAM devuelve solo una
 * (la más grande) y las otras se pierden. Acá el resto sin cubrir se limpia con una apertura (radio `apertura`·ancho: saca las tiras
 * finas que quedan junto a los bordes) y cada pedazo de >= `minFrac` de la foto se segmenta de nuevo con detectSurfacesSemantico
 * (SAM con semillas en ese pedazo, recortado a él + `dilate`; si SAM se desborda, el pedazo mismo). Se agregan sin pisar lo que ya había.
 */
function rasgos(mask, L, G, w, h) { // mediana de luz, textura media en el INTERIOR (sin el borde de 3 px) y grosor medio (área / alto de la caja)
  const inner = erosionar(mask, w, h, 3), hist = new Uint32Array(256);
  let n = 0, tex = 0, nt = 0, y0 = h, y1 = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    n++; hist[Math.min(255, L[i] | 0)]++; const y = (i / w) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (inner[i]) { tex += G[i]; nt++; }
  }
  let acc = 0, med = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
  return { luz: med, tex: nt ? tex / nt : 0, grosor: n / Math.max(1, y1 - y0 + 1) };
}

export async function completarConModelo(found, classMap, w, h, segment, { apertura = 0.012, minFrac = 0.02, dilate = 6, image = null, minLuz = 0.5, minGrosor = 0.06, maxArea = 0.3, debug = false, ...semOpts } = {}) {
  const N = w * h, cubierto = new Uint8Array(N);
  for (const f of found) for (let i = 0; i < N; i++) if (f.mask[i]) cubierto[i] = 1;
  const rad = Math.max(1, Math.round(apertura * w)), resto = new Uint8Array(N);
  for (const [cls] of [[CLASE.pared], [CLASE.techo]]) {
    let m = new Uint8Array(N); for (let i = 0; i < N; i++) if (classMap[i] === cls && !cubierto[i]) m[i] = 1;
    m = dilatar(erosionar(m, w, h, rad), w, h, rad);
    for (let i = 0; i < N; i++) if (m[i] && !cubierto[i]) resto[i] = cls;
  }
  let hay = 0; for (let i = 0; i < N; i++) if (resto[i]) hay++;
  if (hay < minFrac * N) return found;
  const nuevos = await detectSurfacesSemantico(resto, w, h, segment, { dilate, minFrac, ...semOpts });
  const out = [...found];
  let np = found.filter((f) => f.kind === 'pared').length;
  // rasgos para el filtro (si viene la imagen): luz relativa a las paredes ya halladas, textura interior relativa y grosor
  let L = null, G = null, refLuz = 0, refTex = 0;
  if (image) {
    L = new Float32Array(N); G = new Float32Array(N);
    for (let i = 0; i < N; i++) L[i] = 0.299 * image.data[4 * i] + 0.587 * image.data[4 * i + 1] + 0.114 * image.data[4 * i + 2];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; G[i] = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]); }
    const paredes = new Uint8Array(N); for (const f of found) if (f.kind === 'pared') for (let i = 0; i < N; i++) if (f.mask[i]) paredes[i] = 1;
    const r = rasgos(paredes, L, G, w, h); refLuz = r.luz; refTex = r.tex;
  }
  for (const s of nuevos) {
    const m = new Uint8Array(N); let a = 0;
    for (let i = 0; i < N; i++) if (s.mask[i] && !cubierto[i]) { m[i] = 1; a++; }
    if (a / N < minFrac) continue;
    if (L && s.kind === 'pared') {
      const r = rasgos(m, L, G, w, h), luz = refLuz ? r.luz / refLuz : 1, tex = refTex ? r.tex / refTex : 1;
      const ok = luz >= minLuz && r.grosor >= minGrosor * w && a / N <= maxArea; // la textura se registra (debug) pero no filtra: probado 2026-11-07, cortaba paredes en tiras
      if (debug) console.log(`  [completar] área ${(100 * a / N).toFixed(1)} % · luz ${luz.toFixed(2)} · textura ${tex.toFixed(2)} · grosor ${(r.grosor / w).toFixed(3)} → ${ok ? 'SE AGREGA' : 'descartado'}`);
      if (!ok) continue;
    }
    for (let i = 0; i < N; i++) if (m[i]) cubierto[i] = 1;
    const techo = s.kind === 'techo' && out.find((f) => f.kind === 'techo');
    if (techo) { const t = new Uint8Array(techo.mask); for (let i = 0; i < N; i++) if (m[i]) t[i] = 1; techo.mask = t; techo.area += a / N; continue; } // un solo techo
    out.push({ kind: s.kind, name: s.kind === 'techo' ? 'Techo' : `Pared ${++np}`, area: a / N, mask: m, fuente: 'completar' });
  }
  return out;
}

/**
 * Veto del modelo (opt-in): el modelo decide las ZONAS y SAM/el clásico solo afinan el BORDE.
 * Cada superficie se recorta a lo que el modelo ve como su clase (pared -> pared, techo -> techo) dilatado `r` (fracción del ancho):
 * así SAM puede correr el borde hasta ~r para asentarlo en la arista real, pero no puede sumar una región que el modelo ve como otra cosa
 * (la puerta blanca que SAM pega a la pared, lo que agrega `union`/`fusion`). Después se borran las manchas sueltas.
 * Devuelve una lista nueva; descarta superficies que quedan < 1 % de la foto.
 */
export function vetarConModelo(found, classMap, w, h, { r = 0.02, islaMin = 0.004 } = {}) {
  const N = w * h, rad = Math.max(1, Math.round(r * w)), zonas = {};
  for (const [kind, cls] of [['pared', CLASE.pared], ['techo', CLASE.techo]]) {
    const z = new Uint8Array(N); for (let i = 0; i < N; i++) if (classMap[i] === cls) z[i] = 1;
    zonas[kind] = dilatar(z, w, h, rad);
  }
  const out = [];
  for (const f of found) {
    const z = zonas[f.kind];
    if (!z) { out.push(f); continue; }
    let m = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (f.mask[i] && z[i]) m[i] = 1;
    m = removeSmallIslands(m, w, h, Math.round(islaMin * N));
    const a = count(m) / N;
    if (a > 0.01) out.push({ ...f, mask: m, area: a });
  }
  return out;
}

/**
 * Híbrido modelo + clásico. Las PAREDES las define el modelo; el TECHO lo dibuja el detector clásico (bordes más prolijos con la pared) cuando
 * el modelo también ve techo ahí (el clásico a veces marca una pared como techo: ese techo se descarta). Además se limpian las manchas sueltas de las paredes.
 * `found` = superficies del camino con modelo, `clasico` = superficies de detectSurfaces. Devuelve la lista nueva (no modifica las de entrada).
 * Opciones: minTechoModelo (fracción del techo clásico que el modelo también ve como techo, 0,4), islaMin (fracción de la foto bajo la cual una mancha suelta de pared se borra, 0,004).
 */
/**
 * Recorte de objetos (opt-in): lo PINTADO que el modelo ve como 'otro' y tiene cuerpo (no una franja fina de borde) se le pide a SAM con un punto
 * en su centro. Si SAM devuelve algo acotado (<= maxFrac de la foto) y mayormente 'otro' para el modelo (>= minOtro), se saca de todas las superficies:
 * así un cuadro, la tele, una puerta o un mueble quedan fuera con el borde exacto de SAM, aunque el veto los haya dejado pasar por su margen.
 */
export async function recortarObjetos(found, classMap, w, h, segment, { nucleo = 0.006, minFrac = 0.002, maxObjetos = 8, minOtro = 0.6, maxFrac = 0.25, islaMin = 0.004, debug = false } = {}) {
  const N = w * h, pint = new Uint8Array(N);
  for (const f of found) for (let i = 0; i < N; i++) if (f.mask[i]) pint[i] = 1;
  let p = new Uint8Array(N); for (let i = 0; i < N; i++) if (pint[i] && classMap[i] === CLASE.otro) p[i] = 1;
  p = erosionar(p, w, h, Math.max(1, Math.round(nucleo * w))); // sin las franjas finas del borde (ahí manda SAM, no el modelo)
  const cands = componentes(p, w, h).comps.filter((c) => c.area >= minFrac * N).sort((a, b) => b.area - a.area).slice(0, maxObjetos);
  if (!cands.length) return found;
  const sacar = new Uint8Array(N);
  for (const c of cands) {
    const { d, bw, x0, y0 } = distanciaInterior(c, w, h);
    let best = 0, bx = 0, by = 0; for (let k = 0; k < d.length; k++) if (d[k] > best) { best = d[k]; bx = x0 + (k % bw); by = y0 + ((k / bw) | 0); }
    const m = (await segment([{ x: bx, y: by, label: 1 }])).mask;
    let a = 0, o = 0; for (let i = 0; i < N; i++) if (m[i]) { a++; if (classMap[i] === CLASE.otro) o++; }
    const ok = a > 0 && a <= maxFrac * N && o / a >= minOtro;
    if (debug) console.log(`  [objetos] núcleo ${(100 * c.area / N).toFixed(1)} % en (${bx},${by}) · SAM ${(100 * a / N).toFixed(1)} % · otro ${a ? (100 * o / a).toFixed(0) : 0} % → ${ok ? 'SE SACA' : 'se deja'}`);
    if (ok) for (let i = 0; i < N; i++) if (m[i]) sacar[i] = 1;
  }
  const out = [];
  for (const f of found) {
    let m = new Uint8Array(N), cambio = false;
    for (let i = 0; i < N; i++) { if (f.mask[i] && !sacar[i]) m[i] = 1; else if (f.mask[i]) cambio = true; }
    if (!cambio) { out.push(f); continue; }
    m = removeSmallIslands(m, w, h, Math.round(islaMin * N));
    const a = count(m) / N;
    if (a > 0.01) out.push({ ...f, mask: m, area: a });
  }
  return out;
}

export function hibridar(found, clasico, classMap, w, h, { minTechoModelo = 0.4, islaMin = 0.004, union = false, unionMinArea = 0.02, partir = false, partirMinSolape = 0.15 } = {}) {
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
  // union (opt-in): las PAREDES del clásico que el modelo dejó como 'otro' (p. ej. una pared muy oscura) se suman a la pared del modelo con la que más se solapan
  //  (o quedan como superficie propia si no se solapan con ninguna). No se suma lo que el modelo ve como techo o piso ni lo que ya es techo.
  if (union) {
    for (const c of clasico) {
      if (c.kind !== 'pared') continue;
      const libre = new Uint8Array(N); let nl = 0;
      const ocupado = new Uint8Array(N);
      for (const o of out) if (o.kind === 'pared') for (let i = 0; i < N; i++) if (o.mask[i]) ocupado[i] = 1;
      for (let i = 0; i < N; i++) if (c.mask[i] && !ocupado[i] && !techo[i] && classMap[i] !== CLASE.techo && classMap[i] !== CLASE.piso) { libre[i] = 1; nl++; }
      const limpio = removeSmallIslands(libre, w, h, Math.round(islaMin * N));
      let a = 0; for (let i = 0; i < N; i++) if (limpio[i]) a++;
      if (a / N < unionMinArea) continue;
      let mejor = null, mejorSol = 0;
      for (const o of out) { if (o.kind !== 'pared') continue; let sol = 0; for (let i = 0; i < N; i++) if (o.mask[i] && c.mask[i]) sol++; if (sol > mejorSol) { mejorSol = sol; mejor = o; } }
      if (mejor) { const m = new Uint8Array(mejor.mask); for (let i = 0; i < N; i++) if (limpio[i]) m[i] = 1; let t = 0; for (let i = 0; i < N; i++) if (m[i]) t++; mejor.mask = m; mejor.area = t / N; }
      else out.push({ name: c.name, kind: 'pared', area: a / N, mask: limpio, fuente: 'clasico' });
    }
  }
  // partir (opt-in): una pared del modelo que abarca DOS o más paredes del clásico (dos paredes que se juntan en una esquina son una sola componente conexa para el modelo)
  //  se parte según el clásico: cada píxel va a la pared del clásico que lo contiene o, si no hay, a la más cercana dentro de la pared del modelo.
  if (partir) {
    const clas = clasico.filter((c) => c.kind === 'pared' && c.area >= 0.03);
    const res = [];
    for (const o of out) {
      if (o.kind !== 'pared') { res.push(o); continue; }
      let tot = 0; for (let i = 0; i < N; i++) if (o.mask[i]) tot++;
      const dueños = clas.filter((c) => { let sol = 0; for (let i = 0; i < N; i++) if (o.mask[i] && c.mask[i]) sol++; return tot && sol / tot >= partirMinSolape; });
      if (dueños.length < 2) { res.push(o); continue; }
      const dueño = new Int8Array(N).fill(-1), cola = [];
      dueños.forEach((c, k) => { for (let i = 0; i < N; i++) if (o.mask[i] && c.mask[i] && dueño[i] < 0) { dueño[i] = k; cola.push(i); } });
      for (let q = 0; q < cola.length; q++) { // expansión desde las semillas, solo dentro de la pared del modelo
        const i = cola[q], x = i % w, k = dueño[i];
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < N - w ? i + w : -1]) if (j >= 0 && o.mask[j] && dueño[j] < 0) { dueño[j] = k; cola.push(j); }
      }
      const partes = dueños.map((c, k) => { const m = new Uint8Array(N); let a = 0; for (let i = 0; i < N; i++) if (dueño[i] === k) { m[i] = 1; a++; } return { ...o, name: c.name, mask: m, area: a / N }; }).filter((p) => p.area > 0.01);
      res.push(...partes);
    }
    out.length = 0; out.push(...res);
  }
  if (hayTecho) {
    let a = 0; for (let i = 0; i < N; i++) if (techo[i]) a++;
    out.push({ name: 'Techo', kind: 'techo', area: a / N, mask: techo, fuente: 'clasico' });
  }
  return out;
}

/**
 * Superficies DIRECTO del mapa de clases (sin SAM): para el mapa del servidor con GPU (SAM 3 + r9), que ya trae los bordes exactos.
 * Cada zona conectada de pared o techo de al menos `minFrac` de la foto es una superficie (así una cornisa y la pared de abajo,
 * separadas por una columna de ladrillo, se pueden pintar de colores distintos). Antes se sacan las manchas sueltas < `islaMin`.
 * Medido 2026-11-10: el paso con MobileSAM (semillas + completar + veto) perdía paños que el mapa sí tenía (pared beige de fachada-05/06)
 * y tardaba 10-40 s en el celular; esto es instantáneo.
 * Devuelve [{ name, kind, area, mask }] (paredes de mayor a menor, después el techo).
 */
export function superficiesDesdeMapa(classMap, w, h, { minFrac = 0.01, islaMin = 0.002, instancias = null } = {}) {
  const N = w * h, out = [];
  for (const [kind, cls] of [['pared', CLASE.pared], ['techo', CLASE.techo]]) {
    let m = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (classMap[i] === cls) m[i] = 1;
    m = removeSmallIslands(m, w, h, Math.round(islaMin * N));
    let zonas;
    if (kind === 'pared' && instancias) zonas = zonasPorInstancia(m, instancias, w, h, minFrac);
    else zonas = componentes(m, w, h).comps.filter((c) => c.area >= minFrac * N).map((c) => { const z = new Uint8Array(N); for (const i of c.pixels) z[i] = 1; return { mask: z, area: c.area }; });
    zonas.sort((a, b) => b.area - a.area).forEach((z, k) => {
      const name = kind === 'techo' ? (zonas.length > 1 ? `Techo ${k + 1}` : 'Techo') : `Pared ${k + 1}`;
      out.push({ name, kind, area: z.area / N, mask: z.mask });
    });
  }
  return out;
}

/**
 * Separa la pared en muros usando el número de pared por píxel que manda el servidor (instancias de SAM 3): cada zona conectada de un
 * mismo número >= minFrac es un muro; lo que queda sin número o en pedacitos (el relleno de r9) se suma al muro vecino (BFS por la pared).
 * Lo que no toca ningún muro y es grande queda como muro propio.
 */
function zonasPorInstancia(pared, ids, w, h, minFrac) {
  const N = w * h, lab = new Int32Array(N), zonas = [];
  let maxId = 0; for (let i = 0; i < N; i++) if (pared[i] && ids[i] > maxId) maxId = ids[i];
  for (let g = 1; g <= maxId; g++) {
    const m = new Uint8Array(N); let hay = false;
    for (let i = 0; i < N; i++) if (pared[i] && ids[i] === g && !lab[i]) { m[i] = 1; hay = true; }
    if (!hay) continue;
    for (const c of componentes(m, w, h).comps) {
      if (c.area < minFrac * N) continue;
      zonas.push(null); const k = zonas.length; for (const i of c.pixels) lab[i] = k;
    }
  }
  // BFS: la pared sin muro se reparte entre los muros vecinos
  const cola = new Int32Array(N); let a = 0, b = 0;
  for (let i = 0; i < N; i++) if (lab[i]) cola[b++] = i;
  while (a < b) {
    const i = cola[a++], x = i % w, k = lab[i];
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && pared[j] && !lab[j]) { lab[j] = k; cola[b++] = j; }
  }
  // lo que no tocó ningún muro: zonas propias si son grandes
  const resto = new Uint8Array(N); for (let i = 0; i < N; i++) if (pared[i] && !lab[i]) resto[i] = 1;
  for (const c of componentes(resto, w, h).comps) {
    if (c.area < minFrac * N) continue;
    zonas.push(null); const k = zonas.length; for (const i of c.pixels) lab[i] = k;
  }
  const res = zonas.map(() => ({ mask: new Uint8Array(N), area: 0 }));
  for (let i = 0; i < N; i++) if (lab[i]) { const z = res[lab[i] - 1]; z.mask[i] = 1; z.area++; }
  return res.filter((z) => z.area > 0);
}

/**
 * Margen alrededor de un objeto CONOCIDO (veto 2 = el servidor reconoció el objeto con SAM 3: campana, portero, cable, llave, tablero,
 * enchufe, tapa, cuadro). El mapa deja sin asignar un margen ancho y serruchado alrededor (halo blanco); como ahora sabemos exactamente
 * dónde está el objeto, todo lo demás del hueco que tenga el color de la pared que lo rodea se pinta. Idea del HANDOFF 2026-11-12.
 * Hueco = mancha sin asignar (incluye el objeto) que no toca el borde de la foto, rodeada casi toda por una superficie y que contiene
 * objeto conocido. No se pinta el objeto (dilatado `margenObj` px), ni lo vetado por regla (veto 1), ni lo que no tiene color de pared.
 * APAGADO por defecto (opts.alrededor): en p…181544 pintaba el tubo blanco del portero, que SAM 3 no reconoció (0,40) y tiene tan poco
 * contraste con la pared que ningún freno por bordes lo separa. Prender cuando el servidor marque todos los objetos del hueco.
 * El relleno crece desde el borde del hueco y no cruza bordes marcados de la foto: si en el mismo hueco hay otro objeto blanco que el
 * servidor no reconoció (el tubo del portero en p…181544), su contorno lo frena.
 */
function rellenarAlrededorDeObjetos(data, w, h, lab, agregado, veto, { maxFrac = 0.04, margenObj = 2, minObj = 0.03, tolCroma = 0.035, luzMin = 0.6, luzMax = 1.35, dominio = 0.85, gradMax = 8 } = {}) {
  const N = w * h;
  // gradiente de la luz suavizada (3x3), calculado solo donde se pide
  const L3 = (i) => { const x = i % w, y = (i - x) / w; let t = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = (yy * w + xx) * 4; t += data[q] + data[q + 1] + data[q + 2]; n++; } return t / n / 3; };
  const G = (i) => { const x = i % w; if (x < 2 || x >= w - 2 || i < 2 * w || i >= N - 2 * w) return 0; return Math.hypot(L3(i + 1) - L3(i - 1), L3(i + w) - L3(i - w)) / 2; };
  // objeto dilatado
  let obj = new Uint8Array(N); let hay = false; for (let i = 0; i < N; i++) if (veto[i] === 2) { obj[i] = 1; hay = true; }
  if (!hay) return;
  for (let k = 0; k < margenObj; k++) { const o2 = obj.slice(); for (let i = w; i < N - w; i++) if (!obj[i] && (obj[i - 1] || obj[i + 1] || obj[i - w] || obj[i + w])) o2[i] = 1; obj = o2; }
  const libre = new Uint8Array(N); for (let i = 0; i < N; i++) if (!lab[i] && veto[i] !== 1) libre[i] = 1;
  for (const c of componentes(libre, w, h).comps) {
    const dbg = globalThis.process?.env?.DEBUG_ENC && c.area > 2000 ? (m) => console.error('alrededor', c.bbox.join(','), c.area, m) : () => {};
    if (c.area > maxFrac * N) { dbg('grande'); continue; }
    const [x0, y0, x1, y1] = c.bbox; if (x0 <= 0 || y0 <= 0 || x1 >= w - 1 || y1 >= h - 1) { dbg('borde'); continue; }
    let nObj = 0; for (const i of c.pixels) if (veto[i] === 2) nObj++;
    if (nObj < minObj * c.area) { dbg('sin objeto ' + nObj); continue; }
    const votos = new Map(); let sS = 0, sR = 0, sG = 0, nR = 0;
    for (const i of c.pixels) for (const j of [i - 1, i + 1, i - w, i + w]) { const k = lab[j]; if (!k) continue; votos.set(k, (votos.get(k) ?? 0) + 1); const q = j * 4, sm = data[q] + data[q + 1] + data[q + 2] + 1; sS += sm; sR += data[q] / sm; sG += data[q + 1] / sm; nR++; }
    if (nR < 20) continue;
    let mejor = 0, nm = 0; for (const [k, v] of votos) if (v > nm) { mejor = k; nm = v; }
    if (nm < dominio * nR) { dbg('dominio ' + (nm / nR).toFixed(2)); continue; }
    sS /= nR; sR /= nR; sG /= nR; dbg('rellena'); let puestos = 0, rl = 0, rc = 0;
    const ok = (i) => {
      if (obj[i] || lab[i] || veto[i] === 1) return false;
      const q = i * 4, sm = data[q] + data[q + 1] + data[q + 2] + 1, luz = sm / sS;
      if (luz < luzMin || luz > luzMax) { rl++; return false; }
      if (Math.abs(data[q] / sm - sR) > tolCroma || Math.abs(data[q + 1] / sm - sG) > tolCroma) { rc++; return false; }
      return G(i) < gradMax; // no cruza el contorno de un objeto que el servidor no reconoció (tubo blanco del portero en p…181544)
    };
    // crece desde el borde del hueco (lo pegado a la superficie) sin cruzar bordes de la foto
    const cola = [];
    for (const i of c.pixels) if ((lab[i - 1] === mejor || lab[i + 1] === mejor || lab[i - w] === mejor || lab[i + w] === mejor) && ok(i)) { lab[i] = mejor; agregado[i] = 1; puestos++; cola.push(i); }
    for (let a = 0; a < cola.length; a++) { const i = cola[a]; for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < N && ok(j)) { lab[j] = mejor; agregado[j] = 1; puestos++; cola.push(j); } }
    dbg('puestos ' + puestos + ' rechazados luz ' + rl + ' croma ' + rc);
  }
}

/**
 * Pared ENCERRADA por un objeto fino (prueba de Ginés 2026-11-12: la pared dentro del rulo del cable del portero quedaba blanca).
 * Lo sin asignar se parte en zonas LISAS (gradiente de luz < gradMax: los contornos de los objetos cortan). Una zona se pinta con la
 * superficie que la rodea si tiene el color de esa pared (cromaticidad ±tolCroma; luz entre luzMin y luzMax de la pared a `pad` px),
 * mide entre minFrac y maxFrac de la foto, no toca el borde de la foto y no es una tira finita (grosorMin px).
 * Medido en el set de regresión (2026-11-12): la pared dentro del rulo queda ~1 % MÁS OSCURA (sombra del cable); lo que sobresale de la
 * pared y es del mismo blanco (tapas, machimbre, molduras, frente del aparato) queda 1,5-5 % MÁS CLARO: por eso luzMax es 1,01.
 * El marco de una ventana toca el borde de la foto; una moldura es una tira de ~10 px. La zona tiene que ser una parte chica de su
 * hueco (parteMax: pared vista a través de un cable o una silla, no un cuadro entero) y no mucho más lisa que la pared (texMin: una caja
 * sobre revoque). DEBUG_ENC=1 en Node imprime cada zona aceptada. Modifica lab/agregado en el lugar.
 */
function rellenarEncerrados(data, w, h, lab, agregado, veto, { gradMax = 4, luzMin = 0.965, luzMax = 1.01, tolCroma = 0.012, minFrac = 0.001, maxFrac = 0.02, grosorMin = 8, parteMax = 0.5, texMin = 0.45, pad = 15, dominio = 0.8 } = {}) {
  const N = w * h, L = new Float32Array(N), Ls = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; t += L[yy * w + xx]; n++; } }
    Ls[y * w + x] = t / n;
  }
  const libre = new Uint8Array(N), liso = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (Ls[i - w + 1] + 2 * Ls[i + 1] + Ls[i + w + 1]) - (Ls[i - w - 1] + 2 * Ls[i - 1] + Ls[i + w - 1]);
    const gy = (Ls[i + w - 1] + 2 * Ls[i + w] + Ls[i + w + 1]) - (Ls[i - w - 1] + 2 * Ls[i - w] + Ls[i - w + 1]);
    if (Math.hypot(gx, gy) / 8 >= gradMax) continue;
    liso[i] = 1; if (!lab[i] && !(veto && veto[i])) libre[i] = 1;
  }
  // hueco = cada mancha conexa de lo sin asignar (objeto + su margen); la zona lisa tiene que ser una parte chica de él
  const sinAsignar = new Uint8Array(N); for (let i = 0; i < N; i++) if (!lab[i] && !(veto && veto[i] && veto[i] !== 2)) sinAsignar[i] = 1; // el objeto conocido (veto 2) es parte del hueco
  const huecos = componentes(sinAsignar, w, h), areaHueco = (i) => huecos.comps[huecos.lab[i]].area;
  const cr = (i) => data[i * 4] / (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] + 1), cg = (i) => data[i * 4 + 1] / (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] + 1);
  for (const c of componentes(libre, w, h).comps) {
    if (c.area < minFrac * N || c.area > maxFrac * N) continue;
    const [bx0, by0, bx1, by1] = c.bbox;
    if (bx0 <= 1 || by0 <= 1 || bx1 >= w - 2 || by1 >= h - 2) continue; // toca el borde de la foto: no está encerrada (marco de ventana)
    if (c.area / (Math.max(bx1 - bx0, by1 - by0) + 1) < grosorMin) continue; // tira finita: moldura, varilla
    // anillo = píxeles de superficie a <= pad px de la zona (dilatación separable dentro de la caja agrandada)
    const [x0, y0, x1, y1] = c.bbox, X0 = Math.max(0, x0 - pad), Y0 = Math.max(0, y0 - pad), X1 = Math.min(w - 1, x1 + pad), Y1 = Math.min(h - 1, y1 + pad);
    const bw = X1 - X0 + 1, bh = Y1 - Y0 + 1, cerca = new Uint8Array(bw * bh), fila = new Uint8Array(bw * bh), dil = new Uint8Array(bw * bh);
    for (const i of c.pixels) { const x = i % w, y = (i - x) / w; cerca[(y - Y0) * bw + (x - X0)] = 1; }
    for (let y = 0; y < bh; y++) {
      let u = -1e9; for (let x = 0; x < bw; x++) { if (cerca[y * bw + x]) u = x; if (x - u <= pad) fila[y * bw + x] = 1; }
      u = 1e9; for (let x = bw - 1; x >= 0; x--) { if (cerca[y * bw + x]) u = x; if (u - x <= pad) fila[y * bw + x] = 1; }
    }
    for (let x = 0; x < bw; x++) {
      let u = -1e9; for (let y = 0; y < bh; y++) { if (fila[y * bw + x]) u = y; if (y - u <= pad) dil[y * bw + x] = 1; }
      u = 1e9; for (let y = bh - 1; y >= 0; y--) { if (fila[y * bw + x]) u = y; if (u - y <= pad) dil[y * bw + x] = 1; }
    }
    const votos = new Map(); let sL = 0, sR = 0, sG = 0, sT = 0, nT = 0, nR = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!dil[y * bw + x] || cerca[y * bw + x]) continue;
      const i = (y + Y0) * w + (x + X0), k = lab[i]; if (!k) continue;
      votos.set(k, (votos.get(k) ?? 0) + 1); sL += Ls[i]; sR += cr(i); sG += cg(i); if (liso[i]) { sT += Math.abs(L[i] - Ls[i]); nT++; } nR++;
    }
    if (nR < 20) continue;
    let mejor = 0, nm = 0; for (const [k, v] of votos) if (v > nm) { mejor = k; nm = v; }
    if (nm < dominio * nR) continue; // rodeada por más de una superficie: no se sabe de cuál es
    let zL = 0, zR = 0, zG = 0, zT = 0; for (const i of c.pixels) { zL += Ls[i]; zR += cr(i); zG += cg(i); zT += Math.abs(L[i] - Ls[i]); }
    zL /= c.area; zR /= c.area; zG /= c.area; zT /= c.area;
    const rl = zL / (sL / nR);
    if (rl < luzMin || rl > luzMax || Math.abs(zR - sR / nR) + Math.abs(zG - sG / nR) > tolCroma) continue;
    if (c.area > parteMax * areaHueco(c.pixels[0])) continue; // la zona lisa es casi todo el objeto (cuadro, tapa): no es pared vista a través
    if (nT && zT < texMin * (sT / nT)) continue; // mucho más lisa que la pared (frente de una caja sobre revoque)
    if (globalThis.process?.env?.DEBUG_ENC) { const [a0, b0, a1, b1] = c.bbox; console.error(`enc ${a0},${b0} ${a1 - a0 + 1}x${b1 - b0 + 1} area ${c.area} parte ${(c.area / areaHueco(c.pixels[0])).toFixed(2)} tex ${zT.toFixed(2)}/${(sT / Math.max(1, nT)).toFixed(2)} relleno ${(c.area / ((a1 - a0 + 1) * (b1 - b0 + 1))).toFixed(2)} luz ${(zL / (sL / nR)).toFixed(3)}`); }
    for (const i of c.pixels) { lab[i] = mejor; agregado[i] = 1; }
  }
}

/**
 * Cierra los bordes blancos que deja el mapa del servidor: SAM 3 termina cada superficie unos píxeles antes de la arista (pared-techo,
 * esquinas, contorno de muebles) y el mapa llega agrandado (1280 -> 1600 px, con escalones). Cada superficie crece por BFS hasta `r` px
 * hacia lo que quedó SIN asignar, solo si el píxel se parece al color original de esa superficie (misma cromaticidad y luz parecida):
 * así se cierran las uniones sin comerse una estufa o un mueble de otro color. Lo que está entre dos superficies queda para la más cercana.
 * img: { data RGBA, width, height }. Devuelve superficies nuevas (no modifica las de entrada).
 */
export function rellenarBordes(found, img, { r = null, tolCroma = 0.035, luzMin = 0.55, luzMax = 1.6, veto = null, huecoMin = 0.0003, pasoHueco = 12, encerrados = true, sombra = true, alrededor = false } = {}) {
  const { data, width: w, height: h } = img, N = w * h;
  if (!found.length) return found;
  const R = r ?? Math.max(2, Math.round(0.01 * Math.max(w, h)));
  const lab = new Int32Array(N), dist = new Uint16Array(N);
  const ref = found.map(() => ({ s: 0, cr: 0, cg: 0, n: 0 }));
  found.forEach((f, k) => {
    const q = ref[k];
    for (let i = 0; i < N; i++) if (f.mask[i] && !lab[i]) {
      lab[i] = k + 1;
      if ((i & 7) === 0) { const a = data[i * 4], b = data[i * 4 + 1], c = data[i * 4 + 2], s = a + b + c + 1; q.s += s; q.cr += a / s; q.cg += b / s; q.n++; }
    }
  });
  for (const q of ref) { const n = Math.max(1, q.n); q.s /= n; q.cr /= n; q.cg /= n; }
  // Huecos = objetos (llave de luz, tablero, cuadro): lo sin asignar que queda ENCERRADO por una sola superficie, sin tocar el borde de la
  // foto y con grosor de objeto, no se rellena aunque sea blanco como la pared (prueba de Ginés: la tapa de la llave salía pintada).
  const hueco = new Uint8Array(N);
  if (huecoMin > 0) {
    const libre = new Uint8Array(N); for (let i = 0; i < N; i++) if (!lab[i]) libre[i] = 1;
    const G = Math.max(w, h);
    for (const c of componentes(libre, w, h).comps) {
      if (c.area < huecoMin * N) continue;
      let x0 = w, x1 = -1, y0 = h, y1 = -1, borde = false; const vecinas = new Set();
      for (const i of c.pixels) {
        const x = i % w, y = (i - x) / w;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { borde = true; break; }
        for (const j of [i - 1, i + 1, i - w, i + w]) if (lab[j]) vecinas.add(lab[j]);
      }
      if (borde || vecinas.size !== 1 || Math.min(x1 - x0, y1 - y0) + 1 < 0.006 * G) continue;
      for (const i of c.pixels) hueco[i] = 1;
    }
  }
  const cola = new Int32Array(N); let a = 0, b = 0;
  for (let i = 0; i < N; i++) if (lab[i]) cola[b++] = i;
  const agregado = new Uint8Array(N), orig = new Int32Array(N).fill(-1), ent = new Int32Array(N).fill(-1);
  // luz local (r+g+b promedio 5x5) del píxel de la superficie por donde entró el relleno
  const luzLocal = (i) => { const x = i % w, y = (i - x) / w; let t = 0, n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = (yy * w + xx) * 4; t += data[q] + data[q + 1] + data[q + 2] + 1; n++; } return t / n; };
  // entre: píxel sin asignar con superficie a los DOS lados (izq. y der., o arriba y abajo) a <= 2R px: un hueco finito como la arista de
  // una esquina en sombra. El borde de un mueble oscuro tiene pared de un solo lado.
  const entre = new Uint8Array(N);
  if (sombra) {
    const W = 2 * R;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (lab[i]) continue;
      let l = false, r2 = false, u = false, dn = false;
      for (let t = 1; t <= W && !(l && r2); t++) { if (!l && x - t >= 0 && lab[i - t]) l = true; if (!r2 && x + t < w && lab[i + t]) r2 = true; }
      if (l && r2) { entre[i] = 1; continue; }
      for (let t = 1; t <= W && !(u && dn); t++) { if (!u && y - t >= 0 && lab[i - t * w]) u = true; if (!dn && y + t < h && lab[i + t * w]) dn = true; }
      if (u && dn) entre[i] = 1;
    }
  }
  const l3 = new Float32Array(N).fill(-1);
  const luz3 = (i) => { if (l3[i] < 0) { const x = i % w, y = (i - x) / w; let t = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const q = (yy * w + xx) * 4; t += data[q] + data[q + 1] + data[q + 2]; n++; } l3[i] = t / n; } return l3[i]; };
  while (a < b) {
    const i = cola[a++], k = lab[i], d = dist[i];
    if (d >= R) continue;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= N || lab[j] || (veto && veto[j])) continue; // veto: lo que el servidor sacó a propósito (zócalo, azulejo, cielo...)
      const q = ref[k - 1], p0 = data[j * 4], p1 = data[j * 4 + 1], p2 = data[j * 4 + 2], s = p0 + p1 + p2 + 1;
      const luz = s / q.s, e = ent[i] >= 0 ? ent[i] : i;
      const cromaOk = Math.abs(p0 / s - q.cr) <= tolCroma && Math.abs(p1 / s - q.cg) <= tolCroma;
      if (!cromaOk || luz < luzMin || luz > luzMax) {
        // pared en sombra (esquina detrás de la campana, c02): luz y color se comparan con la pared PEGADA por donde entró, no con el
        // promedio de toda la superficie (la sombra puede ser menos de la mitad y en lo oscuro el tono se corre). Sin saltar más de ±25 %.
        if (!sombra || luz < 0.25 || !entre[j]) continue;
        const ll = s / luzLocal(e); if (ll < 0.8 || ll > 1.25) continue;
        // sin saltos (un borde de mueble o un cable es un salto; la sombra de una esquina es gradual) y color casi igual
        const qe = e * 4, se = data[qe] + data[qe + 1] + data[qe + 2] + 1; // color del píxel de pared por donde entró
        if (Math.abs(p0 / s - data[qe] / se) > tolCroma * 0.5 || Math.abs(p1 / s - data[qe + 1] / se) > tolCroma * 0.5) continue;
        if (Math.abs(luz3(j) - luz3(i)) > 0.08 * luz3(i) + 4) continue;
      }
      // dentro de un hueco (objeto claro como la pared): avanza solo mientras el color no salta de un píxel al otro NI se aleja del de la
      // pared por donde entró (orig), así frena en el contorno del objeto aunque el borde sea difuso
      const o = orig[i] >= 0 ? orig[i] : i;
      if (hueco[j]) {
        const pi = i * 4, po = o * 4;
        if (Math.abs(p0 - data[pi]) + Math.abs(p1 - data[pi + 1]) + Math.abs(p2 - data[pi + 2]) > pasoHueco) continue;
        if (Math.abs(p0 - data[po]) + Math.abs(p1 - data[po + 1]) + Math.abs(p2 - data[po + 2]) > 2 * pasoHueco) continue;
      }
      lab[j] = k; dist[j] = d + 1; agregado[j] = 1; orig[j] = hueco[j] ? o : -1; ent[j] = e; cola[b++] = j;
    }
  }
  if (alrededor && veto) rellenarAlrededorDeObjetos(data, w, h, lab, agregado, veto, alrededor === true ? {} : alrededor);
  if (encerrados) rellenarEncerrados(data, w, h, lab, agregado, veto, encerrados === true ? {} : encerrados);
  return found.map((f, k) => {
    const m = f.mask.slice(); let n = 0;
    for (let i = 0; i < N; i++) { if (agregado[i] && lab[i] === k + 1) m[i] = 1; if (m[i]) n++; }
    return { ...f, mask: m, area: n / N };
  });
}
