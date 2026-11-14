// Planos como los muestra Sinteplast (comparación con capturas de Ginés, 2026-11-15):
//  - pintarTapas: la tapa plana de la pared (ciega, del mismo color que la pared) se pinta con la pared, como pasa en una obra real.
//    Llaves de luz, enchufes, portero y tablero siguen sin pintarse: tienen relieve o partes oscuras (textura) o son de otro color.
//  - unirCarasChicas: una cara chica de pared (costado de una columna, una tira angosta) se suma a la pared vecina con la que comparte
//    más borde: el cliente ve los planos grandes (izquierda / central / derecha), no una "Pared 3" de dos dedos.
import { componentes } from './semantico.js';

/** Píxeles a <= r px (Chebyshev) de la componente, dentro de su caja agrandada. Devuelve índices de la imagen (sin la componente). */
function anillo(c, w, h, r) {
  const [x0, y0, x1, y1] = c.bbox, X0 = Math.max(0, x0 - r), Y0 = Math.max(0, y0 - r), X1 = Math.min(w - 1, x1 + r), Y1 = Math.min(h - 1, y1 + r);
  const bw = X1 - X0 + 1, bh = Y1 - Y0 + 1, en = new Uint8Array(bw * bh), fila = new Uint8Array(bw * bh), out = [];
  for (const i of c.pixels) { const x = i % w, y = (i - x) / w; en[(y - Y0) * bw + (x - X0)] = 1; }
  for (let y = 0; y < bh; y++) {
    let u = -1e9; for (let x = 0; x < bw; x++) { if (en[y * bw + x]) u = x; if (x - u <= r) fila[y * bw + x] = 1; }
    u = 1e9; for (let x = bw - 1; x >= 0; x--) { if (en[y * bw + x]) u = x; if (u - x <= r) fila[y * bw + x] = 1; }
  }
  for (let x = 0; x < bw; x++) {
    let u = -1e9; const dil = new Uint8Array(bh);
    for (let y = 0; y < bh; y++) { if (fila[y * bw + x]) u = y; if (y - u <= r) dil[y] = 1; }
    u = 1e9; for (let y = bh - 1; y >= 0; y--) { if (fila[y * bw + x]) u = y; if (u - y <= r) dil[y] = 1; }
    for (let y = 0; y < bh; y++) if (dil[y] && !en[y * bw + x]) out.push((y + Y0) * w + (x + X0));
  }
  return out;
}

/**
 * found: superficies; img: { data, width, height }; veto: códigos del servidor (2 = objeto conocido). Devuelve superficies nuevas.
 * Una zona de objeto se pinta con la pared si: es chica (<= maxFrac de la foto), está rodeada por UNA pared (>= dominio del anillo),
 * tiene el color de esa pared (luz y cromaticidad) y es lisa (sin relieve: la textura interior no supera texMax veces la de la pared).
 */
export function pintarTapas(found, img, veto, { maxFrac = 0.006, minPx = 40, r = 6, dominio = 0.85, luzMin = 0.88, luzMax = 1.15, tolCroma = 0.025, texMax = 2.5, aspMax = 1.6, rayaMin = 16, rayasMax = 0.08, debug = null } = {}) {
  if (!veto) return found;
  const { data, width: w, height: h } = img, N = w * h;
  const lab = new Int16Array(N); found.forEach((f, k) => { for (let i = 0; i < N; i++) if (f.mask[i] && !lab[i]) lab[i] = k + 1; });
  const obj = new Uint8Array(N); let hay = false;
  for (let i = 0; i < N; i++) if (veto[i] === 2 && !lab[i]) { obj[i] = 1; hay = true; }
  if (!hay) return found;
  const L = (i) => (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  const cr = (i) => data[i * 4] / (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] + 1), cg = (i) => data[i * 4 + 1] / (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] + 1);
  const stats = (px) => { let s = 0, s2 = 0, a = 0, b = 0; for (const i of px) { const l = L(i); s += l; s2 += l * l; a += cr(i); b += cg(i); } const n = Math.max(1, px.length), m = s / n; return { L: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)), r: a / n, g: b / n }; };
  const masks = found.map((f) => f.mask);
  let cambios = 0;
  for (const c of componentes(obj, w, h).comps) {
    if (c.area < minPx || c.area > maxFrac * N) continue;
    const ring = anillo(c, w, h, r); if (!ring.length) continue;
    const votos = new Map(); let sinSup = 0;
    for (const i of ring) { const k = lab[i]; if (!k) { sinSup++; continue; } votos.set(k, (votos.get(k) ?? 0) + 1); }
    let mejor = 0, nm = 0; for (const [k, v] of votos) if (v > nm) { mejor = k; nm = v; }
    if (!mejor || found[mejor - 1].kind !== 'pared' || nm < dominio * ring.length) continue;
    const pared = stats(ring.filter((i) => lab[i] === mejor));
    // interior: sin los 2 px del borde (el canto de la tapa siempre tiene sombra)
    const borde = new Set(); for (const i of c.pixels) { const x = i % w; for (const j of [i - 1, i + 1, i - w, i + w, i - 2, i + 2, i - 2 * w, i + 2 * w]) if (j >= 0 && j < N && !obj[j]) { borde.add(i); break; } if (x < 2 || x > w - 3) borde.add(i); }
    const dentro = Array.from(c.pixels).filter((i) => !borde.has(i)); if (dentro.length < minPx / 2) continue;
    const t = stats(dentro), rl = t.L / Math.max(1, pared.L), dc = Math.abs(t.r - pared.r) + Math.abs(t.g - pared.g);
    // la llave de luz / el enchufe son angostos (módulo vertical) y tienen las rayas de las teclas; la tapa ciega es casi cuadrada y lisa
    const [bx0, by0, bx1, by1] = c.bbox, asp = Math.max((bx1 - bx0 + 1) / (by1 - by0 + 1), (by1 - by0 + 1) / (bx1 - bx0 + 1));
    let rayas = 0; for (const i of dentro) { const g = Math.abs(L(i + 1) - L(i - 1)) + Math.abs(L(i + w) - L(i - w)); if (g > rayaMin) rayas++; }
    const fr = rayas / dentro.length;
    const ok = rl >= luzMin && rl <= luzMax && dc <= tolCroma && t.sd <= Math.max(3, texMax * pared.sd) && asp <= aspMax && fr <= rayasMax;
    if (debug) debug({ bbox: c.bbox, area: c.area, luz: +rl.toFixed(3), croma: +dc.toFixed(3), tex: +(t.sd / Math.max(0.5, pared.sd)).toFixed(2), asp: +asp.toFixed(2), rayas: +fr.toFixed(3), ok });
    if (!ok) continue;
    const m = masks[mejor - 1] === found[mejor - 1].mask ? (masks[mejor - 1] = found[mejor - 1].mask.slice()) : masks[mejor - 1];
    for (const i of c.pixels) m[i] = 1;
    cambios++;
  }
  if (!cambios) return found;
  return found.map((f, k) => (masks[k] === f.mask ? f : { ...f, mask: masks[k], area: masks[k].reduce((s, v) => s + v, 0) / N }));
}

/** found: superficies; w, h. Una pared automática chica (< maxFrac) se suma a la pared vecina con la que comparte más borde (>= minBorde px). */
export function unirCarasChicas(found, w, h, { maxFrac = 0.03, minBorde = 20 } = {}) {
  const N = w * h, lab = new Int16Array(N);
  found.forEach((f, k) => { for (let i = 0; i < N; i++) if (f.mask[i] && !lab[i]) lab[i] = k + 1; });
  const auto = (f) => f.kind === 'pared' && /^Pared( \d+)?$/.test(f.name ?? '');
  const quitar = new Set(), masks = found.map((f) => f.mask);
  const orden = found.map((f, k) => k).filter((k) => auto(found[k]) && found[k].area < maxFrac).sort((a, b) => found[a].area - found[b].area);
  for (const k of orden) {
    const borde = new Map(), m = masks[k];
    for (let i = 0; i < N; i++) {
      if (!m[i]) continue;
      for (const j of [i - 1, i + 1, i - w, i + w, i - 2, i + 2, i - 2 * w, i + 2 * w]) {
        if (j < 0 || j >= N) continue; const o = lab[j];
        if (o && o !== k + 1 && !quitar.has(o - 1) && found[o - 1].kind === 'pared' && found[o - 1].area > found[k].area) { borde.set(o, (borde.get(o) ?? 0) + 1); break; }
      }
    }
    let mejor = 0, nb = 0; for (const [o, v] of borde) if (v > nb) { mejor = o; nb = v; }
    if (!mejor || nb < minBorde) continue;
    const d = masks[mejor - 1] === found[mejor - 1].mask ? (masks[mejor - 1] = found[mejor - 1].mask.slice()) : masks[mejor - 1];
    for (let i = 0; i < N; i++) if (m[i]) { d[i] = 1; lab[i] = mejor; }
    quitar.add(k);
  }
  if (!quitar.size) return found;
  return found.flatMap((f, k) => (quitar.has(k) ? [] : [masks[k] === f.mask ? f : { ...f, mask: masks[k], area: masks[k].reduce((s, v) => s + v, 0) / N }]));
}
