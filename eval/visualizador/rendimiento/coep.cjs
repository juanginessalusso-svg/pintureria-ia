// Compara COOP/COEP: sin aislamiento (3291), require-corp (3290: ISOLATE=1) y credentialless (3292: ISOLATE=credentialless) con sonda-servidor.mjs.
// Un fetch no-cors a otro origen sin CORP se bloquea con require-corp y se permite con credentialless (lo mismo le pasa a un logo externo).
// Playwright: PLAYWRIGHT_DIR (carpeta que contiene node_modules/playwright).
const { createRequire } = require('module');
const { chromium } = createRequire((process.env.PLAYWRIGHT_DIR || process.cwd()) + '/node_modules/')('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [port, label] of [[3291, 'sin aislamiento'], [3290, 'require-corp'], [3292, 'credentialless']]) {
    const p = await b.newPage();
    await p.goto(`http://localhost:${port}/`);
    // imagen de OTRO origen (127.0.0.1:3291 sirve /models/... no es imagen; usamos un PNG chico generado en 3291? no existe): probamos con un recurso cualquiera
    const r = await p.evaluate(async () => {
      const out = { isolated: crossOriginIsolated, sab: typeof SharedArrayBuffer };
      out.img = await new Promise((res) => {
        const i = new Image(); i.onload = () => res('cargo'); i.onerror = () => res('bloqueada');
        i.src = 'http://127.0.0.1:3291/ort/ort.wasm.min.mjs?' + Math.random(); // no es imagen: onerror igual por tipo; ver abajo
        setTimeout(() => res('timeout'), 4000);
      });
      // prueba fiable: fetch no-cors a otro origen (la respuesta no trae CORP)
      try { const r2 = await fetch('http://127.0.0.1:3291/ort/ort.wasm.min.mjs', { mode: 'no-cors' }); out.fetchNoCors = r2.type; } catch (e) { out.fetchNoCors = 'ERROR ' + e.message; }
      return out;
    });
    console.log(label, JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
