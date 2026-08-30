// brain/ask — RAG semántico (embeddings + FTS) + router-search por facetas/grafo. Leaf (ask↔routerSearch internos).
import { existsSync, statSync, readFileSync } from "fs"
import { embed, topK, unpackVec } from "../embed.mjs"
import { route as routeFacets, activate as activateGraph } from "../router.mjs"
import { search as dbSearch, searchBody as dbSearchBody, conversationsByThreads as dbConvsByThreads, filesByTerms as dbFilesByTerms, mediaInThreads as dbMediaInThreads, bodyMatchInThreads as dbBodyMatch, recentInThread as dbRecentInThread, messageById as dbMessageById } from "../db.mjs"
import { llm, smartChain } from "../llm.mjs"
import { UNTRUSTED_NOTE } from "../safety.mjs"
import { ownerFirst } from "../hub.mjs"
import { nombrePorContacto, cuentasDeCorreo } from "../threads-repo.mjs"
import { stripWA } from "./kernel/keys.mjs"
import { cleanMsg } from "./kernel/convo.mjs"

// índice RAG cacheado (se recarga solo si el archivo cambió)
let _rag = null, _ragMtime = 0
function ragIndex() {
  const f = "./data/rag.jsonl"
  if (!existsSync(f)) return []
  const m = statSync(f).mtimeMs
  if (_rag && m === _ragMtime) return _rag
  // Los vectores se desempaquetan al cargar (int8 en base64 → Int8Array): además de disco, ahorra RAM, porque
  // este índice se carga ENTERO en memoria y un array de floats de JS pesa ~6KB por entrada contra 768 bytes.
  // LEER POR BUFFER, no como un string: rag.jsonl puede pasar los ~512MB del límite de string de Node (ERR_STRING_TOO_LONG) → el
  // RAG semántico se caía en silencio (todo el cerebro degradado a FTS). Los Buffers SÍ superan ese límite; parseamos línea por línea.
  const out = []
  try {
    const buf = readFileSync(f) // Buffer (sin límite de 512MB)
    let start = 0
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) { // '\n'
        if (i > start) { try { const o = JSON.parse(buf.toString("utf8", start, i)); if (o) { if (o.vec) o.vec = unpackVec(o.vec); out.push(o) } } catch {} }
        start = i + 1
      }
    }
    if (start < buf.length) { try { const o = JSON.parse(buf.toString("utf8", start)); if (o) { if (o.vec) o.vec = unpackVec(o.vec); out.push(o) } } catch {} }
  } catch (e) { console.warn("[rag] no pude cargar rag.jsonl:", e.message) }
  _rag = out
  _ragMtime = m
  return _rag
}

// 🔒 ¿puede este ítem del índice semántico entrar al contexto que ve la IA?
// El índice (data/rag.jsonl) NO guardaba el hilo, así que el filtro por hilo se saltaba ENTERO — `it.thread && …` es falso
// cuando no hay hilo, y el mensaje de una cuenta secreta entraba tal cual en la respuesta. El indexador ya guarda el hilo,
// pero las líneas viejas siguen sin él: para ésas se resuelve el mensaje por id contra la DB, cuyo lector niega las filas
// secretas. Si no se puede resolver (borrado, id de formato viejo), se descarta: preferimos perder un fragmento a filtrarlo.
// Exportada aparte para poder probarla sin levantar el modelo de embeddings.
export function ragItemVisible({ secretKeys = new Set(), isSecret = () => false, lookup = dbMessageById } = {}) {
  return (it) => {
    const raw = String(it.id || "")
    if (!raw.startsWith("msg:")) return true // nota del vault / item social: no es un mensaje de un canal
    // La fila de la DB manda SIEMPRE. El ítem del índice guarda `thread` pero no `channel`/`account`/`jid`, así que
    // preguntarle a él si es secreto no puede ver el caso "contacto con una cuenta de CORREO secreta en un hilo mixto":
    // el hilo no está en `hide` (es parcial) y sin `account` la comprobación de correo nunca dispara → se colaba.
    if (!lookup(raw.slice(4))) return false  // no resuelve: secreta, borrada, o id de formato viejo → afuera
    return !(it.thread && (secretKeys.has(it.thread) || isSecret(it))) // cinturón además del tirante
  }
}

// RETRIEVAL CRUDO (sin la síntesis LLM): trae los fragmentos más relevantes de TODA la data del owner — RAG semántico (mensajes +
// notas del vault Obsidian) + FTS sobre los 2M msgs + cuerpos de email. Reusable por el piloto (cruce con el cerebro) sin gastar un LLM.
export async function retrieveContext(question, { limit = 14, semantic: useSemantic = true } = {}) {
  let semantic = [], semanticOk = false
  // semantic=false → FTS solo (para llamadas en TIEMPO REAL como el piloto: cargar el índice de 550MB tarda ~12s, inaceptable por respuesta)
  if (useSemantic) try { const qv = await embed(question); if (qv) { semantic = topK(qv, ragIndex(), 22).filter((x) => x.s > 0.45).map((x) => x.it); semanticOk = true } } catch {}
  const ctxItems = [], seen = new Set()
  // 🔒 el RAG NUNCA ve mensajes de fuente secreta (ni 100%-secretos ni el canal secreto de un contacto parcial) → no se filtran en respuestas de IA
  let secretKeys = new Set(), isSecret = () => false; try { const S = await import("../secret.mjs"); secretKeys = S.secretThreadKeys(); isSecret = S.isSecretMsg } catch {}
  const visibleSem = ragItemVisible({ secretKeys, isSecret })
  // VENTANA TEMPORAL: si la pregunta habla de "hoy" / "nuevos" / "urgente", todo lo viejo sobra. Sin esto una
  // pregunta sobre las últimas horas se contestaba con mensajes de hace años, coherente y completamente inútil —
  // y tardaba minutos, porque el contexto se llenaba de historial.
  const vent = ventanaTemporal(question)
  for (const it of semantic) {
    if (seen.has(it.id) || !visibleSem(it)) continue
    if (vent.desde && (it.ts || 0) < vent.desde) continue // el índice semántico no sabe de fechas: se filtra acá
    seen.add(it.id)
    ctxItems.push({ ts: it.ts, label: it.kind === "note" ? "🧠 " + it.ref : it.ref, text: it.text })
  }
  try { for (const r of dbSearch(question, { limit: 22, byRank: true, desde: vent.desde })) { const k = "fts:" + r.id; if (seen.has(k) || secretKeys.has(r.thread) || isSecret(r)) continue; seen.add(k); ctxItems.push({ ts: r.ts, label: `${r.channel} ${stripWA(r.grp || r.name || "")}`, text: cleanMsg(r.text) }) } } catch {}
  try { for (const r of dbSearchBody(question, { limit: 8 })) { const k = "body:" + r.thread + ":" + r.ts; if (seen.has(k) || secretKeys.has(r.thread) || isSecret({ ...r, channel: "email" })) continue; seen.add(k); ctxItems.push({ ts: r.ts, label: `email ${stripWA(r.name || "")}`, text: cleanMsg(String(r.snip || "").replace(/<[^>]+>/g, " ")) }) } } catch {}
  // 4) ADJUNTOS: contratos, adendas, facturas, planillas. El texto vive DENTRO del archivo, así que ninguna de las
  // búsquedas de arriba lo ve — el cerebro contestaba "no hay información" teniendo el dato en un PDF. Primero una
  // PREBÚSQUEDA barata (nombre de archivo + mensaje + hilo) elige unos pocos candidatos; recién sobre esos se
  // extrae, y queda cacheado. Van al final y marcados `doc` para que el prompt les dé más espacio que a un chat.
  try {
    const { docsRelevantes } = await import("../doc-text.mjs")
    const fuera = (c) => secretKeys.has(c.thread) || isSecret(c)
    for (const d of await docsRelevantes(question, { limit: 3, excluir: fuera })) {
      const k = "doc:" + d.media
      if (seen.has(k)) continue
      seen.add(k)
      ctxItems.push({ ts: d.ts, label: `📄 ${d.filename || "documento"}`, text: d.texto, doc: true })
    }
  } catch { /* sin extracción disponible: el cerebro responde como antes */ }
  ctxItems.sort((a, b) => (a.ts || 0) - (b.ts || 0))
  // los documentos NO entran en el recorte por `limit`: son pocos, caros de traer y suelen ser LA respuesta
  const docs = ctxItems.filter((x) => x.doc)
  const resto = ctxItems.filter((x) => !x.doc).slice(0, limit)
  return { items: [...resto, ...docs].sort((a, b) => (a.ts || 0) - (b.ts || 0)), semanticOk }
}

// `localOnly`: la pregunta viene de una línea SECRETA → el modelo que razona sobre tu historial tiene que ser local.
// Antes esta función imponía su propia cadena (nube primero) y el llamador solo cuidaba la síntesis final, así que el
// contexto igual pasaba por un tercero.
export async function ask(question, { localOnly = false } = {}) {
  const fmt = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ")
  const { items: ctxItems, semanticOk } = await retrieveContext(question, { limit: 28 })
  if (!semanticOk) console.warn("[ask] RAG semántico no disponible (Ollama caído) → respondo solo por búsqueda de palabras (FTS)") // #29: ya no es silencioso
  // 200 caracteres alcanzan para una línea de chat, pero cortarían un contrato justo antes del monto: a los
  // documentos les damos 3.000.
  // los documentos NO se cortan a ciegas: en un contrato los montos suelen estar repartidos y un corte por el
  // principio deja afuera la mitad de la respuesta sin que nada avise.
  const { recortarUtil } = await import("../doc-text.mjs")
  const ctx = ctxItems.map((e) => `- (${e.label}, ${fmt(e.ts).slice(0, 10)}) ${(e.doc ? recortarUtil(e.text || "", question, 6000) : String(e.text || "").slice(0, 200)).replace(/\s+/g, " ")}`).join("\n")
  // TODO LOCAL: respuesta con modelo chico/rápido en el server (privado). Prompt claro para que el modelo chico no se pierda.
  const alc = ventanaTemporal(question).etiqueta
  const prompt = `Sos el asistente personal de ${ownerFirst()}. Abajo hay FRAGMENTOS reales de sus mensajes y notas.${alc ? `\nSOLO estás viendo lo de ${alc}. Si no hay nada, decí exactamente eso — no contestes con cosas viejas.` : ""}
Respondé la PREGUNTA en 1 a 4 frases claras, en español, usando SOLO esos fragmentos.
Nombrá a las personas, proyectos o montos concretos que aparezcan. La fecha entre paréntesis es CUÁNDO se dijo, no es la respuesta.
Si los fragmentos no alcanzan para responder, decí exactamente qué falta. NO inventes.

PREGUNTA: ${question}

FRAGMENTOS:
${ctx || "(sin datos)"}

RESPUESTA:`
  // gemini primero (rápido/confiable); ollama en este box cuelga con prompts grandes. catch para no romper el endpoint.
  const answer = await llm(prompt, { system: UNTRUSTED_NOTE, feature: "ask", chain: localOnly ? smartChain({ sensitive: true, secreto: true, feature: "ask" }) : (process.env.LLM_CHAIN_ASK || "gemini,ollama"), temperature: 0.2, task: "ask", bypassCap: true }).then((s) => (s || "").trim()).catch(() => "")
  return { answer, matches: ctxItems.length, ragMode: semanticOk ? "semántico" : "keyword", degraded: !semanticOk }
}

// ── ROUTER-SEARCH: barato primero (facetas), fallback al RAG completo (ask) ──
// Es lo que llama el "robotito" de la bandeja. Ahorra tokens: BUSCAR = 0 tokens; PREGUNTA = síntesis chica con contexto ya filtrado.
// ¿ES UN SEGUIMIENTO DE LO ANTERIOR? "¿y cuánto era?" no se puede buscar literalmente: no dice de qué habla. Sin
// esto cada pregunta se contestaba aislada, así que la segunda de una charla devolvía cualquier cosa.
//
// No se resuelve con otra llamada al modelo: se ARRASTRAN las palabras concretas del turno anterior a la búsqueda.
// Barato, y suficiente para que el buscador encuentre lo mismo que la vez anterior.
// OJO con la tilde: `[eé]l` matcheaba el ARTÍCULO "el". Con eso "qué me dijo Pablo sobre el contrato" pasaba por
// seguimiento y se le pegaban las palabras del turno anterior — la búsqueda se iba a cualquier lado. Solo "él".
const PRONOMBRES = /(\beso\b|\besa\b|\bese\b|\besos\b|\besas\b|\bah[ií]\b|\blo mismo\b|\bde eso\b|\bal respecto\b|\bél\b|\bella\b|\bles?\b)/i
const ARRANQUE_SEGUIMIENTO = /^\s*(y|pero|entonces|ok|dale|listo|además|ademas|tambi[eé]n|tambien)\b/i
export function esSeguimiento(q, hayHistorial) {
  if (!hayHistorial) return false
  const t = String(q || "").trim()
  const palabras = t.split(/\s+/).filter(Boolean).length
  if (ARRANQUE_SEGUIMIENTO.test(t)) return true
  // Elipsis: "¿De emails?", "¿Y en el calendario?" — la pregunta arranca con preposición porque el sujeto quedó
  // en el turno anterior. Sin esto se buscaba a ciegas en todo el historial (240s y una respuesta inservible).
  if (/^\s*(y\s+)?(de|del|en|con|para|sobre|desde|entre)\b/i.test(t) && palabras <= 14) return true
  if (PRONOMBRES.test(t) && palabras <= 12) return true
  return palabras <= 4 // "¿y el monto?" — demasiado corta para buscarse sola
}
// Palabras con peso del turno anterior (nombres propios, cifras, términos largos): son las que hacen que la
// búsqueda caiga en el mismo lugar que antes.
// El recorte temporal también se hereda: "¿tengo algo importante de AYER?" → "¿de emails?" sigue hablando de ayer.
// Sin esto la repregunta se abría a 7 días y devolvía cosas que la primera ya había descartado.
export function ventanaHeredada(q, historial = []) {
  const propia = ventanaTemporal(q)
  if (propia.desde) return propia
  // hacia atrás hasta el último turno que SÍ nombró un momento: "…de ayer?" → "¿de emails?" → "¿y de whatsapp?"
  // sigue siendo sobre ayer, aunque el turno del medio no lo repita.
  for (const m of historial.filter((x) => x.role === "me").slice(-4).reverse()) {
    const v = ventanaTemporal(m.text)
    if (v.desde) return v
  }
  return propia
}

export function expandirConHistorial(q, historial = []) {
  const previos = historial.filter((m) => m.role === "me").slice(-2).map((m) => m.text).join(" ")
  if (!previos) return q
  const claves = [...new Set((previos.match(/[\p{Lu}][\p{L}]{2,}|\d[\d.,]{2,}|[\p{L}]{5,}/gu) || []))].slice(0, 6)
  return claves.length ? `${q} ${claves.join(" ")}` : q
}

// ¿LA PREGUNTA HABLA DE UN MOMENTO? "¿hay alguna urgencia HOY?" traía mensajes de 2020 rankeados por relevancia:
// la respuesta salía coherente y completamente inútil. Y tardaba minutos, porque el contexto se llenaba de años de
// historial para una pregunta sobre las últimas horas.
//
// El corte se calcula en la zona del USUARIO, no la del servidor: "hoy" a las 23:00 de Lima son las 06:00 del día
// siguiente en Europa, y sin eso el corte se iba un día entero.
const TZ = () => process.env.TZ_USUARIO || process.env.HUB_TZ || "America/Lima"
function inicioDelDia(offsetDias = 0) {
  const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: TZ() }))
  hoy.setHours(0, 0, 0, 0)
  return hoy.getTime() - offsetDias * 86400000
}
// "¿TENGO ALGO QUE NECESITE MI ATENCIÓN?" no se contesta buscando texto. Buscar "urgencia" trae cualquier mensaje
// donde alguien escribió esa palabra, y se pierde justo lo que importa: la invitación que sigue sin responder. Esa
// respuesta ya la tenemos calculada en la bandeja (el ✦), así que se contesta con eso — exacto y sin tokens.
const PIDE_PENDIENTES = [
  /\bnecesit[ae]n?\s+(mi\s+)?(asistencia|atenci[oó]n|respuesta)\b/i,
  // "algún MENSAJE importante", "algún CORREO urgente": el sustantivo va en el medio y antes no matcheaba,
  // así que la pregunta caía al RAG genérico y contestaba cualquier cosa.
  /\b(algo|alg[uú]n(?:[ao]s?)?)\s+(\w+\s+){0,2}(urgentes?|urgencias?|importantes?|prioritarios?|pendientes?)\b/i,
  /\b(tengo|hay|queda[nb]?)\s+(\w+\s+){0,3}(para|por|sin)\s+(responder|contestar)\b/i,
  /\bqu[eé]\s+(tengo|me\s+falta)\s+(pendiente|por\s+responder|responder)\b/i,
  /\bhay\s+(algo|alguna\s+cosa)\s+(urgente|importante|pendiente)\b/i,
  /\bqu[eé]\s+(es\s+)?(lo\s+)?(m[aá]s\s+)?(urgente|importante)\b/i,
  /\bsin\s+responder\b/i,
]
export const pidePendientes = (q) => PIDE_PENDIENTES.some((re) => re.test(String(q || "")))

// Los datos internos identifican a la gente por el jid del canal, no por su nombre. Eso no se le muestra a nadie:
// se cambia por el nombre agendado, y si no hay nombre se recorta a los últimos 4 dígitos.
export function humanizarIds(texto) {
  let t = String(texto || "")
  if (!/\d{7}/.test(t)) return t
  const cache = new Map()
  // OJO: NO tocar cualquier número largo. Un RUC (11 dígitos) o un monto son datos que el dueño pidió ver.
  // Solo se reemplaza si es inequívocamente un contacto: trae sufijo de jid, o los dígitos resuelven a un nombre.
  return t.replace(/\b(\d{7,16})(@[\w.]+)?\b/g, (full, num, suf) => {
    if (!cache.has(num)) { let n = null; try { n = nombrePorContacto(num) } catch {} cache.set(num, n) }
    const n = cache.get(num)
    if (n) return n
    return suf ? `un número terminado en ${num.slice(-4)}` : full
  })
}

export function ventanaTemporal(q) {
  const t = String(q || "").toLowerCase()
  // "de ayer u hoy" nombra las dos: gana la ventana MÁS ANCHA, por eso ayer se evalúa primero.
  if (/\bayer\b/.test(t)) return { desde: inicioDelDia(1), etiqueta: "desde ayer" }
  if (/\bhoy\b|\beste momento\b|\bahora mismo\b|\ben el día\b/.test(t)) return { desde: inicioDelDia(0), etiqueta: "hoy" }
  if (/\besta semana\b|\búltimos d[ií]as\b|\bultimos d[ií]as\b/.test(t)) return { desde: inicioDelDia(7), etiqueta: "esta semana" }
  if (/\beste mes\b|\búltimo mes\b|\bultimo mes\b/.test(t)) return { desde: inicioDelDia(30), etiqueta: "este mes" }
  // "nuevo/reciente/sin responder/pendiente" no nombran una fecha pero preguntan por lo de AHORA, no por el archivo
  if (/\bnuevos?\b|\brecientes?\b|\bsin responder\b|\bpendientes?\b|\búltimas?\b|\bultimas?\b|\burgencias?\b|\burgentes?\b/.test(t)) return { desde: inicioDelDia(3), etiqueta: "los últimos días" }
  return { desde: 0, etiqueta: "" }
}

// ¿Es un pedido de BUSCAR MENSAJES, y no una pregunta? "busca cualquier mensaje que diga F12" no se contesta con
// una síntesis: se contesta con los mensajes. Antes caía en el camino de respuesta y devolvía un resumen inútil
// ("te enviaste mensajes con F12 en varias fechas") en vez de mostrarte los 102 que existen.
const VERBOS_BUSCAR = /\b(busc(a|á|ame|arme)|mostr(ame|á)|mu[eé]strame|encontr(a|á)|encuentra|dame|list(a|á)me?|hay alg[uú]n)\b/i
const PIDE_MENSAJES = /\b(mensaje|mensajes|chat|chats|texto|whatsapp|mail|correo|dij[eo]|diga|dice|contenga|escrib[ií])\b/i
export function intentoBuscarTexto(q) {
  const t = String(q || "")
  if (!VERBOS_BUSCAR.test(t) || !PIDE_MENSAJES.test(t)) return null
  // el término: primero entre comillas, si no lo que sigue a "diga/dice/contenga/con la palabra"
  const comillas = t.match(/["'“”«»]([^"'“”«»]{2,60})["'“”«»]/)
  let termino = comillas ? comillas[1] : (t.match(/\b(?:diga|dice|dijo|contenga|con la palabra|sobre)\s+([^\s,.?!]{2,40})/i)?.[1] || "")
  if (!termino) {
    // último recurso: la palabra más "rara" (con dígitos o mayúsculas), que es lo que uno busca literalmente
    const cand = t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !VERBOS_BUSCAR.test(w) && !PIDE_MENSAJES.test(w))
    termino = cand.find((w) => /\d/.test(w) || /^[A-Z0-9]{2,}$/.test(w)) || cand.sort((a, b) => b.length - a.length)[0] || ""
  }
  if (!termino) return null
  // "que me haya enviado a mí mismo" / "mis notas" → solo lo tuyo
  const soloMios = /\ba\s*m[ií]\s*mismo\b|\bmis notas\b|\bme envi[eé]\b|\bme mand[eé]\b/i.test(t)
  return { termino: termino.replace(/^["'“”«»]|["'“”«»]$/g, ""), soloMios }
}

// "¿LO ÚLTIMO DE X ES MÍO O DE ELLOS?" / "¿cuáles fueron los últimos dos mensajes de X?"
// No es una pregunta semántica: es mirar el final de un hilo. El RAG la contestaba con "no hay información"
// aunque hubiera cientos de mensajes de ese contacto, porque buscaba por PARECIDO en vez de ir al hilo.
const PIDE_ULTIMOS = /\b(lo\s+[uú]ltimo|[uú]ltimo\s+mensaje|[uú]ltimos?\s+(?:\w+\s+)?mensa\w+|qui[eé]n\s+(?:me\s+)?(?:escribi[oó]|habl[oó])\s+[uú]ltimo|qui[eé]n\s+contest[oó]\s+[uú]ltimo)\b/i
const NUMERO = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, diez: 10 }
// palabras que siguen a "de" pero no nombran a nadie
const NO_SUJETO = new Set(["ellos", "ella", "ellas", "él", "el", "la", "los", "las", "mi", "mis", "su", "sus", "ayer",
  "hoy", "eso", "esa", "ese", "esto", "nuevo", "nuevos", "correo", "correos", "mail", "mails", "email", "emails",
  "whatsapp", "telegram", "mensaje", "mensajes", "parte", "quien", "quién", "que", "qué"])
export function pideUltimos(q) {
  const t = String(q || "")
  if (!PIDE_ULTIMOS.test(t)) return null
  let n = 1
  const mNum = /[uú]ltimos?\s+(\w+)\s+mensa\w+/i.exec(t)
  if (mNum) { const w = mNum[1].toLowerCase(); n = NUMERO[w] || (/^\d+$/.test(w) ? +w : 1) }
  else if (/[uú]ltimos\s+mensa\w+/i.test(t)) n = 3
  const sujetos = []
  for (const m of t.matchAll(/\bde\s+(?:la\s+|el\s+|los\s+|las\s+)?([\p{L}\p{N}][\p{L}\p{N}._-]{2,})/giu)) {
    const w = m[1]
    if (!NO_SUJETO.has(w.toLowerCase())) sujetos.push(w)
  }
  return sujetos.length ? { n: Math.min(Math.max(n, 1), 10), sujetos } : null
}

// "¿DE QUÉ HABLÉ POR EL MAIL DE X?" / "¿qué le respondí desde la casilla del trabajo?"
// La pregunta acota un BUZÓN, no un tema. Sin esto el buscador respondía con hilos de WhatsApp a una pregunta
// sobre correo, porque busca por parecido semántico y el nombre de una casilla no se parece a nada.
export function buzonMencionado(q) {
  const t = String(q || "").toLowerCase()
  if (!/\b(mail|mails|email|emails|correos?|casilla|bandeja|escrib|respond)/i.test(t)) return null
  const elegidas = []
  for (const c of cuentasDeCorreo()) {
    if (c.alias.some((a) => new RegExp(`(^|[^\\p{L}])${a}([^\\p{L}]|$)`, "iu").test(t))) elegidas.push(c.account)
  }
  return elegidas.length ? elegidas : null
}

export async function routerSearch(question, { historial = [] } = {}) {
  // Con historial, una pregunta de seguimiento se busca CON las palabras del turno anterior: si no, "¿y cuánto
  // era?" se busca literalmente y trae cualquier cosa.
  const seguimiento = esSeguimiento(question, historial.length > 0)
  const consulta = seguimiento ? expandirConHistorial(question, historial) : question
  // "¿QUÉ NECESITA MI ATENCIÓN?" se contesta con la señal ya calculada, no buscando la palabra "urgente".
  if (pidePendientes(consulta)) {
    const { listThreads } = await import("./inbox.mjs")
    const v = seguimiento ? ventanaHeredada(question, historial) : ventanaTemporal(question)
    const desde = v.desde || Date.now() - 7 * 86400000 // sin fecha en la pregunta, la última semana
    const canal = /\b(mails?|emails?|correos?|casilla|bandeja de entrada)\b/i.test(question) ? "email"
      : /\bwhats?app\b/i.test(question) ? "whatsapp"
      : /\btelegram\b/i.test(question) ? "telegram" : ""
    const imp = listThreads({ limit: 900 })
      .filter((t) => t.importante && (t.ts || 0) >= desde)
      .filter((t) => !canal || String(t.channel || "").toLowerCase().includes(canal) || String(t.key || "").toLowerCase().startsWith(canal))
    // "en hoy" se lee mal: los adverbios van sin preposición y las duraciones con "en"
    const et = v.etiqueta || "los últimos 7 días"
    const cuando = /^(hoy|desde ayer)$/.test(et) ? et : `en ${et}`
    const dondeTxt = canal === "email" ? " en tus correos" : canal ? ` en ${canal}` : ""
    const answer = imp.length
      ? `Sí: ${imp.length} ${imp.length === 1 ? "conversación necesita" : "conversaciones necesitan"} tu respuesta ${cuando}${dondeTxt}.\n` +
        imp.slice(0, 8).map((t) => `• ${humanizarIds(t.name)} — ${t.importanteRazon}`).join("\n")
      : `No hay nada sin responder que parezca urgente ${cuando}${dondeTxt}.`
    return { mode: "pendientes", engine: "señales", type: "answer", tokens: 0, answer, total: imp.length,
      threads: imp.slice(0, 8).map((t) => ({ key: t.key, name: t.name, summary: t.importanteRazon || "" })) }
  }
  // "¿LO ÚLTIMO DE X ES MÍO O DE ELLOS?" — se mira el final del hilo, sin gastar un token.
  const ult = pideUltimos(question)
  if (ult) {
    const { searchThreadKeys, recentInThread } = await import("../threads-repo.mjs")
    let hideU = new Set(), isSecU = () => false
    try { const S = await import("../secret.mjs"); hideU = S.secretThreadKeys(); isSecU = S.isSecretMsg } catch {}
    for (const sujeto of ult.sujetos) {
      const claves = (searchThreadKeys(sujeto, { limit: 8 }) || []).filter((k) => !hideU.has(k))
      if (!claves.length) continue
      const msgs = recentInThread(claves[0], { limit: ult.n }).filter((m) => !isSecU(m))
      if (!msgs.length) continue
      const ultimo = msgs[msgs.length - 1]
      const deQuien = ultimo.dir === "out" ? "Lo mandaste vos" : `Te lo mandó ${humanizarIds(ultimo.name || sujeto)}`
      const lineas = msgs.map((m) => `• ${m.dir === "out" ? "vos" : humanizarIds(m.name || sujeto)}: ${cleanMsg(m.text || "").replace(/\s+/g, " ").slice(0, 220)}`)
      return {
        mode: "ultimos", engine: "hilo", type: "answer", tokens: 0, total: msgs.length,
        answer: `${deQuien}. ${msgs.length === 1 ? "Es el último" : `Estos son los últimos ${msgs.length}`} de ${humanizarIds(sujeto)}:\n${lineas.join("\n")}`,
        threads: [{ key: claves[0], name: sujeto, summary: "" }],
      }
    }
    // si no se resolvió ningún sujeto, seguimos con el camino normal en vez de mentir con un "no hay"
  }
  // PREGUNTA ACOTADA A UN BUZÓN: el contexto se arma SOLO con esa casilla, no con todo el historial.
  const buzones = buzonMencionado(question)
  if (buzones) {
    const { recientesEnCuentas } = await import("../threads-repo.mjs")
    const vb = seguimiento ? ventanaHeredada(question, historial) : ventanaTemporal(question)
    // primero por relevancia dentro del buzón; si la pregunta no trae términos propios ("de qué hablé"), lo reciente
    // "¿qué le RESPONDÍ?", "¿qué ESCRIBÍ?" pregunta por lo tuyo: hay que quedarse con lo saliente, o el contexto se
    // llena de lo que te mandaron a vos y el modelo contesta "no hay información" teniendo 258 correos tuyos.
    const soloMios = /\b(respond[ií]|escrib[ií]|mand[eé]|envi[eé]|le dije|contest[eé]|mi respuesta|lo que puse)\b/i.test(question)
    const mios = (rs) => (soloMios ? rs.filter((m) => m.dir === "out") : rs)
    const porTermino = mios(dbSearch(consulta, { limit: 400, byRank: true, desde: vb.desde }).filter((m) => buzones.includes(m.account)))
    const msgs = porTermino.length >= 4 ? porTermino.slice(0, 40) : mios(recientesEnCuentas(buzones, { limit: 150, desde: vb.desde })).slice(0, 40)
    if (msgs.length) {
      // `fmt` se declara más abajo en esta misma función (zona muerta temporal): acá va uno propio.
      const dia = (ts) => new Date(ts).toISOString().slice(0, 10)
      const lineas = msgs.map((m) => `- (${m.dir === "out" ? "vos escribiste" : "te escribió " + (m.name || "?")}, ${dia(m.ts)}) ${cleanMsg(m.text || "").replace(/\s+/g, " ").slice(0, 240)}`)
      const alcanceB = vb.etiqueta ? ` Alcance: ${vb.etiqueta}.` : ""
      const pr = `Sos el asistente personal de ${ownerFirst()}. Abajo están SUS correos de la casilla ${buzones.join(" / ")}.${alcanceB}
Respondé en 1 a 5 frases, en español, usando SOLO eso.${soloMios ? " Son correos que ÉL envió: contá qué dijo él." : " Distinguí lo que escribió ÉL de lo que le escribieron."} Nombrá personas, empresas y montos concretos. Si no alcanza, decí qué falta. NO inventes.

PREGUNTA: ${question}

CORREOS (${msgs.length}):
${lineas.join("\n")}

RESPUESTA:`
      const ans = await llm(pr, { system: UNTRUSTED_NOTE, chain: process.env.LLM_CHAIN_ASK || "gemini,ollama", temperature: 0.2, task: "router", bypassCap: true }).then((x) => humanizarIds((x || "").trim())).catch(() => "")
      if (ans) return { mode: "buzon", engine: "correo", type: "answer", answer: ans, total: msgs.length, cuentas: buzones,
        threads: [...new Map(msgs.map((m) => [m.thread, { key: m.thread, name: m.name, summary: "" }])).values()].slice(0, 6) }
    }
    // sin nada en esa casilla: seguimos por el camino normal en vez de negar
  }
  // BUSCAR MENSAJES es distinto de PREGUNTAR: va primero y no gasta un solo token.
  const buscar = intentoBuscarTexto(question)
  if (buscar) {
    let hide2 = new Set(), isSec2 = () => false
    try { const S = await import("../secret.mjs"); hide2 = S.secretThreadKeys(); isSec2 = S.isSecretMsg } catch {}
    const crudos = dbSearch(buscar.termino, { limit: 120, byRank: false }).filter((m) => !hide2.has(m.thread) && !isSec2(m))
    const mios = crudos.filter((m) => m.dir === "out" || m.thread === "self")
    // si pediste "a mí mismo" y no hay ninguno, NO devolvemos vacío: mostramos los demás y lo decimos. Un "no hay"
    // cuando en realidad hay 102 en otros chats es la peor respuesta posible.
    const usar = buscar.soloMios ? (mios.length ? mios : crudos) : crudos
    const aviso = buscar.soloMios && !mios.length && crudos.length ? `No encontré ninguno que hayas enviado vos, pero hay ${crudos.length} donde aparece "${buscar.termino}".` : ""
    return {
      mode: "buscar", engine: "texto", type: "mensajes", tokens: 0, termino: buscar.termino, aviso,
      total: usar.length,
      results: usar.slice(0, 60).map((m) => ({ id: m.id, key: m.thread, name: m.name, ts: m.ts, channel: m.channel, dir: m.dir, text: cleanMsg(m.text || "").slice(0, 300) })),
    }
  }
  let r = activateGraph(consulta), engine = "grafo"       // v2: activación por difusión sobre el grafo ponderado
  if (!r.confident) { r = routeFacets(consulta); engine = "facetas" } // v1: presencia de facetas (fallback)
  if (!r.confident) { const a = await ask(consulta); return { mode: "rag", type: "answer", ...a, matched: r.matched } } // sin nodo claro → RAG de siempre (no perdemos recall)
  // 🔒 el router-search (0 tokens, sin gate aguas abajo) NO expone fuentes secretas: dropea hilos 100%-secretos del ranking y
  // filtra por-mensaje cada fuente (find/FTS/bodies/recientes) para hilos parciales.
  let hide = new Set(), isSecret = () => false; try { const S = await import("../secret.mjs"); hide = S.secretThreadKeys(); isSecret = S.isSecretMsg } catch {}
  r.ranked = (r.ranked || []).filter((x) => !hide.has(x.thread))
  const threads = r.ranked.map((x) => x.thread)
  const convs = dbConvsByThreads(threads)
  const cmap = Object.fromEntries(convs.map((c) => [c.thread, c]))
  const nameOf = (t) => cmap[t]?.name || stripWA(t.replace(/^(whatsapp|email|telegram):/, "")) || t
  const pathOf = Object.fromEntries(r.ranked.map((x) => [x.thread, x.path || []]))
  const srcThreads = r.ranked.map((x) => ({ key: x.thread, name: nameOf(x.thread), summary: cmap[x.thread]?.summary || "", score: Math.round((x.score || 0) * 10) / 10, path: x.path || [] }))

  if (r.intent.type === "find") { // "memes de messi", "documentación de globex" → traer media/adjuntos. CERO tokens.
    const docs = r.intent.want === "doc"
    let rows = docs ? dbFilesByTerms(r.matched, threads, { docs: true, limit: 40 }) : dbMediaInThreads(threads, { docs: false, limit: 40 })
    if (!docs && rows.length < 3) rows = [...rows, ...dbFilesByTerms(r.matched, [], { docs: false, limit: 20 })].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i) // supl. global por término
    rows = rows.filter((m) => !hide.has(m.thread) && !isSecret(m)) // 🔒 media/adjuntos de fuente secreta fuera
    return { mode: "facets", engine, type: "find", want: r.intent.want, tokens: 0, matched: r.matched, threads: srcThreads,
      results: rows.slice(0, 40).map((m) => ({ id: m.id, key: m.thread, name: m.name, ts: m.ts, channel: m.channel, media: m.media, mediaType: m.mediaType, filename: m.filename, text: m.text })) }
  }
  // PREGUNTA → contexto = resúmenes de los hilos ruteados + mensajes que MATCHEAN la pregunta (FTS sobre toda la DB, 0 tokens).
  // Así la respuesta es precisa aunque el mensaje clave esté en un hilo que el router no priorizó (ej: la deuda en el email).
  const fmt = (ts) => new Date(ts).toISOString().slice(0, 10)
  const line = (m) => `- (${fmt(m.ts)}, ${m.dir === "out" ? ownerFirst() : (m.name || "?")}) ${cleanMsg(m.text).replace(/\s+/g, " ").slice(0, 180)}`
  const seenId = new Set(), msgLines = []
  const ventG = ventanaTemporal(question)
  for (const m of dbSearch(consulta, { limit: 14, byRank: true, desde: ventG.desde })) { if (seenId.has(m.id) || !m.text || hide.has(m.thread) || isSecret(m)) continue; seenId.add(m.id); msgLines.push(line(m)); if (m.thread && !srcThreads.find((s) => s.key === m.thread)) srcThreads.push({ key: m.thread, name: nameOf(m.thread), summary: cmap[m.thread]?.summary || "", score: 0 }) } // 🔒
  // cuerpos de email (montos/fechas, fuera del FTS) — términos = entidades matcheadas + expansión por co-ocurrencia del grafo (juan→deuda)
  const stripB = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#\d+;|&gt;|&lt;|&amp;/g, " ").replace(/\s+/g, " ").trim()
  for (const m of dbBodyMatch(threads.slice(0, 3), [...(r.matched || []), ...(r.expand || [])], { limit: 3 })) { if (hide.has(m.thread) || isSecret({ ...m, channel: "email" })) continue; const s = stripB(m.body).slice(0, 260); if (s) msgLines.push(`- (${fmt(m.ts)}, ${m.name || "email"}) ${s}`) } // 🔒
  // FTS sobre cuerpos de email: encuentra montos/fechas por la PREGUNTA aunque estén en un body no ruteado (ej: la deuda)
  for (const m of dbSearchBody(consulta, { limit: 4 })) { if (hide.has(m.thread) || isSecret({ ...m, channel: "email" })) continue; const s = stripB(m.snip).replace(/\s+/g, " ").slice(0, 240); if (s) { msgLines.push(`- (${fmt(m.ts)}, ${m.name || "email"}) ${s}`); if (m.thread && !srcThreads.find((x) => x.key === m.thread)) srcThreads.push({ key: m.thread, name: nameOf(m.thread), summary: cmap[m.thread]?.summary || "", score: 0 }) } } // 🔒
  if (msgLines.length < 4) for (const t of threads.slice(0, 2)) for (const m of dbRecentInThread(t, { limit: 5 })) { if (!isSecret({ ...m, thread: t })) msgLines.push(line(m)) } // 🔒 (threads ya sin 100%-secretos; filtra parciales)
  // ADJUNTOS: este camino (el del grafo) armaba su contexto solo con mensajes y cuerpos de email, así que un dato
  // que vive DENTRO de un contrato o una factura le era invisible — y es el camino que se usa cuando la pregunta
  // menciona a alguien conocido, o sea justo las preguntas sobre plata y acuerdos.
  let docLines = []
  try {
    const { docsRelevantes } = await import("../doc-text.mjs")
    for (const d of await docsRelevantes(consulta, { limit: 2, excluir: (c) => hide.has(c.thread) || isSecret(c) })) {
      const { recortarUtil } = await import("../doc-text.mjs")
      docLines.push(`- (documento: ${d.filename || "adjunto"}) ${recortarUtil(d.texto, question, 6000).replace(/\s+/g, " ")}`)
    }
  } catch { /* sin extracción: el grafo responde como antes */ }
  const ctx = srcThreads.slice(0, 4).map((s) => `• ${s.name}: ${s.summary}`).filter(Boolean).join("\n") + "\n\nMENSAJES:\n" + msgLines.slice(0, 16).join("\n") + (docLines.length ? "\n\nDOCUMENTOS:\n" + docLines.join("\n") : "")
  const alcance = ventG.etiqueta ? `\nSOLO estás viendo lo de ${ventG.etiqueta}. Si no hay nada, decí exactamente eso — no busques más atrás ni contestes con cosas viejas.` : ""
  const prompt = `Sos el asistente personal de ${ownerFirst()}. Abajo hay RESÚMENES y MENSAJES reales de sus conversaciones más relevantes para la pregunta.${alcance}
Respondé en 1 a 4 frases, en español, usando SOLO eso. Nombrá personas, proyectos y montos concretos. Si no alcanza, decí qué falta. NO inventes.

${historial.length ? `CONVERSACIÓN PREVIA (para entender a qué se refiere):\n${historial.slice(-6).map((m) => `${m.role === "me" ? ownerFirst() : "vos"}: ${String(m.text).replace(/\s+/g, " ").slice(0, 220)}`).join("\n")}\n\n` : ""}PREGUNTA: ${question}

${ctx}

RESPUESTA:`
  const answer = await llm(prompt, { system: UNTRUSTED_NOTE, chain: process.env.LLM_CHAIN_ASK || "gemini,ollama", temperature: 0.2, task: "router", bypassCap: true }).then((s) => humanizarIds((s || "").trim())).catch(() => "")
  return { mode: "facets", engine, type: "answer", answer, matches: msgLines.length, matched: r.matched, threads: srcThreads.slice(0, 4) }
}
