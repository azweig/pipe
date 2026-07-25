// Creación/borrado de eventos de calendario. Meet vía Google, Teams vía Microsoft Graph. Reusa los tokens ya
// autorizados (lib/google.mjs + auth/teams.cache.json). Fechas por COMPONENTES + timeZone explícito → sin bug de TZ.
import { google } from "googleapis"
import { tz } from "./hub.mjs"
import { PublicClientApplication } from "@azure/msal-node"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { oauthClient } from "./google.mjs"

const p2 = (n) => String(n).padStart(2, "0")
const rfc3339 = (d) => `${d.year}-${p2(d.month)}-${p2(d.day)}T${p2(d.hour)}:${p2(d.minute)}:00`
function endOf(d, durationMin) {
  const total = d.hour * 60 + d.minute + durationMin
  const addDays = Math.floor(total / 1440)
  const base = new Date(Date.UTC(d.year, d.month - 1, d.day + addDays)) // solo para normalizar el cruce de día
  return { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), hour: Math.floor((total % 1440) / 60), minute: total % 60 }
}

// ── Google Meet ──
export async function createGoogleEvent({ label = "personal", summary, date, durationMin = 30, timeZone = tz(), attendees = [], description = "" }) {
  const cal = google.calendar({ version: "v3", auth: oauthClient(label) })
  const requestId = `pipe-${date.year}${date.month}${date.day}${date.hour}${date.minute}-${Math.floor(Math.random() * 1e6)}`
  const { data } = await cal.events.insert({
    calendarId: "primary", conferenceDataVersion: 1, sendUpdates: "all",
    requestBody: {
      summary: summary || "Reunión", description,
      start: { dateTime: rfc3339(date), timeZone }, end: { dateTime: rfc3339(endOf(date, durationMin)), timeZone },
      attendees: attendees.filter(Boolean).map((email) => ({ email })),
      conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
  })
  const link = data.hangoutLink || data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || data.htmlLink
  return { ok: true, id: data.id, link, htmlLink: data.htmlLink, platform: "meet", label }
}
export async function deleteGoogleEvent(label, id) {
  await google.calendar({ version: "v3", auth: oauthClient(label) }).events.delete({ calendarId: "primary", eventId: id, sendUpdates: "all" })
  return { ok: true }
}

// ── Microsoft Teams (Graph) ──
const MS_CACHE = "./auth/teams.cache.json"
let _pca
function pca() {
  if (!_pca) _pca = new PublicClientApplication({
    auth: { clientId: process.env.MS_CLIENT_ID || "", authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID || ""}` },
    cache: { cachePlugin: {
      beforeCacheAccess: async (ctx) => { if (existsSync(MS_CACHE)) ctx.tokenCache.deserialize(readFileSync(MS_CACHE, "utf8")) },
      afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged) writeFileSync(MS_CACHE, ctx.tokenCache.serialize()) },
    } },
  })
  return _pca
}
async function msToken() {
  const accts = await pca().getTokenCache().getAllAccounts()
  if (!accts.length) throw new Error("Outlook/Teams no está logueado en el server")
  const r = await pca().acquireTokenSilent({ account: accts[0], scopes: ["Calendars.ReadWrite"] })
  return r.accessToken
}
export async function createOutlookEvent({ subject, date, durationMin = 30, timeZone = tz(), attendees = [], body = "" }) {
  const token = await msToken()
  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: subject || "Reunión", body: { contentType: "text", content: body },
      start: { dateTime: rfc3339(date), timeZone }, end: { dateTime: rfc3339(endOf(date, durationMin)), timeZone },
      attendees: attendees.filter(Boolean).map((email) => ({ emailAddress: { address: email }, type: "required" })),
      isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness",
    }),
  })
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return { ok: true, id: data.id, link: data.onlineMeeting?.joinUrl || data.webLink, platform: "teams" }
}
export async function deleteOutlookEvent(id) {
  const token = await msToken()
  await fetch(`https://graph.microsoft.com/v1.0/me/events/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
  return { ok: true }
}

// ── unificado ──
export async function createEvent({ platform = "meet", ...o }) {
  if (platform === "teams") return createOutlookEvent({ subject: o.summary, ...o })
  return createGoogleEvent(o)
}

// reprogramar: mueve un evento a una nueva fecha/hora (para "movamos la reu al jueves")
export async function moveGoogleEvent(label, id, date, durationMin = 30, timeZone = tz()) {
  const cal = google.calendar({ version: "v3", auth: oauthClient(label) })
  const { data } = await cal.events.patch({ calendarId: "primary", eventId: id, sendUpdates: "all", requestBody: { start: { dateTime: rfc3339(date), timeZone }, end: { dateTime: rfc3339(endOf(date, durationMin)), timeZone } } })
  return { ok: true, id: data.id, link: data.hangoutLink || "" }
}

// lista de eventos cacheada 60s (evita pegarle a la API en cada apertura de chat)
const _evCache = {}
async function _listEvents(label = "personal", daysAhead = 30) {
  const c = _evCache[label]
  if (c && Date.now() - c.ts < 60000 && c.daysAhead >= daysAhead) return c.items
  const cal = google.calendar({ version: "v3", auth: oauthClient(label) })
  const now = new Date(), max = new Date(now.getTime() + daysAhead * 86400e3)
  const { data } = await cal.events.list({ calendarId: "primary", timeMin: now.toISOString(), timeMax: max.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 80 })
  _evCache[label] = { ts: Date.now(), items: data.items || [], daysAhead }
  return data.items || []
}

// PRÓXIMAS reuniones que YO organicé, con el estado de confirmación (RSVP) de cada invitado. Para los recordatorios.
export async function upcomingMeetings(label = "personal", daysAhead = 14) {
  const out = []
  for (const e of await _listEvents(label, daysAhead)) {
    if (!e.start?.dateTime || !(e.attendees?.length) || !e.organizer?.self) continue
    const guests = e.attendees.filter((a) => !a.self && !a.organizer)
    if (!guests.length) continue
    out.push({
      id: e.id, title: e.summary || "(sin título)", start: e.start.dateTime, link: e.hangoutLink || "",
      guests: guests.map((a) => ({ email: a.email, name: a.displayName || a.email, status: a.responseStatus })),
      pending: guests.filter((a) => a.responseStatus === "needsAction").map((a) => a.displayName || a.email),
    })
  }
  return out
}

// próximas reuniones CON un contacto (por su email), las organice yo o él. Para la tarjeta en el chat.
export async function upcomingWith(label = "personal", emails = [], daysAhead = 30) {
  const set = new Set(emails.map((e) => String(e).toLowerCase()))
  const out = []
  for (const e of await _listEvents(label, daysAhead)) {
    if (!e.start?.dateTime) continue
    const parts = [...(e.attendees || []).map((a) => a.email), e.organizer?.email].filter(Boolean).map((x) => x.toLowerCase())
    if (!parts.some((p) => set.has(p))) continue
    out.push({
      id: e.id, title: e.summary || "(sin título)", start: e.start.dateTime, link: e.hangoutLink || "",
      canManage: !!e.organizer?.self, platform: e.hangoutLink ? "meet" : "",
      guests: (e.attendees || []).filter((a) => !a.self).map((a) => ({ name: a.displayName || a.email, status: a.responseStatus })),
    })
  }
  return out
}
