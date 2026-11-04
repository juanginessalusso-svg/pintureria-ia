// Baja la carta de colores PÚBLICA de Tersuave (https://tersuave.com.ar/colores/) y la guarda como JSON.
// Uso:  node apps/api/scripts/fetch-tersuave-colors.mjs salida.json
//
// Qué extrae: por cada color su nombre, su código (cuando el slug termina en número, ej. "verde-ilusion-702" => 702),
// su familia y el color RGB con que Tersuave lo muestra en pantalla. Es la representación digital de la marca:
// NO es una medición del color real de la lata (la pantalla, la luz y la textura cambian el resultado).
//
// Buenas prácticas: robots.txt lo permite, se identifica con su User-Agent y espera entre pedidos.
// El JSON generado es de Tersuave: NO se versiona en git (ver .gitignore).
import fs from 'node:fs';

const BASE = 'https://tersuave.com.ar/colores/';
const UA = 'pintureria-ia/1.0 (importacion de carta de colores para Plaza Olmos, representante oficial de Tersuave)';
const PAUSA_MS = 1500;
const out = process.argv[2];
if (!out) { console.error('Uso: node fetch-tersuave-colors.mjs salida.json'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// La fuente mezcla "rgb(1,2,3)" y "rgb(1 2 3)": se aceptan comas o espacios entre canales.
const TILE = /jet-listing-dynamic-post-(\d+)[^{]*\{background-color:rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\);\}<\/style><div class="jet-engine-listing-overlay-wrap" data-url="([^"]+)"/g;
// Ojo: la fuente tiene errores de tipeo (ej. rgb(256,255,255) en "Blanco Natural"): cada canal se limita a 0..255.
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.min(255, Math.max(0, Number(v))).toString(16).padStart(2, '0')).join('');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#8217;/g, '’').replace(/&#038;/g, '&').trim();

function parse(html) {
  const tiles = [];
  for (const m of html.matchAll(TILE)) {
    const tail = html.slice(m.index, m.index + 6000);
    const name = (tail.match(/elementor-heading-title[^>]*>\s*([^<]+?)\s*</) ?? [])[1];
    if (!name) continue;
    const slug = m[5].replace(/\/$/, '').split('/').pop();
    tiles.push({ postId: Number(m[1]), slug, name: decode(name), hex: hex(m[2], m[3], m[4]), url: m[5] });
  }
  return tiles;
}

console.log('1) familias…');
const homeHtml = await get(BASE);
const home = parse(homeHtml);
const familias = home.slice(0, 19); // la primera grilla de la página son las 19 familias
if (familias.some((f) => /-\d+$/.test(f.slug))) throw new Error('las primeras 19 no parecen familias: cambió la página, revisar el script');
console.log('   ', familias.map((f) => f.name).join(', '));

const porPost = new Map();
for (const fam of familias) {
  await sleep(PAUSA_MS);
  const tiles = parse(await get(fam.url)).slice(19); // las 19 primeras se repiten en cada página
  let nuevos = 0;
  for (const t of tiles) {
    if (porPost.has(t.postId)) continue;
    const num = t.slug.match(/-(\d+)$/)?.[1];
    porPost.set(t.postId, { code: num ?? `TS-${t.postId}`, name: t.name, family: fam.name, hex: t.hex, source: t.url });
    nuevos++;
  }
  console.log(`   ${fam.name}: ${tiles.length} colores (${nuevos} nuevos)`);
}

// La grilla "Colores listos para usar" de la portada incluye tonos que no aparecen en las páginas de familia
// (ej. "Celeste Cielo"): se agregan con familia "Listos para usar" si todavía no estaban.
for (const t of home.slice(19)) {
  if (porPost.has(t.postId)) continue;
  const num = t.slug.match(/-(\d+)$/)?.[1];
  porPost.set(t.postId, { code: num ?? `TS-${t.postId}`, name: t.name, family: 'Listos para usar', hex: t.hex, source: t.url });
}

// Las familias mismas también son colores "de línea" (Amarillo, Azul, Blanco…): se agregan al final.
for (const f of familias) {
  if (!porPost.has(f.postId)) porPost.set(f.postId, { code: f.slug, name: f.name, family: f.name, hex: f.hex, source: f.url });
}

const colores = [...porPost.values()];
fs.writeFileSync(out, JSON.stringify({ fuente: BASE, fecha: new Date().toISOString(), cantidad: colores.length, colores }, null, 1));
console.log(`\nListo: ${colores.length} colores -> ${out}`);
