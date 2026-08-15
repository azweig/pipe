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
    # `for t in $(list_ids)` partía un id con espacios en dos y además lo pasaba por expansión de comodines: un
    # directorio raro dejaba la fila mezclada o, peor, hacía que se operara sobre otro tenant.
    while IFS= read -r t; do [ -n "$t" ] || continue
      base="$ROOT/$t"; [ -f "$base/docker-compose.yml" ] || continue
      # `|| true` en cada uno: con `set -euo pipefail`, un grep sin coincidencias sale ≠0 y MATABA el panel entero.
      # Un tenant sin archivo de Caddy (o sin puerto publicado) hacía desaparecer también a todos los que venían después.
      port=$(grep -oE '127.0.0.1:[0-9]+:3000' "$base/docker-compose.yml" 2>/dev/null | grep -oE ':[0-9]+:' | tr -d ':' | head -1 || true)
      sub=$(grep -hoE '^[A-Za-z0-9.-]+' "$CADDY_D/$t.caddy" 2>/dev/null | head -1 || true)
      # también con `|| echo ?`: si docker no está, o el compose de UN tenant está roto, `set -euo pipefail` mataba el
      # panel y los tenants siguientes desaparecían de la lista sin decir nada.
      # Si docker no está, o el compose de UN tenant está roto, `set -euo pipefail` mataba el panel entero y los
      # tenants siguientes desaparecían de la lista sin decir una palabra. Se aísla en un subshell que no puede fallar
      # y el valor vacío se muestra como "?" — mejor un dato desconocido que una lista incompleta que parece completa.
      up=$( { cd "$base" && docker compose ps --status running -q 2>/dev/null | wc -l; } 2>/dev/null | tr -d ' \n' || true ); up=${up:-?}
      tot=$( { cd "$base" && docker compose ps -q 2>/dev/null | wc -l; } 2>/dev/null | tr -d ' \n' || true ); tot=${tot:-?}
      lag=$(curl -s -m 3 "http://127.0.0.1:${port:-0}/api/health" 2>/dev/null | grep -oE '"ingestLagMin":[0-9]+' | grep -oE '[0-9]+' || echo '-')
      printf "%-14s %-30s %-6s %-9s %-9s\n" "$t" "${sub:-—}" "${port:-—}" "$up/$tot up" "${lag}m"
    done < <(list_ids)
    ;;
  logs)     t="${2:?falta <id>}"; cd "$ROOT/$t" && docker compose logs -f --tail 120 app ;;
  restart)  t="${2:?falta <id>}"; cd "$ROOT/$t" && docker compose restart app && echo "↻ $t reiniciado" ;;
  update-all)   # tras rebuild de pipe:latest → aplicar a toda la flota (rolling)
    while IFS= read -r t; do [ -n "$t" ] || continue; [ -f "$ROOT/$t/docker-compose.yml" ] || continue
      (cd "$ROOT/$t" && docker compose up -d app >/dev/null 2>&1) && echo "↻ $t actualizado a la imagen nueva"
    done < <(list_ids) ;;
  backup-all)
    # los backups van CIFRADOS: llevan mensajes, tokens de las cuentas conectadas, el hash del 2º PIN y las notas
    # apartadas por ser de una cuenta secreta — y de varios clientes a la vez, en una caja compartida.
    . "$(dirname "$0")/lib-cifrar.sh"
    ts=$(date +%Y%m%d-%H%M%S); out="$DIR_BACKUPS"; keep="${TENANT_BACKUP_KEEP:-5}"; mkdir -p "$out"
    PASS="$(pass_backups "$out")" || exit 1
    limpiar_partials "$out"
    # data/cas (la media, 64GB+) se respalda APARTE con rclone (content-addressed); NO en este tar diario o llena el disco (dispara #6).
    while IFS= read -r t; do [ -n "$t" ] || continue; d="$ROOT/$t"; [ -d "$d/data" ] || continue
      stg=$(mktemp -d); f="$out/$t-$ts.tar.gz.enc"
      if [ -f "$d/data/messages.db" ]; then
        # DB CONSISTENTE con sqlite3 .backup. Si falla (sin sqlite3 o lock >30s) SALTAMOS y GRITAMOS — NUNCA degradar a tar sobre WAL vivo (backup torcido).
        if ! sqlite3 "$d/data/messages.db" ".timeout 30000" ".backup '$stg/messages.db'" 2>/dev/null; then
          echo "❌ $t: sqlite3 .backup falló — NO hago tar sobre WAL vivo. Tenant SALTADO." >&2; rm -rf "$stg"; continue
        fi
        # --exclude saca la DB viva + el CAS; --transform mete la snapshot ('messages.db' → 'data/messages.db', no colisiona con el exclude).
        if cifrar_tar "$f" "$PASS" -- \
          --exclude='data/cas' --exclude='data/messages.db' --exclude='data/messages.db-wal' --exclude='data/messages.db-shm' \
          --transform='flags=r;s|^messages.db$|data/messages.db|' \
          -C "$d" data auth vault -C "$stg" messages.db
        then echo "✓ $t → $f (DB consistente, sin CAS, cifrado)"
        else echo "❌ $t: no se pudo respaldar — SIGO con los demás" >&2; fi
      else
        if cifrar_tar "$f" "$PASS" -- --exclude='data/cas' -C "$d" data auth vault
        then echo "✓ $t → $f (sin DB, sin CAS, cifrado)"
        else echo "❌ $t: no se pudo respaldar — SIGO con los demás" >&2; fi
      fi
      rm -rf "$stg"
      # rotación: conservar los últimos $keep POR TENANT. El glob lleva [0-9] para no comerse los de otro tenant cuyo id
      # empiece igual (con "$t-"* , rotar "acme" borraba también los de "acme-2"). Se incluyen los .tar.gz en claro de
      # antes de que esto se cifrara, para que no queden ahí para siempre.
      # el `|| true` NO es decorativo: con `set -euo pipefail`, un `ls` sobre un glob sin coincidencias sale ≠0 y, al ser
      # el último comando del cuerpo del for, MATABA el script entero. O sea: un tenant sin backups previos (o uno que
      # acababa de fallar) cortaba la corrida y los tenants siguientes no se respaldaban nunca, sin decir una palabra.
      { ls -1t "$out/$t-"[0-9]*.tar.gz.enc "$out/$t-"[0-9]*.tar.gz 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do rm -f "$old"; done; } || true
    done < <(list_ids) ;;
  *) echo "uso: tenants.sh list | logs <id> | restart <id> | update-all | backup-all"; exit 1 ;;
esac
