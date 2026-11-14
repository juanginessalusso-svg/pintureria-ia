// Anotación asistida, paso 1: parte una foto en pedazos con SAM (grilla de puntos) y sugiere qué es cada uno con el modelo propio.
// Deja en OUT/<foto>/: foto.jpg (tamaño de trabajo), segs.png (id de pedazo por píxel, 0 = sin pedazo) y pedazos.json
// ([{id, area, x, y, sugerencia: 'p'|'t'|'n'}]). El dibujo con números lo hace numerar.py.
// Uso: MODELS_DIR=... SEG_MODEL=modelo.onnx [SEG_SIZE=320] [GRILLA=14] OUT=dir node eval/visualizador/partir.mjs <foto>
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
import { runSegmenter } from '../../apps/web/src/seg.js';
import { cleanMask, componentes, distanciaInterior, CLASE } from '@pintureria/core';

const file = process.argv[2];
if (!file || !process.env.MODELS_DIR || !process.env.OUT) { console.error('Uso: MODELS_DIR=... OUT=dir node partir.mjs <foto>'); process.exit(2); }
const G = Number(process.env.GRILLA ?? 14), MIN = Number(process.env.MIN_FRAC ?? 0.003), MAX_PEDAZOS = 60;
const name = path.basename(file).replace(/\.\w+$/, ''), out = path.join(process.env.OUT, name);
fs.mkdirSync(out, { recursive: true });

function resize(s, w, h, nw, nh) {
  if (w === nw && h === nh) return s;
  const o = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
      for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; }
    }
  }
  return o;
}
const bytes = fs.readFileSync(file);
const raw = /\.png$/i.test(file) ? PNG.sync.read(bytes) : jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
const { width: W, height: H } = workingSize(raw.width, raw.height), N = W * H;
const data = new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, W, H));
fs.writeFileSync(path.join(out, 'foto.jpg'), jpeg.encode({ data, width: W, height: H }, 92).data);

const ort = await import('onnxruntime-web/wasm'); const { Sam } = await import('../../apps/web/src/sam.js'); ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(f));
const sam = await Sam.create(ort, { encoder: rd(path.join(process.env.MODELS_DIR, 'mobile_sam_image_encoder.onnx')), decoder: rd(path.join(process.env.MODELS_DIR, 'sam_mask_decoder_single.onnx')) });
{ const { width: rw, height: rh } = encoderSize(W, H); await sam.embed(rgbaToRgbFloat(resize(data, W, H, rw, rh), rw, rh), rw, rh, W, H); }

let classMap = null;
if (process.env.SEG_MODEL) {
  const sess = await ort.InferenceSession.create(rd(process.env.SEG_MODEL), { executionProviders: ['wasm'] }), S = Number(process.env.SEG_SIZE ?? 320);
  classMap = await runSegmenter(ort, sess, resize(data, W, H, S, S), S, W, H);
}

// 1) una máscara de SAM por punto de la grilla (sin repetir las casi iguales)
const mascaras = [];
for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
  const x = ((gx + .5) / G) * W, y = ((gy + .5) / G) * H;
  sam.reset();
  const m = cleanMask((await sam.segment([{ x, y, label: 1 }])).mask, W, H);
  let a = 0; for (let i = 0; i < N; i++) if (m[i]) a++;
  if (a < MIN * N || a > 0.9 * N) continue;
  let igual = false;
  for (const o of mascaras) { let inter = 0; for (let i = 0; i < N; i++) if (m[i] && o.m[i]) inter++; if (inter / (a + o.a - inter) > 0.85) { igual = true; break; } }
  if (!igual) mascaras.push({ m, a });
}
// 2) de la más chica a la más grande: cada píxel queda en el pedazo más chico que lo contiene (así una puerta no se la come la pared)
mascaras.sort((p, q) => p.a - q.a);
const seg = new Uint8Array(N); let id = 0;
for (const { m } of mascaras) {
  if (id >= MAX_PEDAZOS) break;
  let libre = 0; for (let i = 0; i < N; i++) if (m[i] && !seg[i]) libre++;
  if (libre < MIN * N) continue;
  id++; for (let i = 0; i < N; i++) if (m[i] && !seg[i]) seg[i] = id;
}
// 3) cada pedazo: área, punto para el número (el más adentro de su parte más grande) y sugerencia del modelo
const pedazos = [];
for (let k = 1; k <= id; k++) {
  const mk = new Uint8Array(N); let a = 0; const cuenta = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) if (seg[i] === k) { mk[i] = 1; a++; if (classMap) cuenta[classMap[i]]++; }
  if (!a) continue;
  const c = componentes(mk, W, H).comps.sort((p, q) => q.area - p.area)[0];
  const { d, bw, x0, y0 } = distanciaInterior(c, W, H);
  let best = -1, bx = 0, by = 0; for (let j = 0; j < d.length; j++) if (d[j] > best) { best = d[j]; bx = x0 + (j % bw); by = y0 + ((j / bw) | 0); }
  const sug = !classMap ? 'n' : cuenta[CLASE.pared] / a > 0.5 ? 'p' : cuenta[CLASE.techo] / a > 0.5 ? 't' : 'n';
  pedazos.push({ id: k, area: +(a / N).toFixed(4), x: bx, y: by, sugerencia: sug });
}
let libres = 0; for (let i = 0; i < N; i++) if (!seg[i]) libres++;
fs.writeFileSync(path.join(out, 'segs.png'), PNG.sync.write(Object.assign(new PNG({ width: W, height: H }), { data: Buffer.from(Uint8Array.from({ length: N * 4 }, (_, j) => (j % 4 === 3 ? 255 : seg[j >> 2]))) })));
fs.writeFileSync(path.join(out, 'pedazos.json'), JSON.stringify({ foto: name, W, H, sinPedazo: +(libres / N).toFixed(4), pedazos }, null, 1));
console.log(`${name}: ${pedazos.length} pedazos (${mascaras.length} máscaras de SAM), ${(100 * libres / N).toFixed(1)} % sin pedazo`);
