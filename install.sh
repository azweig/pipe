#!/usr/bin/env bash
# Instalador interactivo de Pipe. Te pide tus datos y keys por terminal y deja todo listo para arrancar.
# Uso:  bash install.sh        (podés correrlo de nuevo: solo cambia lo que ingreses, no pisa lo demás)
set -u
cd "$(dirname "$0")"

c_g(){ printf '\033[32m%s\033[0m\n' "$1"; }
c_y(){ printf '\033[33m%s\033[0m\n' "$1"; }
c_r(){ printf '\033[31m%s\033[0m\n' "$1"; }
hr(){ printf '\033[2m%s\033[0m\n' "────────────────────────────────────────────"; }

echo; c_g "  Pipe — instalador"; echo "  Inbox unificado + segundo cerebro. Todo queda en tu servidor."; hr

# ── 1. Preflight ────────────────────────────────────────────────
NODE_MAJOR="$( (node -v 2>/dev/null || echo v0) | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" = "20" ] || [ "$NODE_MAJOR" = "22" ] || [ "$NODE_MAJOR" = "24" ]; then
  c_g "✓ Node $(node -v)"
else
  c_r "✗ Node 20 LTS requerido (tenés $(node -v 2>/dev/null || echo 'ninguno'); NO uses 25 — rompe el crypto/ABI)."
  echo "  Instalá Node 20:  https://nodejs.org  (o nvm install 20)"; exit 1
fi
for bin in ffmpeg python3 make g++; do
  command -v "$bin" >/dev/null 2>&1 && c_g "✓ $bin" || c_y "⚠ falta $bin  (ffmpeg=audio · python3/make/g++=compilar better-sqlite3). Instalalo antes de seguir si falla el build."
done
command -v git >/dev/null 2>&1 || c_y "⚠ falta git (necesario para una dependencia de WhatsApp)."
hr

# ── 2. Dependencias ─────────────────────────────────────────────
c_g "Instalando dependencias (compila better-sqlite3, ~1 min)…"
npm install || { c_r "npm install falló. Revisá el toolchain (python3/make/g++)."; exit 1; }
hr

mkdir -p data
[ -f .env ] || cp .env.example .env
# set_env KEY VALUE  → escribe/actualiza una var en .env sin tocar el resto (ni las líneas comentadas de ejemplo)
set_env(){ [ -z "${2:-}" ] && return 0; touch .env; grep -v "^$1=" .env > .env.tmp 2>/dev/null || true; echo "$1=$2" >> .env.tmp; mv .env.tmp .env; }
ask(){ # ask "Pregunta" [default] → deja la respuesta en REPLY_VAL ("" si vacío)
  local q="$1" def="${2:-}"; if [ -n "$def" ]; then printf '%s [%s]: ' "$q" "$def"; else printf '%s (Enter = saltar): ' "$q"; fi
  read -r ans; REPLY_VAL="${ans:-$def}"; }
to_arr(){ local IFS=','; local out=""; for x in $1; do x="$(echo "$x" | xargs)"; [ -z "$x" ] && continue; out="$out\"$x\","; done; echo "[${out%,}]"; }

# ── 3. SECRETS_KEY (cifra tus tokens en reposo) ─────────────────
if grep -qE '^SECRETS_KEY=.+' .env; then c_g "✓ SECRETS_KEY ya configurada";
else KEY="$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | xxd -p -c256)"; set_env SECRETS_KEY "$KEY"; c_g "✓ SECRETS_KEY generada (guardala: está en .env)"; fi
hr

# ── 4. Identidad del hub ────────────────────────────────────────
c_g "Tu identidad (para atribuir 'vos' y saludarte). Podés cambiarla después en la app."
ask "  Tu nombre completo"        "Owner";           OWNER="$REPLY_VAL"
ask "  Tu nombre de pila"          "${OWNER%% *}";    FIRST="$REPLY_VAL"
ask "  Empresa (opcional)"         "";                COMPANY="$REPLY_VAL"
ask "  Tus números (coma-sep)"     "";                NUMS="$REPLY_VAL"
ask "  Tus correos (coma-sep)"     "";                MAILS="$REPLY_VAL"
ask "  Zona horaria"               "America/Lima";    TZ="$REPLY_VAL"
ask "  Dominio del hub (opcional)" "";                DOMAIN="$REPLY_VAL"
cat > data/hub-config.json <<JSON
{
  "ownerName": "$OWNER",
  "ownerFirst": "$FIRST",
  "company": "$COMPANY",
  "myNumbers": $(to_arr "$NUMS"),
  "myEmails": $(to_arr "$MAILS"),
  "timezone": "$TZ",
  "domain": "$DOMAIN"
}
JSON
c_g "✓ data/hub-config.json escrito"; hr

# ── 5. Motor de IA (BYOK — al menos uno, o configuralo luego en la app) ─
c_g "Motor de IA (traé tu propia key). Enter para saltar y configurarlo después en Configuración → Motor de IA."
ask "  OpenAI API key";     set_env OPENAI_API_KEY    "$REPLY_VAL"
ask "  Anthropic API key";  set_env ANTHROPIC_API_KEY "$REPLY_VAL"
ask "  Gemini API key";     set_env GEMINI_API_KEY    "$REPLY_VAL"
hr

# ── 6. OAuth (habilita "Ingresar con Google" y Microsoft 365) ───
c_g "Correo / calendario por OAuth (opcional — WhatsApp y el IMAP se conectan desde la app)."
echo "  Google: creá un OAuth Client (Web) en console.cloud.google.com → APIs & Services → Credentials."
echo "  Redirect URI a registrar:  https://TU-DOMINIO/oauth/google/callback"
ask "  GOOGLE_CLIENT_ID";     set_env GOOGLE_CLIENT_ID     "$REPLY_VAL"
ask "  GOOGLE_CLIENT_SECRET"; set_env GOOGLE_CLIENT_SECRET "$REPLY_VAL"
ask "  MS_CLIENT_ID (Microsoft 365, opcional)"; set_env MS_CLIENT_ID "$REPLY_VAL"
ask "  MS_TENANT_ID (opcional)";                set_env MS_TENANT_ID "$REPLY_VAL"
hr

# ── 7. ¿Es un servidor de producción? ───────────────────────────
printf '¿Esto es un servidor de producción (detrás de un dominio/Caddy)? [s/N]: '; read -r PROD
if [ "${PROD:-n}" = "s" ] || [ "${PROD:-n}" = "S" ]; then
  set_env HOST 127.0.0.1
  set_env LLM_BLOCK_PRIVATE_HOSTS 1
  set_env DB_BUSY_TIMEOUT_MS 10000
  ask "  Dominio(s) confiables TRUSTED_HOSTS (coma-sep, ej hub.tudominio.com)"; set_env TRUSTED_HOSTS "$REPLY_VAL"
  ask "  Backup offsite BACKUP_RCLONE_REMOTE (ej r2:pipe-backups) — el riesgo #1 si falta"; set_env BACKUP_RCLONE_REMOTE "$REPLY_VAL"
  c_y "  Recordá: DNS, Caddy (TLS), backup+restore probado, monitoreo /api/health, PIN. Ver docs/DEPLOY.md."
fi
hr

# ── 8. Tests + arranque ─────────────────────────────────────────
printf '¿Corro los tests ahora? [S/n]: '; read -r RT
[ "${RT:-s}" != "n" ] && [ "${RT:-s}" != "N" ] && npm test

echo; c_g "✔ Listo."
echo "  Arrancá:   node src/daemon.mjs        (web UI → http://localhost:3000)"
echo "  Producción: systemd → deploy/pipe.service   ·   go-live → docs/DEPLOY.md"
echo "  Conectá WhatsApp, correo y demás DESDE LA APP:  Configuración → Agregar conexión"
echo
