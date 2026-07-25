// Google Calendar reader (OAuth, googleapis oficial) — LECTURA (preparado para crear eventos).
// Durable si la app OAuth es "Internal" (Workspace) o está "Production". Guarda el refresh token → no reautoriza.
// Config (gitignoreada): auth/google-oauth.json → { "client_id":"...", "client_secret":"GOCSPX-..." }
// Token guardado en: auth/google-token.json
import { google } from "googleapis"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import http from "http"

mkdirSync("./data", { recursive: true })
const cfg = JSON.parse(readFileSync("./auth/google-oauth.json", "utf8"))
const tokenFile = "./auth/google-token.json"
const REDIRECT = "http://localhost:53682/oauth2callback"
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"]
const POLL_MS = 300000
const DAYS_AHEAD = 30

const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, REDIRECT)

async function authorize() {
  if (existsSync(tokenFile)) { oauth2.setCredentials(JSON.parse(readFileSync(tokenFile, "utf8"))); return }
  const url = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES })
  console.log(`\n🔑 [gcal] ABRÍ ESTE LINK EN EL NAVEGADOR Y AUTORIZÁ:\n\n${url}\n`)
  const code = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith("/oauth2callback")) {
        const code = new URL(req.url, REDIRECT).searchParams.get("code")
        res.end("pipe: listo, ya podés cerrar esta pestaña.")
        server.close(); resolve(code)
      }
    }).listen(53682)
  })
  const { tokens } = await oauth2.getToken(code)
  oauth2.setCredentials(tokens)
  writeFileSync(tokenFile, JSON.stringify(tokens))
  console.log("✅ [gcal] token guardado (no se re-autoriza).")
}
oauth2.on("tokens", (t) => { // guarda refresh token renovado
  const cur = existsSync(tokenFile) ? JSON.parse(readFileSync(tokenFile, "utf8")) : {}
  writeFileSync(tokenFile, JSON.stringify({ ...cur, ...t }))
})

const cal = google.calendar({ version: "v3", auth: oauth2 })

async function poll() {
  const now = new Date()
  const max = new Date(now.getTime() + DAYS_AHEAD * 86400000)
  const { data } = await cal.events.list({ calendarId: "primary", timeMin: now.toISOString(), timeMax: max.toISOString(), singleEvents: true, orderBy: "startTime", maxResults: 100 })
  const events = data.items || []
  const lines = events.map((e) => JSON.stringify({
    channel: "calendar", account: "google", id: e.id,
    title: e.summary || "(sin título)", start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
    allDay: !e.start?.dateTime, location: e.location || "", organizer: e.organizer?.displayName || e.organizer?.email || "",
    attendees: (e.attendees || []).map((a) => a.displayName || a.email).slice(0, 20), meetingUrl: e.hangoutLink || "",
  }))
  writeFileSync("./data/calendar-google.jsonl", lines.join("\n") + (lines.length ? "\n" : ""))
  console.log(`📅 [gcal] ${events.length} eventos en ${DAYS_AHEAD} días:`)
  for (const e of events.slice(0, 12)) console.log(`   • ${(e.start?.dateTime || e.start?.date || "").replace("T", " ").slice(0, 16)}  ${e.summary || "(sin título)"}`)
}

await authorize()
console.log(`\n✅ [gcal] CONECTADO — leyendo agenda cada ${POLL_MS / 60000} min...\n`)
await poll()
setInterval(() => poll().catch((e) => console.log("[gcal] err:", e.message)), POLL_MS)
