// Mide la detección automática contra anotaciones hechas por una persona (IoU, sobrantes, pintura mal puesta, "fotos sin tocar").
//
//   MODELS_DIR=./modelos node eval/visualizador/medir.mjs              # mide todas las fotos que tengan verdad/<foto>.json
//   MODELS_DIR=./modelos node eval/visualizador/medir.mjs --exportar   # genera BORRADORES verdad/<foto>.json (estado "borrador") con lo detectado
//   MODELS_DIR=./modelos node eval/visualizador/medir.mjs r4           # solo fotos cuyo nombre contiene "r4"
//
// Flujo recomendado: --exportar -> abrir la app con ?anotar=1, cargar la foto, corregir con "Ajustar a mano" y "Descargar anotación" ->
// guardar el JSON en eval/visualizador/verdad/ (estado "revisada") -> volver a medir. Solo cuentan las anotaciones "revisada"
// (se pueden incluir los borradores con --borradores, pero medir contra lo propio de la detección da números inflados).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { cleanMask, detectSurfaces, encodeMask, decodeMask, evaluatePhoto, summarize } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const exportar = args.includes('--exportar'), conBorradores = args.includes('--borradores');
const filtro = args.find((a) => !a.startsWith('--'));
const modelsDir = process.env.MODELS_DIR;
if (!modelsDir) { console.error('Falta MODELS_DIR'); process.exit(2); }
const fotosDir = path.join(here, 'fotos'), verdadDir = path.join(here, 'verdad');
fs.mkdirSync(verdadDir, { recursive: true });

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

const fotos = fs.readdirSync(fotosDir).filter((f) => /\.(jpe?g|png)$/i.test(f) && (!filtro || f.includes(filtro)));
const resultados = [];
const tabla = [];
for (const foto of fotos) {
  const base = foto.replace(/\.\w+$/, '');
  const truthFile = path.join(verdadDir, `${base}.json`);
  const truth = fs.existsSync(truthFile) ? JSON.parse(fs.readFileSync(truthFile, 'utf8')) : null;
  if (!exportar && (!truth || (truth.estado !== 'revisada' && !conBorradores))) continue;
  if (exportar && truth) { console.log(`${foto}: ya tiene anotación (${truth.estado}), no se pisa`); continue; }

  const bytes = fs.readFileSync(path.join(fotosDir, foto));
  const raw = /\.png$/i.test(foto) ? PNG.sync.read(bytes) : jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const { width: rw, height: rh } = encoderSize(width, height);
  await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
  const segment = async (pts) => {
    sam.reset();
    let r;
    for (let i = 1; i <= pts.length; i++) r = await sam.segment(pts.slice(0, i).map((p) => ({ x: p.x, y: p.y, label: 1 })));
    return cleanMask(r.mask, width, height);
  };
  const pred = await detectSurfaces(img, segment);

  if (exportar) {
    const out = { foto, width, height, estado: 'borrador', superficies: pred.map((s) => ({ nombre: s.name, tipo: s.kind, rle: encodeMask(s.mask) })) };
    fs.writeFileSync(truthFile, JSON.stringify(out));
    console.log(`${foto}: borrador con ${pred.length} superficies -> verdad/${base}.json`);
    continue;
  }
  if (truth.width !== width || truth.height !== height) { console.log(`${foto}: la anotación es de ${truth.width}x${truth.height} y la foto de trabajo es ${width}x${height}: se salta`); continue; }
  const t = truth.superficies.map((s) => ({ name: s.nombre, kind: s.tipo, mask: decodeMask(s.rle, width * height) }));
  const r = evaluatePhoto(t, pred.map((s) => ({ name: s.name, kind: s.kind, mask: s.mask })));
  resultados.push(r);
  tabla.push({ foto: base, estado: truth.estado, 'sin tocar': r.zeroTouch ? 'sí' : 'no', 'IoU por superficie': r.perSurface.map((s) => `${s.name} ${(s.rawIou * 100).toFixed(0)}%`).join(' · '), sobrantes: r.extras.map((e) => `${e.name} ${(e.area * 100).toFixed(0)}%`).join(', ') || '-', 'pintura mal puesta': `${(r.falsePaint * 100).toFixed(1)}%`, 'pintura que falta': `${(r.missedPaint * 100).toFixed(1)}%` });
}
if (!exportar) {
  if (!resultados.length) { console.log('No hay anotaciones "revisada" para medir. Generá borradores con --exportar y corregilos en la app (?anotar=1).'); process.exit(0); }
  console.table(tabla);
  const s = summarize(resultados), pct = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`\nResumen (${s.fotos} fotos, ${s.superficies} superficies anotadas)`);
  console.log(`  IoU medio                 ${pct(s.iouMedio)}`);
  console.log(`  superficies encontradas   ${pct(s.encontradas)}   (IoU >= 50%)`);
  console.log(`  superficies buenas        ${pct(s.buenas)}   (IoU >= 85%)`);
  console.log(`  superficies sobrantes     ${s.sobrantes}`);
  console.log(`  pintura mal puesta        ${pct(s.pinturaMalPuesta)}   (de lo detectado, cuánto no es superficie)`);
  console.log(`  pintura que falta         ${pct(s.pinturaQueFalta)}   (de lo anotado, cuánto no se detectó)`);
  console.log(`  FOTOS SIN TOCAR           ${pct(s.sinTocar)}   <- el número que importa`);
}
