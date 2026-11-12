// Zócalo de fachada (o friso de un interior) como superficie PROPIA: la franja de abajo pintada de otro color (zócalo rojo, verde,
// gris...) no se pinta junto con la pared. Queda en la lista como "Zócalo" (kind 'zocalo') y el cliente la pinta solo si la elige.
// Pedido de Ginés 2026-11-11 ("¿por qué pintás el zócalo?").
import { rgbToLab } from './color.js';

const bbox = (mask, w, h) => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const x = i % w, y = (i - x) / w; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return n ? { x0, y0, x1, y1, n } : null;
};

/** Sumas acumuladas por fila del color Lab de una superficie (muestreando de a 2 píxeles): cualquier rango de filas sale en O(1). */
function prefijosLab(mask, data, w, y0, y1) {
  const n = y1 - y0 + 2, P = { L: new Float64Array(n), a: new Float64Array(n), b: new Float64Array(n), c: new Float64Array(n), y0 };
  for (let y = y0; y <= y1; y++) {
    let L = 0, a = 0, b = 0, c = 0;
    if ((y - y0) % 2 === 0) for (let x = 0; x < w; x += 2) {
      const i = y * w + x; if (!mask[i]) continue;
      const q = rgbToLab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]); L += q.L; a += q.a; b += q.b; c++;
    }
    const k = y - y0 + 1; P.L[k] = P.L[k - 1] + L; P.a[k] = P.a[k - 1] + a; P.b[k] = P.b[k - 1] + b; P.c[k] = P.c[k - 1] + c;
  }
  return P;
}
/** Color medio de las filas [ya, yb). */
function labFilas(P, ya, yb) {
  const i = Math.max(0, ya - P.y0), j = Math.min(P.c.length - 1, yb - P.y0), n = P.c[j] - P.c[i];
  return n > 0 ? { L: (P.L[j] - P.L[i]) / n, a: (P.a[j] - P.a[i]) / n, b: (P.b[j] - P.b[i]) / n, n } : null;
}
const dE = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);

/**
 * found: superficies [{ name, kind, area, mask }] · img: { data RGBA, width, height }.
 * 1) Una PARED que es una franja ancha y baja al pie de las demás paredes (otra pared justo arriba) pasa a ser "Zócalo".
 * 2) Una pared cuya parte de abajo es de otro color con un corte neto (zócalo rojo bajo pared crema) se parte en pared + "Zócalo".
 * Corte: el que más separa el color de arriba y de abajo; vale si ΔE >= 20, el zócalo mide 8-45 % del alto de la pared y el cambio
 * es brusco (en 2 % del alto ya está el 60 % de la diferencia): una sombra que se va oscureciendo hacia el piso no cuenta.
 */
export function marcarZocalos(found, img, { minDE = 20, minAlto = 0.08, maxAlto = 0.45 } = {}) {
  const { data, width: w, height: h } = img, N = w * h;
  const paredes = found.filter((f) => f.kind === 'pared');
  if (!paredes.length) return found;
  let out = [];
  // 2) partir paredes con un zócalo de otro color
  for (const f of found) {
    if (f.kind !== 'pared') { out.push(f); continue; }
    const bb = bbox(f.mask, w, h); if (!bb) continue;
    const H = bb.y1 - bb.y0 + 1, W = bb.x1 - bb.x0 + 1;
    let mejor = null, P = null;
    if (bb.y1 > 0.5 * h && W > 0.15 * w) {
      P = prefijosLab(f.mask, data, w, bb.y0, bb.y1);
      const paso = Math.max(1, Math.round(H / 60));
      for (let yc = bb.y1 - Math.round(minAlto * H); yc >= bb.y1 - Math.round(maxAlto * H); yc -= paso) {
        const arriba = labFilas(P, bb.y0, yc), abajo = labFilas(P, yc, bb.y1 + 1);
        if (!arriba || !abajo || abajo.n < 50) continue;
        const d = dE(arriba, abajo); if (!mejor || d > mejor.d) mejor = { d, yc, arriba, abajo };
      }
    }
    if (mejor && mejor.d >= minDE) {
      const m = Math.max(2, Math.round(0.02 * H));
      const sup = labFilas(P, Math.max(bb.y0, mejor.yc - 3 * m), mejor.yc - m), inf = labFilas(P, mejor.yc + m, Math.min(bb.y1 + 1, mejor.yc + 3 * m));
      // continuidad: en un zócalo la pared llega pegada a la pintura de abajo; si entre las dos hay un objeto (la tabla de un caballete,
      // p…180754: la pared en sombra debajo de la mesa NO es un zócalo) la máscara se corta en la línea del corte
      let cols = 0, cont = 0;
      for (let x = bb.x0; x <= bb.x1; x += 2) {
        if (!f.mask[Math.max(0, mejor.yc - 3 * m) * w + x] || !f.mask[Math.min(h - 1, mejor.yc + 3 * m) * w + x]) continue;
        cols++; let ok = true; for (let y = mejor.yc - 3 * m; y <= mejor.yc + 3 * m; y++) if (!f.mask[y * w + x]) { ok = false; break; }
        if (ok) cont++;
      }
      if (sup && inf && dE(sup, inf) >= 0.6 * mejor.d && cols && cont >= 0.5 * cols) { // corte neto y pared continua sobre el zócalo
        const pared = new Uint8Array(N), zoc = new Uint8Array(N); let np = 0, nz = 0;
        for (let i = 0; i < N; i++) if (f.mask[i]) {
          const y = (i / w) | 0;
          if (y < mejor.yc - m) { pared[i] = 1; np++; continue; }
          if (y >= mejor.yc + m) { zoc[i] = 1; nz++; continue; }
          const q = rgbToLab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]); // cerca del corte: por color
          if (dE(q, mejor.abajo) < dE(q, mejor.arriba)) { zoc[i] = 1; nz++; } else { pared[i] = 1; np++; }
        }
        if (np) out.push({ ...f, mask: pared, area: np / N });
        if (nz) out.push({ name: 'Zócalo', kind: 'zocalo', area: nz / N, mask: zoc });
        continue;
      }
    }
    out.push(f);
  }
  // 1) paredes que ya vinieron separadas y son una franja baja al pie de otra pared
  const todas = out.filter((f) => f.kind === 'pared' || f.kind === 'zocalo');
  const U = bbox((() => { const m = new Uint8Array(N); for (const f of todas) for (let i = 0; i < N; i++) if (f.mask[i]) m[i] = 1; return m; })(), w, h);
  out = out.map((f) => {
    if (f.kind !== 'pared' || !U) return f;
    const bb = bbox(f.mask, w, h); if (!bb) return f;
    const H = bb.y1 - bb.y0 + 1, W = bb.x1 - bb.x0 + 1, UH = U.y1 - U.y0 + 1;
    if (bb.y1 < U.y1 - 0.06 * UH || H > 0.45 * UH || W < 2.5 * H || bb.y1 < 0.5 * h) return f;
    // ¿hay otra pared justo arriba en buena parte de su ancho?
    const otra = new Uint8Array(N); for (const g of out) if (g !== f && g.kind === 'pared') for (let i = 0; i < N; i++) if (g.mask[i]) otra[i] = 1;
    let col = 0, con = 0; const dy = Math.max(2, Math.round(0.05 * h));
    for (let x = bb.x0; x <= bb.x1; x += 3) {
      let top = -1; for (let y = bb.y0; y <= bb.y1; y++) if (f.mask[y * w + x]) { top = y; break; }
      if (top < 0) continue; col++;
      for (let y = top - 1; y >= Math.max(0, top - dy); y--) if (otra[y * w + x]) { con++; break; }
    }
    return col && con / col >= 0.4 ? { ...f, name: "Zócalo", kind: "zocalo" } : f;
  });
  // nombres: Pared 1..n de nuevo (de mayor a menor) y "Zócalo"/"Zócalo 2"
  let kp = 0, kz = 0; const nz = out.filter((f) => f.kind === 'zocalo').length;
  return out.sort((a, b) => (a.kind === 'techo') - (b.kind === 'techo') || b.area - a.area)
    .map((f) => f.kind === 'pared' ? { ...f, name: `Pared ${++kp}` } : f.kind === 'zocalo' ? { ...f, name: nz > 1 ? `Zócalo ${++kz}` : 'Zócalo' } : f);
}
