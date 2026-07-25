# Pipe

**Every conversation you have, in one place — with an AI that actually reads them.**

Pipe is a self-hostable **unified inbox + AI second brain**. It merges WhatsApp, email, Telegram, Teams, Instagram and more into a single thread per person, then adds an AI layer that reads everything, summarizes long threads and voice notes, tells you who's waiting on a reply, and drafts responses in your voice. Your data stays on your own infrastructure.

> Status: early but real — runs in production for its author, daily. The UI and AI prompts are in Spanish. → **[pipe.one](https://pipe.one)**

## Why Pipe

- **One inbox, every channel** — WhatsApp + email + Telegram… collapse into the same conversation per person. Stop tab-hopping between apps.
- **AI that reads for you** — summaries of long threads and voice notes, a daily brief, "who needs a reply", and drafts written in your style. Multi-provider with fallback (OpenAI / Anthropic / Gemini / local Ollama).
- **A second brain, built automatically** — a living knowledge graph of the people, companies and projects in your life, grown from your own activity. Your self-notes become ideas and reminders.
- **A real backup of everything** — a daily, encrypted, restore-tested backup of your whole history: every message, the WhatsApp bridge sessions, your OAuth tokens, and the irreplaceable media — photos, voice notes and PDFs from every channel. On your box, and offsite if you want it.
- **Your keys, your box** — bring your own AI engine or run everything locally with Ollama. Single-tenant, self-hostable, secrets encrypted at rest. No data leaves your infrastructure.

## Own your data

Every "free" inbox is a rental. Your WhatsApp chats, your emails, the years of photos and voice notes inside them — they live on someone else's servers, under someone else's terms. They can rate-limit you, lock you out, change the rules, get breached, or simply shut the service down. The day any of that happens, the conversations that are the record of your life go with it — and there was never really an export button that handed you *all* of it.

Pipe flips that. It pulls your conversations **onto hardware you control** and keeps them in a plain SQLite database plus a folder of files you can read, copy and back up yourself. No account to suspend, no company standing between you and your own history.

- **It's yours, on your box.** Single-tenant, self-hosted. Your messages, your media, your knowledge graph — on your server, not someone else's.
- **Nothing leaves without you.** The AI that reads your data runs locally by default (Ollama + local whisper), and the privacy-sensitive jobs are hard-wired local-only. Use cloud models only if *you* decide to.
- **An archive, not a hostage.** WhatsApp, email and every other channel are mirrored and **backed up daily, encrypted** — messages, bridge sessions and the media that can never be re-downloaded. Restore is tested, not theoretical. "Export" is just copying a folder.
- **No lock-in.** MIT-licensed, vanilla Node + SQLite, zero framework. If you ever want out, it's all there in open formats.

**Your data. Your server. Your rules.** That's the whole point.

## Hosted / done-for-you

Don't want to run it yourself? There's a **managed version** — the whole stack set up for you on dedicated infrastructure (channels connected, WhatsApp bridge, backups, updates); you just use it. → **[pipe.one](https://pipe.one)**, or reach out to talk about a managed install.

## Requirements

- **Node.js 20 LTS** (not 25 — breaks the Baileys crypto path). See `.nvmrc`.
- **ffmpeg** (voice notes / audio), **better-sqlite3** build toolchain (`python3`, `make`, `g++`).
- Optional: **Ollama** (local models), **whisper** (`WHISPER_BIN`, local speech-to-text), **yt-dlp** (video fetch), **Docker + Matrix/mautrix** (WhatsApp & other bridges — see `deploy/PROVISIONING.md`).

> **Going to production?** See **[`docs/DEPLOY.md`](docs/DEPLOY.md)** — a go-live runbook (for a human or an AI agent) with the full **local-vs-server minimum requirements**, step-by-step, and a **"change before production"** checklist.

## Quick start

**Easiest — guided installer.** Asks for your identity and keys (AI, Google, Microsoft…) over the terminal and writes `.env` + `data/hub-config.json`, generates your `SECRETS_KEY`, installs deps and runs the tests:

```bash
git clone https://github.com/azweig/pipe.git && cd pipe
bash install.sh
```
Then `node src/daemon.mjs` (web UI on http://localhost:3000). Connect WhatsApp, email, etc. from the app: **Settings → Add connection**.

### Docker

```bash
git clone <this-repo> pipe && cd pipe
cp .env.example .env                              # fill in the AI keys you use
cp hub-config.example.json data/hub-config.json   # your identity (name, numbers, emails)

docker compose up -d --build                      # web UI on http://localhost:3000
```

### From source

```bash
git clone <this-repo> pipe && cd pipe
npm install                                       # builds better-sqlite3 natively
cp .env.example .env
cp hub-config.example.json data/hub-config.json

npm run web        # web UI + API on http://localhost:3000
# or the full always-on daemon (web + all channel readers):
npm start
```

First run over the tunnel/localhost lets you set the access **PIN** (required once you expose it behind a reverse proxy). Then open the app → **Configuración** to connect channels and choose your AI engine.

## Configuration

- **Identity** — `data/hub-config.json` (owner name, your phone numbers/emails for self-routing, timezone). Editable from the UI (*Configuración → Este hub*).
- **Environment** — `.env` (AI keys, Matrix, integrations). See `.env.example` for the full list.
- **AI engine** — from the UI (*Configuración → Motor de IA*) or via `.env`. Tokens are stored encrypted (`src/lib/secrets.mjs`).
- **Knowledge graph seed** (optional) — copy `src/seed-graph.example.mjs` to `src/seed-graph.mjs`, fill in your org/contacts, run `node src/seed-graph.mjs`.

## Channels

- **Email** — IMAP (Gmail/Outlook via app password) or Microsoft Graph. Add from *Configuración → Correo*.
- **WhatsApp / Telegram / Instagram / Messenger / Discord** — via [mautrix](https://docs.mau.fi/) bridges on a Matrix homeserver. Connect by QR/code from `/link`. See `deploy/PROVISIONING.md` for the Docker stack. WhatsApp/LinkedIn can alternatively run through [Unipile](docs/UNIPILE.md).
- **Teams / Notion / Google Calendar & Drive** — via their APIs (keys in `.env`).

## Documentation

- **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)** — full self-host walkthrough (install, config, connect every channel, WhatsApp bridge, ops, troubleshooting). **Start here.**
- [docs/UNIPILE.md](docs/UNIPILE.md) — the managed WhatsApp/LinkedIn channel.
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)

## Architecture & deployment

- `docs/ARCHITECTURE.md` — how the pieces fit (readers → SQLite → brain → web/API → PWA).
- `docs/REFERENCE.md`, `docs/openapi.json` — API reference (auto-generated by `node scripts/gen-docs.mjs`).
- `deploy/` — systemd units, `Caddyfile.example` (TLS + PIN gate), and `deploy/PROVISIONING.md` for the multi-instance Docker setup.

No framework: a vanilla Node HTTP server + SQLite (better-sqlite3) + a hash-routed vanilla-JS PWA. The query layer (`src/lib/brain.mjs`) and data layer (`src/lib/db.mjs`) are thin facades over per-domain modules — small, testable seams rather than god objects.

## Security

PIN-gated when exposed to the internet (rate-limited, scrypt-hashed, session cookies — never the PIN). BYOK tokens encrypted at rest (AES-256-GCM). Same-origin, strict CSP-friendly. Never commit `.env`, `auth/`, `data/` or `vault/` — they're gitignored; package releases with `git archive`, not by copying the folder.

## Support

Pipe is free and open source, built and maintained by one person. If it saves you time — or you just want to keep it alive — **[buy me a coffee on Ko-fi](https://ko-fi.com/azweig)** ☕, or use the **Sponsor** button at the top of the repo. Every bit helps and is hugely appreciated. 🙏

Rather not self-host? The **[managed version](https://pipe.one)** funds development too.

## License

MIT © 2026 Alvaro Zweig. See `LICENSE`.
