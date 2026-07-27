// Extrae TAREAS (lo que te pidieron / quedó pendiente de tu lado) y PROMESAS (lo que VOS te comprometiste a hacer) de las
// conversaciones ACTIVAS recientes, vía LLM (NO_INVENT). Solo mensajes nuevos desde la última corrida. Guarda en todos/promesas.
// Corre desde el daemon cada ~10 min. Uso: node src/extract-actions.mjs
import { maxMessageTs, activeThreadsSince, threadTextTail, insertTodo, insertPromesa, getMeta, setMeta } from "./lib/db.mjs"
import { llm, smartChain } from "./lib/llm.mjs"
import { grounded, stripP, wordsOf } from "./lib/grounding.mjs"
import { createHash } from "crypto"

const NOW = Date.now(), DAY = 86400000
const MAX_THREADS = +process.env.EXTRACT_MAX_THREADS || 12
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim()
const keyOf = (kind, thread, text) => kind + ":" + createHash("sha1").update(thread + "|" + norm(text)).digest("hex").slice(0, 16)

// (el esquema de todos/promesas lo crea db-core/initSchema — antes había un CREATE TABLE redundante acá)

// piso: procesar solo mensajes nuevos desde la última corrida (arranca mirando 24h atrás)
let lastTs = +(getMeta("extract_last_ts") || 0) || (NOW - DAY)
const maxTs = maxMessageTs(NOW)

// hilos 1:1 REALES con actividad nueva (no email/grupos/status/spam/self)
const threads = activeThreadsSince(lastTs, { limit: MAX_THREADS })

if (!threads.length) { setMeta("extract_last_ts", String(maxTs)); console.log("[extract] nada nuevo"); process.exit(0) }

let nT = 0, nP = 0, nD = 0

for (const th of threads) {
  const msgs = threadTextTail(th.thread).reverse()
  const who = (th.name || "el contacto").replace(/\s*\(WA\)$/, "")
  const transcript = msgs.map((m) => `${m.dir === "out" ? "YO" : who}: ${(m.text || "").replace(/\s+/g, " ").slice(0, 240)}`).join("\n").slice(0, 4000)
  if (transcript.length < 40) continue
  const hayNorm = stripP(transcript), hayWords = wordsOf(transcript) // para verificar las citas
  const prompt = `Estos son los últimos mensajes de mi conversación con ${who} (yo aparezco como "YO"):

${transcript}

Extraé SOLO de lo que está escrito, y SOLO lo que sigue PENDIENTE (no lo ya resuelto). Devolvé JSON:
{"todos":[{"tarea":"algo concreto que me pidieron o que quedó de MI lado por hacer","cuando":"plazo/fecha si se menciona, si no vacío","cita":"la frase EXACTA del mensaje que lo respalda, copiada TEXTUAL"}],
 "promesas":[{"promesa":"algo que YO me comprometí a hacer y todavía falta","cuando":"plazo si hay, si no vacío","cita":"la frase EXACTA que lo respalda, copiada TEXTUAL"}]}
Reglas estrictas: solo cosas ACCIONABLES y aún pendientes; máximo 2 de cada; si no hay, array vacío; NO inventes ni supongas nada que no esté escrito.
La "cita" es OBLIGATORIA y debe ser una porción LITERAL de los mensajes de arriba (no la parafrasees); si no podés citar textual lo que respalda un ítem, NO lo incluyas.`
  let r
  // extract-actions es CRON/BATCH sobre el TEXTO COMPLETO de todos tus hilos activos → mismo class que graphify/enrich → local-only
  // vía smartChain (fail-closed). Antes mandaba el texto de tus conversaciones a OpenAI con un literal. Para nube consciente: SENSITIVE_ALLOW_CLOUD=1.
  try { r = await llm(prompt, { json: true, feature: "extract", chain: smartChain({ sensitive: true, feature: "extract" }), temperature: 0.1, task: "extract-actions" }) } catch (e) { console.error("[extract]", th.thread, e.message); continue } // feature → área private (GPU box); smartChain fallback
  for (const t of (r?.todos || []).slice(0, 2)) {
    const txt = (t.tarea || "").trim(); if (txt.length < 4) continue
    if (!grounded(t.cita, hayNorm, hayWords)) { nD++; continue } // NO_INVENT: sin cita verificable en el texto → descartar (posible alucinación)
    if (insertTodo(keyOf("todo", th.thread, txt), txt, th.thread, who, (t.cuando || "").slice(0, 40), th.mx, NOW, (t.cita || "").slice(0, 300)).changes) nT++
  }
  for (const p of (r?.promesas || []).slice(0, 2)) {
    const txt = (p.promesa || "").trim(); if (txt.length < 4) continue
    if (!grounded(p.cita, hayNorm, hayWords)) { nD++; continue } // idem: la promesa tiene que estar citada textual
    if (insertPromesa(keyOf("prom", th.thread, txt), txt, th.thread, who, (p.cuando || "").slice(0, 40), th.mx, NOW, (p.cita || "").slice(0, 300)).changes) nP++
  }
}

setMeta("extract_last_ts", String(maxTs))
console.log(`[extract] ${threads.length} hilos · ${nT} tareas · ${nP} promesas nuevas · ${nD} descartadas (sin cita verificable)`)
process.exit(0)
