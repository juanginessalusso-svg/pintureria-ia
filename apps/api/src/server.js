import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createApp } from './app.js';
import { openDb } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data');
const webDir = path.join(here, '..', '..', 'web', 'dist');

const db = openDb(path.join(dataDir, 'app.db'));
const app = createApp({
  db,
  webDir: fs.existsSync(webDir) ? webDir : undefined,
  allowTenantParam: process.env.ALLOW_TENANT_PARAM === '1',
  secureCookies: process.env.NODE_ENV === 'production',
});

const server = app.listen(port, () => console.log(`api escuchando en :${port} (datos: ${dataDir})`));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
