// Techo o pared de OSB (aglomerado de virutas): regla de Ginés, el OSB NO se pinta. SAM 3 lo llama "ceiling" igual que un techo liso.
// Se reconoce por textura fina fuerte (|media 3x3 - media 9x9| relativa a la luz) Y color saturado (marrón anaranjado de la madera).
// Medido en el set de regresión 2026-11-12 (textura % / saturación): OSB 2,6-4,0 / 0,36-0,53; machimbre 1,8-2,1 / 0,15-0,35;
// revoque grueso 5,1 / 0,29-0,44 (con luz cálida); papel tapiz 2,1 / 0,38; techos y paredes lisas <= 1,1.
// Lo que separa al revoque: sus granos son finos. Relación textura 9-25 px / 3-9 px: OSB 0,60-0,77 (virutas grandes), revoque 0,36-0,43,
// machimbre ~1,4 (tablas largas).
// La superficie queda como 'ladrillo' (rugosa, sin color: el cliente la pinta solo si la toca), con nombre "Madera (OSB)".

/** Suma por ventana cuadrada (radio r) con imagen integral. */
function mediaCaja(L, w, h, r) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let fila = 0; for (let x = 0; x < w; x++) { fila += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + fila; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    out[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return out;
}

export function marcarOSB(found, img, { minTex = 2.4, minSat = 0.36, minGrande = 1.9, relMin = 0.5, relMax = 1.1, minArea = 0.03 } = {}) {
  const { data, width: w, height: h } = img, N = w * h;
  if (!found.some((f) => (f.kind === 'techo' || f.kind === 'pared') && f.area >= minArea)) return found;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  const m3 = mediaCaja(L, w, h, 1), m9 = mediaCaja(L, w, h, 4), m25 = mediaCaja(L, w, h, 12);
  const info = [];
  const out = found.map((f) => {
    if ((f.kind !== 'techo' && f.kind !== 'pared') || f.area < minArea) return f;
    let st = 0, sg = 0, sl = 0, ss = 0, n = 0;
    for (let i = 0; i < N; i += 3) {
      if (!f.mask[i]) continue;
      const x = i % w, y = (i - x) / w; if (x < 5 || y < 5 || x >= w - 5 || y >= h - 5) continue;
      // lejos del borde de la superficie (el contorno no es textura)
      if (!f.mask[i - 4] || !f.mask[i + 4] || !f.mask[i - 4 * w] || !f.mask[i + 4 * w]) continue;
      const q = i * 4, mx = Math.max(data[q], data[q + 1], data[q + 2]), mn = Math.min(data[q], data[q + 1], data[q + 2]);
      st += Math.abs(m3[i] - m9[i]); sg += Math.abs(m9[i] - m25[i]); sl += L[i]; ss += (mx - mn) / (mx + 1); n++;
    }
    if (n < 500) return f;
    const tex = (100 * st) / Math.max(1, sl), grande = (100 * sg) / Math.max(1, sl), rel = grande / Math.max(1e-6, tex), sat = ss / n;
    info.push({ name: f.name, tex: +tex.toFixed(2), grande: +grande.toFixed(2), rel: +rel.toFixed(2), sat: +sat.toFixed(3) });
    return tex >= minTex && sat >= minSat && grande >= minGrande && rel >= relMin && rel <= relMax ? { ...f, kind: 'ladrillo', name: 'Madera (OSB)' } : f;
  });
  if (globalThis.process?.env?.DEBUG_RECTAS) for (const r of info) console.error('osb', JSON.stringify(r));
  return out;
}

/**
 * Machimbre / madera que el servidor reconoce con SAM 3 ("wood paneling", "wooden ceiling"): llega en el veto con valor 3 (B = 100 en el
 * PNG). Regla de Ginés (2026-11-12): el machimbre no se pinta, igual que el OSB. La parte de madera de cada pared o techo se separa como
 * superficie 'ladrillo' (sin color: el cliente la pinta solo si la toca) llamada "Madera"; si casi toda la superficie es madera, pasa entera.
 */
export function separarMadera(found, veto, w, h, opts = {}) { return separarPorCodigo(found, veto, w, h, 3, 'Madera', opts); }

/** Pared que se ve por una puerta abierta (código 4 = B 50 del servidor, regla 11): queda como "Pared del fondo" sin color (regla de Ginés:
 * el cliente quiere pintar la habitación donde está, no la de al lado). La toca si la quiere pintar. */
export function separarFondo(found, veto, w, h, opts = {}) { return separarPorCodigo(found, veto, w, h, 4, 'Pared del fondo', { minFrac: 0.0005, ...opts }); }

function separarPorCodigo(found, veto, w, h, cod, nombre, { entera = 0.6, minFrac = 0.005 } = {}) {
  if (!veto) return found;
  const N = w * h; let hay = false;
  for (let i = 0; i < N; i++) if (veto[i] === cod) { hay = true; break; }
  if (!hay) return found;
  const out = [];
  for (const f of found) {
    if (f.kind !== 'pared' && f.kind !== 'techo') { out.push(f); continue; }
    let n = 0, nm = 0; for (let i = 0; i < N; i++) if (f.mask[i]) { n++; if (veto[i] === cod) nm++; }
    if (!nm || nm < minFrac * N && nm < entera * n) { out.push(f); continue; }
    if (nm >= entera * n) { out.push({ ...f, kind: 'ladrillo', name: nombre }); continue; }
    const resto = f.mask.slice(), mad = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (f.mask[i] && veto[i] === cod) { resto[i] = 0; mad[i] = 1; }
    out.push({ ...f, mask: resto, area: (n - nm) / N });
    out.push({ ...f, kind: 'ladrillo', name: nombre, mask: mad, area: nm / N });
  }
  const nMad = out.filter((f) => f.name === nombre).length; let k = 0;
  return nMad > 1 ? out.map((f) => (f.name === nombre ? { ...f, name: `${nombre} ${++k}` } : f)) : out;
}
