// Diagnóstico agente B: por foto, qué regiones (aceptadas y rechazadas) cubren pared real, y por qué se perdió.
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
import { detectSurfaces } from '@pintureria/core';
import { cleanMask } from '@pintureria/core';

const dir = process.env.COCO_DIR, outFile = process.env.DIAG_OUT;
const onlyIds = new Set(JSON.parse(fs.readFileSync(process.env.COCO_IDS, 'utf8')));
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const list = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).filter((x) => onlyIds.has(x.id) && x.split !== 'test' && !done.has(x.id));
function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
const sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
const OPTS = process.env.COCO_OPTS ? JSON.parse(process.env.COCO_OPTS) : {};
const WALL = (v) => v === 171 || v === 172;
for (const e of list) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, `${e.id}.jpg`)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const lp = PNG.sync.read(fs.readFileSync(path.join(dir, `${e.id}.labels.png`)));
  const lab = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) lab[y * width + x] = lp.data[(Math.min(lp.height - 1, Math.floor((y / height) * lp.height)) * lp.width + Math.min(lp.width - 1, Math.floor((x / width) * lp.width))) * 4];
  const { width: rw, height: rh } = encoderSize(width, height);
  await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
  const segs = [];
  const lista = await detectSurfaces(img, async (pts) => { sam.reset(); const r = await sam.segment(pts.map((q) => ({ x: q.x, y: q.y, label: 1 }))); return cleanMask(r.mask, width, height); }, OPTS);
  let gt = 0; for (let i = 0; i < lab.length; i++) if (WALL(lab[i])) gt++;
  const info = (r, acc) => { let inW = 0, n = 0, lb = 0; for (let i = 0; i < lab.length; i++) if (r.mask[i]) { n++; if (WALL(lab[i])) inW++; if (lab[i] === 255) lb++; } return { acc, kind: r.kind ?? null, why: r.why ?? null, area: +(n / lab.length).toFixed(3), wallFrac: +(inW / Math.max(1, n)).toFixed(2), wallOfGt: +(inW / Math.max(1, gt)).toFixed(2), tex: +(r.texture ?? 0).toFixed(3), luma: Math.round(r.luma ?? 0), line: r.lines ?? null, cy: +(r.cy ?? 0).toFixed(2), line: +(r.line ?? 0).toFixed(4), geo: [r.left, r.top, r.right, r.bottom].map((v) => +(v ?? 0).toFixed(2)) }; };
  const regs = [...lista.map((r) => info(r, true)), ...lista.rechazadas.map((r) => info(r, false))];
  const res = { id: e.id, gtWall: +(gt / lab.length).toFixed(3), regs };
  fs.appendFileSync(outFile, JSON.stringify(res) + '\n');
  console.log(e.id, 'gt', res.gtWall, '\n' + regs.map((r) => `   ${r.acc ? 'OK ' : 'rej'} ${String(r.kind ?? r.why).padEnd(14)} area ${r.area} pared% ${r.wallFrac} cubreGT ${r.wallOfGt} tex ${r.tex} luma ${r.luma} line ${r.line} geo ${r.geo}`).join('\n'));
}
