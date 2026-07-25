#!/usr/bin/env bash
# Restaura un backup cifrado. Uso: bash scripts/restore.sh [archivo.enc] [destino]
# Por defecto restaura el MÁS RECIENTE a data/restore-test (no toca la data viva).
set -euo pipefail
cd "${HUB_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

# ── modo --cas: restaura los BLOBS del CAS (los 64GB de media) desde el remote offsite. Es el camino de DESASTRE (pull grande),
#    NO parte de la verificación diaria. Requiere BACKUP_RCLONE_REMOTE (si es un remote rclone crypt, descifra on-the-fly al leer).
#    Uso: BACKUP_RCLONE_REMOTE=... bash scripts/restore.sh --cas [destino]
if [ "${1:-}" = "--cas" ]; then
  CDEST="${2:-data/cas}"
  [ -n "${BACKUP_RCLONE_REMOTE:-}" ] || { echo "❌ falta BACKUP_RCLONE_REMOTE (no hay CAS offsite configurado)"; exit 1; }
  command -v rclone >/dev/null || { echo "❌ rclone no instalado"; exit 1; }
  echo "→ restaurando CAS desde $BACKUP_RCLONE_REMOTE/cas → $CDEST (son decenas de GB, puede tardar)…"
  rclone copy "$BACKUP_RCLONE_REMOTE/cas" "$CDEST" --transfers 8 --checkers 16 -P
  echo "✅ CAS restaurado → $CDEST"
  exit 0
fi

ENC="${1:-$(ls -1t data/backups/pipe-*.tar.zst.enc | head -1)}"
DEST="${2:-data/restore-test}"
PASS=secrets/backup.pass
[ -f "$ENC" ] || { echo "no existe: $ENC"; exit 1; }
# verificar integridad ANTES de descifrar: si el backup se truncó/corrompió, cortamos acá en vez de restaurar basura.
if [ -f "$ENC.sha256" ]; then
  want=$(cat "$ENC.sha256"); got=$(sha256sum "$ENC" | awk '{print $1}')
  [ "$want" = "$got" ] || { echo "❌ checksum NO coincide ($ENC) — backup corrupto/truncado, abortando"; exit 1; }
  echo "✓ checksum OK"
else
  echo "⚠️  sin .sha256 (backup viejo) — no puedo verificar integridad"
fi
mkdir -p "$DEST"
openssl enc -d -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -pass file:"$PASS" -in "$ENC" \
  | zstd -dq | tar -C "$DEST" -xf -
# sanity: la DB restaurada debe pasar integrity_check (detecta restore corrupto que igual "descifró")
DB_RESTORED=$(find "$DEST" -name messages.db | head -1)
if [ -n "$DB_RESTORED" ] && command -v sqlite3 >/dev/null; then
  ok=$(sqlite3 "$DB_RESTORED" "PRAGMA integrity_check;" 2>&1 | head -1)
  n=$(sqlite3 "$DB_RESTORED" "SELECT COUNT(*) FROM messages;" 2>/dev/null || echo "?")
  echo "DB restaurada: integrity=$ok · mensajes=$n"
fi
echo "restore OK → $DEST (desde $(basename "$ENC"))"

# verificación diaria del CAS OFFSITE: el "restore probado" del bundle NO cubre los 64GB de media. Confirmamos que el CAS está en el
# remote (alcanzable + con blobs) → saber que la media es recuperable. NO bajamos los 64GB (eso es --cas), solo verificamos que exista.
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  n=$(rclone lsf "$BACKUP_RCLONE_REMOTE/cas" --files-only -R 2>/dev/null | head -2000 | wc -l | tr -d ' ')
  { [ "${n:-0}" -gt 0 ] && echo "✓ CAS offsite verificado: ≥$n blobs en $BACKUP_RCLONE_REMOTE/cas"; } || echo "⚠️  CAS offsite VACÍO/inalcanzable — la media NO está respaldada (corré backup.sh con BACKUP_RCLONE_REMOTE)"
fi
