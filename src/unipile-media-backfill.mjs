// One-off: recupera la media (audios/imágenes/videos/docs) de mensajes Unipile YA ingestados como "📎 Adjunto"
// (media=null, porque el reader viejo no bajaba adjuntos). Baja el archivo al CAS y hace UPDATE de la fila.
// La ingesta normal es INSERT OR IGNORE (por id) → re-ingerir NO arregla lo viejo; por eso este UPDATE explícito.
// Correr:  node src/unipile-media-backfill.mjs [limit]   (default 200, el máx que devuelve /messages)
import { loadEnv } from "./lib/env.mjs"
import { casPutBuffer } from "./lib/cas.mjs"
import { shouldStoreMedia } from "./lib/media-policy.mjs"
import { handle } from "./lib/db-core.mjs"
loadEnv()

const KEY = process.env.UNIPILE_API_KEY || "", DSN = (process.env.UNIPILE_DSN || "").replace(/\/+$/, "")
if (!KEY || !DSN) { console.log("sin UNIPILE_API_KEY/DSN"); process.exit(1) }
const LIMIT = +process.argv[2] || 200

const extOf = (mime = "", fn = "") => {
  const sub = String(mime).split(";")[0].trim().split("/")[1] || ""
  const M = { ogg: "ogg", mpeg: "mp3", jpeg: "jpg", "svg+xml": "svg", quicktime: "mov" }
  if (M[sub]) return M[sub]
  if (/^[a-z0-9]{2,5}$/.test(sub)) return sub
  return (fn.match(/\.([a-z0-9]{1,5})$/i) || [, "bin"])[1].toLowerCase()
}
const label = (a) => {
  const kind = ({ audio: "audio", img: "image", image: "image", video: "video" })[a.type] || "document"
  const dur = a.duration ? ` · ${Math.round(a.duration)}s` : ""
  const text = kind === "audio" ? (a.voice_note ? `🎤 Nota de voz${dur}` : `🎵 Audio${dur}`)
    : kind === "image" ? "🖼 Imagen" : kind === "video" ? `📹 Video${dur}` : `📄 ${a.file_name || "Documento"}`
  return { kind, text }
}
const uni = async (p) => (await fetch(`${DSN}/api/v1${p}`, { headers: { "X-API-KEY": KEY, accept: "application/json" } })).json()
const uniBuf = async (p) => { const r = await fetch(`${DSN}/api/v1${p}`, { headers: { "X-API-KEY": KEY } }); if (!r.ok) throw new Error("dl " + r.status); return Buffer.from(await r.arrayBuffer()) }

const h = handle()
h.pragma("busy_timeout = 15000")
const findRow = h.prepare("SELECT media, thread FROM messages WHERE id = ?")
const upd = h.prepare("UPDATE messages SET media=@media, mediaType=@mediaType, filename=@filename, text=CASE WHEN text IN ('📎 Adjunto','[mensaje]','') OR text IS NULL THEN @text ELSE text END WHERE id=@id")

const msgs = (await uni(`/messages?limit=${LIMIT}`)).items || []
console.log(`revisando ${msgs.length} mensajes de Unipile…`)
let fixed = 0, skip = 0
for (const m of msgs) {
  if (!m.attachments?.length) continue
  const id = `unipile:${m.id}`
  const row = findRow.get(id)
  if (!row) { skip++; continue }        // ese id no está en la DB
  if (row.media) { skip++; continue }   // ya tiene media
  const a = m.attachments.find((x) => !x.unavailable) || m.attachments[0]
  if (!a || a.unavailable) { skip++; continue }
  const { kind, text } = label(a)
  if (!shouldStoreMedia(row.thread, kind)) { skip++; continue } // respetar "no guardar media" del chat (audio siempre pasa) → NO reintroducir lo que el reader saltó
  try {
    const buf = await uniBuf(`/messages/${m.id}/attachments/${a.id}`)
    const media = casPutBuffer(buf, extOf(a.mimetype, a.file_name), `whatsapp/${m.chat_provider_id || m.id}`)
    upd.run({ id, media, mediaType: kind, filename: a.file_name || "", text })
    fixed++
    if (fixed % 10 === 0) console.log(`  ${fixed} recuperados…`)
  } catch (e) { console.log("  falló", m.id, e.message); skip++ }
}
console.log(`✅ ${fixed} mensajes con media recuperada · ${skip} saltados (ya tenían media / no están en la DB)`)
