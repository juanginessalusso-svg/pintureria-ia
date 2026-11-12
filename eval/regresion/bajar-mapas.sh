#!/bin/bash
# Pide al servidor SAM 3 (vía staging) el mapa de cada foto del set que todavía no lo tenga. Volver a correrlo (borrando maps/)
# SOLO cuando cambia el servidor (app.py / handler.py y un Release nuevo en RunPod); si solo cambia la app, los mapas sirven igual.
# Límite de staging: 20 fotos cada 10 min por IP -> una cada 31 s. Costo RunPod: centavos.
REG="${REG:-/c/Users/Admin/Desktop/Comunicacion Digital Avanzada/regresion}"
URL="${URL:-https://pintu.solucionesdev.online}"
mkdir -p "$REG/maps"
curl -s -X POST "$URL/api/public/segmentar/despertar?tenant=plazaolmos" > /dev/null
for f in "$REG"/fotos/*; do
  n=$(basename "$f"); n=${n%.*}; [ -s "$REG/maps/$n.png" ] && continue
  case "$f" in *.png) ct=image/png ;; *) ct=image/jpeg ;; esac
  for t in 1 2 3; do
    c=$(curl -s -o "$REG/maps/$n.png" -w "%{http_code}" -X POST -H "content-type: $ct" --data-binary @"$f" "$URL/api/public/segmentar?tenant=plazaolmos" -m 120)
    [ "$c" = 200 ] && break; rm -f "$REG/maps/$n.png"; sleep 60
  done
  echo "$n $c"; sleep 31
done
