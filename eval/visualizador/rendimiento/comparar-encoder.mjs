// Compara dos encoders ONNX (p. ej. fp32 vs int8) sobre una foto real: tiempo, similitud coseno de los embeddings y
// IoU de las máscaras que salen de 9 puntos en grilla con el decoder real.
// Uso: MODELS_DIR=./modelos node eval/visualizador/rendimiento/comparar-encoder.mjs <foto.jpg> <encoder-alternativo.onnx>
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web/wasm';
import { Sam, encoderSize, rgbaToRgbFloat } from '../../../apps/web/src/sam.js';

const [foto, altPath] = process.argv.slice(2);
const dir = process.env.MODELS_DIR;
ort.env.wasm.numThreads = 1;
const img = jpeg.decode(fs.readFileSync(foto), { useTArray: true });
const { width: rw, height: rh } = encoderSize(img.width, img.height);

function resize(src, w, h, nw, nh) { // vecino más cercano alcanza para esta comparación (ambos modelos ven la misma entrada)
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(w - 1, Math.floor((x * w) / nw)), sy = Math.min(h - 1, Math.floor((y * h) / nh));
    for (let c = 0; c < 4; c++) out[(y * nw + x) * 4 + c] = src[(sy * w + sx) * 4 + c];
  }
  return out;
}
const rgb = rgbaToRgbFloat(resize(img.data, img.width, img.height, rw, rh), rw, rh);
const decoder = new Uint8Array(fs.readFileSync(path.join(dir, 'sam_mask_decoder_single.onnx')));

async function run(encPath) {
  const sam = await Sam.create(ort, { encoder: new Uint8Array(fs.readFileSync(encPath)), decoder });
  const t0 = performance.now();
  await sam.embed(rgb, rw, rh, img.width, img.height);
  const encMs = Math.round(performance.now() - t0);
  const masks = [];
  for (const fy of [0.25, 0.5, 0.75]) for (const fx of [0.25, 0.5, 0.75]) {
    const { mask } = await sam.segment([{ x: fx * img.width, y: fy * img.height, label: 1 }]);
    masks.push(new Uint8Array(mask));
  }
  return { encMs, emb: Float32Array.from(sam.embeddings.data), masks };
}

const a = await run(path.join(dir, 'mobile_sam_image_encoder.onnx'));
const b = await run(altPath);
let dot = 0, na = 0, nb = 0;
for (let i = 0; i < a.emb.length; i++) { dot += a.emb[i] * b.emb[i]; na += a.emb[i] ** 2; nb += b.emb[i] ** 2; }
const ious = a.masks.map((m, k) => {
  let inter = 0, uni = 0;
  for (let i = 0; i < m.length; i++) { const p = m[i] > 0, q = b.masks[k][i] > 0; if (p && q) inter++; if (p || q) uni++; }
  return uni ? +(inter / uni).toFixed(3) : 1;
});
console.log(JSON.stringify({ fp32Ms: a.encMs, altMs: b.encMs, cosenoEmbeddings: +(dot / Math.sqrt(na * nb)).toFixed(4), iouMascaras: ious, iouMedio: +(ious.reduce((s, v) => s + v, 0) / ious.length).toFixed(3) }));
