// Corre la detección automática de superficies (JS pesado: ~35-50 % del análisis). Está pensado para ejecutarse DENTRO del
// Worker de SAM: así la interfaz no se congela y cada decodificación es una llamada directa (sin mensajes de ida y vuelta).
// Es puro (sin DOM ni Worker) para poder probarlo con `node --test`.
import { cleanMask, detectSurfaces, detectFacade } from '@pintureria/core';

export class DetectCancelled extends Error {
  constructor() {
    super('cancelado');
    this.name = 'DetectCancelled';
  }
}

/**
 * image: { data: Uint8ClampedArray RGBA, width, height }
 * segment(points): Promise<{ mask: Uint8Array }>  (decodificación de SAM; points = [{x, y, label}])
 * onProgress(n): se llama ANTES de cada decodificación con la cantidad ya hecha
 * isCancelled(): se consulta antes de cada decodificación; si da true se corta con DetectCancelled
 * mode: 'interior' (paredes y techo de un ambiente) · 'fachada' (exterior: cielo/piso/paños lisos/ladrillo) · 'auto' (default: interior y, si no encuentra
 *   nada, fachada con la misma foto ya analizada)
 * Devuelve { found: [{ name, kind, area, mask }], decodes, mode: 'interior'|'fachada' }
 *   kind 'ladrillo' = superficie rugosa: la app NO le pone color por defecto.
 */
export async function runDetect({ image, segment, onProgress = () => {}, isCancelled = () => false, opts = {}, mode = 'auto' }) {
  const { width, height } = image;
  let n = 0;
  const seg = async (pts) => {
    if (isCancelled()) throw new DetectCancelled();
    onProgress(n);
    const r = await segment(pts.map((q) => ({ x: q.x, y: q.y, label: 1 })));
    n++;
    return cleanMask(r.mask, width, height);
  };
  let found = [], used = mode === 'fachada' ? 'fachada' : 'interior';
  if (mode !== 'fachada') found = await detectSurfaces(image, seg, opts);
  if (mode === 'fachada' || (mode === 'auto' && !found.length)) { found = await detectFacade(image, seg); used = 'fachada'; }
  if (isCancelled()) throw new DetectCancelled();
  return { found: found.map(({ name, kind, area, mask }) => ({ name, kind, area, mask })), decodes: n, mode: used };
}
