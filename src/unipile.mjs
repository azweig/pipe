// Unipile reader — trae WhatsApp de las cuentas gestionadas por Unipile (el híbrido: algunos números por Unipile, otros directo
// por el bridge mautrix). Ingesta al mismo formato de la bandeja (data/messages.jsonl). Polling; webhooks quedan como mejora.
// Config: UNIPILE_API_KEY + UNIPILE_DSN (ej. https://api46.unipile.com:17613). Sin eso, el reader queda inactivo.
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { appendMessage } from "./lib/lock.mjs"
import { owner } from "./lib/hub.mjs"
import { phoneOf, computeThread } from "./lib/thread.mjs"
import { casPutBuffer } from "./lib/cas.mjs"
import { shouldStoreMedia } from "./lib/media-policy.mjs"

const KEY = process.env.UNIPILE_API_KEY || ""
const DSN = (process.env.UNIPILE_DSN || "").replace(/\/+$/, "")
if (!KEY || !DSN) { console.log("[unipile] sin UNIPILE_API_KEY/DSN — reader inactivo"); process.exit(0) }
const POLL = +process.env.UNIPILE_POLL_MS || 25000

mkdirSync("./auth", { recursive: true })
const SINCE = "./auth/unipile-since.json"
let lastTs = existsSync(SINCE) ? (JSON.parse(readFileSync(SINCE, "utf8")).ts || 0) : 0
const saveSince = () => { try { writeFileSync(SINCE, JSON.stringify({ ts: lastTs })) } catch {} }

async function uni(path) {
  const r = await fetch(`${DSN}/api/v1${path}`, { headers: { "X-API-KEY": KEY, accept: "application/json" } })
  if (!r.ok) throw new Error(`unipile ${r.status} ${path}: ${(await r.text()).slice(0, 120)}`)
  return r.json()
}

async function uniBuffer(path) {
  const r = await fetch(`${DSN}/api/v1${path}`, { headers: { "X-API-KEY": KEY } })
  if (!r.ok) throw new Error(`unipile ${r.status} ${path}`)
  return Buffer.from(await r.arrayBuffer())
}

// mimetype/filename → extensión canónica (ej. "audio/ogg; codecs=opus" → "ogg")
const extOf = (mime = "", fn = "") => {
  const sub = String(mime).split(";")[0].trim().split("/")[1] || ""
  const M = { ogg: "ogg", mpeg: "mp3", jpeg: "jpg", "svg+xml": "svg", quicktime: "mov" }
  if (M[sub]) return M[sub]
  if (/^[a-z0-9]{2,5}$/.test(sub)) return sub
  return (fn.match(/\.([a-z0-9]{1,5})$/i) || [, "bin"])[1].toLowerCase()
}

// tipo Unipile → mediaType de pipe + texto de etiqueta
export function attachLabel(a) {
  const kind = ({ audio: "audio", img: "image", image: "image", video: "video" })[a.type] || "document"
  const dur = a.duration ? ` · ${Math.round(a.duration)}s` : ""
  const text = kind === "audio" ? (a.voice_note ? `🎤 Nota de voz${dur}` : `🎵 Audio${dur}`)
    : kind === "image" ? "🖼 Imagen" : kind === "video" ? `📹 Video${dur}` : `📄 ${a.file_name || "Documento"}`
  return { kind, text }
}

// baja el 1er adjunto de un mensaje Unipile al CAS → {media, mediaType, text, filename} o null.
// Respeta la política de media del chat: si es "no guardar", devuelve placeholder sin bajar (audio SIEMPRE se baja).
export async function fetchAttachment(m, threadKey = "") {
  const a = (m.attachments || []).find((x) => !x.unavailable) || m.attachments?.[0]
  if (!a || a.unavailable) return null
  const { kind, text } = attachLabel(a)
  if (!shouldStoreMedia(threadKey, kind)) return { media: null, mediaType: null, text: `${text} · (no guardada)`, filename: "" }
  try {
    const buf = await uniBuffer(`/messages/${m.id}/attachments/${a.id}`)
    const media = casPutBuffer(buf, extOf(a.mimetype, a.file_name), `whatsapp/${m.chat_provider_id || m.id}`)
    return { media, mediaType: kind, text, filename: a.file_name || "" }
  } catch (e) { console.log("[unipile] adjunto no bajó:", e.message); return null }
}

// mensaje de Unipile → registro de pipe. chat = el Chat correspondiente (para nombre de grupo / contacto).
async function toRec(m, chat) {
  const cp = m.chat_provider_id || chat?.provider_id || ""   // jid del contacto (DM) o del grupo (@g.us)
  const isGroup = /@g\.us$/.test(cp)
  const mine = !!m.is_sender
  const contactNum = phoneOf(cp) || cp
  // rec de IDENTIDAD primero → el gate de media y el guardado deben computeThread() sobre el MISMO objeto.
  // Si divergen (identity-manual.json canoniza por nombre y el gate no lo tenía), el gate cae al default "store" y guarda igual.
  const rec = {
    id: `unipile:${m.id}`, channel: "whatsapp", account: "unipile",
    jid: cp, sender: m.sender_public_identifier || "",
    name: mine ? owner() : (chat?.name || contactNum || "?"),
    ts: Date.parse(m.timestamp) || Date.now(), dir: mine ? "out" : "in",
  }
  if (isGroup) rec.grp = chat?.name || "Grupo"
  else rec.dm = cp   // DM → computeThread keyea por el número del contacto
  const threadKey = computeThread(rec)   // una sola fuente de verdad para la política de media
  let text = m.text || "[mensaje]"
  if (m.attachments?.length) {
    const att = await fetchAttachment(m, threadKey)   // baja el adjunto (respeta política) al CAS y lo tipa
    if (att) {
      text = m.text || att.text
      if (att.media) { rec.media = att.media; rec.mediaType = att.mediaType; if (att.filename) rec.filename = att.filename }
    } else text = m.text || "📎 Adjunto"     // fallback si no se pudo bajar
  }
  rec.text = text
  return rec
}

async function poll({ backfill = false } = {}) {
  // mapa de chats (para nombres de grupo/contacto)
  const chats = (await uni(`/chats?limit=200`)).items || []
  const chatMap = {}; for (const c of chats) chatMap[c.id] = c
  // mensajes recientes (todas las cuentas Unipile; hoy solo el número US)
  const msgs = (await uni(`/messages?limit=${backfill ? 200 : 60}`)).items || []
  let maxTs = lastTs, n = 0
  for (const m of msgs.slice().reverse()) { // viejo→nuevo
    const ts = Date.parse(m.timestamp) || 0
    if (!backfill && ts <= lastTs) continue
    appendMessage(await toRec(m, chatMap[m.chat_id]))
    if (ts > maxTs) maxTs = ts
    n++
  }
  lastTs = Math.max(lastTs, maxTs); saveSince()
  try { writeFileSync("/tmp/hb_whatsapp", String(Date.now())) } catch {} // heartbeat: Unipile también cuenta como "WhatsApp vivo"
  if (n) console.log(`[unipile] ${n} mensajes ingestados`)
}

console.log(`[unipile] conectado a ${DSN} — polling cada ${POLL / 1000}s`)
try { await poll({ backfill: lastTs === 0 }) } catch (e) { console.log("[unipile] primer poll:", e.message) } // backfill en la 1ra corrida
setInterval(() => poll().catch((e) => console.log("[unipile] poll err:", e.message)), POLL)
