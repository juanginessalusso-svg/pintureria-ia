// Abre ep-probe.html en Chromium y muestra el resultado (JSON).
// Uso: FOTOS no hace falta. node sonda.cjs <puerto> "<query>" [chrome-args...]
//   ej.: node sonda.cjs 3290 "ep=wasm&threads=4"      (servidor con ISOLATE=1)
//        node sonda.cjs 3290 "ep=webgpu" --enable-unsafe-webgpu --use-angle=swiftshader
// Playwright se resuelve desde NODE_PATH o desde la ruta en PLAYWRIGHT_DIR.
const { createRequire } = require('module');
const req = createRequire((process.env.PLAYWRIGHT_DIR || process.env.PLAYWRIGHT_DIR || process.cwd()) + '/node_modules/');
const { chromium } = req('playwright');

(async () => {
  const [port, query = 'ep=wasm', ...args] = process.argv.slice(2);
  const browser = await chromium.launch({ args });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://localhost:${port}/?${query}`);
  await page.waitForFunction(() => window.__res, null, { timeout: 600000 });
  console.log(JSON.stringify(await page.evaluate(() => window.__res)));
  await browser.close();
})();
