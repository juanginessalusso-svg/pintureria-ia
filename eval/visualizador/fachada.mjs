// Evaluación del detector de FACHADAS con SAM real.
// Uso: MODELS_DIR=./modelos node eval/visualizador/fachada.mjs [filtro] [--regiones]
//  --regiones  solo vuelca las estadísticas por región (para calibrar reglas), sin clasificar.
// Cachea las regiones de SAM en salidas/regiones/<foto>.json (la grilla es lo caro: ~10 s de encoder + ~0,7 s por semilla).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { facadeRegions, regionStats, facadeSurfaces } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const filtro = args[0] ?? 'fachada-0';
const outDir = path.join(here, 'salidas'), cacheDir = path.join(outDir, 'regiones');
fs.mkdirSync(cacheDir, { recursive: true });

function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
export function loadPhoto(file) {
  const buf = fs.readFileSync(file);
  const raw = /\.png$/i.test(file) ? PNG.sync.read(buf) : jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  return { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
}

let sam = null;
async function getSam() {
  if (sam) return sam;
  ort.env.wasm.numThreads = 1;
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
  sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
  return sam;
}

/** Regiones de una foto (con caché en disco, clave = nombre + tamaño + grilla). */
export async function regionesDe(foto, img, { nx = 6, ny = 4 } = {}) {
  const key = path.join(cacheDir, `${foto}.${img.width}x${img.height}.${nx}x${ny}`);
  if (fs.existsSync(key + '.json') && fs.existsSync(key + '.bin')) {
    const b = fs.readFileSync(key + '.bin');
    return { width: img.width, height: img.height, labels: new Int16Array(b.buffer, b.byteOffset, b.length / 2).slice(), seeds: JSON.parse(fs.readFileSync(key + '.json', 'utf8')) };
  }
  const s = await getSam();
  const { width: rw, height: rh } = encoderSize(img.width, img.height);
  await s.embed(rgbaToRgbFloat(resize(img.data, img.width, img.height, rw, rh), rw, rh), rw, rh, img.width, img.height);
  const reg = await facadeRegions(img, async (pts) => { s.reset(); return (await s.segment(pts)).mask; }, { nx, ny });
  fs.writeFileSync(key + '.bin', Buffer.from(reg.labels.buffer, reg.labels.byteOffset, reg.labels.byteLength));
  fs.writeFileSync(key + '.json', JSON.stringify(reg.seeds));
  return reg;
}

// ---- dibujo mínimo para ver las regiones numeradas ----
const DIG = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111' };
const colorOf = (id) => { const h = (id * 137.5) % 360, s = 0.6, v = 0.95; const f = (n) => { const kk = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1)); }; return [f(5), f(3), f(1)].map((x) => Math.round(x * 255)); };

function dibujarRegiones(img, reg, stats, outFile) {
  const { width, height, labels } = reg;
  const S = Math.max(1, Math.round(width / 700)), ow = Math.floor(width / S), oh = Math.floor(height / S);
  const png = new PNG({ width: ow * 2 + 8, height: oh }); png.data.fill(255);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const q = y * S * width + x * S, p = q * 4, o = (y * png.width + x) * 4, o2 = (y * png.width + ow + 8 + x) * 4, c = labels[q] >= 0 ? colorOf(labels[q]) : [30, 30, 30];
    for (let k = 0; k < 3; k++) { png.data[o + k] = img.data[p + k]; png.data[o2 + k] = Math.round(c[k] * 0.75 + img.data[p + k] * 0.25); }
    png.data[o + 3] = png.data[o2 + 3] = 255;
  }
  const put = (px, py) => { if (px >= 0 && py >= 0 && px < png.width && py < oh) { const o = (py * png.width + px) * 4; png.data[o] = png.data[o + 1] = png.data[o + 2] = 0; } };
  for (const s of stats) {
    if (!s.n || s.frac < 0.01) continue;
    const t = String(s.k), cx = Math.round(s.cx * ow) + ow + 8 - (t.length * 4 * 2), cy = Math.round(s.cy * oh) - 5;
    t.split('').forEach((d, i) => { for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (DIG[d][r * 3 + c] === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(cx + i * 8 + c * 2 + dx, cy + r * 2 + dy); });
  }
  fs.writeFileSync(outFile, PNG.sync.write(png));
}

function dibujarSuperficies(img, found, outFile) {
  const { width, height, data } = img, S = Math.max(1, Math.round(width / 700)), ow = Math.floor(width / S), oh = Math.floor(height / S);
  const png = new PNG({ width: ow, height: oh }), tint = { pared: [40, 200, 80], ladrillo: [240, 140, 30] };
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const q = y * S * width + x * S, o = (y * ow + x) * 4; let c = null;
    for (const f of found) if (f.mask[q]) { c = tint[f.kind]; break; }
    for (let k = 0; k < 3; k++) png.data[o + k] = c ? Math.round(data[q * 4 + k] * 0.4 + c[k] * 0.6) : data[q * 4 + k];
    png.data[o + 3] = 255;
  }
  fs.writeFileSync(outFile, PNG.sync.write(png));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fotos = fs.readdirSync(path.join(here, 'fotos')).filter((f) => /\.(jpe?g|png)$/i.test(f) && f.includes(filtro)).sort();
  for (const foto of fotos) {
    const img = loadPhoto(path.join(here, 'fotos', foto));
    const t0 = performance.now();
    const reg = await regionesDe(foto, img);
    const stats = regionStats(reg, img).filter((s) => s.n && s.frac >= 0.01).sort((a, b) => b.frac - a.frac);
    console.log(`\n${foto} ${img.width}x${img.height}  regiones ${Math.round(performance.now() - t0)} ms`);
    console.log('  id   área    cx   cy  top→bottom   L    a    b   croma azul  luma  textura  bordes');
    for (const s of stats) console.log(`  ${String(s.k).padStart(2)}  ${(s.frac * 100).toFixed(1).padStart(5)}%  ${s.cx.toFixed(2)} ${s.cy.toFixed(2)}  ${s.top.toFixed(2)}→${s.bottom.toFixed(2)}  ${s.L.toFixed(0).padStart(3)} ${String(Math.round(s.a)).padStart(4)} ${String(Math.round(s.b)).padStart(4)}  ${s.chroma.toFixed(0).padStart(4)}  ${s.blue.toFixed(2).padStart(5)} ${s.luma.toFixed(0).padStart(4)}  ${s.texture.toFixed(3)}   ${[s.touchesTop && 'T', s.touchesBottom && 'B', s.touchesLeft && 'L', s.touchesRight && 'R'].filter(Boolean).join('')}`);
    dibujarRegiones(img, reg, stats, path.join(outDir, `regiones-${foto.replace(/\.\w+$/, '')}.png`));
    if (flags.has('--regiones')) continue;
    const t1 = performance.now(), found = facadeSurfaces(img, reg);
    console.log(`  → ${found.length} superficies en ${Math.round(performance.now() - t1)} ms`);
    for (const f of found) console.log(`    ${f.kind.padEnd(8)} ${f.name.padEnd(18)} ${(f.area * 100).toFixed(1)}%  grad50 ${f.grad50}`);
    for (const r of found.rechazadas) console.log(`    (descartada) ${r.name} ${(r.area * 100).toFixed(1)}% · ${r.motivo}`);
    dibujarSuperficies(img, found, path.join(outDir, `fachada-${foto.replace(/\.\w+$/, '')}.png`));
  }
}
