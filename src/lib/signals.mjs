// Detectores de SEÑALES para la proactividad (Fase 1/2). Consultan la DB (no el JSONL chico) → cobertura real.
// Los usa coach.mjs para generar acciones, y brain.mjs para la pestaña IA.
import { readFileSync, existsSync, readdirSync } from "fs"
import { recentOutbound, lastInboundQuestions, lastOutboundPerThread, lastInboundPerThread, selfNotesText } from "./db.mjs"
import { isSpam, llmSpam, notSpam } from "./spam.mjs"

const DAY = 86400000

// spam-senders marcados por el usuario (MISMO archivo que usa el inbox) → "marcar spam" también silencia el coach/IA.
const SPAM_SENDERS = new Set((existsSync("./data/spam-senders.json") ? JSON.parse(readFileSync("./data/spam-senders.json", "utf8")) : []).map((x) => String(x).toLowerCase()))
// un ítem de señal es spam si: lo marcaste vos, o el detector compartido (spam.mjs) lo clasifica como marketing.
const spammy = (r) => !notSpam(r.thread) && (SPAM_SENDERS.has(String(r.jid || "").toLowerCase()) || SPAM_SENDERS.has(String(r.thread || "").replace(/^email:/, "").toLowerCase()) || isSpam(r.jid || "", r.name || "", r.text || "") || llmSpam(r.thread))

// ── #2 PROMESAS: mensajes TUYOS con compromiso ("te mando mañana", "el lunes te confirmo") — ¿cumpliste? ──
const PROMISE_RE = /\b(te\s+(lo\s+)?(mando|paso|env[íi]o|confirmo|aviso|llamo|escribo|respondo|contesto|muestro|comparto|marco|coordino|reenv[íi]o)|ma[ñn]ana|pasado\s+ma[ñn]ana|el\s+(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)|la\s+semana\s+que\s+viene|m[áa]s\s+tarde|en\s+un\s+rato|ah[íi]\s+te|apenas\s+pueda|en\s+la\s+(tarde|noche|ma[ñn]ana)|hoy\s+te)\b/i
export function promises({ days = 7, limit = 15 } = {}) {
  const since = Date.now() - days * DAY
  const rows = recentOutbound(since)
  const byThread = {}
  for (const r of rows) {
    if (!PROMISE_RE.test(r.text) || byThread[r.thread]) continue
    byThread[r.thread] = { thread: r.thread, text: (r.text || "").slice(0, 150), ts: r.ts, channel: r.channel, stillOpen: r.ts >= (r.last_ts || 0) } // stillOpen = es el último msg del hilo → nadie respondió después
  }
  return Object.values(byThread).sort((a, b) => b.ts - a.ts).slice(0, limit)
}

// ── #3 PREGUNTAS SIN RESPONDER: el ÚLTIMO mensaje del hilo es entrante y tiene "?" ──
export function unansweredQuestions({ days = 21, limit = 15 } = {}) {
  const since = Date.now() - days * DAY
  // EXCLUIR grupos: una pregunta en un grupo (@g.us o portal !room del bridge, marcados con grp) NO es un nudge 1:1.
  // Antes se colaban → el coach las mostraba como "respondé a <persona>" pero al tappear abría el grupo entero (confuso, parece fusión).
  const rows = lastInboundQuestions(since, { limit: limit * 2 })
  const isLink = (t) => /^\s*https?:\/\/\S+\s*$/.test(t) // "?" de un URL no es una pregunta real
  return rows.filter((r) => !spammy(r) && !isLink(r.text || "")).slice(0, limit)
    .map((r) => ({ thread: r.thread, who: r.name, text: (r.text || "").slice(0, 160), ts: r.ts, channel: r.channel, ageDays: Math.round((Date.now() - r.ts) / DAY) }))
}

// ── #4 BOLA EN SU CANCHA: vos escribiste último y no te respondieron (reinsistir) ──
export function waitingOnThem({ days = 21, minAge = 2, limit = 12 } = {}) {
  const since = Date.now() - days * DAY
  const rows = lastOutboundPerThread(since, { limit: limit * 2 })
  const minTs = Date.now() - minAge * DAY
  return rows.filter((r) => r.ts < minTs && !PROMISE_RE.test(r.text)).slice(0, limit) // excluir promesas (esas van a #2)
    .map((r) => ({ thread: r.thread, text: (r.text || "").slice(0, 150), ts: r.ts, channel: r.channel, ageDays: Math.round((Date.now() - r.ts) / DAY) }))
}

// PENDIENTES DE RESPUESTA: hilos cuyo ÚLTIMO mensaje es entrante (esperan tu respuesta). DB, no el JSONL gigante.
export function pendingReplies({ days = 30, minAge = 1, limit = 25 } = {}) {
  const since = Date.now() - days * DAY, maxTs = Date.now() - minAge * DAY
  // EXCLUIR grupos (mismo motivo que unansweredQuestions): en un grupo el último mensaje casi siempre es entrante y NO significa que TE toque responder.
  const rows = lastInboundPerThread(since, maxTs, { limit: limit * 2 })
  const EXTRA = /failed to bridge|incoming call/i
  return rows.filter((r) => !spammy(r) && !EXTRA.test(r.text || "")).slice(0, limit)
    .map((r) => ({ key: `responder:${r.thread}`, thread: r.thread, who: r.name, channel: r.channel, ageDays: Math.round((Date.now() - r.ts) / DAY), lastText: (r.text || "").slice(0, 180) }))
}

// ── #1 NOTAS: cosas que te mandaste a Mis Notas (para que el coach extraiga TODOs/ideas) ──
export function recentNotes({ limit = 25 } = {}) {
  return selfNotesText({ limit })
    .map((r) => ({ text: (r.text || "").slice(0, 200), ts: r.ts }))
}

// ── #14 IMPORTANCIA: score por tags del vault (inversor/cliente/familia > amigo) → rankear ──
export function importanceMap() {
  const map = {}
  if (!existsSync("./vault/People")) return map
  for (const f of readdirSync("./vault/People").filter((x) => x.endsWith(".md"))) {
    let md = ""; try { md = readFileSync(`./vault/People/${f}`, "utf8") } catch { continue }
    const tags = (md.match(/tags:\s*\[?(.*?)\]?\n/)?.[1] || "").toLowerCase() + " " + (md.match(/role:\s*(.*)/)?.[1] || "").toLowerCase()
    let s = 1
    if (/inversor|investor|socio|partner|board/.test(tags)) s = 5
    else if (/cliente|client/.test(tags)) s = 4
    else if (/familia|family|esposa|hijo|hermano|madre|padre/.test(tags)) s = 4
    else if (/proveedor|empleado|equipo|team/.test(tags)) s = 3
    else if (/amigo|friend/.test(tags)) s = 2
    map[f.slice(0, -3).toLowerCase()] = s
  }
  return map
}
