// Backup consistente de la base SQLite (usa la API de backup de SQLite: seguro con la app corriendo).
// Uso dentro del contenedor:  node apps/api/scripts/backup.js
// Deja app-AAAAMMDD-HHMMSS.db en DATA_DIR/backups y conserva los últimos KEEP (por defecto 7).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data');
const keep = Number(process.env.KEEP ?? 7);
const dir = path.join(dataDir, 'backups');
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const dest = path.join(dir, `app-${stamp}.db`);

const db = new Database(path.join(dataDir, 'app.db'), { readonly: true });
await db.backup(dest);
db.close();

// Verificación: el backup se abre y pasa el chequeo de integridad.
// journal_mode=DELETE deja el backup como UN solo archivo (sin -wal/-shm sueltos).
const check = new Database(dest);
check.pragma('journal_mode = DELETE');
const ok = check.pragma('integrity_check', { simple: true });
check.close();
if (ok !== 'ok') {
  console.error(`backup CORRUPTO: ${ok}`);
  process.exit(1);
}

const old = fs.readdirSync(dir).filter((f) => /^app-.*\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) fs.unlinkSync(path.join(dir, f));
console.log(`backup ok: ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB), rotados: ${old.length}`);
