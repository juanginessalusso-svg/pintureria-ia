// Métrica de bordes contra un render de referencia (Sinteplast, caja negra), robusta al artefacto de "tono alterado".
//
// Problema de la métrica vieja (IoU contra "píxeles cambiados"): la app de Sinteplast también cambia el tono de cosas que NO pintó
// (el interior de una puerta, el techo, un mueble). Esas zonas cuentan como "cambiado por ellos y no por nosotros" y bajan el IoU
// aunque nuestro borde sea perfecto. Además el umbral de suma de canales (>60) no ve los colores claros sobre pared blanca.
//
// Solución en dos partes:
//  (1) "Qué pintó ellos" NO se define contra el original: se define por el COLOR RENDERIZADO. Por superficie se toma la mediana Lab del render
//      de ellos bien adentro de nuestra máscara (a > band px del contorno) y se marca como "suya" todo píxel del render cuyo (a,b) está a
//      ≤ `tolAB` y cuya L está a ≤ `tolL` de esa mediana (`renderedSurfaceMask`). Un mueble o una puerta cuyo tono ellos alteraron no tienen
//      ese color, así que no entran; y si la pared original ya era casi del color elegido igual se detecta (el ΔE contra el original no se usa).
//  (2) Solo se evalúa en una franja alrededor del contorno nuestro. Esta métrica mira SOLO una franja de `band` px (12 por defecto, en px de la imagen de trabajo) alrededor del contorno NUESTRO:
//   - bandIoU     : IoU(pintado nuestro, cambiado por ellos) dentro de la franja del contorno nuestro. Una zona cambiada por ellos lejos de
//                   nuestro contorno (puerta, techo, tono global) queda fuera por construcción.
//   - bandIoUUnion: igual pero con la franja del contorno nuestro Y del de ellos (más estricta; la contaminación puede entrar si toca el borde).
//   - dOurs/in3   : distancia media (acotada a `band`) de cada píxel de NUESTRO contorno al contorno más cercano de ellos, y % a ≤3 px.
//                   Como la distancia es al contorno MÁS CERCANO y está acotada, un contorno ajeno lejano no puede empeorarla.
//   - dTheirs     : lo mismo en el otro sentido, pero solo para contornos de ellos que están dentro de la franja (los lejanos son artefacto o
//                   superficies que no pintamos y se reportan aparte en `farChanged`).
// Se ignoran (no cuentan como acierto ni error) los píxeles de OTRAS superficies que detectamos pero no pintamos (p. ej. el techo cuando el
// par solo repinta la pared): ahí ellos pueden haber cambiado el tono sin que sea un error nuestro.
// Diagnóstico del artefacto: `farChanged` = % de píxeles a más de `band` de cualquier superficie nuestra que ellos cambiaron (contaminación
// pura, no depende de nuestras máscaras salvo por la distancia) y `farDE` = ΔE76 medio contra el original en esa zona.
import { distanceTransform, boxBlur, rgbToLab } from '@pintureria/core';

const lab = (d, i) => rgbToLab([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);

/** Mapa de ΔE76 entre dos imágenes RGBA del mismo tamaño (por píxel). */
export function deltaEMap(a, b, N) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = lab(a, i), q = lab(b, i);
    out[i] = Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
  }
  return out;
}

/** Mediana (por canal) de Lab del render `theirs` en los píxeles con máscara=1. */
export function medianLab(data, mask) {
  const L = [], A = [], B = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const q = lab(data, i); L.push(q.L); A.push(q.a); B.push(q.b); }
  if (!L.length) return null;
  const med = (v) => { v.sort((x, y) => x - y); return v[v.length >> 1]; };
  return { L: med(L), a: med(A), b: med(B) };
}

/**
 * "Lo que ellos pintaron" para UNA superficie, definido por el color del render (no por diferencia con el original).
 * ours: nuestra máscara de esa superficie (solo se usa su interior profundo para estimar el color).
 */
export function renderedSurfaceMask(theirs, ours, width, height, { band = 12, tolAB = 8, tolL = 25 } = {}) {
  const N = width * height, dIn = distanceTransform(ours, width, height);
  let deep = new Uint8Array(N), nDeep = 0;
  for (const thr of [band, band / 3, 2]) { nDeep = 0; for (let i = 0; i < N; i++) { deep[i] = dIn[i] > thr ? 1 : 0; nDeep += deep[i]; } if (nDeep >= 50) break; }
  const med = medianLab(theirs, deep);
  const raw = new Uint8Array(N);
  if (!med) return raw;
  for (let i = 0; i < N; i++) { const q = lab(theirs, i); raw[i] = Math.hypot(q.a - med.a, q.b - med.b) <= tolAB && Math.abs(q.L - med.L) <= tolL ? 1 : 0; }
  return majority5(raw, width, height);
}

function majority5(raw, width, height) { // voto de mayoría en ventana 5x5 (caja con borde replicado)
  const b = boxBlur(Float32Array.from(raw), width, height, 2), out = new Uint8Array(raw.length);
  for (let i = 0; i < out.length; i++) out[i] = b[i] > 0.5 ? 1 : 0;
  return out;
}

/** Máscara "cambiado": ΔE76 > tau, con voto de mayoría 5x5 para sacar el ruido de recompresión JPEG. */
export function changedMask(dE, width, height, tau = 12) {
  const raw = new Uint8Array(width * height);
  for (let i = 0; i < raw.length; i++) raw[i] = dE[i] > tau ? 1 : 0;
  return majority5(raw, width, height);
}

/** Contorno: píxeles de la máscara con algún vecino 4 fuera de ella (el borde de la imagen no cuenta como contorno). */
export function contour(mask, width, height) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (!mask[i]) continue;
    if ((x > 0 && !mask[i - 1]) || (x < width - 1 && !mask[i + 1]) || (y > 0 && !mask[i - width]) || (y < height - 1 && !mask[i + width])) out[i] = 1;
  }
  return out;
}

/** Distancia (px) de cada píxel al píxel marcado más cercano (0 en los marcados; Infinity si no hay ninguno). */
export function distTo(marks, width, height) {
  let any = false; for (let i = 0; i < marks.length; i++) if (marks[i]) { any = true; break; }
  if (!any) return new Float32Array(marks.length).fill(Infinity);
  const free = new Uint8Array(marks.length);
  for (let i = 0; i < marks.length; i++) free[i] = marks[i] ? 0 : 1;
  return distanceTransform(free, width, height);
}

/**
 * ours/theirs: máscaras 0/1. ignore: máscara 0/1 de píxeles que no se evalúan (otras superficies detectadas no pintadas). allOurs: unión de TODAS
 * nuestras superficies detectadas (para el diagnóstico lejano). dE: mapa ΔE76 render-vs-original.
 */
export function edgeMetrics({ ours, theirs, ignore = null, allOurs = null, dE = null, width, height, band = 12 }) {
  const N = width * height, cO = contour(ours, width, height), cT = contour(theirs, width, height);
  const dO = distTo(cO, width, height), dT = distTo(cT, width, height);
  let i1 = 0, u1 = 0, i2 = 0, u2 = 0, bandPx = 0;
  for (let i = 0; i < N; i++) {
    if (ignore && ignore[i]) continue;
    const inO = dO[i] <= band, inT = dT[i] <= band;
    if (inO) { bandPx++; if (ours[i] && theirs[i]) i1++; if (ours[i] || theirs[i]) u1++; }
    if (inO || inT) { if (ours[i] && theirs[i]) i2++; if (ours[i] || theirs[i]) u2++; }
  }
  let sum = 0, n = 0, in3 = 0, sumT = 0, nT = 0, in3T = 0;
  for (let i = 0; i < N; i++) {
    if (ignore && ignore[i]) continue;
    if (cO[i]) { const d = Math.min(band, dT[i]); sum += d; n++; if (dT[i] <= 3) in3++; }
    if (cT[i] && dO[i] <= band) { const d = Math.min(band, dO[i]); sumT += d; nT++; if (dO[i] <= 3) in3T++; }
  }
  const r = { counts: { i1, u1, i2, u2, sum, n, in3, sumT, nT, in3T }, bandIoU: u1 ? i1 / u1 : NaN, bandIoUUnion: u2 ? i2 / u2 : NaN, bandPx, dOurs: n ? sum / n : NaN, in3: n ? in3 / n : NaN, dTheirs: nT ? sumT / nT : NaN, in3T: nT ? in3T / nT : NaN };
  if (allOurs && dE) {
    const dA = distTo(contour(allOurs, width, height), width, height);
    let far = 0, farCh = 0, farDE = 0;
    for (let i = 0; i < N; i++) { if (allOurs[i] || dA[i] <= band) continue; far++; if (theirs[i]) farCh++; farDE += dE[i]; }
    r.farChanged = far ? farCh / far : NaN; r.farDE = far ? farDE / far : NaN;
  }
  return r;
}

/** IoU global clásico (la métrica vieja, para comparar). */
export function globalIoU(ours, theirs) {
  let i1 = 0, u1 = 0;
  for (let i = 0; i < ours.length; i++) { if (ours[i] && theirs[i]) i1++; if (ours[i] || theirs[i]) u1++; }
  return u1 ? i1 / u1 : NaN;
}

/** Suma los conteos de varias superficies (o fotos) y devuelve las métricas ponderadas por píxeles de franja/contorno. */
export function aggregate(list) {
  const t = { i1: 0, u1: 0, i2: 0, u2: 0, sum: 0, n: 0, in3: 0, sumT: 0, nT: 0, in3T: 0 };
  for (const m of list) for (const k of Object.keys(t)) t[k] += m.counts[k];
  return { bandIoU: t.u1 ? t.i1 / t.u1 : NaN, bandIoUUnion: t.u2 ? t.i2 / t.u2 : NaN, dOurs: t.n ? t.sum / t.n : NaN, in3: t.n ? t.in3 / t.n : NaN, dTheirs: t.nT ? t.sumT / t.nT : NaN, in3T: t.nT ? t.in3T / t.nT : NaN, counts: t };
}
