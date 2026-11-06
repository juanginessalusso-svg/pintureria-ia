// "Modelo + SAM": usa el mapa de clases de un modelo semántico (cache de modelo-seg-iou.mjs) como SEMILLA de SAM y mide pared/techo contra COCO-Stuff.
// Por cada componente conexa grande de pared/techo del modelo: 3 puntos en los máximos de la transformada de distancia -> SAM -> se queda con la máscara de SAM
// recortada a la componente dilatada (variante 'ref') o unida a la componente (variante 'uni'). Si SAM se va de tema (área fuera de [0,5x ; 1,6x]) queda la componente.
// Solo investigación. Uso: MODELS_DIR=... SEG_CACHE=... SEG_OUT=... node eval/visualizador/con-candado.mjs node eval/visualizador/modelo-sam-iou.mjs [dev|test|todas] [máx]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { cleanMask } from '@pintureria/core';
import { Sam, encoderSize, rgbaToRgbFloat, workingSize } from '../../apps/web/src/sam.js';

const here = path.dirname(fileURLToPath(import.meta.url)), dir = process.env.COCO_DIR ?? path.join(here, 'fotos', 'coco');
const split = process.argv[2] ?? 'dev', MAX = Number(process.argv[3] ?? 1e9), cache = process.env.SEG_CACHE, outFile = process.env.SEG_OUT;
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const list = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).filter((x) => (split === 'todas' || x.split === split) && !done.has(x.id) && fs.existsSync(path.join(cache, `${x.id}.cls`))).slice(0, MAX);
const WALL = (v) => v === 171 || v === 172, WALL_ANY = (v) => v >= 170 && v <= 176, CEIL = (v) => v === 101 || v === 102;
function resize(s, w, h, nw, nh) { if (w === nw && h === nh) return s; const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
function score(det, lab, isGt, isOkAny) {
  let inter = 0, uni = 0, d = 0, g = 0, extra = 0;
  for (let i = 0; i < det.length; i++) { if (lab[i] === 255) continue; const a = det[i] ? 1 : 0, b = isGt(lab[i]) ? 1 : 0; d += a; g += b; if (a && b) inter++; if (a || b) uni++; if (a && !isOkAny(lab[i])) extra++; }
  return { iou: uni ? inter / uni : null, recall: g ? inter / g : null, deMas: d ? extra / d : null, det: d, gt: g };
}
function components(m, w, h, minFrac) { // 4-conexa, devuelve listas de índices
  const seen = new Uint8Array(w * h), comps = [], st = [];
  for (let s = 0; s < m.length; s++) { if (!m[s] || seen[s]) continue; const c = []; st.push(s); seen[s] = 1;
    while (st.length) { const p = st.pop(); c.push(p); const x = p % w, y = (p / w) | 0; if (x > 0 && m[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st.push(p - 1); } if (x < w - 1 && m[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st.push(p + 1); } if (y > 0 && m[p - w] && !seen[p - w]) { seen[p - w] = 1; st.push(p - w); } if (y < h - 1 && m[p + w] && !seen[p + w]) { seen[p + w] = 1; st.push(p + w); } }
    if (c.length >= minFrac * w * h) comps.push(c); }
  return comps;
}
function distance(m, w, h) { // chamfer 3-4 (aprox. euclídea) dentro de la máscara
  const D = new Float32Array(w * h); for (let i = 0; i < D.length; i++) D[i] = m[i] ? 1e6 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!m[i]) continue; let v = D[i]; if (x === 0 || y === 0) v = Math.min(v, 1); if (x > 0) v = Math.min(v, D[i - 1] + 1); if (y > 0) v = Math.min(v, D[i - w] + 1); if (x > 0 && y > 0) v = Math.min(v, D[i - w - 1] + 1.4); if (x < w - 1 && y > 0) v = Math.min(v, D[i - w + 1] + 1.4); D[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!m[i]) continue; let v = D[i]; if (x === w - 1 || y === h - 1) v = Math.min(v, 1); if (x < w - 1) v = Math.min(v, D[i + 1] + 1); if (y < h - 1) v = Math.min(v, D[i + w] + 1); if (x < w - 1 && y < h - 1) v = Math.min(v, D[i + w + 1] + 1.4); if (x > 0 && y < h - 1) v = Math.min(v, D[i + w - 1] + 1.4); D[i] = v; }
  return D;
}
function dilate(m, w, h, r) { let cur = m; for (let k = 0; k < r; k++) { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (cur[i] || (x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) o[i] = 1; } cur = o; } return cur; }

ort.env.wasm.numThreads = 1;
const rd = (f) => new Uint8Array(fs.readFileSync(path.join(process.env.MODELS_DIR, f)));
const sam = await Sam.create(ort, { encoder: rd('mobile_sam_image_encoder.onnx'), decoder: rd('sam_mask_decoder_single.onnx') });
for (const e of list) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, `${e.id}.jpg`)), { useTArray: true, formatAsRGBA: true });
  const { width, height } = workingSize(raw.width, raw.height);
  const img = { data: new Uint8ClampedArray(resize(raw.data, raw.width, raw.height, width, height)), width, height };
  const lp = PNG.sync.read(fs.readFileSync(path.join(dir, `${e.id}.labels.png`)));
  const lab = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) lab[y * width + x] = lp.data[(Math.min(lp.height - 1, Math.floor((y / height) * lp.height)) * lp.width + Math.min(lp.width - 1, Math.floor((x / width) * lp.width))) * 4];
  const cls = new Uint8Array(fs.readFileSync(path.join(cache, `${e.id}.cls`)));
  const t0 = performance.now();
  const { width: rw, height: rh } = encoderSize(width, height);
  await sam.embed(rgbaToRgbFloat(resize(img.data, width, height, rw, rh), rw, rh), rw, rh, width, height);
  const V = { ref: [new Uint8Array(width * height), new Uint8Array(width * height)], uni: [new Uint8Array(width * height), new Uint8Array(width * height)], modelo: [new Uint8Array(width * height), new Uint8Array(width * height)] };
  let decodes = 0;
  for (const [k, c] of [[1, 0], [2, 1]]) {
    const m = new Uint8Array(width * height); for (let i = 0; i < m.length; i++) if (cls[i] === k) m[i] = 1;
    for (const comp of components(m, width, height, 0.02)) {
      const cm = new Uint8Array(width * height); for (const p of comp) cm[p] = 1;
      for (const p of comp) V.modelo[c][p] = 1;
      const D = distance(cm, width, height), pts = [], minSep = Math.max(width, height) * 0.12;
      const order = comp.slice().sort((a, b) => D[b] - D[a]);
      for (const p of order) { const x = p % width, y = (p / width) | 0; if (pts.every((q) => Math.hypot(q.x - x, q.y - y) > minSep)) pts.push({ x, y, label: 1 }); if (pts.length >= 3) break; }
      sam.reset(); const r = await sam.segment(pts); decodes++;
      const sm = cleanMask(r.mask, width, height);
      let sa = 0; for (let i = 0; i < sm.length; i++) if (sm[i]) sa++;
      const ok = sa > 0.5 * comp.length && sa < 1.6 * comp.length;
      const near = dilate(cm, width, height, Math.max(2, Math.round(width / 60)));
      for (let i = 0; i < sm.length; i++) {
        if (ok) { if (sm[i] && near[i]) V.ref[c][i] = 1; if ((sm[i] && near[i]) || cm[i]) V.uni[c][i] = 1; } else if (cm[i]) { V.ref[c][i] = 1; V.uni[c][i] = 1; }
      }
    }
  }
  const res = { id: e.id, split: e.split, ms: Math.round(performance.now() - t0), decodes };
  for (const [name, [w, ce]] of Object.entries(V)) res[name] = { pared: score(w, lab, WALL, WALL_ANY), techo: score(ce, lab, CEIL, CEIL) };
  fs.appendFileSync(outFile, JSON.stringify(res) + '\n');
  console.log(e.id, res.ms + 'ms', ['modelo', 'ref', 'uni'].map((n) => `${n} P ${res[n].pared.iou?.toFixed(2)} T ${res[n].techo.iou?.toFixed(2)}`).join(' | '));
}
