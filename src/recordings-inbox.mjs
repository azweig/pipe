// Buzón de GRABACIONES — dejás cualquier audio en una carpeta (exports de Plaud, memos del celu, grabaciones de reuniones) y
// Pipe lo transcribe LOCAL (whisper) y lo archiva como NOTA propia → pasa por el pipeline de Notas (categoría, acciones, resumen).
// Provider-agnóstico: no depende de la API de ningún grabador; Plaud/otros entran por su export a esta carpeta (o por mail-a-vos).
// Config: RECORDINGS_DIR (default ./data/recordings). Corre desde el daemon cada ~1 min. Uso: node src/recordings-inbox.mjs
import { readdirSync, statSync, renameSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join, extname, basename } from "path"
import { appendMessage } from "./lib/lock.mjs"
import { casPutBuffer } from "./lib/cas.mjs"
import { transcribeWhisper, whisperAvailable } from "./lib/whisper.mjs"

const DIR = process.env.RECORDINGS_DIR || "./data/recordings"
const DONE = join(DIR, ".done")
const AUDIO = new Set([".mp3", ".m4a", ".wav", ".ogg", ".oga", ".opus", ".aac", ".flac", ".mp4", ".webm", ".mpga", ".mpeg"])
mkdirSync(DIR, { recursive: true }); mkdirSync(DONE, { recursive: true })

const files = readdirSync(DIR).filter((f) => AUDIO.has(extname(f).toLowerCase()) && !f.startsWith("."))
if (!files.length) { console.log("[recordings] nada nuevo en " + DIR); process.exit(0) }
if (!whisperAvailable()) { console.log("[recordings] whisper no disponible (WHISPER_BIN) — no puedo transcribir; dejo los archivos"); process.exit(0) }

let n = 0
for (const f of files.slice(0, 8)) {
  const path = join(DIR, f)
  try {
    if (statSync(path).size < 1024) continue // archivo a medio copiar
    const ext = extname(f).toLowerCase().slice(1)
    const buf = readFileSync(path)
    const media = casPutBuffer(buf, ext, "recording") // guarda el audio en el CAS (queda reproducible en la nota)
    let text = ""
    try { text = (await transcribeWhisper(path, { lang: "auto" }) || "").replace(/\s+/g, " ").trim() } catch (e) { console.error("[recordings] STT", f, e.message) }
    const title = basename(f, extname(f)).replace(/[_-]+/g, " ").slice(0, 80)
    const ts = Math.round(statSync(path).mtimeMs) || Date.now()
    // NOTA propia (thread='self' vía computeThread rama 'recording') con la transcripción como texto + el audio como media.
    appendMessage({ id: `rec-${ts}-${n}`, channel: "recording", account: "recordings", jid: "self", name: `🎙️ ${title}`, text: text || `🎙️ ${title}`, media, mediaType: "audio", ts, dir: "in" })
    renameSync(path, join(DONE, `${ts}-${f}`)) // procesado → a .done (no re-procesar; el original queda de respaldo)
    n++
    console.log(`[recordings] ${f} → nota (${text.length} chars de transcripción)`)
  } catch (e) { console.error("[recordings]", f, e.message) }
}
console.log(`[recordings] ${n} grabación(es) → notas`)
process.exit(0)
