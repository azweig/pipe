#!/usr/bin/env bash
# Test AISLADO de backup + restore (roundtrip). Antes la red de seguridad más importante no tenía ni una aserción.
# Crea un HUB_DIR falso en /tmp, hace backup, restaura, y verifica que la DB vuelva íntegra con los mismos datos.
# Uso: bash scripts/test-backup.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HUB_DIR="$T"

echo "▶ armando HUB_DIR de prueba en $T"
mkdir -p "$T/data" "$T/secrets" "$T/scripts" "$T/auth"
cp "$HERE/scripts/backup.sh" "$HERE/scripts/restore.sh" "$T/scripts/"
echo "TEST=1" > "$T/.env"
echo "clave-de-prueba-123" > "$T/secrets/backup.pass"
echo '{"telegram":"token-falso"}' > "$T/auth/session.json"   # auth/ debe entrar al backup
# DB sqlite mínima con datos conocidos
sqlite3 "$T/data/messages.db" "CREATE TABLE messages(id TEXT, text TEXT); INSERT INTO messages VALUES('a','hola'),('b','chau');"
N_ORIG=$(sqlite3 "$T/data/messages.db" "SELECT COUNT(*) FROM messages;")

echo "▶ 1/3 backup"; bash "$T/scripts/backup.sh" >/dev/null
ENC=$(ls -1t "$T/data/backups"/*.enc | head -1); [ -f "$ENC" ] || { echo "❌ no se creó el backup"; exit 1; }
[ -f "$ENC.sha256" ] || { echo "❌ falta el checksum"; exit 1; }

echo "▶ 2/3 restore"; bash "$T/scripts/restore.sh" "$ENC" "$T/data/restore-test" >/dev/null

echo "▶ 3/3 verificar"
DB=$(find "$T/data/restore-test" -name messages.db | head -1); [ -f "$DB" ] || { echo "❌ la DB no se restauró"; exit 1; }
N_REST=$(sqlite3 "$DB" "SELECT COUNT(*) FROM messages;")
INTEG=$(sqlite3 "$DB" "PRAGMA integrity_check;")
find "$T/data/restore-test" -path '*auth/session.json' | grep -q . || { echo "❌ auth/ no está en el backup"; exit 1; }

if [ "$N_REST" = "$N_ORIG" ] && [ "$INTEG" = "ok" ]; then
  echo "✅ backup/restore OK · filas ${N_ORIG} -> ${N_REST} · integrity=${INTEG} · auth/ incluido"
else
  echo "❌ mismatch: filas ${N_ORIG} -> ${N_REST} · integrity=${INTEG}"; exit 1
fi
