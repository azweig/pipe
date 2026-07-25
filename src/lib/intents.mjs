// Motor de intenciones — Fase 1: detección de "agendar reunión" desde el chat.
// Trivial-first: heurística barata + chrono (fechas en español). Lee contenido HOSTIL de terceros →
// NUNCA ejecuta nada, solo devuelve datos ESTRUCTURADOS (fecha en componentes, sin instrucciones libres).
import * as chrono from "chrono-node"

// stems con \b SOLO al inicio (el \b de cierre rompía "agend|emos", "coordin|emos", "llamad|a"…). Se filtra igual
// porque además exige una FECHA parseable, y el humano confirma en el modal.
const CUE = /\b(agend|reu|coordin|llamad|videollamad|junt[ae]|hangout|encontr[ae]|nos vemos|verte|vernos|cita|meet|call|zoom|teams)/i
const NEG = /\b(no puedo|no llego|no va a poder|cancel|reprogram|posterg|otro d[ií]a|no me sirve|ya no|despu[eé]s vemos)/i

// Devuelve la fecha como COMPONENTES (year/month/day/hour/minute), no como instante UTC: el evento se crea
// después con timeZone explícito → evita el clásico bug de timezone (el owner viaja). El humano confirma en el modal.
export function detectSchedule(messages, { now = Date.now() } = {}) {
  const recent = (messages || []).filter((m) => (m.text || "").trim().length > 2).slice(-15)
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i], text = String(m.text)
    if (!CUE.test(text) || NEG.test(text)) continue
    let r
    try { r = chrono.es.parse(text, new Date(now), { forwardDate: true })[0] } catch { continue }
    if (!r) continue
    const g = (k, d) => { const v = r.start.get(k); return v == null ? d : v }
    const year = g("year"), month = g("month"), day = g("day")
    if (!year || !month || !day) continue
    const hasTime = r.start.isCertain("hour")
    const hour = g("hour", 9), minute = g("minute", 0)
    const when = new Date(year, month - 1, day, hour, minute) // solo para el chequeo de ventana (aprox local)
    if (when.getTime() < now - 6 * 3600e3 || when.getTime() > now + 120 * 86400e3) continue // futuro y < 120 días
    let durationMin = 30
    if (r.end && r.end.isCertain("hour")) {
      const eh = r.end.get("hour"), em = r.end.get("minute") || 0
      const d = (eh * 60 + em) - (hour * 60 + minute)
      if (d > 0 && d <= 480) durationMin = d
    }
    return {
      found: true, type: "schedule_meeting",
      date: { year, month, day, hour, minute }, hasTime, durationMin,
      matched: r.text, sourceText: text.slice(0, 240),
      who: m.dir === "out" ? "vos" : (m.name || "el contacto"), ts: m.ts,
    }
  }
  return { found: false }
}

// parsea una frase de fecha/hora (español) → componentes. Reusado por el detector LLM.
export function parsePhrase(text, { now = Date.now() } = {}) {
  let r
  try { r = chrono.es.parse(String(text || ""), new Date(now), { forwardDate: true })[0] } catch { return null }
  if (!r) return null
  const g = (k, d) => { const v = r.start.get(k); return v == null ? d : v }
  const year = g("year"), month = g("month"), day = g("day")
  if (!year || !month || !day) return null
  const hasTime = r.start.isCertain("hour")
  const hour = g("hour", 9), minute = g("minute", 0)
  const when = new Date(year, month - 1, day, hour, minute)
  if (when.getTime() < now - 6 * 3600e3 || when.getTime() > now + 120 * 86400e3) return null
  let durationMin = 30
  if (r.end && r.end.isCertain("hour")) { const d = (r.end.get("hour") * 60 + (r.end.get("minute") || 0)) - (hour * 60 + minute); if (d > 0 && d <= 480) durationMin = d }
  return { date: { year, month, day, hour, minute }, hasTime, durationMin }
}

// señal DÉBIL: cualquier pista temporal/de disponibilidad → recién ahí vale la pena gastar el LLM
const WEAK = /\b(lun|mar|mi[eé]rc|mierc|juev|jue|vier|vie|s[aá]b|dom|mañana|hoy|pasado|semana|finde|fin de semana|tiempo|hora|cu[aá]ndo|dispon|libre|podr?[eé]s|puedo|te va|te queda|te viene|junt|vern?os|reun|call|caf[eé]|almor|desayun|agend|coordin|vemos)\b/i
export function hasWeakSignal(t) { return WEAK.test(String(t || "")) }

// DETECTOR LLM (para frases relacionadas que el regex no agarra, ej: "tenés tiempo el martes?").
// llmFn(convoTexto, refISO) → debe devolver { scheduling, when, time, durationMin, topic }. Gateado por señal débil.
export async function detectScheduleLLM(messages, llmFn, { now = Date.now() } = {}) {
  const recent = (messages || []).filter((m) => (m.text || "").trim().length > 2).slice(-6)
  if (!recent.length) return { found: false }
  const last = recent[recent.length - 1]
  if (!recent.some((m) => hasWeakSignal(m.text))) return { found: false } // sin ninguna pista → no gastes LLM
  const convo = recent.map((m) => `${m.dir === "out" ? "YO" : (m.name || "OTRO")}: ${m.text}`).join("\n")
  let out
  try { out = await llmFn(convo, new Date(now).toISOString().slice(0, 16)) } catch { return { found: false } }
  if (!out || !out.scheduling || !out.when) return { found: false }
  const parsed = parsePhrase(`${out.when}${out.time ? " " + out.time : ""}`, { now })
  if (!parsed) return { found: false }
  return {
    found: true, type: "schedule_meeting",
    date: parsed.date, hasTime: parsed.hasTime || !!out.time, durationMin: out.durationMin || parsed.durationMin || 30,
    matched: `${out.when}${out.time ? " " + out.time : ""}`, sourceText: String(last.text).slice(0, 240),
    who: last.dir === "out" ? "vos" : (last.name || "el contacto"), ts: last.ts, topic: out.topic || "", viaLLM: true,
  }
}
