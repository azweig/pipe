// Outlook / Microsoft 365 mail reader (Microsoft Graph, delegated) — LECTURA (y preparado para enviar/borradores).
// Reusa el MISMO login que Teams (auth/teams.cache.json, misma cuenta). Solo agrega scopes de Mail.
// Necesita en Azure (misma app): Mail.Read, Mail.Send, Mail.ReadWrite (delegated) + admin consent.
import { PublicClientApplication } from "@azure/msal-node"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { appendMessage, withLock } from "./lib/lock.mjs"
import { casPutBuffer } from "./lib/cas.mjs"
const _MIMEXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "text/csv": "csv", "application/zip": "zip", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/msword": "doc", "application/vnd.ms-excel": "xls" }
const attExt = (name, mime) => { const m = String(name || "").match(/\.([a-z0-9]{1,6})$/i); return m ? m[1].toLowerCase() : (_MIMEXT[String(mime || "").toLowerCase()] || "bin") }

mkdirSync("./data", { recursive: true })
mkdirSync("./auth", { recursive: true })

const clientId = process.env.MS_CLIENT_ID || ""
const tenantId = process.env.MS_TENANT_ID || ""
const cacheFile = "./auth/teams.cache.json" // MISMO cache que Teams (misma cuenta MS)
const stateFile = "./auth/mail-outlook.state.json"
const SCOPES = ["User.Read", "Mail.Read", "Mail.Send", "Mail.ReadWrite"]
const POLL_MS = 30000

const cachePlugin = {
  beforeCacheAccess: async (ctx) => { if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
  afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) withLock(cacheFile, () => writeFileSync(cacheFile, ctx.tokenCache.serialize())) }, // lock: cache MSAL compartido
}
const pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin } })

async function getToken() {
  const accounts = await pca.getTokenCache().getAllAccounts()
  if (accounts.length) {
    try { const r = await pca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES }); if (r?.accessToken) return r.accessToken } catch {}
  }
  const r = await pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (info) => console.log(`\n🔑 [outlook] ABRÍ ${info.verificationUri} Y PEGÁ EL CÓDIGO: ${info.userCode}\n`),
  })
  return r.accessToken
}

async function graph(token, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

let seen = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { ts: 0, tsSent: 0, ids: [] }
const seenIds = new Set(seen.ids || []) // dedup REAL por id de Graph (no por timestamp → no pierde emails del mismo segundo)
const saveSeen = () => { seen.ids = [...seenIds].slice(-400); writeFileSync(stateFile, JSON.stringify(seen)) }

async function poll(token) {
  // Inbox, más recientes primero
  const data = await graph(token, "/me/mailFolders/inbox/messages?$top=60&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,body,hasAttachments")
  const msgs = (data.value || []).reverse() // procesar viejo→nuevo
  for (const m of msgs) {
    const ts = Date.parse(m.receivedDateTime || "") || 0
    if (ts < seen.ts - 5000) continue // claramente viejo (margen 5s por relojes); el resto se dedupe por id
    if (seenIds.has(m.id)) continue
    seenIds.add(m.id); seen.ts = Math.max(seen.ts, ts)
    const name = m.from?.emailAddress?.name || m.from?.emailAddress?.address || "?"
    const addr = m.from?.emailAddress?.address || ""
    const text = `${m.subject || "(sin asunto)"} — ${(m.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 200)}`
    const rec = { id: `email:${m.id}`, channel: "email", account: "outlook", jid: addr, name, text, ts, unread: !m.isRead, dir: "in", body: m.body?.content || null } // cuerpo completo (HTML)
    if (m.hasAttachments) { // bajar adjuntos REALES al CAS (facturas/contratos/diligencias) — antes se perdían
      try {
        const at = await graph(token, `/me/messages/${m.id}/attachments`)
        const atts = []
        for (const a of (at.value || [])) {
          if (a["@odata.type"] !== "#microsoft.graph.fileAttachment" || !a.contentBytes) continue // no-archivo → saltar
          const buf = Buffer.from(a.contentBytes, "base64")
          if (buf.length > 25 * 1024 * 1024) continue // cap 25MB
          // las INLINE (isInline, referenciadas por cid: en el HTML) también se guardan: son las imágenes del cuerpo.
          // Antes se descartaban y el visor mostraba recuadros vacíos. Marcadas inline:true + cid → el server las mete como data:.
          try {
            const cas = casPutBuffer(buf, attExt(a.name, a.contentType), "email/attach")
            const rec2 = { name: a.name || (a.isInline ? "imagen" : "adjunto"), cas, mime: a.contentType || "", size: buf.length }
            if (a.isInline) { rec2.inline = true; rec2.cid = String(a.contentId || "").replace(/^<|>$/g, "") }
            atts.push(rec2)
          } catch {}
        }
        if (atts.length) { rec.attachments = JSON.stringify(atts); console.log(`   📎 ${atts.length} adjunto(s)`) }
      } catch (e) { console.log("[outlook] adjuntos no bajaron:", e.message) }
    }
    appendMessage(rec)
    console.log(`📧 [outlook] ${name}: ${m.subject || "(sin asunto)"}`)
  }
  // ENVIADOS — para saber qué YA respondiste (dir: out, jid = destinatario)
  // Se pide `body`, no solo `bodyPreview`: de lo que vos escribís quedaba el asunto y 160 caracteres, así que
  // "¿qué le respondí?" o "¿lo último es mío o de ellos?" no tenían con qué contestarse. Mismo criterio que el inbox.
  const sent = await graph(token, "/me/mailFolders/sentitems/messages?$top=60&$orderby=sentDateTime desc&$select=id,subject,toRecipients,sentDateTime,bodyPreview,body")
  for (const m of (sent.value || []).reverse()) {
    const ts = Date.parse(m.sentDateTime || "") || 0
    if (ts < (seen.tsSent || 0) - 5000) continue
    if (seenIds.has(m.id)) continue
    seenIds.add(m.id); seen.tsSent = Math.max(seen.tsSent || 0, ts)
    const to = m.toRecipients?.[0]?.emailAddress || {}
    const rec = { id: `email:${m.id}`, channel: "email", account: "outlook", jid: to.address || "", name: to.name || to.address || "?", text: `${m.subject || "(sin asunto)"} — ${(m.bodyPreview || "").replace(/\s+/g, " ").trim().slice(0, 160)}`, ts, dir: "out", body: m.body?.content || null }
    appendMessage(rec)
    console.log(`➡️  [outlook→] ${to.name || to.address}: ${m.subject || "(sin asunto)"}`)
  }
  saveSeen()
  try { writeFileSync("/tmp/hb_email", String(Date.now())) } catch {} // heartbeat: poll a Graph OK = correo Outlook conectado
}

console.log("[outlook] autenticando...")
const token = await getToken()
const me = await graph(token, "/me")
console.log(`\n✅ [outlook] CONECTADO como ${me.displayName} (${me.mail || me.userPrincipalName}) — leyendo inbox cada ${POLL_MS / 1000}s...\n`)
await poll(token)
setInterval(async () => { try { const t = await getToken(); await poll(t) } catch (e) { console.log("[outlook] err:", e.message) } }, POLL_MS)
