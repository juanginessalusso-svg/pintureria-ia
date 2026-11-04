// Uso (dentro del contenedor o en local):
//   node apps/api/scripts/create-tenant.js --slug demo --name "Pinturería Demo" --user admin \
//        [--domain demo.ejemplo.com] [--seed-demo]
// La contraseña sale de ADMIN_PASSWORD o se genera al azar y se imprime UNA vez.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openDb } from '../src/db.js';
import { createTenant, seedDemo } from '../src/tenants.js';

const { values: a } = parseArgs({
  options: {
    slug: { type: 'string' }, name: { type: 'string' }, user: { type: 'string', default: 'admin' },
    domain: { type: 'string', multiple: true, default: [] }, 'seed-demo': { type: 'boolean', default: false },
  },
});
if (!a.slug || !a.name) {
  console.error('Faltan --slug y --name');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data');
const db = openDb(path.join(dataDir, 'app.db'));

const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
const id = createTenant(db, { slug: a.slug, name: a.name, domains: a.domain, username: a.user, password });
if (a['seed-demo']) seedDemo(db, id);

console.log(`tenant=${a.slug} usuario=${a.user} contraseña=${password}${a['seed-demo'] ? ' (con datos demo)' : ''}`);
db.close();
