# Security Policy

Pipe reads your private communication. We take that seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Email **security@pipe.one** with:
- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- affected version / commit.

We'll acknowledge within a few days and keep you posted on the fix. Responsible disclosure is appreciated; we're happy to credit you.

## Security & privacy model

- **Single-tenant, self-hostable.** Each instance runs isolated. Your data lives on your infrastructure.
- **Secrets encrypted at rest.** Channel passwords and API tokens are encrypted with `SECRETS_KEY` (AES-256-GCM). Keep that key safe and out of version control.
- **Fail-closed for private data.** Privacy-sensitive pipelines (the knowledge graph, the self-model learner, email/note summaries) default to local-only inference — your content is not sent to a third-party model unless you explicitly configure it.
- **Access control.** When exposed behind a reverse proxy, the app requires a PIN; sessions are HttpOnly cookies (never the PIN itself).
- **Never commit secrets.** `.env`, `auth/`, `data/`, `vault/`, `secrets/` and session files are gitignored. Package releases with `git archive` so a local `.env` never ships.

## Third-party connections

You connect your own accounts (WhatsApp, Gmail, etc.). Some connections use unofficial methods and are used at your own risk; comply with each platform's terms. Pipe is not affiliated with those platforms.

## Supported versions

This is early-stage software. Security fixes land on `main`; run a recent checkout.
