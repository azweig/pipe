// Transcribe + RESUME (no literal) las notas de voz RECIBIDAS nuevas → columna `summary`. La app muestra el resumen bajo el player.
// Solo audios NUEVOS (a partir del primer run; nada retroactivo). Corre desde el daemon cada ~2 min. Batch chico → costo acotado.
// Uso: node src/audio-summarize.mjs
import { loadEnv } from "./lib/env.mjs"
loadEnv() // self-suficiente: sin esto, corrido standalone (o spawn sin env heredado) NO ve WHISPER_URL → stt saltea whisper LOCAL y cae a la nube (falla/leak).
import { readFileSync, existsSync } from "fs"
import { audioToSummarize, setMessageSummary, getMeta, setMeta } from "./lib/db.mjs"
import { stt } from "./lib/voice.mjs"
import { llm } from "./lib/llm.mjs"

const NOW = Date.now()
const BATCH = +process.env.AUDIO_SUMMARY_BATCH || 12

// mime real según la extensión del archivo en CAS (no todos los audios son .ogg: iOS/adjuntos vienen .m4a, etc).
// Sin esto, mandar un .m4a etiquetado como audio/ogg hace que OpenAI Whisper lo rechace con 400 "Invalid file format".
export function mimeFor(media) {
  const ext = String(media || "").split(".").pop().toLowerCase()
  return ({ ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", mpeg: "audio/mpeg", mpga: "audio/mpeg", wav: "audio/wav", webm: "audio/webm", flac: "audio/flac" })[ext] || "audio/ogg"
}

// prompt de resumen de nota de voz: fiel, que SE ENTIENDA sin escuchar, largo ADAPTATIVO (no aplastar el contenido).
export function audioSummaryPrompt(text) {
  return `Esta es la transcripción de una NOTA DE VOZ que me mandaron:

"${text}"

Resumí en español QUÉ dijo o pidió la persona, de forma que se entienda sin escuchar el audio. Captá los puntos clave CONCRETOS: qué pide o informa, nombres, números, montos, decisiones, plazos, y qué necesita de mí.
- Si es corto o trivial (un saludo, "ok", "llamame"), una sola frase.
- Si tiene contenido real, usá 1 a 3 frases (hasta ~45 palabras). NO lo compactes tanto que se pierda la información concreta — que quede claro de qué se trata.
Fiel al audio, NO transcribas literal pero NO inventes ni agregues nada que no se haya dicho. Devolvé SOLO el resumen, sin comillas ni prefijos.`
}

// resume un lote de audios (id+media) con STT + el prompt adaptativo. Reutilizable (cron + backfills). Devuelve #hechos.
export async function summarizeBatch(rows) {
  let done = 0
  // dead-letter DURABLE: un audio que falla siempre (0 bytes, ffmpeg ausente, 400, >25MB) copaba el batch (ORDER BY ts DESC LIMIT 12)
  // y se reintentaba para siempre pagando STT cada 2 min. Contamos intentos por id en meta; tras 3, lo marcamos y sale del SELECT.
  let fails = {}; try { fails = JSON.parse(getMeta("audio_summary_fails") || "{}") } catch {}
  let dirty = false
  const clear = (id) => { if (fails[id] != null) { delete fails[id]; dirty = true } }
  for (const r of rows) {
    const path = "./data" + r.media // media = /cas/xx/hash.ext → archivo en ./data/cas/...
    if (!existsSync(path)) { setMessageSummary(r.id, "(audio no disponible)"); clear(r.id); continue } // marca no-vacía → no reintentar infinito
    try {
      const text = (await stt(readFileSync(path), mimeFor(r.media))).trim()
      if (!text || text.length < 2) { setMessageSummary(r.id, "(sin voz clara)"); clear(r.id); continue }
      const sum = (await llm(audioSummaryPrompt(text), { area: "summarize", temperature: 0.2, task: "audio-summary" })).trim().replace(/^["']+|["']+$/g, "")
      setMessageSummary(r.id, (sum || "(sin resumen)").slice(0, 600)); done++; clear(r.id)
    } catch (e) {
      const n = (fails[r.id] || 0) + 1; fails[r.id] = n; dirty = true
      console.error("[audio-summary]", r.id, `intento ${n}/3:`, e.message)
      if (n >= 3) { setMessageSummary(r.id, "(no se pudo transcribir)"); delete fails[r.id] } // dead-letter → sale del SELECT
    }
  }
  if (dirty) setMeta("audio_summary_fails", JSON.stringify(fails))
  return done
}

async function run() {
  // piso temporal: solo audios a partir de que se activó la función (el usuario pidió SOLO los nuevos)
  let from = +(getMeta("audio_summary_from") || 0)
  if (!from) { from = NOW; setMeta("audio_summary_from", String(from)); console.log(`[audio-summary] piso inicial: ${new Date(from).toISOString()}`) }
  // audios nuevos sin resumen: los RECIBIDOS + tus NOTAS DE VOZ propias (thread='self') → resumen bajo el player y en Notas
  const rows = audioToSummarize(from, { limit: BATCH })
  if (!rows.length) { console.log("[audio-summary] nada nuevo"); return }
  const done = await summarizeBatch(rows)
  console.log(`[audio-summary] ${done}/${rows.length} resumidos`)
}

// solo corre el cron si se invoca como CLI (así importar el módulo para reusar el prompt NO dispara el batch)
if (process.argv[1] && process.argv[1].endsWith("audio-summarize.mjs")) run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
