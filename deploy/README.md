# Deploy de pipe.one en tu servidor (24/7)

Archivos preparados para que el hub corra confiable en el server. **Todo esto se ejecuta en el box**, no localmente.

## 1. Supervisor (arranca solo + se recupera si muere)

```bash
sudo cp deploy/pipe.service /etc/systemd/system/
# ajustá User=, WorkingDirectory= y el path de node en ExecStart si hace falta
sudo systemctl daemon-reload
sudo systemctl enable --now pipe
journalctl -u pipe -f          # ver logs en vivo
```
Con esto el daemon arranca tras reboot y `Restart=always` lo revive si cae.
(Junto con el fix de fuga de FDs en `daemon.mjs`, ya no muere solo en ~1h.)

## 2. Backup diario + restore verificado

```bash
sudo cp deploy/pipe-backup.{service,timer} /etc/systemd/system/
# editá Environment=BACKUP_RCLONE_REMOTE= con tu remote rclone (offsite REAL)
sudo systemctl daemon-reload
sudo systemctl enable --now pipe-backup.timer
sudo systemctl start pipe-backup.service   # probar una corrida ya
```
`backup.sh` ahora incluye **`auth/`** (tokens/sesiones — lo más caro de recrear), escribe atómico y deja un `.sha256`. `restore.sh` verifica ese checksum y corre `PRAGMA integrity_check` sobre la DB restaurada → el backup deja de ser una hipótesis.

> ⚠️ **Custodia de la passphrase**: `secrets/backup.pass` NO va en el backup (correcto) ni en git. Guardá una copia offsite (gestor de contraseñas). Sin ella, **todos los backups son indescifrables**.

## 3. TLS (cierra el Matrix-en-HTTP-plano y el rate-limit del PIN)

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile   # editá dominios
sudo systemctl reload caddy
```
Después, en el `.env` del box:
```
MATRIX_HS=https://matrix.example.com
```
Así el token Matrix y **el contenido de todos los mensajes** dejan de viajar en texto claro por internet. El `header_up X-Forwarded-For {remote_host}` de Caddy es lo que hace no-spoofeable el rate-limit del PIN.

## 4. Dead-man's-switch externo (alerta si TODO se cae)

El heartbeat vive dentro del daemon → si el daemon/box muere, nadie avisa. Agregá un ping saliente a un monitor externo (healthchecks.io gratis):

```bash
# crontab -e  (del user comms) — pinga cada 5 min SOLO si el server web responde
*/5 * * * * curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null && curl -fsS -m10 https://hc-ping.com/<TU-UUID> >/dev/null
```
Si el hub deja de pingar, healthchecks.io te manda mail/Telegram. Es la única alerta que sobrevive a una caída total.

---

## Lo que queda en tu cancha (decisiones/acciones que no puedo hacer desde acá)

- [ ] Poner Caddy/DNS para `matrix.example.com` y setear `MATRIX_HS=https://...` (o WireGuard). **Es el fix crítico de confidencialidad.**
- [ ] Configurar `BACKUP_RCLONE_REMOTE` a un offsite real (hoy los backups viven en el mismo disco).
- [ ] Crear el monitor en healthchecks.io y pegar el UUID en el cron.
- [ ] Guardar `secrets/backup.pass` offsite.
- [ ] Elegir el largo del PIN (ahora mínimo 6 dígitos; podés usar más).
