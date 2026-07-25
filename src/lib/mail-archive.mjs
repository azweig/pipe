// Archiva/DES-archiva en el SERVIDOR de correo real los emails RECIBIDOS de un hilo. Se llama fire-and-forget desde
// /api/contact/archive → la app y tu buzón quedan en sync. NUNCA borra: archivar = sacar del INBOX (recuperable).
//  · IMAP (Gmail/genérico): busca por Message-ID en INBOX y mueve a la carpeta de archivo (Gmail: "All Mail" \All; genérico: \Archive).
//    Al restaurar en Gmail COPIA a INBOX (mover borraría de All Mail = Trash); en genérico mueve de vuelta.
//  · Outlook (Graph): mueve el mensaje a la carpeta 'archive' (o 'inbox' al restaurar). Requiere Mail.ReadWrite (ya lo tiene).
import { ImapFlow } from "imapflow"
import { PublicClientApplication } from "@azure/msal-node"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { decSecret } from "./secrets.mjs"
import { withLock } from "./lock.mjs"
import { emailMessagesInThread } from "./db.mjs"

const readImap = () => { try { return existsSync("./auth/imap-accounts.json") ? JSON.parse(readFileSync("./auth/imap-accounts.json", "utf8")) : [] } catch { return [] } }

// emails RECIBIDOS del hilo, por cuenta. El id guardado es `email:<message-id (IMAP) | graph-id (Outlook)>`.
function emailMsgsOf(thread) {
  try { return emailMessagesInThread(thread) } catch { return [] }
}

async function imapArchive(acc, ids, on) {
  const client = new ImapFlow({ host: acc.host, port: acc.port || 993, secure: true, auth: { user: acc.user, pass: decSecret(acc.pass) }, logger: false })
  client.on("error", () => {})
  let moved = 0
  try {
    await client.connect()
    const boxes = await client.list()
    const gmailAll = boxes.find((b) => b.specialUse === "\\All")?.path // Gmail: "All Mail"
    const archiveBox = boxes.find((b) => b.specialUse === "\\Archive")?.path || gmailAll || boxes.find((b) => /^archive$|^archivar$/i.test(b.path))?.path
    if (!archiveBox) return 0
    const findUid = async (mid) => { try { return await client.search({ header: { "message-id": mid } }, { uid: true }) } catch { return [] } }
    if (on) { // archivar: INBOX → archivo (Gmail: saca etiqueta INBOX, no borra)
      const lock = await client.getMailboxLock("INBOX")
      try { for (const mid of ids) { const u = await findUid(mid); if (u?.length) { await client.messageMove(u, archiveBox, { uid: true }); moved += u.length } } } finally { lock.release() }
    } else { // restaurar: archivo → INBOX. Gmail: COPY (move borraría de All Mail = Trash); genérico: MOVE.
      const lock = await client.getMailboxLock(archiveBox)
      try { for (const mid of ids) { const u = await findUid(mid); if (u?.length) { if (archiveBox === gmailAll) await client.messageCopy(u, "INBOX", { uid: true }); else await client.messageMove(u, "INBOX", { uid: true }); moved += u.length } } } finally { lock.release() }
    }
  } catch (e) { console.error(`[archive] imap ${acc.label}: ${e.message}`) } finally { try { await client.logout() } catch {} }
  return moved
}

async function outlookArchive(ids, on) {
  const clientId = process.env.MS_CLIENT_ID, tenantId = process.env.MS_TENANT_ID, cacheFile = "./auth/teams.cache.json"
  if (!clientId || !existsSync(cacheFile)) return 0
  const cachePlugin = {
    beforeCacheAccess: async (ctx) => { if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
    afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) withLock(cacheFile, () => writeFileSync(cacheFile, ctx.tokenCache.serialize())) },
  }
  const pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin } })
  let token = null
  try { const accts = await pca.getTokenCache().getAllAccounts(); if (accts.length) token = (await pca.acquireTokenSilent({ account: accts[0], scopes: ["Mail.ReadWrite"] }))?.accessToken } catch {}
  if (!token) return 0
  const dest = on ? "archive" : "inbox"
  let moved = 0
  for (const gid of ids) {
    try {
      const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(gid)}/move`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ destinationId: dest }) })
      if (res.ok) moved++
    } catch {}
  }
  return moved
}

// archiva (on=true) o restaura (on=false) en el buzón real todos los emails recibidos del hilo. Idempotente y no-fatal.
export async function archiveThreadOnServer(thread, on = true) {
  const msgs = emailMsgsOf(thread)
  if (!msgs.length) return { moved: 0 }
  const byAcct = {}
  for (const m of msgs) { const id = m.id.replace(/^email:/, ""); (byAcct[m.account] = byAcct[m.account] || []).push(id) }
  const imapAccts = readImap()
  let moved = 0
  for (const [label, ids] of Object.entries(byAcct)) {
    if (label === "outlook") moved += await outlookArchive(ids, on)
    else { const acc = imapAccts.find((a) => a.label === label); if (acc) moved += await imapArchive(acc, ids, on) }
  }
  if (moved) console.log(`[archive] hilo ${thread} → ${on ? "archivado" : "restaurado"} en el servidor: ${moved} email(s)`)
  return { moved }
}
