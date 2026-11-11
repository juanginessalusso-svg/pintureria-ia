// Corre la detección automática de superficies (JS pesado: ~35-50 % del análisis). Está pensado para ejecutarse DENTRO del
// Worker de SAM: así la interfaz no se congela y cada decodificación es una llamada directa (sin mensajes de ida y vuelta).
// Es puro (sin DOM ni Worker) para poder probarlo con `node --test`.
import { cleanMask, detectSurfaces, detectFacade, detectSurfacesSemantico, hibridar, vetarConModelo, completarConModelo, recortarObjetos, superficiesDesdeMapa, rellenarBordes, marcarZocalos } from '@pintureria/core';

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
 * classMap (opcional, Uint8Array width*height, 0 otro / 1 pared / 2 techo / 3 piso): mapa de clases de un segmentador semántico; si viene, el interior se detecta con él
 *   (semillas para SAM + recorte, ver semantico.js) y solo si no halla nada se usa el detector clásico.
 * Devuelve { found: [{ name, kind, area, mask }], decodes, mode: 'interior'|'fachada' }
 *   kind 'ladrillo' = superficie rugosa: la app NO le pone color por defecto.
 */
export async function runDetect({ image, segment, onProgress = () => {}, isCancelled = () => false, opts = {}, mode = 'auto', mergeTecho = false, classMap = null, instancias = null, veto = null }) {
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
  // directo (opts.semantico.directo): el mapa viene del servidor con GPU (SAM 3 + r9) con los bordes ya exactos; las superficies salen
  // de él sin pedirle nada a SAM (más fiel y sin los 10-40 s de decodificaciones en el celular). Interior y fachada por igual.
  if (classMap && opts.semantico?.directo) {
    found = superficiesDesdeMapa(classMap, width, height, { ...opts.semantico, instancias });
    if (!opts.semantico.sinBordes) found = rellenarBordes(found, image, { veto }); // sinBordes: solo para comparar en eval
    if (!opts.semantico.sinZocalo) found = marcarZocalos(found, image);
    if (found.length) return { found, decodes: 0, mode: 'servidor' };
  }
  if (mode !== 'fachada' && classMap) {
    found = await detectSurfacesSemantico(classMap, width, height, seg, opts.semantico ?? {});
    // si el modelo (entrenado con interiores) casi no ve pared/techo, la foto probablemente no es un interior (fachada): se deja que decida el detector clásico
    if (found.reduce((a, f) => a + f.area, 0) < (opts.semantico?.minCobertura ?? 0.12)) found = [];
    // fusion (opt-in, opts.semantico.fusion): a lo del modelo se le suman las PAREDES del detector clásico que el modelo no vio (poco solapadas con lo ya hallado)
    if (found.length && (opts.semantico?.fusion || opts.semantico?.hibrido)) {
      const N = width * height, ocupado = new Uint8Array(N);
      for (const f of found) for (let i = 0; i < N; i++) if (f.mask[i]) ocupado[i] = 1;
      const clasico = await detectSurfaces(image, seg, opts);
      if (opts.semantico.fusion) for (const c of clasico) {
        if (c.kind !== 'pared' || c.area < (opts.semantico.fusionMinArea ?? 0.03)) continue;
        let sol = 0, tot = 0; for (let i = 0; i < N; i++) if (c.mask[i]) { tot++; if (ocupado[i]) sol++; }
        if (tot && sol / tot < (opts.semantico.fusionMaxSolape ?? 0.25)) {
          const m = new Uint8Array(N); let a = 0; for (let i = 0; i < N; i++) if (c.mask[i] && !ocupado[i]) { m[i] = 1; a++; }
          found.push({ name: c.name, kind: 'pared', area: a / N, mask: m });
          for (let i = 0; i < N; i++) if (m[i]) ocupado[i] = 1;
        }
      }
      // hibrido (opt-in, opts.semantico.hibrido): paredes del modelo, techo del clásico (si el modelo también lo ve) y sin manchas sueltas; ver hibridar() en semantico.js
      if (opts.semantico.hibrido) found = hibridar(found, clasico, classMap, width, height, opts.semantico);
    }
    // completar (opt-in, opts.semantico.completar): lo que el modelo ve como pared/techo y quedó sin cubrir se vuelve a pedir a SAM; ver completarConModelo() en semantico.js
    if (found.length && opts.semantico?.completar) found = await completarConModelo(found, classMap, width, height, seg, { image, ...(typeof opts.semantico.completar === 'object' ? opts.semantico.completar : {}) });
    // veto (opt-in, opts.semantico.veto): cada superficie se recorta a la zona que el modelo ve como su clase (+ margen); ver vetarConModelo() en semantico.js
    if (found.length && opts.semantico?.veto) found = vetarConModelo(found, classMap, width, height, typeof opts.semantico.veto === 'object' ? opts.semantico.veto : {});
    // objetos (opt-in, opts.semantico.objetos): lo pintado que el modelo ve como 'otro' y tiene cuerpo se recorta con SAM; ver recortarObjetos() en semantico.js
    if (found.length && opts.semantico?.objetos) found = await recortarObjetos(found, classMap, width, height, seg, typeof opts.semantico.objetos === 'object' ? opts.semantico.objetos : {});
  }
  if (mode !== 'fachada' && !found.length) found = await detectSurfaces(image, seg, opts);
  // mergeTecho (opt-in): si el interior halló techo pero ninguna pared, la caída a fachada no tira ese techo (el detector de fachadas no sabe de techo):
  // se conserva el techo del interior en lo que la fachada no ocupó.
  const techoInterior = mergeTecho && mode === 'auto' && !found.some((f) => f.kind === 'pared') ? found.filter((f) => f.kind === 'techo') : [];
  if (mode === 'fachada' || (mode === 'auto' && (!found.length || (mergeTecho && !found.some((f) => f.kind === 'pared'))))) {
    found = await detectFacade(image, seg); used = 'fachada';
    // techoManda (opt-in, opts.techoManda): el techo que halló el interior MANDA sobre los paños de la fachada (que suelen tragarse el cielorraso): se lo recorta de ellos en vez de dejar
    // al techo solo con lo que la fachada no ocupó. Una fachada de verdad no tiene techo aceptado en el interior (el cielo se descarta por azul/brillo/sin pared debajo).
    if (techoInterior.length && opts.techoManda && !found.some((f) => f.kind === 'techo')) {
      const N = width * height, techo = new Uint8Array(N);
      for (const t of techoInterior) for (let i = 0; i < N; i++) if (t.mask[i]) techo[i] = 1;
      found = found.map((f) => { const m = new Uint8Array(N); let a = 0; for (let i = 0; i < N; i++) if (f.mask[i] && !techo[i]) { m[i] = 1; a++; } return { ...f, mask: m, area: a / N }; }).filter((f) => f.area >= 0.01);
      found.push(...techoInterior);
    } else if (techoInterior.length && !found.some((f) => f.kind === 'techo')) {
      const ocupado = new Uint8Array(width * height);
      for (const f of found) for (let i = 0; i < ocupado.length; i++) if (f.mask[i]) ocupado[i] = 1;
      for (const t of techoInterior) {
        const m = new Uint8Array(width * height);
        let a = 0;
        for (let i = 0; i < m.length; i++) if (t.mask[i] && !ocupado[i]) { m[i] = 1; a++; }
        if (a / (width * height) >= 0.025) found.push({ ...t, mask: m, area: a / (width * height) });
      }
    }
  }
  if (isCancelled()) throw new DetectCancelled();
  return { found: found.map(({ name, kind, area, mask }) => ({ name, kind, area, mask })), decodes: n, mode: used };
}
