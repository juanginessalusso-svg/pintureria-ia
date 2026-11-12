// Uniones entre dos superficies pintadas (pared-pared, pared-techo). Prueba de Ginés 2026-11-11 (puerta con columna en la esquina):
// 1) afinarLimites: el límite entre dos muros salía dentado (donde se encontraban los rellenos), no sobre la arista real.
// 2) featherCapas: al suavizar cada superficie por separado, en la unión ninguna llegaba a 1 y quedaba una línea del color original.
import { featherMask } from './recolor.js';

/**
 * Corre el límite entre superficies vecinas a la arista de la foto: en una banda alrededor de cada límite se olvida el dueño y se
 * vuelve a repartir con un "watershed" (bosque de mínima expansión): cada superficie crece desde fuera de la banda pasando primero por
 * donde el color cambia menos, así se encuentran en el cambio de color más fuerte (la arista de la esquina). No cambia lo pintado en
 * total, solo a quién pertenece cada píxel. found: [{ kind, mask, area }] · img: { data RGBA, width, height }.
 */
export function afinarLimites(found, img, { banda = null, kinds = ['pared', 'techo'] } = {}) {
  const { data, width: w, height: h } = img, N = w * h;
  const idx = found.map((f, k) => (kinds.includes(f.kind) ? k : -1)).filter((k) => k >= 0);
  if (idx.length < 2) return found;
  const B = banda ?? Math.max(3, Math.round(0.015 * Math.max(w, h)));
  const lab = new Int16Array(N); // dueño: 1..n (posición en idx), 0 = ninguno
  idx.forEach((k, j) => { const m = found[k].mask; for (let i = 0; i < N; i++) if (m[i] && !lab[i]) lab[i] = j + 1; });
  // banda: hasta B pasos desde un píxel que toca a otro dueño
  const dist = new Int16Array(N).fill(-1), cola = new Int32Array(N); let a = 0, b = 0;
  for (let i = 0; i < N; i++) {
    const o = lab[i]; if (!o) continue; const x = i % w;
    if ((x > 0 && lab[i - 1] && lab[i - 1] !== o) || (x < w - 1 && lab[i + 1] && lab[i + 1] !== o) || (i >= w && lab[i - w] && lab[i - w] !== o) || (i + w < N && lab[i + w] && lab[i + w] !== o)) { dist[i] = 0; cola[b++] = i; }
  }
  if (!b) return found;
  while (a < b) {
    const i = cola[a++]; if (dist[i] >= B) continue; const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < N && lab[j] && dist[j] < 0) { dist[j] = dist[i] + 1; cola[b++] = j; }
  }
  // color suavizado (3x3) solo donde hace falta: banda y su borde
  const col = new Float32Array(N * 3).fill(-1);
  const color = (i) => {
    if (col[i * 3] < 0) {
      const x = i % w, y = (i - x) / w; let r = 0, g = 0, bb = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = (yy * w + xx) * 4; r += data[q]; g += data[q + 1]; bb += data[q + 2]; n++;
      }
      col[i * 3] = r / n; col[i * 3 + 1] = g / n; col[i * 3 + 2] = bb / n;
    }
    return i * 3;
  };
  const dif = (i, j) => { const p = color(i), q = color(j); return Math.min(255, Math.round(Math.abs(col[p] - col[q]) + Math.abs(col[p + 1] - col[q + 1]) + Math.abs(col[p + 2] - col[q + 2]))); };
  const nuevo = new Int16Array(lab);
  for (let i = 0; i < N; i++) if (dist[i] >= 0) nuevo[i] = 0;
  // cola por cubetas (costo 0..255): semillas = píxeles con dueño pegados a la banda
  const cub = Array.from({ length: 256 }, () => []);
  const vecinos = (i) => { const x = i % w; return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]; };
  for (let i = 0; i < N; i++) if (dist[i] >= 0) for (const j of vecinos(i)) if (j >= 0 && j < N && nuevo[j]) cub[dif(i, j)].push(i, nuevo[j]);
  for (let c = 0; c < 256; c++) {
    const q = cub[c];
    for (let t = 0; t < q.length; t += 2) {
      const i = q[t], o = q[t + 1]; if (nuevo[i]) continue;
      nuevo[i] = o;
      for (const j of vecinos(i)) if (j >= 0 && j < N && dist[j] >= 0 && !nuevo[j]) { const d = dif(i, j); (d <= c ? q : cub[d]).push(j, o); }
    }
  }
  for (let i = 0; i < N; i++) if (dist[i] >= 0 && !nuevo[i]) nuevo[i] = lab[i]; // por las dudas: nada queda sin dueño
  const out = found.slice();
  idx.forEach((k, j) => { const m = new Uint8Array(N); let n = 0; for (let i = 0; i < N; i++) if (nuevo[i] === j + 1) { m[i] = 1; n++; } out[k] = { ...found[k], mask: m, area: n / N }; });
  return out.filter((f) => f.area > 0);
}

/**
 * Suaviza el borde de varias capas que se pintan una encima de otra sin dejar línea en la unión: cada capa se estira `radius` px sobre
 * las capas vecinas antes de suavizar (así llega a 1 en su propio borde) y después se recorta donde manda la vecina. El suavizado queda
 * solo contra lo que NO se pinta (puerta, mueble, piso); en la unión entre dos capas los pesos se reparten (antialias). masks: [Uint8Array].
 * Devuelve [Float32Array] de pesos finales: usar con pintarCapas().
 */
export function featherCapas(masks, width, height, radius = 2) {
  const N = width * height, todas = new Uint8Array(N);
  for (const m of masks) for (let i = 0; i < N; i++) if (m[i]) todas[i]++;
  const softs = masks.map((m) => {
    if (radius <= 0) return Float32Array.from(m);
    const cerca = featherMask(Float32Array.from(m), width, height, radius), ext = new Float32Array(N);
    for (let i = 0; i < N; i++) ext[i] = m[i] || (cerca[i] > 0 && todas[i]) ? 1 : 0; // propia + lo de otras capas que está al lado
    const soft = featherMask(ext, width, height, radius);
    for (let i = 0; i < N; i++) if (!m[i] && todas[i]) soft[i] = 0; // donde manda otra capa, esta no se mete
    return soft;
  });
  if (radius <= 0 || masks.length < 2) return softs;
  // Antialias en la UNIÓN de dos capas (pedido de Ginés 2026-11-12: la línea techo/pared se veía escalonada con zoom): cada píxel de la
  // unión reparte su peso entre las capas según cuánto de cada una tiene alrededor (b_k = máscara suavizada, normalizada a suma 1: no
  // queda línea sin pintar). Los pesos son FINALES: pintar con pintarCapas() (cada color desde la foto original), no capa sobre capa.
  const b = masks.map((m) => featherMask(Float32Array.from(m), width, height, radius));
  for (let i = 0; i < N; i++) {
    if (!todas[i]) continue;
    let n = 0, t = 0; for (let k = 0; k < masks.length; k++) if (b[k][i] > 0.001) { n++; t += b[k][i]; }
    if (n < 2) continue;
    for (let k = 0; k < masks.length; k++) softs[k][i] = b[k][i] / t;
  }
  return softs;
}
