// BACKFILL de IMÁGENES INLINE de correos ya ingeridos.
//
// Hasta ahora los readers (IMAP/Graph) descartaban los adjuntos "inline" — las imágenes que el HTML referencia como
// src="cid:xxx" (tablas, capturas, firmas). Resultado: al abrir el email se veían RECUADROS VACÍOS. Los readers ya
// las guardan; este script recupera las de los correos VIEJOS: re-baja la imagen del origen, la mete en el CAS y
// completa la columna `attachments` (el trigger de `rev` bumpea solo → las 3 apps se re-sincronizan).
//
// Uso:  node src/mail-inline-backfill.mjs [--limit N] [--dry]
// Es IDEMPOTENTE y RESUMIBLE: cada corrida toma los N más recientes que todavía no tienen inlines. Volvé a correrlo
// hasta que diga "0 pendientes". NO es fire-and-forget: procesa un lote acotado y termina (ver pattern_backfill_safe).
import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { PublicClientApplication } from "@azure/msal-node"
import { emailsMissingInline, setAttachments, getAttachments } from "./lib/db.mjs"
import { casPutBuffer } from "./lib/cas.mjs"
import { decSecret } from "./lib/secrets.mjs"
import { gmailAccessToken } from "./lib/google.mjs"

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const LIMIT = Number(arg("--limit", 50))
const DRY = process.argv.includes("--dry")
const MAX_IMG = 8 * 1024 * 1024

const extOf = (name, mime) => {
  const e = String(name || "").includes(".") ? "." + String(name).split(".").pop().toLowerCase() : ""
  if (e && e.length <= 6) return e
  const m = String(mime || "").split("/").pop()
  return m ? "." + m.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase() : ".bin"
}
// fusiona los inlines nuevos con los adjuntos que el mensaje ya tenía (no perder facturas ya bajadas)
function merge(id, inlines) {
  let prev = []; try { prev = JSON.parse(getAttachments(id) || "[]") || [] } catch {}
  const seen = new Set(prev.map((a) => a.cas))
  return JSON.stringify([...prev, ...inlines.filter((a) => !seen.has(a.cas))])
}

const pend = emailsMissingInline({ limit: LIMIT })
console.log(`[inline] ${pend.length} correos sin sus imágenes inline (lote de ${LIMIT})`)
if (!pend.length) { console.log("[inline] 0 pendientes — nada que hacer"); process.exit(0) }

// Graph usa ids opacos; IMAP usa el Message-ID entre <>. Ese es el discriminador.
const isImap = (id) => id.startsWith("email:<")
const graph = pend.filter((r) => !isImap(r.id))
const imap = pend.filter((r) => isImap(r.id))
let done = 0, imgs = 0

// ── Outlook / Microsoft Graph ──
if (graph.length) {
  try {
    const clientId = process.env.MS_CLIENT_ID || "", tenantId = process.env.MS_TENANT_ID || "", cacheFile = "./auth/teams.cache.json"
    if (!existsSync(cacheFile) || !clientId) throw new Error("sin credenciales de Outlook")
    const pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin: {
      beforeCacheAccess: async (x) => { x.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
      afterCacheAccess: async (x) => { if (x.cacheHasChanged) writeFileSync(cacheFile, x.tokenCache.serialize()) } } } })
    const accts = await pca.getTokenCache().getAllAccounts()
    if (!accts.length) throw new Error("sin cuenta de Outlook en cache")
    const tok = (await pca.acquireTokenSilent({ account: accts[0], scopes: ["User.Read", "Mail.Read"] })).accessToken
    for (const row of graph) {
      const mid = row.id.slice(6)
      try {
        const r = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(mid)}/attachments`, { headers: { Authorization: `Bearer ${tok}` } })
        if (!r.ok) { console.log(`[inline] ✗ ${row.id.slice(0, 28)}… Graph ${r.status}`); continue }
        const d = await r.json()
        const inl = []
        for (const a of (d.value || [])) {
          if (a["@odata.type"] !== "#microsoft.graph.fileAttachment" || !a.isInline || !a.contentBytes) continue
          const buf = Buffer.from(a.contentBytes, "base64")
          if (buf.length > MAX_IMG) continue
          const cas = casPutBuffer(buf, extOf(a.name, a.contentType), "email/attach")
          inl.push({ name: a.name || "imagen", cas, mime: a.contentType || "", size: buf.length, inline: true, cid: String(a.contentId || "").replace(/^<|>$/g, "") })
        }
        if (inl.length && !DRY) setAttachments(row.id, merge(row.id, inl))
        if (inl.length) { done++; imgs += inl.length; console.log(`[inline] ✓ ${inl.length} img · ${String(row.text || "").slice(0, 50)}`) }
      } catch (e) { console.log("[inline] ✗ graph:", e.message) }
    }
  } catch (e) { console.log("[inline] outlook no disponible:", e.message) }
}

// ── Gmail / IMAP: se busca el correo por su Message-ID en "All Mail" ──
if (imap.length) {
  const accs = existsSync("./auth/imap-accounts.json") ? JSON.parse(readFileSync("./auth/imap-accounts.json", "utf8")) : []
  const pending = new Map(imap.map((r) => [r.id.slice(6), r])) // "<msgid>" → fila
  for (const acc of accs) {
    if (!pending.size) break
    let c
    try {
      const auth = acc.oauth === "google" ? { user: acc.user, accessToken: await gmailAccessToken(decSecret(acc.refreshToken)) } : { user: acc.user, pass: decSecret(acc.pass) }
      c = new ImapFlow({ host: acc.host, port: 993, secure: true, auth, logger: false }); await c.connect()
    } catch (e) { console.log("[inline] no conecta", acc.user, e.message); continue }
    let box = null; for await (const b of await c.list()) if ((b.specialUse || "") === "\\All") box = b.path
    try { await c.mailboxOpen(box || "[Gmail]/All Mail", { readOnly: true }) } catch { await c.logout().catch(() => {}); continue }
    for (const [msgid, row] of [...pending]) {
      try {
        const uids = (await c.search({ header: { "message-id": msgid } }, { uid: true })) || []
        if (!uids.length) continue
        const m = await c.fetchOne(uids[uids.length - 1], { source: true }, { uid: true })
        const p = await simpleParser(m.source)
        const inl = []
        for (const a of (p.attachments || [])) {
          if (!a.related || !a.content || !a.content.length || a.content.length > MAX_IMG) continue
          const cas = casPutBuffer(a.content, extOf(a.filename, a.contentType), "email/attach")
          inl.push({ name: a.filename || "imagen", cas, mime: a.contentType || "", size: a.content.length, inline: true, cid: String(a.cid || a.contentId || "").replace(/^<|>$/g, "") })
        }
        pending.delete(msgid)
        if (inl.length && !DRY) setAttachments(row.id, merge(row.id, inl))
        if (inl.length) { done++; imgs += inl.length; console.log(`[inline] ✓ ${inl.length} img · ${String(row.text || "").slice(0, 50)}`) }
      } catch (e) { console.log("[inline] ✗ imap:", e.message) }
    }
    await c.logout().catch(() => {})
  }
}

console.log(`[inline] LISTO${DRY ? " (dry-run)" : ""}: ${done}/${pend.length} correos completados · ${imgs} imágenes al CAS`)
console.log("[inline] volvé a correrlo para el siguiente lote (termina cuando diga '0 pendientes')")
process.exit(0)
