// Anotación asistida, corrección: dentro del pedazo K, SAM recorta lo que hay bajo cada punto (x,y en píxeles de foto.jpg) y lo
// convierte en un pedazo nuevo (p. ej. la pared que se ve entre los caños de una silla). Actualiza segs.png y pedazos.json.
// Uso: MODELS_DIR=... node eval/visualizador/recortar-pedazo.mjs <carpeta de la foto> <K> "x,y;x,y" [sugerencia p|t|n]
//      o con "grilla" en vez de puntos: subdivide el pedazo K con una grilla fina de puntos dentro de él (para objetos calados).
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { encoderSize, rgbaToRgbFloat } from '../../apps/web/src/sam.js';
import { cleanMask } from '@pintureria/core';

const [dir, kArg, ptsArg, sug = 'p'] = process.argv.slice(2);
const K = Number(kArg);
const img = jpeg.decode(fs.readFileSync(path.join(dir, 'foto.jpg')), { useTArray: true, formatAsRGBA: true });
const W = img.width, H = img.height, N = W * H;
const segPng = PNG.sync.read(fs.readFileSync(path.join(dir, 'segs.png')));
const seg = new Uint8Array(N); for (let i = 0; i < N; i++) seg[i] = segPng.data[i * 4];
const info = JSON.parse(fs.readFileSync(path.join(dir, 'pedazos.json'), 'utf8'));

function resize(s, w, h, nw, nh) {
  const o = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const sx = Math.min(w - 1, Math.floor(((x + .5) * w) / nw)), sy = Math.min(h - 1, Math.floor(((y + .5) * h) / nh)); for (let c = 0; c < 4; c++) o[(y * nw + x) * 4 + c] = s[(sy * w + sx) * 4 + c]; }
  return o;
}
const ort = await import('onnxruntime-web/wasm'); const { Sam } = await import('../../apps/web/src/sam.js'); ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
const sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
{ const { width: rw, height: rh } = encoderSize(W, H); await sam.embed(rgbaToRgbFloat(resize(img.data, W, H, rw, rh), rw, rh), rw, rh, W, H); }

let pts;
if (ptsArg === 'grilla') {
  let x0 = W, y0 = H, x1 = 0, y1 = 0; for (let i = 0; i < N; i++) if (seg[i] === K) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  pts = []; const paso = Math.max(6, Math.round(Math.max(x1 - x0, y1 - y0) / 18));
  for (let y = y0 + paso / 2; y <= y1; y += paso) for (let x = x0 + paso / 2; x <= x1; x += paso) { const xi = Math.round(x), yi = Math.round(y); if (seg[yi * W + xi] === K) pts.push([xi, yi]); }
  console.log(`grilla: ${pts.length} puntos dentro del pedazo ${K}`);
} else pts = ptsArg.split(';').map((s) => s.split(',').map(Number));
const MIN = Number(process.env.MIN_PX ?? 120);
let next = Math.max(0, ...info.pedazos.map((p) => p.id)) + 1;
for (const [x, y] of pts) {
  sam.reset();
  const m = cleanMask((await sam.segment([{ x, y, label: 1 }])).mask, W, H);
  if (seg[y * W + x] !== K) continue; // el punto ya quedó en otro pedazo nuevo
  let a = 0; for (let i = 0; i < N; i++) if (m[i] && seg[i] === K) a++;
  if (a < MIN || a > 0.85 * [...seg].filter((v) => v === K).length) continue; // nada, o casi todo el pedazo (no subdivide)
  for (let i = 0; i < N; i++) if (m[i] && seg[i] === K) seg[i] = next;
  info.pedazos.push({ id: next, area: +(a / N).toFixed(4), x, y, sugerencia: sug, de: K });
  console.log(`(${x},${y}): pedazo nuevo ${next} con ${a} px`);
  next++;
}
const outPng = new PNG({ width: W, height: H }); for (let i = 0; i < N; i++) { outPng.data[i * 4] = outPng.data[i * 4 + 1] = outPng.data[i * 4 + 2] = seg[i]; outPng.data[i * 4 + 3] = 255; }
fs.writeFileSync(path.join(dir, 'segs.png'), PNG.sync.write(outPng));
fs.writeFileSync(path.join(dir, 'pedazos.json'), JSON.stringify(info, null, 1));
