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
