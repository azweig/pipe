# Privacy model

Pipe reads your private communication. The whole design assumes that content is
yours and must not leak to a third party by default. This document describes the
privacy guarantees the code actually enforces, and where to find them.

## 1. Self-hosted, single-tenant

Each instance runs isolated on your own infrastructure. There is no shared backend
and no telemetry. Your messages, contacts and derived data live in `data/` on the
machine you run Pipe on.

## 2. Sensitive AI jobs run local-only by default

The privacy-sensitive pipelines never send your content to a cloud model unless you
explicitly opt in. These features are enumerated in `src/lib/llm.mjs`
(`SENSITIVE_FEATURES`):

- the knowledge graph (`graphify`),
- the self-model learner (`learn`),
- conversation enrichment (`enrich`),
- task / promise extraction (`extract`),
- email summaries (`email`),
- meeting summaries (`meetings`),
- the reply autopilot (`autopilot`).

**Routing is fail-closed.** `smartChain({ sensitive, feature })` sends sensitive
work to local inference (Ollama) first, and — deliberately — keeps it local even
when the task is "complex" or involves vision. If the local model can't do it, the
task fails rather than degrading to the cloud. Absence of configuration always means
*local*; there is no fail-open path.

You opt in per feature from the app UI (`sensitivePolicy`), or globally for headless
runs with the environment switch `SENSITIVE_ALLOW_CLOUD=1`. Both are conscious,
explicit decisions.

### Enforced by a test, not just a convention

`test/no-cloud-fetch.mjs` is a structural invariant that runs in the normal test
suite. It enforces two layers of defense:

- **(A) Denylist** — known cloud-LLM hostnames (OpenAI / Google Generative / Anthropic)
  may appear **only** in `src/lib/llm.mjs` and `src/lib/voice.mjs`, the single
  authorized egress layer where the hard cap, the usage meter and the fail-closed
  logic live.
- **(B) Allowlist** — *any* new file that does `fetch("https://…")` must be added to
  an explicit egress allowlist. A brand-new provider added outside `llm.mjs` breaks
  the build even if its hostname is unknown to any regex.

If you add cloud egress, route it through `src/lib/llm.mjs` or you will (correctly)
break CI.

## 3. Secrets stay out of the repo and encrypted at rest

- `.env`, `auth/`, `data/`, `vault/`, `secrets/`, `*.db`, `*.session` and session
  files are gitignored (see `.gitignore`). Package releases with `git archive` so a
  local `.env` never ships.
- Channel passwords and AI tokens are encrypted at rest with AES-256-GCM
  (`src/lib/secrets.mjs`). The master key comes from `SECRETS_KEY` (recommended in
  production) or `data/.secret-key`. `decSecret` transparently returns plaintext for
  legacy unencrypted values, so nothing breaks on upgrade — but new secrets are
  always written encrypted.
- Bring-your-own-key: each hub chooses its providers and pastes its own tokens. You
  decide *where* your data goes.

## 4. Secret accounts (second PIN)

There is one PIN to enter the app (`src/lib/auth.mjs`) and an optional second PIN for
"secret accounts" (`src/lib/secret.mjs`). An account marked secret — a WhatsApp
number, an email, … — and all of its messages do not exist anywhere in the app
(inbox, config, push, search, AI, counters, autopilot) until the second PIN is
verified. Verification issues a short, sliding, per-device secret-session token
(~5 min); the client wipes it on blur / backgrounding / refresh and persists nothing
locally. Enforcement lives on the server, not only in the UI.

## 5. Access control

When exposed behind a reverse proxy, the app requires a PIN (scrypt-hashed); sessions
are HttpOnly cookie tokens, never the PIN itself. A local SSH tunnel (no
`X-Forwarded-For`) is treated as trusted; remote traffic through the proxy always
requires the PIN.

## 6. Third-party connections and the WhatsApp caveat

You connect your own accounts. Some connectors use unofficial methods and are used at
your own risk — comply with each platform's terms. In particular, **bridging WhatsApp
(via the Matrix/mautrix bridge or Unipile) can violate WhatsApp's Terms of Service and
may get a number banned.** Connect a number you are comfortable putting at risk. Pipe
is not affiliated with any of these platforms.

## Reporting

For anything security- or privacy-sensitive, see [SECURITY.md](SECURITY.md). Please
don't open a public issue for vulnerabilities.
