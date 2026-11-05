// Prueba de la pantalla de progreso en un iPhone 13 emulado (Chromium con viewport/UA/touch del iPhone): saca capturas livianas
// de cada etapa y mide si la página responde (latencia de un setTimeout(0) en el hilo principal) mientras analiza.
// Uso:  node progreso.cjs --port 5173 --foto t6 --out ../../../docs/qa-capturas [--prefix progreso]
// (con slow.sh se emula un celular más lento:  ./slow.sh 4 node progreso.cjs ...)
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const { chromium, devices } = createRequire((process.env.PLAYWRIGHT_DIR || process.cwd()) + '/node_modules/')('playwright');

const a = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
const port = a.port || 5173, foto = a.foto || 't6', out = path.resolve(a.out || '.'), prefix = a.prefix || 'progreso';
const FOT = path.join(__dirname, '..', 'fotos');
const file = fs.readdirSync(FOT).find((f) => f.startsWith(foto) && f.endsWith('.jpg'));
fs.mkdirSync(out, { recursive: true });

(async () => {
  const iphone = devices['iPhone 13'];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: iphone.viewport, userAgent: iphone.userAgent, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // latencia del hilo principal: cada 100 ms pide un timeout y registra cuánto tardó en volver (si la página está congelada, crece)
  await page.addInitScript(() => {
    window.__lag = [];
    let last = performance.now();
    setInterval(() => { const n = performance.now(); window.__lag.push(n - last - 100); last = n; }, 100);
  });
  await page.goto(`http://127.0.0.1:${port}/?tenant=demo`);
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  const t0 = Date.now();
  await page.setInputFiles('input[type=file] >> nth=1', path.join(FOT, file));
  const seen = new Set(); const log = [];
  let shots = 0;
  for (;;) {
    const info = await page.evaluate(() => {
      const el = document.querySelector('.analysis');
      const st = document.querySelector('.stage');
      const bar = el && el.querySelector('progress');
      return { stage: el && el.dataset.stage, text: el && el.innerText, val: bar && bar.value, listo: /Listo: detecté|No pude detectar|No se pudo procesar/.test(document.body.innerText),
        stageBottom: st && Math.round(st.getBoundingClientRect().bottom), elBottom: el && Math.round(el.getBoundingClientRect().bottom), vh: innerHeight };
    });
    const t = Math.round((Date.now() - t0) / 1000);
    if (info.stage) log.push({ t, stage: info.stage, val: info.val, elBottom: info.elBottom, vh: info.vh });
    const key = info.stage + ':' + (info.stage === 'detect' ? (info.val > 40 ? 'b' : 'a') : '');
    if (info.stage && !seen.has(key) && shots < 4) { seen.add(key); shots++; await page.screenshot({ path: path.join(out, `${prefix}-${info.stage}${key.endsWith('b') ? '-2' : ''}.png`) }); }
    if (info.listo) break;
    if (Date.now() - t0 > (Number(a.timeout) || 900000)) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `${prefix}-listo.png`) });
  const lag = await page.evaluate(() => window.__lag);
  const s = [...lag].sort((x, y) => x - y);
  const q = (p) => Math.round(s[Math.floor((s.length - 1) * p)]);
  console.log(JSON.stringify({ foto, totalS: Math.round((Date.now() - t0) / 1000), lagMs: { p50: q(0.5), p90: q(0.9), max: Math.round(s[s.length - 1]) }, muestras: lag.length, errs, vals: log.filter((_, i) => i % 5 === 0) }));
  await browser.close();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
