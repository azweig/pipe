# Pipe

**Every conversation you have, in one place — with an AI that actually reads them.**

Pipe is a self-hostable **unified inbox + AI second brain**. It merges WhatsApp, email, Telegram, Teams, Instagram and more into a single thread per person, then adds an AI layer that reads everything, summarizes long threads and voice notes, tells you who's waiting on a reply, and drafts responses in your voice. Your data stays on your own infrastructure.

> Status: early but real — runs in production for its author, daily. The UI and AI prompts are in Spanish. → **[pipe.one](https://pipe.one)**

## Why Pipe

- **One inbox, every channel** — WhatsApp + email + Telegram… collapse into the same conversation per person. Stop tab-hopping between apps.
- **AI that reads for you** — summaries of long threads and voice notes, a daily brief, "who needs a reply", and drafts written in your style. Multi-provider with fallback (OpenAI / Anthropic / Gemini / local Ollama).
- **Transcribe & summarize any media** — long-press (app) or the ⋯ menu (web) on a video, voice note or image → it transcribes (auto-detecting the language) and gives you a **Spanish summary** even if the clip is in English, Japanese, etc. Fast **local** speech-to-text via [faster-whisper](deploy/whisper/README.md) — the audio never leaves your box.
- **A second brain, built automatically** — a living knowledge graph of the people, companies and projects in your life, grown from your own activity. Your self-notes become ideas and reminders.
- **A real backup of everything** — a daily, encrypted, restore-tested backup of your whole history: every message, the WhatsApp bridge sessions, your OAuth tokens, and the irreplaceable media — photos, voice notes and PDFs from every channel. On your box, and offsite if you want it.
- **Your keys, your box** — bring your own AI engine or run everything locally with Ollama. Single-tenant, self-hostable, secrets encrypted at rest. No data leaves your infrastructure.
- **Bring your own AI assistant (MCP)** — connect Claude Desktop/Code (or any MCP client) straight to your inbox: search, read threads and pending items, and — if you turn it on — reply/forward with a confirmation step. Read-only by default, zero egress of its own, every call audited. See [docs/MCP.md](docs/MCP.md).
- **Covert mode ("The Saint")** — send a message that reads as an innocuous poem, story, recipe or prayer to anyone who sees it (e.g. on WhatsApp), but decrypts back to the real text for the other person if they use Pipe with the same passphrase. Real authenticated encryption (AES-256-GCM, per-message salt) under a coherent-looking cover text. Per-contact key and style; the recipient can also decrypt in the browser (your hub serves its own client-side decoder at `/decrypt`). Try it at [pipe.one/secret-messages](https://pipe.one/secret-messages). See [docs/COVERT.md](docs/COVERT.md).
- **An assistant in your own chat** — message *yourself* on WhatsApp (or send a voice note) and Pipe answers **only if you asked something**; notes, links and reminders are left alone. It combines press from ~56 outlets worldwide, your configurable RSS feeds and Reddit with your own history, and answers in the same chat. Voice notes are transcribed **locally** (whisper on your box), so questions asked from a hidden line are answered by a **local model** — nothing leaves. Off by default; per-day cap. See [docs/USER-GUIDE.md](docs/USER-GUIDE.md#12-an-assistant-in-your-own-chat).
- **Email that behaves like email** — open the full message with its **inline images** and attachments, and reply by hand or with AI **with your signature** and proper `In-Reply-To` headers, so your answer threads on the other side. Remote images stay blocked by CSP inside a sandboxed viewer: tracking pixels never fire, so senders don't learn you opened it.
- **Search that reaches every conversation** — the inbox shows the most recent threads, but search asks the server and covers **all** of them (thread key + sender name over an FTS index), so a contact you haven't written to in weeks is still one query away.
- **Hide a whole line behind a second PIN** — mark a number or mailbox as secret and it disappears from the app until you enter your 2nd PIN. Someone glancing at your screen can't tell it exists, and background jobs (coach, digests, knowledge graph) never read it.
- **Media that doesn't eat your disk** — an optional background pass recompresses stored media (lossless for images, H.265 for video) while keeping the blob's address stable, so nothing that points at it breaks. A perceptual-hash report finds near-duplicates that exact hashing can't see (the same photo re-encoded by another channel).
- **Import your history** — WhatsApp: *Export chat* → upload the `.txt` and Pipe merges it into the right thread with content de-duplication (per-chat; WhatsApp has no "export everything"). Telegram: `node src/telegram-backfill.mjs` pulls your existing conversations — the live reader only captures what arrives after you connect, so without this your years of history simply wouldn't be there.

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
- Optional: **Ollama** (local models), **whisper** (`WHISPER_BIN`, local speech-to-text), **yt-dlp** + **gallery-dl** + **instaloader** (video/reel fetch — instaloader pulls public Instagram reels/posts without login), **Docker + Matrix/mautrix** (WhatsApp & other bridges — see `deploy/PROVISIONING.md`).

> **Going to production?** See **[`docs/DEPLOY.md`](docs/DEPLOY.md)** — a go-live runbook (for a human or an AI agent) with the full **local-vs-server minimum requirements**, step-by-step, and a **"change before production"** checklist.

## Choose your install

| I want… | Path | Get started | Guide |
|---|---|---|---|
| **The simple one** — Pipe on my own Mac/Linux, for me | One command | `git clone https://github.com/azweig/pipe.git && cd pipe && bash install.sh` | [DEPLOY.md → Path A](docs/DEPLOY.md) |
| **My own server** — one hub, my domain, always-on | Single server / VPS | Clone on the box → `bash install.sh` → systemd + Caddy (TLS) | [DEPLOY.md → Path B](docs/DEPLOY.md) · [SELF-HOSTING.md](docs/SELF-HOSTING.md) |
| **A fleet** — one isolated instance per client | Multi-tenant (Docker) | `bash deploy/provision.sh <id> <subdomain> "<Owner>" <email>` | [deploy/PROVISIONING.md](deploy/PROVISIONING.md) · [DEPLOY.md → Path C](docs/DEPLOY.md) |

Already installed? → **[How to use Pipe](docs/USER-GUIDE.md)**.

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

### Optional: let an AI agent do it

Every step above is a plain, human-followable command — you never need an AI to install Pipe. But if you happen to use [Claude Code](https://claude.com/claude-code) (or any coding agent), you can also just open the repo in it and say *"install Pipe here"* or *"deploy Pipe to this server."* It follows the same [`CLAUDE.md`](CLAUDE.md) + [`docs/DEPLOY.md`](docs/DEPLOY.md) a person would, and stops to ask you only for what it can't know — your keys, your domain, your PIN. Purely optional.

## Configuration

- **Identity** — `data/hub-config.json` (owner name, your phone numbers/emails for self-routing, timezone). Editable from the UI (*Configuración → Este hub*).
- **Environment** — `.env` (AI keys, Matrix, integrations). See `.env.example` for the full list.
- **AI engine** — from the UI (*Configuración → Motor de IA*) or via `.env`. Tokens are stored encrypted (`src/lib/secrets.mjs`).
- **Knowledge graph seed** (optional) — copy `src/seed-graph.example.mjs` to `src/seed-graph.mjs`, fill in your org/contacts, run `node src/seed-graph.mjs`.

## Channels

- **Email** — IMAP (Gmail/Outlook via app password) or Microsoft Graph. Add from *Configuración → Correo*.
- **WhatsApp / Telegram / Instagram / Messenger / Discord** — via [mautrix](https://docs.mau.fi/) bridges on a Matrix homeserver. Connect by QR/code from `/link`. See `deploy/PROVISIONING.md` for the Docker stack. WhatsApp/LinkedIn can alternatively run through [Unipile](docs/UNIPILE.md).
- **Teams / Notion / Google Calendar & Drive** — via their APIs (keys in `.env`).

> **Heads-up on WhatsApp:** bridging WhatsApp through an unofficial gateway (mautrix or Unipile) is against WhatsApp's Terms of Service and *can* get a number banned. Use a number you're comfortable putting at risk, not your primary line. Email, Telegram, Teams and the API-based channels don't carry this risk.

## Documentation

- **[docs/USER-GUIDE.md](docs/USER-GUIDE.md)** — **How to use Pipe** once it's installed: the inbox, search, the AI layer, autopilot, spaces, notes, covert mode, WhatsApp import and more. **Start here after installing.**
- **[docs/README.md](docs/README.md)** — the docs index (use it → install it → run a fleet → extend it).
- **[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)** — full self-host walkthrough (install, config, connect every channel, WhatsApp bridge, ops, troubleshooting). **Start here to self-host.**
- [docs/UNIPILE.md](docs/UNIPILE.md) — the managed WhatsApp/LinkedIn channel.
- [docs/MCP.md](docs/MCP.md) — connect an AI assistant to your inbox via the Model Context Protocol (read/write tools, privacy-first, stdio or SSH; no open ports).
- [docs/COVERT.md](docs/COVERT.md) — covert mode ("The Saint"): send encrypted messages disguised as natural text; per-hub client-side decoder at `/decrypt`.
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
