// Catálogo de fallas por causa a partir de un jsonl de coco-cache.mjs (usa los candidatos y su solapamiento con las etiquetas). Uso: node catalogo-fallas.mjs resultados.jsonl

import fs from 'node:fs';
const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cat = {};
const add = (k, r, extra = '') => { (cat[k] ??= []).push(r.id.slice(6) + extra); };
for (const r of rows) {
  const c = (r.cands ?? []).filter((x) => x.kind !== 'techo-contacto');
  const big = (x) => x.area >= 0.03;
  const wallish = c.filter((x) => big(x) && (x.gtWall ?? 0) >= 0.5);
  const veto = (w) => wallish.some((x) => x.kind === 'veto:' + w);
  const fac = r.mode === 'fachada' ? ' [fach]' : '';
  const pIoU = r.pared.iou ?? 0;
  if (r.pared.gt > 0 && pIoU < 0.5) {
    let k;
    if (r.pared.det && r.pared.deMas > 0.25) {
      if (c.some((x) => x.kind === 'pared' && x.area >= 0.03 && (x.gtCeil ?? 0) >= 0.5)) k = 'P-A techo clasificado como pared';
      else if (r.mode === 'fachada') k = 'P-B pared de mas en modo fachada';
      else k = 'P-C pared de mas (otra)';
    } else if (veto('textura')) k = 'P-D pared vetada por textura (rugosa/papel/objetos)';
    else if (veto('líneas')) k = 'P-E pared vetada por lineas (azulejo/paneles)';
    else if (veto('quemado')) k = 'P-F pared vetada por quemado (muy clara)';
    else if (wallish.some((x) => x.kind === 'veto:forma')) k = 'P-G pared vetada por forma (baja/angosta)';
    else if (wallish.some((x) => x.kind === 'techo')) k = 'P-H pared clasificada como techo';
    else if (wallish.some((x) => /luma|negro|mesa/.test(x.kind))) k = 'P-I pared vetada por luz/oscura';
    else if (!wallish.length && !r.pared.det) k = 'P-J sin candidata de pared (SAM/semillas) y 0 detectada';
    else if (!wallish.length) k = 'P-K cobertura parcial (sin otra candidata)';
    else k = 'P-L cobertura parcial (hay candidatas aceptadas)';
    add(k + fac, r);
  }
  if (r.techo.gt > 0 && (r.techo.iou ?? 0) < 0.3) {
    const tc = c.filter((x) => big(x) && (x.gtCeil ?? 0) >= 0.5);
    let k;
    if (r.mode === 'fachada') k = 'T-A techo perdido por caida a fachada';
    else if (tc.some((x) => /^veto:/.test(x.kind) && x.kind !== 'veto:forma')) k = 'T-B techo vetado (' + tc.find((x) => /^veto:/.test(x.kind)).kind.slice(5) + ')';
    else if (tc.some((x) => x.kind === 'veto:forma')) k = 'T-C techo vetado por forma';
    else if (tc.some((x) => x.kind === 'pared')) k = 'T-D techo clasificado como pared';
    else if (tc.some((x) => x.kind === 'techo')) k = 'T-E techo candidato descartado despues (contacto/pared)';
    else k = 'T-F sin candidata de techo';
    add(k, r);
  }
}
for (const [k, v] of Object.entries(cat).sort()) console.log(String(v.length).padStart(3), k, '|', v.join(' '));
