// Regresión automática del detector de superficies: corre auto.mjs sobre todas las fotos de eval/visualizador/fotos y compara contra la BASE versionada
// (eval/visualizador/baseline.json). Es el "freno de mano" del loop de mejora: cada cambio se evalúa contra lo aprobado, no a ojo.
//
//   MODELS_DIR=./modelos node eval/visualizador/regresion.mjs                # compara contra la base; sale con código 1 si algo cambió más que la tolerancia
//   MODELS_DIR=./modelos node eval/visualizador/regresion.mjs --guardar      # (re)escribe la base con el estado ACTUAL (hacelo solo cuando el cambio está revisado y aprobado)
//   MODELS_DIR=./modelos node eval/visualizador/regresion.mjs t4 r2          # solo las fotos cuyo nombre contiene alguno de esos textos
//   ... --tol 0.3                                                             # tolerancia en puntos de % de la foto por superficie (por defecto 0,3)
//
// La base es el estado actual aprobado, NO una verdad anotada: sirve para detectar cambios no intencionados. Un cambio marcado "CAMBIA" no es un error por sí
// mismo: hay que mirar las imágenes (salidas/pintado-<foto>.png) y decidir si mejora o empeora; si mejora y se aprueba, se actualiza la base con --guardar.
// Se usa MASK_CACHE (máscaras de SAM en gzip) para que las corridas repetidas sin cambios de semillas tarden ~1 min en vez de ~10.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseFile = path.join(here, 'baseline.json');
const args = process.argv.slice(2);
const guardar = args.includes('--guardar');
const ti = args.indexOf('--tol');
const tol = ti >= 0 ? Number(args[ti + 1]) : 0.3;
const filtros = args.filter((a, i) => !a.startsWith('--') && !(ti >= 0 && i === ti + 1));
if (!process.env.MODELS_DIR) { console.error('Falta MODELS_DIR'); process.exit(2); }
const cache = process.env.MASK_CACHE ?? path.join(here, 'salidas', 'mascaras-cache');
fs.mkdirSync(cache, { recursive: true });

const fotos = fs.readdirSync(path.join(here, 'fotos')).filter((f) => /\.(jpe?g|png)$/i.test(f) && (!filtros.length || filtros.some((x) => f.includes(x)))).sort();
const actual = {};
for (const f of fotos) {
  const r = spawnSync('node', [path.join(here, 'auto.mjs'), f], { env: { ...process.env, MASK_CACHE: cache }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const txt = (r.stdout ?? '') + (r.stderr ?? '');
  const head = txt.match(/([^\s:]+\.(?:jpe?g|png)): (\d+) superficies · (\d+) decodificaciones · (\d+) ms/i);
  if (!head) { console.log(`${f}: ERROR al correr el detector\n${txt.split('\n').slice(-6).join('\n')}`); process.exitCode = 1; continue; }
  const superficies = [...txt.matchAll(/^ {2}(Pared[^\d%(]*?|Techo)\s+([\d.]+)%.*?md5=([0-9a-f]+)/gm)].map((m) => ({ nombre: m[1].trim(), pct: Number(m[2]), md5: m[3] }));
  actual[f] = { superficies, decodificaciones: Number(head[3]), ms: Number(head[4]) };
  process.stdout.write('.');
}
console.log('');

if (guardar) {
  const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : {};
  for (const [f, v] of Object.entries(actual)) base[f] = { superficies: v.superficies, decodificaciones: v.decodificaciones };
  fs.writeFileSync(baseFile, JSON.stringify(base, null, 1) + '\n');
  console.log(`Base actualizada: ${Object.keys(actual).length} fotos -> eval/visualizador/baseline.json`);
  process.exit(0);
}

const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : {};
let cambios = 0, nuevas = 0, dBase = 0, dAct = 0;
const filas = [];
for (const [f, v] of Object.entries(actual)) {
  const b = base[f];
  if (!b) { nuevas++; filas.push([f, '-', `${v.decodificaciones}`, 'NUEVA (sin base): ' + v.superficies.map((s) => `${s.nombre} ${s.pct}%`).join(' · ')]); continue; }
  dBase += b.decodificaciones; dAct += v.decodificaciones;
  const motivos = [];
  if (b.superficies.length !== v.superficies.length) motivos.push(`superficies ${b.superficies.length}→${v.superficies.length}`);
  const n = Math.min(b.superficies.length, v.superficies.length);
  let identicas = b.superficies.length === v.superficies.length;
  for (let i = 0; i < n; i++) {
    const x = b.superficies[i], y = v.superficies[i];
    if (x.md5 !== y.md5) identicas = false;
    if (Math.abs(x.pct - y.pct) > tol || x.nombre !== y.nombre) motivos.push(`${x.nombre} ${x.pct}→${y.nombre !== x.nombre ? y.nombre + ' ' : ''}${y.pct}`);
  }
  const estado = motivos.length ? 'CAMBIA: ' + motivos.join('; ') : identicas ? 'idéntica' : `≈ igual (píxeles distintos, ≤ ${tol} pts)`;
  if (motivos.length) cambios++;
  filas.push([f, `${b.decodificaciones}`, `${v.decodificaciones}`, estado]);
}
const ausentes = Object.keys(base).filter((f) => !(f in actual) && (!filtros.length || filtros.some((x) => f.includes(x))));
console.log('foto'.padEnd(28) + 'decod. base→ahora'.padEnd(20) + 'estado');
for (const [f, a, b, e] of filas) console.log(f.padEnd(28) + `${a}→${b}`.padEnd(20) + e);
if (ausentes.length) console.log(`\nEn la base pero sin foto local (se omiten): ${ausentes.join(', ')}`);
console.log(`\n${Object.keys(actual).length} fotos · ${cambios} con cambios > ${tol} pts · ${nuevas} nuevas · decodificaciones ${dBase}→${dAct}${dBase ? ` (${((dAct / dBase - 1) * 100).toFixed(0)} %)` : ''}`);
if (cambios) { console.log('Hay cambios: mirá salidas/pintado-<foto>.png de las fotos que cambian y decidí si mejoran; si se aprueban: --guardar.'); process.exitCode = 1; }
