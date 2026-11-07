// Como coco-iou.mjs pero con CACHE de las decodificaciones de SAM por foto (CACHE/<id>.json.gz): permite repetir la detección
// (todo el JS de surfaces.js/facade.js) en segundos sin SAM, y solo corre SAM en las semillas nuevas (cache miss).
// Uso: COCO_DIR=... CACHE=dir COCO_OUT=salida.jsonl [MODELS_DIR=... (para los misses)] [REPLAY_ONLY=1] [COCO_OPTS=json] [COCO_IDS=lista.json] node coco-cache.mjs dev|test|todas
// Con misses hay que usar con-candado.mjs. Cada línea del jsonl: igual que coco-iou.mjs, más `cands` (candidatos y veredicto) y `miss` (decodificaciones nuevas).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
import { runDetect } from '../../apps/web/src/detect.js';

const dir = process.env.COCO_DIR, CACHE = process.env.CACHE, outFile = process.env.COCO_OUT, REPLAY_ONLY = !!process.env.REPLAY_ONLY;
const split = process.argv[2] ?? 'dev';
const onlyIds = process.env.COCO_IDS ? new Set(JSON.parse(fs.readFileSync(process.env.COCO_IDS, 'utf8'))) : null;
fs.mkdirSync(CACHE, { recursive: true }); fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, '');
const list = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).filter((x) => (split === 'todas' || x.split === split) && (!onlyIds || onlyIds.has(x.id)));
function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
let sam = null;
async function getSam() {
  if (sam) return sam;
  const ort = await import('onnxruntime-web/wasm'); const { Sam } = await import('../../apps/web/src/sam.js'); ort.env.wasm.numThreads = 1;
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
  return (sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') }));
}
const OPTS = process.env.COCO_OPTS ? JSON.parse(process.env.COCO_OPTS) : {};
const WALL = (v) => v === 171 || v === 172, WALL_ANY = (v) => v >= 170 && v <= 176, CEIL = (v) => v === 101 || v === 102;
function score(det, lab, isGt, isOkAny) {
  let inter = 0, uni = 0, d = 0, g = 0, extra = 0;
  for (let i = 0; i < det.length; i++) { if (lab[i] === 255) continue; const a = det[i] ? 1 : 0, b = isGt(lab[i]) ? 1 : 0; d += a; g += b; if (a && b) inter++; if (a || b) uni++; if (a && !isOkAny(lab[i])) extra++; }
  return { iou: uni ? inter / uni : null, recall: g ? inter / g : null, deMas: d ? extra / d : null, det: d, gt: g };
}
for (const e of list) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, `${e.id}.jpg`)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const lp = PNG.sync.read(fs.readFileSync(path.join(dir, `${e.id}.labels.png`)));
  const lab = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) lab[y * width + x] = lp.data[(Math.min(lp.height - 1, Math.floor((y / height) * lp.height)) * lp.width + Math.min(lp.width - 1, Math.floor((x / width) * lp.width))) * 4];
  const cf = path.join(CACHE, `${e.id}.json.gz`); let cache = {};
  if (fs.existsSync(cf)) cache = JSON.parse(zlib.gunzipSync(fs.readFileSync(cf)).toString());
  let miss = 0, embedded = false;
  const segment = async (pts) => {
    const key = JSON.stringify(pts.map((p) => [Math.round(p.x * 100), Math.round(p.y * 100)]));
    if (!cache[key]) {
      if (REPLAY_ONLY) throw new Error('cache miss ' + e.id + ' ' + key);
      const s = await getSam();
      if (!embedded) { const { width: rw, height: rh } = encoderSize(width, height); await s.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height); embedded = true; }
      s.reset(); const r = await s.segment(pts); cache[key] = Buffer.from(r.mask).toString('base64'); miss++;
    }
    return { mask: new Uint8Array(Buffer.from(cache[key], 'base64')) };
  };
  const cands = [];
  const t0 = performance.now();
  let found, mode;
  const segFile = process.env.SEG_CACHE ? path.join(process.env.SEG_CACHE, `${e.id}.cls`) : null, classMap = segFile && fs.existsSync(segFile) ? new Uint8Array(fs.readFileSync(segFile)) : null; // SEG_CACHE: mapa del modelo (modelo-propio-iou.mjs), como ?modelo=1
  try { ({ found, mode } = await runDetect({ image: img, segment, classMap, opts: { ...OPTS, debugCand: (c) => { if (c.mask) { let n = 0, wl = 0, wa = 0, ce = 0; for (let i = 0; i < c.mask.length; i++) if (c.mask[i] && lab[i] !== 255) { n++; if (WALL(lab[i])) wl++; if (WALL_ANY(lab[i])) wa++; if (CEIL(lab[i])) ce++; } c.gtWall = n ? +(wl / n).toFixed(2) : null; c.gtWallAny = n ? +(wa / n).toFixed(2) : null; c.gtCeil = n ? +(ce / n).toFixed(2) : null; delete c.mask; } cands.push(c); } }, mode: process.env.COCO_MODE ?? 'auto', mergeTecho: !!OPTS.mergeTecho })); } catch (err) { console.log(e.id, 'ERR', err.message); continue; }
  if (miss) fs.writeFileSync(cf, zlib.gzipSync(JSON.stringify(cache)));
  const walls = new Uint8Array(width * height), ceil = new Uint8Array(width * height);
  for (const f of found) { const t = f.kind === 'techo' ? ceil : f.kind === 'pared' ? walls : null; if (t) for (let i = 0; i < t.length; i++) if (f.mask[i]) t[i] = 1; }
  const res = { id: e.id, split: e.split, mode, ms: Math.round(performance.now() - t0), n: found.length, miss, pared: score(walls, lab, WALL, WALL_ANY), techo: score(ceil, lab, CEIL, CEIL), cands };
  fs.appendFileSync(outFile, JSON.stringify(res) + '\n');
  const f2 = (x) => (x == null ? '  -  ' : x.toFixed(2));
  console.log(`${e.id} ${mode.padEnd(8)} ${String(res.ms).padStart(6)} ms miss ${miss} | pared IoU ${f2(res.pared.iou)} rec ${f2(res.pared.recall)} deMás ${f2(res.pared.deMas)} | techo IoU ${f2(res.techo.iou)} rec ${f2(res.techo.recall)} deMás ${f2(res.techo.deMas)}`);
}
