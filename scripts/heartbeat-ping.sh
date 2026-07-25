#!/usr/bin/env bash
# DEAD-MAN'S-SWITCH: pinga un monitor EXTERNO (healthchecks.io, gratis) SOLO si el hub responde. Si el hub o el box
# mueren, deja de pingar y el monitor te alerta por mail/Telegram. Es la ÚNICA alerta que sobrevive a una caída total
# (el heartbeat interno vive dentro del daemon → si muere todo, no avisa nada).
# Activar (cron del user):  */5 * * * * HC_PING_URL=https://hc-ping.com/<TU-UUID> bash /opt/pipe/scripts/heartbeat-ping.sh
set -euo pipefail
URL="${HC_PING_URL:-}"; [ -n "$URL" ] || { echo "seteá HC_PING_URL con tu UUID de healthchecks.io"; exit 0; }
HUB="${HUB_HEALTH:-http://127.0.0.1:3000/api/health}"
if curl -fsS --max-time 10 "$HUB" | grep -q '"ok":true'; then
  curl -fsS -m 10 "$URL" >/dev/null && echo "ping OK"
else
  echo "hub no responde → NO pingo (el monitor alertará)"; exit 1
fi
