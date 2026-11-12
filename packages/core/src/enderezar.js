// Enderezado del borde de una superficie contra lo que NO se pinta (moldura, cornisa, marco, mueble recto).
// Pedido de Ginés 2026-11-12 (c01): "que los bordes entre la moldura y la pared estén más rectos; la pinta desprolija".
// El mapa del servidor llega a 1280 px y agrandado, y SAM 3 corta el borde con ondas y escalones de unos px. Si una parte larga del borde
// de una superficie contra lo sin asignar es casi recta, se ajusta una recta robusta (RANSAC, fitLine de rectas.js), se la corre en
// paralelo hasta donde la FOTO tiene el borde más marcado (±banda px) y se reescribe esa franja: de un lado la superficie, del otro nada.
// No toca píxeles de otras superficies. Lo vetado por el servidor (moldura, zócalo) llega con el borde ondulado de SAM 3: dentro de la
// franja manda la recta (que sigue el borde de la foto), no el veto. rectas.js hace lo mismo entre DOS superficies (techo/pared).
import { fitLine } from './rectas.js';

/** Puntos del borde de la superficie k contra lo sin asignar (incluye lo vetado: la moldura que el servidor saca a propósito). */
function bordeLibre(lab, k, w, h) {
  const pts = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (lab[i] !== k) continue;
    for (const j of [i - 1, i + 1, i - w, i + w]) if (!lab[j]) { pts.push(x, y); break; }
  }
  return pts;
}

/**
 * found: superficies { mask }, img: { data RGBA, width, height }. Devuelve superficies nuevas.
 * minLen: largo mínimo del tramo recto (fracción del lado mayor) · inlier: tolerancia de la recta (fracción) · banda: cuánto se puede
 * mover/reescribir a cada lado (fracción) · hueco: corte máximo dentro del tramo · maxRectas: tramos por superficie.
 */
export function enderezarBordes(found, img, { veto = null, /* ver arriba */ minLen = 0.12, inlier = 0.004, banda = 0.008, hueco = 0.03, maxRectas = 6, minGrad = 6 } = {}) {
  const { data, width: w, height: h } = img, N = w * h, G = Math.max(w, h);
  if (!found.length) return found;
  const lab = new Int32Array(N);
  found.forEach((f, k) => { for (let i = 0; i < N; i++) if (f.mask[i] && !lab[i]) lab[i] = k + 1; });
  const masks = found.map((f) => f.mask.slice());
  // gradiente de luz (Sobel sobre la luz suavizada 3x3) para ubicar el borde real de la foto
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  const gx = new Float32Array(N), gy = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    gx[i] = ((L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - 1] + L[i + w - 1])) / 8;
    gy[i] = ((L[i + w - 1] + 2 * L[i + w] + L[i + w + 1]) - (L[i - w - 1] + 2 * L[i - w] + L[i - w + 1])) / 8;
  }
  const tol = Math.max(2, inlier * G), B = Math.max(3, Math.round(banda * G)), gapMax = hueco * G, largo = minLen * G;
  const info = [];
  found.forEach((f, k0) => {
    const k = k0 + 1, m = masks[k0];
    let pts = bordeLibre(lab, k, w, h);
    for (let r = 0; r < maxRectas && pts.length / 2 >= largo; r++) {
      const ln = fitLine(pts, tol);
      if (!ln) break;
      // tramo continuo más largo de inliers a lo largo de la recta
      const ts = ln.inliers.map((i) => pts[i * 2] * ln.dx + pts[i * 2 + 1] * ln.dy).sort((a, b) => a - b);
      let best = [0, -1], s = 0;
      for (let i = 1; i <= ts.length; i++) if (i === ts.length || ts[i] - ts[i - 1] > gapMax) { if (ts[i - 1] - ts[s] > best[1] - best[0]) best = [ts[s], ts[i - 1]]; s = i; }
      const [t0, t1] = best;
      // sacar de pts los inliers (este tramo ya se trató, o no sirve)
      const usado = new Set(ln.inliers);
      const resto = []; for (let i = 0; i < pts.length / 2; i++) if (!usado.has(i)) resto.push(pts[i * 2], pts[i * 2 + 1]);
      pts = resto;
      if (t1 - t0 < largo) continue;
      // recta pegada y paralela al borde de la foto: es el corte del encuadre, no un borde del ambiente
      const tm = (t0 + t1) / 2, xm = tm * ln.dx + ln.c * ln.nx, ym = tm * ln.dy + ln.c * ln.ny;
      if ((Math.abs(ln.dx) > 0.97 && (ym < 3 * B || ym > h - 1 - 3 * B)) || (Math.abs(ln.dy) > 0.97 && (xm < 3 * B || xm > w - 1 - 3 * B))) continue;
      // densidad: el tramo tiene que estar casi todo cubierto de puntos del borde (no dos pedazos sueltos alineados)
      let nIn = 0; for (const t of ts) if (t >= t0 && t <= t1) nIn++;
      if (nIn < 0.6 * (t1 - t0)) continue;
      // de qué lado está la superficie
      let sd = 0;
      for (let t = t0; t <= t1; t += 2) for (const o of [-2 * B, 2 * B]) {
        const x = Math.round(t * ln.dx + (ln.c + o) * ln.nx), y = Math.round(t * ln.dy + (ln.c + o) * ln.ny);
        if (x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === k) sd += o;
      }
      if (!sd) continue;
      const lado = sd > 0 ? 1 : -1;
      // color de referencia de la superficie: a 2B-4B px de la recta, de su lado
      let rS = 0, rR = 0, rG = 0, rN = 0;
      for (let t = t0; t <= t1; t += 3) for (let o = 2 * B; o <= 4 * B; o += 2) {
        const x = Math.round(t * ln.dx + (ln.c + lado * o) * ln.nx), y = Math.round(t * ln.dy + (ln.c + lado * o) * ln.ny);
        if (x < 0 || y < 0 || x >= w || y >= h || lab[y * w + x] !== k) continue;
        const q = (y * w + x) * 4, sm = data[q] + data[q + 1] + data[q + 2] + 1; rS += sm; rR += data[q] / sm; rG += data[q + 1] / sm; rN++;
      }
      if (!rN) continue;
      rS /= rN; rR /= rN; rG /= rN;
      // solo se agrega lo que tiene el color de la superficie (no una tira de moldura, marco u OSB)
      const pareceSup = (i) => { const q = i * 4, sm = data[q] + data[q + 1] + data[q + 2] + 1, l = sm / rS; return l > 0.8 && l < 1.2 && Math.abs(data[q] / sm - rR) < 0.02 && Math.abs(data[q + 1] / sm - rG) < 0.02; };
      // corrimiento paralelo hasta el borde más marcado de la foto (gradiente a lo largo de la normal, promedio en todo el tramo)
      const gradEn = (o) => { let g = 0, n = 0; for (let t = t0; t <= t1; t += 1) { const x = Math.round(t * ln.dx + (ln.c + o) * ln.nx), y = Math.round(t * ln.dy + (ln.c + o) * ln.ny); if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue; const i = y * w + x; g += Math.abs(gx[i] * ln.nx + gy[i] * ln.ny); n++; } return n ? g / n : 0; };
      // el borde marcado MÁS CERCANO (>= 70 % del más fuerte): el más fuerte suele ser el otro lado de la moldura o del marco
      const gs = []; let gMax = 0;
      for (let o = -B; o <= B; o += 0.5) { const g = gradEn(o); gs.push([o, g]); if (g > gMax) gMax = g; }
      let off = 0;
      if (gMax >= minGrad) { let mejor = Infinity; for (const [o, g] of gs) if (g >= 0.7 * gMax && Math.abs(o) < Math.abs(mejor)) mejor = o; off = mejor; }
      const c = ln.c + off;
      // reescribir la franja |d - c| <= B + 1 dentro del tramo
      let puestos = 0, sacados = 0;
      const esq = [];
      for (const t of [t0, t1]) for (const o of [c - B - 2, c + B + 2]) esq.push([t * ln.dx + o * ln.nx, t * ln.dy + o * ln.ny]);
      const x0 = Math.max(0, Math.floor(Math.min(...esq.map((e) => e[0])))), x1 = Math.min(w - 1, Math.ceil(Math.max(...esq.map((e) => e[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...esq.map((e) => e[1])))), y1 = Math.min(h - 1, Math.ceil(Math.max(...esq.map((e) => e[1]))));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = x * ln.dx + y * ln.dy; if (t < t0 || t > t1) continue;
        const d = x * ln.nx + y * ln.ny - c; if (Math.abs(d) > B + 1) continue;
        const i = y * w + x;
        if ((d * lado) > 0) { if (!lab[i] && !(veto && (veto[i] === 2 || (veto[i] && Math.abs(d) > B))) && pareceSup(i)) { lab[i] = k; m[i] = 1; puestos++; } }
        else if (m[i] && (Math.abs(d) <= 4 || !pareceSup(i))) { m[i] = 0; if (lab[i] === k) lab[i] = 0; sacados++; } // cerca de la recta (ondas de 2-4 px) siempre; más lejos solo lo que no tiene el color de la superficie (si no, deja una tira blanca de pared: p…181544)
      }
      info.push({ sup: k0, largo: Math.round(t1 - t0), corrido: off, grad: +gMax.toFixed(1), puestos, sacados });
    }
  });
  if (globalThis.process?.env?.DEBUG_RECTAS) for (const r of info) console.error('recta', JSON.stringify(r));
  return found.map((f, k) => {
    const m = masks[k]; let n = 0; for (let i = 0; i < N; i++) if (m[i]) n++;
    return { ...f, mask: m, area: n / N };
  });
}

/**
 * Moldura (cornisa) pegada a la unión techo/pared que el servidor dejó DENTRO del techo o de la pared (prueba de Ginés 2026-11-12, c02:
 * "la moldura sale pintada con el techo"; regla de Ginés: las cornisas no se pintan). Se ajusta una recta a la unión techo/pared y se
 * mira el perfil de la luz a lo largo de la normal (promediado sobre todo el tramo), de cada lado: una moldura es una franja de al
 * menos minAncho con textura (>= minLineas puntos con gradiente >= minGrad, media >= minMedia: las ranuras) seguida de superficie calma
 * (gradiente < maxCalma durante `calma`); una esquina lisa da un solo salto en la unión. La franja se saca de la superficie.
 * Medido en c02: ranuras 2-4, techo liso 0. Devuelve superficies nuevas.
 */
export function quitarCornisas(found, img, { minLen = 0.08, inlier = 0.004, ancho = 0.05, minGrad = 2, minLineas = 3, minAncho = 0.008, minMedia = 1.5, maxCalma = 1.2, calma = 0.012, claro = 1.08, maxAncho = 0.035 } = {}) {
  const { data, width: w, height: h } = img, N = w * h, G = Math.max(w, h);
  const techos = found.map((f, k) => (f.kind === 'techo' ? k : -1)).filter((k) => k >= 0);
  const paredes = found.map((f, k) => (f.kind === 'pared' ? k : -1)).filter((k) => k >= 0);
  if (!techos.length || !paredes.length) return found;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  const masks = found.map((f) => f.mask.slice());
  const M = Math.round(ancho * G), C = Math.max(4, Math.round(calma * G)), tol = Math.max(2, inlier * G), info = [];
  const ext = 0.03 * G;
  // pasada: busca molduras con estos umbrales; devuelve cuántas sacó
  const pasada = (minGrad, minMedia, claroMin) => {
  const antes = info.length;
  for (const kt of techos) for (const kp of paredes) {
    // unión: píxeles de techo con pared a <= 3 px
    const T = masks[kt], P = masks[kp], pts = [];
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
      const i = y * w + x; if (!T[i]) continue;
      let cerca = false; for (let d = 1; d <= 3 && !cerca; d++) if (P[i - d] || P[i + d] || P[i - d * w] || P[i + d * w]) cerca = true;
      if (cerca) pts.push(x, y);
    }
    let resto = pts;
    for (let r = 0; r < 3 && resto.length / 2 >= minLen * G; r++) {
      const ln = fitLine(resto, tol);
      if (!ln) break;
      const usado = new Set(ln.inliers), nuevo = [];
      for (let i = 0; i < resto.length / 2; i++) if (!usado.has(i)) nuevo.push(resto[i * 2], resto[i * 2 + 1]);
      const ts = ln.inliers.map((i) => resto[i * 2] * ln.dx + resto[i * 2 + 1] * ln.dy).sort((a, b) => a - b);
      resto = nuevo;
      const t0 = ts[0], t1 = ts[ts.length - 1];
      if (t1 - t0 < minLen * G) continue;
      // lado del techo
      let sd = 0;
      for (let t = t0; t <= t1; t += 4) for (const o of [-M, M]) { const x = Math.round(t * ln.dx + (ln.c + o) * ln.nx), y = Math.round(t * ln.dy + (ln.c + o) * ln.ny); if (x >= 0 && y >= 0 && x < w && y < h && T[y * w + x]) sd += o; }
      const ladoT = sd > 0 ? 1 : -1;
      // perfil de la luz a lo largo de la normal (promedio sobre el tramo), de -M a M
      const perfil = new Float32Array(2 * M + 3);
      for (let o = -M - 1; o <= M + 1; o++) {
        let s = 0, n = 0;
        for (let t = t0; t <= t1; t += 1) { const x = Math.round(t * ln.dx + (ln.c + o) * ln.nx), y = Math.round(t * ln.dy + (ln.c + o) * ln.ny); if (x < 0 || y < 0 || x >= w || y >= h) continue; s += L[y * w + x]; n++; }
        perfil[o + M + 1] = n ? s / n : 0;
      }
      const grad = (o) => Math.abs(perfil[o + 1 + M + 1] - perfil[o - 1 + M + 1]) / 2;
      if (globalThis.process?.env?.DEBUG_RECTAS) console.error('perfil', Math.round(t1 - t0), 'ladoT', ladoT, 'L', Array.from({ length: M }, (_, j) => (ladoT * j)).map((o) => perfil[o + M + 1].toFixed(0)).join(' '));
      for (const lado of [ladoT, -ladoT]) {
        const k = lado === ladoT ? kt : kp;
        // franja con textura (varias ranuras) que arranca en la unión y termina en superficie calma
        let D = 0, marcados = 0, suma = 0;
        for (let o = 3; o < M; o++) { const g = grad(lado * o); if (g >= minGrad) { D = o; marcados++; } }
        if (D < minAncho * G || marcados < minLineas) continue;
        for (let o = 3; o <= D; o++) suma += grad(lado * o);
        if (suma / (D - 2) < minMedia) continue;
        let calmo = true; for (let o = D + 3; o < Math.min(M + 1, D + 3 + C); o++) if (grad(lado * o) >= maxCalma) { calmo = false; break; }
        if (!calmo) continue;
        if (D >= M - 3 || D > maxAncho * G) continue; // llega al límite de búsqueda (o al borde de la foto): sombra, no moldura
        // la moldura es más clara que la superficie que sigue (blanca, agarra luz); una sombra en la esquina no
        let lb = 0, nb = 0, ls = 0, ns = 0;
        for (let o = 3; o <= D; o++) { const v = perfil[lado * o + M + 1]; if (v > 0) { lb += v; nb++; } }
        for (let o = D + 3; o < Math.min(M, D + 3 + C); o++) { const v = perfil[lado * o + M + 1]; if (v > 0) { ls += v; ns++; } } // 0 = fuera de la foto
        if (!nb || ns < C / 2 || lb / nb < claroMin * (ls / ns)) continue;
        const picos = { length: marcados };
        let sacados = 0; const m = masks[k];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x; if (!m[i]) continue;
          const t = x * ln.dx + y * ln.dy; if (t < t0 - ext || t > t1 + ext) continue; // ext: la moldura sigue un poco más allá del tramo medido (hasta el borde de la foto o la esquina)
          const d = (x * ln.nx + y * ln.ny - ln.c) * lado;
          if (d > -2 && d <= D + 1) { m[i] = 0; sacados++; }
        }
        info.push({ sup: k, lado: k === kt ? 'techo' : 'pared', largo: Math.round(t1 - t0), ancho: D, picos: picos.length, sacados });
      }
    }
  }
  return info.length - antes;
  };
  // la moldura da la vuelta a la habitación: si una es clara, en los otros tramos techo/pared de la foto se acepta una más tenue
  // (c04: la de la izquierda da ranuras de 1-2 contra 2-8 de la derecha)
  if (pasada(minGrad, minMedia, claro)) pasada(minGrad * 0.6, minMedia * 0.55, 1 + (claro - 1) * 0.4);
  if (globalThis.process?.env?.DEBUG_RECTAS) for (const r of info) console.error('cornisa', JSON.stringify(r));
  return found.map((f, k) => { const m = masks[k]; let n = 0; for (let i = 0; i < N; i++) if (m[i]) n++; return { ...f, mask: m, area: n / N }; });
}
