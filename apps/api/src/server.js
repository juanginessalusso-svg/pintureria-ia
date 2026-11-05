import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createApp, crossOriginIsolationMode } from './app.js';
import { openDb } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data');
const webDir = path.join(here, '..', '..', 'web', 'dist');

const db = openDb(path.join(dataDir, 'app.db'));
const app = createApp({
  db,
  webDir: fs.existsSync(webDir) ? webDir : undefined,
  // Los modelos NO van en la imagen ni en git: viven en el volumen de datos (data/models).
  modelsDir: process.env.MODELS_DIR ?? path.join(dataDir, 'models'),
  uploadsDir: path.join(dataDir, 'uploads'),
  allowTenantParam: process.env.ALLOW_TENANT_PARAM === '1',
  secureCookies: process.env.NODE_ENV === 'production',
  // Opcional (apagado por defecto): CROSS_ORIGIN_ISOLATION=1 | credentialless. Ver docs/RENDIMIENTO-MOVIL.md.
  crossOriginIsolation: crossOriginIsolationMode(process.env.CROSS_ORIGIN_ISOLATION),
});

const server = app.listen(port, () => console.log(`api escuchando en :${port} (datos: ${dataDir})`));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
