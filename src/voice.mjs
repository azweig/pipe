// Capa de voz — TTS (que te hable) + STT (que te escuche). Multi-proveedor, arranca con OpenAI (Whisper + tts).
// VOICE_CHAIN futuro: openai → gemini → local(GPU box, tu voz clonada). Hoy: OpenAI.
import { writeFileSync, unlinkSync, readFileSync } from "fs"
import { execFile } from "child_process"
import { providerKey, sttMode } from "./llm.mjs"
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
  const payload = { model, voice, input: (text || "").slice(0, 4000), response_format: "mp3" }
  if (model.includes("gpt-4o") && instructions) payload.instructions = instructions // solo gpt-4o-mini-tts soporta tono
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST", headers: { Authorization: `Bearer ${OA()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 150)}`)
  return Buffer.from(await res.arrayBuffer())
}

// extensión de archivo canónica según el mime del audio → el codec que Whisper (local u OpenAI) espera por el nombre del archivo.
export function audioExt(mime = "") {
  return /ogg|opus/.test(mime) ? "ogg" : /mp4|m4a|aac/.test(mime) ? "m4a" : /mp3|mpeg/.test(mime) ? "mp3" : /wav/.test(mime) ? "wav" : /flac/.test(mime) ? "flac" : "webm"
}

// audio → texto. SELF-HOSTED primero si el hub lo pide (stt=local) o si no hay key OpenAI pero whisper.cpp está: el audio NUNCA sale.
export async function stt(buf, mime = "audio/webm") {
  if ((sttMode() === "local" || !OA()) && whisperAvailable()) {
    const ext = audioExt(mime)
    const f = `/tmp/stt_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    try { writeFileSync(f, buf); return (await transcribeWhisper(f, { lang: "es" })).trim() }
    finally { try { unlinkSync(f) } catch {} }
  }
  if (!OA()) throw new Error("no hay transcripción configurada (ni OpenAI ni whisper local)")
  // el nombre de archivo debe coincidir con el formato real: OpenAI infiere el codec por la extensión → si sube .webm siendo m4a, 400.
  const ext = audioExt(mime)
  const post = async (b, m, fn) => {
    const form = new FormData()
    form.append("file", new Blob([b], { type: m }), fn)
    form.append("model", process.env.STT_MODEL || "whisper-1")
    form.append("language", "es")
    return fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OA()}` }, body: form })
  }
  let res = await post(buf, mime, `audio.${ext}`)
  if (!res.ok) {
    const err = await res.text()
    // formato rechazado (ej. m4a/3GPP) → transcodificar a mp3 con ffmpeg y reintentar UNA vez
    if (res.status === 400 && /file format|invalid|decode|could not/i.test(err)) {
      const mp3 = await transcodeToMp3(buf, ext)
      res = await post(mp3, "audio/mpeg", "audio.mp3")
      if (!res.ok) throw new Error(`stt ${res.status} (post-ffmpeg): ${(await res.text()).slice(0, 150)}`)
    } else throw new Error(`stt ${res.status}: ${err.slice(0, 150)}`)
  }
  return (await res.json()).text || ""
}
