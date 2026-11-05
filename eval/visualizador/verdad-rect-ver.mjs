// Dibuja los rectángulos de verdad (eval/visualizador/verdad-rect/<foto>.json) sobre cada foto, para verificar la anotación a ojo.
//   node eval/visualizador/verdad-rect-ver.mjs [filtro ...] [--out dir]
// Verde = `pared` (zona que SÍ se debe pintar), rojo = `noPintar` (jamás). Deja <out>/rect-<foto>.png (por defecto salidas/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outDir = oi >= 0 ? args[oi + 1] : path.join(here, 'salidas');
const filtros = args.filter((a, i) => !a.startsWith('--') && !(oi >= 0 && i === oi + 1));
fs.mkdirSync(outDir, { recursive: true });

const MAXW = 1000;
for (const f of fs.readdirSync(path.join(here, 'verdad-rect')).filter((x) => x.endsWith('.json')).sort()) {
  if (filtros.length && !filtros.some((x) => f.includes(x))) continue;
  const v = JSON.parse(fs.readFileSync(path.join(here, 'verdad-rect', f), 'utf8'));
  const raw = jpeg.decode(fs.readFileSync(path.join(here, 'fotos', v.foto)), { useTArray: true, formatAsRGBA: true });
  const sc = Math.min(1, MAXW / Math.max(raw.width, raw.height));
  const W = Math.round(raw.width * sc), H = Math.round(raw.height * sc);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (Math.min(raw.height - 1, Math.floor(y / sc)) * raw.width + Math.min(raw.width - 1, Math.floor(x / sc))) * 4;
    for (let c = 0; c < 4; c++) data[(y * W + x) * 4 + c] = raw.data[s + c];
  }
  const draw = (rects, col) => {
    for (const [x0, y0, x1, y1] of rects) {
      const ax = Math.round(x0 * W), bx = Math.round(x1 * W), ay = Math.round(y0 * H), by = Math.round(y1 * H);
      for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) {
        const i = (y * W + x) * 4, borde = x === ax || x === bx - 1 || y === ay || y === by - 1;
        for (let c = 0; c < 3; c++) data[i + c] = borde ? col[c] : data[i + c] * 0.6 + col[c] * 0.4;
      }
    }
  };
  draw(v.pared, [0, 220, 0]);
  draw(v.noPintar, [255, 0, 0]);
  const out = path.join(outDir, `rect-${f.replace(/\.json$/, '')}.png`);
  fs.writeFileSync(out, PNG.sync.write({ width: W, height: H, data: Buffer.from(data) }));
  console.log(`${f.replace(/\.json$/, '')}: ${v.pared.length} pared · ${v.noPintar.length} noPintar -> ${path.relative(process.cwd(), out)}`);
}
