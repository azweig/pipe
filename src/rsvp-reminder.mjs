// Recordatorios ADAPTATIVOS de reuniones que organicé. Corre en el daemon cada ~30 min.
// Regla: si un invitado NO confirmó → avisar 2 DÍAS antes (para reuniones lejanas) y unas HORAS antes (para cercanas).
// Además: aviso ~30 min antes de que empiece (independiente del RSVP). Dedup por (evento, ventana). Uso: node src/rsvp-reminder.mjs
import { readFileSync, writeFileSync, existsSync } from "fs"
import { loadEnv } from "./lib/env.mjs"
import { upcomingMeetings } from "./lib/calendar.mjs"

loadEnv()

const F = "./data/rsvp-reminders.json"
const NOW = Date.now()
const state = existsSync(F) ? JSON.parse(readFileSync(F, "utf8")) : {}
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const fmt = (d) => `${DIAS[d.getDay()]} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`

const meetings = await upcomingMeetings("personal", 14).catch((e) => { console.error("[rsvp] err:", e.message); return [] })
const nudges = []
for (const m of meetings) {
  const start = Date.parse(m.start); if (isNaN(start)) continue
  const h = (start - NOW) / 3600e3
  let window = null, needsPending = true
  if (h >= 0.25 && h <= 0.75) { window = "soon"; needsPending = false }   // ~30 min antes: "está por empezar"
  else if (h >= 2 && h <= 6) window = "hrs"                                // ~horas antes (reuniones cercanas)
  else if (h >= 43 && h <= 53) window = "2d"                               // ~2 días antes (reuniones lejanas)
  if (!window) continue
  if (needsPending && !m.pending.length) continue                          // ya confirmaron → no molestar
  const k = `${m.id}:${window}`
  if (state[k]) continue
  nudges.push({ m, window, k, start })
}

if (nudges.length) {
  const push = await import("./lib/push.mjs")
  for (const { m, window, k, start } of nudges) {
    const when = fmt(new Date(start)), who = (m.pending[0] || "").split("@")[0] || "el invitado"
    let title, body
    if (window === "soon") { title = "⏰ Reunión en ~30 min"; body = `${m.title} (${when})` }
    else { title = "📩 Falta que confirmen"; body = `${who} todavía no confirmó "${m.title}" (${when}) — ¿le escribís?` }
    const r = await push.sendPush({ title, body, url: "/", tag: k })
    state[k] = NOW
    console.log(`[rsvp] ${window} → ${m.title} (${when}) · push ${r.sent}`)
  }
  writeFileSync(F, JSON.stringify(state))
} else {
  console.log(`[rsvp] ${meetings.length} reuniones próximas, ninguna para avisar ahora`)
}
