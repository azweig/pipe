// #5: transcribir + resumir un mensaje con MEDIA, on-demand (lo dispara el usuario con long-press/hover, NO automático).
//  - video / audio → transcripción con auto-detección de idioma (inglés/japonés/etc) + resumen TRADUCIDO al español.
//  - imagen → OCR local; si no hay texto, descripción por visión (nube, porque lo pediste explícitamente).
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { messageById } from "../threads-repo.mjs"
import { transcribeMedia } from "../voice.mjs"
import { llm, visionLLM } from "../llm.mjs"
import { ocrCas, ocrEnabled } from "../ocr.mjs"

const casPathOf = (media) => join(process.cwd(), "data", String(media || "").replace(/^\//, "")) // media = /cas/xx/hash.ext → ./data/cas/…
const LANGS = { es: "español", en: "inglés", ja: "japonés", pt: "portugués", fr: "francés", de: "alemán", it: "italiano", zh: "chino", ko: "coreano", ru: "ruso", ar: "árabe", nl: "neerlandés", hi: "hindi" }

export async function summarizeMedia(id) {
  const m = messageById(id)
  if (!m) return { error: "mensaje no encontrado" }
  if (!m.media) return { error: "este mensaje no tiene archivo para transcribir" }
  const path = casPathOf(m.media)
  if (!existsSync(path)) return { error: "el archivo ya no está disponible" }
  const ext = String(m.media).split(".").pop().toLowerCase()
  const isImage = m.mediaType === "image" || /^(jpe?g|png|webp|gif|bmp|heic)$/.test(ext)

  if (isImage) {
    let ocrText = ""; try { if (ocrEnabled()) ocrText = (await ocrCas(m.media)).trim() } catch {}
    if (ocrText && ocrText.length > 12) { // hay texto → resumen local del OCR
      const summary = (await llm(`Este es el texto extraído (OCR) de una imagen que me mandaron:\n"""${ocrText.slice(0, 5000)}"""\nResumí en español de qué se trata y los datos clave. Si está en otro idioma, traducí el sentido. Sin inventar. Devolvé SOLO el resumen.`, { area: "summarize", temperature: 0.2, task: "media-summary" })).trim().replace(/^["']+|["']+$/g, "")
      return { kind: "image", transcript: ocrText.slice(0, 4000), summary: summary.slice(0, 1200), lang: null }
    }
    // sin texto legible → descripción por visión (nube)
    const b64 = readFileSync(path).toString("base64")
    const desc = (await visionLLM(`Describí en español, concreto, qué muestra esta imagen y cualquier dato relevante. Si hay texto, transcribilo y traducilo. Sin inventar.`, [{ mime: "image/" + (ext === "jpg" ? "jpeg" : ext), data: b64 }]).catch(() => "")).trim()
    return { kind: "image", transcript: "", summary: (desc || "No pude leer la imagen.").slice(0, 1200), lang: null }
  }

  // audio o video: extraer audio (ffmpeg) → whisper (auto-idioma) → resumir/traducir al español
  const { text, lang } = await transcribeMedia(readFileSync(path), ext)
  const kind = m.mediaType === "video" ? "video" : "audio"
  if (!text || text.length < 2) return { kind, transcript: "", summary: "(sin voz clara en el audio)", lang }
  const langN = LANGS[lang] || lang || "el original"
  const summary = (await llm(
    `Transcripción del audio de un ${kind === "video" ? "video" : "audio"} que me mandaron (idioma detectado: ${langN}):\n"""${text.slice(0, 6000)}"""\n\n` +
    `Resumí en ESPAÑOL, claro y concreto: de qué trata y los puntos clave (qué dice/pide, nombres, números, decisiones, plazos). Si está en otro idioma, traducí el sentido al español. 2 a 5 frases. Fiel, sin inventar. Devolvé SOLO el resumen.`,
    { area: "summarize", temperature: 0.2, task: "media-summary" }
  )).trim().replace(/^["']+|["']+$/g, "")
  return { kind, transcript: text.slice(0, 8000), summary: summary.slice(0, 1500), lang }
}
