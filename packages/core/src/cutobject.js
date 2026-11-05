// "Sacar un objeto": decide si la máscara que devolvió SAM (con un toque sobre un objeto) se puede restar de una superficie.
// Función pura: no toca la máscara de la superficie (devuelve una nueva) ni depende del DOM.

// Umbrales (fracciones del área de la superficie).
export const CUT_MAX_COVER = 0.85; // si SAM cubre ≥ 85 % de la superficie, agarró la pared entera, no un objeto
export const CUT_MAX_SIZE = 0.6; // si el recorte total (dentro y fuera de la superficie) supera el 60 % de su área, salió demasiado grande

/**
 * @param {Uint8Array} surface  máscara de la superficie (0/1)
 * @param {Uint8Array} sam      máscara de SAM ya limpia (0/1), mismas dimensiones
 * @returns {{ok:true, mask:Uint8Array, removed:number} | {ok:false, reason:'empty'|'no-overlap'|'too-big'}}
 *   reason: 'empty' (SAM no devolvió nada, o la superficie está vacía), 'no-overlap' (no toca la superficie),
 *   'too-big' (≥ 85 % de la superficie, o más del 60 % de su área).
 */
export function cutObjectFromSurface(surface, sam) {
  if (!surface || !sam || surface.length !== sam.length) throw new Error('Las máscaras tienen que existir y medir lo mismo.');
  let tot = 0, inter = 0, mn = 0;
  for (let k = 0; k < sam.length; k++) {
    if (surface[k]) tot++;
    if (sam[k]) { mn++; if (surface[k]) inter++; }
  }
  if (!mn || !tot) return { ok: false, reason: 'empty' };
  if (!inter) return { ok: false, reason: 'no-overlap' };
  if (inter / tot >= CUT_MAX_COVER || mn / tot > CUT_MAX_SIZE) return { ok: false, reason: 'too-big' };
  const mask = surface.slice();
  for (let k = 0; k < sam.length; k++) if (sam[k]) mask[k] = 0;
  return { ok: true, mask, removed: inter };
}
