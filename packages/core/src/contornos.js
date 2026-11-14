// Ajuste fino de contornos (pedido de Ginés 2026-11-13: "respetar bien los contornos de todos los objetos").
// Medido con eval/regresion/bordes.py: la pintura se pasaba 2-6 px sobre objetos claros (canto del marco de la ventana, jarrón, cortina,
// sábana): el borde del mapa del servidor es suave y a 1280 px queda corrido. Acá, en una franja angosta alrededor del borde entre lo
// que se pinta (pared/techo) y lo que no, cada píxel va con el lado al que más se parece en color, comparando con el color de cada lado
// tomado un poco más adentro (fuera de la franja). Es un clasificador local de dos clases, sin modelo.

/**
 * found: superficies { kind, mask }, img: { data, width, height }. veto (opcional): lo que el servidor marcó (1 regla, 2 objeto):
 * ahí nunca se agrega pared. Devuelve superficies nuevas (las que no son pared/techo no cambian).
 * banda: px a cada lado del borde que se pueden reasignar · lejos: hasta dónde se toma el color de referencia · margen: qué tanto más
 * cerca tiene que estar de un lado para cambiarlo · minDif: si los dos lados son casi del mismo color no se toca (no hay borde que ver).
 */
export function ajustarContornos(found, img, { veto = null, banda = 5, lejos = 12, margen = 0.75, minDif = 18, quitar = true, agregar = true } = {}) {
  const { data, width: w, height: h } = img, N = w * h;
  const pinta = (f) => f.kind === 'pared' || f.kind === 'techo';
  if (!found.some(pinta)) return found;
  const lab = new Int16Array(N); // 0 = no se pinta, k+1 = superficie pintable k
  found.forEach((f, k) => { if (pinta(f)) for (let i = 0; i < N; i++) if (f.mask[i] && !lab[i]) lab[i] = k + 1; });
  const otra = new Uint8Array(N); // ocupado por otra superficie que no se pinta (zócalo, madera, OSB): no se invade
  found.forEach((f) => { if (!pinta(f)) for (let i = 0; i < N; i++) if (f.mask[i]) otra[i] = 1; });
  // distancia (chebyshev, hasta lejos+1) al borde pintable/no pintable, de cada lado
  const d = new Uint8Array(N).fill(255), cola = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = lab[i] > 0;
    if ((x > 0 && (lab[i - 1] > 0) !== a) || (x < w - 1 && (lab[i + 1] > 0) !== a) || (y > 0 && (lab[i - w] > 0) !== a) || (y < h - 1 && (lab[i + w] > 0) !== a)) { d[i] = 0; cola.push(i); }
  }
  for (let q = 0; q < cola.length; q++) {
    const i = cola[q], x = i % w, y = (i - x) / w, nd = d[i] + 1;
    if (nd > lejos + 1) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx; if (d[j] > nd) { d[j] = nd; cola.push(j); }
    }
  }
  const out = found.map((f) => (pinta(f) ? f.mask.slice() : f.mask));
  const R = lejos, paso = 2;
  let cambios = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (d[i] > banda) continue;
    // color de referencia de cada lado: píxeles a distancia banda+1..lejos del borde, en una ventana de radio R
    let sk = 0, kRef = lab[i];
    if (!kRef) { // de qué superficie sería si se agrega: la pintable más presente en la vecindad
      const cnt = new Map();
      for (let dy = -banda - 1; dy <= banda + 1; dy++) for (let dx = -banda - 1; dx <= banda + 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = lab[yy * w + xx]; if (k) cnt.set(k, (cnt.get(k) ?? 0) + 1); }
      for (const [k, c] of cnt) if (c > sk) { sk = c; kRef = k; }
      if (!kRef) continue;
    }
    let pr = 0, pg = 0, pb = 0, pn = 0, or = 0, og = 0, ob = 0, on = 0;
    for (let dy = -R; dy <= R; dy += paso) for (let dx = -R; dx <= R; dx += paso) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx; if (d[j] <= banda || d[j] === 255) continue; const q = j * 4;
      if (lab[j] === kRef) { pr += data[q]; pg += data[q + 1]; pb += data[q + 2]; pn++; }
      else if (!lab[j]) { or += data[q]; og += data[q + 1]; ob += data[q + 2]; on++; }
    }
    if (pn < 4 || on < 4) continue;
    pr /= pn; pg /= pn; pb /= pn; or /= on; og /= on; ob /= on;
    const dif = Math.hypot(pr - or, pg - og, pb - ob); if (dif < minDif) continue;
    const q = i * 4, c0 = data[q], c1 = data[q + 1], c2 = data[q + 2];
    const dp = Math.hypot(c0 - pr, c1 - pg, c2 - pb), dO = Math.hypot(c0 - or, c1 - og, c2 - ob);
    if (lab[i] && quitar && dO < margen * dp) { out[lab[i] - 1][i] = 0; cambios++; }
    else if (!lab[i] && agregar && dp < margen * dO && !otra[i] && !(veto && (veto[i] === 1 || veto[i] === 2))) { out[kRef - 1][i] = 1; cambios++; }
  }
  if (!cambios) return found;
  return found.map((f, k) => {
    if (!pinta(f)) return f;
    let n = 0; for (let i = 0; i < N; i++) n += out[k][i];
    return { ...f, mask: out[k], area: n / N };
  });
}
