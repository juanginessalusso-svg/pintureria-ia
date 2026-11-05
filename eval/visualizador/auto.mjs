// Evalúa la DETECCIÓN AUTOMÁTICA de superficies con el pipeline real (MobileSAM + surfaces.js), sin navegador.
// Uso:  MODELS_DIR=./modelos node eval/visualizador/auto.mjs [filtro]
// Para cada foto de eval/visualizador/fotos deja en salidas/auto-<foto>.png: [ original | superficies detectadas ].
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { cleanMask, detectSurfaces, encodeMask, estimateWhiteBalance, featherMask, recolorWall } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = process.env.MODELS_DIR;
if (!modelsDir) { console.error('Falta MODELS_DIR'); process.exit(2); }
const filtro = process.argv[2];
const outDir = path.join(here, 'salidas');
fs.mkdirSync(outDir, { recursive: true });
// Opcional: TERSUAVE_JSON=ruta/a/colores-tersuave.json (carta pública bajada con fetch-tersuave-colors.mjs; NO se versiona).
// Con eso, además de las superficies, deja salidas/pintado-<foto>.png con las paredes pintadas con colores REALES de la carta.
const carta = process.env.TERSUAVE_JSON ? (() => { const j = JSON.parse(fs.readFileSync(process.env.TERSUAVE_JSON, 'utf8')); return Array.isArray(j) ? j : j.colors ?? j.colores ?? Object.values(j).find(Array.isArray); })() : null;
const porCodigo = (cod) => carta?.find((c) => c.code === String(cod));
const COLORES_PARED = ['702', '65', '227', '144'].map(porCodigo).filter(Boolean); // Verde Ilusión, Azul Adriático, Marrón Serrano, Gris Perla
const COLOR_TECHO = porCodigo('15'); // Blanco Natural
const PALETA = [[230, 57, 70], [42, 157, 143], [244, 162, 97], [69, 123, 157], [155, 93, 229], [255, 209, 102]];
const TECHO = [255, 255, 255];

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
const read = (f) => new Uint8Array(fs.readFileSync(path.join(modelsDir, f)));
ort.env.wasm.numThreads = 1;
const sam = await Sam.create(ort, { encoder: read('mobile_sam_image_encoder.onnx'), decoder: read('sam_mask_decoder_single.onnx') });

// Opcional (para iterar rápido sobre el JS sin volver a correr SAM): MASK_CACHE=dir guarda cada máscara devuelta por segment() (gzip) y la reusa.
// TRACE=archivo.jsonl deja una línea por llamada a segment() (puntos, área, ms de SAM, fase). Con caché los ms de SAM no son reales.
const cacheDir = process.env.MASK_CACHE;
if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
const traceFile = process.env.TRACE;
if (traceFile) fs.writeFileSync(traceFile, '');

// Opcional: DUMP_MASKS=dir escribe <foto>.json con las máscaras finales [{nombre, tipo, rle}] (mismo formato que verdad/*.json; lo usa medir-rect.mjs).
const dumpDir = process.env.DUMP_MASKS;
if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true });

const fotos = fs.readdirSync(path.join(here, 'fotos')).filter((f) => /\.(jpe?g|png)$/i.test(f) && (!filtro || f.includes(filtro)));
for (const foto of fotos) {
  const bytes = fs.readFileSync(path.join(here, 'fotos', foto));
  const raw = /\.png$/i.test(foto) ? PNG.sync.read(bytes) : jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const { width: rw, height: rh } = encoderSize(width, height);
  let embedded = false; // el encoder (lo más caro) solo corre si hay una máscara sin cachear
  const ensureEmbed = async () => { if (embedded) return; embedded = true; await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height); };
  let decodes = 0, samMs = 0, cleanMs = 0, clicks = 0;
  const t0 = performance.now();
  let fase = 'semillas';
  const segment = async (pts) => {
    decodes++;
    const key = cacheDir ? path.join(cacheDir, `${foto.replace(/\.\w+$/, '')}-${pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('_')}.gz`) : null;
    let m, ms = 0, nClics = 0;
    if (key && fs.existsSync(key)) m = new Uint8Array(zlib.gunzipSync(fs.readFileSync(key)));
    else {
      await ensureEmbed();
      sam.reset();
      let r;
      const ta = performance.now();
      for (let i = 1; i <= pts.length; i++) { r = await sam.segment(pts.slice(0, i).map((p) => ({ x: p.x, y: p.y, label: 1 }))); nClics++; } // clic a clic, como la app
      const tb = performance.now();
      m = cleanMask(r.mask, width, height);
      samMs += tb - ta; cleanMs += performance.now() - tb; clicks += nClics; ms = tb - ta;
      if (key) fs.writeFileSync(key, zlib.gzipSync(m));
    }
    if (traceFile) { let a = 0; for (let i = 0; i < m.length; i++) if (m[i]) a++; fs.appendFileSync(traceFile, JSON.stringify({ foto, fase, key: key ? path.basename(key) : null, pts: pts.map((p) => [+(p.x / width).toFixed(4), +(p.y / height).toFixed(4)]), area: +(a / m.length).toFixed(4), ms: Math.round(ms), clics: nClics }) + '\n'); }
    return m;
  };
  const lista = await detectSurfaces(img, segment, { ...(process.env.DEBUG_FRAMES ? { debugFrames: (d) => console.log('    [marco]', JSON.stringify(d)) } : {}), ...(process.env.DEBUG_STRIPS ? { debugStrips: (d) => console.log('    [franja]', JSON.stringify(d)) } : {}), ...(process.env.DEBUG_HANG ? { debugHang: (d) => console.log('    [colgante]', JSON.stringify(d)) } : {}), ...(process.env.DEBUG_GAPS ? { debugGaps: (d) => { const { add, ...resto } = d; console.log('    [huecos]', JSON.stringify(resto)); globalThis.__gaps = globalThis.__gaps ?? []; globalThis.__gaps.push(add); } } : {}), ...(process.env.DEBUG_ENCL ? { debugEnclosed: (d) => console.log('    [encerrado]', JSON.stringify(d)) } : {}), debugPartition: (d) => { if (d.bordesInternos !== undefined) fase = 'particion'; if (process.env.DEBUG_PART) console.log('    [partición]', JSON.stringify(d)); }, ...(process.env.LINES ? { debugLines: [10, 16, 24, 36] } : {}), ...(process.env.AUTO_OPTS ? JSON.parse(process.env.AUTO_OPTS) : {}), ...(process.env.DEBUG_CORNER ? { debugCorner: (i) => console.log('    [esquina]', i.x, i.med?.toFixed(1), 'ang', i.angle?.toFixed(1), (i.why || []).join(',') || 'OK') } : {}), ...(process.env.DEBUG_SPLIT ? { debugSplit: (d) => console.log(`    [corte] núcleos ${d.a}-${d.b}: fuerza de borde ${d.strength.toFixed(2)} (${d.len} px) ang=${d.ang} largo=${d.lenY} desvío=${d.resid} en (${d.cx},${d.cy})`) } : {}) });
  console.log(`\n${foto}: ${lista.length} superficies · ${decodes} decodificaciones · ${Math.round(performance.now() - t0)} ms`);
  const totMs = performance.now() - t0;
  console.log(`  tiempo: SAM ${Math.round(samMs)} ms (${clicks} clics) · cleanMask ${Math.round(cleanMs)} ms · resto JS ${Math.round(totMs - samMs - cleanMs)} ms`);
  if (dumpDir) fs.writeFileSync(path.join(dumpDir, `${foto.replace(/\.\w+$/, '')}.json`), JSON.stringify({ foto, width, height, superficies: lista.map((s) => ({ nombre: s.name, tipo: s.kind, rle: encodeMask(s.mask) })) }));
  const over = new Uint8ClampedArray(img.data);
  if (globalThis.__gaps) { for (const g of globalThis.__gaps) for (let i = 0; i < g.length; i++) if (g[i]) { over[i * 4] = 255; over[i * 4 + 1] = 0; over[i * 4 + 2] = 0; } globalThis.__gaps = null; }
  let pi = 0;
  for (const s of lista) {
    const col = s.kind === 'techo' ? TECHO : PALETA[pi++ % PALETA.length];
    for (let i = 0; i < s.mask.length; i++) if (s.mask[i]) for (let c = 0; c < 3; c++) over[i * 4 + c] = img.data[i * 4 + c] * 0.35 + col[c] * 0.65;
    console.log(`  ${s.name.padEnd(16)} ${(s.area * 100).toFixed(1).padStart(5)}%  centro=(${s.cx.toFixed(2)}, ${s.cy.toFixed(2)})  color=${col}  textura=${s.texture.toFixed(3)} luma=${s.luma.toFixed(0)} md5=${crypto.createHash('md5').update(s.mask).digest('hex').slice(0, 8)}${s.lines ? ' líneas=' + s.lines.map((v) => v.toFixed(4)).join('/') : ''}`);
  }
  for (const r of lista.rechazadas) console.log(`  (descartada${r.why ? ':' + r.why : ''}) ${(r.area * 100).toFixed(1).padStart(5)}% centro=(${r.cx.toFixed(2)}, ${r.cy.toFixed(2)}) textura=${r.texture.toFixed(3)} luma=${r.luma.toFixed(0)}${r.lines ? ' líneas=' + r.lines.map((v) => v.toFixed(4)).join('/') : ''}`);
  if (carta) {
    const gains = estimateWhiteBalance(img);
    let cur = img, ci = 0;
    const leyenda = [];
    for (const sf of [...lista].sort((a, b) => b.area - a.area)) {
      const col = sf.kind === 'techo' ? COLOR_TECHO : COLORES_PARED[ci++ % COLORES_PARED.length];
      if (!col) continue;
      cur = recolorWall(cur, featherMask(Float32Array.from(sf.mask), width, height, Math.max(1, Math.round(width / 500))), col.hex, { mode: 'relative', gains }).image;
      leyenda.push(`${sf.name} → ${col.code} ${col.name} ${col.hex}`);
    }
    console.log('  pintado: ' + leyenda.join(' · '));
    const Hp = 640, Wp = Math.round((width * Hp) / height);
    const pa = resize(img.data, width, height, Wp, Hp), pb = resize(cur.data, width, height, Wp, Hp);
    const po = new Uint8ClampedArray((Wp * 2 + 8) * Hp * 4).fill(255);
    for (let y = 0; y < Hp; y++) { po.set(pa.subarray(y * Wp * 4, (y + 1) * Wp * 4), y * (Wp * 2 + 8) * 4); po.set(pb.subarray(y * Wp * 4, (y + 1) * Wp * 4), (y * (Wp * 2 + 8) + Wp + 8) * 4); }
    fs.writeFileSync(path.join(outDir, `pintado-${foto.replace(/\.\w+$/, '')}.png`), PNG.sync.write({ width: Wp * 2 + 8, height: Hp, data: Buffer.from(po) }));
  }
  const H = 640, W = Math.round((width * H) / height);
  const a = resize(img.data, width, height, W, H), b = resize(over, width, height, W, H);
  const out = new Uint8ClampedArray((W * 2 + 8) * H * 4).fill(255);
  for (let y = 0; y < H; y++) { out.set(a.subarray(y * W * 4, (y + 1) * W * 4), y * (W * 2 + 8) * 4); out.set(b.subarray(y * W * 4, (y + 1) * W * 4), (y * (W * 2 + 8) + W + 8) * 4); }
  fs.writeFileSync(path.join(outDir, `auto-${foto.replace(/\.\w+$/, '')}.png`), PNG.sync.write({ width: W * 2 + 8, height: H, data: Buffer.from(out) }));
}
