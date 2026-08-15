// brain/meetings — notetaker/prep de reuniones: briefing de la próxima, detalle, tarjetas pre-generadas por cron, lectura rápida.
// Importa el helper de tiempo de schedule (agenda/mtgId/catOf/mtgWhen/durMin/resolveAttendee) — dep unidireccional meetings→schedule.
import { owner, ownerFirst, myEmails } from "../hub.mjs"
import { llm, smartChain } from "../llm.mjs"
import { setMeta, getMeta } from "../db.mjs"
import { jf } from "./kernel/contacts.mjs"
import { peopleNodes } from "./kernel/vault.mjs"
import { messagesFor } from "./kernel/convo.mjs"
import { matchObjetivo } from "./kernel/objetivos.mjs"
import { j } from "./kernel/jsonl.mjs"
import { agenda, mtgId, catOf, mtgWhen, durMin, resolveAttendee } from "./schedule.mjs"
// resolvePerson/personView son export function (hoisted) de brain → import top-level seguro; se LLAMAN solo en runtime
import { resolvePerson, personView } from "../brain.mjs"

// ───────────────────────────────── código movido verbatim desde brain.mjs (M2) ─────────────────────────────────

// ── MEETING PREP ──
// `localOnly`: la reunión es con un contacto SECRETO → el briefing se arma con modelo local. Mismo criterio que
// composeCorrect y draftReply: desbloquear con el 2º PIN es "mostrámelo a mí", no "mandáselo a un tercero".
export async function meetingPrep(query, { localOnly = false } = {}) {
  const now = new Date().toISOString().slice(0, 10)
  const cal = [...j("calendar.jsonl"), ...j("calendar-google.jsonl")].filter((e) => (e.start || "") >= now).sort((a, b) => (a.start || "").localeCompare(b.start || ""))
  const mtg = query ? cal.find((e) => (e.title || "").toLowerCase().includes(query.toLowerCase())) : cal[0]
  if (!mtg) return { error: "No hay reunión." }
  const ME = [owner().toLowerCase(), ownerFirst().toLowerCase(), ...myEmails()].filter(Boolean)
  const attendees = [...new Set([...(mtg.attendees || []), mtg.organizer].filter(Boolean))].filter((a) => !ME.includes(String(a).toLowerCase()))
  const known = [], unknown = []
  for (const a of attendees) { const c = resolvePerson(a); if (c && c.toLowerCase().includes(String(a).toLowerCase().slice(0, 5))) known.push(c); else if (peopleNodes().some((p) => p.toLowerCase() === String(a).toLowerCase())) known.push(a); else unknown.push(a) }
  const knownCtx = known.map((k) => { const v = personView(k); return `${k} (${v.role}): ${v.timeline.slice(-3).map((e) => e.text.slice(0, 100)).join(" | ")}` }).join("\n")
  const brief = await llm(`Sos jefe de gabinete de ${ownerFirst()}. Briefing accionable para esta reunión, español, con: objetivo, quién es cada asistente, estado del tema, pendientes, qué preparar. Breve.
REUNIÓN: ${mtg.title} · ${mtg.start} · organiza ${mtg.organizer}
ASISTENTES CONOCIDOS:\n${knownCtx || "(ninguno)"}
DESCONOCIDOS: ${unknown.join(", ") || "ninguno"}`, localOnly ? { chain: smartChain({ sensitive: true, secreto: true, feature: "meetings" }) } : undefined)
  return { title: mtg.title, start: mtg.start, organizer: mtg.organizer, attendees, known, unknown, brief: brief.trim() }
}

export async function meetingDetail(id, ws) {
  const ag = agenda()
  const m = ag.meetings.find((x) => `${(x.title || "").toLowerCase()}|${(x.start || "").slice(0, 16)}` === id) || ag.meetings[parseInt(id)] || ag.meetings[0]
  if (!m) return { error: "sin reunión" }
  const attNames = (m.attendees || []).map((a) => a.name || a.email || a).filter(Boolean)
  const linked = []
  for (const nm of attNames.slice(0, 4)) for (const x of messagesFor(String(nm).split("@")[0]).filter((y) => y.channel === "email").slice(-2)) linked.push({ from: x.name, text: (x.text || "").slice(0, 80), ts: x.ts })
  const objetivo = await llm(`Reunión "${m.title}" con ${attNames.join(", ") || "el equipo"}. En 1 frase directa (español, natural, no suenes a IA) decí el objetivo probable.`, { model: process.env.ASK_MODEL || "qwen2.5:3b" }).then((s) => s.trim()).catch(() => "")
  return { title: m.title, start: m.start, end: m.end, url: m.url, location: m.location, sources: m.sources, attendees: m.attendees, objetivo, linked: linked.slice(0, 6) }
}

export async function genMeetingCards({ horizonDays = 21 } = {}) {
  const ag = agenda(), objetivos = jf("objetivos.json") || []
  const now = Date.now(), horizon = now + horizonDays * 86400000
  const upcoming = ag.meetings.filter((m) => { const t = Date.parse(m.start || ""); return t && t > now - 12 * 3600e3 && t < horizon })
  let n = 0
  for (const m of upcoming) {
    const id = mtgId(m), c = catOf(m)
    const attendees = (m.attendees || []).slice(0, 8).map(resolveAttendee)
    const obj = matchObjetivo(m, objetivos)
    const linked = []
    for (const a of attendees.slice(0, 4)) { try { for (const x of messagesFor(a.name.split(" ")[0], 60).filter((y) => y.channel === "email" || y.channel === "whatsapp").slice(-2)) linked.push({ from: a.name, text: (x.text || "").slice(0, 100), ts: x.ts, thread: x.thread }) } catch {} }
    let prep = ""
    try {
      prep = (await llm(`Reunión "${m.title}"${m.start ? " el " + m.start.slice(0, 16) : ""} con ${attendees.map((a) => a.name + (a.role ? ` (${a.role})` : "")).join(", ") || "el equipo"}.
Mensajes recientes con ellos:\n${linked.map((l) => `- ${l.from}: ${l.text}`).join("\n") || "(sin contexto)"}
Escribí una PREPARACIÓN de 2-3 frases para ${ownerFirst()}: qué se juega y qué revisar antes de entrar. Directo y humano. Usá SOLO los datos dados, no inventes nombres ni hechos.`, { chain: process.env.LLM_CHAIN_CORRECT || "openai,ollama", numPredict: 200, temperature: 0.3 })).trim()
    } catch {}
    // dedup de hilos vinculados por persona (evita dos botones "Alberto ›" iguales)
    const seenFrom = new Set(), linkedU = linked.filter((l) => { const k = (l.from || "").toLowerCase(); if (seenFrom.has(k)) return false; seenFrom.add(k); return true })
    const card = { id, title: m.title, start: m.start, end: m.end, ...mtgWhen(m), url: m.url || "", location: m.location || "", sources: m.sources || [], desc: m.description || "", attachments: m.attachments || [], cat: c.cat, catLabel: c.label, icon: c.icon, color: c.color, durationMin: durMin(m), attendees, objetivo: obj, prep, linked: linkedU.slice(0, 4), generatedAt: Date.now() }
    setMeta("mtgcard:" + id, JSON.stringify(card)); n++
  }
  return n
}
// lectura RÁPIDA de la tarjeta pre-generada (fallback a meetingDetail en vivo si aún no existe)
export async function meetingCard(id, ws) {
  const raw = getMeta("mtgcard:" + id)
  if (raw) { try { const c = JSON.parse(raw); if (c && c.id) return c } catch {} }
  const d = await meetingDetail(id, ws)
  if (d && !d.error) { const c = catOf(d); return { ...d, id, ...mtgWhen(d), cat: c.cat, catLabel: c.label, icon: c.icon, color: c.color, durationMin: durMin(d), attendees: (d.attendees || []).map(resolveAttendee), objetivo: null, prep: d.objetivo || "", pending: true } }
  return d
}
