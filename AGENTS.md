# Pipe — agent guide

> **Orientation:** `CLAUDE.md`/`AGENTS.md` orient you; **[`docs/DEPLOY.md`](docs/DEPLOY.md)** is the authoritative install runbook; to *use* the app see **[`docs/USER-GUIDE.md`](docs/USER-GUIDE.md)**.

Pipe is a self-hostable unified inbox + AI second brain (Node 20 + SQLite + a vanilla-JS PWA, no framework).

## If you're here to install / set up / deploy / run Pipe

Read **[`docs/DEPLOY.md`](docs/DEPLOY.md)** before acting — it's an executable runbook. In short:

1. **Pick the target and confirm it with the user:**
   - **Local** (their Mac/Linux, personal use) → DEPLOY.md **Path A**. One command: `bash install.sh`.
   - **A single server / VPS** behind a domain → **Path B**.
   - **Multi-tenant, one instance per client** → **Path C** (`deploy/provision.sh`, see `deploy/PROVISIONING.md`).
2. **Preflight (don't skip):** **Node 20 LTS** — *not* 25 (breaks Baileys' crypto and better-sqlite3's ABI). Plus `ffmpeg`, `python3`, `make`, `g++`, `sqlite3`; for a server also `docker` + `caddy`.
3. **👤 = stop and ask.** Anything marked 👤 in DEPLOY.md — identity, `SECRETS_KEY`, access PIN, AI keys, Google OAuth client, domain/DNS, `TRUSTED_HOSTS`, backup remote — is something only the human has. Never invent, guess, or commit secrets.
4. **Not done until** the "⚠️ Cambiar antes de producción" checklist is green and `/api/health` returns `{"ok":true}`. See `CLAUDE.md` for the full set of rules (privacy invariant, WhatsApp ToS caveat, verify-before-done).

## If you're here to work on the repo itself (contributions)

### Issue tracker
Issues and PRDs are tracked as GitHub issues in `azweig/pipe` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels
The five canonical triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) map 1:1 to the labels used in this repo. See `docs/agents/triage-labels.md`.

### Domain docs
Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.

### Stack
Boring, durable stack is a feature: vanilla Node + SQLite, thin facades (`src/lib/brain.mjs`, `src/lib/db.mjs`) over per-domain modules. Keep it that way. Run `npm test` after any change — keep it green.
</content>
