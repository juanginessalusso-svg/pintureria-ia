// Mide el segmentador de interiores PROPIO (ONNX exportado por training/train.py) sobre las fotos COCO de evaluación, con onnxruntime-web (wasm), igual que correría en el navegador.
// Deja un mapa de clases por foto en SEG_CACHE/<id>.cls (0 otro, 1 pared, 2 techo, 3 piso, al tamaño de trabajo) que usa modelo-sam-iou.mjs ("modelo + SAM"), y un jsonl con el IoU.
// Uso: SEG_MODEL=ruta.onnx SEG_SIZE=256 SEG_CACHE=dir SEG_OUT=salida.jsonl node eval/visualizador/modelo-propio-iou.mjs [dev|test|todas]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url)), dir = process.env.COCO_DIR ?? path.join(here, 'fotos', 'coco');
const split = process.argv[2] ?? 'dev', S = Number(process.env.SEG_SIZE ?? 256), cache = process.env.SEG_CACHE, outFile = process.env.SEG_OUT;
fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(outFile, '');
const list = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).filter((x) => split === 'todas' || x.split === split);
const WALL = (v) => v === 171 || v === 172, WALL_ANY = (v) => v >= 170 && v <= 176, CEIL = (v) => v === 101 || v === 102;
function resize(s, w, h, nw, nh) { const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
function score(det, lab, isGt, isOkAny) {
  let inter = 0, uni = 0, d = 0, g = 0, extra = 0;
  for (let i = 0; i < det.length; i++) { if (lab[i] === 255) continue; const a = det[i] ? 1 : 0, b = isGt(lab[i]) ? 1 : 0; d += a; g += b; if (a && b) inter++; if (a || b) uni++; if (a && !isOkAny(lab[i])) extra++; }
  return { iou: uni ? inter / uni : null, recall: g ? inter / g : null, deMas: d ? extra / d : null, det: d, gt: g };
}
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(process.env.SEG_MODEL)), { executionProviders: ['wasm'] });
for (const e of list) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, `${e.id}.jpg`)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const lp = PNG.sync.read(fs.readFileSync(path.join(dir, `${e.id}.labels.png`)));
  const lab = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) lab[y * width + x] = lp.data[(Math.min(lp.height - 1, Math.floor((y / height) * lp.height)) * lp.width + Math.min(lp.width - 1, Math.floor((x / width) * lp.width))) * 4];
  const t0 = performance.now();
  const small = resize(raw.data, raw.width, raw.height, S, S), inp = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) inp[c * S * S + i] = small[i * 4 + c] / 255;
  const out = (await session.run({ rgb: new ort.Tensor('float32', inp, [1, 3, S, S]) })).logits;
  const [, K, lh, lw] = out.dims, L = out.data, cls = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) { // bilineal sobre los logits y argmax
    const fy = Math.min(lh - 1, Math.max(0, ((y + .5) * lh) / height - .5)), y0 = Math.floor(fy), y1 = Math.min(lh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(lw - 1, Math.max(0, ((x + .5) * lw) / width - .5)), x0 = Math.floor(fx), x1 = Math.min(lw - 1, x0 + 1), tx = fx - x0;
      let best = 0, bv = -1e9;
      for (let k = 0; k < K; k++) { const b = k * lh * lw, v = (L[b + y0 * lw + x0] * (1 - tx) + L[b + y0 * lw + x1] * tx) * (1 - ty) + (L[b + y1 * lw + x0] * (1 - tx) + L[b + y1 * lw + x1] * tx) * ty; if (v > bv) { bv = v; best = k; } }
      cls[y * width + x] = best;
    }
  }
  fs.writeFileSync(path.join(cache, `${e.id}.cls`), cls);
  const w = new Uint8Array(width * height), c = new Uint8Array(width * height);
  for (let i = 0; i < cls.length; i++) { if (cls[i] === 1) w[i] = 1; else if (cls[i] === 2) c[i] = 1; }
  const res = { id: e.id, split: e.split, ms: Math.round(performance.now() - t0), pared: score(w, lab, WALL, WALL_ANY), techo: score(c, lab, CEIL, CEIL) };
  fs.appendFileSync(outFile, JSON.stringify(res) + '\n');
  console.log(e.id, `${res.ms} ms | pared IoU ${res.pared.iou?.toFixed(2)} rec ${res.pared.recall?.toFixed(2)} deMás ${res.pared.deMas?.toFixed(2)} | techo IoU ${res.techo.iou?.toFixed(2)} rec ${res.techo.recall?.toFixed(2)}`);
}
