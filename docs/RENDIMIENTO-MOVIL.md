# Rendimiento del visualizador en celulares (medición, 2026-11-05)

Qué se midió, qué se encontró y qué conviene hacer. **Todo es de un contenedor de 4 núcleos compartido con otros procesos
(load average 4–8 durante las corridas), con Chromium headless 153 y onnxruntime-web 1.31.1. Nada se midió en un celular real.**
Los números sirven para comparar entre sí (y para ver las proporciones), no como promesa de tiempo en un teléfono.

## Resumen

1. **La app tarda mucho en equipos lentos, pero bastante menos que antes.** Re-medido con el pipeline actual (menos decodificaciones
   y `cleanMask` más rápido; ver sección 1): con CPU 4× más lenta (≈ gama media) el análisis tarda 66 s (t6), 93 s (s1) y 105 s (s2),
   contra 81, 141 y 198 s antes (−18 %, −34 %, −47 %); con 6× (≈ gama baja) 100, 138 y 158 s contra 124, 214 y 307 s. La foto más
   pesada pasó de ~3,3 min a ~1,7 min en gama media y de ~5 min a ~2,6 min en gama baja (emulación, no celular real).
2. **Todavía 35–50 % de la "detección" es JavaScript del hilo principal** (post-proceso de `detectSurfaces`/`cleanMask`), que congela
   la interfaz mientras corre; antes era ~50 %. El encoder (~10 s aquí a 1×) ya es una parte chica en fotos pesadas.
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

Mediana de 2 corridas por celda, en segundos (aquí la corrida 1 arranca con los modelos sin cachear y la 2 con caché; la mediana de 2 es el
promedio). "Total" = desde cargar la foto hasta ver "Listo: detecté…" (incluye lectura de los modelos desde Cache Storage, inicialización de la sesión,
encoder y detección). 1 hilo. **Antes** = medición del primer informe (pipeline con 36 a 56 decodificaciones); **Ahora** = pipeline actual
(`d797087`), medido con las mismas fotos y los mismos scripts; "Detección" y "Hilo principal" ahora/antes. "Hilo principal" = detección menos el
tiempo que las decodificaciones pasaron dentro del Worker (JS de `detectSurfaces` + `cleanMask` + mensajes).

| Foto (decodificaciones SAM antes → ahora) | CPU | Total antes | **Total ahora** | Cambio | Init | Encoder | Detección ahora (antes) | Hilo principal en la detección ahora (antes) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| t6 (10 → 10) | 1× | 21,5 | **21,3** | −1 % | 2,9 | 9,7 | 8,2 (9,8) | 3,2 s = 39 % (~51 %) |
| t6 (10 → 10) | 4× (gama media) | 81,1 | **66,2** | −18 % | 9,3 | 27,7 | 27,1 (37,9) | 11,4 s = 42 % |
| t6 (10 → 10) | 6× (gama baja) | 124,4 | **99,9** | −20 % | 14,7 | 41,8 | 40,0 (57,6) | 16,3 s = 41 % |
| s1 (36 → 23) | 1× | 38,9 | **33,5** | −14 % | 3,5 | 10,3 | 19,1 (27,7) | 6,7 s = 35 % |
| s1 (36 → 23) | 4× | 140,7 | **92,7** | −34 % | 9,8 | 28,6 | 52,1 (99,0) | 20,0 s = 38 % |
| s1 (36 → 23) | 6× | 214,2 | **137,8** | −36 % | 14,4 | 42,7 | 76,5 (150,2) | 28,5 s = 37 % |
| s2 (56 → 25) | 1× | 46,4 | **40,0** | −14 % | 3,8 | 11,7 | 23,9 (36,7) | 11,9 s = 50 % |
| s2 (56 → 25) | 4× | 198,1 | **104,5** | −47 % | 9,1 | 27,6 | 65,6 (157,1) | 31,9 s = 49 % |
| s2 (56 → 25) | 6× | 306,5 | **157,7** | −49 % | 14,1 | 41,3 | 98,6 (243,7) | 47,4 s = 48 % |

Lecturas honestas:
- El total ahora baja entre 0 y 49 %: lo que más pesa es haber reducido las decodificaciones (s1 36→23, s2 56→25); t6 no cambió su cantidad (10) y mejora ~18–20 % a 4×/6× por el `cleanMask` más rápido. A 1× la diferencia se pierde en el ruido (el contenedor estaba cargado: load 8–13 durante las corridas; antes 4–8).
- **El "Hilo principal" ahora** (columna final) es 35–50 % de la detección. En números absolutos baja (s2 a 4×: de ~77 s a ~32 s), pero **sigue siendo un tercio a la mitad** del tiempo de detección y sigue bloqueando la interfaz entre una decodificación y la siguiente; por eso la app cede el hilo (ver sección "Progreso por etapas") y mover `detectSurfaces` al Worker sigue siendo la mejora de UX que falta. La cifra "antes" de esta columna sólo se midió para t6/s2 con instrumentación (~47–49 %).
- Las celdas de 4× y 6× corrieron las 3 fotos en cadena y a la vez por factor (3 cadenas en paralelo, cada una con su cuota de CPU) con otros agentes usando la máquina: **dispersión entre las 2 corridas del total ≤ 8 %** (hasta 12 % a 1×), pero la comparación antes/después también mezcla ruido de carga distinta. Tomala como orden de magnitud.
- No cambia la conclusión de fondo: sigue siendo un throughput emulado en Chromium/x86, no un celular real.

Notas:
- Las celdas 1× se midieron con el contenedor cargado (en una corrida más tranquila t6 dio ~15 s en total: encoder 6,1 s, detección 6,8 s). Las de 4× y 6× corrieron en paralelo con cuota de CPU propia.
- La cuenta de decodificaciones es la medida en el navegador (mensajes `segment` al worker), no la del HANDOFF (que habla de 29–61): t6 hizo 10, s1 36, s2 56.
- "Detección" mide `detectSurfaces` completo: decodificaciones SAM (en el Worker) **más** el JavaScript del hilo principal entre una y otra. Corriendo con instrumentación (`segMs` = tiempo dentro del worker): t6 3,2 s de 6,8 s en SAM (47 %), s2 18,3 s de 37,4 s (49 %). **Más o menos la mitad de la detección es JS del hilo principal**, y no corre en paralelo con el worker (cada decodificación espera al post-proceso anterior). Un perfil del hilo principal en s1 mostró ~12 s ocupado y ~21 s inactivo (esperando al worker).
- **Primera visita (descarga).** En localhost la descarga cuesta 0,3–0,6 s más que con caché; la red real es lo que importa. Hay que bajar los modelos (encoder 28,16 MB + decoder 16,50 MB = **44,7 MB**) y el `.wasm` de onnxruntime (**14,85 MB** sin comprimir, 3,82 MB con gzip). Estimación aritmética (no medida): a 10 Mbit/s ≈ 48 s; a 25 Mbit/s ≈ 19 s; a 50 Mbit/s ≈ 10 s. El servidor Express **no comprime** (ni el `.wasm`); los `.onnx` casi no comprimen (gzip: 21,5 MB y 15,2 MB, −15 %). El modelo queda en Cache Storage (`sam-models-v1`) y el `.wasm`/JS en la caché HTTP (`immutable`), así que las visitas siguientes no vuelven a bajarlos (salvo que el sistema borre el almacenamiento: hasta donde sé, iOS Safari puede hacerlo tras ~7 días sin uso si la app no está instalada como PWA).

## 1 bis. Progreso por etapas en la pantalla (hecho)

`Visualizer.jsx` + `progress.js` (con tests). Mientras se analiza la foto aparece, dentro de `.stage` (la foto fija arriba en móvil), un bloque con
las etapas **Modelo → Foto → Paredes**, una barra y un texto de tiempo:

- "Cargando el modelo (solo la primera vez): N de M MB" (sólo si el modelo todavía no estaba listo; la barra es la descarga real).
- "Analizando la foto…" (encoder): la barra avanza por tiempo contra un estimado = 3 × lo que tardó crear la sesión en ESTE teléfono (relación medida 2,7–3 a 1×, 4× y 6×), con tope 95 % de esa etapa; el texto dice cuánto falta de esta parte y que después viene la búsqueda de paredes ("entre 1 y 2,5 veces más": relación detección/encoder medida 0,85–2,4).
- "Buscando paredes y techo (paso n)…": la barra avanza con las decodificaciones hechas (escala 25, nunca pasa de 97 % en total antes de terminar) y el texto es una **cota** ("Falta como mucho X"): ritmo medio por decodificación en este teléfono × (40 − n). **No se muestra "n/N" con un N fijo porque N no se conoce** (10, 23 y 25 en las tres fotos; depende de la foto). Si una foto pasa de 40 decodificaciones, la cota queda en 0 y dice "Falta poco" en vez de inventar.
- Se cede el hilo (`requestAnimationFrame` + `setTimeout 0`, con tope de 60 ms por si la pestaña está oculta) antes de cada decodificación, desde el `segment` que se le pasa a `detectSurfaces` (no se tocó `surfaces.js`); y si el usuario cambia de foto, el `segment` viejo corta con un error propio y no gasta más CPU.
- El bloque está **dentro** de la zona fija (`.stage`) y mientras se analiza la foto se achica del 46 % al 30 % del alto para que la barra entre completa (en iPhone 13 emulado, 390×664, el borde inferior del bloque queda en y=340 < 664 en todas las etapas; antes de este ajuste quedaba en y=665–773, cortado). Al empezar se hace `scrollIntoView` de esa zona.

Medido en iPhone 13 emulado (Chromium con viewport/UA/touch del iPhone; **no es Safari**), `eval/visualizador/rendimiento/progreso.cjs`, s2 con CPU 4× (cgroup), navegador y modelo sin cachear, base y versión nueva corridas a la vez con la misma cuota:

| | Total foto→"Listo" (incl. descarga y arranque) | Latencia del hilo principal p50 / p90 | Peor congelamiento |
|---|---:|---:|---:|
| Antes (sin progreso ni cesión de hilo) | 217 s | 0 / 53 ms | 25,1 s |
| Ahora | 220 s | 0 / 68 ms | 21,9 s |

Lectura honesta: **no empeora el tiempo total** (+1 %, dentro del ruido) pero **tampoco elimina los congelamientos largos**: hay tramos de ~20 s a 4× sin un solo frame (el JS pesado de `detectSurfaces`/`cleanMask`, que no se puede partir sin tocar `surfaces.js`, y la compilación/arranque del modelo). La barra se repinta entre decodificaciones y el reloj corre, pero en esos tramos la página sigue "sorda". La solución real es mover `detectSurfaces` al Worker (recomendación 5). La latencia en p50/p90 sólo mide los ratos en que el hilo está libre (muchos), por eso casi no cambia. Capturas: `docs/qa-capturas/progreso-*.png` (s2 a 4×; las de "Analizando" y "Buscando" se sacaron antes de ajustar las constantes finales de la cota, el texto de la cota se ve más alto que el definitivo).

Otros dos arreglos de `docs/QA-MOVIL.md` (#5 "Volver a lo detectado" y #6 "Sacar un objeto" sin color) quedan descriptos allí.

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
4. **Pantalla de progreso honesta** (HECHO, ver sección 1 bis): con los tiempos de arriba, el usuario de gama media esperaba 1,5 a 3 min (ahora ~1 a 1,7 min, ver sección 1). Mostrar etapas ("bajando el modelo", "analizando", "buscando paredes N/56") y avisar que la primera vez tarda más. Sin riesgo; no cambia los tiempos.
5. **Mover la detección al Worker** (libera la interfaz): mejora de UX alta, sin acelerar; riesgo bajo-medio.
6. **Reducir decodificaciones y trabajo JS del post-proceso** (hecho en parte: 36→23 y 56→25 decodificaciones, `cleanMask` 5× más rápido; el JS del hilo principal sigue siendo 35–50 % de la detección): es la palanca que más mueve el total en fotos pesadas.
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
- Re-medición del pipeline actual (sección 1): las fotos s1 y s2 hacen ahora 23 y 25 decodificaciones; sólo se midieron esas 3 fotos, no las 49. El contenedor tenía load average 8–13 (otros agentes), así que 1× es ruidoso (dispersión hasta 12 %) y la mediana de 2 corridas es el promedio. "Antes" y "ahora" no se corrieron en la misma sesión ni con la misma carga.
- Latencias del hilo principal y capturas: Chromium con perfil de iPhone 13, no WebKit; no se probó en iOS ni en un celular real. La cuota de cgroup no reproduce thermal throttling.
