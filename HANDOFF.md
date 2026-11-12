# HANDOFF — pintureria-ia (leer completo antes de tocar nada)

Estado al **2026-11-12**. Lo escribió la sesión que trabajó desde la cuenta de Claude de Agustín para que Ginés siga **desde su propia cuenta**.
La versión anterior de este archivo (2026-11-04) está en el historial de git.

## Qué es
Web/PWA para pinturerías (multi-cliente). Cliente real: **Plaza Olmos Pinturerías** (Río Cuarto/Chivilcoy, representantes de Tersuave).
- **Tienda** (catálogo + carrito + panel admin) hecha por **Tomás** (rama `frontend`, guía en `docs/FRONTEND-TOMAS.md`), ya integrada en `main`.
- **Decorador virtual** ("Probar color"): el cliente saca o elige UNA foto y elige colores. **Requisito de Ginés: cero herramientas manuales**;
  el modelo tiene que acertar solo. La foto va a un servidor con GPU (SAM 3 en RunPod), vuelve un mapa de paredes/techo y la app
  recolorea en LAB (sin IA generativa, ~3 s con el servidor caliente).
- **Asesor IA** (etapa G): NO empezado.

## Dónde está cada cosa
| Qué | Dónde |
|---|---|
| Repo | github.com/juanginessalusso-svg/pintureria-ia — copia local en `C:\Users\Admin\Desktop\pintureria-ia` |
| Rama de trabajo local | `mejora-deteccion` (= `main`). Para desplegar: `git push origin HEAD:main` |
| Trabajo a medias | rama **`wip-halo-portero`** (ver "Lo que quedó a medias") |
| Staging | https://pintu.solucionesdev.online/?tenant=plazaolmos — versión en `/api/health` |
| Servidor SAM 3 | RunPod serverless `pintureria-sam3` (id `wmkz1m9ytxm7ey`), código en `servidor-sam3/` |
| Set de regresión (fotos reales, NO en git) | `C:\Users\Admin\Desktop\Comunicacion Digital Avanzada\regresion` (50 fotos, 50 mapas, 22 etiquetas a mano) |
| Fotos de internet (licencias) | `C:\Users\Admin\Desktop\Comunicacion Digital Avanzada\fotos-web` (61 fotos + `LICENCIAS.json`) |
| Hojas comparativas viejas | `C:\Users\Admin\Desktop\Comunicacion Digital Avanzada\comparativas-sam3` |

## Cómo funciona la detección (de punta a punta)
1. **App** (`apps/web/src/Visualizer.jsx`): al abrir la página llama a `/api/public/segmentar/despertar` (prende la GPU mientras el
   cliente saca la foto: el arranque en frío tarda 20-80 s). Con la foto llama a `/api/public/segmentar` (`apps/web/src/servidor.js`,
   `sam.worker.js`). MobileSAM solo se carga con `?ajustes=1` / `?dataset=1` o si el servidor falla. `?servidor=0` lo apaga.
2. **API** (`apps/api/src/segmentador.js`, `routes/public.js`): intermediario a RunPod (runsync + poll, plazo 55 s, 20 fotos/10 min por IP).
   Necesita `RUNPOD_API_KEY` y `RUNPOD_ENDPOINT_ID` en `/opt/pintureria-ia/.env` del VPS. `/segmentar/diag?textos=` solo en staging.
3. **Servidor** (`servidor-sam3/app.py`, `handler.py`): SAM 3 con 15 textos ("painted wall", "wall", "ceiling", "tile", "tiled wall",
   "mirror", "wallpaper", "stucco wall", "brick wall", "sky", "garage door", "pergola", "facade", "baseboard", "skirting board") + el
   modelo propio r9 como segunda opinión. Devuelve un PNG RGB: **R** = clase (0 otro / 1 pared / 2 techo), **G** = número de pared
   (instancias), **B** = 255 donde una regla sacó algo a propósito (azulejo, zócalo, cielo…: la app no lo rellena).
   Reglas en `clases()` (ver el código). Vision features una sola vez para todos los textos (~3 s en GPU).
4. **App, post-proceso** (`packages/core`, en este orden, en `servidor.js` y `detect.js`):
   `superficiesDesdeMapa` (paredes por instancia) → `rellenarBordes` (cierra los bordes blancos que deja SAM, respeta el veto y no se
   mete en objetos claros encerrados: llave de luz, tapas) → `afinarLimites` (el límite entre dos muros va sobre la arista, watershed por
   color) → `marcarZocalos` (zócalo de otro color = superficie aparte "Zócalo", no se pinta con la pared).
   Al pintar: `featherCapas` (sin línea sin pintar entre dos superficies).

**Cambios en el servidor** (`servidor-sam3/`): hacer push a `main` NO alcanza. Hay que crear un **Release en GitHub** (último: `sam3-v10`)
y RunPod reconstruye la imagen. Si queda un worker "Outdated" en loop: max workers 0 → guardar → 1. Base `pytorch 2.6.0` (con 2.5.1 no carga).

## Cómo probar un cambio del detector (OBLIGATORIO antes de desplegar)
Ginés juzga por la **foto final pintada**, no por métricas del modelo solo. Siempre comparar contra el set de regresión:
```bash
cd /c/Users/Admin/Desktop/pintureria-ia
bash eval/regresion/correr.sh despues                  # con tu cambio
python -I eval/regresion/medir.py base-469e61a despues  # contra lo que está en staging
```
`medir.py` da, en las 22 fotos con etiqueta a mano, **cubre** (% de la pared real que se ofrece para pintar) y **mal** (% de la foto
pintado donde no va), marca `<-- PEOR` por foto, y arma una hoja `salidas/<despues>-vs-<antes>.jpg` (magenta = ahora se pinta y antes no,
amarillo = al revés). Mirar la hoja SIEMPRE. La corrida **`base-469e61a`** = lo que está en staging.
Si cambia el servidor, volver a bajar los mapas: borrar `regresion/maps/` y `bash eval/regresion/bajar-mapas.sh` (~25 min por el límite).
Una sola foto: `MODELS_DIR=x OPTS='{"semantico":{"directo":true}}' CLASSMAP_PNG=<mapa.png> PINTAR="#1f3a5f,#2e6b3f" MASCARA=1 node eval/visualizador/una-foto.mjs <foto>`.
Tests: `cd packages/core && node --test` (196) · `cd apps/api && node --test` (30) · `npm run build -w apps/web`.

## Lo que quedó a medias
**Halo blanco alrededor del portero eléctrico** (foto `regresion/fotos/portero.jpg`). SAM 3 deja un margen ancho alrededor del aparato y
del cable; `rellenarBordes` solo cierra ~1 % del lado mayor y la pared dentro del rulo del cable queda encerrada. En la rama
`wip-halo-portero` hay un intento (la pared crece hasta 2 % pero frena si la luz salta o se pone más clara que la pared de origen):
arregla la llave pegada a la puerta, pero el halo casi no mejora y en `c03` se pierde ~1 % pintado. **No desplegar así.**
Resultado contra el set completo: `regresion/salidas/wip-halo-vs-base-469e61a.jpg` y la sección "Números".
Ideas: segunda pasada que pinte lo encerrado si es plano y del color de la pared vecina; o pedirle a SAM 3 el aparato ("intercom",
"cable") y pintar todo lo demás del margen.

## Fallas abiertas del modelo (por prioridad)
- Puerta crema tomada como pared (`w63` de fotos-web); puerta y alero pintados en fachadas (`w57`).
- Techo de azulejo (`w34`); paneles con relieve (`w55`); papel tapiz parcial y marco de puerta rojo (`w29`).
- Halo alrededor de objetos grandes (portero, tablero).

## Bloqueos y cosas de cuentas (las hace Ginés)
- **GitHub Actions bloqueado por presupuesto**: los presupuestos de la cuenta están en US$0 con "Usage blocked" y GitHub no deja
  editarlos ni borrarlos sin tarjeta (la tarjeta fue rechazada). Mientras tanto se despliega **haciendo el repo público un rato**
  (Actions es gratis en repos públicos) y volviéndolo a privado. Solución de fondo: cargar otra tarjeta o PayPal y poner tope de US$5
  con "stop usage". **El repo quedó PÚBLICO al 2026-11-12: volverlo a privado** (Settings → Danger Zone → Change visibility).
- RunPod: US$10 cargados; decenas de fotos cuestan centavos. Caliente 2,3-3 s por foto.
- Seguridad antes del **2026-11-20**: 2FA en GitHub y borrar del disco la clave de deploy de CI. La conexión GitHub de RunPod tiene
  acceso a todos los repos de Ginés (limitarla).
- Privacidad: la app dice "no la guardamos", pero RunPod retiene los trabajos un rato: revisar el texto.
- Permiso de Tersuave para el contenido del asistente técnico (ya visible en staging) y para la carta de colores.

## Plan siguiente
1. Terminar el halo de objetos y las fallas abiertas, siempre midiendo con `eval/regresion`.
2. Producción: dominio propio, sacar `?tenant=`, datos reales de Plaza Olmos (productos, precios, las 5 sucursales que faltan).
3. Asesor IA (etapa G).
4. Opcional: comparar GPU 24 GB / 4090 en RunPod (velocidad vs costo).

## Cómo trabajar con Ginés
Español argentino informal. Explicar cada comando de terminal y dar los `sudo` de a uno. Preguntar antes si hay tradeoffs.
Claves, tokens, pagos y cambios de cuenta los hace Ginés (nunca escribirlos por él). Mostrar resultados con **hojas comparativas**.
El VPS (DonWeb, 1 GB RAM, compartido con n8n) se toca por SSH desde la PC de Ginés (puerto 5508, usuario `gines`); el WiFi de su casa
a veces bloquea ese puerto (usar el hotspot del celu).

## Números
Corrida del 2026-11-12 (`python -I eval/regresion/medir.py base-469e61a wip-halo`), 22 fotos con etiqueta a mano:

| Corrida | cubre (más es mejor) | pinta mal (menos es mejor) |
|---|---|---|
| `base-469e61a` (staging) | 98,8 % | 4,33 % de la foto |
| `wip-halo` (rama a medias) | 98,6 % | 4,00 % de la foto |

**Ojo con el promedio de "pinta mal":** lo inflan 4 fotos (`p20261106180754` 22,6 %, `p20261107195408` 24,7 %, `p20261107195725` 22,0 %,
`p20261106224008` 10,4 %). Lo primero es mirar esas 4: o la app pinta algo grande que no va (¿techo, mueble?) o la etiqueta a mano
solo marca paredes y no el techo. Sin ellas el error es ~0,3-2 % por foto. Resolver eso antes de confiar en el promedio.
