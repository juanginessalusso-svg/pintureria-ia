#!/bin/bash
# Corre la detección REAL de la app (modo servidor, con los mapas ya bajados) sobre todas las fotos del set de regresión.
# Uso (desde la raíz del repo):  bash eval/regresion/correr.sh <nombre-corrida>
# Deja en $REG/salidas/<nombre-corrida>/: mascara-<foto>.png (80 pared, 160 techo, 240 zócalo) y pintado-<foto>-1.png (paredes azul, techo verde).
# REG = carpeta del set (fotos/, maps/, etiq/). No está en el repo porque son fotos de casas reales.
REG="${REG:-/c/Users/Admin/Desktop/Comunicacion Digital Avanzada/regresion}"
OUT="$REG/salidas/${1:?falta el nombre de la corrida}"; mkdir -p "$OUT"
for f in "$REG"/fotos/*; do
  n=$(basename "$f"); n=${n%.*}
  [ -s "$REG/maps/$n.png" ] || { echo "$n: sin mapa (bajar con eval/regresion/bajar-mapas.sh)"; continue; }
  MODELS_DIR=x MASCARA=1 OPTS='{"semantico":{"directo":true}}' CLASSMAP_PNG="$REG/maps/$n.png" OUT="$OUT" PINTAR="#1f3a5f,#2e6b3f" \
    node eval/visualizador/una-foto.mjs "$f" < /dev/null 2>&1 | head -1
done
