// Importa una carta de colores (JSON de fetch-tersuave-colors.mjs) a una pinturería.
// Uso: node apps/api/scripts/import-colors.js --tenant plazaolmos --file /app/data/imports/colores-tersuave.json [--replace]
//   --replace  borra ANTES todos los colores actuales de esa pinturería (por ejemplo los de demo).
// El LAB de cada color lo calcula el servidor a partir del hex. Todo en una sola transacción: o entra todo o nada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openDb } from '../src/db.js';
import { catalog, colorSchema } from '../src/catalog.js';

const { values: a } = parseArgs({ options: { tenant: { type: 'string' }, file: { type: 'string' }, replace: { type: 'boolean', default: false } } });
if (!a.tenant || !a.file) { console.error('Faltan --tenant y --file'); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb(path.join(process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data'), 'app.db'));
const tenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(a.tenant);
if (!tenant) { console.error(`No existe la pinturería "${a.tenant}"`); process.exit(2); }

const { colores } = JSON.parse(fs.readFileSync(a.file, 'utf8'));
// Validar TODO antes de tocar la base.
const parsed = colores.map((c, i) => {
  const r = colorSchema.safeParse({ code: String(c.code), name: c.name, family: c.family ?? '', hex: c.hex, active: true });
  if (!r.success) throw new Error(`color #${i} (${c.name}): ${r.error.issues.map((x) => x.message).join('; ')}`);
  return r.data;
});

const cat = catalog(db);
const run = db.transaction(() => {
  let borrados = 0;
  if (a.replace) borrados = db.prepare('DELETE FROM colors WHERE tenant_id = ?').run(tenant.id).changes;
  for (const c of parsed) cat.createColor(tenant.id, c);
  return borrados;
});
const borrados = run();
const total = db.prepare('SELECT COUNT(*) n FROM colors WHERE tenant_id = ?').get(tenant.id).n;
console.log(`importados: ${parsed.length} · borrados antes: ${borrados} · total ahora: ${total}`);
db.close();
