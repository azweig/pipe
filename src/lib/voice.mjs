// Capa de voz — TTS (que te hable) + STT (que te escuche). Multi-proveedor, arranca con OpenAI (Whisper + tts).
// VOICE_CHAIN futuro: openai → gemini → local(GPU box, tu voz clonada). Hoy: OpenAI.
import { writeFileSync, unlinkSync, readFileSync } from "fs"
import { execFile } from "child_process"
import { providerKey, sttMode, cloudOverCap, trackDaily } from "./llm.mjs"
import { whisperAvailable, transcribeWhisper } from "./whisper.mjs"

// Normaliza cualquier audio a mp3 mono 16k con ffmpeg. Whisper a veces rechaza contenedores válidos (ej: m4a con brand 3GPP)
// aunque la extensión esté en su lista; transcodificar garantiza aceptación y reduce el upload. Async (no bloquea el server).
function transcodeToMp3(buf, srcExt) {
  return new Promise((resolve, reject) => {
    const base = `/tmp/stt_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const inF = `${base}.${srcExt || "bin"}`, outF = `${base}.mp3`
    try { writeFileSync(inF, buf) } catch (e) { return reject(e) }
    execFile("ffmpeg", ["-y", "-i", inF, "-ac", "1", "-ar", "16000", "-b:a", "64k", outF], { maxBuffer: 1 << 24 }, (err) => {
      try { if (err) reject(err); else resolve(readFileSync(outF)) }
      catch (e) { reject(e) }
      finally { try { unlinkSync(inF) } catch {}; try { unlinkSync(outF) } catch {} }
    })
  })
}
// idem pero a WAV 16k mono — lo que espera whisper. Se manda al servicio local de la GPU box.
function transcodeToWav(buf, srcExt) {
  return new Promise((resolve, reject) => {
    const base = `/tmp/stt_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const inF = `${base}.${srcExt || "bin"}`, outF = `${base}.wav`
    try { writeFileSync(inF, buf) } catch (e) { return reject(e) }
    execFile("ffmpeg", ["-y", "-i", inF, "-ac", "1", "-ar", "16000", outF], { maxBuffer: 1 << 24 }, (err) => {
      try { if (err) reject(err); else resolve(readFileSync(outF)) }
      catch (e) { reject(e) }
      finally { try { unlinkSync(inF) } catch {}; try { unlinkSync(outF) } catch {} }
    })
  })
}
// STT LOCAL vía faster-whisper en la GPU box (~0.4s) — PRIVADO: el audio NO sale a la nube. Se activa con WHISPER_URL (+ WHISPER_TOKEN).
const whisperSvc = () => (process.env.WHISPER_URL || "").replace(/\/$/, "")
async function sttViaService(buf, mime) {
  const wav = await transcodeToWav(buf, audioExt(mime)) // whisper quiere wav 16k; ffmpeg normaliza cualquier formato (incl. webm sin cabecera)
  const fd = new FormData()
  fd.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav")
  const r = await fetch(whisperSvc() + "/stt?language=es", { method: "POST", headers: { Authorization: "Bearer " + (process.env.WHISPER_TOKEN || "") }, body: fd, signal: AbortSignal.timeout(60000) })
  if (!r.ok) throw new Error(`whisper-svc ${r.status}`)
  return ((await r.json()).text || "").trim()
}
// #5: transcribe audio O VIDEO con auto-detección de idioma (inglés/japonés/etc) → { text, lang }. ffmpeg extrae el audio del video.
export async function transcribeMedia(buf, ext) {
  if (!whisperSvc()) throw new Error("transcripción local no disponible (falta WHISPER_URL)")
  const wav = await transcodeToWav(buf, ext || "bin")
  const fd = new FormData()
  fd.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav")
  const r = await fetch(whisperSvc() + "/stt?language=", { method: "POST", headers: { Authorization: "Bearer " + (process.env.WHISPER_TOKEN || "") }, body: fd, signal: AbortSignal.timeout(180000) }) // language vacío = auto-detect
  if (!r.ok) throw new Error(`whisper-svc ${r.status}`)
  const j = await r.json()
  return { text: (j.text || "").trim(), lang: j.lang || null }
}
const OA = () => providerKey("openai") // BYOK: la key sale de la config del hub (o del .env como fallback)

export const VOICES = [
  { id: "coral", label: "Coral", desc: "cálida y cercana (f)" },
  { id: "nova", label: "Nova", desc: "clara y amable (f)" },
  { id: "shimmer", label: "Shimmer", desc: "suave y serena (f)" },
  { id: "sage", label: "Sage", desc: "tranquila y natural (f)" },
  { id: "ash", label: "Ash", desc: "natural y relajada (m)" },
  { id: "onyx", label: "Onyx", desc: "grave y con presencia (m)" },
  { id: "echo", label: "Echo", desc: "calma y clara (m)" },
  { id: "ballad", label: "Ballad", desc: "expresiva y cálida (m)" },
]
const DEFAULT_INSTRUCTIONS = "Hablás en español rioplatense, con tono cálido, humano, natural y conversacional — como un asistente cercano de confianza. Ritmo relajado y expresivo, nunca monótono ni robótico."

// texto → audio mp3 (Buffer)
export async function tts(text, { voice = process.env.TTS_VOICE || "coral", model = process.env.TTS_MODEL || "gpt-4o-mini-tts", instructions = DEFAULT_INSTRUCTIONS } = {}) {
  if (!OA()) throw new Error("falta OPENAI_API_KEY")
  if (cloudOverCap()) throw new Error("tts: presupuesto de nube agotado (HARD_CAP)") // hueco del incidente cloud-leak: tts hacía su fetch por fuera del medidor (igual que stt en su día)
  const payload = { model, voice, input: (text || "").slice(0, 4000), response_format: "mp3" }
  if (model.includes("gpt-4o") && instructions) payload.instructions = instructions // solo gpt-4o-mini-tts soporta tono
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST", headers: { Authorization: `Bearer ${OA()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(60000), // sin timeout, un socket colgado cuelga el cron de home-brief para siempre (ver llm.mjs:29)
  })
  if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 150)}`)
  const audio = Buffer.from(await res.arrayBuffer())
  trackDaily("openai", Math.ceil((payload.input.length || 0) / 4), "tts") // registra el TTS en el ledger de nube para que el HARD_CAP lo cuente (proxy: chars/4)
  return audio
}

// extensión de archivo canónica según el mime del audio → el codec que Whisper (local u OpenAI) espera por el nombre del archivo.
export function audioExt(mime = "") {
  return /ogg|opus/.test(mime) ? "ogg" : /mp4|m4a|aac/.test(mime) ? "m4a" : /mp3|mpeg/.test(mime) ? "mp3" : /wav/.test(mime) ? "wav" : /flac/.test(mime) ? "flac" : "webm"
}

// audio → texto. SELF-HOSTED primero si el hub lo pide (stt=local) o si no hay key OpenAI pero whisper.cpp está: el audio NUNCA sale.
export async function stt(buf, mime = "audio/webm") {
  // 1) servicio whisper LOCAL (GPU box, faster-whisper): rápido + PRIVADO. Preferido cuando el hub eligió stt=local (o no hay nube).
  if ((sttMode() === "local" || !OA()) && whisperSvc()) {
    try { const t = await sttViaService(buf, mime); if (t) return t } catch (e) { if (process.env.LLM_DEBUG) console.error("[stt] whisper-svc falló, sigo al fallback:", e.message) }
  }
  // 2) whisper.cpp local en el server (si está compilado con modelo real)
  if ((sttMode() === "local" || !OA()) && whisperAvailable()) {
    const ext = audioExt(mime)
    const f = `/tmp/stt_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    try { writeFileSync(f, buf); return (await transcribeWhisper(f, { lang: "es" })).trim() }
    finally { try { unlinkSync(f) } catch {} }
  }
  // Elegiste transcripción LOCAL: si no hay backend local disponible, esto CORTA. Antes seguía de largo y le mandaba el
  // audio crudo a OpenAI sin decir nada — el usuario había pedido explícitamente que el audio no saliera de la máquina.
  // Quedarse sin transcripción es un problema; mandar la nota de voz a un tercero a espaldas del usuario es otro.
  if (sttMode() === "local") throw new Error("stt: configuraste transcripción LOCAL y no hay whisper disponible (WHISPER_URL o whisper.cpp). NO mando el audio a la nube.")
  if (!OA()) throw new Error("no hay transcripción configurada (ni OpenAI ni whisper local)")
  // HARD_CAP de nube reventado → NO gastar STT en la nube (hueco del incidente cloud-leak: stt hacía su fetch por fuera del medidor).
  // Cae a whisper local si está disponible; si no, corta en vez de seguir sangrando el key managed.
  if (cloudOverCap()) {
    if (whisperAvailable()) {
      const el = audioExt(mime)
      const fl = `/tmp/stt_${Date.now()}_${Math.random().toString(36).slice(2)}.${el}`
      try { writeFileSync(fl, buf); return (await transcribeWhisper(fl, { lang: "es" })).trim() }
      finally { try { unlinkSync(fl) } catch {} }
    }
    throw new Error("stt: presupuesto de nube agotado (HARD_CAP) y sin whisper local")
  }
  // el nombre de archivo debe coincidir con el formato real: OpenAI infiere el codec por la extensión → si sube .webm siendo m4a, 400.
  const ext = audioExt(mime)
  const post = async (b, m, fn) => {
    const form = new FormData()
    form.append("file", new Blob([b], { type: m }), fn)
    form.append("model", process.env.STT_MODEL || "whisper-1")
    form.append("language", "es")
    return fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OA()}` }, body: form, signal: AbortSignal.timeout(120000) }) // idem: sin timeout, un socket colgado nunca rechaza
  }
  // El webm/ogg de MediaRecorder (PWA) suele venir SIN cabecera de duración → OpenAI lo rechaza (400) y recién ahí transcodeábamos:
  // eran 2 round-trips (~18s). Lo pasamos a mp3 ANTES (ffmpeg reescribe cabeceras) → una sola llamada (~5s). m4a/mp3/wav van directo.
  let sendBuf = buf, sendMime = mime, sendName = `audio.${ext}`, pretranscoded = false
  if (/^(webm|ogg|oga|opus)$/.test(ext)) {
    try { sendBuf = await transcodeToMp3(buf, ext); sendMime = "audio/mpeg"; sendName = "audio.mp3"; pretranscoded = true } catch {} // si ffmpeg falla, mandamos el original y dejamos que el retry de abajo actúe
  }
  let res = await post(sendBuf, sendMime, sendName)
  if (!res.ok) {
    const err = await res.text()
    // formato rechazado (ej. m4a/3GPP) → transcodificar a mp3 con ffmpeg y reintentar UNA vez (si no lo pre-transcodeamos ya)
    if (res.status === 400 && !pretranscoded && /file format|invalid|decode|could not/i.test(err)) {
      const mp3 = await transcodeToMp3(buf, ext)
      res = await post(mp3, "audio/mpeg", "audio.mp3")
      if (!res.ok) throw new Error(`stt ${res.status} (post-ffmpeg): ${(await res.text()).slice(0, 150)}`)
    } else throw new Error(`stt ${res.status}: ${err.slice(0, 150)}`)
  }
  const out = (await res.json()).text || ""
  // registra el STT en el ledger de nube para que el HARD_CAP lo cuente. Proxy: voz comprimida ~12KB/s; 1 min ≈ 10k tok-equivalentes.
  trackDaily("openai", Math.min(40000, Math.round(buf.length / 72)), "stt")
  return out
}
