// Importa productos desde un CSV (el mismo formato y reglas que el panel admin).
// Uso: node apps/api/scripts/import-products.js --tenant plazaolmos --file productos.csv [--dry-run] [--replace]
//   --dry-run  valida y muestra el resumen sin escribir nada
//   --replace  además BORRA los productos de la pinturería que no estén en el archivo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { decodeCsvBytes } from '@pintureria/core';
import { openDb } from '../src/db.js';
import { importProducts } from '../src/productImport.js';

const { values: a } = parseArgs({
  options: { tenant: { type: 'string' }, file: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, replace: { type: 'boolean', default: false } },
});
if (!a.tenant || !a.file) { console.error('Faltan --tenant y --file'); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb(path.join(process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data'), 'app.db'));
const tenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(a.tenant);
if (!tenant) { console.error(`No existe la pinturería "${a.tenant}"`); process.exit(2); }

const out = importProducts(db, tenant.id, decodeCsvBytes(fs.readFileSync(a.file)), { mode: a.replace ? 'replace' : 'upsert', dryRun: a['dry-run'] });
for (const w of out.warnings) console.log(`aviso  línea ${w.line}: ${w.message}`);
for (const e of out.errors) console.log(`ERROR  línea ${e.line}: ${e.message}`);
if (out.ignoredColumns.length) console.log(`columnas ignoradas: ${out.ignoredColumns.join(', ')}`);
const s = out.summary;
console.log(`${out.ok ? (out.applied ? 'IMPORTADO' : 'OK (vista previa, no se escribió nada)') : 'NO SE IMPORTÓ NADA por los errores de arriba'}: ` +
  `${s.products} productos (${s.sizes} presentaciones) · crear ${s.create} · actualizar ${s.update}${s.remove ? ` · BORRAR ${s.remove} (${s.removeNames.join(', ')})` : ''}`);
db.close();
process.exit(out.ok ? 0 : 1);
