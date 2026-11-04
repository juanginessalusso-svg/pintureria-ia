// Descarga los modelos ONNX de MobileSAM a DATA_DIR/models y verifica su SHA-256.
// Uso:  node apps/api/scripts/fetch-models.mjs [carpeta_destino]
// Origen: https://huggingface.co/Acly/MobileSAM (export ONNX de MobileSAM, Apache-2.0 upstream; repo con licencia MIT).
// Ver THIRD_PARTY_LICENSES.md en la raíz del repo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dest = process.argv[2] ?? path.join(process.env.DATA_DIR ?? path.join(here, '..', '..', '..', 'data'), 'models');
const BASE = 'https://huggingface.co/Acly/MobileSAM/resolve/main/';
const FILES = {
  'mobile_sam_image_encoder.onnx': '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749',
  'sam_mask_decoder_single.onnx': '93915fc7c993ab9d59ab8c9ccd3bce37f7509c81ab4150a74abd4d2abbd8570d',
};

fs.mkdirSync(dest, { recursive: true });
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

for (const [name, expected] of Object.entries(FILES)) {
  const file = path.join(dest, name);
  if (fs.existsSync(file) && sha256(file) === expected) { console.log(`ya está: ${name}`); continue; }
  console.log(`bajando ${name}…`);
  const res = await fetch(BASE + name, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const tmp = file + '.part';
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  const got = sha256(tmp);
  if (got !== expected) { fs.unlinkSync(tmp); throw new Error(`${name}: SHA-256 no coincide (${got})`); }
  fs.renameSync(tmp, file);
  console.log(`ok: ${name} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB, sha256 verificado)`);
}
