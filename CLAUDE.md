# Pipe — agent guide (install / run / deploy)

You're helping someone **run, install, or deploy Pipe** — a self-hostable unified inbox + AI second brain (Node 20 + SQLite + a vanilla-JS PWA, no framework). This file orients you; the authoritative step-by-step runbook is **[`docs/DEPLOY.md`](docs/DEPLOY.md)** — read it before acting.

> **Orientation:** `CLAUDE.md`/`AGENTS.md` orient you; **[`docs/DEPLOY.md`](docs/DEPLOY.md)** is the authoritative install runbook; to *use* the app see **[`docs/USER-GUIDE.md`](docs/USER-GUIDE.md)**.

## When they ask to "install / set up / deploy / run Pipe"

1. **Pick the target and confirm it with them:**
   - **Local** (their Mac/Linux, personal use) → DEPLOY.md **Path A**.
   - **A single server / VPS** (Hetzner, a droplet…) behind a domain → **Path B**.
   - **Multi-tenant, one instance per client** → **Path C** (`deploy/provision.sh`).
2. **Preflight — hard requirements, don't skip:**
   - **Node 20 LTS.** *Not* 25 — it breaks Baileys' crypto and better-sqlite3's ABI. If they're on 25, stop and have them install 20 (`nvm install 20`).
   - `ffmpeg`, `python3`, `make`, `g++` (better-sqlite3 build), `sqlite3`. For a server, also `docker` + `caddy`.
3. **Local is one command:** `bash install.sh` — it runs the preflight, `npm install`, generates `SECRETS_KEY`, writes `data/hub-config.json` + `.env`, runs the tests, and boots. Prefer it over hand-running the steps.
4. **For a server**, follow DEPLOY.md Path B exactly, then walk the **"⚠️ Cambiar antes de producción"** checklist. Don't call it done until that checklist is green and `/api/health` returns `{"ok":true}`.

## Rules you must follow

- **Never invent secrets or infra values.** Anything marked **👤** in DEPLOY.md — identity, `SECRETS_KEY`, access PIN, AI keys, Google OAuth client, domain/DNS, `TRUSTED_HOSTS`, backup remote — is something only the human has. **Stop and ask.** Don't guess, fabricate, or commit them.
- **Secrets stay out of git.** `.env`, `auth/`, `secrets/`, `data/`, `vault/` are gitignored on purpose. Never add them; never print tokens back to the user in full.
- **Privacy invariant.** The sensitive AI jobs (graphify, learn, email/enrich summaries) run **local-only** by default and must stay that way. Set `SENSITIVE_ALLOW_CLOUD=1` only if the user explicitly asks. `test/no-cloud-fetch.mjs` enforces this — if you add cloud egress, route it through `src/lib/llm.mjs` or you'll (correctly) break the build.
- **WhatsApp caveat.** Bridging WhatsApp (mautrix/Unipile) violates WhatsApp's ToS and can get a number banned. Warn the user *before* connecting it; suggest a number they're OK putting at risk.
- **Verify before "done":** `systemctl is-active pipe` (server) and `curl -s localhost:3000/api/health`. Run `npm test` after any code change — keep it green.

## Working on the repo itself (contributions)

See **[`AGENTS.md`](AGENTS.md)** — issue tracker, triage labels, domain docs. Boring, durable stack is a feature: vanilla Node + SQLite, thin facades (`src/lib/brain.mjs`, `src/lib/db.mjs`) over per-domain modules. Keep it that way.
