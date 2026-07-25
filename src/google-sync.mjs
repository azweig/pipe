// Google multi-cuenta sync — Calendar + Drive de TODAS las cuentas Google autorizadas.
// Escribe data/calendar-google.jsonl (agenda) y data/drive.jsonl (archivos), con el label de cada cuenta.
import { google } from "googleapis"
import { googleAccounts, oauthClient, hasToken } from "./lib/google.mjs"
import { writeFileSync, mkdirSync, existsSync, statSync } from "fs"

// NO sobrescribir con vacío: si TODAS las cuentas fallan en un ciclo (red/token), calAll queda [] → borraría la agenda.
// Sólo escribimos si hay datos, o si el archivo previo también estaba vacío. Un fallo transitorio conserva el snapshot bueno.
function safeWrite(path, arr) {
  if (!arr.length && existsSync(path) && statSync(path).size > 0) { console.log(`[google] 0 resultados → conservo ${path}`); return }
  writeFileSync(path, arr.map((x) => JSON.stringify(x)).join("\n") + (arr.length ? "\n" : ""))
}

mkdirSync("./data", { recursive: true })
const POLL = 300000, DAYS = 30

async function sync() {
  const accts = googleAccounts().filter((a) => hasToken(a.label))
  if (!accts.length) { console.log("[google] sin cuentas autorizadas todavía"); return }
  const calAll = [], driveAll = []
  const now = new Date(), max = new Date(now.getTime() + DAYS * 86400000)
  for (const a of accts) {
    const auth = oauthClient(a.label)
    try {
      const cal = google.calendar({ version: "v3", auth })
      const { data } = await cal.events.list({ calendarId: "primary", timeMin: now.toISOString(), timeMax: max.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 100 })
      for (const e of data.items || []) calAll.push({ channel: "calendar", account: a.label, id: e.id, uid: e.iCalUID || "", title: e.summary || "(sin título)", start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, allDay: !e.start?.dateTime, location: e.location || "", organizer: e.organizer?.displayName || e.organizer?.email || "", attendees: (e.attendees || []).map((x) => x.displayName || x.email).slice(0, 20), meetingUrl: e.hangoutLink || "" })
    } catch (e) { console.log(`[${a.label}] calendar: ${e.message}`) }
    try {
      const drive = google.drive({ version: "v3", auth })
      const { data } = await drive.files.list({ orderBy: "modifiedTime desc", pageSize: 40, spaces: "drive", fields: "files(id,name,mimeType,modifiedTime,size,owners(displayName),webViewLink)", q: "trashed = false" })
      for (const f of data.files || []) driveAll.push({ channel: "drive", account: a.label, id: f.id, name: f.name, mime: f.mimeType, modified: f.modifiedTime, size: f.size || "", owner: f.owners?.[0]?.displayName || "", url: f.webViewLink || "" })
    } catch (e) { console.log(`[${a.label}] drive: ${e.message}`) }
  }
  safeWrite("./data/calendar-google.jsonl", calAll)
  safeWrite("./data/drive.jsonl", driveAll)
  console.log(`✅ [google] ${accts.length} cuenta(s) · ${calAll.length} eventos · ${driveAll.length} archivos`)
}

await sync()
setInterval(() => sync().catch((e) => console.log("[google] err:", e.message)), POLL)
