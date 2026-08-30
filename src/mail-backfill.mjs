// Backfill de correos ARCHIVADOS (fuera del INBOX que ingerimos por defecto). Dado un término (nombre/dominio/palabra),
// busca en Gmail "All Mail" (IMAP) + Outlook (Graph $search), y appendea a messages.jsonl → la ingesta normal los threadea.
// Acotado por BACKFILL_LIMIT. Idempotente: el id = email:<Message-ID> → INSERT OR IGNORE no duplica.
import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { appendMessage } from "./lib/lock.mjs"
import { decSecret } from "./lib/secrets.mjs"
import { gmailAccessToken } from "./lib/google.mjs"
import { setMeta } from "./lib/db.mjs"
import { myEmails } from "./lib/hub.mjs"
import { PublicClientApplication } from "@azure/msal-node"

const QUERY = (process.env.BACKFILL_QUERY || process.argv[2] || "").trim()
const LIMIT = Number(process.env.BACKFILL_LIMIT || 400)
if (!QUERY) { console.log("[backfill] sin query"); process.exit(0) }
const mine = new Set((myEmails() || []).map((e) => e.toLowerCase()))
const isMine = (a) => a && mine.has(String(a).toLowerCase())
let total = 0
const setStatus = (o) => { try { setMeta("backfill_status", JSON.stringify({ q: QUERY, ...o, at: Date.now() })) } catch {} }
setStatus({ state: "running", found: 0 })

async function parseBody(source) { if (!source) return { preview: "", body: null }; try { const p = await simpleParser(source); return { preview: (p.text || "").replace(/\s+/g, " ").trim().slice(0, 200), body: p.html || p.textAsHtml || (p.text ? `<pre>${p.text}</pre>` : null) } } catch { return { preview: "", body: null } } }
function rec(label, party, subject, preview, ts, dir, body, msgId) {
  appendMessage({ ...(msgId ? { id: `email:${msgId}` } : {}), channel: "email", account: label, jid: party.address || "", name: party.name || party.address || "?", text: `${subject} — ${preview}`.slice(0, 260), ts, unread: 0, dir, body })
  total++
}

// ── Gmail IMAP (All Mail) ──
try {
  const accs = existsSync("./auth/imap-accounts.json") ? JSON.parse(readFileSync("./auth/imap-accounts.json", "utf8")) : []
  for (const acc of accs) {
    if (!/gmail|googlemail/.test(acc.host || "")) continue
    let c
    try {
      const auth = acc.oauth === "google" ? { user: acc.user, accessToken: await gmailAccessToken(decSecret(acc.refreshToken)) } : { user: acc.user, pass: decSecret(acc.pass) }
      c = new ImapFlow({ host: acc.host, port: 993, secure: true, auth, logger: false }); await c.connect()
    } catch (e) { console.log("[backfill] no conecta", acc.user, e.message); continue }
    let box = null; for await (const b of await c.list()) if ((b.specialUse || "") === "\\All") box = b.path
    try { await c.mailboxOpen(box || "[Gmail]/All Mail", { readOnly: true }) } catch (e) { await c.logout().catch(() => {}); continue }
    let uids = []
    try {
      uids = QUERY === "*"
        ? (await c.search({ all: true }, { uid: true })) || []
        : (await c.search({ or: [{ from: QUERY }, { to: QUERY }, { subject: QUERY }, { body: QUERY }] }, { uid: true })) || []
    } catch {}
    uids = uids.slice(-LIMIT)
    console.log(`[backfill] ${acc.label || acc.user}: ${uids.length} archivados`)
    for (const uid of uids) {
      try {
        const m = await c.fetchOne(uid, { envelope: true, source: true, internalDate: true }, { uid: true })
        const { preview, body } = await parseBody(m.source)
        const from = (m.envelope.from || [])[0] || {}, to = (m.envelope.to || [])[0] || {}
        const dir = isMine(from.address) ? "out" : "in", party = dir === "out" ? to : from
        const ts = (m.internalDate || m.envelope.date || new Date()).getTime()
        rec(acc.label || acc.user, { address: party.address, name: party.name }, m.envelope.subject || "(sin asunto)", preview, ts, dir, body, m.envelope.messageId || "")
      } catch {}
    }
    await c.logout().catch(() => {})
    setStatus({ state: "running", found: total })
  }
} catch (e) { console.log("[backfill] gmail err", e.message) }

// ── Outlook / Microsoft Graph ──
try {
  const clientId = process.env.MS_CLIENT_ID || "", tenantId = process.env.MS_TENANT_ID || "", cacheFile = "./auth/teams.cache.json"
  if (existsSync(cacheFile) && clientId) {
    const pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin: {
      beforeCacheAccess: async (x) => { x.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
      afterCacheAccess: async (x) => { if (x.cacheHasChanged) writeFileSync(cacheFile, x.tokenCache.serialize()) } } } })
    const accts = await pca.getTokenCache().getAllAccounts()
    if (accts.length) {
      const tok = (await pca.acquireTokenSilent({ account: accts[0], scopes: ["User.Read", "Mail.Read"] })).accessToken
      const g = async (p) => { const r = await fetch(`https://graph.microsoft.com/v1.0${p}`, { headers: { Authorization: `Bearer ${tok}`, ConsistencyLevel: "eventual" } }); if (!r.ok) throw new Error("Graph " + r.status); return r.json() }
      const me = await g("/me?$select=mail"), label = me.mail || "outlook"
      // Graph corta en 50 por página. Sin seguir @odata.nextLink el backfill traía 50 correos y decía "listo":
      // con miles en el buzón eso es no traer nada. Se pagina hasta LIMIT.
      // QUERY="*" = traer el buzón ENTERO (inbox + enviados + carpetas), paginando. Con $search sobre tu propia
      // dirección Graph devolvía apenas unos cientos: busca en el CONTENIDO indexado, y tu dirección casi nunca
      // aparece en el cuerpo. Para "todo mi correo de este buzón" hay que enumerar, no buscar.
      const TODO = QUERY === "*"
      let url = TODO
        ? "/me/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,body,bodyPreview"
        : `/me/messages?$search=${encodeURIComponent('"' + QUERY + '"')}&$top=50&$select=id,subject,from,toRecipients,receivedDateTime,sentDateTime,body,bodyPreview`
      let traidos = 0
      while (url && traidos < LIMIT) {
        const d = await g(url)
        const pagina = d.value || []
        for (const m of pagina) {
          if (traidos >= LIMIT) break
          const from = m.from?.emailAddress || {}, to = (m.toRecipients || [])[0]?.emailAddress || {}
          const dir = isMine(from.address) ? "out" : "in", party = dir === "out" ? to : from
          rec(label, { address: party.address, name: party.name }, m.subject || "(sin asunto)", (m.bodyPreview || "").replace(/\s+/g, " ").slice(0, 200), new Date(m.receivedDateTime || m.sentDateTime || Date.now()).getTime(), dir, m.body?.content || null, m.id)
          traidos++
        }
        const next = d["@odata.nextLink"]
        url = next && pagina.length ? next.replace("https://graph.microsoft.com/v1.0", "") : null
        if (url) { setStatus({ state: "running", found: total }); await new Promise((r) => setTimeout(r, 300)) } // Graph tira 429 si lo apurás
      }
      console.log(`[backfill] ${label}: ${traidos} en Graph`)
    }
  }
} catch (e) { console.log("[backfill] outlook err", e.message) }

setStatus({ state: "done", found: total })
console.log(`[backfill] LISTO: ${total} correos traídos para "${QUERY}"`)
process.exit(0)
