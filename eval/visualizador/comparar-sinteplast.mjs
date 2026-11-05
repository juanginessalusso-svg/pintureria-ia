// Pinta una foto con 3 colores dados (techo, pared izquierda, pared derecha) con NUESTRO motor y la deja al lado de la captura del decorador de Sinteplast.
// Uso: MODELS_DIR=... node comparar-sinteplast.mjs <foto en fotos/> <captura.jpg> <salida.png>   (colores en TECHO/IZQ/DER como r,g,b)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { featherMask, recolorWall, estimateWhiteBalance } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
import { runDetect } from '../../apps/web/src/detect.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const [foto, captura, out] = process.argv.slice(2);
const hex = (s) => '#' + s.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('');
const COL = { techo: process.env.TECHO, izq: process.env.IZQ, der: process.env.DER };
function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
const raw = jpeg.decode(fs.readFileSync(path.join(here, 'fotos', foto)), { useTArray: true, formatAsRGBA: true });
const { width, height } = workingSize(raw.width, raw.height);
const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
const sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
const { width: rw, height: rh } = encoderSize(width, height);
await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
const { found } = await runDetect({ image: img, segment: (p) => { sam.reset(); return sam.segment(p); }, mode: 'interior' });
console.log(found.map((f) => `${f.name} ${(f.area * 100).toFixed(1)}%`).join(' · '));
const gains = process.env.NOWB ? [1, 1, 1] : estimateWhiteBalance(img), res = {};
for (const modo of ['relative', 'pure']) {
  let cur = img; const medias = {};
  for (const f of found) {
    const key = f.kind === 'techo' ? 'techo' : /izq/i.test(f.name) ? 'izq' : /der/i.test(f.name) ? 'der' : null;
    if (!key || !COL[key]) continue;
    cur = recolorWall(cur, featherMask(Float32Array.from(f.mask), width, height, Math.max(1, Math.round(width / 500))), hex(COL[key]), { mode: modo, gains }).image;
    let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < f.mask.length; i++) if (f.mask[i]) { r += cur.data[i * 4]; g += cur.data[i * 4 + 1]; b += cur.data[i * 4 + 2]; n++; }
    medias[key] = [r, g, b].map((v) => Math.round(v / n)).join(',');
  }
  res[modo] = cur; console.log(modo, 'medias pintadas:', JSON.stringify(medias));
}
// composición: [captura Sinteplast recortada a la foto | ours relative | ours pure]
const cap = jpeg.decode(fs.readFileSync(captura), { useTArray: true, formatAsRGBA: true }), sc = cap.width / 576;
const cx0 = Math.round(22 * sc), cy0 = Math.round(170 * sc), cw = Math.round(533 * sc), ch = Math.round(711 * sc), H = 640, W = Math.round((H * width) / height);
const tile = (d, w, h, x0, y0, cw2, ch2) => { const o = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const sx = Math.min(w - 1, x0 + Math.floor((x / W) * cw2)), sy = Math.min(h - 1, y0 + Math.floor((y / H) * ch2)); for (let c = 0; c < 4; c++) o[(y * W + x) * 4 + c] = d[(sy * w + sx) * 4 + c]; } return o; };
const png = new PNG({ width: W * 3 + 16, height: H }); png.data.fill(255);
[[tile(cap.data, cap.width, cap.height, cx0, cy0, cw, ch), 0], [tile(res.relative.data, width, height, 0, 0, width, height), W + 8], [tile(res.pure.data, width, height, 0, 0, width, height), 2 * W + 16]].forEach(([t, ox]) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) png.data[(y * png.width + ox + x) * 4 + c] = t[(y * W + x) * 4 + c]; });
fs.writeFileSync(out, PNG.sync.write(png));
