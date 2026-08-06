// GENERADOR DE LA HOME (cron cada 6h). TODO dinámico: sale de los módulos reales (mensajes, calendario, coach, objetivos, noticias).
// Escribe un snapshot en meta['home_brief'] (JSON) + audio TTS en data/home-brief.mp3. La UI solo lee el snapshot → carga instantánea.
import { writeFileSync } from "fs"
import { tz, ownerFirst } from "./lib/hub.mjs"
import { setBusyTimeout, upsertMetric, metricHistory, messagesForResponseRate, activeOutboundThreads, recentCalls, openActionItems, setMeta } from "./lib/db.mjs"
import { listThreads, agenda, coachData } from "./lib/brain.mjs"
import { secretGate } from "./lib/secret.mjs" // 🔒 la Home (cron, sin 2º PIN) no hornea nada de fuente secreta
import { llm } from "./lib/llm.mjs"
import { tts } from "./lib/voice.mjs"
import { newsSearch, hasWebSearch } from "./lib/research.mjs"
import * as ws from "./lib/workspace.mjs"

const DAY = 86400000
const p2 = (n) => String(n).padStart(2, "0")
const isGroupKey = (k) => /@g\.us|@thread\.v2|@newsletter|@broadcast/.test(k) || /^whatsapp:!/.test(k)

// franja del día (hora Lima) → la Home cambia de ángulo en cada regeneración (mañana/mediodía/tarde/noche)
function limaPeriod() {
  const h = +new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: tz() }).slice(0, 2)
  if (h < 12) return { id: "manana", label: "arranque del día", ang: "Enfocá en qué ATACAR hoy y cómo ordenar el día." }
  if (h < 15) return { id: "mediodia", label: "mediodía", ang: "Enfocá en lo que quedó SIN RESPONDER y lo pendiente." }
  if (h < 20) return { id: "tarde", label: "cierre laboral", ang: "Enfocá en qué CERRAR antes de terminar el día." }
  return { id: "noche", label: "cierre del día", ang: "Hacé un cierre — qué se avanzó, qué queda para mañana — y bajá revoluciones." }
}

// ── tabla de métricas (historia diaria) para deltas REALES de los KPIs — el esquema lo crea db-core/initSchema ──
function recordMetric(metric, value) {
  const day = new Date().toISOString().slice(0, 10)
  upsertMetric(metric, day, value)
}
// delta % vs el valor de hace ~7 días (o el más viejo que haya). null si no hay historia.
function deltaOf(metric, current) {
  const rows = metricHistory(metric)
  if (rows.length < 2) return null
  const past = rows[rows.length - 1].value
  if (!past) return null
  return Math.round(((current - past) / Math.abs(past)) * 100)
}

// ── KPIs reales (de lo que sabe el sistema) ──
function computeKpis(threads) {
  const now = Date.now(), since7 = now - 7 * DAY, since14 = now - 14 * DAY
  const kpis = []

  // 1) Respuestas <24h: SOLO conversaciones de mensajería 1:1 (NO email — la mayoría son newsletters que nunca se responden).
  let respPct = null
  try {
    const rows = messagesForResponseRate(since14)
    const byT = {}
    for (const r of rows) (byT[r.thread] ||= []).push(r)
    let elig = 0, replied = 0
    for (const msgs of Object.values(byT)) {
      let lastIn = null
      for (const m of msgs) {
        if (m.dir === "in") lastIn = m.ts
        else if (m.dir === "out" && lastIn && m.ts >= lastIn) { if (m.ts - lastIn <= DAY) { /* respondido rápido */ } lastIn = null }
      }
      // recomputar limpio: último entrante que ya cumplió 24h y si hubo salida <24h
      let li = null, ok = false, counted = false
      for (const m of msgs) {
        if (m.dir === "in") { li = m.ts; ok = false }
        else if (m.dir === "out" && li) { if (m.ts - li <= DAY) ok = true; }
      }
      if (li && (now - li) >= DAY) { elig++; if (ok) replied++; counted = true }
    }
    if (elig >= 3) { respPct = Math.round((replied / elig) * 100); recordMetric("resp24", respPct) }
  } catch {}
  if (respPct != null) kpis.push({ cat: "LABORAL", label: "Respuestas <24h", value: respPct + "%", pct: respPct, delta: deltaOf("resp24", respPct), goodUp: true })

  // 2) Contactos activos (7d): DMs distintos a los que escribí
  let activos = 0
  try { activos = activeOutboundThreads(since7) } catch {}
  recordMetric("activos", activos)
  kpis.push({ cat: "PERSONAL", label: "Contactos activos", value: String(activos), pct: Math.min(100, activos * 4), delta: deltaOf("activos", activos), goodUp: true })

  // 3) Importantes pendientes (menos es mejor)
  const imp = threads.filter((t) => t.unseen && /trabajo|priority/.test(t.bucket || "")).length
  recordMetric("importantes", imp)
  kpis.push({ cat: "LABORAL", label: "Importantes pendientes", value: String(imp), pct: Math.min(100, imp * 8), delta: deltaOf("importantes", imp), goodUp: false })

  // 4) Sin leer PERSONALES (no email): el total está dominado por newsletters → engañoso. Contamos mensajería real.
  const personalUnread = threads.filter((t) => !/^email:/.test(t.key || "")).reduce((a, t) => a + (t.unread || 0), 0)
  recordMetric("sinleer_personal", personalUnread)
  kpis.push({ cat: "PERSONAL", label: "Sin leer (personales)", value: String(personalUnread), pct: Math.min(100, personalUnread * 2), delta: deltaOf("sinleer_personal", personalUnread), goodUp: false })

  return kpis
}

// ── foco de hoy: SOLO datos reales de la DB (nunca el coach, que alucina gaps). Prioridad: quien te escribió y espera respuesta ──
const isPersonThread = (t) => !t.group && t.key !== "self" && t.bucket !== "spam" && t.name && t.lastText && !/status@broadcast|@newsletter/.test(t.key || "")
function computeFoco(threads) {
  const now = Date.now()
  const person = threads.filter(isPersonThread).map((t) => ({ ...t, gap: Math.floor((now - (t.ts || now)) / DAY) }))
  // 1) alguien te escribió y NO respondiste (lastDir='in' + sin ver): eso es lo accionable HOY. Prioriza trabajo, luego más reciente.
  const waiting = person.filter((t) => t.lastDir === "in" && t.unseen)
    .sort((a, b) => (/(trabajo)/.test(b.bucket || "") - /(trabajo)/.test(a.bucket || "")) || (b.ts - a.ts))
  if (waiting[0]) {
    const t = waiting[0]
    const r = t.gap <= 0 ? "Te escribió hoy · esperando tu respuesta" : `Te escribió hace ${t.gap} día${t.gap === 1 ? "" : "s"} · esperando respuesta`
    return { name: t.name, key: t.key, channels: t.channels || [], photo: t.photo || null, tags: [], reason: r, relevant: "" }
  }
  // 2) si nadie espera: reconectar con un contacto de trabajo GENUINAMENTE dormido (gap real ≥ 45 días)
  const stale = person.filter((t) => /(trabajo)/.test(t.bucket || "") && t.gap >= 45).sort((a, b) => b.gap - a.gap)
  if (stale[0]) { const t = stale[0]; return { name: t.name, key: t.key, channels: t.channels || [], photo: t.photo || null, tags: [], reason: `Sin contacto hace ${t.gap} días`, relevant: "" } }
  return null
}

// ── COLA "necesitan respuesta": TODOS los que te escribieron y no respondiste (no solo uno) ──
function computeWaiting(threads, limit = 6) {
  const now = Date.now()
  return threads.filter(isPersonThread)
    .map((t) => ({ ...t, gap: Math.floor((now - (t.ts || now)) / DAY) }))
    .filter((t) => t.lastDir === "in" && t.unseen)
    .sort((a, b) => (/(trabajo)/.test(b.bucket || "") - /(trabajo)/.test(a.bucket || "")) || (b.ts - a.ts))
    .slice(0, limit)
    .map((t) => ({ name: t.name, key: t.key, channels: t.channels || [], photo: t.photo || null,
      preview: (t.lastText || "").slice(0, 70), work: /(trabajo)/.test(t.bucket || ""),
      reason: t.gap <= 0 ? "hoy" : `hace ${t.gap}d` }))
}

// ── LLAMADAS de WhatsApp entrantes/perdidas de las últimas 24h (marcadas por el reader con mediaType='call') ──
function computeCalls() {
  try {
    const rows = recentCalls(Date.now() - DAY)
    const byT = new Map()
    for (const r of rows) { const c = byT.get(r.thread) || { name: (r.name || "").replace(/\s*\(WA\)$/, ""), key: r.thread, ts: 0, n: 0, missed: false }; c.n++; c.ts = Math.max(c.ts, r.ts); if (/perdida/i.test(r.text || "")) c.missed = true; byT.set(r.thread, c) }
    return [...byT.values()].sort((a, b) => b.ts - a.ts).slice(0, 5)
  } catch { return [] }
}

// ── to-dos + promesas abiertas (las llena el cron extract-actions) ──
function openActions() {
  return { todos: openActionItems("todos"), promesas: openActionItems("promesas") }
}

// ── noticias "Para vos": por SECTOR/tema (fiable). NO por nombre de empresa: para una startup de nicho, Google News
// devuelve homónimos equivocados (otra empresa con el mismo nombre) → peor que nada. Los temas salen de las empresas que seguís + defaults.
async function computeNews() {
  if (!hasWebSearch()) return []
  const out = []
  const topics = [
    { tag: "FINTECH · LATAM", q: "fintech LATAM ronda inversión startup noticias" },
    { tag: "IA · AGENTES", q: "agentes de IA empresas negocios noticias" },
    { tag: "STARTUPS · PERÚ", q: "startups Perú tecnología inversión noticias" },
  ]
  for (const { tag, q } of topics) {
    if (out.length >= 3) break
    try {
      const news = await newsSearch(q, { num: 2 })
      const n = news.find((x) => x.title && !out.some((o) => o.title === x.title))
      if (n) out.push({ tag, title: n.title, source: n.source, ago: n.date, url: n.link, img: n.img })
    } catch {}
  }
  return out
}

// ── prosa "tu día en breve" (LLM) + audio — SÍNTESIS, no inventario. Cambia de ángulo según la franja horaria ──
async function computeBrief(facts, period) {
  const prompt = `Sos el asistente de ${ownerFirst()}. Con estos datos de HOY, escribí un briefing corto (2-3 oraciones, máx 55 palabras) en español rioplatense, directo y humano.
${period.ang}
CLAVE: NO enumeres los eventos, ni cuántos sin leer, ni los KPIs — eso ya lo ve en tarjetas aparte. En vez de listar, SINTETIZÁ: dá la lectura del día, conectá lo que importa y señalá LA cosa a la que apuntar ahora. Como un jefe de gabinete que te da el pulso, no un locutor que lee una lista.
Nada de saludos ("hola"), nada de listas ni bullets: prosa fluida. NO inventes datos.
NUNCA digas qué hora ni qué franja del día es ("es mediodía", "de mañana", "a esta hora"): el briefing se genera cada tanto y se puede leer más tarde → quedaría desactualizado.
DATOS (materia prima, NO para copiar textual):
${facts}
Devolvé SOLO el texto del briefing.`
  let text = ""
  try { text = (await llm(prompt, { chain: process.env.LLM_CHAIN_CORRECT || "openai,ollama", numPredict: 180, temperature: 0.4 })).trim() } catch {}
  if (!text) text = facts.split("\n")[0] || "Día tranquilo. Nada urgente pide tu atención ahora."
  let audioSec = 0
  try {
    const buf = await tts(text)
    writeFileSync("./data/home-brief.mp3", buf)
    audioSec = Math.max(20, Math.round(text.split(/\s+/).length / 2.4)) // ~145 wpm
  } catch {}
  return { text, audioSec }
}

export async function generateHomeBrief() {
  const t0 = Date.now()
  try { setBusyTimeout(8000) } catch {} // esperar el lock del server en vez de fallar (SQLITE_BUSY)
  let threads = listThreads({ limit: 400 })
  // 🔒 igual que /api/threads pero SIN 2º PIN (el cron nunca tiene sesión): saca hilos 100%-secretos y parcha el preview de los parciales
  const _g = secretGate()
  if (_g.any) threads = threads.filter((t) => !_g.hide.has(t.key)).map((t) => { const p = _g.preview.get(t.key); return p ? { ...t, lastText: (p.text || "").slice(0, 120), ts: p.ts } : t })
  const ag = agenda()
  const coach = coachData()
  const today = new Date().toISOString().slice(0, 10)

  // agenda de hoy
  const agToday = ag.meetings.filter((m) => (m.start || "").slice(0, 10) === today).map((m) => {
    const s = new Date(m.start), e = m.end ? new Date(m.end) : null
    const durMin = e ? Math.round((e - s) / 60000) : 0
    const attn = (m.attendees || []).length
    const via = (m.sources || [])[0] || (m.url ? "Meet" : "")
    return { time: `${p2(s.getHours())}:${p2(s.getMinutes())}`, dur: durMin ? (durMin >= 60 ? `${(durMin / 60).toFixed(durMin % 60 ? 1 : 0)} h` : `${durMin} min`) : "", title: m.title || "(sin título)", sub: [via, attn ? `${attn} personas` : ""].filter(Boolean).join(" · "), url: m.url || "" }
  })

  // bandeja: importantes sin ver
  const impThreads = threads.filter((t) => t.unseen && /trabajo|priority/.test(t.bucket || "") && t.name)
  const bandeja = {
    important: impThreads.length,
    items: impThreads.slice(0, 4).map((t) => ({ name: t.name, key: t.key, channels: t.channels || [], preview: (t.lastText || "").slice(0, 60), unseen: !!t.unseen, photo: t.photo || null })),
  }

  const kpis = computeKpis(threads)
  const foco = computeFoco(threads)
  const waiting = computeWaiting(threads)
  const calls = computeCalls()
  const { todos, promesas } = openActions()
  const objetivos = (() => { try { return (ws.objetivos() || []).map((o) => ({ id: o.id, title: o.title || o.name, horizon: o.horizon || o.plazo || "", progress: o.progress != null ? o.progress : null, target: o.target != null ? o.target : null, next: o.next || o.siguiente || "" })) } catch { return [] } })()
  const period = limaPeriod()
  const news = await computeNews()

  // coach: una sugerencia que NO duplique el foco (si no, sale Anace 3 veces). Descartá gaps alucinados (>365 días sin evidencia).
  const focoName = (foco?.name || "").toLowerCase()
  const n0 = (coach.nudges || []).find((n) => {
    if (!n.subject || !n.insight) return false // nudge malformado (sin datos) → descartar
    if (n.convKey && _g.hide.has(n.convKey)) return false // 🔒 nudge de un hilo 100%-secreto → nunca en la Home
    const s = (n.subject || "").toLowerCase()
    if (focoName && s.includes(focoName.split(" ")[0])) return false // mismo contacto que el foco → no repetir
    return true
  })
  const coachCard = n0 ? { text: `${n0.subject}${n0.insight ? " — " + n0.insight : ""}`, convKey: n0.convKey || null } : null

  // unread real: personal (mensajería) vs email (newsletters) — separados para que la prosa no diga "595 mensajes" engañoso
  const personalUnread = threads.filter((t) => !/^email:/.test(t.key || "")).reduce((a, t) => a + (t.unread || 0), 0)
  const emailUnread = threads.filter((t) => /^email:/.test(t.key || "")).reduce((a, t) => a + (t.unread || 0), 0)

  // facts = materia prima para que la prosa SINTETICE (no para copiar). Incluye lo nuevo (esperan, llamadas, tareas) como contexto.
  const facts = [
    `Franja: ${period.label}.`,
    `Eventos hoy: ${agToday.length}${agToday.length ? " (" + agToday.map((e) => e.time + " " + e.title).join(", ") + ")" : ""}`,
    `Sin leer: ${personalUnread} personales${emailUnread ? ` y ${emailUnread} emails (casi todos newsletters)` : ""}. Importantes de trabajo: ${bandeja.important}.`,
    waiting.length ? `Esperan respuesta (${waiting.length}): ${waiting.map((w) => w.name + (w.work ? " [trabajo]" : "")).join(", ")}.` : "Nadie esperando respuesta.",
    calls.length ? `Llamadas WhatsApp (24h): ${calls.map((c) => c.name + (c.missed ? " [perdida]" : "")).join(", ")}.` : "",
    todos.length ? `Tareas pendientes: ${todos.slice(0, 4).map((t) => t.text).join("; ")}.` : "",
    promesas.length ? `Prometiste (sin cumplir): ${promesas.slice(0, 3).map((p) => p.text + " → " + p.name).join("; ")}.` : "",
    `KPIs: ${kpis.map((k) => `${k.label} ${k.value}`).join("; ")}.`,
  ].filter(Boolean).join("\n")
  const brief = await computeBrief(facts, period)

  const snapshot = {
    generatedAt: Date.now(),
    period: period.id,
    brief,
    foco,
    waiting,
    calls,
    todos,
    promesas,
    objetivos,
    agenda: agToday,
    bandeja,
    kpis,
    news,
    coach: coachCard,
  }
  setMeta("home_brief", JSON.stringify(snapshot))
  console.log(`[home-brief] ${period.id} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${agToday.length} ev · ${waiting.length} esperan · ${calls.length} llam · ${todos.length} todo · ${promesas.length} prom · ${objetivos.length} obj · audio ${brief.audioSec}s`)
  return snapshot
}

// CLI
if (process.argv[1] && process.argv[1].endsWith("home-brief.mjs")) {
  generateHomeBrief().then(() => process.exit(0)).catch((e) => { console.error("home-brief error:", e); process.exit(1) })
}
