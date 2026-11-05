// Corre la detección automática de superficies (JS pesado: ~35-50 % del análisis). Está pensado para ejecutarse DENTRO del
// Worker de SAM: así la interfaz no se congela y cada decodificación es una llamada directa (sin mensajes de ida y vuelta).
// Es puro (sin DOM ni Worker) para poder probarlo con `node --test`.
import { cleanMask, detectSurfaces } from '@pintureria/core';

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
 * Devuelve { found: [{ name, kind, area, mask }], decodes }
 */
export async function runDetect({ image, segment, onProgress = () => {}, isCancelled = () => false, opts = {} }) {
  const { width, height } = image;
  let n = 0;
  const found = await detectSurfaces(image, async (pts) => {
    if (isCancelled()) throw new DetectCancelled();
    onProgress(n);
    const r = await segment(pts.map((q) => ({ x: q.x, y: q.y, label: 1 })));
    n++;
    return cleanMask(r.mask, width, height);
  }, opts);
  if (isCancelled()) throw new DetectCancelled();
  return { found: found.map(({ name, kind, area, mask }) => ({ name, kind, area, mask })), decodes: n };
}
