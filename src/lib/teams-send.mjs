// ENVÍO por Microsoft Teams (Graph, auth delegada del MISMO usuario que lee).
//
// Va aparte de src/teams.mjs a propósito. El lector pide SOLO permisos de lectura (Chat.Read…) y funciona hoy; si le agregara
// ChatMessage.Send a su lista, su acquireTokenSilent fallaría hasta que alguien vuelva a consentir y el lector quedaría colgado
// esperando un device-code. Acá pedimos el permiso de envío por separado: si todavía no está consentido, devolvemos un error
// accionable en vez de romper la lectura.
import { PublicClientApplication } from "@azure/msal-node"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { withLock } from "./lock.mjs"

const cacheFile = "./auth/teams.cache.json"
const SEND_SCOPES = ["ChatMessage.Send"] // el permiso que Teams exige para escribir en un chat

const cachePlugin = {
  beforeCacheAccess: async (ctx) => { if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
  afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) withLock(cacheFile, () => writeFileSync(cacheFile, ctx.tokenCache.serialize())) },
}

function app() {
  const clientId = process.env.MS_CLIENT_ID || "", tenantId = process.env.MS_TENANT_ID || ""
  if (!clientId || !tenantId) return null
  return new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin } })
}

export const teamsConfigured = () => !!(process.env.MS_CLIENT_ID && process.env.MS_TENANT_ID && existsSync(cacheFile))

// Token de ENVÍO, solo en silencio: si el permiso no está consentido, no arrastramos al usuario a un device-code en medio de
// un envío — le decimos qué hacer una sola vez.
async function sendToken() {
  const pca = app()
  if (!pca) return { error: "Teams no está configurado (faltan MS_CLIENT_ID / MS_TENANT_ID)." }
  const accounts = await pca.getTokenCache().getAllAccounts()
  if (!accounts.length) return { error: "Teams no tiene sesión — conectalo primero (node src/teams.mjs)." }
  try {
    const r = await pca.acquireTokenSilent({ account: accounts[0], scopes: SEND_SCOPES })
    if (r?.accessToken) return { token: r.accessToken }
  } catch {}
  return { error: "Teams está conectado solo para LEER. Para responder desde Pipe hay que autorizar el permiso de envío una vez: corré `node src/teams-link-send.mjs` en el servidor y seguí el código." }
}

// chatId de Teams: viene como "19:....@thread.v2" (o el id de un chat 1:1). El key del hilo es "teams:<chatId>".
export async function teamsSend(chatId, text) {
  const id = String(chatId || "").replace(/^teams:/, "")
  if (!id) return { error: "sin chat de Teams al que responder" }
  const t = await sendToken()
  if (t.error) return { error: t.error }
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: { contentType: "text", content: String(text) } }),
    })
    if (res.ok) return { ok: true }
    const detail = (await res.text()).slice(0, 200)
    // 403 acá casi siempre es el permiso sin consentir (o bloqueado por política del tenant): decilo, no un número suelto.
    if (res.status === 403) return { error: "Teams rechazó el envío (403). Falta autorizar ChatMessage.Send, o el administrador del tenant lo tiene bloqueado." }
    return { error: `Teams ${res.status}: ${detail}` }
  } catch (e) { return { error: e.message } }
}
