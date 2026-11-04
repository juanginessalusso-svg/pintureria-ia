// Métricas para evaluar la detección automática de superficies contra anotaciones hechas por una persona.
// Todo puro: máscaras 0/1 (Uint8Array) del mismo tamaño. Sin DOM ni modelos.

/** Máscara 0/1 -> corridas alternadas [ceros, unos, ceros, unos…] (compacto para guardar en JSON). */
export function encodeMask(mask) {
  const runs = [];
  let cur = 0, n = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0;
    if (v === cur) n++;
    else { runs.push(n); cur = v; n = 1; }
  }
  runs.push(n);
  return runs;
}

/** Inversa de encodeMask. */
export function decodeMask(runs, length) {
  const out = new Uint8Array(length);
  let pos = 0, v = 0;
  for (const n of runs) {
    if (v) out.fill(1, pos, pos + n);
    pos += n; v ^= 1;
  }
  return out;
}

export const countOn = (m) => { let s = 0; for (let i = 0; i < m.length; i++) if (m[i]) s++; return s; };

/** Intersección sobre unión de dos máscaras 0/1. */
export function iou(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ? 1 : 0, y = b[i] ? 1 : 0; inter += x & y; uni += x | y; }
  return uni ? inter / uni : 1;
}

/** Empareja superficies anotadas con detectadas, de a una, de mayor a menor IoU. Devuelve [{t, p, iou}] (índices). */
export function matchSurfaces(truth, pred, minIou = 0.1) {
  const cands = [];
  truth.forEach((t, i) => pred.forEach((p, j) => { const v = iou(t.mask, p.mask); if (v >= minIou) cands.push({ t: i, p: j, iou: v }); }));
  cands.sort((a, b) => b.iou - a.iou);
  const usedT = new Set(), usedP = new Set(), out = [];
  for (const c of cands) {
    if (usedT.has(c.t) || usedP.has(c.p)) continue;
    usedT.add(c.t); usedP.add(c.p); out.push(c);
  }
  return out;
}

/**
 * Evalúa una foto. truth/pred: [{name, kind, mask}].
 *  - cada superficie anotada queda "encontrada" (IoU ≥ foundIou), "buena" (≥ goodIou) o "perdida"
 *  - "sobrantes": superficies detectadas que no corresponden a ninguna anotada y ocupan ≥ minExtraArea de la foto
 *  - falsePaint: fracción de lo detectado que NO es superficie anotada (pintura donde no debía)
 *  - missedPaint: fracción de lo anotado que NO se detectó (pintura que falta)
 *  - zeroTouch: el cliente no tendría que tocar nada (todo bueno, sin sobrantes, poca pintura mal puesta)
 */
export function evaluatePhoto(truth, pred, { foundIou = 0.5, goodIou = 0.85, minExtraArea = 0.02, maxFalsePaint = 0.03 } = {}) {
  const size = (truth[0] ?? pred[0])?.mask.length ?? 0;
  const matches = matchSurfaces(truth, pred);
  const byT = new Map(matches.map((m) => [m.t, m]));
  const perSurface = truth.map((t, i) => {
    const m = byT.get(i);
    return { name: t.name, kind: t.kind, iou: m && m.iou >= foundIou ? m.iou : 0, rawIou: m?.iou ?? 0, found: !!m && m.iou >= foundIou, good: !!m && m.iou >= goodIou };
  });
  const matchedP = new Set(matches.filter((m) => m.iou >= foundIou).map((m) => m.p));
  const extras = pred.map((p, j) => ({ p, j })).filter(({ p, j }) => !matchedP.has(j) && countOn(p.mask) / size >= minExtraArea).map(({ p }) => ({ name: p.name, area: countOn(p.mask) / size }));
  const tAll = new Uint8Array(size), pAll = new Uint8Array(size);
  for (const t of truth) for (let i = 0; i < size; i++) if (t.mask[i]) tAll[i] = 1;
  for (const p of pred) for (let i = 0; i < size; i++) if (p.mask[i]) pAll[i] = 1;
  let wrong = 0, missed = 0, pn = 0, tn = 0;
  for (let i = 0; i < size; i++) { if (pAll[i]) { pn++; if (!tAll[i]) wrong++; } if (tAll[i]) { tn++; if (!pAll[i]) missed++; } }
  const falsePaint = pn ? wrong / pn : 0, missedPaint = tn ? missed / tn : 0;
  const zeroTouch = perSurface.every((s) => s.good) && extras.length === 0 && falsePaint <= maxFalsePaint;
  return { perSurface, extras, falsePaint, missedPaint, zeroTouch };
}

/** Resume una lista de resultados de evaluatePhoto. */
export function summarize(results) {
  const all = results.flatMap((r) => r.perSurface);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    fotos: results.length,
    superficies: all.length,
    iouMedio: mean(all.map((s) => s.iou)),
    encontradas: all.filter((s) => s.found).length / Math.max(1, all.length),
    buenas: all.filter((s) => s.good).length / Math.max(1, all.length),
    sobrantes: results.reduce((a, r) => a + r.extras.length, 0),
    pinturaMalPuesta: mean(results.map((r) => r.falsePaint)),
    pinturaQueFalta: mean(results.map((r) => r.missedPaint)),
    sinTocar: results.filter((r) => r.zeroTouch).length / Math.max(1, results.length),
  };
}
