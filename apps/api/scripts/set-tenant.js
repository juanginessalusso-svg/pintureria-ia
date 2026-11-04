// Cambia datos de marca de una pinturería existente.
// Uso: node apps/api/scripts/set-tenant.js --tenant plazaolmos [--name "..."] [--color "#395276"] [--whatsapp 5493584907406] [--logo /uploads/logo.png]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cleanWhatsapp, normalizeHex } from '@pintureria/core';
import { openDb } from '../src/db.js';

const { values: a } = parseArgs({
  options: { tenant: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' }, whatsapp: { type: 'string' }, logo: { type: 'string' } },
});
if (!a.tenant) { console.error('Falta --tenant'); process.exit(2); }

const sets = [], vals = [];
if (a.name) { sets.push('name = ?'); vals.push(a.name); }
if (a.color) {
  const c = normalizeHex(a.color);
  if (!c) { console.error('--color inválido'); process.exit(2); }
  sets.push('primary_color = ?'); vals.push(c);
}
if (a.whatsapp !== undefined) {
  const w = a.whatsapp === '' ? '' : cleanWhatsapp(a.whatsapp);
  if (a.whatsapp !== '' && !w) { console.error('--whatsapp inválido'); process.exit(2); }
  sets.push('whatsapp = ?'); vals.push(w);
}
if (a.logo !== undefined) {
  if (!/^(https:\/\/.+|\/uploads\/[\w.-]+)?$/.test(a.logo)) { console.error('--logo debe ser https://… o /uploads/archivo'); process.exit(2); }
  sets.push('logo_url = ?'); vals.push(a.logo);
}
if (!sets.length) { console.error('Nada para cambiar'); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb(path.join(process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data'), 'app.db'));
const info = db.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE slug = ?`).run(...vals, a.tenant);
if (!info.changes) { console.error(`No existe la pinturería "${a.tenant}"`); process.exit(2); }
console.log('actualizada:', db.prepare('SELECT slug, name, primary_color, whatsapp, logo_url FROM tenants WHERE slug = ?').get(a.tenant));
db.close();
