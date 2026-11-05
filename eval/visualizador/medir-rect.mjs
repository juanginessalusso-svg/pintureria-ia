// Medida automática de calidad del detector de superficies contra una "verdad" anotada con RECTÁNGULOS (eval/visualizador/verdad-rect/<foto>.json).
// Cada foto tiene rectángulos relativos [x0,y0,x1,y1,"etiqueta"] en dos clases:
//   pared    = zonas que SIN DUDA son pared o techo a pintar (conservadoras, bien adentro).
//   noPintar = zonas que NO deben pintarse JAMÁS (cielo, vidrios, puertas, muebles, piso, objetos, personas...).
// Por foto se calcula (sobre la unión de todas las superficies detectadas, paredes y techo):
//   pinturaDeMás = % de píxeles de los rectángulos noPintar que el detector pintó   <- la métrica que más importa (criterio del dueño)
//   cobertura    = % de píxeles de los rectángulos pared que el detector pintó
// Es una COTA, no la verdad completa: los rectángulos son a ojo y conservadores (no cubren bordes ni toda la pared/objeto).
//
//   MODELS_DIR=./modelos node eval/visualizador/medir-rect.mjs                 # corre el detector (auto.mjs, con MASK_CACHE) en las fotos y mide
//   MODELS_DIR=./modelos node eval/visualizador/medir-rect.mjs n15 t4          # solo fotos cuyo nombre contiene alguno de esos textos
//   node eval/visualizador/medir-rect.mjs --leer [--mascaras dir]              # NO corre el detector: lee las máscaras ya volcadas (DUMP_MASKS de auto.mjs)
//   ... --json salida.json                                                      # además guarda el resultado completo (por foto y por rectángulo) en JSON
//   ... --jobs 2                                                                # fotos en paralelo (la máquina es compartida: máximo 2)
//   ... --umbral 2                                                              # % de pinturaDeMás a partir del cual una foto cuenta como "con pintura de más" (por defecto 2)
//   ... --detalle                                                               # además imprime, por foto, los rectángulos noPintar/pared con problemas
// Variables: MASK_CACHE (por defecto salidas/mascaras-cache), DUMP_MASKS no hace falta (se usa --mascaras, por defecto salidas/mascaras-rect).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMask } from '@pintureria/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const valores = new Set(['--json', '--mascaras', '--jobs', '--umbral'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
const filtros = args.filter((a, i) => !a.startsWith('--') && !valores.has(i));
const leer = flag('--leer'), detalle = flag('--detalle');
const jsonOut = opt('--json');
const jobs = Math.max(1, Math.min(2, Number(opt('--jobs', 1))));
const umbral = Number(opt('--umbral', 2));
const dumpDir = path.resolve(opt('--mascaras', path.join(here, 'salidas', 'mascaras-rect')));
const cache = process.env.MASK_CACHE ?? path.join(here, 'salidas', 'mascaras-cache');

const rectDir = path.join(here, 'verdad-rect');
const verdades = fs.readdirSync(rectDir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(rectDir, f), 'utf8')))
  .filter((v) => !filtros.length || filtros.some((x) => v.foto.includes(x)));
if (!verdades.length) { console.error('Ninguna foto coincide con el filtro'); process.exit(2); }
if (!leer && !process.env.MODELS_DIR) { console.error('Falta MODELS_DIR (o usá --leer para medir máscaras ya volcadas)'); process.exit(2); }
fs.mkdirSync(dumpDir, { recursive: true });
if (!leer) fs.mkdirSync(cache, { recursive: true });

const base = (foto) => foto.replace(/\.\w+$/, '');
const correr = (foto) => new Promise((resolve) => {
  const p = spawn('node', [path.join(here, 'auto.mjs'), foto], { env: { ...process.env, MASK_CACHE: cache, DUMP_MASKS: dumpDir } });
  let txt = '';
  p.stdout.on('data', (d) => { txt += d; }); p.stderr.on('data', (d) => { txt += d; });
  p.on('close', () => resolve(txt));
});

// 1) obtener las máscaras (corriendo el detector o leyendo lo volcado)
if (!leer) {
  const cola = verdades.map((v) => v.foto);
  const errores = [];
  const obreros = Array.from({ length: jobs }, async () => {
    while (cola.length) {
      const foto = cola.shift();
      const f = path.join(dumpDir, `${base(foto)}.json`);
      try { fs.unlinkSync(f); } catch { /* no existía */ }
      const txt = await correr(foto);
      if (!fs.existsSync(f)) errores.push(`${foto}: ERROR al correr el detector\n${txt.split('\n').slice(-5).join('\n')}`);
      process.stdout.write('.');
    }
  });
  await Promise.all(obreros);
  console.log('');
  for (const e of errores) console.log(e);
}

// 2) medir
const filas = [];
for (const v of verdades) {
  const f = path.join(dumpDir, `${base(v.foto)}.json`);
  if (!fs.existsSync(f)) { filas.push({ foto: base(v.foto), error: 'sin máscaras volcadas' }); continue; }
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const { width: W, height: H } = d;
  const pintado = new Uint8Array(W * H);
  for (const s of d.superficies) { const m = decodeMask(s.rle, W * H); for (let i = 0; i < m.length; i++) if (m[i]) pintado[i] = 1; }
  const medir = (rects) => rects.map(([x0, y0, x1, y1, etiqueta]) => {
    const ax = Math.max(0, Math.round(x0 * W)), bx = Math.min(W, Math.round(x1 * W)), ay = Math.max(0, Math.round(y0 * H)), by = Math.min(H, Math.round(y1 * H));
    let n = 0, p = 0;
    for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) { n++; if (pintado[y * W + x]) p++; }
    return { etiqueta: etiqueta ?? '', px: n, pintados: p, pct: n ? (100 * p) / n : 0 };
  });
  const rn = medir(v.noPintar), rp = medir(v.pared);
  const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
  const nPx = sum(rn, 'px'), pPx = sum(rp, 'px');
  let totPintado = 0; for (let i = 0; i < pintado.length; i++) totPintado += pintado[i];
  filas.push({
    foto: base(v.foto), nSuperficies: d.superficies.length, pintadoPct: (100 * totPintado) / pintado.length,
    pinturaDeMas: nPx ? (100 * sum(rn, 'pintados')) / nPx : null,
    cobertura: pPx ? (100 * sum(rp, 'pintados')) / pPx : null,
    rectNoPintar: rn, rectPared: rp,
  });
}

// 3) tabla y resumen
const f1 = (x) => (x === null || x === undefined ? '  -  ' : x.toFixed(1).padStart(5));
const peor = (r) => { const m = [...r.rectNoPintar].sort((a, b) => b.pct - a.pct)[0]; return m && m.pct > 0 ? `${m.etiqueta} ${m.pct.toFixed(0)}%` : ''; };
console.log('\n' + 'foto'.padEnd(24) + 'sup'.padStart(4) + 'pintado%'.padStart(10) + 'deMás%'.padStart(9) + 'cobert%'.padStart(9) + '   peor noPintar');
for (const r of filas) {
  if (r.error) { console.log(r.foto.padEnd(24) + `  ${r.error}`); continue; }
  const marca = r.pinturaDeMas !== null && r.pinturaDeMas > umbral ? ' <<' : '';
  console.log(r.foto.padEnd(24) + String(r.nSuperficies).padStart(4) + f1(r.pintadoPct).padStart(10) + f1(r.pinturaDeMas).padStart(9) + f1(r.cobertura).padStart(9) + '   ' + peor(r) + marca);
  if (detalle) {
    for (const x of r.rectNoPintar.filter((q) => q.pct > 0)) console.log(`      noPintar ${x.etiqueta}: ${x.pct.toFixed(0)} % pintado (${x.px} px)`);
    for (const x of r.rectPared.filter((q) => q.pct < 100)) console.log(`      pared    ${x.etiqueta}: ${x.pct.toFixed(0)} % cubierto (${x.px} px)`);
  }
}
const ok = filas.filter((r) => !r.error);
const conN = ok.filter((r) => r.pinturaDeMas !== null), conP = ok.filter((r) => r.cobertura !== null);
const prom = (a, k) => (a.length ? a.reduce((s, r) => s + r[k], 0) / a.length : NaN);
// versión ponderada por píxeles (las fotos con más área anotada pesan más)
const pond = (k, kr) => { let n = 0, p = 0; for (const r of ok) for (const q of r[kr]) { n += q.px; p += q.pintados; } return n ? (100 * p) / n : NaN; };
const malas = conN.filter((r) => r.pinturaDeMas > umbral);
const resumen = {
  fotos: ok.length,
  fotosConNoPintar: conN.length, fotosConPared: conP.length,
  promedioPinturaDeMas: prom(conN, 'pinturaDeMas'), promedioCobertura: prom(conP, 'cobertura'),
  ponderadoPinturaDeMas: pond('pinturaDeMas', 'rectNoPintar'), ponderadaCobertura: pond('cobertura', 'rectPared'),
  umbral, fotosConPinturaDeMas: malas.length,
  peores: [...conN].sort((a, b) => b.pinturaDeMas - a.pinturaDeMas).slice(0, 10).map((r) => ({ foto: r.foto, pinturaDeMas: +r.pinturaDeMas.toFixed(1), peor: peor(r) })),
};
console.log(`\n${resumen.fotos} fotos (${conN.length} con rectángulos noPintar, ${conP.length} con rectángulos pared)`);
console.log(`pinturaDeMás: promedio por foto ${resumen.promedioPinturaDeMas.toFixed(2)} % · ponderado por píxeles ${resumen.ponderadoPinturaDeMas.toFixed(2)} % · fotos con > ${umbral} %: ${malas.length} de ${conN.length}`);
console.log(`cobertura:    promedio por foto ${resumen.promedioCobertura.toFixed(1)} % · ponderada por píxeles ${resumen.ponderadaCobertura.toFixed(1)} %`);
console.log('10 peores en pinturaDeMás:');
for (const p of resumen.peores) console.log(`  ${p.foto.padEnd(24)} ${p.pinturaDeMas.toFixed(1).padStart(5)} %  ${p.peor}`);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify({ resumen, fotos: filas }, null, 1) + '\n'); console.log(`\nJSON -> ${jsonOut}`); }
