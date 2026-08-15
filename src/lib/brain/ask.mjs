// brain/ask — RAG semántico (embeddings + FTS) + router-search por facetas/grafo. Leaf (ask↔routerSearch internos).
import { existsSync, statSync, readFileSync } from "fs"
import { embed, topK } from "../embed.mjs"
import { route as routeFacets, activate as activateGraph } from "../router.mjs"
import { search as dbSearch, searchBody as dbSearchBody, conversationsByThreads as dbConvsByThreads, filesByTerms as dbFilesByTerms, mediaInThreads as dbMediaInThreads, bodyMatchInThreads as dbBodyMatch, recentInThread as dbRecentInThread, messageById as dbMessageById } from "../db.mjs"
import { llm, smartChain } from "../llm.mjs"
import { UNTRUSTED_NOTE } from "../safety.mjs"
import { ownerFirst } from "../hub.mjs"
import { stripWA } from "./kernel/keys.mjs"
import { cleanMsg } from "./kernel/convo.mjs"

// índice RAG cacheado (se recarga solo si el archivo cambió)
let _rag = null, _ragMtime = 0
function ragIndex() {
  const f = "./data/rag.jsonl"
  if (!existsSync(f)) return []
  const m = statSync(f).mtimeMs
  if (_rag && m === _ragMtime) return _rag
  // LEER POR BUFFER, no como un string: rag.jsonl puede pasar los ~512MB del límite de string de Node (ERR_STRING_TOO_LONG) → el
  // RAG semántico se caía en silencio (todo el cerebro degradado a FTS). Los Buffers SÍ superan ese límite; parseamos línea por línea.
  const out = []
  try {
    const buf = readFileSync(f) // Buffer (sin límite de 512MB)
    let start = 0
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) { // '\n'
        if (i > start) { try { const o = JSON.parse(buf.toString("utf8", start, i)); if (o) out.push(o) } catch {} }
        start = i + 1
      }
    }
    if (start < buf.length) { try { const o = JSON.parse(buf.toString("utf8", start)); if (o) out.push(o) } catch {} }
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
  for (const it of semantic) { if (seen.has(it.id) || !visibleSem(it)) continue; seen.add(it.id); ctxItems.push({ ts: it.ts, label: it.kind === "note" ? "🧠 " + it.ref : it.ref, text: it.text }) }
  try { for (const r of dbSearch(question, { limit: 22, byRank: true })) { const k = "fts:" + r.id; if (seen.has(k) || secretKeys.has(r.thread) || isSecret(r)) continue; seen.add(k); ctxItems.push({ ts: r.ts, label: `${r.channel} ${stripWA(r.grp || r.name || "")}`, text: cleanMsg(r.text) }) } } catch {}
  try { for (const r of dbSearchBody(question, { limit: 8 })) { const k = "body:" + r.thread + ":" + r.ts; if (seen.has(k) || secretKeys.has(r.thread) || isSecret({ ...r, channel: "email" })) continue; seen.add(k); ctxItems.push({ ts: r.ts, label: `email ${stripWA(r.name || "")}`, text: cleanMsg(String(r.snip || "").replace(/<[^>]+>/g, " ")) }) } } catch {}
  ctxItems.sort((a, b) => (a.ts || 0) - (b.ts || 0))
  return { items: ctxItems.slice(0, limit), semanticOk }
}

// `localOnly`: la pregunta viene de una línea SECRETA → el modelo que razona sobre tu historial tiene que ser local.
// Antes esta función imponía su propia cadena (nube primero) y el llamador solo cuidaba la síntesis final, así que el
// contexto igual pasaba por un tercero.
export async function ask(question, { localOnly = false } = {}) {
  const fmt = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ")
  const { items: ctxItems, semanticOk } = await retrieveContext(question, { limit: 28 })
  if (!semanticOk) console.warn("[ask] RAG semántico no disponible (Ollama caído) → respondo solo por búsqueda de palabras (FTS)") // #29: ya no es silencioso
  const ctx = ctxItems.map((e) => `- (${e.label}, ${fmt(e.ts).slice(0, 10)}) ${(e.text || "").replace(/\s+/g, " ").slice(0, 200)}`).join("\n")
  // TODO LOCAL: respuesta con modelo chico/rápido en el server (privado). Prompt claro para que el modelo chico no se pierda.
  const prompt = `Sos el asistente personal de ${ownerFirst()}. Abajo hay FRAGMENTOS reales de sus mensajes y notas.
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
export async function routerSearch(question) {
  let r = activateGraph(question), engine = "grafo"       // v2: activación por difusión sobre el grafo ponderado
  if (!r.confident) { r = routeFacets(question); engine = "facetas" } // v1: presencia de facetas (fallback)
  if (!r.confident) { const a = await ask(question); return { mode: "rag", type: "answer", ...a, matched: r.matched } } // sin nodo claro → RAG de siempre (no perdemos recall)
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
  for (const m of dbSearch(question, { limit: 14, byRank: true })) { if (seenId.has(m.id) || !m.text || hide.has(m.thread) || isSecret(m)) continue; seenId.add(m.id); msgLines.push(line(m)); if (m.thread && !srcThreads.find((s) => s.key === m.thread)) srcThreads.push({ key: m.thread, name: nameOf(m.thread), summary: cmap[m.thread]?.summary || "", score: 0 }) } // 🔒
  // cuerpos de email (montos/fechas, fuera del FTS) — términos = entidades matcheadas + expansión por co-ocurrencia del grafo (juan→deuda)
  const stripB = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#\d+;|&gt;|&lt;|&amp;/g, " ").replace(/\s+/g, " ").trim()
  for (const m of dbBodyMatch(threads.slice(0, 3), [...(r.matched || []), ...(r.expand || [])], { limit: 3 })) { if (hide.has(m.thread) || isSecret({ ...m, channel: "email" })) continue; const s = stripB(m.body).slice(0, 260); if (s) msgLines.push(`- (${fmt(m.ts)}, ${m.name || "email"}) ${s}`) } // 🔒
  // FTS sobre cuerpos de email: encuentra montos/fechas por la PREGUNTA aunque estén en un body no ruteado (ej: la deuda)
  for (const m of dbSearchBody(question, { limit: 4 })) { if (hide.has(m.thread) || isSecret({ ...m, channel: "email" })) continue; const s = stripB(m.snip).replace(/\s+/g, " ").slice(0, 240); if (s) { msgLines.push(`- (${fmt(m.ts)}, ${m.name || "email"}) ${s}`); if (m.thread && !srcThreads.find((x) => x.key === m.thread)) srcThreads.push({ key: m.thread, name: nameOf(m.thread), summary: cmap[m.thread]?.summary || "", score: 0 }) } } // 🔒
  if (msgLines.length < 4) for (const t of threads.slice(0, 2)) for (const m of dbRecentInThread(t, { limit: 5 })) { if (!isSecret({ ...m, thread: t })) msgLines.push(line(m)) } // 🔒 (threads ya sin 100%-secretos; filtra parciales)
  const ctx = srcThreads.slice(0, 4).map((s) => `• ${s.name}: ${s.summary}`).filter(Boolean).join("\n") + "\n\nMENSAJES:\n" + msgLines.slice(0, 16).join("\n")
  const prompt = `Sos el asistente personal de ${ownerFirst()}. Abajo hay RESÚMENES y MENSAJES reales de sus conversaciones más relevantes para la pregunta.
Respondé en 1 a 4 frases, en español, usando SOLO eso. Nombrá personas, proyectos y montos concretos. Si no alcanza, decí qué falta. NO inventes.

PREGUNTA: ${question}

${ctx}

RESPUESTA:`
  const answer = await llm(prompt, { system: UNTRUSTED_NOTE, chain: process.env.LLM_CHAIN_ASK || "gemini,ollama", temperature: 0.2, task: "router", bypassCap: true }).then((s) => (s || "").trim()).catch(() => "")
  return { mode: "facets", engine, type: "answer", answer, matches: msgLines.length, matched: r.matched, threads: srcThreads.slice(0, 4) }
}
