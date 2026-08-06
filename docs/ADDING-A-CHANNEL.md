# Adding a channel

Pipe ingests many sources (WhatsApp, email, Telegram, Slack, Signal, Instagram/Facebook/LinkedIn via the Matrix bridge, …). Every channel is declared in **one place** — the channel registry — so adding one doesn't mean touching the whole codebase.

## The registry — `src/lib/channels.mjs`

`CHANNELS` is the single source of truth for *what channels exist and how they connect / send / render*. Each entry:

| field | meaning |
|---|---|
| `id` | internal key — also the value stored in `messages.channel` and the bridge `net`. |
| `label` | display name. |
| `brand` | brand color (`#hex`) used by the clients' icons. |
| `kind` | `messaging` \| `email` \| `calendar` \| `files` \| `notes` — gates capabilities (voice/media/stickers are messaging-only). |
| `reader` | the reader **process** that ingests it (see `daemon.READERS`). Several channels can share one reader — the Matrix bridge reader ingests whatsapp/instagram/facebook/linkedin/discord with a single process. |
| `connect` | how the UI links it (see below). |
| `send` | `"simple"` for direct `(target, text)` messaging; omit for channels with special send logic (email, and the Matrix-bridge rooms). |
| `gate` | env var(s) that enable the reader (informational). |

### `connect` methods

- `{ method: "matrix-bridge", net, multi }` — QR/code via the mautrix bot → `POST /api/matrix-link?net=<net>`. `multi:true` = several accounts per network.
- `{ method: "matrix-token", net }` — token login (Discord) → `POST /api/matrix-link-token?net=<net>`.
- `{ method: "telegram-login" }` — phone → code → 2FA → `POST /api/telegram/{start,code,password}`.
- `{ method: "integration", provider, fields }` — encrypted token/URL → `POST /api/integrations/<provider>`.
- `{ method: "email-account" }` — IMAP / Gmail OAuth / Microsoft Graph → `POST /api/accounts/email`.
- `{ method: "server" }` — configured on the server (guide), no in-app flow.

The server validates `/api/matrix-link` and `/api/matrix-link-token` against `bridgeNets()` / `tokenNets()`, and clients read the catalog from **`GET /api/channels/catalog`** — all derived from the registry, so a new channel appears everywhere automatically.

## Recipe A — a bridge channel (WhatsApp/IG/FB/LinkedIn family)

If your channel rides the Matrix bridge, it's **one registry entry** — no other code:

```js
mychannel: { id: "mychannel", label: "MyChannel", brand: "#ff0066", kind: "messaging",
             reader: "matrix", connect: { method: "matrix-bridge", net: "mychannel", multi: true } },
```

The Matrix reader already ingests it and messages send through the existing room path. (The bridge itself must support that network on your server.)

## Recipe B — a direct messaging channel (Slack/Signal/Telegram family)

Three small steps:

1. **Registry entry** with `send: "simple"` and its `connect`:
   ```js
   mychat: { id: "mychat", label: "MyChat", brand: "#0088cc", kind: "messaging",
             reader: "mychat", connect: { method: "integration", provider: "mychat", fields: ["token"] },
             gate: ["MYCHAT_TOKEN"], send: "simple" },
   ```
2. **A sender** in `src/lib/brain/reply.mjs` — a `async function mychatSend(target, text)` returning `{ ok }` or `{ error }`, added to the `SIMPLE_SENDERS` map. `sendReply` dispatches to it generically; you don't add an `if`.
3. **A reader** `src/mychat.mjs` that ingests messages into `messages.jsonl` (mirror an existing one, e.g. `src/slack.mjs`), and add it to `READERS` in `src/daemon.mjs`.

## Tests

`test/channels.mjs` validates the registry shape and the `bridgeNets` / `tokenNets` / `isSimpleSender` invariants — add your channel there if it changes those sets. `npm test` must stay green.

## Checklist

- [ ] Registry entry in `src/lib/channels.mjs`
- [ ] (direct-send only) sender fn + `SIMPLE_SENDERS` entry in `reply.mjs`
- [ ] (own reader only) `src/<channel>.mjs` + line in `daemon.READERS`
- [ ] `npm test` green
- [ ] The channel shows up in `GET /api/channels/catalog`
