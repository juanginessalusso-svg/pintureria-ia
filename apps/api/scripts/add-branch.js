// Agrega (o actualiza) una sucursal de una pinturería existente.
// Uso: node apps/api/scripts/add-branch.js --tenant plazaolmos --name "Río Cuarto" --whatsapp 543584907406 \
//        [--address "Av. Marcelo T. de Alvear 560"] [--position 0]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openDb } from '../src/db.js';
import { branches, branchSchema } from '../src/branches.js';

const { values: a } = parseArgs({
  options: {
    tenant: { type: 'string' }, name: { type: 'string' }, whatsapp: { type: 'string', default: '' },
    address: { type: 'string', default: '' }, position: { type: 'string', default: '0' },
  },
});
if (!a.tenant || !a.name) { console.error('Faltan --tenant y --name'); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const db = openDb(path.join(process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data'), 'app.db'));
const tenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(a.tenant);
if (!tenant) { console.error(`No existe la pinturería "${a.tenant}"`); process.exit(2); }

const data = branchSchema.parse({ name: a.name, address: a.address, whatsapp: a.whatsapp, position: Number(a.position) });
const repo = branches(db);
const existing = repo.list(tenant.id).find((b) => b.name === data.name);
const b = existing ? repo.update(tenant.id, existing.id, data) : repo.create(tenant.id, data);
console.log(`${existing ? 'actualizada' : 'creada'}: ${b.name} (whatsapp ${b.whatsapp || '—'})`);
db.close();
