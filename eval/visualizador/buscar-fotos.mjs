// Busca fotos con licencia abierta en Openverse (agrega Wikimedia Commons, Flickr, etc.), baja UNA por vez a eval/visualizador/fotos/
// y registra autor + licencia + URL en eval/visualizador/fotos-fuentes.json (versionado; las imágenes NO se versionan).
//
//   node eval/visualizador/buscar-fotos.mjs buscar "bathroom painted wall" [pagina]   # lista candidatos (no baja nada)
//   (opcional) OV_SOURCE=stocksnap,rawpixel  limita la búsqueda a esas fuentes
//   node eval/visualizador/buscar-fotos.mjs bajar <id-openverse> <nombre-corto>       # baja una y la registra, ej: nombre "o01-bano"
//
// Solo licencias: CC0, Dominio Público (pdm), CC BY, CC BY-SA. Uso: evaluación interna de la segmentación (NO color de pintura).
// Corre en la nube con:  NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://api.openverse.org/v1/images/';
const UA = 'pintureria-ia-eval/1.0 (evaluacion interna de segmentacion de paredes)';
const FUENTES = path.join(here, 'fotos-fuentes.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, binary = false) {
  for (let intento = 0; intento < 5; intento++) {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (intento + 1)); continue; }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  throw new Error(`${url}: demasiados reintentos`);
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'buscar') {
  const q = new URLSearchParams({ q: a, license: 'cc0,pdm,by,by-sa', extension: 'jpg', size: 'large', page_size: '20', page: b ?? '1', mature: 'false' });
  if (process.env.OV_SOURCE) q.set('source', process.env.OV_SOURCE); // ej: OV_SOURCE=stocksnap,rawpixel,wikimedia
  const j = await get(`${API}?${q}`);
  console.log(`${j.result_count} resultados (pág. ${b ?? 1}):`);
  for (const r of j.results) console.log(`${r.id}  ${r.width}x${r.height}  ${r.license}  ${r.source}  "${(r.title ?? '').slice(0, 60)}"  ${r.creator ?? '?'}`);
} else if (cmd === 'bajar') {
  if (!a || !b) { console.error('Uso: bajar <id> <nombre-corto>'); process.exit(2); }
  const r = await get(`${API}${a}/`);
  if (!['cc0', 'pdm', 'by', 'by-sa'].includes(r.license)) throw new Error(`licencia no permitida: ${r.license}`);
  const buf = await get(r.url, true);
  const file = path.join(here, 'fotos', `${b}.jpg`);
  fs.writeFileSync(file, buf);
  const fuentes = fs.existsSync(FUENTES) ? JSON.parse(fs.readFileSync(FUENTES, 'utf8')) : {};
  fuentes[`${b}.jpg`] = { id: r.id, titulo: r.title, autor: r.creator, licencia: `${r.license} ${r.license_version ?? ''}`.trim(), licencia_url: r.license_url, pagina: r.foreign_landing_url, origen: r.source, descargado: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(FUENTES, JSON.stringify(fuentes, null, 2) + '\n');
  console.log(`bajada -> fotos/${b}.jpg (${(buf.length / 1024).toFixed(0)} KB, ${r.width}x${r.height}) · ${r.license} · ${r.creator ?? '?'} · ${r.foreign_landing_url}`);
} else {
  console.error('Uso: buscar "<texto>" [pagina] | bajar <id> <nombre>'); process.exit(2);
}
