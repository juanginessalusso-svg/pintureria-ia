# QA del visualizador en móvil emulado

Fecha: 2026-11-05 · base `ba7c067` (rama `auto-superficies`) · app servida local con el tenant demo.

## Cómo se probó

- Playwright (Chromium) con `devices['iPhone 13']` (390×664 efectivo en la captura, `hasTouch`, `isMobile`) y `devices['Pixel 5']` (393 px de ancho).
- Toques con `page.touchscreen.tap`; arrastre, pincel, borrador y pellizco con `Input.dispatchTouchEvent` por CDP (1 y 2 dedos).
- Fotos: `r4-pasillo` (4 superficies: pared izquierda, del medio, derecha, techo) en iPhone 13, `r2-ventanal-tv` (3 superficies) en Pixel 5; `s1` como "otra foto".
- Los scripts no se versionan (viven fuera del repo); los pasos están abajo para repetirlos a mano.

## Pasos recorridos (los dos dispositivos)

1. Abrir la app, sin scroll horizontal. **Falló en 390 px** (bug 1, arreglado).
2. Subir foto desde la galería: espera al modelo, "Analizando…", "Buscando paredes y techo…", "Listo: detecté N superficies". ~40 s en esta máquina.
3. Elegir un color: se pinta la pared seleccionada (la más grande). OK.
4. Tocar otras superficies en la foto (barrido de 8 puntos): se selecciona la superficie correcta y el scroll de la página no se mueve. OK.
5. Segundo color a otra superficie: cada una conserva el suyo. OK.
6. "Mantené para ver el antes" con touch real: muestra la original y al soltar vuelve; también con `touchcancel` (no queda trabado). OK.
7. "✂️ Sacar un objeto" sobre una superficie y "Deshacer": en r4 sacó el objeto y Deshacer restauró la máscara exacta; en r2 SAM devolvió una selección demasiado grande y la app lo dijo con un mensaje claro (sin cambios). OK.
8. "Ajustar a mano": pincel, borrador, deshacer (varios niveles), Mover, "Es pared" (punto de SAM), "Confirmar superficie nueva" (creó "Pared 4"), "Volver a lo detectado", volver al modo automático. "Sacar un objeto" no aparece en modo manual. OK.
9. Zoom por botones (+ ×3 → 3,4×), pellizco con 2 dedos (hasta 8×), arrastre con un dedo, toque con zoom (cae en la superficie que está debajo del dedo), "Ajustar" vuelve a 1×. OK.
10. Descargar: PNG de 1200×1600; se verificó por píxeles que no hay puntos verdes/rojos de selección ni línea de calibración, incluso con un punto de SAM activo. OK.
11. Calculadora: calibrar con 2 toques (preset "puerta"), m² calculados (9,7 m² en r4; 12,2 m² en r2), elegir producto, litros y latas. OK.
12. Cargar OTRA foto: lista de superficies, zoom, calibración, resultado y m² se reinician. Había dos restos (bug 2, arreglado).
13. Carrera: foto nueva a los 4 s de empezar a analizar la anterior; quedó sólo el resultado de la segunda (también 60 s después). OK.
14. Consola: sin errores; sólo un aviso de Chromium sobre `willReadFrequently` en un canvas.

Capturas en `docs/qa-capturas/` (livianas, 500 px de ancho):
`iphone13-r4-01-detectado.jpg`, `-02-color`, `-03-segunda-superficie`, `-04-pincel`, `-05-zoom`, `-06-calibracion`; `pixel5-r2-01-dos-colores`, `-02-calculadora`, `-03-otra-foto`.

## Bugs

| # | Gravedad | Estado | Descripción |
|---|----------|--------|-------------|
| 1 | Media | Arreglado (`50ae3f6`) | En 390 px la lista de Superficies ensanchaba la página a 426 px (los hijos de las `.card` en grilla no podían achicarse; el borde derecho y las ✕ quedaban cortados y el navegador móvil alejaba el zoom). Fix: `.card > * { min-width: 0 }`. Verificado: 390/390 y 393/393. |
| 2 | Baja | Arreglado (`f5d8adb`) | Al cambiar de foto quedaba el color elegido: "Descargar" y "Mantené para ver el antes" seguían habilitados sin nada pintado, y la calculadora conservaba los m² a mano y el sumar/restar de la foto anterior. Ahora se reinician (la calculadora con `key` por foto, así que también pide elegir el producto de nuevo). |
| 3 | Baja | Arreglado (`efddae4`) | La calculadora decía "Primero marcá la pared en la foto", pero en el flujo automático la escala se habilita al pintar una superficie. |
| 4 | Media (UX) | Pendiente | En móvil la foto queda arriba y la carta de colores ~1000 px más abajo (después de la lista de superficies): al elegir un color no se ve el resultado sin hacer scroll. Hace falta una decisión de diseño (foto fija/miniatura, o la carta en un panel inferior); no se tocó. |
| 5 | Baja (UX) | Pendiente | "Volver a lo detectado" descarta todos los colores ya aplicados sin avisar, y entonces la calibración queda bloqueada (no hay pared pintada). Conviene un aviso o conservar los colores. |
| 6 | Baja | Pendiente | "Sacar un objeto" sobre una superficie sin color responde "Listo: saqué ese objeto" pero no se ve ningún cambio hasta pintarla. |
| 7 | Baja | Pendiente | La calibración queda sin sentido si se cambia la superficie pintada después; no se recalcula ni se avisa. No se profundizó. |

Refactor pedido: la decisión de "Sacar un objeto" (sin solape / vacía / ≥ 85 % de la superficie / > 60 % de su área) vive ahora en `packages/core/src/cutobject.js` (`cutObjectFromSurface`), con 10 tests en `packages/core/test/cutobject.test.js`. El componente sólo la llama (`e30408f`). `npm test` pasa en api, web y core.

## Lo que NO se pudo probar

- **iOS Safari real**: el emulador es Chromium con el user agent y viewport de iPhone. No cubre WebKit (WASM/SIMD y threads, `OffscreenCanvas`, `createImageBitmap` con EXIF, `capture="environment"`, descarga de PNG con `a.click()`, hoja de compartir, barra de direcciones que cambia el alto del viewport, rebote del scroll).
- **Dedos reales**: los gestos son eventos sintéticos perfectos (sin temblor, sin palma apoyada, sin retardo de 300 ms ni toques fantasma). El pellizco y el pincel con dos dedos reales pueden comportarse distinto; el menú contextual de pulsación larga sobre "Mantené para ver el antes" no existe en el emulador.
- **Rendimiento y memoria en un celular real**: el análisis (~40 s) se midió en una máquina compartida. La memoria no se pudo concluir: el heap de JS quedó plano (3 MB) en 6 cambios de foto, pero las fotos viven en `ArrayBuffer`/WASM fuera de ese contador. Sin medición de RAM total ni de la tasa de cierre del navegador en un teléfono de gama baja.
- Orientación horizontal, teclado virtual sobre los campos de la calculadora, WhatsApp real, "Compartir con la imagen" (`navigator.share`).
