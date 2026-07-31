// Slack reader — trae tus DMs y canales a la bandeja unificada. Polling de la Web API. Gated por SLACK_TOKEN (xoxp/xoxb).
// Config: SLACK_TOKEN (crear una app en api.slack.com → OAuth scopes: channels:history, groups:history, im:history, mpim:history,
//         channels:read, users:read, y chat:write para responder). Sin token → reader inactivo. Uso: node src/slack.mjs
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { appendMessage } from "./lib/lock.mjs"
import { getSlackToken } from "./lib/integrations.mjs"

const TOKEN = process.env.SLACK_TOKEN || getSlackToken() // .env o lo conectado desde la Consola (cifrado)
if (!TOKEN) console.log("[slack] sin SLACK_TOKEN — reader inactivo (dormido)")
const POLL = +process.env.SLACK_POLL_MS || 30000
mkdirSync("./auth", { recursive: true })
const STATE = "./auth/slack-since.json"
let since = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {} // { channelId: lastTs }
const users = new Map()

async function api(method, params = {}) {
  const url = `https://slack.com/api/${method}?` + new URLSearchParams(params)
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } }).then((x) => x.json()).catch(() => ({ ok: false }))
  if (!r.ok && r.error && r.error !== "not_in_channel") console.error(`[slack] ${method}: ${r.error}`)
  return r
}
async function userName(id) {
  if (!id) return "Slack"
  if (users.has(id)) return users.get(id)
  const r = await api("users.info", { user: id })
  const n = r.user?.profile?.real_name || r.user?.name || id
  users.set(id, n); return n
}
async function selfId() { const r = await api("auth.test"); return r.user_id || null }

async function tick(me) {
  const conv = await api("conversations.list", { types: "im,mpim,public_channel,private_channel", limit: 200, exclude_archived: true })
  for (const c of (conv.channels || [])) {
    if (c.is_channel && !c.is_member) continue // solo canales donde estás
    const oldest = since[c.id] || String(Math.floor(Date.now() / 1000) - 3600) // 1ra vez: última hora
    const h = await api("conversations.history", { channel: c.id, oldest, limit: 50 })
    const msgs = (h.messages || []).filter((m) => m.type === "message" && m.text && !m.subtype).sort((a, b) => (+a.ts) - (+b.ts))
    let maxTs = +oldest
    for (const m of msgs) {
      maxTs = Math.max(maxTs, +m.ts)
      const dir = m.user === me ? "out" : "in"
      const name = c.is_im ? await userName(m.user) : (c.name ? "#" + c.name : await userName(m.user))
      const jid = c.is_im ? `slack:${c.user || c.id}` : `slack:${c.id}`
      try { appendMessage({ id: `slack-${c.id}-${m.ts}`, channel: "slack", account: "slack", jid, name, text: String(m.text).slice(0, 4000), ts: Math.round((+m.ts) * 1000), dir, grp: c.is_im ? null : (c.name || c.id) }) } catch {}
    }
    if (msgs.length) since[c.id] = String(maxTs + 0.000001)
  }
  writeFileSync(STATE, JSON.stringify(since))
}

if (TOKEN) {
  const me = await selfId()
  console.log(`[slack] escuchando (self=${me}) cada ${POLL / 1000}s`)
  await tick(me)
  setInterval(() => tick(me).catch((e) => console.error("[slack]", e.message)), POLL)
} else { setInterval(() => {}, 2 ** 31 - 1) }
