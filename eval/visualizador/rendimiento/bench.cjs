// Mide en un navegador real (Chromium + Playwright) el tiempo foto -> "Listo" de la app y su desglose.
// Uso:  node bench.cjs --port 3217 --foto t6 --runs 2 [--threads N] [--timeout 900000]
//   --foto     prefijo del archivo en eval/visualizador/fotos (t6, s1, s2, r4...)
//   --threads  agrega ?threads=N (multihilo; el servidor tiene que mandar COOP/COEP: CROSS_ORIGIN_ISOLATION=1)
// Un solo navegador y contexto: la corrida 1 arranca con Cache Storage vacío ("fría": el modelo se descarga),
// las siguientes con el modelo ya en cache ("tibia"). Cada corrida abre una página nueva (worker nuevo).
// OJO: el throttling de CPU de CDP (Emulation.setCPUThrottlingRate) NO alcanza al Web Worker (donde corre SAM): para
// emular un celular lento se usa un cgroup con cuota de CPU (ver slow.sh). Playwright: NODE_PATH o PLAYWRIGHT_DIR.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const { chromium } = createRequire((process.env.PLAYWRIGHT_DIR || process.cwd()) + '/node_modules/')('playwright');

const a = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; } }
const port = a.port || 3217, foto = a.foto || 't6', threads = a.threads || '', runs = Number(a.runs || 2), to = Number(a.timeout || 900000);
const FOT = process.env.FOTOS_DIR || path.join(__dirname, '..', 'fotos');
const file = fs.readdirSync(FOT).find((f) => f.startsWith(foto) && f.endsWith('.jpg'));

(async () => {
  const browser = await chromium.launch(a.args ? { args: a.args.split(' ') } : {});
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  for (let r = 0; r < runs; r++) {
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
    page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
    // cuenta decodificaciones SAM (mensajes "segment" al worker) y suma el tiempo que cada una tardó DENTRO del worker
    await page.addInitScript(() => {
      window.__seg = 0; window.__segMs = 0;
      const OW = window.Worker;
      window.Worker = class extends OW {
        constructor(...x) { super(...x); this.addEventListener('message', (e) => { if (e.data && e.data.mask && typeof e.data.ms === 'number') window.__segMs += e.data.ms; }); }
        postMessage(m, t) { if (m && m.type === 'segment') window.__seg++; return super.postMessage(m, t); }
      };
    });
    await page.goto(`http://localhost:${port}/?tenant=demo&v=1${threads ? '&threads=' + threads : ''}`);
    await page.waitForSelector('input[type=file]', { state: 'attached' });
    const t1 = Date.now();
    await page.setInputFiles('input[type=file] >> nth=1', path.join(FOT, file));
    let ok = true;
    try {
      await page.waitForFunction(() => /Listo: detecté|No pude detectar|No se pudo procesar/.test(document.body.innerText), null, { timeout: to, polling: 200 });
    } catch (e) { ok = false; }
    const totalMs = Date.now() - t1;
    const t = await page.evaluate(() => document.body.innerText);
    const nSeg = await page.evaluate(() => window.__seg), segMs = await page.evaluate(() => window.__segMs);
    const info = (/Modelo: ([^\n]*)/.exec(t) || [])[1] || null;
    const g = (re) => { const x = re.exec(info || ''); return x ? Number(x[1]) : null; };
    const row = { foto, factor: process.env.FACTOR || '1', threads, run: r + 1, cache: r === 0 ? 'fria' : 'tibia', ok, nSeg, segMs, totalMs,
      initMs: g(/init (\d+) ms/), embedMs: g(/análisis (\d+) ms/), detectMs: g(/detección (\d+) ms/), info, status: (/(Listo: detecté \d+ superficies?|No pude detectar|No se pudo procesar[^\n]*)/.exec(t) || [])[1], logs: logs.slice(0, 4) };
    // carga = descarga/lectura de cache de los modelos + decodificar la foto + todo lo que no es init/encoder/detección
    row.cargaMs = row.initMs != null ? totalMs - row.initMs - (row.embedMs || 0) - (row.detectMs || 0) : null;
    console.log(JSON.stringify(row));
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
