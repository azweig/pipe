# STT local rápido con faster-whisper (opcional)

Transcripción de audio **local y privada** (el audio nunca sale a la nube), corriendo en tu GPU box
(o cualquier host con buen CPU). Usa [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(CTranslate2, int8 en CPU) → ~0.5–1 s por nota de voz, sin tocar la VRAM de Ollama.

## Instalar (en el host donde quieras el whisper)
```bash
sudo mkdir -p /opt/whisper-svc && cd /opt/whisper-svc
python3 -m venv venv
venv/bin/pip install faster-whisper fastapi uvicorn python-multipart
# copiá whisper_server.py de este dir a /opt/whisper-svc/
TOKEN=$(openssl rand -hex 16)   # guardalo
```
Creá el servicio systemd `/etc/systemd/system/pipe-whisper.service`:
```ini
[Unit]
Description=pipe Whisper (faster-whisper local STT)
After=network.target
[Service]
WorkingDirectory=/opt/whisper-svc
Environment=WHISPER_TOKEN=<TU_TOKEN>
Environment=WHISPER_MODEL=base
Environment=HF_HOME=/root/.cache/huggingface
ExecStart=/opt/whisper-svc/venv/bin/uvicorn whisper_server:app --host 0.0.0.0 --port 8700
Restart=always
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now pipe-whisper
# firewall: permití 8700 SOLO desde tu hub
sudo ufw allow from <IP_DEL_HUB> to any port 8700 proto tcp
```

## Conectarlo al hub
En el `.env` del hub:
```
WHISPER_URL=http://<IP_DEL_HOST>:8700
WHISPER_TOKEN=<TU_TOKEN>
```
Y en la config del hub, poné la transcripción en **local** (`stt: "local"`). El hub convierte el audio a
wav 16k con ffmpeg y lo manda al servicio; si el servicio no responde, cae al fallback (whisper.cpp local o nube).

**Modelos:** `base` (rápido, buena calidad para notas de voz) · `small`/`medium` (más precisos, más lentos).
