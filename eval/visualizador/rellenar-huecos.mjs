// Anotación asistida: los huecos sin pedazo (la pared que se ve entre las maderas de una silla, entre las patas de una mesa,
// entre los caños de una silla de ruedas) se resuelven preguntándole a SAM. Para cada hueco, un punto en su centro: la máscara de SAM
// se solapa sobre todo con algún pedazo (la pared de atrás, o el objeto) y el hueco pasa a ser de ese pedazo.
// Uso: MODELS_DIR=... node eval/visualizador/rellenar-huecos.mjs <carpeta de la foto> [<carpeta> ...]
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { encoderSize, rgbaToRgbFloat } from '../../apps/web/src/sam.js';
import { cleanMask, componentes, distanciaInterior } from '@pintureria/core';

const ort = await import('onnxruntime-web/wasm'); const { Sam } = await import('../../apps/web/src/sam.js'); ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
const sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
function resize(s, w, h, nw, nh) {
  const o = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const sx = Math.min(w - 1, Math.floor(((x + .5) * w) / nw)), sy = Math.min(h - 1, Math.floor(((y + .5) * h) / nh)); for (let c = 0; c < 4; c++) o[(y * nw + x) * 4 + c] = s[(sy * w + sx) * 4 + c]; }
  return o;
}
const MIN_PX = Number(process.env.MIN_PX ?? 30);
for (const dir of process.argv.slice(2)) {
  const img = jpeg.decode(fs.readFileSync(path.join(dir, 'foto.jpg')), { useTArray: true, formatAsRGBA: true });
  const W = img.width, H = img.height, N = W * H;
  const segPng = PNG.sync.read(fs.readFileSync(path.join(dir, 'segs.png')));
  const seg = new Uint8Array(N); for (let i = 0; i < N; i++) seg[i] = segPng.data[i * 4];
  const hueco = new Uint8Array(N); for (let i = 0; i < N; i++) if (!seg[i]) hueco[i] = 1;
  const comps = componentes(hueco, W, H).comps.filter((c) => c.area >= MIN_PX);
  { const { width: rw, height: rh } = encoderSize(W, H); await sam.embed(rgbaToRgbFloat(resize(img.data, W, H, rw, rh), rw, rh), rw, rh, W, H); }
  let resueltos = 0, px = 0;
  for (const c of comps) {
    const { d, bw, x0, y0 } = distanciaInterior(c, W, H);
    let best = -1, bx = 0, by = 0; for (let j = 0; j < d.length; j++) if (d[j] > best) { best = d[j]; bx = x0 + (j % bw); by = y0 + ((j / bw) | 0); }
    sam.reset();
    const m = cleanMask((await sam.segment([{ x: bx, y: by, label: 1 }])).mask, W, H);
    const votos = new Map(); for (let i = 0; i < N; i++) if (m[i] && seg[i]) votos.set(seg[i], (votos.get(seg[i]) ?? 0) + 1);
    let gana = 0, max = 0; for (const [k, v] of votos) if (v > max) { max = v; gana = k; }
    if (!gana) continue;
    for (const i of c.pixels) seg[i] = gana;
    resueltos++; px += c.area;
  }
  const out = new PNG({ width: W, height: H }); for (let i = 0; i < N; i++) { out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = seg[i]; out.data[i * 4 + 3] = 255; }
  fs.writeFileSync(path.join(dir, 'segs.png'), PNG.sync.write(out));
  console.log(`${path.basename(dir)}: ${resueltos}/${comps.length} huecos resueltos (${(100 * px / N).toFixed(1)} % de la foto)`);
}
