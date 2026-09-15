// brain/home — COMPOSICIÓN de la UI (dashboard/home). Unidireccional: importa lecturas de inbox + coach + schedule
// y las agrega. No tiene lógica de dominio propia; solo junta. Último eslabón del split (candidato #2).
import { listThreads } from "./inbox.mjs"
import { coachData } from "./coach.mjs"
import { agenda } from "./schedule.mjs"
import { peopleNodes, companyNodes } from "./kernel/vault.mjs"
import { getMeta } from "../db.mjs"
import { secretGate } from "../secret.mjs" // 🔒 el dashboard en vivo no cuenta ni muestra hilos secretos sin 2º PIN
import { readFileSync } from "node:fs"
import * as _pend from "../home-pendientes.mjs" // reglas de respaldo si el cron todavía no corrió
import * as hub from "../hub.mjs"
import { proximaProgramada } from "../home-horario.mjs"

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
  // El resumen de acciones se agrega SIEMPRE, venga el snapshot del cron o se arme en vivo: vive en su propio
  // archivo con su propio ritmo, y colgarlo del snapshot de la Home lo habría dejado invisible hasta el próximo
  // cron de 4×día. (Así pasó: la tarjeta no aparecía aunque el cron ya la hubiera generado.)
  const raw = getMeta("home_brief")
  if (raw) { try { const s = JSON.parse(raw); if (s && s.generatedAt) return { ...s, resumen: resumenAcciones() } } catch {} }
  const d = await homeData(ws) // aún no corrió el cron → devolvé lo básico en vivo (la UI lo tolera)
  return { generatedAt: 0, resumen: d.resumen, brief: { text: d.foco, audioSec: 0 }, foco: null, agenda: [], bandeja: { important: d.counts?.urgent || 0, items: [] }, kpis: [], news: [], coach: null, objetivos: d.objetivos || [], companies: d.companies || [] }
}
// Resumen de acciones: se calcula en un cron y se guarda; la Home lo LEE. Nunca se genera en el pedido del usuario
// —el modelo local llegó a tardar 233s por cola— y si no hay archivo, cae a las reglas, que son instantáneas.
export function resumenAcciones() {
  const horas = hub.homeHoras(), tz = hub.tz()
  try {
    const j = JSON.parse(readFileSync("./data/home-acciones.json", "utf8"))
    // El archivo es la FOTO de la última corrida programada, así que vale hasta la próxima aunque falten horas: con
    // dos corridas al día, un vencimiento fijo de 6h dejaba la mitad del día cayendo a reglas y perdiendo el texto.
    // El único caso en que se descarta es "el daemon lleva días muerto": ahí es más honesto recalcular con reglas.
    if (Date.now() - (j.ts || 0) < 3 * 86400000) return { ...j, horas, proxima: proximaProgramada(Date.now(), horas, tz) }
  } catch {}
  try { return { ...require_reglas(), horas, proxima: proximaProgramada(Date.now(), horas, tz) } } catch { return null }
}
function require_reglas() {
  const { pendientes } = _pend
  const { pendientes: pend, cerrados, n } = pendientes({ limite: 6 })
  const canalEs = (c) => (c === "email" ? "correo" : c === "whatsapp" ? "WhatsApp" : c || "mensaje")
  const diasEs = (d) => (d < 1 ? "hoy" : d < 2 ? "ayer" : Math.round(d) + " días")
  const V = { PLATA: "Pagá", PLAZO: "Resolvé", PERSONA: "Respondé a", OTRO: "Revisá" }
  return { acciones: pend.map((x) => `${V[x.tipo] || "Revisá"} ${x.quien}: ${x.asunto.slice(0, 70)} (${canalEs(x.canal)}, ${diasEs(x.dias)})`),
           items: pend.map((x) => ({ tipo: x.tipo, quien: x.quien, canal: x.canal, dias: x.dias, thread: x.thread, asunto: x.asunto })),
           cerrados: cerrados.map((c) => c.quien).filter(Boolean).slice(0, 6), n, fuente: "reglas", ts: Date.now() }
}

export async function homeData(ws) {
  const threads = _gate(listThreads({ limit: 300 })), ag = agenda(), coach = coachData()
  const today = new Date().toISOString().slice(0, 10)
  const messagesNew = threads.reduce((a, t) => a + (t.unread || 0), 0)
  const urgent = threads.filter((t) => t.unread && t.bucket === "priority").length
  const calToday = ag.meetings.filter((m) => (m.start || "").slice(0, 10) === today).length
  const n0 = coach.nudges?.[0]
  const foco = n0 ? `${n0.subject}${n0.insight ? " — " + n0.insight : ""}` : "Día tranquilo. Nada urgente pide tu atención ahora."
  const resumen = resumenAcciones()
  return { foco, resumen, counts: { messagesNew, urgent, calToday, coachN: (coach.nudges || []).length, newsN: 0, pendientes: resumen?.n?.pend || 0, cerrados: resumen?.n?.cerrados || 0 }, objetivos: ws.objetivos(), companies: ws.companies() }
}
