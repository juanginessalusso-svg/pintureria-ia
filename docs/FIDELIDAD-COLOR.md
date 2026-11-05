# Fidelidad de color del visualizador

Pregunta del dueño: "que sea fiel a la realidad". Este documento mide **cuánto se parece el color que se ve en pantalla sobre la
pared al color de la carta Tersuave** (hex de la carta), y dice qué se puede y qué NO se puede concluir con los datos que hay hoy.

> **Resumen en cinco líneas**
> 1. Con la configuración "cruda" (`relative`, sin balance de blancos) el color medio de la pared pintada coincide con la carta:
>    ΔE00 mediano **0,5** sobre 24 paredes x 60 colores (en paredes bien expuestas 0,2).
> 2. **Pero la app arranca con el balance de blancos activado** y con eso el ΔE00 mediano sube a **5,8** (p90 14,3): el balance
>    tiñe el color con la dominante de la foto. Es parcialmente intencional (la pintura se ve con la luz del ambiente), pero con una
>    pared que ya tiene color (verde, azul) es un error: ΔE00 mediano 11,4 y hasta 24.
> 3. El modo `pure` no sirve para fidelidad de color: ΔE00 mediano 17 (conserva la luminancia de la pared, el color sale pastel/lavado).
> 4. Lo que no se llega a reproducir: colores muy claros (L* ≥ 88, el blanco sobre todo) por el tope `maxL`, y **cualquier color sobre una
>    pared en sombra o con degradé fuerte** por el piso `minWallL` y el tope: la media queda hasta 15-20 L* por debajo de la carta.
> 5. **Sin pares reales "foto antes / foto con la pared pintada con código conocido" no se puede saber si la app es fiel a la realidad.**
>    Todo lo de acá mide fidelidad *al hex de la carta*, no a la pintura real (ver "Qué NO se puede concluir").

## 1. Metodología

**Métrica.** `ΔE00(color de la carta, color medio del resultado dentro de la región pintada)`, CIEDE2000 (kL=kC=kH=1).
Implementación en `packages/core/src/deltae.js`, verificada contra 20 pares de la tabla de Sharma, Wu y Dalal (2005) a 4 decimales
(`packages/core/test/deltae.test.js`). Referencia: ΔE00 ≈ 1 apenas perceptible, 2-3 se nota lado a lado, > 5 se ve claramente distinto.
El "color medio" es el promedio en LAB de los píxeles del interior de la máscara (se erosionan 2 px para no medir el borde), con
intensidad 1 y sin difuminar el borde.

**Paredes (24).**
- 8 sintéticas: neutra clara (L*≈72), neutra media (55), en sombra (35), cálida (b*≈+17), degradé (L* 85→35), verde y azul con resto
  del ambiente neutro, y verde que ocupa todo el cuadro (peor caso del balance de blancos).
- 14 reales: máscaras de `eval/visualizador/verdad/*.json` (estado **borrador**, generadas por el detector y no revisadas a mano) de
  r1, r2, r3, r4, s1, s2, s3, t4, t5; más 2 rectángulos a mano en o01 (pared izquierda y pared derecha en sombra).
- 2 reales **teñidas**: la pared de r1 con a*/b* corridos a verde y a azul (mismas luces y sombras, resto de la foto intacto). Sirven
  porque la luz real de la foto es conocida (la de r1 original) y entonces se puede saber si el balance de blancos se equivoca.
- Las fotos se reducen a ~400 px de ancho (promedio por bloques); las medias no cambian con la resolución.

**Tipo de pared** (regla automática sobre la pared original, ver la lista impresa por el script): *degradé fuerte* si p95−p5 de L* ≥ 30;
*en sombra* si L* mediano < 55; *cálida* si b* medio ≥ 10; *de color* (verde/azul, las tres construidas a propósito); si no, *bien expuesta*.

**Colores (60 de los 1.617).** Por familia (14) los de luminosidad en los cuantiles 4, 34, 66 y 96 % (56), más los 2 más oscuros, los
2 más claros y los 6 de mayor croma. Incluye el blanco (L*=100), negros y los más saturados. Lista exacta: la imprime el script.

**Configuraciones.** Modo `relative` y `pure`; balance de blancos `no`, `foto` (gray-world sobre toda la foto, `maxGain` 1,35: lo que hace
la app) y `sin pared` (gray-world ignorando la pared a pintar, opción nueva `exclude`). Intensidad 1. `minWallL`=45 y `maxL`=98 (defaults).

**Suposiciones.**
- El hex de la carta es el color "verdadero" de la pintura y la pantalla lo muestra como sRGB (D65, gamma sRGB, sin gestión de color del
  dispositivo). Las fotos se interpretan como sRGB. El brillo y el perfil de la pantalla del cliente no se miden.
- Se compara contra el hex, no contra la pintura seca en la pared: las cartas impresas/en pantalla ya difieren de la pintura aplicada.
- "Ideal físico" para la sombra (columna `sdL/ideal`): Y_nuevo = Y_color x (Y_píxel / Y_medio_pared), es decir, la pintura nueva bajo la
  misma luz. Es un modelo mío, no una medición.

## 2. Resultados (ΔE00: mediana / p90 / máx; 60 colores x paredes de cada tipo)

Modo `relative`, el que usa la app:

| Tipo de pared (n) | Sin balance | Balance "foto" (default de la app) | Balance "sin pared" |
|---|---|---|---|
| Bien expuesta (4) | 0,2 / 3,3 / 8,5 | 2,1 / 5,4 / 9,3 | 1,9 / 5,6 / 9,7 |
| Cálida (5) | 0,3 / 3,6 / 9,6 | 7,6 / 12,6 / 14,4 | 6,0 / 12,2 / 14,5 |
| Degradé fuerte (6) | 0,9 / 12,3 / 21,2 | 3,4 / 12,2 / 20,8 | 4,6 / 13,7 / 20,8 |
| En sombra (4) | 4,2 / 26,9 / 28,0 | 5,9 / 26,9 / 28,3 | 6,0 / 26,9 / 28,3 |
| De color, verde/azul (5) | 0,1 / 0,7 / 4,6 | **11,4 / 17,8 / 24,4** | **0,1 / 3,5 / 6,5** |
| **Todas (24)** | **0,5 / 10,1 / 28,0** | **5,8 / 14,3 / 28,3** | **2,9 / 12,4 / 28,3** |

Modo `pure`: bien expuesta 14,3 / 38,7 / 64,3 · cálida 17,0 / 34,6 / 57,6 · degradé 17,2 / 35,4 / 58,2 · en sombra 26,6 / 51,0 / 61,4 ·
de color 16,6 / 34,5 / 56,2 · todas 17,3 / 39,5 / 64,3 (sin balance; con balance es igual o peor: 18,9 en total). La luminancia media queda
la de la pared (|ΔL*| mediano 22,8), así que casi todo sale pastel o apagado. No es una opción para fidelidad.

Por grupo de color (`relative`, todas las paredes, sin balance):

| Grupo | ΔE00 med / p90 / máx | |ΔL*| med |
|---|---|---|
| Muy clara (L* ≥ 88) | 3,2 / 14,1 / 28,0 | 4,9 |
| Media | 0,4 / 5,2 / 27,2 | 0,4 |
| Muy saturada (C* ≥ 55) | 0,6 / 9,2 / 27,4 | 0,4 |
| Muy oscura (L* ≤ 30) | 0,0 / 0,3 / 8,5 | 0,0 |

Fracción de las combinaciones color x pared con ΔE00 > 3 (relative, sin balance): bien expuesta 12 %, cálida 12 %, degradé fuerte 38 %,
en sombra 53 %, de color 2 %.

Por pared real (relative; sin balance / balance foto): r1 0,6 / 3,0 · r2 izq. 0,7 / 4,0 · r3 0,6 / 4,2 · s1 0,1 / 2,3 · s2 0,1 / 5,5 ·
s3 izq. 0,8 / 3,4 · t4 0,5 / 8,3 · t5 0,3 / 8,8 · o01 izq. 3,0 / 3,6 · o01 der. en sombra 26,4 / 26,7 (medianas).
El script imprime la tabla completa.

## 3. Respuestas a las preguntas concretas

**¿Qué colores no se pueden reproducir sobre una pared dada?**
- **Muy claros (L* ≥ 88).** Son los que más se alejan incluso en una pared bien expuesta, porque el tope `maxL` baja el cociente
  para que lo más claro de la pared (p98) no pase de L*≈98. Peores: Blanco (código 10, L*=100): ΔL* −9,4; "Beso De Nieve" (TS-61070) −4,4;
  "Angelical" (TS-61745) −4,2; Caída (TS-61385), Lujoso (TS-60663), Rocío Helado (TS-61314), Color De Primavera (TS-61277) ≈ −2,4.
- **Un amarillo muy saturado y claro pierde croma**: Amarillo Cálido (código 35, #ffc94f): ΔC* −13 (ΔE00 3,6); Linterna (TS-60913): ΔC* −3,5.
  Las partes más claras de la pared salen del gamut sRGB con ese croma y se reduce el croma de a 15 % (`a*=0,85`, `b*=0,85`, hasta 6 veces).
- **Cualquier color sobre una pared en sombra o con degradé fuerte.** Ahí el piso `minWallL`=45 hace que la pared se trate como
  "al menos L* 45", y el resultado queda por debajo de la carta: en sombra, 5 de los 60 colores pasan ΔE00 5 (mediana entre paredes) —el blanco 8,2,
  Amarillo Cálido 5,7, Beso De Nieve 5,3, Angelical 5,2—, pero sobre la pared más oscura (o01 derecha, L* medio 26) el ΔE00 mediano es 26,4 con 60 colores.
  En degradé fuerte, 18 de 60 colores pasan ΔE00 5; los claros (L* ≥ 90) rondan ΔE00 8-14 (Blanco 13,8; Beso De Nieve 10,9; Angelical 10,8;
  Caída 9,8; Lujoso, Rocío Helado y Color De Primavera 9,7; Velas Marinas 9,6; Durazno Crema 9,6).
- **Los oscuros y los medios se reproducen bien** (ΔE00 mediano 0,0-0,4), salvo en la pared en sombra extrema.
- Un hex de la carta es siempre sRGB, así que ningún color **de la carta** está fuera de gamut por sí mismo: el problema es el desvío de luces y sombras de la pared.

**¿El `relative` conserva tono y luminancia media del color objetivo?** Sí, en paredes razonablemente iluminadas. Tono: Δh mediano 0,02° (p90 0,15°, máx 2,7°) en paredes bien expuestas y cálidas. Luminancia media: |ΔL*| mediano 0,2 en paredes bien expuestas y 0,3 en cálidas. Las excepciones son las
de arriba (muy claros, sombras, degradés).

**¿El gray-world (maxGain 1,35) mejora o empeora la fidelidad en paredes ya de color?** **Empeora mucho.** En las 5 paredes de color,
ΔE00 mediano 0,1 sin balance → **11,4** con el balance de la foto (14,6 en la pared real teñida de verde; 9,2 en la teñida de azul; 13,9
en el peor caso de la pared verde ocupando todo el cuadro). La causa: el balance interpreta el verde de la pared como una luz verdosa
(ganancias 1,15 / 0,76 / 1,23) y después la reaplica al color nuevo. Estimando la luz ignorando la pared (`exclude`), las ganancias vuelven a
~1 / 1 / 1 y el ΔE00 mediano baja a **0,1** (sintéticas) y **2,5** (reales teñidas, igual que la foto original sin teñir: 2,5).
En paredes neutras o cálidas el balance "foto" agrega ΔE00 2-8 contra el hex (bien expuestas 0,2 → 2,1; cálidas 0,3 → 7,6) porque el color
sale con la dominante del ambiente; **eso no se puede calificar de error ni de acierto** sin pares reales (ver más abajo). En t4 y t5 las
ganancias llegan al tope (0,77 / 0,97 / 1,35): la foto es muy cálida y el estimador está saturado.

**¿Qué pasa con el color medio si la pared tiene degradé fuerte?** La media coincide para colores medios y oscuros (ΔE00 mediano 0,6-0,8),
pero **para colores claros no**, y la sombra queda mal repartida. Ejemplo medido: pared sintética con L* 85 (lado claro) → 63 (centro) → 36
(lado oscuro), pintada con Beso De Nieve #f3eadb (L* 93): resultado 100 / 71 / 40; lo que daría la pintura bajo esa luz (modelo físico) es
100 / 90 / 53. Es decir, la media queda ~19 L* más oscura que la carta y el lado en sombra ~13 L* más oscuro: **la sombra se ve exagerada**.
Con un beige (#d9c3a0, L* 80) es 99 / 71 / 40 contra 100 / 77 / 45. Con colores oscuros (#1f3a5f, L* 24) es 34 / 24 / 14 contra 35 / 23 / 9: la
media coincide y el degradé se ve ligeramente **plano** en el lado oscuro (+5 L*). Medida global de dispersión (desvío de L* del resultado
/ desvío del ideal físico): 1,00 para colores medios, 1,07 para muy claros (sombra levemente exagerada) y 0,75 para muy oscuros (sombra
más plana; efecto parcial de la zona lineal de LAB cerca del negro).

**Piso `minWallL` y tope `maxL` (efecto, para decidir con datos).** Probado con `--opts` sobre las mismas 24 paredes:

| Opciones | Pared en sombra (mediana / p90 / máx) | Total (mediana / p90) | Dispersión de L* vs. ideal, en sombra |
|---|---|---|---|
| default (45 / 98) | 4,2 / 26,9 / 28,0 | 0,5 / 10,1 | 0,98 |
| `maxL: 100` | 3,5 / 26,9 / 28,0 | 0,5 / 9,3 | 0,98 |
| `minWallL: 30, maxL: 100` | 0,2 / 7,1 / 19,3 | 0,3 / 5,9 | 1,11 |
| `minWallL: 1` (sin piso) | 0,1 / 8,2 / 20,3 | 0,3 / 6,0 | 1,11 |

Sacar o bajar el piso acerca el color medio a la carta, a costa de **exagerar el contraste de la sombra ~11 % (hasta 21 % en colores muy
claros)**, que es justo el ruido/degradé que el piso se agregó para evitar. Mi lectura: **ΔE00 contra el hex no sirve para elegir entre estos
dos comportamientos**, porque una pared en sombra pintada de blanco *debe* seguir viéndose en sombra; lo correcto lo dirá una foto real
pintada (ver abajo). No se cambiaron los defaults.

## 4. Colores problemáticos (código · nombre de la carta)

Modo `relative`, sin balance, medianas entre paredes (ver `--json` para la lista de las 60 muestras):

- Bien expuestas y cálidas: **10 · Blanco** (ΔE00 5,6; ΔL* −9,4; el código `blanco` es el mismo color), **35 · Amarillo Cálido** (3,6; ΔC* −13),
  **TS-61070 · Beso De Nieve** (2,7), **TS-61745 · Angelical** (2,6), **TS-61000 · Encerado** (2,1), **TS-61385 · Caída**, **TS-60663 · Lujoso**,
  **TS-61314 · Rocío Helado**, **TS-61277 · Color De Primavera** (1,5 cada uno), 1380 · Durazno Crema, TS-60913 · Linterna, TS-61921 · Velas Marinas (1,4).
- En sombra y en degradé fuerte los mismos, más 8-14 de ΔE00 para los claros listados arriba.
- Con el **balance de la foto** el ranking cambia y casi toda la carta sufre en paredes cálidas y de color (ΔE00 mediano 5,8 en total).
- Los 1.557 colores restantes no se midieron individualmente; por lo medido en cada grupo de luminosidad, los de L* ≥ 88 y el rango de
  amarillos/naranjas saturados y claros (L* 80-90, C* > 60) son los que hay que mirar primero. Pasale la carta completa con `--n 1617` para la lista exacta.

## 5. Qué NO se puede concluir (y qué hace falta)

- **No se midió fidelidad a la realidad**, sino a la carta. No hay ninguna pared real pintada con un código conocido. Un ΔE00 bajo contra el
  hex solo prueba que la matemática del recoloreo es coherente (el color medio queda donde se pidió), no que el cliente vaya a ver esa
  pintura en su pared.
- Para **decidir el balance de blancos** (¿teñir con la luz del ambiente o no?) hacen falta pares **antes/después reales de la misma pared,
  misma cámara y luz, con el código de color aplicado**. Hoy el balance "foto" puede ser lo más realista (la pintura real también se ve cálida bajo luz cálida)
  o lo peor (si el estimador se equivoca). Solo se demostró un error sin discusión: pared ya de color.
- Para **el piso de sombra y el tope de claros**, idem: hace falta ver cómo queda realmente una pared en sombra con un color claro.
- Las máscaras de las paredes reales son borradores sin revisar (pueden incluir objetos o bordes); se erosionaron 2 px. Son 9 fotos y ~14
  paredes: sirven para detectar problemas de orden de magnitud, no para afirmar un porcentaje.
- No se midió la pantalla del cliente (brillo, perfil de color, modo noche) ni la diferencia entre cámaras (HDR, balance automático del teléfono,
  compresión). Una foto sobreexpuesta o con HDR agresivo cambia la `L*` de la pared y todo lo de arriba.
- La carta Tersuave publica un hex por código; no hay datos de cómo seca la pintura real (acabado mate/satinado, base, tintometría).

**Pedido concreto al dueño:** 3-5 paredes pintadas con colores distintos (uno claro, uno medio, uno oscuro, uno saturado), con la foto
**antes de pintar y después**, desde el mismo lugar, el mismo teléfono y la misma luz (idealmente con una tarjeta gris/blanca en el
encuadre), y el código de la carta usado. Con eso el mismo script mide ΔE00 "app vs. foto real" y se puede calibrar el balance de blancos,
el piso y el tope con datos.

## 6. Recomendaciones (por impacto)

1. **Pasar `exclude` al estimar el balance de blancos cuando la pared a pintar ya tiene color** (impacto alto, evidencia clara: ΔE00 mediano
   11,4 → 0,1 en sintéticas y 14,6/9,2 → 2,5 en la foto real teñida). `estimateWhiteBalance(img, { exclude })` ya existe (opcional, por defecto
   idéntico). (Hecho: ver 6b, con una política de cuándo aplicarlo.) Antes faltaba integrarlo en `Visualizer.jsx` (hoy calcula las ganancias una sola vez al cargar la foto; habría que recalcularlas por capa con la
   máscara, **un poco dilatada** porque el borde de SAM es impreciso). Ojo: en paredes neutras **no** conviene aplicarlo siempre: en s3 empeora
   (3,4 → 6,6) porque lo que queda del cuadro tiene muebles de color. Hipótesis a validar con pares reales: aplicarlo solo si el croma medio
   de la pared es ≥ ~12; con las 24 paredes de acá no empeora ninguna de forma apreciable con esa condición, pero son pocas.
2. **Conseguir los pares antes/después reales** (sección 5). Es lo que desbloquea las decisiones 3 y 4 con datos.
3. **Decidir qué se promete en pared en sombra o con degradé fuerte**: o se acepta que "una sombra sigue siendo sombra" y se le avisa al
   cliente, o se baja `minWallL` (p. ej. 30) y se sube `maxL` a 100 y se acepta ~11 % más de contraste de sombra (tabla de la sección 3).
   No se cambió el default; ver también que el test de paredes bien expuestas fija el comportamiento actual.
4. **Cuidado con los claros (L* ≥ 88)**: son los que más pierden en paredes bien expuestas (Blanco, Beso De Nieve, Angelical). `maxL: 100`
   los mejora poco (ΔE00 mediano 1,7 → 0,9 en paredes bien expuestas) y casi no tiene riesgo de quemado en ese caso; evaluar junto con el punto 3.
5. **Gamut de amarillos saturados**: reducir el croma en pasos de 0,85 pierde de más (Amarillo Cálido ΔC* −13). Una búsqueda más fina
   (bisección del factor de croma) lo recuperaría en parte; no se implementó para no tocar el lazo caliente de `recolorWall`, que está en
   manos de otro cambio (rendimiento). Impacto bajo: ~3 colores de 60.
6. **No ofrecer el modo `pure` como "fiel"**: ΔE00 mediano 17. Es útil para ver "cómo se vería con la luz de la pared" pero no para comparar con la carta.

## 6b. Política de exclusión del balance de blancos (implementada)

**Qué hace.** `whiteBalanceFor(img, masks, opts)` (`packages/core/src/whitebalance.js`) decide si al estimar la luz (gray-world) se ignoran las superficies
a pintar. `estimateWhiteBalance` y `recolorWall` **no cambiaron** (sin máscaras da exactamente lo de antes). Con máscaras mide, sobre la pared (unión de las
paredes detectadas) y sobre el resto de la foto (sin píxeles quemados/oscuros ni una franja de 4 px alrededor de la pared), el color medio en el plano (a*, b*):

> **excluye la pared si** `distancia(a*b* pared, a*b* resto) ≥ 15` **y** `croma de la pared ≥ 15`.

La distancia sola no alcanza: en s3 y n14 el "resto" del cuadro tiene dominante fuerte (muebles de color) y la pared es gris, así que se parecía a una
pared de color (distancia 12-25) y la exclusión empeoraba (3,7 → 6,2). El veto por croma de la pared (gris: 3-6) lo evita. Si la pared ocupa toda la foto
no hay con qué comparar: decide solo el croma y, si excluye, no queda nada para estimar la luz (ganancias 1,1,1 = sin corrección).

**Datos** (`color-eval.mjs --n 12 --detectadas <máscaras de auto.mjs>`; ΔE00 mediano del color medio vs. hex de la carta, modo `relative`; 24 paredes
del harness + las paredes detectadas por la app en las 49 fotos). Medianas por tipo de pared:

| tipo de pared | sin balance | balance toda la foto (antes) | siempre sin pared | **política** |
|---|---|---|---|---|
| de color (verde/azul, sintéticas y r1 teñida) | 0,1 | 12,1 | 0,1 | **0,1** |
| cálida (sintética + t4/t5/s1) | 0,4 | 6,5 | 5,7 | 5,8 |
| bien expuesta | 0,2 | 2,5 | 2,1 | 2,5 |
| degradé fuerte | 2,4 | 3,8 | 5,0 | 3,8 |
| detectadas por la app | 0,5 | 4,5 | 4,8 | 4,5 |
| **todas** | 0,6 | 4,9 | 4,4 | **4,1** |

La política es mejor que "siempre" y que "nunca" excluir en el total, y no empeora ninguna pared que decide no excluir (es idéntica al comportamiento anterior ahí).

**Margen.** Paredes que excluye (distancia / croma): sintéticas 17,2-21,5 / 19,7-21,5, r1 teñida de azul 24,4 / 21,9 y de verde 29,2 / 32,5, n29 naranja 40,3 / 60,5,
n30 21,9 / 42,5. Paredes que NO excluye aunque tengan distancia alta: s3 12,5-21,9 (croma 3,3-3,5), n14 24,7 (5,5), n10 20,3 (9,9), n32 13,5 (croma 20,9: la distancia
queda 1,5 por debajo de 15; con umbral 12 se excluía y empeoraba 6,9 → 8,0). Margen de croma: 9,9 (n10) vs 19,7 (sintética cálida), dato más ajustado de todos;
margen de distancia: 13,5 (n32) vs 17,2 (sintética azul). Son márgenes de 1,5 a 5 unidades: **con pocas paredes**, no es una frontera robusta.

**Casos donde excluir empeora** (la política los deja como estaban salvo los dos primeros): n29 (naranja) 11,8 → 12,4 y n30 mejora 9,6 → 9,0. En n29 la exclusión no
cambia nada visible: sus píxeles saturados ya los descartaba el criterio `max-min > 120` del balance (ganancias 0,74/0,77/1,35 contra 0,74/0,78/1,35; el cielo
azul de la foto es lo que domina la ganancia). Sin la política, excluir siempre empeora: s3 3,7 → 6,2 (6,4 en la detectada), n14 5,4 → 7,1, n01 1,4 → 2,6, n16 2,9 → 4,1,
n17 1,5 → 2,2, o02 4,1 → 5,0, s2 derecha 4,4 → 5,8.

**En la app** (`Visualizer.jsx`): el balance sigue calculándose al cargar la foto (sirve mientras se detecta); al terminar la detección se recalcula con
`whiteBalanceFor(foto, máscaras de las paredes detectadas)` y se repinta. El checkbox "Corregir balance de blancos" queda igual. Prueba en Chromium móvil emulado (390x844,
`eval/visualizador/tintar-foto.mjs` genera la foto r1 con la pared teñida de verde): sin política las ganancias eran 1,16/0,75/1,25 y el Verde Ilusión (702) salía
verde fluo; con política 1,01/0,96/1,04 y sale el color de la carta. En n21 (pared blanca, distancia 6,3, croma 6,6) no excluye y el resultado es idéntico.
Paredes marcadas a mano no pasan por la política (siguen con el balance de toda la foto).

**Límites.** (1) Todo se mide contra el **hex de la carta**, no contra pintura real; sin pares "foto antes / foto con la pared pintada con código Tersuave conocido" no se
sabe si el balance sobre toda la foto (que parcialmente intenta reproducir la luz del ambiente) o sin él se parece más a lo que ve el cliente. **El dueño debe traer fotos
de paredes ya pintadas con un código conocido** para validar y ajustar los umbrales. (2) Las paredes "de color" del set son 4 sintéticas, 2 teñidas por el harness y 3 reales
(n29, n30, n32); no hay paredes pintadas reales con código conocido. (3) Una pared real cálida bajo luz cálida (t4, t5) no se distingue por estos datos de una pared amarilla;
la política no las excluye porque la distancia con el resto es ~0. (4) El borde de la máscara de SAM es impreciso: se dilata 4 px para excluir.

## 7. Cómo reproducir

Necesita el JSON de la carta (no versionado; formato `{ colores: [{ code, name, family, hex }] }`) y las fotos en `eval/visualizador/fotos/`
(ignoradas por git). No hacen falta los modelos de SAM.

```bash
# Tests (incluye CIEDE2000 contra Sharma 2005 y las pruebas de fidelidad sintéticas)
npm test -w @pintureria/core

# Evaluación completa: 60 colores x 24 paredes x 5 configuraciones (~50 s)
TERSUAVE_JSON=/ruta/a/colores-tersuave.json node eval/visualizador/color-eval.mjs --json /tmp/fidelidad.json

# Solo paredes sintéticas (rápido), otra cantidad de colores, mayor resolución
TERSUAVE_JSON=... node eval/visualizador/color-eval.mjs --sin-reales
TERSUAVE_JSON=... node eval/visualizador/color-eval.mjs --n 200 --ancho 800

# Probar variantes de recolorWall sin tocar el código (opciones extra, p. ej. el piso y el tope de luminancia)
TERSUAVE_JSON=... node eval/visualizador/color-eval.mjs --opts '{"minWallL":30,"maxL":100}'
```

Las tablas de este documento salen de la corrida por defecto (60 colores, ancho 400 px). El script imprime: la lista de paredes con su tipo,
las ganancias de balance de blancos por pared, la tabla por tipo/modo/balance, por grupo de color, por pared y los colores problemáticos.
