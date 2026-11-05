// Arma un set de evaluación con ANOTACIONES de COCO-Stuff (pared + techo) para medir IoU del detector.
// Licencias: anotaciones COCO-Stuff = CC BY 4.0. Imágenes = licencia de cada foto de Flickr: acá SOLO se toman las de licencia permisiva
// (COCO license id 4 = CC BY, 5 = CC BY-SA, 7 = sin restricciones conocidas, 8 = gobierno de EE. UU.). Las fotos NO se versionan (fotos/ está en .gitignore).
// Atribución: cada foto queda con su licencia y url de Flickr en fotos/coco/index.json. Uso: node coco-seleccion.mjs <carpeta con val2017/ e instances_val2017.json> [máx]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2], MAX = Number(process.argv[3] ?? 150);
const OK_LIC = new Set([4, 5, 7, 8]);
// Etiquetas de stuffthingmaps = id de categoría − 1 (255 = sin etiquetar). Ver docs de COCO-Stuff (labels.md).
const WALL = new Set([171, 172]); // wall-concrete (172), wall-other (173): paredes pintables. wall-brick/stone/tile/wood/panel quedan afuera.
const CEIL = new Set([101, 102]); // ceiling-other (102), ceiling-tile (103)
const PERSON = 0, NEEDED = { wall: 0.18, ceil: 0.04, person: 0.12 };
// Fuentes: <carpeta>/annotations/instances_val2017.json + val2017/*.png  ·  o  <carpeta>/images_perm.json (solo imágenes ya filtradas por licencia) + train2017/*.png
const permFile = path.join(src, 'images_perm.json'), isTrain = fs.existsSync(permFile), sub = isTrain ? 'train2017' : 'val2017';
const meta = isTrain ? JSON.parse(fs.readFileSync(permFile, 'utf8')) : JSON.parse(fs.readFileSync(path.join(src, 'annotations/instances_val2017.json'), 'utf8')).images;
const out = path.join(here, 'fotos', 'coco');
fs.mkdirSync(out, { recursive: true });
const cand = [];
for (const im of meta) {
  if (!OK_LIC.has(im.license)) continue;
  const f = path.join(src, sub, im.file_name.replace('.jpg', '.png'));
  if (!fs.existsSync(f)) continue;
  const png = PNG.sync.read(fs.readFileSync(f)), N = png.width * png.height;
  let w = 0, c = 0, p = 0;
  for (let i = 0; i < N; i++) { const v = png.data[i * 4]; if (WALL.has(v)) w++; else if (CEIL.has(v)) c++; else if (v === PERSON) p++; }
  if (w / N >= NEEDED.wall && c / N >= NEEDED.ceil && p / N <= NEEDED.person) cand.push({ im, w: w / N, c: c / N, p: p / N, labels: f });
}
cand.sort((a, b) => b.w + b.c - (a.w + a.c));
console.log(`${meta.length} imágenes · candidatas con licencia permisiva y pared+techo: ${cand.length}`);
const index = fs.existsSync(path.join(out, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')) : [];
const have = new Set(index.map((x) => x.id));
for (const k of cand.slice(0, MAX)) {
  const id = String(k.im.id).padStart(12, '0');
  if (have.has(id)) continue;
  const r = await fetch(k.im.coco_url);
  if (!r.ok) { console.log('falló', id, r.status); continue; }
  const b = Buffer.from(await r.arrayBuffer());
  if (b[0] !== 0xff || b[1] !== 0xd8) { console.log('no es JPEG', id); continue; }
  fs.writeFileSync(path.join(out, `${id}.jpg`), b);
  fs.copyFileSync(k.labels, path.join(out, `${id}.labels.png`));
  index.push({ id, split: (k.im.id % 10) < 7 ? 'dev' : 'test', license: k.im.license, flickr: k.im.flickr_url, wall: +k.w.toFixed(3), ceiling: +k.c.toFixed(3), person: +k.p.toFixed(3) });
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1));
console.log(`guardadas ${index.length} (dev ${index.filter((x) => x.split === 'dev').length}, test ${index.filter((x) => x.split === 'test').length}) en ${out}`);
