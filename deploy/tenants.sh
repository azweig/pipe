#!/usr/bin/env bash
# Panel de operador de todos los tenants de pipe en la caja.
# Uso:  tenants.sh [list] | logs <id> | restart <id> | backup-all
set -euo pipefail
ROOT="${TENANTS_ROOT:-/opt/tenants}"
CADDY_D="${CADDY_D:-/etc/caddy/tenants}"
cmd="${1:-list}"
list_ids(){ [ -d "$ROOT" ] && ls -1 "$ROOT" 2>/dev/null || true; }

case "$cmd" in
  list|status)
    printf "%-14s %-30s %-6s %-9s %-9s\n" TENANT SUBDOMINIO PORT ESTADO LAG
    printf '%.0s─' $(seq 1 74); echo
    for t in $(list_ids); do
      base="$ROOT/$t"; [ -f "$base/docker-compose.yml" ] || continue
      port=$(grep -oE '127.0.0.1:[0-9]+:3000' "$base/docker-compose.yml" | grep -oE ':[0-9]+:' | tr -d ':' | head -1)
      sub=$(grep -hoE '^[A-Za-z0-9.-]+' "$CADDY_D/$t.caddy" 2>/dev/null | head -1)
      up=$(cd "$base" && docker compose ps --status running -q 2>/dev/null | wc -l | tr -d ' ')
      tot=$(cd "$base" && docker compose ps -q 2>/dev/null | wc -l | tr -d ' ')
      lag=$(curl -s -m 3 "http://127.0.0.1:${port:-0}/api/health" 2>/dev/null | grep -oE '"ingestLagMin":[0-9]+' | grep -oE '[0-9]+' || echo '-')
      printf "%-14s %-30s %-6s %-9s %-9s\n" "$t" "${sub:-—}" "${port:-—}" "$up/$tot up" "${lag}m"
    done
    ;;
  logs)     t="${2:?falta <id>}"; cd "$ROOT/$t" && docker compose logs -f --tail 120 app ;;
  restart)  t="${2:?falta <id>}"; cd "$ROOT/$t" && docker compose restart app && echo "↻ $t reiniciado" ;;
  update-all)   # tras rebuild de pipe:latest → aplicar a toda la flota (rolling)
    for t in $(list_ids); do [ -f "$ROOT/$t/docker-compose.yml" ] || continue
      (cd "$ROOT/$t" && docker compose up -d app >/dev/null 2>&1) && echo "↻ $t actualizado a la imagen nueva"
    done ;;
  backup-all)
    ts=$(date +%Y%m%d-%H%M%S); out="/opt/tenant-backups"; keep="${TENANT_BACKUP_KEEP:-5}"; mkdir -p "$out"
    # data/cas (la media, 64GB+) se respalda APARTE con rclone (content-addressed); NO en este tar diario o llena el disco (dispara #6).
    for t in $(list_ids); do d="$ROOT/$t"; [ -d "$d/data" ] || continue
      stg=$(mktemp -d); f="$out/$t-$ts.tar.gz"
      if [ -f "$d/data/messages.db" ]; then
        # DB CONSISTENTE con sqlite3 .backup. Si falla (sin sqlite3 o lock >30s) SALTAMOS y GRITAMOS — NUNCA degradar a tar sobre WAL vivo (backup torcido).
        if ! sqlite3 "$d/data/messages.db" ".timeout 30000" ".backup '$stg/messages.db'" 2>/dev/null; then
          echo "❌ $t: sqlite3 .backup falló — NO hago tar sobre WAL vivo. Tenant SALTADO." >&2; rm -rf "$stg"; continue
        fi
        # --exclude saca la DB viva + el CAS; --transform mete la snapshot ('messages.db' → 'data/messages.db', no colisiona con el exclude).
        tar -czf "$f" \
          --exclude='data/cas' --exclude='data/messages.db' --exclude='data/messages.db-wal' --exclude='data/messages.db-shm' \
          --transform='flags=r;s|^messages.db$|data/messages.db|' \
          -C "$d" data auth vault -C "$stg" messages.db 2>/dev/null && echo "✓ $t → $f (DB consistente, sin CAS)"
      else
        tar -czf "$f" --exclude='data/cas' -C "$d" data auth vault 2>/dev/null && echo "✓ $t → $f (sin DB, sin CAS)"
      fi
      rm -rf "$stg"
      ls -1t "$out/$t-"*.tar.gz 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do rm -f "$old"; done  # rotación: conservar los últimos $keep por tenant
    done ;;
  *) echo "uso: tenants.sh list | logs <id> | restart <id> | update-all | backup-all"; exit 1 ;;
esac
