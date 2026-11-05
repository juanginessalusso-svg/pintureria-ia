// Corre un comando de evaluación de a UNO por vez en toda la máquina (la notebook tiene 4 GB y cada proceso con SAM usa ~900 MB).
// Uso: node eval/visualizador/con-candado.mjs <comando> [args...]      p. ej.  node eval/visualizador/con-candado.mjs node eval/visualizador/coco-iou.mjs dev
// El candado es una carpeta (mkdir es atómico) en EVAL_LOCK (por defecto en el directorio temporal del sistema). Si el dueño murió, se limpia solo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const lock = process.env.EVAL_LOCK ?? path.join(os.tmpdir(), 'pintureria-eval.lock');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let waited = 0;
for (;;) {
  try { fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'pid'), String(process.pid)); break; } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let owner = 0; try { owner = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8')); } catch {}
    if (owner && !alive(owner)) { fs.rmSync(lock, { recursive: true, force: true }); continue; }
    if (waited % 30000 === 0) console.error(`[candado] esperando a que termine otra evaluación (pid ${owner || '?'})…`);
    await sleep(2000); waited += 2000;
  }
}
const release = () => { try { fs.rmSync(lock, { recursive: true, force: true }); } catch {} };
process.on('exit', release); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=1500`.trim() } });
child.on('exit', (code) => process.exit(code ?? 1));
