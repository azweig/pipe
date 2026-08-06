# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates and version tags reflect the public git history only; commit subjects are
referenced generically rather than by hash.

## [Unreleased]

### Added
- **Secret accounts (2nd PIN).** A source (a WhatsApp number, an email account, …)
  can be hidden behind an optional second PIN. Marked accounts and *all* their
  messages are absent from the inbox, config, push, search, AI, counters and the
  autopilot until a short, per-device secret session is verified. Enforcement is
  server-side, not just UI. See `src/lib/secret.mjs`.
- **Channel connectors.** First-party readers/senders for WhatsApp (Matrix bridge
  and Unipile), Instagram / Messenger / Discord (via Unipile), Telegram, Slack and
  Signal, connectable from the console UI. Integration credentials are encrypted at
  rest.
- **AI reply autopilot.** Optional drafting engine that learns from your own past
  replies and a global feedback bank, with a policy guard, anti-loop protection and
  a "train your AI" correction deck. Autopilot is a privacy-sensitive feature and
  runs local-only by default.
- **Covert mode.** Per-contact linguistic steganography (poem / story / recipe /
  prayer) layered over real AES-GCM encryption, with auto-decryption of the thread.
  See `src/lib/covertext.mjs` and `docs/COVERT.md`.
- **Voice profile auto-detection.** The user's voice profile (languages, dialect
  mix, tone) is inferred from their own messages, in any language, and surfaced in
  settings.

### Changed
- **Security hardening across the stack** — auth, CSP, autopilot, SSRF protection,
  the MCP connector and inbound webhooks.
- Spam handling narrowed so legitimate mail is no longer hidden; the owner's own
  connected accounts are whitelisted.
- Example addresses in comments genericized so no real domain ships in the tree.

## [0.1.0] - 2026-07-24

### Added
- Initial public release — Pipe: a self-hostable unified inbox (WhatsApp, email,
  Telegram, Teams, …) plus an AI second brain that reads, summarizes and drafts in
  your voice. Node 20 + SQLite + a vanilla-JS PWA, no framework, no build step.

[Unreleased]: https://github.com/azweig/pipe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/azweig/pipe/releases/tag/v0.1.0
