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
