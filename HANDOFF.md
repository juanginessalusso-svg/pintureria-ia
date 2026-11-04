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

## EN CURSO: verificar pincel, borrador y zoom con foto real
**Implementado** (2026-11-04) en `apps/web/src/Visualizer.jsx` + `styles.css`, siguiendo el diseño original; `packages/core/src/brush.js` hace el trazo puro.
- Modos `'pos' | 'neg' | 'brush' | 'erase' | 'pan'` (`label = mode==='neg' ? 0 : 1`). Los toques de SAM solo ocurren en `pos`/`neg`; en pincel/borrador/mover el `click` no marca puntos. La calibración de escala sigue funcionando en cualquier modo (y con zoom, para medir con más precisión).
- Zoom/pan: `div.viewport` + `canvas.style.transform = translate(tx,ty) scale(s)`, s en [1,8], clamp con `getBoundingClientRect()` del viewport (ojo: `clientHeight` redondea y deja una rendija de <1 px). Pointer Events: pellizco (zoom alrededor del punto medio + pan), arrastre de 1 dedo/mouse cuando s>1 o modo `pan` (arranca a los 4 px; antes es un toque), `ctrl/⌘+rueda`, botones −/+/Ajustar. `touch-action: none` si zoom>1 o modo pincel/borrador/mover; si no `pan-y`. `setPointerCapture` solo al empezar trazo/pan/pellizco. `suppressClick` se limpia en el próximo `pointerdown`.
- Pincel/borrador: radio en px de pantalla (slider 6–60, default 22) → `rImg = r * p.width / canvasRect.width`. Edita la selección en curso (`samMask` + `strokes[]`, `compose()`) o, si hay superficie seleccionada en la lista, la máscara de esa superficie (snapshots en `surfUndo`, máx. 8). Un segundo dedo que aparece en pleno trazo lo descarta (era un pellizco).
- Dibujo en vivo: mientras se arrastra se muestra la **foto original** con velo azul sobre la máscara que se edita (así el borrado se ve al instante); al soltar se recolorea. Aro del pincel que sigue al mouse.
- Deshacer unificado: con superficie seleccionada → solo restaura sus snapshots (deshabilitado si no hay); si no → último trazo; si no → último punto SAM. "Confirmar superficie" se habilita con `current` (hay selección) y se niega si la máscara quedó vacía.
- **Probado** en Chromium (Playwright, imagen sintética, sin modelos): zoom por botones y ctrl+rueda, toque con zoom cae donde se toca, radio en px de pantalla, trazo/borrado/deshacer, superficie activa, reinicio al cambiar de foto, y en táctil emulado (CDP) pellizco, pan con un dedo, trazo y descarte con segundo dedo. El script de prueba no está en el repo.
- **NO probado**: segmentación SAM + pincel juntos con una foto real (no había modelos ni fotos); celulares reales (iOS Safari en particular: `pan-y` en s=1 puede hacer que un pellizco inicial lo tome el navegador como scroll; si pasa, se amplía con los botones); rendimiento del velo en vivo en equipos lentos (copia la imagen en cada frame). Probar en staging con foto real y ajustar.

## Pendientes priorizados
0. **Probar pincel/zoom con foto real en staging** y en celulares (iOS Safari y Android); ajustar `touch-action`, velocidad del velo en vivo y tamaño por defecto del pincel según lo que se vea. Posible mejora: test automatizado de la lógica de `compose`/deshacer (hoy vive dentro del componente).
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
