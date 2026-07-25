// Outlook / Microsoft 365 CALENDAR reader (Microsoft Graph, delegated) — LECTURA (preparado para crear eventos).
// Reusa el MISMO login que Teams/Outlook (auth/teams.cache.json). Necesita Calendars.Read (+ Calendars.ReadWrite) en Azure.
// Trae los eventos de los próximos 30 días y los unifica en data/calendar.jsonl.
import { PublicClientApplication } from "@azure/msal-node"
import { tz } from "./lib/hub.mjs"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { withLock } from "./lib/lock.mjs"

mkdirSync("./data", { recursive: true })
const clientId = process.env.MS_CLIENT_ID || ""
const tenantId = process.env.MS_TENANT_ID || ""
const cacheFile = "./auth/teams.cache.json"
const SCOPES = ["User.Read", "Calendars.Read", "Calendars.ReadWrite"]
const POLL_MS = 300000 // 5 min (el calendario cambia lento)
const DAYS_AHEAD = 30

const cachePlugin = {
  beforeCacheAccess: async (ctx) => { if (existsSync(cacheFile)) ctx.tokenCache.deserialize(readFileSync(cacheFile, "utf8")) },
  afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) withLock(cacheFile, () => writeFileSync(cacheFile, ctx.tokenCache.serialize())) }, // lock: cache MSAL compartido
}
const pca = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }, cache: { cachePlugin } })

async function getToken() {
  const accounts = await pca.getTokenCache().getAllAccounts()
  if (accounts.length) { try { const r = await pca.acquireTokenSilent({ account: accounts[0], scopes: SCOPES }); if (r?.accessToken) return r.accessToken } catch {} }
  const r = await pca.acquireTokenByDeviceCode({ scopes: SCOPES, deviceCodeCallback: (i) => console.log(`\n🔑 [calendar] ABRÍ ${i.verificationUri} Y PEGÁ EL CÓDIGO: ${i.userCode}\n`) })
  return r.accessToken
}

async function graph(token, path) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${tz()}"` } })
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// pasar fechas por args (Date.now no está disponible en workflows, pero acá es un script node normal → sí está)
async function poll(token) {
  const now = new Date()
  const end = new Date(now.getTime() + DAYS_AHEAD * 86400000)
  const path = `/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${end.toISOString()}&$select=subject,start,end,location,organizer,attendees,isAllDay,onlineMeetingUrl,iCalUId&$orderby=start/dateTime&$top=100`
  const events = (await graph(token, path)).value || []
  // reescribe entero el archivo cada poll (snapshot de los próximos 30 días)
  const lines = events.map((e) => JSON.stringify({
    channel: "calendar", account: "outlook", id: e.id, uid: e.iCalUId || "",
    title: e.subject || "(sin título)",
    start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
    allDay: !!e.isAllDay, location: e.location?.displayName || "",
    organizer: e.organizer?.emailAddress?.name || "",
    attendees: (e.attendees || []).map((a) => a.emailAddress?.name || a.emailAddress?.address).slice(0, 20),
    meetingUrl: e.onlineMeetingUrl || "",
  }))
  writeFileSync("./data/calendar.jsonl", lines.join("\n") + (lines.length ? "\n" : ""))
  console.log(`📅 [calendar] ${events.length} eventos en los próximos ${DAYS_AHEAD} días:`)
  for (const e of events.slice(0, 12)) {
    const when = (e.start?.dateTime || e.start?.date || "").replace("T", " ").slice(0, 16)
    console.log(`   • ${when}  ${e.subject || "(sin título)"}`)
  }
}

console.log("[calendar] autenticando...")
const token = await getToken()
const me = await graph(token, "/me")
console.log(`\n✅ [calendar] CONECTADO como ${me.displayName} — leyendo agenda cada ${POLL_MS / 60000} min...\n`)
await poll(token)
setInterval(async () => { try { const t = await getToken(); await poll(t) } catch (e) { console.log("[calendar] err:", e.message) } }, POLL_MS)
