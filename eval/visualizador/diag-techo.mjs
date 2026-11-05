// Mide el detector (el mismo pipeline de la app: runDetect en modo 'auto') contra las máscaras de pared y techo de COCO-Stuff.
// Uso: MODELS_DIR=... node eval/visualizador/coco-iou.mjs [dev|test|todas] [máx]    (resultados en salidas/coco-iou.jsonl; reanuda donde quedó)
// Métricas por foto, sobre píxeles etiquetados (255 = sin etiquetar se ignora):
//   pared: IoU y recall contra {wall-concrete, wall-other}; 'de más' = fracción de lo detectado que NO es pared de ningún tipo (wall-* 170..176)
//   techo: IoU y recall contra {ceiling-other, ceiling-tile}; 'de más' idem contra el techo.
// Aviso: las etiquetas de COCO-Stuff son polígonos toscos (bordes ±pocos px), así que el IoU tiene un techo de ~0,9; sirve para COMPARAR versiones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
import { runDetect } from '../../apps/web/src/detect.js';
import { detectSurfaces, cleanMask } from '../../packages/core/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url)), dir = process.env.COCO_DIR ?? path.join(here, 'fotos', 'coco'); // COCO_DIR: carpeta con las fotos (en un worktree no existe fotos/)
const split = process.argv[2] ?? 'dev', MAX = Number(process.argv[3] ?? 1e9);
const outFile = process.env.COCO_OUT ?? path.join(here, 'salidas', 'coco-iou.jsonl'); // COCO_OUT: dónde escribir los resultados (cada agente el suyo)
const onlyIds = process.env.COCO_IDS ? new Set(JSON.parse(fs.readFileSync(process.env.COCO_IDS, 'utf8'))) : null; // COCO_IDS: JSON con la lista de ids a correr
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const list = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).filter((x) => (split === 'todas' || x.split === split) && !done.has(x.id) && (!onlyIds || onlyIds.has(x.id))).slice(0, MAX);

function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
const sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });

// COCO_OPTS: JSON con opciones para detectSurfaces (p. ej. '{"miRegla":true}'); COCO_MODE: auto|interior|fachada
const COCO_OPTS = process.env.COCO_OPTS ? JSON.parse(process.env.COCO_OPTS) : {};
const WALL = (v) => v === 171 || v === 172, WALL_ANY = (v) => v >= 170 && v <= 176, CEIL = (v) => v === 101 || v === 102;
function score(det, gt, lab, isGt, isOkAny) {
  let inter = 0, uni = 0, d = 0, g = 0, extra = 0;
  for (let i = 0; i < det.length; i++) {
    if (lab[i] === 255) continue;
    const a = det[i] ? 1 : 0, b = isGt(lab[i]) ? 1 : 0;
    d += a; g += b; if (a && b) inter++; if (a || b) uni++;
    if (a && !isOkAny(lab[i])) extra++;
  }
  return { iou: uni ? inter / uni : null, recall: g ? inter / g : null, deMas: d ? extra / d : null, det: d, gt: g };
}


const OUT=process.env.DIAG_OUT;
for (const e of list) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, `${e.id}.jpg`)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const lp = PNG.sync.read(fs.readFileSync(path.join(dir, `${e.id}.labels.png`)));
  const lab = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) lab[y * width + x] = lp.data[(Math.min(lp.height - 1, Math.floor((y / height) * lp.height)) * lp.width + Math.min(lp.width - 1, Math.floor((x / width) * lp.width))) * 4];
  const { width: rw, height: rh } = encoderSize(width, height);
  await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
  const seg = async (pts) => { sam.reset(); const r = await sam.segment(pts.map((q) => ({ x: q.x, y: q.y, label: 1 }))); return cleanMask(r.mask, width, height); };
  const found = await detectSurfaces(img, seg, COCO_OPTS);
  let gtC = 0, gtW = 0; for (let i = 0; i < lab.length; i++) { if (CEIL(lab[i])) gtC++; if (WALL(lab[i])) gtW++; }
  const ov = (m) => { let n = 0, c = 0, w = 0, o = 0; for (let i = 0; i < m.length; i++) if (m[i]) { n++; if (CEIL(lab[i])) c++; else if (WALL_ANY(lab[i])) w++; else o++; } return { onCeil: +(c / n).toFixed(2), onWall: +(w / n).toFixed(2), covC: +(c / gtC).toFixed(2) }; };
  const row = (r, tag) => ({ tag, kind: r.kind ?? null, why: r.why ?? null, area: +r.area.toFixed(3), cy: +r.cy.toFixed(2), top: +r.top.toFixed(2), bot: +r.bottom.toFixed(2), tex: +(r.texture ?? 0).toFixed(3), luma: +(r.luma ?? 0).toFixed(0), ...ov(r.mask) });
  const rec = { id: e.id, gtCeil: +(gtC / lab.length).toFixed(3), gtWall: +(gtW / lab.length).toFixed(3), found: found.map((r) => row(r, 'ok')), rej: (found.rechazadas ?? []).map((r) => row(r, 'rej')) };
  fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
  console.log(e.id, 'ok', found.map((r) => r.kind).join(','), 'rej', rec.rej.length);
}
