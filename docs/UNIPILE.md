# Unipile channel (WhatsApp / LinkedIn via a managed API)

[Unipile](https://www.unipile.com/) is a hosted messaging API. Pipe can use it as an **alternative
path** to the self-hosted [mautrix](https://docs.mau.fi/) bridges for WhatsApp and LinkedIn — useful
when you'd rather not run (or can't keep online) a bridge for a given number.

It's a **hybrid**: you can route *some* WhatsApp numbers through Unipile and leave the rest on the
mautrix bridge. Pipe ingests both into the same unified inbox (`data/messages.jsonl` → SQLite), so a
conversation looks identical no matter which transport carried it.

## How it works in Pipe

| Direction | File | Notes |
|---|---|---|
| **Receive** | `src/unipile.mjs` | Polls Unipile for new messages and appends them to the inbox in the unified format. Runs as a daemon reader when configured; inert otherwise. |
| **Send** | `src/lib/unipile-api.mjs` | `sendReply` uses this automatically when the recipient's number is Unipile-managed (its mautrix bridge is intentionally logged out so messages don't arrive twice). |

`unipileConfigured()` gates everything: with no `UNIPILE_API_KEY` + `UNIPILE_DSN`, the reader stays
asleep and sends fall back to the bridge.

## Setup

1. Create a Unipile account and, in their dashboard, **connect a WhatsApp (or LinkedIn) account** —
   Unipile hosts that session for you.
2. Copy your **API key** and **DSN** (the regional endpoint, e.g. `https://api46.unipile.com:17613`).
3. Put them in `.env`:

   ```bash
   UNIPILE_API_KEY=xxxxxxxx
   UNIPILE_DSN=https://api46.unipile.com:17613
   # only the numbers you want Unipile to own (comma-separated); everything else stays on the bridge
   UNIPILE_NUMBERS=15551234567
   # optional: how often the reader polls (default 15000ms)
   UNIPILE_POLL_MS=15000
   ```

4. If that number was previously connected through the mautrix WhatsApp bridge, **log the bridge out
   for it** so you don't ingest each message twice.
5. Restart the daemon (`npm start` / `docker compose up -d`). The Unipile reader starts on the next cycle.

## Notes

- **Polling, not webhooks.** The reader polls on `UNIPILE_POLL_MS`; inbound webhooks are a future
  improvement.
- **Privacy trade-off.** Unlike the self-hosted bridge, messages transit Unipile's servers. If keeping
  everything on your own box matters more than convenience, prefer the mautrix bridge
  (see [deploy/PROVISIONING.md](../deploy/PROVISIONING.md)).
- Secrets pasted in the UI are encrypted at rest (`src/lib/secrets.mjs`); `.env` is never committed.
