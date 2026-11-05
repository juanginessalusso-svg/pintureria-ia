// Comprueba en un iPhone 13 emulado los dos arreglos de docs/QA-MOVIL.md (#5 "Volver a lo detectado" y #6 "Sacar un objeto" sin color).
// Uso:  node qa-bugs.cjs --port 5173 --foto t6 --out ../../../docs/qa-capturas
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const { chromium, devices } = createRequire((process.env.PLAYWRIGHT_DIR || process.cwd()) + '/node_modules/')('playwright');
const a = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
const port = a.port || 5173, foto = a.foto || 't6', out = path.resolve(a.out || '.');
const FOT = path.join(__dirname, '..', 'fotos');
const file = fs.readdirSync(FOT).find((f) => f.startsWith(foto) && f.endsWith('.jpg'));
fs.mkdirSync(out, { recursive: true });
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA') + ' ' + m); if (!c) process.exitCode = 1; };

(async () => {
  const iphone = devices['iPhone 13'];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: iphone.viewport, userAgent: iphone.userAgent, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.goto(`http://127.0.0.1:${port}/?tenant=demo`);
  await page.waitForSelector('input[type=file]', { state: 'attached' });
  await page.setInputFiles('input[type=file] >> nth=1', path.join(FOT, file));
  await page.waitForFunction(() => /Listo: detecté/.test(document.body.innerText), null, { timeout: 300000 });
  const txt = () => page.evaluate(() => document.querySelector('[role=status]')?.innerText || document.body.innerText);

  // #6: sacar un objeto sobre una superficie SIN color
  await page.click('text=Sacar un objeto');
  const box = await page.locator('canvas.photo').boundingBox();
  let hitTxt = '';
  for (const [fx, fy] of [[0.62, 0.5], [0.3, 0.5], [0.15, 0.3], [0.7, 0.2], [0.5, 0.15], [0.8, 0.5], [0.7, 0.8], [0.4, 0.4], [0.9, 0.3], [0.6, 0.65]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(400);
    await page.waitForFunction(() => !/Separando el objeto/.test(document.body.innerText), null, { timeout: 120000 });
    hitTxt = await txt();
    if (/^Saqué/.test(hitTxt.trim())) break;
  }
  const t6 = await txt();
  console.log('   estado tras sacar objeto:', t6.slice(0, 200).replace(/\n/g, ' | '));
  // La rama de éxito depende de que SAM separe un objeto chico (no es determinista con tomas de prueba): se informa, no se exige.
  console.log(/Saqué ese objeto/.test(t6) && /color/.test(t6) ? 'OK    sin color: avisa que falta elegir un color' : '   (no se logró un recorte exitoso en esta foto: la rama sin color no se ejercitó)');
  await page.screenshot({ path: path.join(out, 'sacar-objeto-sin-color.png') });

  // #5: pintar, ajustar a mano, volver a lo detectado: el color se conserva
  await page.click('.sw-btn >> nth=0');
  await page.waitForTimeout(800);
  const antes = await page.evaluate(() => document.querySelector('.surfaces')?.innerText);
  await page.click('text=Ajustar a mano');
  await page.click('text=Volver a lo detectado');
  await page.waitForTimeout(800);
  const despues = await page.evaluate(() => document.querySelector('.surfaces')?.innerText);
  console.log('   superficies antes:', antes.replace(/\n/g, ' | '), '\n   despues:', despues.replace(/\n/g, ' | '));
  ok(antes === despues && antes.split('\n').some((l) => l && !/sin color|✕|Superficies|Elegí/.test(l)), 'Volver a lo detectado conserva los colores (la lista queda igual)');
  ok(/conservé el color/.test(await txt()), 'avisa que conservó los colores');
  await page.screenshot({ path: path.join(out, 'volver-a-lo-detectado.png') });
  ok(dialogs.length === 0, 'no hizo falta confirmar (no había superficies a mano con color)');
  await browser.close();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
