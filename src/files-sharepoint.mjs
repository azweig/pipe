// SharePoint + OneDrive reader (Microsoft Graph, delegated) — LECTURA de archivos. Reusa el login de Teams/Outlook.
// Necesita en Azure (misma app): Files.Read.All + Sites.Read.All (delegated) + admin consent.
// Lista archivos recientes (OneDrive + SharePoint) → data/files-ms.jsonl. Puede leer contenido (getContent).
import { PublicClientApplication } from "@azure/msal-node"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { withLock } from "./lib/lock.mjs"

mkdirSync("./data", { recursive: true })
const clientId = process.env.MS_CLIENT_ID || ""
const tenantId = process.env.MS_TENANT_ID || ""
const cacheFile = "./auth/teams.cache.json"
const SCOPES = ["User.Read", "Files.ReadWrite.All", "Sites.Read.All"]
const POLL_MS = 180000

const cachePlugin = {
  beforeCacheAccess: async (ctx) => { if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
  afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) withLock(cacheFile, () => writeFileSync(cacheFile, ctx.tokenCache.serialize())) }, // lock: cache MSAL compartido
}
const pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin } })

async function getToken() {
  const accounts = await pca.getTokenCache().getAllAccounts()
  if (accounts.length) { try { const r = await pca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES }); if (r?.accessToken) return r.accessToken } catch {} }
  const r = await pca.acquireTokenByDeviceCode({ scopes: SCOPES, deviceCodeCallback: (i) => console.log(`\n🔑 [sharepoint] ABRÍ ${i.verificationUri} Y PEGÁ EL CÓDIGO: ${i.userCode}\n`) })
  return r.accessToken
}

async function graph(token, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function poll(token) {
  // /me/drive/recent = archivos usados recientemente, incluye OneDrive Y SharePoint
  const data = await graph(token, "/me/drive/recent")
  const files = (data.value || []).filter((f) => f.file) // solo archivos, no carpetas
  const lines = files.map((f) => JSON.stringify({
    channel: "files", account: "sharepoint", id: f.id, name: f.name, mime: f.file?.mimeType || "",
    modified: f.lastModifiedDateTime, size: f.size || "", modifiedBy: f.lastModifiedBy?.user?.displayName || "",
    url: f.webUrl || "", source: f.remoteItem ? "sharepoint" : "onedrive",
  }))
  writeFileSync("./data/files-ms.jsonl", lines.join("\n") + (lines.length ? "\n" : ""))
  console.log(`📁 [sharepoint] ${files.length} archivos recientes (OneDrive + SharePoint):`)
  for (const f of files.slice(0, 12)) console.log(`   • ${(f.lastModifiedDateTime || "").slice(0, 10)}  ${f.name}`)
}

console.log("[sharepoint] autenticando...")
const token = await getToken()
const me = await graph(token, "/me")
console.log(`\n✅ [sharepoint] CONECTADO como ${me.displayName} — listando cada ${POLL_MS / 60000} min...\n`)
await poll(token)
setInterval(async () => { try { const t = await getToken(); await poll(t) } catch (e) { console.log("[sharepoint] err:", e.message) } }, POLL_MS)
