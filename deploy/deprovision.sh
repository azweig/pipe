#!/usr/bin/env bash
# Baja y BORRA un tenant (contenedores + volúmenes + datos + ruta Caddy). Pide confirmación.
# Uso:  ./deprovision.sh <tenant-id> [--backup]
set -euo pipefail
TENANT="${1:?falta tenant-id}"; BACKUP="${2:-}"
ROOT="${TENANTS_ROOT:-/opt/tenants}"
# Validar el id ANTES de armar rutas: este script termina en `rm -rf "$BASE"`, y con TENANT=".." el BASE era el
# directorio de TODOS los tenants. La confirmación no salva de eso (te pide escribir el id, y ".." es un id válido de
# escribir). Sólo minúsculas, dígitos, guion y guion bajo.
case "$TENANT" in
  ""|-*|.*) echo "❌ id de tenant inválido: no puede estar vacío ni empezar con '-' o '.'"; exit 1 ;;
  *[!abcdefghijklmnopqrstuvwxyz0123456789_-]*) echo "❌ id de tenant inválido: '$TENANT' (sólo minúsculas a-z, dígitos, '-' y '_')"; exit 1 ;;
esac
BASE="$ROOT/$TENANT"
CADDY_D="${CADDY_D:-/etc/caddy/tenants}"
[ -d "$BASE" ] || { echo "no existe $BASE"; exit 1; }
# …y comprobar que la ruta REAL sigue estando justo abajo de $ROOT (por si $BASE es un symlink a otro lado)
REAL="$(cd "$BASE" && pwd -P)"; REAL_ROOT="$(cd "$ROOT" && pwd -P)"
[ "$REAL" = "$REAL_ROOT/$TENANT" ] || { echo "❌ $BASE no está directamente bajo $REAL_ROOT (apunta a $REAL) — no borro nada"; exit 1; }

read -r -p "⚠ Esto BORRA TODO el tenant '$TENANT' (contenedores + datos). Escribí el id para confirmar: " c
[ "$c" = "$TENANT" ] || { echo "cancelado"; exit 1; }

if [ "$BACKUP" = "--backup" ]; then
  # CIFRADO: acá adentro van los mensajes, los tokens de las cuentas, el hash del 2º PIN y las notas apartadas por ser
  # de una cuenta secreta. En claro, este archivo es la copia sin candado de todo lo que el tenant protege.
  . "$(dirname "$0")/lib-cifrar.sh"
  ts=$(date +%Y%m%d-%H%M%S); out="$DIR_BACKUPS/$TENANT-$ts.tar.gz.enc"
  PASS="$(pass_backups)" || exit 1
  limpiar_partials
  echo "▶ Backup cifrado → $out"
  cifrar_tar "$out" "$PASS" -- -C "$BASE" data auth vault || { echo "❌ el backup FALLÓ → no sigo con el borrado"; exit 1; }
  receta_restore
fi

# Si esto falla, NO se borra: quedarían contenedores vivos escribiendo sobre un directorio recién eliminado, con sus
# volúmenes colgados y el puerto tomado. Antes el `|| true` se lo tragaba y seguía derecho al rm -rf.
cd "$BASE"
if ! docker compose down -v; then
  echo "❌ 'docker compose down -v' falló → NO borro nada. Revisá los contenedores de '$TENANT' y reintentá." >&2
  exit 1
fi
rm -f "$CADDY_D/$TENANT.caddy"; systemctl reload caddy 2>/dev/null || true
rm -rf "$BASE"
echo "🗑  Tenant '$TENANT' eliminado."
