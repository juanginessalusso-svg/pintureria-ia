# Informe de prueba de estrés: detección automática de superficies

Base: `ba7c067` (rama `auto-superficies`). No se tocó `surfaces.js` ni ningún código del detector.
Fotos nuevas: `n01`..`n34` (34 archivos, **33 fotos distintas**: `n12` y `n13` son la misma foto bajada de dos bancos, 960 px y 1024 px). Todas CC0, registradas en `fotos-fuentes.json` (autor, licencia, URL).

## Cómo reproducir

```bash
# 1) (opcional) bajar las fotos: ver fotos-fuentes.json (id de Openverse de cada una) y
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node eval/visualizador/buscar-fotos.mjs bajar <id> <nombre-corto>
# 2) correr el detector sobre las n01..n34 (deja salidas/auto-*.png y salidas/pintado-*.png)
MODELS_DIR=$PWD/modelos TERSUAVE_JSON=<ruta>/colores-tersuave.json node eval/visualizador/auto.mjs n0
MODELS_DIR=$PWD/modelos TERSUAVE_JSON=<ruta>/colores-tersuave.json node eval/visualizador/auto.mjs n1   # idem n2, n3
# 3) qué reglas dispararon: DEBUG_FRAMES=1 DEBUG_STRIPS=1 DEBUG_HANG=1 DEBUG_GAPS=1 DEBUG_CORNER=1 DEBUG_PART=1 (misma línea)
# 4) ablaciones: AUTO_OPTS='{"frames":false}' | '{"hang":false}' | '{"thinGaps":false}' | '{"strips":false,"corner":false}'
#    y comparar las áreas por superficie contra la corrida base.
```

## Limitaciones honestas del conjunto

- Openverse (solo `stocksnap` y `rawpixel`) devuelve **previews de ~960 px**, no los originales. El pipeline trabaja a ese tamaño de todos modos, pero no es una foto de celular real.
- Aunque filtré las de revista, la mayoría sigue siendo fotografía de banco de imágenes (buena luz, composición cuidada). No conseguí paredes verdes/azules/amarillas ya pintadas, humedad ni salpicado. Cubrí: dormitorios, baños, pasillos, oficinas, livings, comedor, cocina, obra abandonada, pisos de madera y 6 exteriores. Hay 3 fotos fuera de dominio (n09 pasillo borroso en blanco y negro, n10 arco de piedra, n11 bailarina en arcadas): sirven de estrés, no de caso de uso.
- n=34 sigue siendo chico; los porcentajes son orientativos.
- La primera foto de cada corrida tarda ~125 s (arranque en frío del modelo wasm); el resto 2 a 28 s.

## Tabla por foto

Leyenda: **A** pintura de más (grave) · **B** superficie perdida · **C** pared fusionada/partida mal · **D** bordes sucios · **E** tiempo (decodificaciones). Entre paréntesis, % de la foto.

| Foto | Fuente / licencia | Superficies detectadas | Errores |
|---|---|---|---|
| n01 dormitorio-limpio | Burst · stocksnap CC0 | Pared izq 13.8, Pared der 43.5, Techo 7.3 | **A**: la "pared izquierda" es el vidrio inferior de la ventana (azul) y el "techo" blanquea el vidrio superior; jarrón medio pintado. D: lámpara. Pared derecha bien. |
| n02 dormitorio-vert (bebé, fuera de dominio) | Dakota Corbin · stocksnap CC0 | Pared izq 9.5, Pared der 30.5, Techo 6.1 | **A**: almohada pintada de azul; techo sobre la luz de la ventana. Pared derecha razonable. |
| n03 cama-celular | Matt Bango · stocksnap CC0 | Techo 2.7 | Sin errores: techo inclinado bien; el revestimiento de madera no se pintó (correcto). |
| n04 cuarto-niño | Studio 7042 · stocksnap CC0 | Pared izq 10.1, Pared der 12.5, Techo 19.1 | **C**: la pared derecha sale en dos colores cortados por la repisa. **D**: agujeros alrededor del muñeco colgante. **B**: pared junto a la ventana. Sin A visible. |
| n05 baño-lavabo | Dan Watson · stocksnap CC0 | ninguna | Sin errores (azulejo oscuro: no pintar es aceptable). |
| n06 baño-pared | David Cohen · stocksnap CC0 | ninguna (94.6% descartada, luma 30) | **B**: pared/revestimiento oscuro liso perdido. |
| n07 baño-antiguo | Eneida Nieves · stocksnap CC0 | Pared 20.0 (luma 5) | **A**: pinta la hoja/marco oscuro de la puerta de verde. **B**: pared de adobe. **E**: 59 decodificaciones (26 s). |
| n08 baño-familiar | Bath Time · stocksnap CC0 | Techo 21.8 | **A/C**: la pared blanca del fondo se toma como techo (llevaría el color de techo) y mancha cuadros y borde de la cómoda. **B**: pared real. |
| n09 pasillo-BN (fuera de dominio) | Leeroy · stocksnap CC0 | Pared izq 21.0, Pared der 8.6, Techo 14.8 | **A**: pilar/luminaria sobreexpuestos pintados; borde de techo irregular. |
| n10 pasillo-escalera (fuera de dominio) | Matt Bango · stocksnap CC0 | Pared izq 3.1, Pared der 6.8 | **A**: puerta oscura pintada de verde y vidrio de azul. **B**: muros de piedra. |
| n11 pasillo-edificio (bailarina, fuera de dominio) | Saksham Gangwar · stocksnap CC0 | 3 paredes 9.7 / 38.0 / 7.9 | **A grave**: columnas y arcos de piedra pintados (3 colores). **E**: 48 decodificaciones. |
| n12 obra-reforma | Nolan Issac · stocksnap CC0 | Pared 22.4, Techo 16.8 | Pared central bien. **A**: puerta izquierda parcial, franjas sobre la puerta derecha, interruptor, zócalo. **D**. |
| n13 cuarto-abandonado (misma foto que n12) | rawpixel CC0 | Techo 17.3 | **B**: la pared que en n12 sí salió, acá no. Resultado distinto con 1024 px en vez de 960 px (inestabilidad). |
| n14 living-refacción | National Park Service · rawpixel CC0 | Pared 1 38.6, P2 5.2, P3 6.3, P4 14.4 | Paredes grandes bien (buen caso). **A**: el marco blanco de la puerta se pintó de terracota (P3). **C/D**: pared del fondo gris-verdoso por la abertura; parche blanco abajo en la pared azul; zócalo parcial. |
| n15 oficina-casa (primer plano de escritorio, fuera de dominio) | Design by Matt · stocksnap CC0 | Pared 49.4, Techo 16.9 | **A grave**: la **tapa del escritorio** se pinta como pared; teclado y mouse recortados a medias. |
| n16 oficina-casa2 | Kristin Hardwick · stocksnap CC0 | Pared izq 15.6, medio 5.9, der 6.8 | **A**: lámpara, globo y cartel con relleno de huecos; borde del escritorio. **C**: la pared izquierda sale en dos colores. Pared der bien. |
| n17 oficina-casa3 | Matt Bango · stocksnap CC0 | Pared izq 7.6, medio 17.9, der 6.2 | **A grave**: pinta los **vidrios de la ventana** (cielo y edificios) con 3 colores (31.7% de la foto). Las paredes reales no. |
| n18 living | Dan Gold · stocksnap CC0 | Techo 5.7 | **B**: panel de pared gris liso perdido; parte de la pared tomada como techo. |
| n19 interior-casa (sillón naranja) | Tim Wright · stocksnap CC0 | Pared izq 6.7, Pared der 33.5 | **A**: la "pared izquierda" es una **puerta blanca**; piso/alfombra bajo el sillón y lámpara/cuadros (por relleno de huecos). Pared derecha buena en general. |
| n20 interior-casa2 (sillón oscuro) | D. Truckenmiller · stocksnap CC0 | Pared 6.6, Techo 7.2 | **A**: cortina oscura pintada de verde; ventana trasera blanqueada como techo. |
| n21 cuarto-blanco (oficina) | Breather · stocksnap CC0 | Pared izq 6.9, medio 3.3, der 16.1, Techo 9.8 | Resultado mixto/decente. **A**: aire acondicionado y mancha verde junto a la bandeja. **C**: pared del fondo en 3 colores. **B**: gran pared izquierda con ventanas. Cuadros y estante bien respetados. |
| n22 comedor | Kelly Ishmael · stocksnap CC0 | ninguna | Sin errores graves (ventanales, nada que pintar). |
| n23 cocina-vert | Matt Bango · stocksnap CC0 | Techo 30.6 | Techo de tablas bien. **B**: paneles blancos de pared. |
| n24 piso-madera (pasillo de hormigón) | Jay Mantri · stocksnap CC0 | Techo 10.9 | **A leve**: el "techo" cubre parte de la pared izquierda sobreexpuesta. |
| n25 fachada-vert (ladrillo) | Matt Bango · stocksnap CC0 | ninguna | Correcto: no pintó ladrillo, ventanas ni puerta. **B** leve: arco blanco del portal. |
| n26 edificio-vert | Matt Bango · stocksnap CC0 | Techo 13.9 | **A grave**: pinta el **cielo**. **B**: la fachada blanca/beige. |
| n27 pared-exterior | Mike Moloney · stocksnap CC0 | Techo 27.4 | **A grave**: pinta el **cielo** (cálido). **B**: pared de ladrillo blanco. |
| n28 casa-exterior | Daniel Frank · stocksnap CC0 | ninguna | **B**: fachada blanca con enredadera. Sin pintura de más. |
| n29 exterior-color | Bob Richards · stocksnap CC0 | Pared 39.0, Techo 5.3 | Muy buen caso: pared naranja bien pintada. **A**: persiana de una ventana blanqueada (techo). **D**: escalón abajo a la izquierda; **B**: pared abajo a la derecha. |
| n30 edificio-viejo | Matt Bango · stocksnap CC0 | Techo 14.2 | **A grave**: pinta el **cielo** de rosa. **B**: fachada salmón (caso ideal) perdida. |
| n31 casa-ladrillo | rawpixel CC0 | ninguna | Correcto (ladrillo y puerta sin pintar). |
| n32 piso-madera-casa | rawpixel CC0 | Pared izq 30.9, Pared der 9.9, Techo 13.4 | **Mejor resultado del lote**: paredes bien separadas del marco, zócalo y puerta de paso. **D**: bordes con huecos junto a la abertura. |
| n33 interior-comedor | Kristin Hardwick · stocksnap CC0 | Pared 1 5.9, P2 8.5, P3 16.1, P4 5.8, Techo 6.0 | **A**: espejo "sol", lámpara colgante y jarrón teñidos. **C**: pared en 4 colores. **B**: parche sin pintar sobre el espejo. **E**: 45 decodificaciones. |
| n34 casa (galería) | Joshua Ness · stocksnap CC0 | Techo 17.3 | **A**: el **techo de madera** se tiñe de gris con borde sucio. **B**: pared de caña. |

## Conteos

- Fotos con al menos un error A: **22 de 34 (65%)**. Sin A: 12, de las cuales 7 son "no detectó nada" (n05, n06, n13, n22, n25, n28, n31). Resultados realmente buenos (pared principal bien y sin A grave): **n03, n32, n29 (con A leve), n14 (con A de marco), n12 (con A leve)**.
- Falsos positivos (A) por tipo, en fotos afectadas:
  - cielo: 3 (n26, n27, n30)
  - ventana/vidrio/persiana: 5 (n01, n17, n20, n29, y n02 por la luz de la ventana)
  - puerta/marco de puerta: 5 (n07, n10, n12, n14, n19)
  - mueble/objeto/decoración: 9 (n02 almohada, n08 cuadros, n15 escritorio, n16 lámpara y globo, n19 lámpara, n21 aire acondicionado, n33 espejo y jarrón, n01 jarrón, n20 cortina)
  - piso/alfombra/zócalo: 2 (n19, n12)
  - techo mal asignado (pared tomada como techo, techo de madera, luz): 5 (n08, n18, n24, n34, n20)
  - piedra/arquitectura (fuera de dominio): 3 (n09, n10, n11)
- B (superficie perdida): ~15 fotos. C (partición mala): n04, n14, n16, n21, n33, n08 (6). D (bordes sucios): ~8. E: tiempos de 2 a 28 s (1 hilo); decodificaciones entre 3 y 59 (medianas ~37 en interiores con pared); los máximos son n07 (59), n11 (48), n21 (47). No es un problema grave salvo fotos con muchas "paredes" falsas.

## Reglas nuevas (calibradas con un caso): ¿dispararon y acertaron?

Para cada una corrí trazas (`DEBUG_*`) en las 34 fotos y ablaciones (`AUTO_OPTS`) sobre 16 fotos donde había actividad (n01, n02, n04, n09, n10, n11, n12, n14, n15, n16, n17, n19, n21, n29, n32, n33).

| Regla | Resultado |
|---|---|
| `findVerticalCorner` (esquina) | **0 disparos** (~50 evaluaciones, ninguna aceptada; motivos más comunes: `techo?`, `signo`, `cobertura`). No hubo falsos positivos pero tampoco un solo verdadero (n01, n04 y n21 tienen esquinas verticales suaves y no se detectaron). Con `corner:false` + `strips:false` el resultado es idéntico en las 16 fotos. Una regla ajustada con un solo caso que no se activa en 34 fotos nuevas es evidencia de sobreajuste (o de umbrales demasiado estrictos), no de que funcione. |
| `addShadowStrips` (franjas) | **0 aceptadas** de ~80 candidatos evaluados. Idéntico: sin efecto. |
| `cutFramesBesideObjects` | Candidatos en 11 fotos; solo cambió el resultado en **n10** (−1.1 y −1.1 puntos de "pared" falsa: puerta y vidrio). Acierto marginal, sin daño. **No** se activó en los casos de marco/puerta que sí fallaron (n14, n19, n12). |
| `hangingSeeds` | 22 semillas aceptadas; con `hang:false` cambian las áreas ≤1.3 puntos en 12 de 16 fotos y se ahorran 1 a 4 decodificaciones. En n01 reduce pintura (jarrón/lámpara), en n04 corre el corte de partición; no evitó el jarrón medio pintado de n01 ni los agujeros de n04. Neutral, levemente positiva, sin evidencia fuerte. |
| `fillThinGaps` | Agregó entre 0.1 y 1.3 puntos en 6 de 16 fotos (n04, n12, n16, n19, n21, n33). Revisé visualmente las 3 con más cambio (`DEBUG_GAPS`, rojo = agregado): **n12** puerta derecha (franjas) y zócalo, **n16** cartel, globo y borde del escritorio, **n19** alfombra/piso bajo el sillón y lámpara. **Las 3 son pintura de más: 0 aciertos en 3 inspeccionadas.** Es la regla que va más contra el criterio del dueño. |

## Los 5 patrones de falla más frecuentes (por cantidad de fotos)

### 1. Pared real perdida (B) — ~15 fotos
n06, n07, n08, n13, n18, n21, n22, n23, n25, n26, n27, n28, n30, n34 y n04 (parcial). Incluye fachadas lisas de color (n30, n26, n27), paredes oscuras (n06, n07) y paneles (n18, n23). Es el patrón menos grave según el criterio del dueño, pero en exteriores es casi total.
- **Causa probable**: etapa de candidatos y filtros previos al SAM (`gradMax`/`free`, `maxTexture`, `minLumaRatio`) y la clasificación pared/techo: la pared oscura queda "descartada" por luma, la fachada con grilla de ventanas no alcanza `minCoverage`, y en n30/n26 el techo (cielo) gana la semilla.
- **Arreglo**: (a) normalizar `minLumaRatio` y textura por percentil de la foto, no absoluto; (b) para exteriores, sembrar con la región de mayor área bajo el cielo en vez de exigir cobertura; (c) si no se detecta nada, mostrar en la app "tocá la pared" en vez de pintar vacío (la UI manual ya existe).

### 2. Cielo, vidrio y luz de ventana tomados como pared/techo — ~10 fotos
n01, n02, n17, n20, n24, n26, n27, n29, n30, n34. Es la falla más peligrosa por área (n17: 31.7%; n27: 27.4% de cielo).
- **Causa**: la clasificación de `techo` es posicional (parte alta, clara, lisa) y no exige una pared debajo; el cielo es la región más lisa y clara de las fotos exteriores. Las ventanas con luz son superficies lisas y claras como una pared blanca.
- **Arreglo**: (a) un candidato `techo` solo vale si comparte una arista larga con una `pared` aceptada; (b) vetar regiones que tocan el borde superior sin pared debajo (cielo) y regiones con >X% de píxeles saturados (>250) o azul/gris claro de baja croma en el tercio superior; (c) vetar candidatos rodeados por un marco oscuro de 3 lados (ventana); (d) para vidrio, rechazar regiones cuyos bordes interiores tienen alto gradiente (reflejos de edificios, ramas).

### 3. Objetos y muebles pintados (A) — ~9 fotos
n02, n08, n15, n16, n19, n21, n33, n01, n20. La tapa del escritorio blanco (n15) y la almohada (n02) son superficies lisas del color de una pared; el aire acondicionado, el espejo y las lámparas se cuelan por el relleno de huecos y las semillas.
- **Causa**: (i) SAM une objetos lisos blancos con la pared; (ii) **`fillThinGaps`** agrega píxeles sobre objetos (3/3 inspeccionadas con error).
- **Arreglo**: (a) poner `thinGaps` en `false` por defecto hasta que se calibre con ≥10 casos, o limitar `maxAdd` a ~0.3% y exigir que el hueco no toque el borde inferior de la máscara ni objetos bloqueados; (b) rechazar regiones con ≥X% de su contorno en contacto con el borde inferior de la foto y con perspectiva horizontal (mesas/escritorios); (c) pasar `objetos` rechazados (n15, n21) como `blocked` también para el relleno.

### 4. Pared partida en varios colores (C) — 6 fotos
n04, n08, n14, n16, n21, n33 (hasta 4 "paredes" en un mismo plano, divididas por repisas, lámparas o cuadros).
- **Causa**: etapa `partition` (cortes por `splitMax`/`splitEdge` y número de núcleos) que interpreta objetos colgados como aristas entre paredes; sin una esquina real que la confirme.
- **Arreglo**: fusionar regiones vecinas con mediana de color/luma similar salvo que el borde que las separe sea recto y largo (≥ alto de pared) o haya un cambio de luma consistente; pintar el mismo color por defecto en todas y dejar que el usuario separe.

### 5. Puertas, marcos y zócalos incluidos como pared (A) — 5 a 6 fotos
n07, n10, n12, n14, n19 (y marcos de ventana en n01/n16).
- **Causa**: el marco/puerta blanca tiene el mismo color que la pared; `cutFramesBesideObjects` solo actúa si hay un objeto detectado al lado, y en estas fotos no disparó.
- **Arreglo**: detectar bandas rectas de 2 a 6% del ancho con doble arista paralela y luma más alta que la mediana de la pared, y restarlas (o sembrar la "pared" solo en el interior); reforzar con vetar regiones cuya forma es un marco (relación hueco/área alta).

### Nota: inestabilidad con el tamaño
n12 y n13 son la misma foto a 960 y 1024 px: una detecta la pared (22.4%) y la otra no. Conviene fijar el tamaño de trabajo del encoder y evaluar la sensibilidad por ±5% de resize.

## Conclusión

El detector respeta el criterio "mejor perder pared que pintar de más" solo parcialmente: **65% de las fotos tienen algún A**, y los peores (cielo, ventanas, escritorio, puertas, columnas) no vienen de las reglas nuevas sino de la clasificación pared/techo y de la unión SAM de superficies lisas. Las dos reglas más específicas (esquina vertical y franjas de sombra) no se activaron nunca: no se pueden validar ni refutar con este lote. `fillThinGaps` es la única nueva que empeora el resultado de forma verificable. Los buenos resultados existen (n32, n03, n29, n14 en la pared principal, n25/n31 sin pintar ladrillo) pero requieren paredes lisas, bien iluminadas y de color claro.
