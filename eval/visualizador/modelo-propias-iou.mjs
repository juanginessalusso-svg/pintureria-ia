// Mide un segmentador ONNX propio sobre fotos PROPIAS corregidas a mano (foto-XXXX.jpg + foto-XXXX.labels.png de la app con ?dataset=1).
// Es la única medida en casas reales: ahí no hay COCO. Clases de la máscara: 0 otro, 1 pared, 2 techo, 255 ignorar (se aceptan los niveles 0/80/160/240 de la app).
// Uso: SEG_MODEL=ruta.onnx SEG_SIZE=320 node eval/visualizador/modelo-propias-iou.mjs <carpeta> [foto1,foto2,...|todas]
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web/wasm';
import { classMapFromLogits, rgbaToNchw } from '../../apps/web/src/seg.js';

const dir = process.argv[2], filtro = (process.argv[3] ?? 'todas'), S = Number(process.env.SEG_SIZE ?? 320);
const sel = filtro === 'todas' ? null : new Set(filtro.split(',').map((s) => s.trim()));
const bases = fs.readdirSync(dir).filter((f) => /^foto-.*\.jpg$/.test(f)).map((f) => f.replace(/\.jpg$/, '')).filter((b) => (!sel || sel.has(b) || sel.has(b.slice(-6)))).sort();
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(process.env.SEG_MODEL)), { executionProviders: ['wasm'] });
function resizeNearestRGBA(src, w, h, nw, nh) { const o = new Uint8Array(nw * nh * 4); for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / nw)), sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / nh)); for (let c = 0; c < 4; c++) o[(y * nw + x) * 4 + c] = src[(sy * w + sx) * 4 + c]; } return o; }
function resizeBilinear(s, w, h, nw, nh) { const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < nh; y++) { const fy = Math.min(h - 1, ((y + .5) * h) / nh - .5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0); for (let x = 0; x < nw; x++) { const fx = Math.min(w - 1, ((x + .5) * w) / nw - .5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0); for (let c = 0; c < 4; c++) { const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], d = s[(y1 * w + x0) * 4 + c], e = s[(y1 * w + x1) * 4 + c]; o[(y * nw + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty; } } } return o; }
const clase = (v) => { if (v >= 250 || (v > 200 && v < 250)) return 255; if (v > 5 && v < 250) { const n = [0, 80, 160, 240], k = n.reduce((b, x, i) => (Math.abs(v - x) < Math.abs(v - n[b]) ? i : b), 0); return [0, 1, 2, 255][k]; } return v; };
const iou = (pred, gt, ign, k) => { let i = 0, u = 0, g = 0, d = 0; for (let p = 0; p < pred.length; p++) { if (ign[p]) continue; const a = pred[p] === k, b = gt[p] === k; if (a) d++; if (b) g++; if (a && b) i++; if (a || b) u++; } return { iou: u ? i / u : null, gt: g, det: d }; };
const filas = [];
for (const b of bases) {
  const raw = jpeg.decode(fs.readFileSync(path.join(dir, b + '.jpg')), { useTArray: true, formatAsRGBA: true });
  const lp = PNG.sync.read(fs.readFileSync(path.join(dir, b + '.labels.png')));
  const W = 600, H = Math.round((raw.height * W) / raw.width);
  const lab = new Uint8Array(W * H), lr = resizeNearestRGBA(lp.data, lp.width, lp.height, W, H);
  let legacy = true; for (let i = 0; i < W * H; i++) { const v = lr[i * 4]; if (v > 5 && v < 250) { legacy = false; break; } }
  for (let i = 0; i < W * H; i++) { const v = lr[i * 4]; lab[i] = legacy ? (v >= 250 ? 255 : v) : clase(v); }
  const small = resizeBilinear(raw.data, raw.width, raw.height, S, S);
  const out = await session.run({ rgb: new ort.Tensor('float32', rgbaToNchw(small, S), [1, 3, S, S]) });
  const cls = classMapFromLogits(out.logits.data, out.logits.dims, W, H), ign = new Uint8Array(W * H).map((_, i) => (lab[i] === 255 ? 1 : 0));
  const p = iou(cls, lab, ign, 1), t = iou(cls, lab, ign, 2);
  filas.push({ b, p: p.iou, t: t.iou, tieneTecho: t.gt > 0 });
  console.log(`${b.slice(-6)}  pared IoU ${p.iou?.toFixed(3)}  techo IoU ${t.gt ? t.iou?.toFixed(3) : '(sin techo)'}`);
}
const m = (a) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(3) : '-');
console.log(`MEDIA (${filas.length} fotos): pared ${m(filas.filter((f) => f.p != null).map((f) => f.p))} · techo ${m(filas.filter((f) => f.tieneTecho && f.t != null).map((f) => f.t))}`);
