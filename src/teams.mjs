// Teams reader (Microsoft Graph, delegated user auth vía device-code) — SOLO LECTURA.
// Se loguea como TU usuario (no bot), lee tus chats 1:1/grupales y mensajes de canales, y los guarda en data/messages.jsonl.
// Necesita: MS_CLIENT_ID + MS_TENANT_ID (de portal.azure.com → App registrations). Sin secret (device-code = cliente público).
// El código de login se muestra en consola → lo pegás en https://microsoft.com/devicelogin. La sesión queda cacheada (no re-login).
import { PublicClientApplication } from "@azure/msal-node"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { appendMessage, withLock } from "./lib/lock.mjs"

mkdirSync("./data", { recursive: true })
mkdirSync("./auth", { recursive: true })

const clientId = process.env.MS_CLIENT_ID || ""
const tenantId = process.env.MS_TENANT_ID || ""
const cacheFile = "./auth/teams.cache.json"
const stateFile = "./auth/teams.state.json" // último timestamp visto por chat, para no re-leer
const SCOPES = ["User.Read", "Chat.Read", "ChannelMessage.Read.All", "Team.ReadBasic.All"]
const POLL_MS = 20000

// --- MSAL con cache persistente en disco (para no re-loguear) ---
const cachePlugin = {
  beforeCacheAccess: async (ctx) => { if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
  afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) withLock(cacheFile, () => writeFileSync(cacheFile, ctx.tokenCache.serialize())) }, // lock: 4 módulos MS comparten este cache
}
const pca = new PublicClientApplication({
  auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
  cache: { cachePlugin },
})

async function getToken() {
  const accounts = await pca.getTokenCache().getAllAccounts()
  if (accounts.length) {
    try { const r = await pca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES }); if (r?.accessToken) return r.accessToken } catch {}
  }
  const r = await pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (info) => {
      console.log(`\n🔑 [teams] ABRÍ ESTE LINK Y PEGÁ EL CÓDIGO:\n   → ${info.verificationUri}\n   → CÓDIGO: ${info.userCode}\n`)
    },
  })
  return r.accessToken
}

async function graph(token, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

let seen = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {}
const saveSeen = () => writeFileSync(stateFile, JSON.stringify(seen))

function record(chatId, name, text, ts, kind, sender, grp) {
  const rec = { channel: "teams", account: "teams", jid: chatId, sender: sender || "", name, text, ts, kind, group: grp || null } // grp = tema del chat → la bandeja muestra "Qck - PCO" en vez de "Grupo · N personas"
  appendMessage(rec)
  console.log(`💬 [teams/${kind}]${grp ? " {" + grp + "}" : ""} ${name}${sender ? " <" + sender + ">" : ""}: ${text}`)
}

// resuelve user.id (AAD) → email/UPN, cacheado (para unificar identidades cross-canal)
const emailCacheFile = "./auth/teams-emails.json"
const emailCache = existsSync(emailCacheFile) ? JSON.parse(readFileSync(emailCacheFile, "utf8")) : {}
async function userEmail(token, userId) {
  if (!userId) return ""
  if (emailCache[userId] !== undefined) return emailCache[userId]
  let email = ""
  try { const u = await graph(token, `/users/${userId}?$select=mail,userPrincipalName`); email = (u.mail || u.userPrincipalName || "").toLowerCase() } catch {}
  emailCache[userId] = email; writeFileSync(emailCacheFile, JSON.stringify(emailCache))
  return email
}

async function poll(token) {
  // 1) Chats 1:1 y grupales del usuario
  let chats = []
  try { chats = (await graph(token, "/me/chats?$top=50")).value || [] } catch (e) { console.log("[teams] chats:", e.message) }
  for (const c of chats) {
    const grp = (c.chatType === "group" || c.chatType === "meeting") ? (c.topic || null) : null // nombre real del chat grupal
    try {
      const msgs = (await graph(token, `/me/chats/${c.id}/messages?$top=50`)).value || []
      for (const m of msgs.reverse()) {
        const ts = Date.parse(m.createdDateTime || "") || 0
        if (ts <= (seen[c.id] || 0)) continue
        seen[c.id] = ts
        if (m.from?.user?.id && m.messageType === "message") {
          const name = m.from?.user?.displayName || "?"
          const text = (m.body?.content || "").replace(/<[^>]+>/g, "").trim() || "[adjunto/otro]"
          const email = await userEmail(token, m.from.user.id) // resuelve email → unifica identidad cross-canal
          record(c.id, name, text, ts, "chat", email, grp)
        }
      }
    } catch (e) { /* algún chat sin permiso, seguimos */ }
  }
  saveSeen()
  try { writeFileSync("/tmp/hb_teams", String(Date.now())) } catch {} // heartbeat: el reader está vivo aunque no haya mensajes (evita "no conectado" los findes)
}

console.log("[teams] autenticando...")
const token = await getToken()
const me = await graph(token, "/me")
console.log(`\n✅ [teams] CONECTADO como ${me.displayName} (${me.userPrincipalName}) — leyendo cada ${POLL_MS / 1000}s...\n`)

await poll(token)
setInterval(async () => {
  try { const t = await getToken(); await poll(t) } catch (e) { console.log("[teams] poll err:", e.message) }
}, POLL_MS)
