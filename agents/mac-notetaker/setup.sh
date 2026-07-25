#!/usr/bin/env bash
# Setup del notetaker en el Mac. Instala ffmpeg + BlackHole (audio loopback del sistema).
# Después hay UN paso manual en "Configuración de Audio MIDI" (macOS no deja automatizarlo).
set -e

echo "1/3 · Instalando ffmpeg + BlackHole (audio del sistema)…"
if ! command -v brew >/dev/null; then echo "Necesitás Homebrew: https://brew.sh"; exit 1; fi
brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
brew list blackhole-2ch >/dev/null 2>&1 || brew install blackhole-2ch

cat <<'EOF'

2/3 · PASO MANUAL (una sola vez) — abrí "Configuración de Audio MIDI" (Audio MIDI Setup):

  A) Crear DISPOSITIVO AGREGADO (para GRABAR mic + sistema):
     + (abajo izq) → "Crear dispositivo agregado"
     Tildá:  ✅ BlackHole 2ch   ✅ tu micrófono (MacBook Microphone)
     Renombralo: "Notetaker In"

  B) Crear SALIDA MÚLTIPLE (para SEGUIR ESCUCHANDO mientras se graba):
     + → "Crear dispositivo de salida múltiple"
     Tildá:  ✅ BlackHole 2ch   ✅ tus parlantes/auriculares
     Renombralo: "Notetaker Out"

  Durante una call: poné la SALIDA del sistema en "Notetaker Out"
  (Ajustes → Sonido → Salida), así el audio de la otra persona va a BlackHole y vos lo seguís oyendo.

3/3 · Elegí el índice del dispositivo agregado:
EOF

echo ""
echo "Dispositivos de audio detectados por ffmpeg:"
node "$(dirname "$0")/notetaker.mjs" devices 2>&1 | grep -iA30 "audio devices" || true
echo ""
echo "Anotá el número [n] de 'Notetaker In' y guardалo:"
echo "  echo '{\"device\":\"N\"}' > ~/.comms-notetaker.cfg.json"
echo ""
echo "Y abrí el túnel al server (si no lo tenés):  ssh -N -L 3000:localhost:3000 -i ~/.ssh/YOUR_KEY root@YOUR_SERVER_IP"
echo ""
echo "Probar:  node notetaker.mjs start \"Prueba\"  … hablá 10s …  node notetaker.mjs stop"
