// Hoja de contacto para ver varias fotos de una vez: por cada foto [ detección A | detección B ] (la mitad derecha de las imágenes `una-<foto>.png` de una-foto.mjs).
// Uso: node eval/visualizador/hoja-comparativa.mjs <dirA> <dirB> <salida.png> <foto1> <foto2> ... [--alto 300] [--cols 2]
// Ej.: dirA = detector clásico, dirB = modelo propio + SAM. Sirve para revisar a ojo las mismas fotos con dos configuraciones.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const H = opt('--alto', 300), COLS = opt('--cols', 2);
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [dirA, dirB, out, ...fotos] = pos;
function halfOverlay(file) { // mitad derecha, escalada a alto H
  const p = PNG.sync.read(fs.readFileSync(file)), w = p.width / 2, s = H / p.height, nw = Math.round(w * s);
  const o = new PNG({ width: nw, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < nw; x++) {
    const sx = Math.min(p.width - 1, Math.floor(w + (x / nw) * w)), sy = Math.min(p.height - 1, Math.floor((y / H) * p.height));
    for (let c = 0; c < 4; c++) o.data[(y * nw + x) * 4 + c] = p.data[(sy * p.width + sx) * 4 + c];
  }
  return o;
}
const cells = fotos.map((f) => {
  const a = halfOverlay(path.join(dirA, `una-${f}.png`)), b = halfOverlay(path.join(dirB, `una-${f}.png`));
  const g = 4, c = new PNG({ width: a.width + b.width + g, height: H });
  c.data.fill(255);
  for (const [img, ox] of [[a, 0], [b, a.width + g]]) for (let y = 0; y < H; y++) for (let x = 0; x < img.width; x++) for (let k = 0; k < 4; k++) c.data[(y * c.width + ox + x) * 4 + k] = img.data[(y * img.width + x) * 4 + k];
  return c;
});
const rows = [];
for (let i = 0; i < cells.length; i += COLS) rows.push(cells.slice(i, i + COLS));
const W = Math.max(...rows.map((r) => r.reduce((s, c) => s + c.width + 12, 0))), sheet = new PNG({ width: W, height: rows.length * (H + 12) });
sheet.data.fill(255);
rows.forEach((r, ri) => { let ox = 0; for (const c of r) { for (let y = 0; y < H; y++) for (let x = 0; x < c.width; x++) for (let k = 0; k < 4; k++) sheet.data[((ri * (H + 12) + y) * W + ox + x) * 4 + k] = c.data[(y * c.width + x) * 4 + k]; ox += c.width + 12; } });
fs.writeFileSync(out, PNG.sync.write(sheet));
console.log('→', out, `${cells.length} fotos`);
