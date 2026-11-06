// Compara NUESTRO recoloreo con el render de Sinteplast para varias fotos (pares).
// Config JSON: [{ foto, theirs, crop:[x0,y0,w,h] (px de la captura), superficies:[{ nombre, en:[nx,ny], swatch:'r,g,b' }] }]
// Por superficie: ΔE00 contra el swatch de (a) el render de Sinteplast, (b) el nuestro con balance de blancos y (c) sin él.
// Además el IoU entre lo que pintamos y lo que cambió Sinteplast. Uso interno: las capturas no se versionan.
// Uso: MODELS_DIR=... node comparar-par.mjs <config.json> <carpeta salida>
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { refineByColor, featherMask, recolorWall, estimateWhiteBalance, rgbToLab, deltaE00 } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';
import { runDetect } from '../../apps/web/src/detect.js';
import { deltaEMap, changedMask, edgeMetrics, globalIoU, renderedSurfaceMask, aggregate } from './metrica-bordes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FOTOS = process.env.FOTOS_DIR ?? path.join(here, 'fotos'); // FOTOS_DIR: carpeta con las fotos originales (en un worktree no existe fotos/)
const CACHE = process.env.PARES_CACHE ?? null; // PARES_CACHE: carpeta donde guardar/leer las máscaras detectadas; con caché NO hace falta SAM (ni el candado)
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const hex = (s) => '#' + s.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('');

function resize(s, w, h, nw, nh) {
  if (w === nw && h === nh) return s;
  const o = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, ((y + 0.5) * h) / nh - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, ((x + 0.5) * w) / nw - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
      for (let c = 0; c < 4; c++) {
        const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c];
        o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return o;
}

let sam = null; // SAM se carga recién si hace falta (sin caché)
async function getSam() {
  if (sam) return sam;
  ort.env.wasm.numThreads = 1;
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
  sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
  return sam;
}
const mean = (data, mask) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; n++; }
  return n ? [r / n, g / n, b / n] : null;
};
const dE = (a, b) => (a && b ? deltaE00(rgbToLab(a), rgbToLab(b)) : NaN);

const RESULT = [];
for (const c of cfg) {
  const raw = jpeg.decode(fs.readFileSync(path.join(FOTOS, c.foto)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height), N = width * height;
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  // render de Sinteplast recortado a la foto y llevado al tamaño de trabajo
  const cap = jpeg.decode(fs.readFileSync(c.theirs), { useTArray: true, formatAsRGBA: true });
  const [x0, y0, cw, ch] = c.crop, crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) for (let k = 0; k < 4; k++) crop[(y * cw + x) * 4 + k] = cap.data[((y0 + y) * cap.width + x0 + x) * 4 + k];
  const theirs = resize(crop, cw, ch, width, height);

  const cacheFile = CACHE ? path.join(CACHE, `${c.foto}.masks.gz`) : null;
  let found;
  if (cacheFile && fs.existsSync(cacheFile)) {
    found = JSON.parse(zlib.gunzipSync(fs.readFileSync(cacheFile)).toString('utf8')).map((f) => ({ ...f, mask: new Uint8Array(Buffer.from(f.mask, 'base64')) }));
  } else {
    const s = await getSam();
    const { width: rw, height: rh } = encoderSize(width, height);
    await s.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
    found = (await runDetect({ image: img, segment: (p) => { s.reset(); return s.segment(p); }, mode: 'interior' })).found;
    if (cacheFile) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cacheFile, zlib.gzipSync(JSON.stringify(found.map((f) => ({ name: f.name, kind: f.kind, area: f.area, mask: Buffer.from(f.mask).toString('base64') }))))); }
  }
  const N0 = width * height; if (process.env.EDGE_TOL) refineByColor(found, img, { tol: Number(process.env.EDGE_TOL), peel: process.env.EDGE_MODE !== 'grow', grow: process.env.EDGE_MODE !== 'peel', ...(process.env.EDGE_BAND ? { band: Number(process.env.EDGE_BAND) } : {}), debug: process.env.EDGE_DEBUG ? (d) => { console.log(`  [edge] ${d.region}: quitados ${d.quitados} agregados ${d.agregados} de ${d.areaPrevia}`); const pg = new PNG({ width, height }); for (let i = 0; i < N0; i++) { const o = i * 4; pg.data[o] = d.add[i] ? 255 : d.drop[i] ? 0 : img.data[o] / 3; pg.data[o + 1] = d.add[i] ? 0 : d.drop[i] ? 255 : img.data[o + 1] / 3; pg.data[o + 2] = d.drop[i] ? 255 : d.add[i] ? 0 : img.data[o + 2] / 3; pg.data[o + 3] = 255; } fs.writeFileSync(path.join(outDir, `edge-${c.foto}-${d.region.replace(/\W/g, '')}.png`), PNG.sync.write(pg)); } : null });
  console.log(`\n${c.foto}: ${found.map((f) => `${f.name} ${(f.area * 100).toFixed(0)}%`).join(' · ')}`);

  // lo que Sinteplast cambió: diferencia grande contra la foto original
  const changed = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const d = Math.abs(theirs[i * 4] - img.data[i * 4]) + Math.abs(theirs[i * 4 + 1] - img.data[i * 4 + 1]) + Math.abs(theirs[i * 4 + 2] - img.data[i * 4 + 2]);
    changed[i] = d > 60 ? 1 : 0;
  }
  const dEmap = deltaEMap(theirs, img.data, N), changedBand = changedMask(dEmap, width, height, Number(process.env.TAU ?? 12)), allOurs = new Uint8Array(N);
  for (const f of found) for (let i = 0; i < N; i++) if (f.mask[i]) allOurs[i] = 1;
  const paintedFs = [];
  const variants = { wb: estimateWhiteBalance(img), nowb: [1, 1, 1] }, painted = { wb: img, nowb: img }, union = new Uint8Array(N);
  for (const s of c.superficies) {
    const px = Math.min(width - 1, Math.floor(s.en[0] * width)), py = Math.min(height - 1, Math.floor(s.en[1] * height));
    const f = found.find((q) => q.mask[py * width + px]);
    if (!f) { console.log(`  ${s.nombre}: NO detectada en el punto (${s.en})`); continue; }
    for (let i = 0; i < N; i++) if (f.mask[i]) union[i] = 1;
    paintedFs.push(f);
    for (const v of Object.keys(variants)) {
      painted[v] = recolorWall(painted[v], featherMask(Float32Array.from(f.mask), width, height, Math.max(1, Math.round(width / 500))), hex(s.swatch), { mode: 'relative', gains: variants[v] }).image;
    }
    const sw = s.swatch.split(',').map(Number), common = new Uint8Array(N);
    let nMask = 0, inter = 0;
    for (let i = 0; i < N; i++) { if (f.mask[i]) nMask++; if (f.mask[i] && changed[i]) { common[i] = 1; inter++; } }
    const mt = mean(theirs, common), mw = mean(painted.wb.data, common), mn = mean(painted.nowb.data, common);
    const L = (m) => (m ? rgbToLab(m).L.toFixed(0) : '-');
    console.log(`  ${s.nombre.padEnd(9)} ${f.name.padEnd(16)} ΔE00 vs swatch: Sinteplast ${dE(mt, sw).toFixed(1)} · nuestro ${dE(mw, sw).toFixed(1)} · sin balance ${dE(mn, sw).toFixed(1)} | L swatch/Sint/nuestro/sinBal ${rgbToLab(sw).L.toFixed(0)}/${L(mt)}/${L(mw)}/${L(mn)} | ΔE00 nuestro↔Sinteplast: con balance ${dE(mw, mt).toFixed(1)} · sin balance ${dE(mn, mt).toFixed(1)} | de nuestra máscara, Sinteplast también la cambió: ${((inter / Math.max(1, nMask)) * 100).toFixed(0)}%`);
  }
  let i1 = 0, u1 = 0, ch1 = 0;
  for (let i = 0; i < N; i++) { if (union[i] && changed[i]) i1++; if (union[i] || changed[i]) u1++; ch1 += changed[i]; }
  console.log(`  IoU (pintado nuestro vs cambiado por Sinteplast): ${(i1 / Math.max(1, u1)).toFixed(2)} · recall nuestro de lo que ellos cambian: ${(i1 / Math.max(1, ch1)).toFixed(2)}`);

  // métrica de bordes robusta (ver metrica-bordes.mjs): franja alrededor del contorno nuestro, sin contar otras superficies detectadas no pintadas
  // ARTIFACT=1: simula el artefacto de Sinteplast (retoca el tono de TODO lo que no pintamos: -25 % de brillo y un tinte cálido) para mostrar que la métrica de franja no se mueve
  let theirsM = theirs, dEm = dEmap, chM = changedBand;
  if (process.env.ARTIFACT) {
    theirsM = new Uint8ClampedArray(theirs);
    for (let i = 0; i < N; i++) if (!union[i]) { theirsM[i * 4] = Math.min(255, theirs[i * 4] * 0.85 + 6); theirsM[i * 4 + 1] *= 0.75; theirsM[i * 4 + 2] *= 0.7; }
    dEm = deltaEMap(theirsM, img.data, N); chM = changedMask(dEm, width, height, Number(process.env.TAU ?? 12));
  }
  const ignore = new Uint8Array(N), band = Number(process.env.BAND ?? 12);
  for (const f of found) if (!paintedFs.includes(f)) for (let i = 0; i < N; i++) if (f.mask[i] && !union[i]) ignore[i] = 1;
  const per = paintedFs.map((f) => edgeMetrics({ ours: f.mask, theirs: renderedSurfaceMask(theirsM, f.mask, width, height, { band }), ignore, width, height, band }));
  const ag = aggregate(per), old = edgeMetrics({ ours: union, theirs: chM, ignore, allOurs, dE: dEm, width, height, band });
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
  if (paintedFs.length) {
    console.log(`  BORDES ${c.foto}: bandIoU ${f2(ag.bandIoU)} · bandIoU∪ ${f2(ag.bandIoUUnion)} · dNuestro ${f2(ag.dOurs)}px (≤3px ${f2(ag.in3)}) · dSuyo ${f2(ag.dTheirs)}px (≤3px ${f2(ag.in3T)}) | viejo: IoU global(ΔE>τ) ${f2(globalIoU(union, chM))} bandIoU(ΔE>τ) ${f2(old.bandIoU)} · artefacto: lejos ΔE ${f2(old.farDE)}, lejos-cambiado ${f2(old.farChanged)}`);
    RESULT.push({ foto: c.foto, ...ag, oldGlobal: globalIoU(union, chM), oldBand: old.bandIoU, farDE: old.farDE });
  }

  // imagen: [Sinteplast | nuestro con balance | nuestro sin balance | máscaras: verde ambos, rojo solo nuestro, azul solo Sinteplast]
  const H = 560, W = Math.round((H * width) / height), png = new PNG({ width: W * 4 + 24, height: H });
  png.data.fill(255);
  const put = (get, ox) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.min(width - 1, Math.floor((x / W) * width)), sy = Math.min(height - 1, Math.floor((y / H) * height)), q = sy * width + sx, o = (y * png.width + ox + x) * 4, v = get(q);
      png.data[o] = v[0]; png.data[o + 1] = v[1]; png.data[o + 2] = v[2]; png.data[o + 3] = 255;
    }
  };
  put((q) => [theirs[q * 4], theirs[q * 4 + 1], theirs[q * 4 + 2]], 0);
  put((q) => [painted.wb.data[q * 4], painted.wb.data[q * 4 + 1], painted.wb.data[q * 4 + 2]], W + 8);
  put((q) => [painted.nowb.data[q * 4], painted.nowb.data[q * 4 + 1], painted.nowb.data[q * 4 + 2]], 2 * W + 16);
  put((q) => (union[q] && changed[q] ? [60, 200, 80] : union[q] ? [230, 60, 60] : changed[q] ? [60, 90, 230] : [235, 235, 235]), 3 * W + 24);
  fs.writeFileSync(path.join(outDir, `par-${c.foto.replace(/\.\w+$/, '')}.png`), PNG.sync.write(png));
}

if (process.env.RESULT_JSON) fs.writeFileSync(process.env.RESULT_JSON, JSON.stringify(RESULT, null, 1));
