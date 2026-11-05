# Evaluación del visualizador

Corre el pipeline REAL (MobileSAM + post-proceso de máscara + recoloreo LAB) sobre fotos de prueba, sin navegador.

```bash
# 1) Modelos (una vez): se bajan y se verifica el SHA-256
node apps/api/scripts/fetch-models.mjs ./modelos

# 2) Fotos: poné tus .jpg en eval/visualizador/fotos/  (carpeta ignorada por git: nunca se suben)

# 3) Correr
MODELS_DIR=./modelos node eval/visualizador/run.mjs                 # todos los casos
MODELS_DIR=./modelos node eval/visualizador/run.mjs casos.json 02   # solo los casos cuyo id contiene "02"
```

Cada caso de `casos.json` define una foto, las "paredes" (listas de toques `[x, y, etiqueta]` con coordenadas relativas
0..1; etiqueta 1 = es pared, 0 = no es pared) y los colores a probar. Deja en `salidas/` (ignorada por git) un PNG por
caso: `[ original | selección | color 1 | color 2 … ]`.

Hoy mide: tiempo de análisis, % de la foto cubierto por la pared y la luminancia pared → color. **Falta** (etapa F):
máscaras anotadas a mano para calcular IoU y el error de m² contra una medida real.

## Detección automática (`auto.mjs`): decodificaciones y tiempo

`MODELS_DIR=./modelos node eval/visualizador/auto.mjs [filtro]` imprime por foto `N superficies · D decodificaciones · T ms`, el desglose de tiempo
(SAM / `cleanMask` / resto de JS) y, por superficie, nombre, % de la foto y un `md5` de la máscara (dos corridas con el mismo `md5` dan exactamente lo mismo).

- `AUTO_OPTS='{"patience":0,"partitionOpts":{"skipPlain":false,"dedupe":false,"skipNonWall":false,"edgeEarlyStop":false}}'` apaga las podas de decodificaciones (línea base).
- `MASK_CACHE=dir` guarda cada máscara que devuelve SAM (gzip, por foto y punto) y la reusa: sirve para iterar sobre el JS en ~40 s en vez de ~10 min. Los ms de SAM con caché no son reales.
- `TRACE=archivo.jsonl` deja una línea por decodificación (fase `semillas`/`particion`, puntos, área, ms).

## Regresión automática (`regresion.mjs`) — el freno de mano del loop de mejora
```bash
MODELS_DIR=./modelos node eval/visualizador/regresion.mjs            # compara TODAS las fotos contra la base aprobada (baseline.json); código 1 si algo cambia > 0,3 pts
MODELS_DIR=./modelos node eval/visualizador/regresion.mjs t4 r2      # solo las fotos cuyo nombre contiene t4 o r2
MODELS_DIR=./modelos node eval/visualizador/regresion.mjs --guardar  # actualiza la base con el estado ACTUAL (solo si el cambio está revisado y aprobado)
```
Cada foto sale como `idéntica` (mismo md5 de máscara), `≈ igual` (píxeles distintos pero dentro de la tolerancia), `CAMBIA` (superficie nueva/perdida, nombre distinto o más de 0,3 puntos de diferencia) o `NUEVA (sin base)`. La base es el estado aprobado, **no una verdad anotada**: un `CAMBIA` no es un error por sí mismo, hay que mirar `salidas/pintado-<foto>.png` y decidir. Las fotos nuevas se agregan a la base con `--guardar` una vez revisadas. Las máscaras de SAM se cachean en `salidas/mascaras-cache` (ignorada por git): repetir sin cambios de semillas tarda ~1 min en vez de ~10; si cambian las semillas, SAM se vuelve a correr solo donde hace falta.

## Medida de calidad con "verdad" por rectángulos (`medir-rect.mjs`)

La regresión solo compara contra el estado anterior. Esta medida compara contra **rectángulos anotados a mano** (mirando cada foto) en `verdad-rect/<foto>.json`:

```json
{ "foto": "n15-oficina-casa.jpg", "pared": [[x0,y0,x1,y1,"etiqueta"]], "noPintar": [[x0,y0,x1,y1,"tapa escritorio"]] }
```
Coordenadas relativas 0..1 (valen para cualquier resolución: n12 y n13 son la misma foto y comparten rectángulos). `pared` = zonas que **sin duda** son pared o techo a pintar; `noPintar` = zonas que **jamás** deben pintarse (cielo, vidrios, puertas y marcos, muebles, objetos, piso, zócalos, personas, plantas, cuadros, TV...). Hay 49 archivos. Una foto sin pared inequívoca (azulejo, piedra, ladrillo visto, contraluz) tiene `pared: []`.

Por foto se calcula, sobre la unión de las superficies detectadas (paredes + techo):
- **pinturaDeMás** = % de píxeles de los rectángulos `noPintar` que el detector pintó. Es la métrica que importa (criterio del dueño: pintar de más es peor que dejar pared sin pintar).
- **cobertura** = % de píxeles de los rectángulos `pared` que el detector pintó.

Resumen global: promedio por foto y ponderado por píxeles de ambas, **nº de fotos con pinturaDeMás > 2 %** (`--umbral`) y las 10 peores.

```bash
MODELS_DIR=$PWD/modelos MASK_CACHE=$PWD/eval/visualizador/salidas/mascaras-cache node eval/visualizador/medir-rect.mjs   # corre el detector y mide las 49 fotos (~1 min con caché)
MODELS_DIR=$PWD/modelos node eval/visualizador/medir-rect.mjs n15 t4 --detalle                                           # solo esas fotos; --detalle lista qué rectángulos fallan
node eval/visualizador/medir-rect.mjs --leer --mascaras <dir> --json /tmp/rect.json                                      # no corre el detector: lee máscaras ya volcadas; guarda el JSON completo
```
- `auto.mjs` aprendió `DUMP_MASKS=dir`: escribe `<foto>.json` con `{foto, width, height, superficies:[{nombre, tipo, rle}]}` (RLE de `encodeMask`, como `verdad/*.json`). Sin esa variable no cambia nada. `medir-rect.mjs` la usa por su cuenta (vuelca en `salidas/mascaras-rect`); `--jobs 2` corre dos fotos a la vez (máximo 2: la máquina es compartida).
- `node eval/visualizador/verdad-rect-ver.mjs [filtro] [--out dir]` dibuja los rectángulos sobre cada foto (verde = pared, rojo = noPintar) en `salidas/rect-<foto>.png`, para revisar o corregir la anotación.

**Línea base** (estado `f288557`): pinturaDeMás promedio 12,8 % por foto (10,8 % ponderado por píxeles), **38 de 49 fotos con más de 2 %**; cobertura 76,6 % por foto (93,5 % ponderada; baja por las exteriores, donde no se detecta nada).

**Honestidad sobre la anotación.** Los rectángulos son a ojo, no máscaras: conservadores y bien adentro de cada objeto o pared, sin bordes. La métrica es una **cota inferior** de la pintura de más real (no ve bordes sucios ni objetos que no anoté) y la cobertura solo dice si se pinta el centro de la pared. Criterios opinables: ladrillo visto, hormigón, madera y azulejo se anotaron como `noPintar` (regla "mejor no pintar"); fachadas de color y ladrillo pintado de blanco, como `pared`. Los objetos chicos pegados a la pared (enchufes, luminarias, porteros) cuentan como `noPintar` aunque pintarlos sea inevitable: pesan poco en píxeles. Si un resultado parece raro, abrí `rect-<foto>.png` y corregí el JSON. No decidir cambios por diferencias menores a ~1 punto en el promedio.
