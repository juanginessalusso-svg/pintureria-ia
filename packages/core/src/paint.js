// Cálculo de pintura: escala de la foto -> m² -> litros -> latas. Funciones puras, sin dependencias.
// IMPORTANTE: todo esto es una ESTIMACIÓN. La interfaz siempre la presenta así y deja editar el m².

export const DEFAULT_MARGIN = 0.1; // 10 % de margen por desperdicio y retoques

/** Píxeles por metro a partir de dos puntos de la foto y la distancia real entre ellos. */
export function pxPerMeter(p1, p2, meters) {
  if (!(meters > 0)) throw new Error('la medida real debe ser mayor que 0');
  const px = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (px < 5) throw new Error('los dos puntos están demasiado juntos');
  return px / meters;
}

/** Cantidad de píxeles "pared" de una o más máscaras (Uint8Array/Float32Array; >0,5 = pared). Une las máscaras. */
export function wallPixels(masks) {
  if (!masks.length) return 0;
  let n = 0;
  for (let i = 0; i < masks[0].length; i++) {
    for (const m of masks) if (m[i] > 0.5) { n++; break; }
  }
  return n;
}

/** m² a partir de píxeles y la escala (px/m). Supone pared de frente a la cámara, a la misma distancia que la referencia. */
export function areaM2(pixels, pxPerM) {
  if (!(pxPerM > 0)) throw new Error('falta calibrar la escala');
  return pixels / (pxPerM * pxPerM);
}

/** litros = m² × manos ÷ rendimiento (m²/L por mano) × (1 + margen). Devuelve litros SIN redondear. */
export function litersNeeded({ m2, coats, yieldM2PerL, margin = DEFAULT_MARGIN }) {
  if (!(m2 >= 0)) throw new Error('m² inválido');
  if (!(coats >= 1)) throw new Error('las manos deben ser al menos 1');
  if (!(yieldM2PerL > 0)) throw new Error('el rendimiento debe ser mayor que 0');
  return (m2 * coats * (1 + margin)) / yieldM2PerL;
}

/**
 * Sugiere qué latas comprar para cubrir `liters`.
 * sizes: [{liters, price_cents}]. Criterio: MENOR COSTO que cubra los litros; si empatan, menos sobrante y luego menos latas.
 * Sin precios (todos 0) minimiza el sobrante.
 * Devuelve { items:[{liters, qty, unit_price_cents, subtotal_cents}], total_liters, total_cents, leftover_liters } o null si no hay presentaciones.
 */
export function suggestCans(liters, sizes) {
  const valid = sizes.filter((s) => s.liters > 0);
  if (!valid.length || !(liters > 0)) return null;
  const U = 10; // resolución: 0,1 L
  const unit = valid.map((s) => ({ ...s, u: Math.round(s.liters * U) })).filter((s) => s.u > 0);
  const target = Math.ceil(liters * U - 1e-9);
  const maxU = Math.max(...unit.map((s) => s.u));
  const limit = target + maxU; // un óptimo nunca necesita pasarse más que una lata grande
  const hasPrices = unit.some((s) => s.price_cents > 0);
  const cost = (s) => (hasPrices ? s.price_cents : s.u);

  // dp[t] = mejor combinación que suma EXACTAMENTE t unidades: [costo, latas]
  const dp = new Array(limit + 1).fill(null);
  dp[0] = { cost: 0, cans: 0, take: null, prev: 0 };
  for (let t = 1; t <= limit; t++) {
    for (const s of unit) {
      if (t < s.u || !dp[t - s.u]) continue;
      const c = dp[t - s.u].cost + cost(s), n = dp[t - s.u].cans + 1;
      if (!dp[t] || c < dp[t].cost || (c === dp[t].cost && n < dp[t].cans)) dp[t] = { cost: c, cans: n, take: s, prev: t - s.u };
    }
  }
  let best = null;
  for (let t = target; t <= limit; t++) {
    if (!dp[t]) continue;
    const cand = { t, ...dp[t] };
    if (!best || cand.cost < best.cost || (cand.cost === best.cost && (cand.t < best.t || (cand.t === best.t && cand.cans < best.cans)))) best = cand;
  }
  if (!best) return null;

  const counts = new Map();
  for (let t = best.t; t > 0; t = dp[t].prev) {
    const s = dp[t].take;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const items = [...counts.entries()]
    .map(([s, qty]) => ({ liters: s.liters, qty, unit_price_cents: s.price_cents, subtotal_cents: s.price_cents * qty }))
    .sort((a, b) => b.liters - a.liters);
  const totalLiters = items.reduce((a, i) => a + i.liters * i.qty, 0);
  return {
    items,
    total_liters: Math.round(totalLiters * 100) / 100,
    total_cents: items.reduce((a, i) => a + i.subtotal_cents, 0),
    leftover_liters: Math.round((totalLiters - liters) * 100) / 100,
  };
}
