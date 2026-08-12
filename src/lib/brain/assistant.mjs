// ASISTENTE EN TU PROPIO CHAT — le escribís a tu número de siempre y, si es una PREGUNTA, te contesta.
//
// Es lo OPUESTO al piloto automático, aunque compartan cañería:
//   · el PILOTO se hace pasar por vos y le habla a OTROS en tu voz.
//   · el ASISTENTE te habla A VOS, como asistente, y puede buscar en internet y en tu propio historial.
// Por eso vive aparte: distinto prompt, distinto destinatario, distinto criterio para abrir la boca.
//
// El caso real: le mandás notas a tu propio WhatsApp todo el día. Eso NO se toca. Pero si escribís
// "¿cuánto me debe Soltrak?" o "buscá el horario del vuelo", te responde.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { llm, smartChain } from "../llm.mjs"
import { hasWebSearch, webSearch } from "../research.mjs"
import { harden, UNTRUSTED_NOTE } from "../safety.mjs"
import { ownerFirst } from "../hub.mjs"
import { ask } from "./ask.mjs"
import { sendReply } from "./reply.mjs"
import { selfNotesSince, selfNotesSinceAll, selfNotesHiddenCount, isSecretSelfRow } from "../db.mjs" // trae AMBAS direcciones del hilo propio y ya excluye las notas de canal secreto

const CFG = () => "./data/assistant.json"
const STATE = () => "./data/assistant-state.json"
const load = (f, d = {}) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d } catch { return d } }
const save = (f, o) => { try { mkdirSync("./data", { recursive: true }); writeFileSync(f, JSON.stringify(o, null, 2)) } catch {} }

// 🤖 MARCA ANTI-BUCLE. El bridge hace ECO de lo que mandamos: la respuesta vuelve como un mensaje más del hilo, con
// OTRO id. Taggear el id que insertamos no alcanza — hay que reconocer el eco por su contenido. Todo lo que sale de
// acá arranca con esta marca, y todo lo que empieza con ella se ignora. Sin esto, el asistente se responde solo.
export const MARK = "🤖 "

export function getAssistant() {
  const c = load(CFG())
  return { enabled: !!c.enabled, maxPerDay: c.maxPerDay || 30, web: c.web !== false, secretOk: !!c.secretOk }
}
export function setAssistant({ enabled, maxPerDay, web, secretOk } = {}) {
  const c = getAssistant()
  const next = { enabled: enabled === undefined ? c.enabled : !!enabled, maxPerDay: maxPerDay === undefined ? c.maxPerDay : Math.max(1, Math.min(200, +maxPerDay || 30)), web: web === undefined ? c.web : !!web, secretOk: secretOk === undefined ? c.secretOk : !!secretOk }
  save(CFG(), next)
  return next
}

// ── ¿ESTO ES UNA PREGUNTA PARA MÍ, O UNA NOTA TUYA? ──────────────────────────────────────────────
// PURA y conservadora a propósito: ante la duda NO contesta. Un falso positivo es el asistente
// metiéndose en tus notas, que es exactamente lo que arruinaría la función.
// ⚠️ NADA de \b después de una palabra acentuada: en JS \b es ASCII (\w = [A-Za-z0-9_]), así que "qué\b" NO matchea
// ("é" y el espacio son ambos no-\w → no hay frontera). Costaba "qué reunión tengo mañana" clasificado como nota.
// Con la bandera u, (?!\p{L}) es la frontera correcta.
const WORDS = /^(qué|que|cuál|cual|cuáles|cuando|cuándo|dónde|donde|quién|quien|quiénes|cómo|como|cuánto|cuanto|cuánta|cuántos|cuántas|por qué|porque|para qué|se puede|hay|tengo|puedo|sabés|sabes|conocés|conoces)(?!\p{L})/iu
// pedidos explícitos: no llevan "?" pero son claramente una orden para el asistente
const ASKS = /^(busc[aá]|averigu[aá]|dec[ií]me|dime|cont[aá]me|explic[aá]me|resum[ií]me|calcul[aá]|traduc[ií]|recordame qu[eé]|revis[aá] si|f[ií]jate si|mostrame|muéstrame|necesito saber|ayud[aá]me con|ayúdame con)(?!\p{L})/iu
// disparador EXPLÍCITO: siempre contesta, aunque no parezca pregunta. Es la salida de emergencia.
const PREFIX = /^\s*(pipe|che pipe|hey pipe|oye pipe|asistente)\s*[,:!]?\s+/i
const ONLY_URL = /^\s*<?https?:\/\/\S+>?\s*$/i

export function classify(text) {
  const t = String(text || "").trim()
  if (!t) return { answer: false, reason: "vacío" }
  if (t.startsWith(MARK)) return { answer: false, reason: "es mi propia respuesta (o su eco)" }
  const m = t.match(PREFIX)
  if (m) {
    const rest = t.slice(m[0].length).trim()
    return rest ? { answer: true, explicit: true, question: rest, reason: "me llamaste por nombre" } : { answer: false, reason: "solo el nombre, sin pregunta" }
  }
  if (ONLY_URL.test(t)) return { answer: false, reason: "es un link guardado" }
  if (t.length < 8) return { answer: false, reason: "muy corto" }
  if (t.length > 1500) return { answer: false, reason: "muy largo — parece una nota o algo pegado" }
  const q = t.endsWith("?") || /\?\s*$/.test(t)
  if (q || WORDS.test(t) || ASKS.test(t)) {
    // "…me dijo que cuándo llegaba" es una nota CONTANDO algo, no una pregunta para mí.
    if (!q && /(^|\P{L})(me dijo|me dijeron|dijo que|comentó|avisó|recordar que|nota:|pendiente:)/iu.test(t)) return { answer: false, reason: "parece una nota sobre lo que dijo otro" }
    return { answer: true, question: t, reason: q ? "termina en signo de pregunta" : "arranca como pregunta o pedido" }
  }
  return { answer: false, reason: "no parece una pregunta" }
}

// SALUDO o charla suelta: no hay nada que buscar. Antes "hola, ¿estás por ahí?" disparaba RAG + internet y
// contestaba "no hay información explícita sobre la disponibilidad de Álvaro", que es una respuesta absurda.
const SMALLTALK = /^\s*(hola|holaa+|buenas|buen día|buenos días|buenas tardes|buenas noches|hey|ey|qué tal|que tal|cómo estás|como estas|cómo andás|como andas|estás|estas|estás ahí|estas por ahi|estás por ahí|test|prueba|probando|funciona|andás|andas)\b[^?]{0,25}\??\s*$/iu
export const isSmallTalk = (t) => SMALLTALK.test(String(t || "").trim())

// ¿hace falta internet, o alcanza con lo que ya sabemos de vos? (heurística, barata)
const PERSONAL = /(^|\P{L})(acord[eé]|promet[ií]|me debe|le debo|factura|deuda|quedamos|habl[eé] con|me dijo|reunión con|mi (cliente|proveedor|hermano|mamá|papá)|nuestro|mi proyecto)(?!\p{L})/iu
const WEBBY = /(^|\P{L})(hoy|ahora|últim[oa]|noticia|precio|cotiza|dólar|clima|horario|vuelo|quién es|qué es|cómo se|significa|traduc)(?!\p{L})/iu
export function needsWeb(text) {
  const t = String(text || "")
  if (PERSONAL.test(t) && !WEBBY.test(t)) return false // es sobre TU historial → no hace falta salir a internet
  return true
}

const markSent = (txt) => { const s = load(STATE(), {}); s.lastReplyTs = Date.now(); s.today = (s.today || []).filter((x) => Date.now() - x < 86400000).concat(Date.now()); s.lastText = String(txt).slice(0, 80); save(STATE(), s) }
export function assistantState() { const s = load(STATE(), {}); return { ...s, usedToday: (s.today || []).filter((x) => Date.now() - x < 86400000).length } }

// ¿la respuesta del RAG es en realidad un "no sé"? (varias formas, con y sin acento)
const EMPTYISH = /(no (hay|tengo|se encontr|dispongo|puedo)|sin (información|informacion|datos)|no (aparece|figura|consta|menciona|mencionan|contienen|incluyen)|los (datos|fragmentos) no (alcanzan|permiten))/i
export const looksEmptyAnswer = (t) => { const x = String(t || "").trim(); return !x || (x.length < 260 && EMPTYISH.test(x)) }

/** Responde UNA pregunta con todo lo que tenemos: tu historial (RAG) + internet si hace falta. */
// `localOnly`: la pregunta vino de una línea SECRETA → se responde con modelos LOCALES y sin buscar en internet.
// El dueño ya ve ese chat en su teléfono, pero su contenido no tiene por qué salir a un proveedor de nube.
export async function answerQuestion(question, { web = true, localOnly = false } = {}) {
  if (isSmallTalk(question)) return { text: "Acá estoy. Preguntame lo que necesites — busco en tus conversaciones y en internet.", smallTalk: true, usedWeb: false, ownMatches: 0 }
  const own = await ask(question).catch(() => ({ answer: "", matches: 0 }))
  // Si el paso sobre TUS datos no encontró nada, suele devolver una NEGATIVA ("no hay información sobre…").
  // Pasarla como contexto contagia al modelo final, que repite la negativa incluso en preguntas de conocimiento
  // general. Ej. real: "¿cuál es la capital de Israel?" → "no tengo información explícita". Se descarta.
  const ownText = looksEmptyAnswer(own.answer) ? "" : own.answer
  let webCtx = ""
  const useWeb = web && !localOnly && hasWebSearch() && needsWeb(question)
  if (useWeb) {
    try {
      const rs = await webSearch(question, 5) // ⚠️ devuelve {answer, results[]}, NO un array
      const hits = (rs && rs.results) || []
      const direct = rs && rs.answer ? `- respuesta directa: ${String(rs.answer).slice(0, 300)}\n` : ""
      webCtx = direct + hits.map((r) => `- ${r.title}: ${(r.snippet || "").slice(0, 200)} (${r.link})`).join("\n")
    } catch { /* sin internet igual respondemos con lo tuyo */ }
  }
  // Dos clases de pregunta, dos reglas. Antes había UNA sola ("usá solo el contexto") y por eso a "¿cuál es la capital
  // de Israel?" contestaba "no tengo información explícita": conocimiento general que cualquier modelo sabe, bloqueado
  // por un prompt pensado para los datos personales. Sobre SUS cosas hay que ser estricto; sobre el mundo, no.
  const sys = harden(`Sos el asistente personal de ${ownerFirst()}. Le hablás A ÉL, no a terceros: no te hagas pasar por él ni firmes como él.
Respondé en español, directo y breve (WhatsApp): 1 a 5 frases, sin relleno ni saludos.

Cómo responder según la pregunta:
· Si es sobre SUS cosas (sus conversaciones, deudas, reuniones, contactos): usá SOLO los datos de abajo. Si no alcanzan, decí qué falta. NUNCA inventes un dato suyo.
· Si es de conocimiento general o del mundo: respondé con lo que sabés, aunque los datos de abajo no digan nada. Si el dato pudo cambiar (precios, cargos, noticias) y no hay resultado web, aclaralo en pocas palabras.
Si usás un resultado web, cerrá con la fuente entre paréntesis.`)
  const prompt = `PREGUNTA: ${question}

DATOS SUYOS (de su propio historial):
${ownText || "(nada relevante en sus mensajes)"}

RESULTADOS WEB:
${webCtx || "(no se buscó en internet)"}

RESPUESTA:`
  const call = (pr, sy) => llm(pr, { system: sy + "\n" + UNTRUSTED_NOTE, feature: "ask", temperature: 0.3, task: "assistant", bypassCap: true, ...(localOnly ? { chain: smartChain({ sensitive: true }) } : {}) }).then((s) => (s || "").trim()).catch(() => "")
  let out = await call(prompt, sys)
  // A veces el modelo se aferra a "tu historial no lo menciona" aunque la pregunta sea de conocimiento general
  // (pasó con "¿cuánta gente vive en Arequipa?"). Un reintento explícito, sin el contexto personal que lo distrae.
  if (looksEmptyAnswer(out) && !PERSONAL.test(question)) {
    const retry = `PREGUNTA: ${question}\n\n${webCtx ? `RESULTADOS WEB:\n${webCtx}\n\n` : ""}RESPUESTA:`
    const sys2 = harden(`Sos el asistente personal de ${ownerFirst()}. Es una pregunta de CONOCIMIENTO GENERAL: respondé con lo que sabés${webCtx ? " y con los resultados web" : ""}, en 1 a 3 frases, en español. No digas que te faltan datos de su historial: la pregunta no es sobre él.`)
    const second = await call(retry, sys2)
    if (second && !looksEmptyAnswer(second)) out = second
  }
  return { text: out, usedWeb: useWeb && !!webCtx, ownMatches: own.matches || 0, localOnly }
}

/** Tick del daemon: mira lo NUEVO de tu chat con vos mismo y contesta solo si es una pregunta. */
export async function runAssistant() {
  const cfg = getAssistant()
  if (!cfg.enabled) return { skipped: "apagado" }
  const st = load(STATE(), {})
  // PRIMERA CORRIDA: arranca desde AHORA. Si no, contestaría de golpe cientos de notas viejas.
  if (!st.since) { save(STATE(), { ...st, since: Date.now() }); return { skipped: "primera corrida — arranca desde ahora" } }
  const used = (st.today || []).filter((x) => Date.now() - x < 86400000).length
  if (used >= cfg.maxPerDay) return { skipped: `tope diario (${cfg.maxPerDay})` }
  if (st.lastReplyTs && Date.now() - st.lastReplyTs < 15000) return { skipped: "recién respondí" } // anti-ráfaga

  // ⚠️ tus notas a vos mismo son SALIENTES (dir='out'): threadSince las filtraría. selfNotesSince trae las dos
  // direcciones y además excluye lo que venga de una línea secreta (el daemon no tiene el 2º PIN).
  // la ingesta escribe en la misma DB cada 15s: un SELECT puede chocar con el lock. Reintentar en vez de perder el turno
  // (antes el catch mudo devolvía "no pude leer el hilo" y no se sabía por qué).
  // con secretOk, el asistente TAMBIÉN lee las líneas secretas: "secreto" = oculto en la app, no inexistente.
  // Contesta dentro de ese mismo chat de WhatsApp, donde el dueño ya ve todo → no lo expone en ningún lado nuevo.
  const read = cfg.secretOk ? selfNotesSinceAll : selfNotesSince
  let rows = null, readErr = ""
  for (let i = 0; i < 4 && rows === null; i++) {
    try { rows = read(st.since, { limit: 40 }) || [] }
    catch (e) { readErr = e.message; if (!/locked|busy/i.test(e.message)) break; await new Promise((r) => setTimeout(r, 200 * (i + 1))) }
  }
  if (rows === null) return { skipped: `no pude leer el hilo: ${readErr}` }
  const fresh = rows.filter((m) => (m.ts || 0) > (st.since || 0)).sort((a, b) => (a.ts || 0) - (b.ts || 0))
  if (!fresh.length) {
    // silencio explicado: si no vi nada PERO había mensajes bajo el 2º PIN, decilo. Antes esto era un no-op mudo
    // y parecía que el asistente estaba roto, cuando en realidad estaba respetando el PIN.
    let hidden = 0; try { hidden = selfNotesHiddenCount(st.since) } catch {}
    return { skipped: hidden ? `nada visible — ${hidden} mensaje(s) ocultos por el 2º PIN (el daemon no lo tiene)` : "nada nuevo" }
  }

  let answered = 0
  let since = st.since
  for (const m of fresh) {
    since = Math.max(since, m.ts || 0)
    const c = classify(m.text)
    if (!c.answer) continue
    // si vino de una línea secreta, se responde con modelo LOCAL y sin internet: el contenido no sale del server
    const secreta = cfg.secretOk && isSecretSelfRow(m)
    const r = await answerQuestion(c.question, { web: cfg.web, localOnly: secreta }).catch(() => ({ text: "" }))
    if (!r.text) continue
    const out = MARK + r.text
    // 🎯 contestar EN LA SALA donde preguntaste. Sin el target, sendReply elige "la última sala del hilo": con tres
    // teléfonos la respuesta puede salir por el chat equivocado (y si esa sala es de otra línea, no llega nunca).
    const room = /^![^:]+:/.test(String(m.jid || "")) ? m.jid : null
    const opts = room ? { channel: "whatsapp", target: room } : {}
    let sent = null
    for (let i = 0; i < 3 && !sent; i++) {
      sent = await sendReply("self", out, opts).catch((e) => { if (!/BUSY|locked/i.test(e.message)) return null; return null })
      if (!sent) await new Promise((r2) => setTimeout(r2, 300 * (i + 1))) // la ingesta escribe seguido: reintentar el lock
    }
    if (sent && !sent.error) { markSent(out); answered++; console.log(`[asistente] ✓${secreta ? " 🔒local" : ""} "${String(m.text).slice(0, 40)}" → "${r.text.slice(0, 55)}"`) }
    break // una por corrida: el daemon vuelve en 60s. Evita ráfagas si pegaste varias preguntas juntas.
  }
  save(STATE(), { ...load(STATE(), {}), since })
  return { answered }
}
