// Notetaker de reuniones/llamadas. Recibe una grabación (del agente del Mac o del Android), la transcribe (HÍBRIDO:
// whisper self-hosted si es SENSIBLE, Gemini si no), la resume con puntos de acción, y la guarda como un hilo "Reunión"
// en el inbox, linkeada al evento de calendar. La captura de audio vive en el cliente (Mac/Android); acá se procesa.
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "fs"
import { ownerFirst } from "./hub.mjs"
import { join } from "path"
import { tmpdir } from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import { insertMany, updateMessageContent, rebuildMessagesFts, messageById } from "./db.mjs"
const pexecFile = promisify(execFile)
import { casPutBuffer } from "./cas.mjs"
import { llm, smartChain, geminiUploadFile, geminiMultimodal } from "./llm.mjs"
import { transcribeWhisper, whisperAvailable } from "./whisper.mjs"

const AUDIO_MIME = { ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", mp3: "audio/mp3", m4a: "audio/aac", aac: "audio/aac", wav: "audio/wav", amr: "audio/amr", flac: "audio/flac", mp4: "audio/mp4", webm: "audio/webm" }
const extOf = (s) => (String(s || "").split(".").pop() || "").toLowerCase()
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v", "3gp", "flv", "wmv"])
// grabaciones de video (Meet, screen recordings) → extraer solo el audio (m4a chico) para transcribir. -nostdin evita el cuelgue vía execFile.
async function toAudioBuffer(buf, ext) {
  if (!VIDEO_EXT.has(ext)) return { buf, ext }
  const inF = join(tmpdir(), `vid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`)
  const outF = inF.replace(/\.[^.]+$/, ".m4a")
  try {
    writeFileSync(inF, buf)
    await pexecFile("ffmpeg", ["-nostdin", "-y", "-i", inF, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k", outF], { timeout: 15 * 60000 })
    return { buf: readFileSync(outF), ext: "m4a" }
  } catch { return { buf, ext } } // si falla la extracción, dejamos el archivo original (Gemini igual puede con video)
  finally { try { unlinkSync(inF) } catch {} try { unlinkSync(outF) } catch {} }
}

// ── palabras que marcan una reunión como SENSIBLE (→ transcripción self-hosted, sin nube) ──
const SENS_KW = (process.env.SENSITIVE_KEYWORDS || "inversor,investor,fundrais,due diligence,legal,confidencial,board,directorio,term sheet,cap table,valuation,salario,sueldo,abogad,contrato,demanda").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean)
export function isSensitiveMeeting(title = "", attendees = []) {
  const hay = `${title} ${(attendees || []).join(" ")}`.toLowerCase()
  return SENS_KW.some((k) => hay.includes(k))
}

// ── enlazar la grabación con el evento de calendar más cercano (±45 min) → título + participantes automáticos ──
function calendarEvents() {
  const out = []
  for (const f of ["calendar.jsonl", "calendar-google.jsonl"]) {
    const p = `./data/${f}`; if (!existsSync(p)) continue
    for (const line of readFileSync(p, "utf8").split("\n")) { if (!line.trim()) continue; try { out.push(JSON.parse(line)) } catch {} }
  }
  return out
}
export function matchCalendarEvent(ts) {
  let best = null, bestDiff = 45 * 60000
  for (const e of calendarEvents()) {
    if (!e.start || e.allDay) continue
    const s = new Date(e.start).getTime(), en = e.end ? new Date(e.end).getTime() : s + 3600000
    const diff = ts >= s && ts <= en ? 0 : Math.min(Math.abs(ts - s), Math.abs(ts - en))
    if (diff < bestDiff) { best = e; bestDiff = diff }
  }
  return best
}

// ── transcripción HÍBRIDA ──
async function transcribeRecording(audioPath, { sensitive, lang = "es" }) {
  if (sensitive && whisperAvailable()) return { transcript: await transcribeWhisper(audioPath, { lang }), engine: "whisper-local (privado)" }
  // FAIL-CLOSED: sensible SIN whisper local NO se sube a la nube (audio íntegro de la reunión). Antes caía al Gemini de abajo = fuga silenciosa
  // en cualquier self-host fresco (whisper no viene instalado). Escape consciente: SENSITIVE_ALLOW_CLOUD=1.
  if (sensitive && process.env.SENSITIVE_ALLOW_CLOUD !== "1") throw new Error("transcripción sensible sin whisper local → NO subo el audio a la nube (instalá whisper, o SENSITIVE_ALLOW_CLOUD=1 para aceptarlo)")
  try { // no sensible (o escape explícito) → Gemini (rápido, alta calidad, distingue hablantes). Inline si es chico; Files API si es grande.
    const mime = AUDIO_MIME[extOf(audioPath)] || "audio/mp4"
    const size = statSync(audioPath).size
    const part = size <= 15 * 1024 * 1024 ? { mime, data: readFileSync(audioPath).toString("base64") } : (({ mime: m, uri }) => ({ mime: m, uri }))(await geminiUploadFile(audioPath, mime))
    const t = await geminiMultimodal(
      "Transcribí este audio de una reunión/llamada palabra por palabra, en el idioma original. Si distinguís hablantes distintos, marcá cada intervención con su turno. Devolvé SOLO la transcripción, sin comentarios.",
      [part], { temperature: 0 })
    return { transcript: (t || "").trim(), engine: "gemini" }
  } catch (e) {
    if (whisperAvailable()) return { transcript: await transcribeWhisper(audioPath, { lang }), engine: "whisper-fallback" }
    throw e
  }
}

// ── resumen + puntos de acción ──
// ollama en este box (sin GPU) CUELGA cuando el daemon lo satura; llm() solo cae a gemini si ollama *tira error*, no si *cuelga*.
// Por eso envolvemos con timeout: si ollama no responde a tiempo → reintento con gemini. (El audio ya se transcribió local; el resumen es texto derivado.)
const withTimeout = (p, ms) => { let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("llm-timeout")), ms) }); return Promise.race([p, to]).finally(() => clearTimeout(t)) } // clearTimeout: el timer no queda colgando cuando p gana la race
async function llmSafe(prompt, opts, ms = 120000) {
  try { return ((await withTimeout(llm(prompt, opts), ms)) || "").trim() }
  catch {
    // FALLBACK ante timeout/hang de ollama. RESPETA la privacidad: si el chain es LOCAL-ONLY (reunión sensible sin escape) NUNCA cae a la
    // nube — devuelve "" (sin resumen antes que fuga). El guard de llm() no llegaba acá: era el incidente de cloud-leak un nivel arriba.
    const req = String(opts.chain || "").split(",").map((s) => s.trim()).filter(Boolean)
    if (req.length && req.every((p) => p === "ollama")) return ""
    try { return ((await withTimeout(llm(prompt, { ...opts, chain: "gemini" }), 60000)) || "").trim() } catch { return "" }
  }
}
export async function summarizeMeeting(transcript, { title, attendees, sensitive }) {
  // #30: sensibilidad por CONTENIDO — una reunión "sync" que termina hablando de cap table/salarios debe resumirse LOCAL.
  // (regex sobre el transcript ya en el server, sin mandar nada a la nube para decidirlo). Escala, nunca desescala.
  if (!sensitive && SENS_KW.some((k) => (transcript || "").toLowerCase().includes(k))) sensitive = true
  const sys = `Sos el asistente de reuniones de ${ownerFirst()}. Te doy la transcripción de una reunión/llamada. Devolvé en español, directo y humano (no suenes a IA): (1) 3-6 viñetas con lo que se habló y se decidió; (2) una sección "Puntos de acción:" con quién hace qué (marcá con ⚠️ lo que le toca a ${ownerFirst()}); (3) fechas/compromisos si los hay. No inventes; si algo no queda claro, decilo. Nada de relleno.`
  // FAIL-CLOSED: el chain sensible sale de smartChain() — FUENTE ÚNICA (antes había una copia inline que divergió: aceptaba LLM_CHAIN_SENSITIVE
  // sin el escape → fuga). smartChain: solo local, salvo SENSITIVE_ALLOW_CLOUD=1. Así el test de privacidad ancla en el mismo punto que prod.
  const chain = sensitive ? smartChain({ sensitive: true, feature: "meetings" }) : (process.env.LLM_CHAIN_CATCHUP || "gemini,ollama")
  // MAP-REDUCE: antes cortaba a 30k chars (~15 min) → una reunión de 2h se resumía solo por el primer cuarto y se perdía el resto.
  // Ahora resume por TRAMOS (map) y unifica los resúmenes parciales (reduce) → captura la reunión ENTERA.
  const CHUNK = 24000
  let material = transcript, note = "Transcripción"
  if (transcript.length > CHUNK) {
    const chunks = []
    for (let i = 0; i < transcript.length && chunks.length < 20; i += CHUNK) chunks.push(transcript.slice(i, i + CHUNK)) // cap 20 tramos (~480k)
    const partials = []
    for (let ci = 0; ci < chunks.length; ci++) {
      const p = await llmSafe(`Tramo ${ci + 1} de ${chunks.length} de la reunión "${title || ""}". Resumí en viñetas SOLO lo que se dijo/decidió en ESTE tramo (sin inventar):\n${chunks[ci]}`, { system: sys, feature: "meetings", chain, temperature: 0.3 })
      if (p) partials.push(`— Tramo ${ci + 1}/${chunks.length} —\n${p}`)
    }
    material = partials.join("\n\n"); note = "Resúmenes por tramo de la reunión completa"
  }
  const prompt = `Reunión: ${title || "(sin título)"}${attendees?.length ? ` · Participantes: ${attendees.join(", ")}` : ""}\n\n${note}:\n${material.slice(0, 30000)}\n\nResumen + puntos de acción:`
  const full = await llmSafe(prompt, { system: sys, feature: "meetings", chain, temperature: 0.3 })
  // el pitch se deriva del RESUMEN COMPLETO (no de los primeros 6k de transcripción) → refleja toda la reunión
  const pitch = (await llmSafe(`En 1 frase (máx 20 palabras), lo más importante de esta reunión para ${ownerFirst()}:\n${(full || transcript).slice(0, 6000)}`, { feature: "meetings", chain, temperature: 0.3 })).replace(/\s+/g, " ")
  return { full, pitch }
}

const escH = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
function meetingBody({ full, transcript, engine, attendees, durationSec }) {
  return `<div style="font-family:system-ui;line-height:1.6;color:#111">
    <h3 style="margin:0 0 6px">Resumen</h3><div style="white-space:pre-wrap">${escH(full)}</div>
    ${attendees?.length ? `<p style="margin:12px 0 4px"><b>Participantes:</b> ${escH(attendees.join(", "))}</p>` : ""}
    <p style="color:#888;font-size:13px;margin:6px 0 14px">Transcrito con ${escH(engine)}${durationSec ? ` · ${Math.round(durationSec / 60)} min` : ""}</p>
    <h3 style="margin:0 0 6px">Transcripción completa</h3><div style="white-space:pre-wrap;color:#333;font-size:14px">${escH(transcript)}</div>
  </div>`
}

function updateMeeting(id, { text, body, summary }) {
  updateMessageContent(id, { text, body, summary })
  try { rebuildMessagesFts() } catch {}
}

// ── ingesta: guarda audio en CAS, crea el hilo (placeholder), y procesa en background (fire-and-forget, 1 job por reunión) ──
export async function ingestRecording({ audioBuffer, audioPath, title, ts = Date.now(), attendees = [], source = "mac", sensitive, lang = "es", durationSec, ext }) {
  ext = (ext || extOf(audioPath) || "m4a").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "m4a" // NO derivar del título
  let buf = audioBuffer || (audioPath ? readFileSync(audioPath) : null)
  if (!buf || !buf.length) return { error: "sin audio" }
  ;({ buf, ext } = await toAudioBuffer(buf, ext)) // video (Meet) → audio
  const media = casPutBuffer(buf, ext, `meeting/${title || source}`)
  const ev = matchCalendarEvent(ts) // auto-título/participantes desde el calendar
  if (ev) { if (!title) title = ev.title; if (!attendees.length) attendees = ev.attendees || [] }
  title = title || "Reunión"
  if (sensitive == null) sensitive = isSensitiveMeeting(title, attendees)
  const id = `meeting:${ts}:${Math.random().toString(36).slice(2, 8)}`
  insertMany([{ id, channel: "meeting", account: source, thread: id, jid: `meeting:${ts}`, sender: "", name: title, text: "⏳ Transcribiendo la reunión…", ts, dir: "in", media, mediaType: "meeting" }])
  const localAudio = join(process.cwd(), "data", media.replace(/^\//, ""))
  void processMeeting({ id, localAudio, title, attendees, sensitive, lang, durationSec }).catch((e) => { console.error("[meeting] proc:", e.message); try { updateMeeting(id, { text: `⚠️ No se pudo procesar la reunión: ${e.message}` }) } catch {} })
  return { id, title, sensitive, engine: sensitive ? "whisper-local" : "gemini", status: "processing" }
}

async function processMeeting({ id, localAudio, title, attendees, sensitive, lang, durationSec }) {
  const { transcript, engine } = await transcribeRecording(localAudio, { sensitive, lang })
  if (!transcript) { updateMeeting(id, { text: "⚠️ No se pudo transcribir la reunión (audio vacío o inaudible)." }); return }
  const { full, pitch } = await summarizeMeeting(transcript, { title, attendees, sensitive })
  const text = `📅 ${title}${pitch ? ` — ${pitch}` : ""}\n\n${full}`.slice(0, 4000)
  updateMeeting(id, { text, body: meetingBody({ full, transcript, engine, attendees, durationSec }), summary: pitch || (full.split("\n").find(Boolean) || "").slice(0, 140) })
  console.log(`[meeting] ${id} listo · ${engine} · ${transcript.length} chars · sensitive=${sensitive}`)
}

// reprocesar (debug/reintento)
export async function reprocessMeeting(id) {
  const m = messageById(id)
  if (!m || !m.media) return { error: "no existe" }
  const localAudio = join(process.cwd(), "data", m.media.replace(/^\//, ""))
  await processMeeting({ id, localAudio, title: m.name, attendees: [], sensitive: isSensitiveMeeting(m.name), lang: "es" })
  return { ok: true }
}
