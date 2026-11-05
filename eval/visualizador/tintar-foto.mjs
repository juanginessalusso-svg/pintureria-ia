// Genera una foto con la pared "ya pintada" de verde (tiñe la pared anotada de r1 en LAB, conserva luces y sombras).
// Sirve para probar a mano (o con Playwright) la política de balance de blancos con una pared de color real.
// Uso: node eval/visualizador/tintar-foto.mjs salida.jpg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { decodeMask, rgbToLab } from '@pintureria/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const salida = process.argv[2];
if (!salida) { console.error('Uso: node tintar-foto.mjs salida.jpg'); process.exit(2); }
const t = JSON.parse(fs.readFileSync(path.join(here, 'verdad', 'r1-living-estante.json'), 'utf8'));
const s = t.superficies.find((x) => x.nombre === 'Pared izquierda');
const raw = jpeg.decode(fs.readFileSync(path.join(here, 'fotos', t.foto)), { useTArray: true, formatAsRGBA: true });
const m = decodeMask(s.rle, raw.width * raw.height);
const EPS = 216 / 24389, KAP = 24389 / 27;
function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, inv = (x) => (x * x * x > EPS ? x * x * x : (116 * x - 16) / KAP);
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  return [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z]
    .map((v) => { v = Math.min(1, Math.max(0, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); });
}
for (let i = 0; i < m.length; i++) if (m[i]) {
  const l = rgbToLab([raw.data[i * 4], raw.data[i * 4 + 1], raw.data[i * 4 + 2]]);
  const [r, g, b] = labToRgb(l.L, l.a - 22, l.b + 18); // verde
  raw.data[i * 4] = r; raw.data[i * 4 + 1] = g; raw.data[i * 4 + 2] = b;
}
fs.writeFileSync(salida, jpeg.encode(raw, 92).data);
console.log('listo', salida);
