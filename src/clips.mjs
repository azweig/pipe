// ENRIQUECEDOR DE CLIPS (Notas). Cada mensaje que te mandás a vos mismo (thread='self') es un "clip": link, idea, pendiente,
// foto, doc, video o audio. Este cron clasifica cada clip nuevo, saca el TÍTULO real de los links y dice PARA QUÉ SIRVE (1 frase).
// La vista de Notas muestra los clips al instante; este enriquecimiento va llenando título+para en background. Uso: node src/clips.mjs
import { clipCandidates, insertClip } from "./lib/db.mjs"
import { llm, visionLLM } from "./lib/llm.mjs"
import { transcribeWhisper, whisperAvailable } from "./lib/whisper.mjs"
import { readFileSync, existsSync, statSync } from "fs"
import { join } from "path"
import { loadEnv } from "./lib/env.mjs"
loadEnv() // keys de IA (visión) desde .env cuando se corre suelto; el cron ya las hereda del daemon

const BATCH = +process.env.CLIPS_BATCH || 15
export const URL_RE = /(https?:\/\/[^\s)]+)/i
const IMG_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", bmp: "image/bmp" }
// lee una imagen del CAS (data/cas/...) como base64 para la visión
function readImg(media) {
  try {
    const path = join(process.cwd(), "data", String(media || "").replace(/^\//, "")); if (!existsSync(path)) return null
    const ext = (media.split(".").pop() || "").toLowerCase(), mime = IMG_MIME[ext]; if (!mime) return null
    if (statSync(path).size > 8 * 1024 * 1024) return null
    return { mime, data: readFileSync(path).toString("base64") }
  } catch { return null }
}
const parseJson = (t) => { try { const m = (t || "").match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null } catch { return null } }

// (el esquema de `clips` lo crea db-core/initSchema — fuente única; antes había un CREATE TABLE redundante acá)

// tipo de clip derivado del mensaje (sin LLM)
export function clipKind(m) {
  if (m.mediaType === "audio") return "audio"
  if (m.mediaType === "image" || m.mediaType === "sticker") return "photo"
  if (m.mediaType === "video") return "video"
  if (m.mediaType === "document" || m.mediaType === "file") return "doc"
  if (URL_RE.test(m.text || "")) return "link"
  return "text"
}

// baja el <title>/og:title de una URL (best-effort, timeout corto). FB/IG suelen bloquear → devuelve "".
async function fetchTitle(url) {
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 6000)
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; pipe/1.0)" } })
    clearTimeout(to)
    const html = (await r.text()).slice(0, 40000)
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
    const tt = html.match(/<title[^>]*>([^<]+)/i)
    return (og?.[1] || tt?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 160)
  } catch { return "" }
}
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }

const badSummary = (s) => !s || /^\(/.test(s) || /^(no se |no hay |no puede|no se puede|lo siento)/i.test(s)

// Transcribe el AUDIO de un video ya descargado (mp4 en CAS) con whisper local → entiende qué DICE el video, sin modelo de visión.
// whisper local = privado (no sube el audio a la nube). Guarda de tamaño para no colgar el cron con un video largo.
async function videoTranscript(media) {
  try {
    if (!whisperAvailable() || !media) return ""
    const mp4 = join(process.cwd(), "data", String(media).replace(/^\//, ""))
    if (!existsSync(mp4)) return ""
    if (statSync(mp4).size > 120 * 1024 * 1024) return "" // >120MB → probablemente largo, lo salteamos
    const txt = await transcribeWhisper(mp4, { lang: "auto" }) // auto-detecta idioma (videos en inglés/español); transcribeWhisper hace el ffmpeg interno
    return (txt || "").replace(/\s+/g, " ").trim().slice(0, 2000)
  } catch { return "" }
}

async function enrichOne(m) {
  let kind = clipKind(m)
  const url = (m.text || "").match(URL_RE)?.[0] || null
  let title = "", para = ""
  if (url) {
    // LINK (con o sin media descargada, ej. videos de FB): título real + para qué sirve
    const t = await fetchTitle(url)
    const dom = domainOf(url)
    const extra = (m.text || "").replace(url, "").replace(/\s+/g, " ").trim().slice(0, 200)
    const vtx = (kind === "video" && m.media) ? await videoTranscript(m.media) : "" // si el video está bajado, escucho lo que DICE
    const prompt = `Me guardé este LINK como nota para mí mismo${kind === "video" ? " (es un video)" : ""}.\nURL: ${url}\nDominio: ${dom}${t ? `\nTítulo de la página: ${t}` : ""}${vtx ? `\nTranscripción del audio del video: "${vtx}"` : ""}${extra ? `\nLo acompañé con: "${extra}"` : ""}\n\nDevolvé JSON {"titulo":"nombre corto y claro de qué es${vtx ? " (usá la transcripción para entender de qué trata)" : " (usá el título de la página si sirve; si no sabés, describí por el dominio)"}","para":"en UNA frase: para qué me sirve o qué haría con esto${vtx ? ", basándote en lo que REALMENTE dice el video" : ""} (ver, leer, comprar, usar de referencia, hacer, etc.)"}. NO inventes datos concretos que no estén.`
    try { const r = await llm(prompt, { json: true, area: "summarize", temperature: 0.2, task: "clip-link" }); title = (r?.titulo || t || dom).slice(0, 160); para = (r?.para || "").slice(0, 200) } catch { title = t || dom }
    if (kind === "text") kind = "link" // link puro → tipo 'link'; si trae media (video/photo) conservamos ese tipo para el ícono/thumb
  } else if (kind === "text") {
    const txt = (m.text || "").replace(/\s+/g, " ").trim().slice(0, 500)
    const prompt = `Esta es una nota que me escribí a mí mismo:\n"${txt}"\n\nDevolvé JSON {"tipo":"idea|pendiente|dato","titulo":"resumen de 3 a 7 palabras","para":"en UNA frase para qué sirve o qué debería hacer con esto","spam":true|false}. spam=true SOLO si es basura/publicidad/cadena/sin sentido que claramente no querría guardar. NO inventes nada que no esté escrito.`
    try { const r = await llm(prompt, { json: true, area: "summarize", temperature: 0.2, task: "clip-text" }); title = (r?.titulo || txt.slice(0, 60)).slice(0, 160); para = (r?.para || "").slice(0, 200); if (r?.spam) return { kind: "text", url, title, para, spam: true }; if (r?.tipo === "pendiente") return { kind: "todo", url, title, para } } catch { title = txt.slice(0, 80) }
  } else {
    // media pura sin link: el resumen de audio lo hace el otro cron (columna summary)
    if (kind === "audio") { title = "Nota de voz"; para = badSummary(m.summary) ? "" : m.summary }
    else if (kind === "photo" && m.media) {
      // VISIÓN: describir la foto (para no tener que abrirla) + detectar si es spam/sin-sentido
      const img = readImg(m.media)
      if (img) {
        const prompt = `Me guardé esta IMAGEN como nota para mí mismo. Mirala y devolvé SOLO un JSON {"titulo":"qué es en 3-7 palabras","para":"en UNA frase qué muestra o para qué me sirve","spam":true|false}. spam=true SOLO si es basura/publicidad/cadena/meme sin valor que claramente no querría guardar. NO inventes texto que no esté en la imagen.`
        try { const r = parseJson(await visionLLM(prompt, [img], { temperature: 0.2 })); if (r) { title = (r.titulo || "Foto").slice(0, 160); para = (r.para || "").slice(0, 200); if (r.spam) return { kind, url, title, para, spam: true } } else title = "Foto" } catch { title = "Foto" }
      } else title = "Foto"
    }
    else if (kind === "video" && m.media) {
      // VIDEO descargado sin link: escucho su audio (whisper local) y resumo de qué trata
      const vtx = await videoTranscript(m.media)
      if (vtx) {
        const prompt = `Me guardé este VIDEO como nota para mí mismo. Esta es la transcripción de su audio:\n"${vtx}"\n\nDevolvé SOLO JSON {"titulo":"de qué trata en 3-7 palabras","para":"en UNA frase para qué me sirve o qué haría con esto, según lo que dice el video"}. NO inventes nada que no esté en la transcripción.`
        try { const r = await llm(prompt, { json: true, area: "summarize", temperature: 0.2, task: "clip-video" }); title = (r?.titulo || "Video").slice(0, 160); para = (r?.para || "").slice(0, 200) } catch { title = "Video" }
      } else title = "Video"
    }
    else title = { photo: "Foto", video: "Video", doc: m.filename || "Documento" }[kind] || "Clip"
  }
  return { kind, url, title, para }
}

async function run() {
  // clips nuevos = mensajes de 'self' que aún no tienen fila en clips
  const rows = clipCandidates({ limit: BATCH })
  if (!rows.length) { console.log("[clips] nada nuevo"); return }
  let n = 0, spam = 0
  for (const m of rows) {
    try { const c = await enrichOne(m); insertClip(m.id, m.ts, c.kind, c.url || null, c.title || "", c.para || "", c.spam ? 1 : 0, Date.now()); n++; if (c.spam) spam++ }
    catch (e) { console.error("[clips]", m.id, e.message) }
  }
  console.log(`[clips] ${n}/${rows.length} clips enriquecidos${spam ? ` · ${spam} ocultados (spam/sin sentido)` : ""}`)
}

if (process.argv[1] && process.argv[1].endsWith("clips.mjs")) run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
