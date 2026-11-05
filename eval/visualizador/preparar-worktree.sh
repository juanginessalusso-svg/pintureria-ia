#!/bin/bash
# Prepara un worktree git para correr el eval, enlazando lo pesado que no está versionado (node_modules, modelos, fotos) SIN tocar el repo principal.
# Uso (desde la RAÍZ del worktree):  bash eval/visualizador/preparar-worktree.sh
# Por qué existe: enlazar `node_modules` entero hace que `@pintureria/core` resuelva al repo principal y el eval corra código ajeno; y pisar
# `node_modules/@pintureria` a través de un enlace reescribe los enlaces del repo principal. Acá `node_modules` es una carpeta propia del worktree.
set -e
PRINC=${PRINCIPAL:-/home/user/pintureria-ia}
[ "$(cd "$PRINC" && pwd -P)" != "$(pwd -P)" ] || { echo "Esto es el repo principal: correlo desde un worktree"; exit 1; }
if [ -L node_modules ]; then rm node_modules; fi
mkdir -p node_modules
for e in "$PRINC"/node_modules/* "$PRINC"/node_modules/.bin; do
  n=$(basename "$e"); [ "$n" = "@pintureria" ] && continue
  [ -e "node_modules/$n" ] || ln -s "$e" "node_modules/$n"
done
if [ -L node_modules/@pintureria ]; then rm node_modules/@pintureria; fi   # nunca se borra su contenido
mkdir -p node_modules/@pintureria
for p in core:packages/core api:apps/api web:apps/web; do n=${p%%:*}; d=${p#*:}; ln -sfn "$PWD/$d" "node_modules/@pintureria/$n"; done
for d in apps/api apps/web packages/core; do
  if [ -d "$PRINC/$d/node_modules" ] && [ ! -e "$d/node_modules" ]; then ln -s "$PRINC/$d/node_modules" "$d/node_modules"; fi
done
[ -e modelos ] || ln -s "$PRINC/modelos" modelos
mkdir -p eval/visualizador/fotos
for f in "$PRINC"/eval/visualizador/fotos/*.jpg "$PRINC"/eval/visualizador/fotos/*.png; do
  [ -e "$f" ] || continue
  [ -e "eval/visualizador/fotos/$(basename "$f")" ] || ln -s "$f" eval/visualizador/fotos/
done
echo "OK: node_modules propio, modelos y $(ls eval/visualizador/fotos | grep -c -E '\.(jpe?g|png)$') fotos enlazadas"
node --input-type=module -e "console.log('@pintureria/core resuelve a:', import.meta.resolve('@pintureria/core'))"
