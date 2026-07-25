// brain/coach — coach proactivo (nudges/promesas/preguntas sin responder), review semanal, feedback de nudges, sugerir objetivos. Leaf.
import { existsSync, readFileSync, writeFileSync } from "fs"
import { ownerFirst, company } from "../hub.mjs"
import { llm } from "../llm.mjs"
import { promises as sigPromises, unansweredQuestions as sigQuestions, waitingOnThem as sigWaiting } from "../signals.mjs"
import { latestThreadLike, sentCountSince, recvCountSince, topThreadsSince, markDone } from "../db.mjs"
import { jf, threadName } from "./kernel/contacts.mjs"
import { matchObjetivo } from "./kernel/objetivos.mjs"

const SELF_MODEL = "./vault/_Brain/self-model.md" // path compartido con brain (const puro, se copia para no importar de la fachada en eval-time)

let _coachCache = { ts: 0 } // la pestaña IA/Coach la pide seguido; los datos cambian lento (coach cada 4h)
export function coachData() {
  // stale-while-revalidate: si hay data (aunque venza), la devuelvo YA y refresco en background → siempre instantáneo
  if (_coachCache.data) {
    if (Date.now() - _coachCache.ts < 300000) return _coachCache.data
    if (!_coachCache.busy) { _coachCache.busy = true; setImmediate(() => { try { _computeCoach() } catch {} finally { _coachCache.busy = false } }) }
    return _coachCache.data
  }
  return _computeCoach()
}
function _computeCoach() {
  const store = jf("coach-nudges.json") || {}
  const NOW = Date.now(), DAY = 86400000
  const prio = (n) => Math.min(5, (n.priority || 3) + Math.floor((NOW - (n.first_seen || NOW)) / (3 * DAY)))
  const open = Object.values(store).filter((n) => n.status === "open")
  // convKey = hilo REAL para navegar. "responder:<hilo>" → hilo; channel-prefixed → tal cual; subject con número → busca el hilo; si no, null (sintético).
  const _convKey = (n) => {
    const k = n.key || ""
    if (k.startsWith("responder:")) return k.slice(10)
    if (/^(whatsapp|email|teams|telegram|instagram|facebook|linkedin):/.test(k)) return k
    const num = (n.subject || "").match(/\b(\d{10,16})\b/)
    if (num) { try { const r = latestThreadLike(`whatsapp:${num[1]}@%`); if (r?.thread) return r.thread } catch {} }
    return null
  }
  const mk = (n) => ({ key: n.key, convKey: _convKey(n), subject: n.subject || n.title, type: n.type, insight: n.insight || n.rationale || "", steps: n.steps || [], priority: prio(n), times: n.times_surfaced || 1 })
  const dedup = (arr) => { const seen = {}; for (const n of arr) { const k = (n.subject || "").toLowerCase().trim(); if (!seen[k] || n.priority > seen[k].priority) seen[k] = n } return Object.values(seen) }
  // señales crudas (accionables, tappables al hilo) — Fase 1
  let promises = [], questions = [], waiting = []
  try {
    promises = sigPromises({ limit: 10 }).map((p) => ({ ...p, name: threadName(p.thread) }))
    questions = sigQuestions({ limit: 10 })
    waiting = sigWaiting({ limit: 8 }).map((w) => ({ ...w, name: threadName(w.thread) }))
  } catch {}
  const data = {
    brief: jf("coach-brief.json") || null,
    promises, questions, waiting,
    nudges: dedup(open.filter((n) => n.kind === "nudge").map(mk)).sort((a, b) => b.priority - a.priority || b.times - a.times),
    proposals: dedup(open.filter((n) => n.kind === "proposal").map(mk)),
    updated: existsSync("./data/coach-report.md") ? (readFileSync("./data/coach-report.md", "utf8").match(/# 🧠 Coach — (.*)/)?.[1] || "") : "",
  }
  _coachCache = { ts: Date.now(), data }
  return data
}
// #4 REVIEW SEMANAL: síntesis reflexiva de la semana (qué moviste, con quién, qué quedó, focos). Bajo demanda desde la pestaña IA.
let _weekCache = { ts: 0 }
export async function weeklyReview() {
  if (_weekCache.data && Date.now() - _weekCache.ts < 3600000) return _weekCache.data // 1h de cache
  const wk = Date.now() - 7 * 86400000
  const sent = sentCountSince(wk)
  const recv = recvCountSince(wk)
  const topRows = topThreadsSince(wk, { limit: 12 })
  const top = topRows.map((t) => ({ name: threadName(t.thread), c: t.c }))
  let pending = []; try { pending = sigPromises({ limit: 6 }).filter((p) => p.stillOpen).map((p) => threadName(p.thread)) } catch {}
  const prompt = `Es el REVIEW SEMANAL de ${ownerFirst()} (dueño de ${company()}). Datos de los últimos 7 días:
- Mandó ${sent} mensajes, recibió ${recv}.
- Contactos con más ida y vuelta: ${top.slice(0, 8).map((t) => `${t.name} (${t.c})`).join(", ") || "—"}.
- Promesas suyas sin cerrar: ${pending.join(", ") || "ninguna detectada"}.
Escribí un review reflexivo en español, directo y humano (no suenes a IA), en viñetas cortas: (1) qué movió la semana y con quién, (2) qué quedó pendiente o se le escapó, (3) 2-3 focos concretos para la semana que viene. No inventes más allá de los datos.`
  const review = await llm(prompt, { chain: process.env.LLM_CHAIN_CATCHUP || "gemini,ollama", temperature: 0.4, task: "weekly" }).then((s) => (s || "").trim()).catch(() => "")
  const data = { review, sent, recv, top }
  if (review) _weekCache = { ts: Date.now(), data }
  return data
}
// #15 feedback: cerrar / posponer / descartar un nudge → el coach deja de insistir y aprende
export function coachAction(key, action) {
  _coachCache = { ts: 0 } // invalidar el cache: el cambio se ve al toque
  const f = "./data/coach-nudges.json"
  const store = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}
  if (!store[key]) return { error: "no existe" }
  const apply = (n) => {
    if (action === "snooze") { n.status = "snoozed"; n.snoozed_until = Date.now() + 3 * 86400000 }
    else { n.status = "done"; if (action === "dismiss") n.dismissed = true }
  }
  apply(store[key])
  // cerrar TAMBIÉN los HERMANOS: nudges casi-duplicados del mismo contacto (el LLM genera varios por corrida con keys
  // distintos). Sin esto, archivar uno deja 2-3 tarjetas idénticas y parece que el botón no funciona.
  const target = store[key]
  const numOf = (n) => (`${n.subject || ""} ${n.title || ""} ${n.key || ""}`.match(/\b(\d{9,16})\b/) || [])[1]
  const subjNorm = (n) => (n.subject || n.title || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  const tnum = numOf(target), tsubj = subjNorm(target), tconv = target.convKey
  for (const [k, n] of Object.entries(store)) {
    if (k === key || n.status !== "open") continue
    if ((tnum && numOf(n) === tnum) || (tsubj && subjNorm(n) === tsubj) || (tconv && n.convKey === tconv)) apply(n)
  }
  writeFileSync(f, JSON.stringify(store, null, 2))
  return { ok: true }
}
export async function suggestObjetivos(ws) {
  const model = existsSync(SELF_MODEL) ? readFileSync(SELF_MODEL, "utf8").slice(0, 2500) : ""
  const cos = ws.companies().map((c) => c.name).join(", ")
  const r = await llm(`Perfil de ${ownerFirst()}:\n${model}\n\nEmpresas: ${cos}.\nProponé 4 objetivos/KPIs medibles y concretos (mezcla personales y de empresa) que le sirvan de verdad. JSON: {"objetivos":[{"title":"...","target":5,"unit":"clientes","scope":"personal"}]}. scope = "personal" o el nombre exacto de una empresa.`, { json: true, model: process.env.ASK_MODEL || "qwen2.5:3b" }).catch(() => ({ objetivos: [] }))
  return (r.objetivos || []).slice(0, 6)
}
// hook de test para la lógica pura de matcheo de objetivos (matchObjetivo vive en kernel/objetivos.mjs)
export function _testMatchObjetivo(title, objetivos) { return matchObjetivo({ title, attendees: [] }, objetivos) }

// marca una tarea o promesa como HECHA (kind: "todo" | "prom"). Las llena el cron extract-actions.
export function actionDone(kind, id) {
  try { markDone(kind, id); return { ok: true } } catch (e) { return { error: e.message } }
}
