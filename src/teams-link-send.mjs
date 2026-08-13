// AUTORIZACIÓN ÚNICA para RESPONDER por Teams.
//
// El lector (src/teams.mjs) pide solo permisos de lectura. Este script pide los de lectura MÁS ChatMessage.Send y guarda el
// resultado en el mismo cache de MSAL, así que después de correrlo una vez el envío funciona solo. No hace falta repetirlo.
//
// Uso:  node src/teams-link-send.mjs      → abrí el link, pegá el código, listo.
import { PublicClientApplication } from "@azure/msal-node"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { withLock } from "./lib/lock.mjs"

mkdirSync("./auth", { recursive: true })
const cacheFile = "./auth/teams.cache.json"
const clientId = process.env.MS_CLIENT_ID || "", tenantId = process.env.MS_TENANT_ID || ""
if (!clientId || !tenantId) { console.error("Faltan MS_CLIENT_ID / MS_TENANT_ID en el .env"); process.exit(1) }

// mismos permisos que el lector + el de envío: así el token cacheado sirve para AMBAS cosas y el lector no se entera del cambio
const SCOPES = ["User.Read", "Chat.Read", "ChannelMessage.Read.All", "Team.ReadBasic.All", "ChatMessage.Send"]

const cachePlugin = {
  beforeCacheAccess: async (ctx) => { if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
  afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) withLock(cacheFile, () => writeFileSync(cacheFile, ctx.tokenCache.serialize())) },
}
const pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin } })

const r = await pca.acquireTokenByDeviceCode({
  scopes: SCOPES,
  deviceCodeCallback: (info) => console.log(`\n🔑 ABRÍ ESTE LINK Y PEGÁ EL CÓDIGO:\n   → ${info.verificationUri}\n   → CÓDIGO: ${info.userCode}\n`),
})
if (!r?.accessToken) { console.error("❌ no se obtuvo token"); process.exit(1) }
console.log(`\n✅ Listo — ${r.account?.username || "tu usuario"} ya puede RESPONDER por Teams desde Pipe.`)
console.log("   (si el administrador del tenant bloquea ChatMessage.Send, el envío seguirá dando 403)")
