#!/bin/sh
set -e

# O volume persistente é montado por cima de /data e chega pertencendo ao root,
# anulando o chown feito na build. Ajusta o dono antes de baixar privilégio.
DATA_DIR="${DATA_DIR:-/data}"
APP_USER="${APP_USER:-node}"

mkdir -p "$DATA_DIR"

if [ "$(id -u)" = "0" ]; then
  if ! chown -R "$APP_USER:$APP_USER" "$DATA_DIR" 2>/dev/null; then
    echo "aviso: não foi possível ajustar o dono de $DATA_DIR; seguindo mesmo assim." >&2
  fi
  exec su-exec "$APP_USER" "$@"
fi

exec "$@"
