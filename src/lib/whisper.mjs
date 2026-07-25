// Transcripción SELF-HOSTED con whisper.cpp — para reuniones/llamadas SENSIBLES (el audio nunca sale de tu infra, no va a Google).
// Requiere whisper.cpp compilado + un modelo ggml. ffmpeg convierte cualquier audio a wav 16kHz mono (lo que whisper espera).
import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
const pexec = promisify(execFile)

const WBIN = process.env.WHISPER_BIN || "/opt/whisper.cpp/build/bin/whisper-cli"
const WMODEL = process.env.WHISPER_MODEL || "/opt/whisper.cpp/models/ggml-small.bin"

export function whisperAvailable() { return existsSync(WBIN) && existsSync(WMODEL) }

// transcribe un archivo de audio local → texto plano (sin timestamps). lang "es"/"en"/"auto".
export async function transcribeWhisper(audioPath, { lang = "es" } = {}) {
  if (!whisperAvailable()) throw new Error("whisper.cpp no disponible en el server")
  const wav = join(tmpdir(), `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`)
  try {
    // -nostdin: sin esto ffmpeg bloquea leyendo stdin cuando corre vía execFile (sin tty) → cuelga para siempre
    await pexec("ffmpeg", ["-nostdin", "-y", "-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { timeout: 5 * 60000 })
    const args = ["-m", WMODEL, "-f", wav, "-nt", "-t", process.env.WHISPER_THREADS || "4"]
    if (lang && lang !== "auto") args.push("-l", lang)
    const { stdout } = await pexec(WBIN, args, { timeout: 60 * 60000, maxBuffer: 128 * 1024 * 1024 }) // reuniones largas: hasta 1h de CPU
    return stdout.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ").trim()
  } finally { try { unlinkSync(wav) } catch {} }
}
