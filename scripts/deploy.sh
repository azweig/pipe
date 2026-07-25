#!/usr/bin/env bash
# Deploy de pipe al servidor. Sincroniza el código, limpia la data corrupta de identidades y reinicia.
# Uso:  bash scripts/deploy.sh <user>@<host> [/ruta/en/el/box]
#   ej: bash scripts/deploy.sh user@hub.example.com
set -euo pipefail

HOST="${1:?Falta destino. Uso: bash scripts/deploy.sh user@host [ruta]}"
REMOTE_DIR="${2:-/opt/pipe}"

echo "▶ 1/4 · sincronizando código a $HOST:$REMOTE_DIR (sin tocar data/ auth/ vault/ node_modules/)"
rsync -avz --relative \
  src/ public/ scripts/ deploy/ package.json \
  --exclude '__pycache__/' \
  "$HOST:$REMOTE_DIR/"

echo "▶ 2/4 · limpiando identidades corruptas (grupos mapeados como personas) — primero DRY, después real"
ssh "$HOST" "cd $REMOTE_DIR && node scripts/fix-group-identities.mjs --dry"
read -r -p "   ¿Aplicar la limpieza de arriba? [y/N] " ok
[ "$ok" = "y" ] && ssh "$HOST" "cd $REMOTE_DIR && node scripts/fix-group-identities.mjs" || echo "   (saltada)"

echo "▶ 3/4 · cerrando nudges viejos keyeados a grupos (JL, etc.)"
ssh "$HOST" "cd $REMOTE_DIR && node -e 'const fs=require(\"fs\"),f=\"./data/coach-nudges.json\",s=JSON.parse(fs.readFileSync(f));let n=0;for(const k in s)if(s[k].status===\"open\"&&/@g\\.us|:!|@thread\\.v2/.test(s[k].key||\"\")){s[k].status=\"done\";n++}fs.writeFileSync(f,JSON.stringify(s,null,2));console.log(\"cerrados\",n)'"

echo "▶ 4/4 · reiniciando el servicio web (ajustá si no usás systemd)"
ssh "$HOST" "sudo systemctl restart pipe 2>/dev/null || pkill -f 'src/server.mjs' || true"

echo "✅ deploy OK. El coach se regenera solo en su próximo ciclo; los nudges de grupo ya no van a aparecer."
