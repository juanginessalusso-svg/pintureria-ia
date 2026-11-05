// Servidor mínimo para la sonda: sirve ep-probe.html, /ort/* (dist de onnxruntime-web) y /models/* (modelos locales).
// Uso: MODELS_DIR=./modelos PORT=3290 [ISOLATE=1|credentialless] node eval/visualizador/rendimiento/sonda-servidor.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ortDir = path.join(here, '..', '..', '..', 'node_modules', 'onnxruntime-web', 'dist');
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f;
  if (u.pathname === '/' || u.pathname === '/ep-probe.html') f = path.join(here, 'ep-probe.html');
  else if (u.pathname.startsWith('/ort/')) f = path.join(ortDir, path.basename(u.pathname));
  else if (u.pathname.startsWith('/models/')) f = path.join(process.env.MODELS_DIR, path.basename(u.pathname));
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const h = { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' };
  if (process.env.ISOLATE) { h['cross-origin-opener-policy'] = 'same-origin'; h['cross-origin-embedder-policy'] = process.env.ISOLATE === 'credentialless' ? 'credentialless' : 'require-corp'; }
  res.writeHead(200, h);
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.env.PORT ?? 3290), () => console.log(`sonda en :${process.env.PORT ?? 3290}`));
