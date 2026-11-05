// Diagnóstico agente C: graba las decodificaciones de SAM por foto (cache) y repite detectSurfaces sin SAM; dibuja detección vs etiquetas.
// Uso: CACHE=dir OUT=dir IDS=lista.json MODE=record|replay [COCO_OPTS=json] node agente-c-diag.mjs   (record corre SAM: usar con-candado)
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import jpeg from 'jpeg-js'; import { PNG } from 'pngjs';
import { workingSize, encoderSize, rgbaToRgbFloat } from '../../apps/web/src/sam.js';
import { runDetect } from '../../apps/web/src/detect.js';
const dir = process.env.COCO_DIR, CACHE = process.env.CACHE, OUT = process.env.OUT, MODE = process.env.MODE ?? 'replay';
const ids = JSON.parse(fs.readFileSync(process.env.IDS, 'utf8')); const OPTS = process.env.COCO_OPTS ? JSON.parse(process.env.COCO_OPTS) : {};
fs.mkdirSync(CACHE, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
let sam = null;
if (MODE === 'record') {
  const ort = await import('onnxruntime-web/wasm'); const { Sam } = await import('../../apps/web/src/sam.js'); ort.env.wasm.numThreads = 1;
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
  sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
}
const WALL = (v) => v === 171 || v === 172, WALL_ANY = (v) => v >= 170 && v <= 176;
const NAMES = { 101: 'techo', 102: 'techo', 108: 'cortina', 180: 'ventana', 255: 'sin-etiq' };
const sum = [];
for (const id of ids) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, `${id}.jpg`)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const lp = PNG.sync.read(fs.readFileSync(path.join(dir, `${id}.labels.png`)));
  const lab = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) lab[y * width + x] = lp.data[(Math.min(lp.height - 1, Math.floor((y / height) * lp.height)) * lp.width + Math.min(lp.width - 1, Math.floor((x / width) * lp.width))) * 4];
  const cf = path.join(CACHE, `${id}.json.gz`); let cache = {};
  if (fs.existsSync(cf)) cache = JSON.parse(zlib.gunzipSync(fs.readFileSync(cf)).toString());
  let dirty = false;
  if (MODE === 'record' && !Object.keys(cache).length) { const { width: rw, height: rh } = encoderSize(width, height); await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height); }
  const segment = async (pts) => {
    const key = JSON.stringify(pts.map((p) => [Math.round(p.x * 100), Math.round(p.y * 100)]));
    if (!cache[key]) {
      if (MODE !== 'record') throw new Error('cache miss ' + id + ' ' + key);
      sam.reset(); const r = await sam.segment(pts); cache[key] = Buffer.from(r.mask).toString('base64'); dirty = true;
    }
    return { mask: new Uint8Array(Buffer.from(cache[key], 'base64')) };
  };
  let found;
  try { ({ found } = await runDetect({ image: img, segment, opts: OPTS, mode: process.env.COCO_MODE ?? 'auto' })); } catch (e) { console.log(id, 'ERR', e.message); continue; }
  if (dirty) fs.writeFileSync(cf, zlib.gzipSync(JSON.stringify(cache)));
  const walls = new Uint8Array(width * height); for (const f of found) if (f.kind === 'pared') for (let i = 0; i < walls.length; i++) if (f.mask[i]) walls[i] = 1;
  let d = 0, g = 0, inter = 0, uni = 0, extra = 0; const cnt = {};
  for (let i = 0; i < walls.length; i++) { if (lab[i] === 255) continue; const a = walls[i], b = WALL(lab[i]) ? 1 : 0; d += a; g += b; if (a && b) inter++; if (a || b) uni++; if (a && !WALL_ANY(lab[i])) { extra++; cnt[lab[i]] = (cnt[lab[i]] ?? 0) + 1; } }
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${NAMES[k] ?? k}:${(v / d).toFixed(2)}`).join(' ');
  const r = { id, iou: uni ? inter / uni : null, rec: g ? inter / g : null, deMas: d ? extra / d : null, top }; sum.push(r);
  console.log(id, 'IoU', r.iou?.toFixed(3), 'rec', r.rec?.toFixed(3), 'deMas', r.deMas?.toFixed(3), '|', top);
  if (process.env.DRAW) { // foto | detección (verde ok, rojo de más, azul faltante)
    const o = new PNG({ width: width * 2, height }); 
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * width + x; for (let c = 0; c < 3; c++) { o.data[(y * width * 2 + x) * 4 + c] = img.data[i * 4 + c]; } o.data[(y * width * 2 + x) * 4 + 3] = 255;
      let col = null; const a = walls[i], b = WALL(lab[i]); const any = WALL_ANY(lab[i]);
      if (lab[i] === 255 && a) col = [255, 255, 0]; else if (a && !any) col = [255, 0, 0]; else if (a) col = [0, 200, 0]; else if (b) col = [0, 80, 255];
      const p = (y * width * 2 + width + x) * 4; for (let c = 0; c < 3; c++) o.data[p + c] = col ? (img.data[i * 4 + c] * 0.35 + col[c] * 0.65) : img.data[i * 4 + c] * 0.6; o.data[p + 3] = 255; }
    fs.writeFileSync(path.join(OUT, `${id}.png`), PNG.sync.write(o));
  }
}
const m = (k) => (sum.filter((r) => r[k] != null).reduce((a, r) => a + r[k], 0) / sum.filter((r) => r[k] != null).length).toFixed(3);
console.log('MEDIA iou', m('iou'), 'rec', m('rec'), 'deMas', m('deMas'), 'n', sum.length);
