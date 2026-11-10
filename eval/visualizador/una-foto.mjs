// Ciclo "una foto por vez": corre la detección REAL de la app (runDetect, modo auto) sobre UNA foto y deja
// salidas/una-<foto>.png = [ original | superficies ] y un resumen por consola (qué ofreció y qué descartó).
// Uso: MODELS_DIR=... node eval/visualizador/con-candado.mjs node eval/visualizador/una-foto.mjs <ruta-foto> [modo: auto|interior|fachada]
// Env: OPTS='{"opcion":true}' (opciones para detectSurfaces), CACHE=dir (cachea las decodificaciones de SAM: repetir sin SAM tras cambiar reglas),
//      OUT=dir (donde dejar el PNG; por defecto eval/visualizador/salidas).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
import { runDetect } from '../../apps/web/src/detect.js';
import { runSegmenter } from '../../apps/web/src/seg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2], mode = process.argv[3] ?? 'auto';
if (!file || !process.env.MODELS_DIR) { console.error('Uso: MODELS_DIR=... node una-foto.mjs <foto> [modo]'); process.exit(2); }
const OPTS = process.env.OPTS ? JSON.parse(process.env.OPTS) : {};
if (process.env.DEBUG_RECTAS) OPTS.debugRectas = (i) => console.log('  [rectas]', JSON.stringify(i));
if (process.env.DEBUG_CORNER) OPTS.debugCorner = (i) => console.log('  [esquina]', JSON.stringify({ x: i.x, med: +i.med?.toFixed?.(1), n: i.n, frac: +i.frac?.toFixed?.(2), cov: +i.cov?.toFixed?.(2), spread: i.spread, tilt: +i.tilt?.toFixed?.(3), why: i.why }));
if (process.env.DEBUG_RECTAS) OPTS.debugSombras = (i) => console.log('  [sombras]', JSON.stringify(i));
const cacheDir = process.env.CACHE, outDir = process.env.OUT ?? path.join(here, 'salidas');
fs.mkdirSync(outDir, { recursive: true }); if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
const name = path.basename(file).replace(/\.\w+$/, '');

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
const { width, height } = workingSize(raw.width, raw.height);
const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };

let sam = null, embedded = false;
async function getSam() {
  if (!sam) {
    const ort = await import('onnxruntime-web/wasm'); const { Sam } = await import('../../apps/web/src/sam.js'); ort.env.wasm.numThreads = 1;
    const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
    sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
  }
  if (!embedded) { embedded = true; const { width: rw, height: rh } = encoderSize(width, height); await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height); }
  return sam;
}
let decodes = 0, misses = 0;
const segment = async (pts) => {
  decodes++;
  const key = cacheDir ? path.join(cacheDir, `${name}-${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('_')}.gz`) : null;
  if (key && fs.existsSync(key)) return { mask: new Uint8Array(zlib.gunzipSync(fs.readFileSync(key))) };
  misses++;
  const s = await getSam(); s.reset();
  const r = await s.segment(pts);
  if (key) fs.writeFileSync(key, zlib.gzipSync(Buffer.from(r.mask)));
  return r;
};
// SEG_MODEL=ruta.onnx (SEG_SIZE=256): mapa de clases del segmentador propio como guía de SAM (igual que ?modelo=1 en la app)
let classMap = null, instancias = null;
if (process.env.SEG_MODEL) {
  const ort2 = await import('onnxruntime-web/wasm'); ort2.env.wasm.numThreads = 1;
  const sess = await ort2.InferenceSession.create(new Uint8Array(fs.readFileSync(process.env.SEG_MODEL)), { executionProviders: ['wasm'] }), S = Number(process.env.SEG_SIZE ?? 256);
  classMap = await runSegmenter(ort2, sess, resize(img.data, width, height, S, S), S, width, height);
}
// CLASSMAP_PNG=ruta.png: mapa de clases del servidor SAM 3 + r9 (PNG 0 otro / 1 pared / 2 techo), igual que ?servidor= en la app
if (process.env.CLASSMAP_PNG) {
  const p = PNG.sync.read(fs.readFileSync(process.env.CLASSMAP_PNG)); classMap = new Uint8Array(width * height); instancias = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(p.width - 1, Math.floor((x + 0.5) * p.width / width)), sy = Math.min(p.height - 1, Math.floor((y + 0.5) * p.height / height));
    classMap[y * width + x] = p.data[(sy * p.width + sx) * 4]; instancias[y * width + x] = p.data[(sy * p.width + sx) * 4 + 1]; // G = número de pared (PNG RGB del servidor)
  }
  if (!instancias.some((v, i) => v !== classMap[i])) instancias = null; // PNG gris: no trae instancias
}
const t0 = performance.now();
const res = await runDetect({ image: img, segment, opts: OPTS, mode, mergeTecho: !!OPTS.mergeTecho, classMap, instancias });
const { found } = res;
console.log(`${name}: modo ${res.mode} · ${found.length} superficies · ${decodes} decodificaciones (${misses} sin caché) · ${Math.round(performance.now() - t0)} ms`);
const COL = { pared: [230, 57, 70], techo: [60, 120, 255], ladrillo: [244, 162, 97], cielo: [69, 123, 157], piso: [42, 157, 143] };
const FALLBACK = [[155, 93, 229], [255, 209, 102], [0, 200, 255]];
const out = new PNG({ width: width * 2, height });
const over = new Uint8ClampedArray(img.data);
found.forEach((f, k) => {
  const c = COL[f.kind] ?? FALLBACK[k % 3];
  let n = 0; for (let i = 0; i < f.mask.length; i++) if (f.mask[i]) { n++; for (let j = 0; j < 3; j++) over[i * 4 + j] = Math.round(over[i * 4 + j] * 0.4 + c[j] * 0.6); }
  console.log(`  - ${f.kind.padEnd(8)} ${String(f.name ?? '').padEnd(22)} ${(100 * n / f.mask.length).toFixed(1)} % de la foto`);
});
for (const r of found.rechazadas ?? res.rechazadas ?? []) console.log(`  x descartada: ${r.why ?? JSON.stringify(r)}`);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let j = 0; j < 4; j++) { out.data[(y * width * 2 + x) * 4 + j] = img.data[(y * width + x) * 4 + j]; out.data[(y * width * 2 + width + x) * 4 + j] = j === 3 ? 255 : over[(y * width + x) * 4 + j]; }
const outFile = path.join(outDir, `una-${name}.png`);
fs.writeFileSync(outFile, PNG.sync.write(out));
console.log('→', outFile);
// PINTAR="#pared[|#pared2|...],#techo[;...]" (con | un color por pared): además deja pintado-<foto>-<k>.png pintado como en la app (modo 'luz', balance de blancos al 50 %, borde suavizado)
if (process.env.PINTAR) {
  const { estimateWhiteBalance, featherMask, recolorWall, LUZ_WB_STRENGTH } = await import('@pintureria/core');
  const gains = estimateWhiteBalance(img).map((g) => 1 + (g - 1) * LUZ_WB_STRENGTH);
  process.env.PINTAR.split(';').forEach((par, k) => {
    const [hp, ht] = par.split(',');
    let image = img, np = 0; const paredes = hp.split('|'); // "#a|#b|#c": un color por pared, en el orden de la lista
    for (const f of found) {
      const hex = f.kind === 'techo' ? ht : f.kind === 'pared' ? paredes[np++ % paredes.length] : null; if (!hex) continue;
      const soft = featherMask(Float32Array.from(f.mask), width, height, Math.max(1, Math.round(width / 500)));
      image = recolorWall(image, soft, hex, { mode: 'luz', gains }).image;
    }
    const o = new PNG({ width, height }); o.data.set(image.data); for (let i = 3; i < o.data.length; i += 4) o.data[i] = 255;
    const f2 = path.join(outDir, `pintado-${name}-${k + 1}.png`); fs.writeFileSync(f2, PNG.sync.write(o)); console.log('→', f2);
  });
}
