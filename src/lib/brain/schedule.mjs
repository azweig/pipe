// brain/schedule — calendario/agenda: huecos libres, intención de agendar, WRITES a Google/Outlook (createEvent/delete/move),
// agenda unificada + feriados, y calendarData (día/semana + KPIs). El helper de tiempo (parseCalTs/mtgWhen/catOf/resolveAttendee/
// durMin/mtgId) vive ACÁ y meetings lo importa (dep unidireccional). NOTA tz: _CAL_OFF/parseCalTs asumen Lima (quirk conocida, NO se toca acá).
import { existsSync, readFileSync, writeFileSync, statSync } from "fs"
import { ownerFirst, tz, tzOffset } from "../hub.mjs"
import { harden, fence } from "../safety.mjs"
import { llm } from "../llm.mjs"
import { detectSchedule, detectScheduleLLM } from "../intents.mjs"
import { threadMessagesTail as dbThreadMsgs, lastInboundName, getMeta } from "../db.mjs"
import { stripWA, initials } from "./kernel/keys.mjs"
import { jf } from "./kernel/contacts.mjs"
import { cardFor, fm } from "./kernel/vault.mjs"
import { j } from "./kernel/jsonl.mjs"
import { matchObjetivo } from "./kernel/objetivos.mjs"
import { coachData } from "./coach.mjs"
// threadTargets/resolvePerson son export function (hoisted) de brain → import top-level seguro; se LLAMAN solo en runtime (schedulePrefill/threadMeetings/resolveAttendee)
import { threadTargets, resolvePerson } from "../brain.mjs"

// ───────────────────────────────── código movido verbatim desde brain.mjs (M2) ─────────────────────────────────

function _calEvents() {
  const out = []
  for (const f of ["./data/calendar-google.jsonl", "./data/calendar.jsonl"]) {
    if (!existsSync(f)) continue
    for (const l of readFileSync(f, "utf8").split("\n")) { if (!l.trim()) continue; try { out.push(JSON.parse(l)) } catch {} }
  }
  return out
}
const _CAL_OFF = tzOffset() // Lima (sin DST). TODO: derivar del tz del usuario cuando viaja.
const _p2c = (n) => String(n).padStart(2, "0")
const _mkTs = (date, h, m) => Date.parse(`${date.year}-${_p2c(date.month)}-${_p2c(date.day)}T${_p2c(h)}:${_p2c(m)}:00${_CAL_OFF}`)
// huecos LIBRES: respeta horario laboral, aviso mínimo (no proponer algo inminente) y buffer entre reuniones (como Calendly).
export function freeSlots(date, durationMin = 30, { startHour = 9, endHour = 19, minNoticeH = 2, bufferMin = 10 } = {}) {
  const dayStart = _mkTs(date, startHour, 0), dayEnd = _mkTs(date, endHour, 0)
  const minStart = Date.now() + minNoticeH * 3600e3, buf = bufferMin * 60000
  const busy = []
  for (const e of _calEvents()) {
    if (e.allDay) continue
    const es = Date.parse(e.start), ee = Date.parse(e.end || e.start)
    if (!isNaN(es) && ee > dayStart && es < dayEnd) busy.push([es - buf, ee + buf]) // padding a cada lado
  }
  const free = []
  for (let h = startHour; h < endHour; h++) for (const m of [0, 30]) {
    const cs = _mkTs(date, h, m), ce = cs + durationMin * 60000
    if (ce > dayEnd || cs < minStart) continue // fuera de hora o demasiado pronto
    if (!busy.some(([es, ee]) => cs < ee && ce > es)) free.push({ hour: h, minute: m })
  }
  const buckets = [free.filter((s) => s.hour < 12), free.filter((s) => s.hour >= 12 && s.hour < 15), free.filter((s) => s.hour >= 15 && s.hour < 17), free.filter((s) => s.hour >= 17)]
  const pick = []
  for (const b of buckets) if (b.length && pick.length < 4) pick.push(b[0])
  for (const s of free) { if (pick.length >= 4) break; if (!pick.includes(s)) pick.push(s) }
  return pick.slice(0, 4).map((s) => ({ hour: s.hour, minute: s.minute, label: `${s.hour}:${_p2c(s.minute)}` }))
}
// eventos de un día (contexto para el modal: "ese día ya tenés…") — como la vista de día de Google Calendar.
export function dayEvents(date) {
  const d0 = _mkTs(date, 0, 0), d1 = _mkTs(date, 23, 59)
  const out = []
  for (const e of _calEvents()) {
    if (e.allDay) continue
    const es = Date.parse(e.start); if (isNaN(es) || es < d0 || es > d1) continue
    out.push({ title: e.title || "(sin título)", start: (e.start || "").slice(11, 16), end: (e.end || "").slice(11, 16) })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 8)
}
// ¿el horario elegido pisa con algo? (detección de conflictos, como Calendly/GCal)
export function conflictsAt(date, durationMin = 30) {
  const cs = _mkTs(date, date.hour, date.minute), ce = cs + durationMin * 60000
  const out = []
  for (const e of _calEvents()) {
    if (e.allDay) continue
    const es = Date.parse(e.start), ee = Date.parse(e.end || e.start)
    if (!isNaN(es) && cs < ee && ce > es) out.push({ title: e.title || "(sin título)", start: (e.start || "").slice(11, 16) })
  }
  return out
}

// llamada LLM barata para clasificar+extraer una intención de agenda (con el guardarraíl anti-injection)
async function _schedLLMCall(convo, refISO) {
  const sys = harden(`Determinás si el ÚLTIMO mensaje de una conversación propone, pide o PREGUNTA por coordinar una reunión, llamada, videollamada, café o encuentro — incluí preguntas de disponibilidad como "tenés tiempo el martes?", "cuándo podemos hablar?", "te viene bien esta semana?". Respondé SOLO JSON, nada más.`)
  const prompt = `Referencia temporal: ${refISO} (para resolver "mañana", "el martes", etc).\nConversación (el ÚLTIMO es el que importa):\n${fence(convo)}\n\nJSON: {"scheduling":true|false,"when":"el día/fecha como aparece o se infiere (ej: martes, mañana, 15 de julio) o null si no hay ninguno","time":"HH:MM 24h o null si no dice hora puntual","durationMin":30,"topic":"tema en 3-5 palabras o null"}`
  // CLOUD-OK: detección de scheduling es INTERACTIVA (tarjeta que el usuario ve al vuelo) y ve solo el hilo puntual, no el corpus.
  // Nube deliberada por latencia. Con GPU: LLM_CHAIN_ASK=ollama.
  return llm(prompt, { json: true, system: sys, chain: process.env.LLM_CHAIN_ASK || "gemini,ollama", temperature: 0 })
}

const _schedCache = new Map() // { key:lastTs → intent } para no re-llamar el LLM en cada poll de 6s
export async function scheduleIntent(key) {
  if (!key || key === "self") return { found: false }
  const msgs = dbThreadMsgs(key, { limit: 15 }) // threadMessagesTail: mismas filas (últimas 15) ya en orden cronológico
  let intent = detectSchedule(msgs) // 1) heurística barata (regex + chrono)
  if (!intent.found) {              // 2) LLM para frases relacionadas (gateado + cacheado por último ts)
    const lastTs = msgs.length ? msgs[msgs.length - 1].ts : 0
    const ck = `${key}:${lastTs}`
    if (_schedCache.has(ck)) intent = _schedCache.get(ck)
    else { intent = await detectScheduleLLM(msgs, _schedLLMCall).catch(() => ({ found: false })); if (_schedCache.size > 300) _schedCache.clear(); _schedCache.set(ck, intent) }
  }
  if (!intent.found) return { found: false }
  const out = { ...intent, ...schedulePrefill(key) }
  try {
    out.dayEvents = dayEvents(intent.date) // contexto: qué ya tenés ese día
    if (!intent.hasTime) out.suggestions = freeSlots(intent.date, intent.durationMin || 30, workHours()) // hora vaga → huecos libres (horario laboral config)
    else out.conflict = conflictsAt(intent.date, intent.durationMin || 30) // hora puntual → ¿pisa algo?
  } catch {}
  return out
}

// CREAR el evento del calendarizador (Meet/Teams) + borrador de confirmación EN LA VOZ de ${ownerFirst()}.
const _DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const _MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
function fmtWhen(d) {
  const dt = new Date(d.year, d.month - 1, d.day)
  const hora = d.minute ? `${d.hour}:${String(d.minute).padStart(2, "0")}` : `${d.hour}h`
  return `el ${_DIAS[dt.getDay()]} ${d.day} de ${_MESES[d.month - 1]} a las ${hora}`
}
export async function createSchedule({ key, date, durationMin = 30, title, platform = "meet", emails = [], calLabel = "personal", force = false, note = "" }) {
  if (!date || !title) return { error: "faltan datos (fecha y título)" }
  if (!force) { const conflict = conflictsAt(date, durationMin); if (conflict.length) return { conflict } } // avisa antes de pisar
  const { createEvent } = await import("../calendar.mjs")
  let ev
  try { ev = await createEvent({ platform, label: calLabel, summary: title, date, durationMin, attendees: emails, description: note, body: note }) }
  catch (e) { return { error: e.message } }
  saveSchedPref(key, { platform }) // recordar la plataforma usada con este contacto
  const when = fmtWhen(date), plat = platform === "teams" ? "Teams" : "Meet"
  let draft = `Listo, te agendé ${when} 👍 Te llega el invite al mail con el link de ${plat}.`
  try {
    const d = await llm(`Escribí en tu voz (${ownerFirst()}), español, natural y MUY breve (1 sola línea, sin comillas), confirmando que agendaste una reunión ${when} por ${plat} y que va el invite al mail.`,
      { system: harden(`Sos ${ownerFirst()} confirmando una reunión que acabás de agendar. Breve, humano, en tu voz, sin sonar a IA.`), chain: process.env.LLM_CHAIN_CATCHUP || "gemini,ollama", temperature: 0.5 })
      .then((s) => (s || "").trim().replace(/^["']|["']$/g, ""))
    if (d && d.length < 240) draft = d
  } catch {}
  return { ok: true, event: ev, draft, when, link: ev.link, cancel: { platform, label: ev.label || calLabel, id: ev.id } }
}
// cancelar/deshacer un evento creado (undo + detección de "cancelemos")
export async function cancelSchedule({ platform = "meet", label = "personal", id }) {
  if (!id) return { error: "sin id" }
  const cal = await import("../calendar.mjs")
  try { if (platform === "teams") await cal.deleteOutlookEvent(id); else await cal.deleteGoogleEvent(label, id); return { ok: true } }
  catch (e) { return { error: e.message } }
}
// reprogramar (mover) un evento a otra fecha/hora
export async function rescheduleSchedule({ id, label = "personal", date, durationMin = 30 }) {
  if (!id || !date) return { error: "faltan datos" }
  const cal = await import("../calendar.mjs")
  try { const ev = await cal.moveGoogleEvent(label, id, date, durationMin); return { ok: true, ...ev, when: fmtWhen(date) } }
  catch (e) { return { error: e.message } }
}
// próximas reuniones CON este contacto → tarjeta en el chat (ver/reprogramar/cancelar)
export async function threadMeetings(key) {
  if (!key || key === "self") return { meetings: [] }
  const emails = threadTargets(key).targets.filter((x) => x.channel === "email").map((x) => x.target)
  if (!emails.length) return { meetings: [] }
  try { const cal = await import("../calendar.mjs"); return { meetings: await cal.upcomingWith("personal", emails, 30) } }
  catch (e) { return { meetings: [], error: e.message } }
}

// preferencias de agenda por contacto (recordar plataforma usada, etc.)
const _SCHED_PREFS = "./data/schedule-prefs.json"
function schedPrefs() { try { return JSON.parse(readFileSync(_SCHED_PREFS, "utf8")) } catch { return {} } }
function saveSchedPref(key, patch) { if (!key) return; const p = schedPrefs(); p[key] = { ...(p[key] || {}), ...patch }; try { writeFileSync(_SCHED_PREFS, JSON.stringify(p)) } catch {} }
// horario laboral configurable (data/config.json: workStart/workEnd), default 9-19
function workHours() { try { const c = JSON.parse(readFileSync("./data/config.json", "utf8")); return { startHour: +c.workStart || 9, endHour: +c.workEnd || 19 } } catch { return { startHour: 9, endHour: 19 } } }
// prefill del modal (email resuelto + plataforma default + nombre) para una key dada
function schedulePrefill(key) {
  const emails = key ? threadTargets(key).targets.filter((x) => x.channel === "email").map((x) => x.target) : []
  const domain = (emails[0] || "").split("@")[1] || ""
  const pref = (schedPrefs()[key] || {})
  const platformDefault = pref.platform || (/outlook|office365|onmicrosoft|hotmail|live\.com|microsoft/.test(domain) ? "teams" : "meet")
  const last = key ? lastInboundName(key) : null
  return { emails, platformDefault, contactName: stripWA(last?.name || "") }
}
// DETECCIÓN EN VIVO sobre el texto que ${ownerFirst()} está TIPEANDO en el compositor (no sobre el historial).
export function detectScheduleText(key, text) {
  const intent = detectSchedule([{ text: text || "", dir: "out", ts: Date.now() }])
  if (!intent.found) return { found: false }
  return { ...intent, ...schedulePrefill(key) }
}

const CAL_LABEL = { outlook: "outlook", ventas: "ventas", personal: "personal" } // etiqueta de la fuente del evento (display); cae a m.account si no está mapeada
export function agenda() {
  const today = new Date().toISOString().slice(0, 10)
  const raw = [...j("calendar.jsonl"), ...j("calendar-google.jsonl")].filter((m) => (m.start || "") && (m.start || "").slice(0, 10) >= today)
  // DEDUP: el mismo evento invitado a varios calendarios/mails → uno solo, con la lista de fuentes
  const byKey = {}
  for (const m of raw) {
    const key = `${(m.title || "").toLowerCase().replace(/\s+/g, " ").trim()}|${(m.start || "").slice(0, 16)}`
    const src = CAL_LABEL[m.account] || m.account || "?"
    const e = byKey[key] || (byKey[key] = { title: m.title, start: m.start, end: m.end, allDay: !!m.allDay, location: m.location || "", url: m.meetingUrl || "", attendees: [], sources: new Set() })
    e.sources.add(src)
    if (m.meetingUrl && !e.url) e.url = m.meetingUrl
    if ((m.attendees || []).length > e.attendees.length) e.attendees = (m.attendees || []).slice(0, 10)
  }
  const meetings = Object.values(byKey)
    .map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, url: e.url, attendees: e.attendees, sources: [...e.sources], dup: e.sources.size }))
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
  const hol = jf("holidays.json") || {}
  const upcoming = []
  for (const c of Object.keys(hol)) for (const h of hol[c].holidays || []) if (h.date >= today) upcoming.push({ date: h.date, country: hol[c].country, code: c, name: h.localName })
  upcoming.sort((a, b) => a.date.localeCompare(b.date))
  return { meetings, holidays: upcoming.slice(0, 20) }
}

const _WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
export function scheduleSlots(t) {
  try {
    const intent = detectSchedule([{ text: t, dir: "out", ts: Date.now() }])
    if (!intent.found || !intent.date || intent.hasTime) return { slots: [] } // sin fecha, o ya dijo hora → nada que sugerir
    const d = intent.date
    const fs = freeSlots(d, intent.durationMin || 30, workHours())
    if (!fs.length) return { slots: [] }
    const dateISO = `${d.year}-${_p2c(d.month)}-${_p2c(d.day)}`
    const wd = _WD[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()]
    return { slots: fs.map((s) => ({ hour: s.hour, minute: s.minute, label: s.label, dateISO })), slotDay: `${wd} ${d.day}/${_p2c(d.month)}` }
  } catch { return { slots: [] } }
}

const CAT_DEF = [
  { cat: "viaje", label: "Viaje", icon: "✈️", color: "#3b9fd0", re: /\bvuelo\b|flight|viaje|aeropuerto|check-?in|boarding|lan\b|latam \d/i },
  { cat: "salud", label: "Salud", icon: "🩺", color: "#dc4c3e", re: /m[eé]dico|doctor|dentista|terapia|\bgym\b|salud|checkup|cl[íi]nic|kinesio|nutrici|psic[oó]log/i },
  { cat: "cita", label: "Cita", icon: "☕", color: "#e0662f", re: /caf[eé]|almuerzo|cena|lunch|dinner|coffee|1:1|1a1|catch ?up|desayuno/i },
  { cat: "evento", label: "Evento", icon: "🎉", color: "#c9a06a", re: /evento|fiesta|cumple|conferencia|meetup|demo day|webinar|\bacto\b|show|concierto|clase|taller/i },
  { cat: "personal", label: "Personal", icon: "🏠", color: "#16a34a", re: /personal|familia|casa|colegio|hijo/i },
  { cat: "trabajo", label: "Trabajo", icon: "💼", color: "#6366f1", re: /.*/ },
]
export const catOf = (m) => CAT_DEF.find((c) => c.re.test(`${m.title || ""} ${m.location || ""} ${(m.attendees || []).map((a) => (a && (a.email || a.name)) || a).join(" ")}`)) || CAT_DEF[CAT_DEF.length - 1]
export const mtgId = (m) => `${(m.title || "").toLowerCase()}|${(m.start || "").slice(0, 16)}`
// parseo de fecha de calendario: si el string NO trae timezone (Outlook manda "2026-07-08T15:00:00.0000000" naive),
// interpretarlo como hora LIMA — NO como la hora del server (Berlín/CEST), que corría el evento 7h y parecía duplicado.
export function parseCalTs(s) {
  if (!s) return NaN
  const str = String(s).replace(/\.\d+/, "")
  if (/[Zz]$|[+-]\d\d:?\d\d$/.test(str)) return Date.parse(str)
  return Date.parse(str + tzOffset())
}
export const durMin = (m) => { const s = parseCalTs(m.start), e = parseCalTs(m.end); return (s && e && e > s) ? Math.round((e - s) / 60000) : 30 }
// horas de display en Lima (para que backend y frontend muestren lo mismo, sin re-parsear con la tz del server)
export function mtgWhen(m) {
  const sMs = parseCalTs(m.start), eMs = parseCalTs(m.end)
  const fmtT = (ms) => ms ? new Date(ms).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz() }) : ""
  const dL = sMs ? new Date(sMs).toLocaleDateString("en-CA", { timeZone: tz() }) : ""
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz() })
  const dayLabel = !sMs ? "" : dL === today ? "Hoy" : new Date(sMs).toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "short", timeZone: tz() })
  return { startMs: sMs, endMs: eMs, t1: fmtT(sMs), t2: fmtT(eMs), dayLabel }
}
export function resolveAttendee(a) {
  const raw = (a && (a.name || a.email)) || a || ""
  const nm = String(raw).split("@")[0].trim()
  const canon = (resolvePerson(nm) || nm)
  const card = canon ? cardFor("People", canon) : ""
  const st = String((a && (a.status || a.responseStatus)) || "")
  return { name: canon || nm, email: (a && a.email) || (String(raw).includes("@") ? raw : ""), role: card ? fm(card, "role") : "", status: /accept|confirm|yes/i.test(st) ? "yes" : /decline|no/i.test(st) ? "no" : /tentat|maybe/i.test(st) ? "maybe" : "", initials: initials(canon || nm) }
}
// PRE-GENERA la tarjeta de cada evento próximo (categoría, asistentes+roles, objetivo, prep con IA). Corre en cron / al sincronizar calendario.

// AGREGADOR de la vista de calendario (día/semana) con KPIs reales — barato, se calcula en vivo
// PRÓXIMA REUNIÓN + cuánto falta. Tener la agenda no sirve de nada si hay que ir a buscarla: lo que uno quiere
// saber, sin abrir nada, es cuánto tiempo le queda. Mira los próximos 14 días y devuelve la primera que no empezó.
export function proximaReunion(ahora = Date.now()) {
  const dias = []
  for (let i = 0; i < 14; i++) dias.push(new Date(ahora + i * 86400000).toISOString().slice(0, 10))
  let mejor = null
  for (const d of dias) {
    let ev = []
    try { ev = (calendarData("dia", d) || {}).events || [] } catch { continue }
    for (const e of ev) {
      const ini = e.startMs || 0
      if (!ini || ini <= ahora) continue
      if (!mejor || ini < mejor.startMs) mejor = e
    }
    if (mejor) break // el primer día con algo futuro ya trae la más próxima
  }
  if (!mejor) return null
  const faltanMin = Math.round((mejor.startMs - ahora) / 60000)
  return {
    id: mejor.id, title: mejor.title, startMs: mejor.startMs, endMs: mejor.endMs || 0,
    cat: mejor.cat || "", faltanMin,
    // texto listo para mostrar: "en 25 min", "en 3 h 10", "mañana 09:00", "el vie 09:00"
    cuando: textoFalta(faltanMin, mejor.startMs),
    enCurso: !!(mejor.endMs && mejor.endMs > ahora && mejor.startMs <= ahora),
  }
}
function textoFalta(min, startMs) {
  if (min < 1) return "ahora"
  if (min < 60) return `en ${min} min`
  if (min < 12 * 60) { const h = Math.floor(min / 60), m = min % 60; return `en ${h} h${m ? " " + m : ""}` }
  // TODO en la zona del usuario, no la del servidor. El server está en Europa y el mismo evento se veía a las
  // 16:00 en vez de las 09:00. Y "mañana" se decide por DÍA DE CALENDARIO, no por horas: faltando 40 h decía
  // "mañana" cuando en realidad era pasado.
  const z = tz()
  const hora = new Date(startMs).toLocaleTimeString("es-PE", { timeZone: z, hour: "2-digit", minute: "2-digit", hour12: false })
  const dia = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: z })
  const hoy = dia(Date.now()), manana = dia(Date.now() + 86400000), cuando = dia(startMs)
  if (cuando === hoy) return `hoy ${hora}`
  if (cuando === manana) return `mañana ${hora}`
  return `el ${new Date(startMs).toLocaleDateString("es-PE", { timeZone: z, weekday: "short", day: "numeric" })} ${hora}`
}

export function calendarData(view = "dia", dateISO) {
  const ag = agenda(), objetivos = jf("objetivos.json") || []
  const OFF = tzOffset(), p2 = (n) => String(n).padStart(2, "0")
  const base = dateISO ? new Date(dateISO + "T12:00:00" + OFF) : new Date()
  const dayStr = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  const mon = new Date(base); mon.setDate(base.getDate() - ((base.getDay() + 6) % 7)) // lunes de la semana
  const isWeek = view !== "dia"
  const days = []
  const span = isWeek ? (view === "laboral" ? 5 : 7) : 1
  const start0 = isWeek ? mon : base
  for (let i = 0; i < span; i++) { const d = new Date(start0); d.setDate(start0.getDate() + i); days.push(dayStr(d)) }
  const fmtL = (ms) => ms ? new Date(ms).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz() }) : ""
  const dayL = (ms) => ms ? new Date(ms).toLocaleDateString("en-CA", { timeZone: tz() }) : "" // YYYY-MM-DD en hora Lima
  const inRange = (m) => days.includes(dayL(parseCalTs(m.start)))
  const evs = ag.meetings.filter((m) => (m.start || "").length >= 16 && inRange(m) && !m.allDay).map((m) => {
    const c = catOf(m), raw = getMeta("mtgcard:" + mtgId(m)); let cardObj = null; if (raw) { try { cardObj = JSON.parse(raw) } catch {} }
    return { id: mtgId(m), title: m.title, day: dayL(parseCalTs(m.start)), t1: fmtL(parseCalTs(m.start)), t2: fmtL(parseCalTs(m.end)),
      startMs: parseCalTs(m.start), endMs: parseCalTs(m.end) || (parseCalTs(m.start) + 30 * 60000), durationMin: durMin(m),
      cat: c.cat, catLabel: c.label, icon: c.icon, color: c.color, location: m.location || "", url: m.url || "", sources: m.sources || [],
      attendees: (cardObj?.attendees || (m.attendees || []).map((a) => ({ name: (a && (a.name || a.email)) || a, initials: initials((a && (a.name || a.email)) || a) }))).slice(0, 5),
      nAtt: (m.attendees || []).length, objetivo: cardObj?.objetivo || matchObjetivo(m, objetivos), prepReady: !!cardObj?.prep }
  }).sort((a, b) => a.startMs - b.startMs)
  // solapamientos
  let overlaps = 0
  for (let i = 0; i < evs.length; i++) for (let k = i + 1; k < evs.length; k++) if (evs[i].day === evs[k].day && evs[i].startMs < evs[k].endMs && evs[k].startMs < evs[i].endMs) overlaps++
  // horas libres + mejor hueco (en horario laboral 9-19 por día)
  const cfg = (jf("config.json") || {}), h0 = +cfg.workStart || 9, h1 = +cfg.workEnd || 19
  let busyMin = 0, bestGapStart = null, bestGapLen = 0
  for (const day of days) {
    const de = evs.filter((e) => e.day === day).sort((a, b) => a.startMs - b.startMs)
    const dayStart = Date.parse(day + "T" + p2(h0) + ":00:00" + OFF), dayEnd = Date.parse(day + "T" + p2(h1) + ":00:00" + OFF)
    let cursor = dayStart
    for (const e of de) { const s = Math.max(e.startMs, dayStart), en = Math.min(e.endMs, dayEnd); if (en > s) busyMin += (en - s) / 60000; if (s - cursor > bestGapLen && s > cursor) { bestGapLen = s - cursor; bestGapStart = cursor } cursor = Math.max(cursor, en) }
    if (dayEnd - cursor > bestGapLen) { bestGapLen = dayEnd - cursor; bestGapStart = cursor }
  }
  const workMin = span * (h1 - h0) * 60, freeH = Math.max(0, Math.round((workMin - busyMin) / 60))
  // breakdown por categoría (horas)
  const byCat = {}; for (const e of evs) byCat[e.cat] = (byCat[e.cat] || 0) + e.durationMin
  const catBars = CAT_DEF.filter((c) => byCat[c.cat]).map((c) => ({ cat: c.cat, label: c.label, color: c.color, h: +(byCat[c.cat] / 60).toFixed(1) })).sort((a, b) => b.h - a.h)
  // KPIs
  const busiest = (() => { const per = {}; for (const e of evs) per[e.day] = (per[e.day] || 0) + e.durationMin; const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0]; return top ? top[0] : null })()
  const bestGapHH = bestGapStart && bestGapLen >= 30 * 60000 ? new Date(bestGapStart).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz() }) : null
  const kpiObjetivos = evs.filter((e) => e.objetivo).length
  // PRÓXIMO evento (global, no solo del rango visible) + sugerencia del coach → para el empty-state del calendario ("faltan X días…")
  const nowMs = Date.now(), todayL = dayL(nowMs)
  const nx = ag.meetings.filter((m) => (m.start || "").length >= 16 && !m.allDay && parseCalTs(m.start) > nowMs)
    .map((m) => ({ m, s: parseCalTs(m.start) })).sort((a, b) => a.s - b.s)[0]
  let nextEvent = null
  if (nx) {
    const c = catOf(nx.m), evDay = dayL(nx.s)
    const daysAway = Math.round((Date.parse(evDay + "T12:00:00" + OFF) - Date.parse(todayL + "T12:00:00" + OFF)) / 86400000)
    nextEvent = { title: nx.m.title, startMs: nx.s, day: evDay, t1: fmtL(nx.s), icon: c.icon, color: c.color, catLabel: c.label, daysAway,
      when: new Date(nx.s).toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: tz() }),
      attendees: (nx.m.attendees || []).map((a) => (a && (a.name || a.email)) || a).filter(Boolean).slice(0, 3) }
  }
  let coachSuggest = null // sugerencia grounded del coach (cacheada 5min) → "deberías agendar con…"
  try { const cd = coachData(); const top = Array.isArray(cd) ? cd[0] : (cd && (cd.items ? cd.items[0] : (cd.text ? cd : null))); if (top) coachSuggest = { text: top.subject || top.text || top.insight || "", name: top.name || "", convKey: top.convKey || top.key || null } } catch {}
  return {
    view, days, today: dayStr(new Date()), base: dayStr(base),
    events: evs, nextEvent, coachSuggest,
    kpis: { count: evs.length, freeH, overlaps, busyH: +(busyMin / 60).toFixed(1), catBars, bestGap: bestGapHH, kpiObjetivos, busiest, pctWork: Math.round((byCat.trabajo || 0) / Math.max(1, Object.values(byCat).reduce((a, v) => a + v, 0)) * 100) },
  }
}
