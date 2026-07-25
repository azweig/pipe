#!/usr/bin/env bash
# Backup CIFRADO y CONSISTENTE de pipe. Bundle crítico (DB + configs + auth/ + .env) cifrado AES-256 (openssl),
# MÁS el CAS (los 64GB de media) sincronizado offsite aparte — el CAS es el activo IRREEMPLAZABLE (fotos/notas de voz/PDFs de
# 10 canales) y NO es regenerable: la media del bridge se baja una vez y su URL upstream expira. Lo corre el systemd timer a diario.
# Manual: bash scripts/backup.sh
set -euo pipefail
cd "${HUB_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT=data/backups; TMP=data/tmp; PASS=secrets/backup.pass
mkdir -p "$OUT" "$TMP" secrets
[ -f "$PASS" ] || { echo "FALTA $PASS (passphrase)"; exit 1; }

# 1. snapshot consistente de SQLite (online-safe con el server vivo; maneja WAL correctamente).
#    .timeout 30000: si un writer tiene el lock exclusivo en ese instante (checkpoint WAL / initSchema), .backup esperaría en vez de
#    salir non-zero → con set -euo pipefail eso abortaba la corrida ENTERA = CERO backup ese día (solo visible en el exit del timer).
sqlite3 data/messages.db ".timeout 30000" ".backup '$TMP/messages.db'"

# 1b. SESIONES del bridge WhatsApp (whatsmeow): sin esto, perder /opt/matrix = re-escanear el QR de TODOS los números a mano.
#     Snapshot consistente con el bridge vivo. Path por env (cada tenant el suyo); default = hub principal.
WA_BRIDGE_DB="${WA_BRIDGE_DB:-/opt/matrix/bridges/whatsapp/mautrix-whatsapp.db}"
if [ -f "$WA_BRIDGE_DB" ]; then sqlite3 "$WA_BRIDGE_DB" ".timeout 30000" ".backup '$TMP/mautrix-whatsapp.db'" 2>/dev/null && echo "  + sesiones bridge WhatsApp"; fi

# 1c. índice del CAS (cas.db, SQLite): mapea cada blob → ruta. El CAS es rebuildable, pero esto da un restore coherente.
[ -f data/cas.db ] && sqlite3 data/cas.db ".timeout 30000" ".backup '$TMP/cas.db'" 2>/dev/null && echo "  + índice CAS (cas.db)"

# 2. lista de archivos críticos (excluye cas/, msgstore*, avatars/, media/, logs/)
# INCLUYE auth/ : tokens OAuth (Google x4), sesión Telegram, token Matrix, imap-accounts, wa-e2e keys, cache MSAL.
# Es lo MÁS caro de recrear (re-login/re-escaneo de los 10 canales a mano) — sin esto el restore no te devuelve el sistema vivo.
FILES=( .env "$TMP/messages.db" )
[ -f "$TMP/mautrix-whatsapp.db" ] && FILES+=( "$TMP/mautrix-whatsapp.db" ) # sesiones del bridge → restore sin re-escanear
[ -f "$TMP/cas.db" ] && FILES+=( "$TMP/cas.db" ) # índice del CAS
[ -d auth ] && FILES+=( auth )
[ -f data/.secret-key ] && FILES+=( data/.secret-key ) # clave de cifrado BYOK (AES): sin ella el restore no descifra los tokens de IA/IMAP
for f in data/*.json data/*.jsonl; do
  [ -e "$f" ] || continue
  # messages.jsonl es el log crudo append-only (38GB y creciendo). NO lo incluimos: ya está TODO en el snapshot de messages.db
  # (la ingesta lo materializa cada 15s). Incluirlo hacía backups de 14G × 7 = ~100GB → llenaba el disco y tiraba el sistema.
  case "$f" in */messages.jsonl) continue ;; esac
  FILES+=("$f")   # rag.jsonl, cas-index.json y todos los configs (chicos)
done

# 3. tar → zstd → openssl aes-256-cbc. ATÓMICO: se escribe a .partial y recién al terminar OK se renombra al nombre final,
#    así un backup truncado (openssl muere a mitad) NUNCA queda como "el último" que elegiría el restore.
# TOLERANCIA a tar exit=1: messages.jsonl es un archivo VIVO (se le anexan mensajes); si crece durante el tar, GNU tar sale con 1
#    ("file changed as we read it") — el archivo IGUAL queda válido. Sin esto, con set -e+pipefail el backup fallaba TODOS los días
#    que había actividad (incidente: 4 días sin backup). Toleramos tar=0/1, pero exigimos zstd=0 y openssl=0 (esos sí son fatales).
DEST="$OUT/pipe-$STAMP.tar.zst.enc"
set +e
tar -cf - "${FILES[@]}" 2>/dev/null \
  | zstd -q -3 \
  | openssl enc -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -salt -pass file:"$PASS" \
  > "$DEST.partial"
rc=("${PIPESTATUS[@]}") # (tar zstd openssl)
set -e
if { [ "${rc[0]}" -eq 0 ] || [ "${rc[0]}" -eq 1 ]; } && [ "${rc[1]}" -eq 0 ] && [ "${rc[2]}" -eq 0 ]; then
  mv -f "$DEST.partial" "$DEST"        # rename atómico: aparece completo o no aparece
  sha256sum "$DEST" | awk '{print $1}' > "$DEST.sha256"  # checksum de integridad (restore lo verifica antes de descifrar)
else
  rm -f "$DEST.partial"; echo "❌ backup FALLÓ (tar=${rc[0]} zstd=${rc[1]} openssl=${rc[2]})"; rm -f "$TMP/messages.db" "$TMP/mautrix-whatsapp.db" "$TMP/cas.db"; exit 1
fi
rm -f "$TMP/messages.db" "$TMP/mautrix-whatsapp.db" "$TMP/cas.db"

# 4. rotación local: conservar los últimos 7 (con su .sha256). Limpia .partial huérfanos de corridas fallidas.
rm -f "$OUT"/pipe-*.partial
ls -1t "$OUT"/pipe-*.tar.zst.enc 2>/dev/null | tail -n +8 | while read -r old; do rm -f "$old" "$old.sha256"; done

# 5. offsite opcional (si hay remote rclone configurado en el entorno)
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$DEST" "$BACKUP_RCLONE_REMOTE" && rclone copy "$DEST.sha256" "$BACKUP_RCLONE_REMOTE" && echo "→ offsite: $BACKUP_RCLONE_REMOTE"

  # 5b. CAS OFFSITE — los 64GB de media (fotos, notas de voz, PDFs de 10 canales): el activo irreemplazable y NO regenerable.
  #     Content-addressed = inmutable → 'copy' es incremental (solo sube blobs nuevos) y ADITIVO (nunca borra del backup, ni siquiera
  #     si el CAS local se trunca/corrompe — por eso copy y NO sync). El índice (cas.db) ya va en el bundle cifrado de arriba.
  if [ -d data/cas ]; then
    rclone copy data/cas "$BACKUP_RCLONE_REMOTE/cas" --transfers 8 --checkers 16 \
      && echo "→ CAS offsite: $(du -sh data/cas 2>/dev/null | cut -f1)"
  fi
else
  echo "⚠️  sin BACKUP_RCLONE_REMOTE: el backup vive en el MISMO disco que la data (un fallo de disco = pérdida total) y los 64GB de"
  echo "    CAS quedan SIN respaldo (RPO de la media = ∞). RAID1 no cubre rm -rf/ransomware/fat-finger. Configurá un remote rclone."
fi

echo "backup OK: $DEST ($(du -h "$DEST" | cut -f1))"
