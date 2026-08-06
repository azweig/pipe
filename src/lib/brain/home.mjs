// brain/home — COMPOSICIÓN de la UI (dashboard/home). Unidireccional: importa lecturas de inbox + coach + schedule
// y las agrega. No tiene lógica de dominio propia; solo junta. Último eslabón del split (candidato #2).
import { listThreads } from "./inbox.mjs"
import { coachData } from "./coach.mjs"
import { agenda } from "./schedule.mjs"
import { peopleNodes, companyNodes } from "./kernel/vault.mjs"
import { getMeta } from "../db.mjs"
import { secretGate } from "../secret.mjs" // 🔒 el dashboard en vivo no cuenta ni muestra hilos secretos sin 2º PIN

// filtra la salida de listThreads igual que /api/threads (sin sesión secreta → siempre excluye): saca 100%-secretos + parcha preview
function _gate(threads) { const g = secretGate(); if (!g.any) return threads; return threads.filter((t) => !g.hide.has(t.key)).map((t) => { const p = g.preview.get(t.key); return p ? { ...t, lastText: (p.text || "").slice(0, 120), ts: p.ts } : t }) }

// ── DASHBOARD ──
export function summary() {
  const threads = _gate(listThreads({ limit: 500 }))
  const coach = coachData(), ag = agenda()
  return {
    threads: threads.length, pending: coach.nudges.filter((n) => n.type === "responder").length,
    topNudges: coach.nudges.slice(0, 4), nextMeetings: ag.meetings.slice(0, 3),
    people: peopleNodes().length, companies: companyNodes().length,
    nextHoliday: ag.holidays[0] || null,
  }
}

export async function homeSnapshot(ws) {
  const raw = getMeta("home_brief")
  if (raw) { try { const s = JSON.parse(raw); if (s && s.generatedAt) return s } catch {} }
  const d = await homeData(ws) // aún no corrió el cron → devolvé lo básico en vivo (la UI lo tolera)
  return { generatedAt: 0, brief: { text: d.foco, audioSec: 0 }, foco: null, agenda: [], bandeja: { important: d.counts?.urgent || 0, items: [] }, kpis: [], news: [], coach: null, objetivos: d.objetivos || [], companies: d.companies || [] }
}
export async function homeData(ws) {
  const threads = _gate(listThreads({ limit: 300 })), ag = agenda(), coach = coachData()
  const today = new Date().toISOString().slice(0, 10)
  const messagesNew = threads.reduce((a, t) => a + (t.unread || 0), 0)
  const urgent = threads.filter((t) => t.unread && t.bucket === "priority").length
  const calToday = ag.meetings.filter((m) => (m.start || "").slice(0, 10) === today).length
  const n0 = coach.nudges?.[0]
  const foco = n0 ? `${n0.subject}${n0.insight ? " — " + n0.insight : ""}` : "Día tranquilo. Nada urgente pide tu atención ahora."
  return { foco, counts: { messagesNew, urgent, calToday, coachN: (coach.nudges || []).length, newsN: 0 }, objetivos: ws.objetivos(), companies: ws.companies() }
}
