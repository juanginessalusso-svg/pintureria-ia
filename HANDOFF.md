# HANDOFF — pintureria-ia (leer completo antes de tocar nada)

Estado al **2026-11-04**. Este archivo lo escribió la sesión anterior para que otra sesión (por ejemplo en la nube) retome el trabajo sin perder contexto.

## Qué es
Web/PWA para pinturerías (multi-cliente), cliente real = **Plaza Olmos Pinturerías** (Río Cuarto/Chivilcoy, representantes oficiales de Tersuave).
- **Visualizador:** el usuario saca/sube una foto, toca una pared, la IA (MobileSAM en el navegador con ONNX Runtime Web, 1 hilo) la segmenta y se recolorea **determinísticamente en LAB** (sin IA generativa), con balance de blancos previo. Después calcula m², litros, latas (menor costo) y arma un presupuesto por WhatsApp a la sucursal elegida.
- **Asesor IA** (etapa G, NO empezado): foto de un problema (humedad, óxido…) → VLM por API (proveedor intercambiable) + RAG sobre el catálogo → JSON validado contra el stock; nunca inventa productos ni precios.

## Stack y estructura
Node 22 + Express 5, SQLite (`better-sqlite3`, migrable a Postgres), Preact + Vite, Docker Compose, Nginx del host. Monorepo npm workspaces:
- `apps/api` — API (rutas `/api/public/*` por tenant, `/api/admin/*` con sesión+CSRF), migraciones en `apps/api/migrations`, scripts en `apps/api/scripts` (create-tenant, set-tenant, add-branch, import-colors, import-products, fetch-models, fetch-tersuave-colors, backup).
- `apps/web` — front: `Visualizer.jsx` (cliente), `Calculator.jsx`, `ColorPicker.jsx`, `Admin.jsx` (panel), `sam.worker.js` + `samClient.js` + `sam.js` (segmentación).
- `packages/core` — lógica pura y testeada: color (hex→LAB), recoloreo/WB/máscaras (`recolor.js`), litros/latas (`paint.js`), WhatsApp (`whatsapp.js`), CSV es-AR (`csv.js`), pincel (`brush.js`).
- `eval/visualizador` — script de evaluación con el pipeline real (`run.mjs`, `casos.json`). Las fotos (`fotos/`) y salidas están **ignoradas por git**.
- `THIRD_PARTY_LICENSES.md` — licencias (MobileSAM Apache-2.0; export ONNX de Acly en Hugging Face, MIT). **Antes de usar cualquier otro modelo/dataset (SegFormer, ADE20K…) verificar licencia comercial.**

## Cómo correr y probar
```bash
npm install
npm test                      # API (17), core (49+), web (1 + 1 omitido sin modelos)
MODELS_DIR=./modelos node --test apps/web/test      # test real de SAM (necesita los modelos)
node apps/api/scripts/fetch-models.mjs ./modelos    # baja los 2 ONNX (45 MB) y verifica SHA-256
npm run build -w @pintureria/web
```
Servidor local: `DATA_DIR=<carpeta> MODELS_DIR=<modelos> ALLOW_TENANT_PARAM=1 NODE_ENV=development PORT=3100 node apps/api/src/server.js` y crear un tenant con `create-tenant.js --seed-demo`. **Reiniciar el server local después de cambiar `packages/core`** (Node cachea módulos).

## Infra y despliegue
- **Staging:** https://pintu.solucionesdev.online (`?tenant=plazaolmos` para el cliente real; sin param = demo). Un push a `main` dispara GitHub Actions: tests → build de imagen → envío por SSH con clave restringida → `deploy.sh` con healthcheck y **rollback automático** → verificación externa de `/api/health`.
- El VPS (DonWeb, **1 vCPU / ~1 GB RAM, compartido con n8n**, Nginx del host) **no es accesible desde la nube**: la clave SSH personal está en la notebook de Ginés. Lo que requiera tocar el servidor (subir logo/modelos/CSV, correr scripts dentro del contenedor, crear tenants) lo hace Ginés desde su PC; dejale los comandos explicados.
- Los modelos ONNX y el JSON de la carta Tersuave viven en el volumen `data/` del VPS (no en git). Backups de SQLite: cron 03:50 en el mismo disco.
- Restricciones de memoria: nunca construir imágenes en el VPS (se hace en CI); la API tiene tope de 150 MB.

## Hecho (resumen por etapa del plan original)
- **A** base + Docker + CI/CD con rollback, HTTPS, límites de subida y rate limiting.
- **B** catálogo multi-tenant + panel admin (login usuario/contraseña con cookie+CSRF, límite de intentos).
- **C** visualizador (MobileSAM + recoloreo LAB L-relativo/L-puro, WB, limpieza de máscara `cleanMask`, superficies).
- **D** calibración de escala por 2 toques, m², litros (`m² × manos ÷ rendimiento × 1,10`), latas de menor costo (verificado contra fuerza bruta).
- **E** presupuesto por WhatsApp (wa.me), copiar, compartir con imagen, **selector de sucursal** (cada una con su WhatsApp).
- Extras: importación de **colores Tersuave** (1.617, script `fetch-tersuave-colors.mjs` + `import-colors.js`), selector de colores con búsqueda/familias, logo por tenant (`/uploads`), **importación de productos por CSV** (Excel es-AR: `;`, coma decimal, Windows-1252; vista previa con errores por línea, todo-o-nada), **superficies con color propio** (Pared 1, Techo…) y mensaje con un color por superficie.

## EN CURSO: pincel, borrador y zoom (lo que sigue)
Ya hecho y commiteado: `packages/core/src/brush.js` (`paintStroke`, `maskCount`) con tests. **Falta toda la parte de interfaz** en `apps/web/src/Visualizer.jsx`. Diseño decidido:
- Modos (`mode`): `'pos'` (es pared, toque SAM), `'neg'` (no es pared), `'brush'`, `'erase'`, `'pan'`. Hoy `mode` es 1/0; cambiarlo y usar `label = mode==='neg' ? 0 : 1`.
- **Zoom/pan** con un `div.viewport` (overflow hidden) y `canvas.style.transform = translate(tx,ty) scale(s)`, origen 0 0, s en [1,8], con clamp para no salirse. Los toques se mapean con `canvas.getBoundingClientRect()` (ya incluye la transformación, el mapeo actual sigue valiendo). Gestos con **Pointer Events**: pellizco de 2 dedos (zoom alrededor del punto medio + pan), arrastre de 1 dedo para mover cuando s>1 o modo `pan`, `ctrl/⌘+rueda` para zoom, botones −/+/Ajustar.
- `touch-action`: `none` si hay zoom>1 o modo pincel/borrador/mover; si no, `pan-y` (para que se pueda scrollear la página). **No** usar `setPointerCapture` en toques simples (rompe el `click` del canvas): solo al empezar un trazo, un pan o un pellizco. Usar un ref `suppressClick` para ignorar el `click` que sigue a un arrastre/trazo.
- **Pincel/borrador:** radio en **píxeles de pantalla** (slider 6–60, default ~22) convertido a píxeles de imagen con `rImg = r * (p.width / canvasRect.width)` (a más zoom, más precisión). El trazo edita la selección en curso o, si hay una superficie seleccionada en la lista (`activeId`), la máscara de esa superficie.
- **Modelo de máscara de la selección en curso:** `samMask` (resultado de SAM tras `cleanMask`) + `strokes[]` (`{erase, r, pts}`); `compose()` = copia de `samMask` + repetir los trazos con `paintStroke`. Un toque SAM nuevo recalcula `samMask` y se repiten los trazos. Dibujo en vivo: pintar directo sobre la máscara y re-renderizar con `requestAnimationFrame` (velo azul forzado mientras se arrastra); al soltar, guardar el trazo y llamar `repaint()` (recolorea).
- **Deshacer unificado:** si hay superficie activa → restaurar snapshot (`surfUndo`, máx. 8); si no → quitar el último trazo; si no → quitar el último punto SAM. Botón "Confirmar superficie" habilitado por `hasCurrent` (no solo por `points`).
- Al cambiar de foto: reiniciar vista, `samMask`, `strokes`, `surfUndo`.
- Probar: zoom con botones y `ctrl+rueda`, que un toque con zoom caiga donde se toca, trazo + borrado, deshacer, y que `npm test` y `npm run build -w @pintureria/web` sigan en verde. Verificar en navegador (el visualizador se prueba con una foto real; ver más abajo cómo).

## Pendientes priorizados (después del pincel/zoom)
1. **Etapa F** (pulido y evaluación): set de 30–50 fotos con máscaras anotadas (IoU) y error de m² contra medidas reales; medir velocidad en **celulares reales** (hoy ~9–10 s de análisis con 1 hilo en una notebook de 4 GB; WASM multihilo se colgaba: `?threads=N`, investigar). PWA instalable (manifest, íconos PNG, service worker).
2. **Etapa G**: Asesor IA (VLM intercambiable + RAG con sqlite-vec, respuesta JSON, validar que cada producto exista en el stock, preguntas de seguimiento si la confianza es baja o puede ser estructural —p. ej. humedad ascendente—, tope diario por usuario y log de gasto). El campo `embedding_stale` de `products` ya se marca al editar un producto.
3. Auto-detección de superficies (pared/techo) estilo Sinteplast; comparar 2–3 colores y antes/después; colecciones/tendencias y filtros por producto/terminación en la carta; "terminación" (mate/satinado); granularidad en fachadas con el decoder multi-máscara (`sam_mask_decoder_multi.onnx`).
4. Carga de **productos reales** de Plaza Olmos (rendimientos oficiales en las fichas de Tersuave; precios los pasa el comercio) por el importador CSV; las otras 5 sucursales; logo oficial (hoy 140 px recortado de Instagram).
5. Seguridad/operación: copia de backups fuera del VPS, monitoreo externo de `/api/health`, activar 2FA de GitHub (límite 2026-11-20), email en los certificados Let's Encrypt, subir `actions/checkout` y `setup-node` a v5.

## Hallazgos de competencia (Sinteplast "Decorador IA")
Su app nativa (iOS/Android) analiza la foto en el servidor (~21 s), detecta sola "Pared central / Pared derecha / Techo", cada una con su color y terminación, y "pinta" otros ~21 s por cada aplicación. En una foto idéntica con los mismos colores, nuestro resultado coincidió en la pared central (ΔE 2,8); en superficies en sombra (techo ΔE 13, pared lateral 7,7) ellos oscurecen más. No se ajustó el algoritmo con n=1: hacen falta más comparaciones pareadas. Ventajas nuestras: recoloreo instantáneo (~0,3 s), sin instalar, litros/latas/precio y presupuesto por WhatsApp.

## Trampas conocidas
- Git Bash (Windows) convierte argumentos que empiezan con `/` en rutas de disco (`/uploads/x` → `C:/Program Files/Git/...`): usar `MSYS_NO_PATHCONV=1`.
- `index.html` se sirve con `no-cache`; en pruebas de navegador local agregar `?v=N` si ves un build viejo.
- El import de la carta Tersuave: la fuente trae errores de tipeo (canales 256/257 → se limitan a 255) y mezcla `rgb(1,2,3)` con `rgb(1 2 3)`.
- No commitear: fotos, salidas del eval, el JSON de Tersuave (`colores-tersuave*.json`), `.env`, credenciales. Nunca poner claves/API keys en el repo.

## Cómo le gusta trabajar a Ginés (el dueño)
Hablar en **español argentino, informal**. Explicar cada comando de terminal (qué hace y qué significa cada parte). Los comandos con `sudo` van **de a uno, cada uno en su bloque**. Si hay una decisión con tradeoffs, **preguntar antes de elegir**. Reportar con honestidad: qué se verificó, qué no, y qué falló. Mostrar lo hecho al cerrar cada tarea. Relacionar conceptos nuevos con lo que ya sabe (redes, Docker, Nginx, Node).
