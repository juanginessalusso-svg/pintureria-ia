// Pincel y borrador sobre una máscara binaria (Uint8Array 0/1). Funciones puras.

/**
 * Pinta (value = 1) o borra (value = 0) un trazo de pincel redondo, EN SITIO.
 * pts: [{x, y}] en píxeles de la imagen; r: radio en píxeles. Los tramos entre puntos se rellenan (sin huecos al arrastrar rápido).
 */
export function paintStroke(mask, width, height, pts, r, value) {
  if (!pts.length) return mask;
  const r2 = r * r;
  const stamp = (cx, cy) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + dy * dy <= r2) mask[y * width + x] = value;
    }
  };
  stamp(pts[0].x, pts[0].y);
  const step = Math.max(1, r / 2);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let s = 1; s <= n; s++) stamp(a.x + ((b.x - a.x) * s) / n, a.y + ((b.y - a.y) * s) / n);
  }
  return mask;
}

/** Cantidad de píxeles activos de una máscara. */
export function maskCount(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}
