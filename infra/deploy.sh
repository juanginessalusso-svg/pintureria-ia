#!/usr/bin/env bash
# Corre EN EL VPS como "forced command" de la clave SSH de CI (ver authorized_keys).
# Entrada: tag en $SSH_ORIGINAL_COMMAND y un bundle .tar por stdin con:
#   image.tar.gz (docker save | gzip) y docker-compose.yml
# Si el healthcheck falla, vuelve al tag anterior (rollback).
set -euo pipefail

APP_DIR=/opt/pintureria-ia
TAG="${SSH_ORIGINAL_COMMAND:-}"
[[ "$TAG" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "tag invalido"; exit 2; }

cd "$APP_DIR"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
tar -xf - -C "$TMP"
PREV=$(cat .current-tag 2>/dev/null || true)

gunzip -c "$TMP/image.tar.gz" | sudo docker load
cp "$TMP/docker-compose.yml" docker-compose.yml

wait_healthy() {
  for _ in $(seq 1 24); do
    st=$(sudo docker inspect -f '{{.State.Health.Status}}' pintureria-ia-api-1 2>/dev/null || echo none)
    [ "$st" = healthy ] && return 0
    sleep 5
  done
  return 1
}

echo ">> levantando $TAG (anterior: ${PREV:-ninguno})"
sudo env TAG="$TAG" docker compose up -d
if wait_healthy; then
  echo "$TAG" > .current-tag
  echo ">> OK: $TAG healthy"
  # Conservar solo las 3 imagenes mas nuevas (el disco es chico).
  sudo docker images pintureria-api --format '{{.Tag}}' | tail -n +4 | xargs -r -I{} sudo docker rmi pintureria-api:{} || true
else
  echo ">> FALLO healthcheck de $TAG"
  if [ -n "$PREV" ]; then
    echo ">> rollback a $PREV"
    sudo env TAG="$PREV" docker compose up -d
    wait_healthy && echo ">> rollback OK" || echo ">> rollback tambien fallo, revisar a mano"
  fi
  exit 1
fi
