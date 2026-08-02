#!/usr/bin/env bash
# Provisiona un TENANT nuevo de pipe en tu servidor: stack Docker aislado (app + Matrix + bridge + Postgres) + ruta Caddy.
# Uso:  ./provision.sh <tenant-id> <subdominio> "<Nombre Dueño>" <email>
#   ej: ./provision.sh acme acme.hub.tudominio.com "Juan Pérez" juan@acme.com
set -euo pipefail

TENANT="${1:?falta tenant-id (a-z0-9-)}"; SUBDOMAIN="${2:?falta subdominio}"; OWNER="${3:-$TENANT}"; EMAIL="${4:-}"
[[ "$TENANT" =~ ^[a-z0-9-]+$ ]] || { echo "tenant-id inválido (solo a-z0-9-)"; exit 1; }

DEPLOY="$(cd "$(dirname "$0")" && pwd)"
TENANTS_ROOT="${TENANTS_ROOT:-/opt/tenants}"
BASE="$TENANTS_ROOT/$TENANT"
CADDY_D="${CADDY_D:-/etc/caddy/tenants}"
[ -d "$BASE" ] && { echo "❌ ya existe $BASE"; exit 1; }

echo "▶ Provisionando tenant '$TENANT' → https://$SUBDOMAIN"
mkdir -p "$BASE"/{data,auth,vault,synapse,postgres,bridges/whatsapp}

# ── puerto libre para la app (127.0.0.1) ──
used=" $(ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | tr '\n' ' ') "
APP_PORT=""
for p in $(seq 3001 3999); do case "$used" in *" $p "*) ;; *) APP_PORT=$p; break;; esac; done
[ -n "$APP_PORT" ] || { echo "sin puertos libres"; exit 1; }

# ── secretos (por tenant, nunca compartidos) ──
SECRETS_KEY="$(openssl rand -base64 32)"
PG_PASS="$(openssl rand -hex 24)"
MATRIX_PW="$(openssl rand -hex 20)"
REG_SECRET="$(openssl rand -hex 32)"

# ── identidad del hub (config por-hub) ──
cat > "$BASE/data/hub-config.json" <<EOF
{
  "ownerName": "$OWNER",
  "ownerFirst": "$(echo "$OWNER" | awk '{print $1}')",
  "company": "",
  "myNumbers": [],
  "myEmails": [$([ -n "$EMAIL" ] && echo "\"$EMAIL\"")],
  "timezone": "America/Lima",
  "domain": "$SUBDOMAIN"
}
EOF
printf '%s' "$MATRIX_PW" > "$BASE/auth/matrix-pw"
chmod 600 "$BASE/auth/matrix-pw"

# ── compose renderizado (IA managed opcional: exportá MANAGED_OPENAI_KEY antes de correr → IA out-of-box; si no, el cliente pone la suya con BYOK) ──
export TENANT SUBDOMAIN APP_PORT SECRETS_KEY PG_PASS
export MANAGED_OPENAI_KEY="${MANAGED_OPENAI_KEY:-}"
envsubst '${TENANT} ${SUBDOMAIN} ${APP_PORT} ${SECRETS_KEY} ${PG_PASS} ${MANAGED_OPENAI_KEY}' \
  < "$DEPLOY/docker-compose.tenant.yml.tpl" > "$BASE/docker-compose.yml"
cd "$BASE"

# ── Synapse: generar homeserver.yaml y apuntarlo a Postgres + registro por secret ──
echo "▶ Generando Synapse…"
docker run --rm -v "$BASE/synapse:/data" -e SYNAPSE_SERVER_NAME="$TENANT.local" -e SYNAPSE_REPORT_STATS=no \
  matrixdotorg/synapse:latest generate >/dev/null
python3 - "$BASE/synapse/homeserver.yaml" "$PG_PASS" "$REG_SECRET" <<'PY'
import sys, re
f, pg, reg = sys.argv[1], sys.argv[2], sys.argv[3]
y = open(f).read()
# sqlite → postgres
y = re.sub(r'(?s)database:\s*\n\s*name:\s*sqlite3.*?args:.*?database:.*?\n',
  f"database:\n  name: psycopg2\n  args:\n    user: synapse\n    password: {pg}\n    database: synapse\n    host: postgres\n    cp_min: 5\n    cp_max: 10\n", y, count=1)
if 'registration_shared_secret' not in y: y += f"\nregistration_shared_secret: \"{reg}\"\n"
if 'app_service_config_files' not in y: y += "\napp_service_config_files:\n  - /data/whatsapp-registration.yaml\n"
open(f,'w').write(y)
PY

echo "▶ Levantando Postgres + Synapse…"
docker compose up -d postgres synapse
sleep 8

# ── bridge WhatsApp: generar config, apuntarlo al HS del tenant, registrar en Synapse ──
echo "▶ Configurando bridge WhatsApp…"
docker compose run --rm mautrix-whatsapp >/dev/null 2>&1 || true   # 1ra corrida: genera config.yaml
if [ -f "$BASE/bridges/whatsapp/config.yaml" ]; then
  python3 - "$BASE/bridges/whatsapp/config.yaml" "$TENANT" <<'PY'
import sys,re
f,t=sys.argv[1],sys.argv[2]; y=open(f).read()
y=re.sub(r'address:\s*https?://\S+', 'address: http://synapse:8008', y, count=1)   # HS del tenant
y=re.sub(r'domain:\s*\S+', f'domain: {t}.local', y, count=1)                        # dominio del tenant
# base de datos del bridge → sqlite en su volumen (evita "database.uri not configured")
y=re.sub(r'(database:\n(?:[^\n]*\n)*?\s*type:\s*)postgres', r'\1sqlite3-fk-wal', y, count=1)
y=y.replace('postgres://user:password@host/database?sslmode=disable', 'file:/data/mautrix-whatsapp.db?_txlock=immediate')
y=y.replace('example.com', f'{t}.local')   # placeholder de mautrix (permissions/domain) → dominio del tenant; sin esto: "permissions not configured"
y=y.replace('http://localhost:29318', 'http://mautrix-whatsapp:29318')  # Synapse debe llegar al bridge por el nombre del container (no localhost), si no: appservice connection refused
y=re.sub(r'(appservice:.*?\n\s*hostname:\s*)127\.0\.0\.1', r'\g<1>0.0.0.0', y, count=1, flags=re.S)  # el bridge debe bindear en 0.0.0.0 (no loopback) para que Synapse -otro container- lo alcance
open(f,'w').write(y)
PY
  docker compose run --rm mautrix-whatsapp >/dev/null 2>&1 || true  # 2da: genera registration.yaml
  cp "$BASE/bridges/whatsapp/registration.yaml" "$BASE/synapse/whatsapp-registration.yaml" 2>/dev/null || true
  chmod 644 "$BASE/synapse/whatsapp-registration.yaml" 2>/dev/null || true  # el user de Synapse (no-root) debe poder LEERla
  docker compose restart synapse; sleep 5
  docker compose up -d mautrix-whatsapp
fi

# ── usuario admin de Matrix para la app (login por password) ──
echo "▶ Creando usuario Matrix admin…"
docker compose exec -T synapse register_new_matrix_user -c /data/homeserver.yaml -u admin -p "$MATRIX_PW" -a http://localhost:8008 >/dev/null 2>&1 || \
  echo "  (si falló, corré: docker compose exec synapse register_new_matrix_user -c /data/homeserver.yaml -u admin -p '$MATRIX_PW' --admin)"

# ── app del tenant ──
echo "▶ Levantando app…"
docker compose up -d app
sleep 4

# ── PIN inicial: detrás de Caddy el cliente NO puede crear PIN (isLocal exige 127.0.0.1 sin XFF).
#    Lo seteamos DESDE DENTRO del container (loopback = isLocal) y se lo entregamos al cliente. ──
# 10 dígitos (keyspace 10^10). El default de 6 dígitos era brute-forceable rotando IPs; 10 lo hace inviable y sigue entrando en el pad numérico.
# Bucle con $RANDOM (no `tr </dev/urandom | head`, que dispara SIGPIPE y aborta bajo `set -o pipefail`).
APP_PIN=""; while [ "${#APP_PIN}" -lt 10 ]; do APP_PIN="${APP_PIN}${RANDOM}"; done; APP_PIN="${APP_PIN:0:10}"
PIN_OK="$(docker compose exec -T -e APP_PIN="$APP_PIN" app node -e "fetch('http://127.0.0.1:3000/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:process.env.APP_PIN})}).then(r=>r.json()).then(j=>console.log(j.ok?'ok':(j.error||'fail'))).catch(e=>console.log('ERR '+e.message))" 2>/dev/null | tr -d '\r')"
[ "$PIN_OK" = "ok" ] || echo "  ⚠ no se pudo fijar el PIN automáticamente ($PIN_OK) — el cliente deberá crearlo por túnel local"

# ── ruta Caddy (subdominio → puerto del tenant) ──
mkdir -p "$CADDY_D"
cat > "$CADDY_D/$TENANT.caddy" <<EOF
$SUBDOMAIN {
    encode zstd gzip
    header {
        # Endurecimiento en el borde (defensa en profundidad; la app ya emite CSP/XFO/nosniff — esto los refuerza y oculta el server).
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        -Server
        # HSTS: opt-in a propósito. Descomentá SOLO si el subdominio va SIEMPRE por HTTPS (el navegador lo recuerda meses; es difícil de
        # revertir y puede dejar afuera a un cliente si algún día servís HTTP). Con Caddy + TLS automático suele ser seguro.
        # Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
    reverse_proxy 127.0.0.1:$APP_PORT
}
EOF
grep -q "import $CADDY_D/\*.caddy" /etc/caddy/Caddyfile 2>/dev/null || echo "import $CADDY_D/*.caddy" >> /etc/caddy/Caddyfile
systemctl reload caddy 2>/dev/null || docker exec caddy caddy reload 2>/dev/null || echo "  recargá Caddy a mano"

cat <<EOF

✅ Tenant '$TENANT' listo
   URL:        https://$SUBDOMAIN   (app en 127.0.0.1:$APP_PORT)
   PIN:        ${PIN_OK:+$([ "$PIN_OK" = ok ] && echo "$APP_PIN  ← entregáselo al cliente (lo cambia luego en Configuración)")}${PIN_OK:+}
   Datos:      $BASE   (data/ auth/ synapse/ postgres/ bridges/ — TODO aislado)
   Dueño:      $OWNER  ${EMAIL:+· $EMAIL}
   Siguiente:  el cliente entra a https://$SUBDOMAIN con su PIN → Configuración → vincula su WhatsApp (/link),
               agrega su correo y su token de IA. Nada compartido con otros tenants.
EOF
