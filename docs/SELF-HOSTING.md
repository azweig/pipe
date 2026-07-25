# Self-hosting Pipe

A complete walkthrough to run your own private instance. Everything lives on your box; nothing is sent to us.

> The managed cloud (**pipe.one**) runs exactly this code for you if you'd rather not self-host. This guide is for running it yourself.

**Two levels:**
- **Basic** (10 min) — email, Telegram, the AI layer and the web app. No Docker needed.
- **WhatsApp** (30–45 min) — adds a Matrix bridge (Synapse + Postgres + mautrix-whatsapp) via Docker. This is the involved part; skip it if you don't need WhatsApp.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 20 LTS** | **Not 25** — it breaks the native crypto path. Use `.nvmrc`. |
| Build toolchain | `python3`, `make`, `g++` — for building `better-sqlite3`. |
| **ffmpeg** | Voice notes / audio transcription. |
| **sqlite3** CLI | Backups. |
| *Optional* | **Ollama** (local models), **whisper.cpp** (local speech-to-text, set `WHISPER_BIN`), **yt-dlp** (download links/videos), **Docker + Docker Compose** (WhatsApp bridge). |

A Linux box (or a Mac for local use). ~1 GB RAM is plenty for a single instance; ~10 GB disk to start (media grows).

---

## 2. Install

```bash
git clone https://github.com/azweig/pipe.git && cd pipe
npm install            # builds better-sqlite3 natively (needs the toolchain above)

cp .env.example .env                                # secrets & integration keys
cp hub-config.example.json data/hub-config.json     # your identity
```

Edit **`data/hub-config.json`** — this is who you are (used to route "yourself" and greet you):

```json
{
  "ownerName": "Your Name",
  "ownerFirst": "You",
  "company": "",
  "myNumbers": ["5491100000000"],        // your WhatsApp number(s), digits only
  "myEmails": ["you@gmail.com"],         // your own email(s)
  "timezone": "America/Lima",
  "domain": "localhost"
}
```

Edit **`.env`** — fill only what you use (see `.env.example` for the full list). At minimum, one AI key **or** an Ollama host if you want the AI layer:

```bash
OPENAI_API_KEY=sk-...          # or ANTHROPIC_API_KEY / GEMINI_API_KEY
# OLLAMA_HOST=http://localhost:11434   # for fully-local AI
SECRETS_KEY=                   # 32-byte base64; generate with: openssl rand -base64 32
```

`SECRETS_KEY` encrypts your channel passwords/tokens at rest. **Set it once and keep it** — losing it means re-authenticating every channel.

---

## 3. Run it

```bash
npm run web     # just the web UI + API → http://localhost:3000  (good for first setup)

npm start       # the full daemon: web + all channel readers + AI crons (always-on)
```

First run **on localhost** lets you set an access **PIN** (asked once you expose the app publicly). Open `http://localhost:3000` → **Configuración** to connect channels and pick your AI engine.

**As a service (Linux/systemd):**

```ini
# /etc/systemd/system/pipe.service
[Unit]
Description=Pipe
After=network.target
[Service]
WorkingDirectory=/opt/pipe
EnvironmentFile=/opt/pipe/.env
ExecStart=/usr/bin/node src/daemon.mjs
Restart=always
[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now pipe
```

---

## 4. Expose it (reverse proxy + TLS)

Put it behind a reverse proxy that terminates TLS. [Caddy](https://caddyserver.com) does it in two lines:

```
your.domain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Once it's reachable from the internet, the app **requires a PIN**. You create it on first access from localhost (or from inside the container). The session is a cookie; the PIN is never the number sent to the browser.

The `/api/health` endpoint is public (no PIN) — point your status page at it (see §8).

---

## 5. Connect channels

All from the app: **Configuración → Conexiones** (or `/link`). Per channel:

- **Email (IMAP)** — add an account with an **app password** (Gmail/Outlook require one, not your normal password; enable IMAP in the account). Encrypted at rest.
- **Email (Gmail OAuth)** — the "Connect Gmail → Allow" flow. Needs a Google OAuth Web app (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`); redirect URI `https://your.domain/oauth/google/callback`.
- **Telegram** — set `TG_API_ID`, `TG_API_HASH`, `TG_PHONE` (from https://my.telegram.org). The login code is read from `/tmp/tg_code` (the app tells you).
- **Microsoft (Teams / Outlook)** — set `MS_CLIENT_ID`, `MS_TENANT_ID` (Azure app registration, device-code flow). Follow the device-code link printed on start.
- **Notion** — `NOTION_TOKEN`.
- **WhatsApp** — needs the Matrix bridge → §6.

---

## 6. WhatsApp (Matrix bridge)

WhatsApp reading is done through a **Matrix homeserver + the mautrix-whatsapp bridge**, which you scan with your phone (like WhatsApp Web). This is a self-hosted stack via Docker.

> **Honest note:** reading a *personal* WhatsApp is inherently unofficial (WhatsApp has no official API for it). The bridge behaves like a linked device. This is your account and your risk; keep it to your own number.

The quickest path uses the same recipe our provisioner uses — see **`deploy/PROVISIONING.md`** for a Docker Compose that brings up Synapse + Postgres + mautrix-whatsapp wired together. The three things that matter (validated):

1. Homeserver `address: http://synapse:8008` in the bridge config.
2. The bridge must bind `hostname: 0.0.0.0` (default `127.0.0.1` = loopback only → Synapse can't reach it).
3. The registration `url: http://<bridge-container>:29318` (not `localhost`).

Point Pipe at the homeserver via `.env`:
```bash
MATRIX_HS=http://localhost:8008
MATRIX_USER=admin
MATRIX_PW=<your matrix password>
MATRIX_DOMAIN=<your server_name>
```
Then in the app → **Conexiones → WhatsApp → Add account** → scan the QR. The reader auto-joins the bridged rooms and messages start flowing.

*Instagram, Telegram, Discord, Signal, etc. work through the same Matrix mechanism with their respective mautrix bridges.*

---

## 7. AI engine (bring your own key)

Configuration → **Motor de IA**. Pick a provider and paste your token, or point at a local Ollama. The chain falls back across providers.

Privacy-sensitive crons (the knowledge graph, the self-model learner, email summaries, conversation enrichment) run **local-only** by default — they derive their model chain from a single source (`smartChain`) and ignore the general `LLM_CHAIN` knob, so your private data never leaves the box regardless of how the process was launched. To consciously allow a cloud fallback for these (e.g. until you have a GPU) set `SENSITIVE_ALLOW_CLOUD=1` (and optionally `LLM_CHAIN_SENSITIVE=ollama,gemini` to pick the chain — it only takes effect with the escape on). STT can run locally with whisper.

---

## 8. Operations

**Backups** — `scripts/backup.sh` makes an encrypted, consistent bundle (DB snapshot + configs + `auth/` + WhatsApp bridge sessions), excludes the giant `messages.jsonl` (already materialized in the DB). Put a passphrase in `secrets/backup.pass`. Schedule it, and set `BACKUP_RCLONE_REMOTE` for offsite copies.

**Status page** — the app exposes `GET /api/health` → `{"ok":true,"ingestLagMin":N,"uptimeMin":N}` (public). Point [Uptime Kuma](https://github.com/louislam/uptime-kuma) (a one-container self-hosted status page) at it.

**Updates** — `git pull && npm install && systemctl restart pipe`. Run `npm test` first.

**Logs** — `data/logs/<reader>.log` per reader, `data/daemon.log` for the supervisor. Rotated automatically.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `better-sqlite3` build fails | Missing toolchain (`python3`, `make`, `g++`) or Node ≠ 20. |
| A channel reader keeps restarting | It's waiting for credentials (backs off to 60s). Add the account in the app. |
| WhatsApp "receives but doesn't send" | The number's bridge session was logged out by WhatsApp — re-scan the QR. |
| Email won't connect | Use an **app password** (not your account password) and enable IMAP. |
| `/link` shows nothing | Bridges aren't enabled/installed on this host, or open it in a normal browser tab. |

---

Questions or a bug? Open an issue. Contributions welcome — see [CONTRIBUTING.md](../CONTRIBUTING.md).
