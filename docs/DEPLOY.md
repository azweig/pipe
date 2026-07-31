# Deploy — go-live runbook (para una IA o un humano)

Este documento es un **runbook ejecutable**: un agente (Claude u otra IA) o una persona puede seguirlo de arriba a abajo para montar Pipe y dejarlo en producción. La sección **⚠️ Cambiar antes de producción** es la parte crítica — no vayas a prod sin recorrerla entera.

> Marca pública: **pipe.one**. Nombre técnico del paquete/servicio/paths: **pipe** (a propósito — no lo renombres, rompés la prod). Guías más profundas: [`SELF-HOSTING.md`](SELF-HOSTING.md) (self-host paso a paso) y [`../deploy/PROVISIONING.md`](../deploy/PROVISIONING.md) (multi-tenant).

---

## 1. Requisitos mínimos

| | **Local** (personal / dev) | **Servidor** (producción) |
|---|---|---|
| **SO** | macOS o Linux | Linux (probado en Debian 12 bookworm) |
| **Node** | **20 LTS** (NO 25 — rompe el crypto de Baileys/ABI de better-sqlite3) | **20 LTS** |
| **Toolchain** | `python3`, `make`, `g++` (compila better-sqlite3), `ffmpeg`, `sqlite3` | idem + **Docker + Docker Compose** (bridges) + **Caddy** (TLS/reverse-proxy) |
| **RAM** | ~1–2 GB (un solo hub) | Hub único: ~1–2 GB · **Multi-tenant: ~2 GB POR tenant** (Synapse+Postgres+bridge) |
| **Disco** | ~10 GB para arrancar (la media crece) | Planificá **100 GB+**; la media (CAS) crece ~GB/semana por usuario → **backup offsite obligatorio** |
| **CPU** | cualquiera | 4+ cores; la IA local (Ollama) sin GPU es lenta → para prod, BYOK a la nube o GPU aparte |
| **Red** | localhost | Dominio + DNS: **A record** al server (hub único) · **wildcard `*.hub.tudominio.com`** si vas multi-tenant |
| **Docker** | solo si querés WhatsApp (bridge) | sí (bridges + aislamiento por tenant) |

Regla de oro: **Node 20, nunca 25.** `scripts/check-node.mjs` corre en `prestart`/`pretest` y falla claro si la versión no sirve.

---

## 2. Elegí el camino

- **A — Local / personal:** una instancia para vos en tu máquina. Sin Docker (salvo que quieras WhatsApp). → §3.
- **B — Hub único en producción:** un server, un usuario/empresa, dominio propio, TLS. → §4.
- **C — Multi-tenant gestionado (pipe.one):** un stack Docker aislado por cliente, subdominios, provisioning automatizado. → §5.

---

## 3. Camino A — Local

**Recomendado — instalador guiado** (te pide identidad + keys por terminal, genera `SECRETS_KEY`, instala y testea):
```bash
git clone https://github.com/azweig/pipe.git && cd pipe
bash install.sh
node src/daemon.mjs        # web UI en http://localhost:3000
```
O manual: `npm install` → `cp .env.example .env` → `cp hub-config.example.json data/hub-config.json` (editalo, §6.1) → `npm test` → `node src/daemon.mjs`.
Desde tu máquina (loopback) NO pide PIN. La IA se configura en **Configuración → Motor de IA** (BYOK) o vía `.env`. WhatsApp/Telegram/etc. se conectan desde **Agregar conexión** en la app.

---

## 4. Camino B — Hub único en producción

1. **Server + Node 20** (NodeSource) + toolchain + ffmpeg + sqlite3 + Caddy.
2. Cloná en `/opt/pipe`, `npm install`, `cp .env.example .env`, editá `.env` y `data/hub-config.json`.
3. **systemd**: `cp deploy/pipe.service /etc/systemd/system/ && systemctl enable --now pipe` (corre `node src/daemon.mjs`, `Restart=always`).
4. **Caddy** (TLS + reverse proxy): ver `deploy/Caddyfile.example`. El bloque de tu dominio → `reverse_proxy 127.0.0.1:3000`. Caddy saca el TLS solo cuando el DNS resuelve.
5. **`HOST=127.0.0.1`** en `.env` (Caddy mete el `X-Forwarded-For` → el gate de PIN funciona). Dentro de un container sería `0.0.0.0`.
6. **Recorré el §7 (Cambiar antes de producción).**
7. **Backup**: `cp deploy/pipe-backup.{service,timer} /etc/systemd/system/ && systemctl enable --now pipe-backup.timer`.
8. **Deploy de cambios**: `scripts/deploy.sh` (rsync del working tree + restart) o `git pull && npm install && systemctl restart pipe`. Corré `npm test` antes.

---

## 5. Camino C — Multi-tenant gestionado

Ver `deploy/PROVISIONING.md` para el detalle. Resumen:

```bash
# En el server, una vez: Docker + Caddy + wildcard DNS *.hub.tudominio.com → IP
docker build -f deploy/Dockerfile -t pipe:latest .        # imagen del tenant

# Por cada cliente:
bash deploy/provision.sh <id> <subdominio> "<Dueño>" <email>
#   → /opt/tenants/<id>/, secretos propios, Synapse+Postgres+bridge, app en 127.0.0.1:<puerto>,
#     ruta Caddy + TLS auto, PIN de 6 dígitos impreso al final (entregáselo al cliente).
```
- **Operar la flota**: `deploy/tenants.sh list|logs|restart|backup-all|update-all`.
- **Actualizar la imagen a todos**: `deploy/tenants.sh update-all` (rolling; reinicia cada tenant → coordinar con clientes reales).
- **Dar de baja**: `deploy/deprovision.sh <id> [--backup]`.

### ⚠️ Gotchas de la imagen (verificados en incidentes reales)
- **El `Dockerfile` necesita `git`** (dep `libsignal` de Baileys se instala por git). Ya está en el Dockerfile; no lo saques.
- **`COPY . .` NO respeta `.gitignore`** — respeta `.dockerignore`. Antes de buildear, asegurate que `.dockerignore` excluya `.env`, `data`, `auth`, `vault`, `secrets`, `src/seed-graph.mjs`, `web`, `.secret-key`. **Verificá la imagen SIEMPRE**:
  ```bash
  docker run --rm --entrypoint sh pipe:latest -c \
    'for f in .env src/seed-graph.mjs; do test -e /app/$f && echo "BAD: $f horneado" || echo "ok: $f"; done; for d in data auth secrets web; do test -d /app/$d && echo "BAD: $d" || echo "ok: $d"; done'
  ```
- **En esta caja NO uses `pkill -f "src/…"` amplio**: mata los procesos de los contenedores de los tenants (el host los ve en su PID namespace). Usá `systemctl` para el host y `docker …` para los tenants. Tenant = cgroup `docker-*.scope` / binario `/usr/local/bin/node`; host = `/usr/bin/node`.

---

## 6. Configuración

### 6.1 Identidad — `data/hub-config.json` (OBLIGATORIO)
Define quién es el dueño (para atribuir "vos" y saludar). Si no lo creás, los defaults del código quedan genéricos ("Owner"). Claves:
`ownerName`, `ownerFirst`, `company`, `myNumbers[]`, `myEmails[]`, `timezone`, `domain`, y opcional `storageGB` (cuota de disco por hub). Los números/mails propios se aplican **al reiniciar** el servicio.

### 6.2 Secretos e integraciones — `.env`
Ver `.env.example` (comentado). Nada es obligatorio salvo lo que active la feature que uses. BYOK: la IA y los tokens los pone cada hub.

---

## 7. ⚠️ CAMBIAR ANTES DE PRODUCCIÓN (checklist de go-live)

No vayas a prod sin recorrer esto. Un agente debe **detenerse y pedir** los valores que el usuario tiene que proveer (marcados 👤).

- [ ] **Node 20** confirmado (`node -v` → v20.x). Nunca 25.
- [ ] **`data/hub-config.json`** con la identidad real (no los defaults genéricos). 👤
- [ ] **`SECRETS_KEY`** seteada en `.env` (AES-256, 32 bytes; generala con `openssl rand -base64 32`). **En Docker es OBLIGATORIA** — si falta, se genera `./data/.secret-key` que NO persiste entre rebuilds → romperías todos los tokens BYOK cifrados. 👤 (generá una y guardala fuera del repo)
- [ ] **PIN de acceso** creado (detrás de Caddy nadie es `isLocal`; en multi-tenant `provision.sh` lo setea desde dentro del container y lo imprime). 👤
- [ ] **Keys de IA** (BYOK) — al menos una de `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`, o un Ollama accesible. 👤
- [ ] **Correo** (si lo usás): OAuth Google (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` + redirect URI `https://<dominio>/oauth/google/callback` por subdominio) 👤, o IMAP con contraseña de aplicación desde la UI.
- [ ] **DNS**: A record (hub único) o wildcard `*.hub.tudominio.com` (multi-tenant) apuntando a la IP. 👤
- [ ] **Caddy**: dominio configurado, TLS emitido (verificá `https://…` con cert válido).
- [ ] **`HOST=127.0.0.1`** (detrás de Caddy en el host) o `0.0.0.0` (dentro de container).
- [ ] **`TRUSTED_HOSTS=<tus dominios>`** (anti DNS-rebinding). 👤
- [ ] **`LLM_BLOCK_PRIVATE_HOSTS=1`** (anti-SSRF).
- [ ] **`DB_BUSY_TIMEOUT_MS=10000`** (el default 2000 dio `SQLITE_BUSY` bajo carga real).
- [ ] **`BACKUP_RCLONE_REMOTE`** configurado + `rclone` con crypt para el offsite del **CAS** (media). Sin esto, RPO=∞ — **es el riesgo #1**. 👤 (bucket + token, ej. Cloudflare R2)
- [ ] **Backup local** (systemd timer) andando y **restore probado** al menos una vez.
- [ ] **Privacidad IA**: confirmá que los crons sensibles (graphify/learn/email-sum/enrich) van **local-only** (default). Solo poné `SENSITIVE_ALLOW_CLOUD=1` si el usuario lo elige, o togglealo por feature desde la UI.
- [ ] **Imagen Docker sin secretos** (multi-tenant): corré la verificación de §5. Un tenant nuevo debe tener `SELECT COUNT(*) FROM messages = 0`.
- [ ] **`npm test`** verde (191).
- [ ] **Health**: `curl https://<dominio>/api/health` → `{"ok":true}`; `ingestLagMin` bajo; canales fluyendo.
- [ ] **Monitoreo externo** (healthchecks.io u otro) apuntando a `/api/health` — la única alerta que sobrevive a una caída total.
- [ ] **Disco**: alerta cuando pase ~80%. La media (CAS) crece; sin offsite + GC, se llena (nos pasó: 100% de disco frenó todo).

### Antes de hacer el repo PÚBLICO (aparte del deploy)
- [ ] Árbol trackeado limpio: cero secretos, cero `data/auth/vault/.env/seed-graph/web/secrets` (todos gitignoreados). Verificá con `git grep` sobre `git ls-files`.
- [ ] La historia vieja de git contiene datos confidenciales (seed-graph) → **primer push a un repo nuevo como un único commit inicial limpio** (no arrastres la historia).

---

## 8. Verificación post-deploy

```bash
systemctl is-active pipe                 # active
curl -s http://localhost:3000/api/health      # {"ok":true,...}
curl -s http://localhost:3000/api/channels    # salud de canales (stale?)
df -h /                                        # disco
free -h                                        # RAM
journalctl -u pipe --since "5 min ago"   # sin restart-loops / errores
```

## 9. Rollback
- **Código**: el deploy respalda a `.bak/` / `codebak-*.tar.gz` antes de rsyncear. Restaurá y `systemctl restart pipe`.
- **Datos**: restaurá desde el último backup (`scripts/restore.sh`). El CAS se restaura del offsite (`restore.sh --cas`) si está configurado.
- **Imagen tenant**: `pipe:latest` guarda el digest anterior; recreá el container con la imagen previa si una actualización rompe algo.
