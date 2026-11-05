# Rendimiento del visualizador en celulares (medición, 2026-11-05)

Qué se midió, qué se encontró y qué conviene hacer. **Todo es de un contenedor de 4 núcleos compartido con otros procesos
(load average 4–8 durante las corridas), con Chromium headless 153 y onnxruntime-web 1.31.1. Nada se midió en un celular real.**
Los números sirven para comparar entre sí (y para ver las proporciones), no como promesa de tiempo en un teléfono.

## Resumen

1. **La app tarda mucho en equipos lentos.** Emulando una CPU 4× más lenta (≈ gama media) el análisis de una foto de 56
   decodificaciones tarda ~3,3 min; con 6× (≈ gama baja) ~5 min. Con la foto más chica (10 decodificaciones): 1,4 min y 2 min.
2. **Casi la mitad de la "detección" no es SAM**: es JavaScript en el hilo principal (post-proceso de `detectSurfaces`/`cleanMask`),
   que además congela la interfaz mientras corre. El encoder (~7 s aquí) es una parte chica en fotos pesadas.
3. **El multihilo se colgaba por un bug nuestro, no por el navegador**: `sam.worker.js` pisaba `self.onmessage` y los hilos de
   onnxruntime (que arrancan como Workers con ese mismo script) nunca recibían su mensaje de carga. Corregido. Con aislamiento de
   origen (COOP+COEP) el encoder baja ~1,7× con 2 hilos y ~2× con 4. Queda **apagado por defecto** (variable de entorno).
4. SIMD ya está activo. WebGL no sirve para este modelo. WebGPU no se pudo medir y es riesgoso. Bajar la entrada a 512 no se puede
   sin rehacer el modelo. Un int8 hecho por nosotros fue más lento y rompió la calidad.
5. **Lo que más conviene (por mejora medida / riesgo)**: ver "Recomendaciones" al final. En resumen: gzip del `.wasm` en Nginx
   (−11 MB en la 1.ª visita, riesgo nulo), activar `CROSS_ORIGIN_ISOLATION=credentialless`/`1` tras probar el logo, y mover
   `detectSurfaces` al Worker (libera la interfaz; con más trabajo).

## 1. Tiempos por emulación de CPU y por foto

Emulación: **cgroup con cuota de CPU** (`eval/visualizador/rendimiento/slow.sh`), porque el throttling de CDP
(`Emulation.setCPUThrottlingRate`) **no alcanza al Web Worker** donde corre SAM: se midió con un bucle fijo, a "rate 4" el hilo
principal tardó 4,2× y el worker 1,3× (ruido). Con el cgroup, el mismo bucle dio ≈4× en principal y worker con factor 4 y ≈6× con factor 6; el encoder real
pasó de 7,9 s a 28,9 s (×3,7) y a 44,6 s (×5,6) con factores 4 y 6. Es un **throughput** equivalente a una CPU N veces más lenta:
no reproduce el ancho de banda de memoria, el tamaño de caché, la temperatura (thermal throttling) ni los núcleos big.LITTLE de
un celular real. En un celular de gama media actual es muy probable que el WASM de 1 hilo sea 2–5× más lento que un notebook; el
rango real es incierto.

Mediana de 2 corridas por celda, en segundos. "Total" = desde cargar la foto hasta ver "Listo: detecté…" (incluye lectura de los
modelos desde Cache Storage, inicialización de la sesión, encoder y detección). 1 hilo.

| Foto (decodificaciones SAM) | CPU | Total | Init sesión | Encoder SAM | Detección | Carga modelos + resto |
|---|---|---:|---:|---:|---:|---:|
| t6 (10) | 1× (notebook) | 21,5 | 3,1 | 8,1 | 9,8 | 0,5 |
| t6 (10) | 4× (gama media) | 81,1 | 10,2 | 30,6 | 37,9 | 2,4 |
| t6 (10) | 6× (gama baja) | 124,4 | 16,1 | 46,7 | 57,6 | 3,9 |
| s1 (36) | 1× | 38,9 | 2,8 | 7,9 | 27,7 | 0,5 |
| s1 (36) | 4× | 140,7 | 10,2 | 28,9 | 99,0 | 2,6 |
| s1 (36) | 6× | 214,2 | 15,6 | 44,6 | 150,2 | 3,9 |
| s2 (56) | 1× | 46,4 | 2,2 | 7,0 | 36,7 | 0,5 |
| s2 (56) | 4× | 198,1 | 10,1 | 28,9 | 157,1 | 2,1 |
| s2 (56) | 6× | 306,5 | 15,5 | 43,0 | 243,7 | 4,3 |

Notas:
- Las celdas 1× se midieron con el contenedor cargado (en una corrida más tranquila t6 dio ~15 s en total: encoder 6,1 s, detección 6,8 s). Las de 4× y 6× corrieron en paralelo con cuota de CPU propia.
- La cuenta de decodificaciones es la medida en el navegador (mensajes `segment` al worker), no la del HANDOFF (que habla de 29–61): t6 hizo 10, s1 36, s2 56.
- "Detección" mide `detectSurfaces` completo: decodificaciones SAM (en el Worker) **más** el JavaScript del hilo principal entre una y otra. Corriendo con instrumentación (`segMs` = tiempo dentro del worker): t6 3,2 s de 6,8 s en SAM (47 %), s2 18,3 s de 37,4 s (49 %). **Más o menos la mitad de la detección es JS del hilo principal**, y no corre en paralelo con el worker (cada decodificación espera al post-proceso anterior). Un perfil del hilo principal en s1 mostró ~12 s ocupado y ~21 s inactivo (esperando al worker).
- **Primera visita (descarga).** En localhost la descarga cuesta 0,3–0,6 s más que con caché; la red real es lo que importa. Hay que bajar los modelos (encoder 28,16 MB + decoder 16,50 MB = **44,7 MB**) y el `.wasm` de onnxruntime (**14,85 MB** sin comprimir, 3,82 MB con gzip). Estimación aritmética (no medida): a 10 Mbit/s ≈ 48 s; a 25 Mbit/s ≈ 19 s; a 50 Mbit/s ≈ 10 s. El servidor Express **no comprime** (ni el `.wasm`); los `.onnx` casi no comprimen (gzip: 21,5 MB y 15,2 MB, −15 %). El modelo queda en Cache Storage (`sam-models-v1`) y el `.wasm`/JS en la caché HTTP (`immutable`), así que las visitas siguientes no vuelven a bajarlos (salvo que el sistema borre el almacenamiento: hasta donde sé, iOS Safari puede hacerlo tras ~7 días sin uso si la app no está instalada como PWA).

## 2. Multihilo (`?threads=N`)

### Por qué se colgaba (causa raíz, reproducida)

- onnxruntime-web multihilo necesita `SharedArrayBuffer`, que el navegador solo da si la página está aislada (`crossOriginIsolated`): cabeceras `Cross-Origin-Opener-Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp` (o `credentialless`) en el HTML **y** en el worker/wasm. El servidor no mandaba ninguna: sin ellas onnxruntime **ignora** `numThreads` y usa 1 (verificado: `?threads=4` sin aislamiento muestra "1 hilo(s)" y un aviso en consola), así que el cuelgue se veía solo con aislamiento.
- Con las cabeceras puestas y el código anterior, `?threads=2` **no terminaba**: a los 60 s la sesión seguía sin crearse (0 decodificaciones, sin mensaje de "Modelo:"). Causa: onnxruntime arranca cada hilo como un `Worker` del **mismo script** del worker (en el bundle de Vite es `sam.worker-*.js`, con `name: "em-pthread"`). Ese script terminaba con `self.onmessage = …` incondicional, que reemplazaba el manejador de carga de onnxruntime: el mensaje `load` de cada hilo llegaba a nuestro manejador, que lo rechazaba (`handlers[undefined]`), el hilo nunca arrancaba y `InferenceSession.create` esperaba para siempre.
- **Arreglo** (`apps/web/src/sam.worker.js`): no asignar `self.onmessage` cuando `self.name` empieza con `em-pthread`. Con eso (y las cabeceras) `?threads=2` completa.
- La CSP actual ya alcanza (`worker-src 'self' blob:`, `script-src 'wasm-unsafe-eval'`); el `.wasm`, el worker y los modelos son del mismo origen, así que COEP no los bloquea.

### Qué se midió con multihilo (hilos reales, contenedor cargado)

Encoder solo, sonda `ep-probe.html` (4 corridas por configuración; la 1.ª es de calentamiento), 6 sesiones intercaladas, con prioridad alta para ganarle a la carga del contenedor. Tiempos de encoder en ms, las corridas 2–4 de cada sesión:

| Hilos | Sesión A | Sesión B |
|---|---|---|
| 1 | 6851, 6983, 7030 | 6065, 5929, 5668 |
| 2 | 19971, 8279, 12525 (ruido) | 4371, 3320, 3547 |
| 4 | 8774, 5599, 8303 | 8635, 7284, 6748 |

Con el contenedor saturado (load 6–7 en 4 núcleos) 2 hilos ganaron en la mejor sesión (3,3 s vs 5,7 s: 1,7×) y 4 hilos no (se pelean con los otros procesos): **este contenedor no sirve para medir 4 hilos**. Para tener una medida más limpia se emuló "celular 4× más lento con N núcleos" con la cuota de cgroup `N/4` núcleos (t6, mediana de 2 corridas, segundos):

| Hilos (CPU 4×) | Total | Init | Encoder | Detección | de la cual SAM (worker) |
|---:|---:|---:|---:|---:|---:|
| 1 | 79,3 | 10,5 | 30,2 | 35,9 | 16,2 |
| 2 | 44,6 | 5,0 | 17,5 | 20,8 | 10,8 |
| 4 | 34,4 | 3,0 | 14,7 | 16,2 | 10,5 |

Lectura honesta: el encoder baja 1,7× con 2 hilos y 2,1× con 4; las decodificaciones solo ~1,5× (son matrices chicas, el costo fijo domina). La parte de "detección" que es JS del hilo principal parece bajar también, pero **es un artefacto del emulador** (la cuota total sube con los hilos y el hilo principal la comparte): en un celular real no mejoraría. En total, de 1 a 2 hilos se gana ~1,8× en este modelo; de 2 a 4 hilos, ~1,3× más. En un celular con 4–8 núcleos con la mitad lentos (big.LITTLE), 2–4 hilos es lo razonable; los núcleos lentos pueden frenar a los rápidos (el reparto de trabajo es parejo), así que **hay que medirlo en un equipo real antes de fijar el default**. Memoria: los hilos comparten el mismo heap WASM, no la duplican.

### Riesgos de activar el aislamiento (COOP+COEP) en todo el origen

Se probó con tres orígenes locales (`coep.cjs`, fetch `no-cors` a otro origen sin cabecera CORP):

| Modo | `crossOriginIsolated` | `SharedArrayBuffer` | Recurso de otro origen sin CORP/CORS |
|---|---|---|---|
| sin cabeceras | no | no | permitido |
| `require-corp` | sí | sí | **bloqueado** |
| `credentialless` | sí | sí | permitido (sin cookies) |

- **Logo de la pinturería.** `logo_url` puede ser una URL https de **otro sitio** (el Admin lo pide como "Logo (URL https)"). Con `require-corp` ese `<img>` se rompe si el otro sitio no manda `Cross-Origin-Resource-Policy: cross-origin` o CORS. Los logos subidos a `/uploads` son del mismo origen y no tienen problema. Con `credentialless` el logo externo carga (Chromium ≥ 96, Firefox ≥ 119).
- **iOS Safari**: soporta `SharedArrayBuffer` solo con aislamiento; `require-corp` está soportado, pero **no se pudo verificar `credentialless` en Safari/WebKit** desde acá (no hay WebKit instalado). Si no lo soporta, el navegador ignora el valor, la página no queda aislada y la app sigue andando con 1 hilo (nunca se rompe, porque sin aislamiento onnxruntime fuerza 1 hilo). Alternativa segura para iOS: `require-corp` + subir los logos a `/uploads`.
- COOP `same-origin` corta la relación con ventanas abiertas desde/hacia otros sitios (`window.opener`): la app no usa popups de terceros ni OAuth, y el enlace `wa.me` se abre en otra pestaña/app sin necesitar `opener`.
- La cabecera afecta a **todo el origen** (admin, API, imágenes). Si algún día se agrega un iframe, un script o una fuente de terceros, tiene que traer CORP/CORS o (con `credentialless`) alcanza con que sea sin credenciales.
- Algunas webviews (navegador interno de Instagram/Facebook) pueden no comportarse igual: probar abriendo el link desde WhatsApp e Instagram antes de activar en producción.

### Cómo activarlo (queda listo, apagado por defecto)

- **En la API** (`apps/api/src/app.js`, `server.js`): `CROSS_ORIGIN_ISOLATION=1` (= `require-corp`) o `CROSS_ORIGIN_ISOLATION=credentialless`. Sin la variable no se manda nada. Hay tests (`apps/api/test/isolation.test.js`).
- **En el cliente** (`apps/web/src/samClient.js`): con la página aislada y sin `?threads=`, usa `min(4, núcleos/2)` hilos; `?threads=1` fuerza 1 y `?threads=N` fuerza N. Sin aislamiento nada cambia (1 hilo).
- **En el VPS**: las cabeceras de la API pasan por el Nginx del host sin tocarlas (es `proxy_pass`), así que basta con definir la variable en el contenedor de la API. Si en cambio se prefiere ponerlas en el Nginx (por ejemplo para servir los estáticos desde ahí), tienen que ir en TODAS las respuestas del sitio, incluidos `/assets/*.js`, `/assets/*.wasm` y `/models/*`:

```nginx
# server { ... }  (el bloque del dominio de la app)
add_header Cross-Origin-Opener-Policy   "same-origin"  always;
add_header Cross-Origin-Embedder-Policy "credentialless" always;   # o "require-corp"
# Aparte, y sin ningún riesgo: comprimir el wasm (14,85 MB -> 3,8 MB en la primera visita)
gzip on;
gzip_types application/wasm application/javascript text/css application/json;
```

  Ojo: si un `location` define sus propios `add_header`, Nginx descarta los del nivel superior; repetirlos ahí. Si se pone en Nginx **y** en la API, quitar una de las dos para no duplicar la cabecera.
- **Verificar** que quedó bien: en la consola del navegador `crossOriginIsolated === true`, y la pantalla debe decir "2 hilo(s)" (o más) en "Modelo:".

## 3. Otras palancas

| Palanca | Resultado | Veredicto |
|---|---|---|
| **SIMD** | onnxruntime-web 1.31 solo publica binarios `simd-threaded` (no existe un `.wasm` sin SIMD) y la app carga `ort-wasm-simd-threaded-*.wasm`. `ort.env.wasm.simd` está obsoleto. SIMD ya está activo; los celulares sin SIMD (iOS < 16.4, Android muy viejos) no podrían correr el modelo. | Nada que hacer. |
| **WebGL** (`executionProviders: ['webgl']`) | Falla al crear la sesión del encoder: `TypeError: int64 is not supported`. El modelo exportado usa int64. | Descartado. |
| **WebGPU** | En el Chromium headless de acá `requestAdapter()` devuelve `null`; con `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader` (GPU por software) el encoder no terminó en 7 min. **No se pudo medir** el beneficio real. Riesgos: en Android solo en Chrome ≥ 121 con ciertas GPU; en iOS recién Safari 26; y algunos operadores del encoder pueden no estar soportados o caer a CPU (todo esto último es lo que sé del ecosistema, no lo verifiqué acá). | No recomendado sin probarlo en celulares reales. Si se prueba: `['webgpu','wasm']` con fallback y comparar contra WASM en el mismo equipo. |
| **Entrada de 512 en vez de 1024** | El encoder acepta una entrada `[H,W,3]` de cualquier tamaño y la **rellena internamente a 1024×1024**: con `512×384` la salida sigue siendo `[1,256,64,64]` y el tiempo es el mismo (6,7 s vs 6,9 s). Bajar el costo exigiría re-exportar MobileSAM a 512 (cambia la posición/ventanas de atención y baja la precisión). | No se puede sin rehacer el modelo. |
| **Cuantización int8** | En el repo Acly/MobileSAM solo hay fp32 (encoder 28,2 MB, decoders 16,5 MB); no hay variante int8/fp16 ahí. Se cuantizó **una copia local** con `quantize_dynamic` (11,3 MB): en WASM tardó **más** (10,4 s vs 6,9 s) y la calidad se rompió (coseno de embeddings 0,69; IoU medio de las máscaras 0,53). Otros repos de HF con "mobilesam…onnx" existen pero no se bajó ninguno (fuera de la regla); la cuantización estática con calibración quedó sin probar. | No sirve el int8 dinámico. |
| **Mover `detectSurfaces` al Worker** | ~50 % de la detección es JS del hilo principal y bloquea la interfaz (barras de progreso, scroll, botones quietos). En el Worker no se haría más rápido por sí solo, pero la app seguiría respondiendo y se evitaría el "la página no responde" de Android en equipos lentos. No toca `surfaces.js`, pero sí cómo se llama. | Alto valor de UX, esfuerzo medio. |
| **Menos decodificaciones** | Cada decodificación + post-proceso cuesta ~0,65 s por unidad aquí (≈ 2,6 s con CPU 4×). Lo hace otro agente. | Es lo que más mueve el tiempo en fotos pesadas. |

## 4. Recomendaciones (ordenadas por mejora medida / riesgo)

1. **Gzip del `.wasm` en el Nginx del VPS** (`gzip_types application/wasm`). Mejora: −11 MB en la 1.ª visita (14,85 → 3,82 MB), ≈ −9 s a 10 Mbit/s. Riesgo: ninguno. Hacerlo ya.
2. **Corregir `sam.worker.js`** (hecho, queda en esta rama): sin costo, no cambia nada con el aislamiento apagado, y desbloquea el multihilo.
3. **Activar `CROSS_ORIGIN_ISOLATION=credentialless`** tras verificar el logo del cliente y abrir el link desde WhatsApp/Instagram. Mejora medida: encoder ~1,7× (2 hilos) y ~2× (4 hilos); total ~1,8× con 2 hilos en la emulación de gama media. Riesgo: medio-bajo (recursos de terceros, iOS/`credentialless` sin verificar). Probar en 2 o 3 celulares reales antes de dejarlo fijo.
4. **Pantalla de progreso honesta** (mientras se analiza): con los tiempos de arriba, el usuario de gama media espera 1,5 a 3 min. Mostrar etapas ("bajando el modelo", "analizando", "buscando paredes N/56") y avisar que la primera vez tarda más. Sin riesgo; no cambia los tiempos.
5. **Mover la detección al Worker** (libera la interfaz): mejora de UX alta, sin acelerar; riesgo bajo-medio.
6. **Reducir decodificaciones y trabajo JS del post-proceso** (otro agente): es la palanca que más mueve el total en fotos pesadas.
7. **No** perseguir: WebGL (imposible), int8 dinámico (más lento y roto), entrada 512 (requiere re-exportar). **WebGPU** solo después de poder medirlo en celulares.
8. Antes de decidir nada más: **medir en 2–3 celulares reales** (uno de gama baja) con `?threads=1` y `?threads=2`, cargando la misma foto s2 y t6. La pantalla ya imprime "análisis N ms · detección N ms".

## 5. Cómo reproducir

Preparación (una vez) y servidor local (puertos libres a elección):

```bash
npm run build -w @pintureria/web
mkdir -p /tmp/datos
DATA_DIR=/tmp/datos ADMIN_PASSWORD=prueba123 node apps/api/scripts/create-tenant.js --slug demo --name Demo --seed-demo
# sin aislamiento (como hoy):
DATA_DIR=/tmp/datos MODELS_DIR=$PWD/modelos ALLOW_TENANT_PARAM=1 NODE_ENV=development PORT=3217 node apps/api/src/server.js &
# con aislamiento (multihilo):
DATA_DIR=/tmp/datos MODELS_DIR=$PWD/modelos ALLOW_TENANT_PARAM=1 NODE_ENV=development PORT=3218 CROSS_ORIGIN_ISOLATION=1 node apps/api/src/server.js &
```

Los scripts usan Playwright (`PLAYWRIGHT_DIR` = carpeta que contiene `node_modules/playwright`; Chromium instalado). Las fotos están en `eval/visualizador/fotos` (son ignoradas por git salvo el `.gitkeep`: copiarlas a mano).

```bash
cd eval/visualizador/rendimiento
export PLAYWRIGHT_DIR=/opt/node-tools      # ajustar
# tiempo foto -> "Listo" + desglose (la corrida 1 arranca con cache de modelos vacía, la 2 con cache):
node bench.cjs --port 3217 --foto t6 --runs 2
# CPU 4x más lenta (cgroup v1, root): "factor [hilos] comando"
./slow.sh 4 node bench.cjs --port 3217 --foto s2 --runs 2
./slow.sh 6 node bench.cjs --port 3217 --foto s2 --runs 2
# multihilo (servidor con aislamiento): cuota = hilos/factor núcleos
./slow.sh 4 2 node bench.cjs --port 3218 --foto t6 --runs 2 --threads 2
# resumir varios .jsonl (mediana por celda):
python3 resumen.py salida1.jsonl salida2.jsonl
```

Sondas del encoder solo (sin la app) — servidor propio con y sin aislamiento:

```bash
MODELS_DIR=$PWD/modelos PORT=3290 ISOLATE=1 node eval/visualizador/rendimiento/sonda-servidor.mjs &
MODELS_DIR=$PWD/modelos PORT=3291 node eval/visualizador/rendimiento/sonda-servidor.mjs &
node eval/visualizador/rendimiento/sonda.cjs 3290 "ep=wasm&threads=2"        # hilos
node eval/visualizador/rendimiento/sonda.cjs 3291 "ep=webgl"                  # falla: int64
node eval/visualizador/rendimiento/sonda.cjs 3291 "ep=webgpu"                 # sin adaptador
node eval/visualizador/rendimiento/sonda.cjs 3291 "ep=wasm&w=512&h=384"       # entrada 512: mismo tiempo
# int8 (experimento; necesita `pip install onnx` en una carpeta y onnxruntime de Python):
python3 eval/visualizador/rendimiento/cuantizar-encoder.py modelos/mobile_sam_image_encoder.onnx /tmp/enc-int8.onnx <carpeta-con-onnx>
MODELS_DIR=$PWD/modelos node eval/visualizador/rendimiento/comparar-encoder.mjs eval/visualizador/fotos/s2.jpg /tmp/enc-int8.onnx
```

Reproducir el cuelgue original: en `apps/web/src/sam.worker.js` sacar el `if (!self.name?.startsWith('em-pthread'))` (dejar `self.onmessage = …` directo), reconstruir y abrir `http://localhost:3218/?tenant=demo&threads=2` con una foto: el "Modelo:" nunca aparece.

## 6. Límites de esta medición

- Un solo contenedor (4 núcleos) con otros procesos corriendo; los tiempos 1× son ~2× peores que en una corrida tranquila. La emulación de CPU (cuota de cgroup) aproxima el throughput, no la jerarquía de memoria ni los núcleos heterogéneos; el calentamiento térmico de un celular real puede empeorar todo con el uso sostenido.
- Dos corridas por celda (mediana = promedio); la dispersión entre corridas fue de ~5–15 % salvo en las de multihilo con el contenedor saturado, que se descartaron como evidencia de 4 hilos.
- Chromium (V8) ≠ Safari (JavaScriptCore) ≠ Chrome Android; iOS y Firefox no se probaron.
