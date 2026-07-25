# pipe

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues in `azweig/pipe` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) map 1:1 to the labels used in this repo. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.

### Deploy / go-live

To mount this in production (single hub or multi-tenant) follow **`docs/DEPLOY.md`** — an executable runbook with minimum requirements (local vs server), the step-by-step, and a **"⚠️ Cambiar antes de producción"** checklist. Items marked 👤 are values only the human can provide — stop and ask for them, don't guess.
