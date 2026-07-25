#!/usr/bin/env bash
# Baja y BORRA un tenant (contenedores + volúmenes + datos + ruta Caddy). Pide confirmación.
# Uso:  ./deprovision.sh <tenant-id> [--backup]
set -euo pipefail
TENANT="${1:?falta tenant-id}"; BACKUP="${2:-}"
BASE="${TENANTS_ROOT:-/opt/tenants}/$TENANT"
CADDY_D="${CADDY_D:-/etc/caddy/tenants}"
[ -d "$BASE" ] || { echo "no existe $BASE"; exit 1; }

read -r -p "⚠ Esto BORRA TODO el tenant '$TENANT' (contenedores + datos). Escribí el id para confirmar: " c
[ "$c" = "$TENANT" ] || { echo "cancelado"; exit 1; }

if [ "$BACKUP" = "--backup" ]; then
  ts=$(date +%Y%m%d-%H%M%S); out="/opt/tenant-backups/$TENANT-$ts.tar.gz"; mkdir -p /opt/tenant-backups
  echo "▶ Backup → $out"; tar -czf "$out" -C "$BASE" data auth vault 2>/dev/null || true
fi

cd "$BASE" && docker compose down -v || true
rm -f "$CADDY_D/$TENANT.caddy"; systemctl reload caddy 2>/dev/null || true
rm -rf "$BASE"
echo "🗑  Tenant '$TENANT' eliminado."
