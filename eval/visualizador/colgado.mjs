// Diagnóstico de cuelgues: corre detectSurfaces y loguea cada decodificación de SAM (si se corta el log y el proceso sigue, el cuelgue es JS puro entre decodificaciones).
// Uso: MODELS_DIR=... node eval/visualizador/colgado.mjs <foto en fotos/>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web/wasm';
import { cleanMask, detectSurfaces } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const raw = jpeg.decode(fs.readFileSync(path.join(here, 'fotos', process.argv[2])), { useTArray: true, formatAsRGBA: true });
const { width, height } = workingSize(raw.width, raw.height);
function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
const sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
const { width: rw, height: rh } = encoderSize(width, height);
await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
let n = 0, t = performance.now();
console.error(`${process.argv[2]} ${width}x${height}`);
const out = await detectSurfaces(img, async (pts) => {
  console.error(`  decodificación ${n++} (+${Math.round(performance.now() - t)} ms desde la anterior) pts=${pts.length}`); t = performance.now();
  sam.reset(); const r = await sam.segment(pts.map((q) => ({ x: q.x, y: q.y, label: 1 }))); return cleanMask(r.mask, width, height);
});
console.error(`listo: ${out.length} superficies, ${n} decodificaciones`);
