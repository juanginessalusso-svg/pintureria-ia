// Evaluación del visualizador con el PIPELINE REAL (MobileSAM + recoloreo), sin navegador.
// Uso:  MODELS_DIR=ruta/a/modelos node eval/visualizador/run.mjs [casos.json] [filtro]
// Lee fotos de eval/visualizador/fotos (ignoradas por git) y deja en eval/visualizador/salidas un PNG por caso:
//   [ original | selección | color 1 | color 2 ... ]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { estimateWhiteBalance, featherMask, maskFraction, recolorWall, cleanMask, unionMasks } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const casosFile = process.argv[2] ?? path.join(here, 'casos.json');
const filtro = process.argv[3];
const modelsDir = process.env.MODELS_DIR;
if (!modelsDir) { console.error('Falta MODELS_DIR'); process.exit(2); }
const outDir = path.join(here, 'salidas');
fs.mkdirSync(outDir, { recursive: true });

/** Redimensiona RGBA con interpolación bilineal. */
function resize(src, w, h, nw, nh) {
  if (w === nw && h === nh) return src;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, ((y + 0.5) * h) / nh - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, ((x + 0.5) * w) / nw - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
      for (let c = 0; c < 4; c++) {
        const a = src[(y0 * w + x0) * 4 + c], b = src[(y0 * w + x1) * 4 + c], d = src[(y1 * w + x0) * 4 + c], e = src[(y1 * w + x1) * 4 + c];
        out[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

function tint(img, mask) {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    const q = i * 4;
    d[q] = d[q] * 0.5 + 31 * 0.5; d[q + 1] = d[q + 1] * 0.5 + 111 * 0.5; d[q + 2] = d[q + 2] * 0.5 + 235 * 0.5;
  }
  return { data: d, width: img.width, height: img.height };
}

function strip(images, H = 640) {
  const scaled = images.map((im) => { const w = Math.round((im.width * H) / im.height); return { w, data: resize(im.data, im.width, im.height, w, H) }; });
  const gap = 8, W = scaled.reduce((s, i) => s + i.w, 0) + gap * (scaled.length - 1);
  const out = new Uint8ClampedArray(W * H * 4).fill(255);
  let x0 = 0;
  for (const s of scaled) {
    for (let y = 0; y < H; y++) out.set(s.data.subarray(y * s.w * 4, (y + 1) * s.w * 4), (y * W + x0) * 4);
    x0 += s.w + gap;
  }
  return { width: W, height: H, data: out };
}

const read = (f) => new Uint8Array(fs.readFileSync(path.join(modelsDir, f)));
ort.env.wasm.numThreads = 1;
const sam = await Sam.create(ort, { encoder: read('mobile_sam_image_encoder.onnx'), decoder: read('sam_mask_decoder_single.onnx') });

const casos = JSON.parse(fs.readFileSync(casosFile, 'utf8'));
const porFoto = Map.groupBy(casos.filter((c) => !filtro || c.id.includes(filtro)), (c) => c.foto);

for (const [foto, lista] of porFoto) {
  const raw = jpeg.decode(fs.readFileSync(path.join(here, 'fotos', foto)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const gains = estimateWhiteBalance(img);
  const { width: rw, height: rh } = encoderSize(width, height);
  const t0 = performance.now();
  await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
  console.log(`\n${foto} ${width}x${height}  análisis ${Math.round(performance.now() - t0)} ms  WB=[${gains.map((g) => g.toFixed(2)).join(', ')}]`);

  for (const caso of lista) {
    const masks = [];
    for (const grupo of caso.paredes) { // cada "pared" es un conjunto de toques [x,y,label] relativos (0..1)
      sam.reset();
      const pts = grupo.map(([x, y, label]) => ({ x: x * width, y: y * height, label }));
      let last;
      for (let i = 1; i <= pts.length; i++) last = await sam.segment(pts.slice(0, i)); // clic a clic, como la app
      // mismo post-proceso que la app: apertura + sacar islas chicas
      masks.push(Float32Array.from(cleanMask(last.mask, width, height)));
    }
    const union = unionMasks(masks, width * height);
    const soft = featherMask(union, width, height, Math.max(1, Math.round(width / 500)));
    const frac = maskFraction(union);
    const vistas = [img, tint(img, union)];
    const resumen = [];
    for (const col of caso.colores) {
      for (const mode of caso.modos ?? ['relative']) {
        const r = recolorWall(img, soft, col.hex, { mode, gains });
        vistas.push(r.image);
        resumen.push(`${col.nombre}/${mode} (L pared ${r.wallMeanL.toFixed(0)} → ${r.targetL.toFixed(0)})`);
      }
    }
    const png = PNG.sync.write({ ...strip(vistas), data: Buffer.from(strip(vistas).data) });
    const file = path.join(outDir, `${caso.id}.png`);
    fs.writeFileSync(file, png);
    console.log(`  ${caso.id}: pared = ${(frac * 100).toFixed(1)}% de la foto · ${resumen.join(' · ')}\n    -> ${path.relative(process.cwd(), file)}`);
  }
}
