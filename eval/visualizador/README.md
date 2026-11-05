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
