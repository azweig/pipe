// Importa el histórico COMPLETO de WhatsApp desde la base descifrada (msgstore.db) → messages.jsonl.
// Vincula cada media por su HASH al CAS (el archivo ya bajado se conecta al mensaje, sin duplicar).
// Uso: node src/import-msgstore.mjs <ruta-msgstore.db>
// Requiere: sqlite3 CLI. La media ya debe estar dedupeada en data/cas (cas-index.json).
import { existsSync, appendFileSync } from "fs"
import { execFileSync } from "child_process"
import { owner } from "./lib/hub.mjs"
import { casUrlByHash } from "./lib/cas.mjs"

const DB = process.argv[2]
if (!DB || !existsSync(DB)) { console.error("Uso: node src/import-msgstore.mjs <msgstore.db>"); process.exit(1) }
const STORE = "./data/messages.jsonl"

// consulta sqlite → filas como objetos (modo -json)
function q(sql) {
  try { const out = execFileSync("sqlite3", [DB, "-json", sql], { maxBuffer: 1 << 30 }).toString().trim(); return out ? JSON.parse(out) : [] }
  catch (e) { return [] }
}
const tables = q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name)
const has = (t) => tables.includes(t)
const cols = (t) => q(`PRAGMA table_info(${t})`).map((r) => r.name)
console.log(`Tablas: ${tables.length}. message=${has("message")}, chat=${has("chat")}, jid=${has("jid")}, message_media=${has("message_media")}`)

// hash del CAS: WhatsApp guarda file_hash = base64(sha256). El CAS indexa por hex(sha256). Convertimos y buscamos.
const b64ToHex = (b64) => { try { return Buffer.from(b64, "base64").toString("hex") } catch { return null } } // casUrlByHash ahora sale de cas.mjs (cas.db)

const TYPE = { 0: "text", 1: "image", 2: "audio", 3: "video", 4: "contact", 5: "location", 9: "document", 13: "gif", 20: "sticker" }

// esquema moderno (2023+): message + chat + jid + message_media. Con fallbacks de nombres de columna.
const mc = cols("message")
const col = (opts) => opts.find((c) => mc.includes(c)) || opts[0]
const C_FROMME = col(["from_me"]), C_TS = col(["timestamp"]), C_TEXT = col(["text_data"]), C_TYPE = col(["message_type"])
const C_CHAT = col(["chat_row_id"]), C_SENDER = col(["sender_jid_row_id"])

let sql
if (has("message") && has("chat") && has("jid")) {
  sql = `SELECT m._id AS id, m.${C_FROMME} AS from_me, m.${C_TS} AS ts, m.${C_TEXT} AS text, m.${C_TYPE} AS type,
      j.raw_string AS chat_jid, j.user AS chat_user, c.subject AS group_subject,
      sj.raw_string AS sender_jid,
      mm.file_hash AS file_hash, mm.media_name AS media_name, mm.file_path AS file_path, mm.mime_type AS mime
    FROM message m
    JOIN chat c ON m.${C_CHAT}=c._id
    JOIN jid j ON c.jid_row_id=j._id
    LEFT JOIN jid sj ON m.${C_SENDER}=sj._id
    LEFT JOIN message_media mm ON mm.message_row_id=m._id
    WHERE (m.${C_TEXT} IS NOT NULL AND m.${C_TEXT}!='') OR mm.file_hash IS NOT NULL
    ORDER BY m.${C_TS} ASC`
} else {
  console.error("Esquema no reconocido. Tablas:", tables.join(", ")); process.exit(1)
}

const rows = q(sql)
console.log(`Filas: ${rows.length}`)
let n = 0, withMedia = 0, linked = 0
const numOf = (jid) => (jid || "").split("@")[0]
for (const r of rows) {
  const isGroup = (r.chat_jid || "").includes("@g.us")
  const mine = r.from_me === 1 || r.from_me === "1"
  let text = (r.text || "").trim()
  let media = null, mediaType = null, filename = null
  if (r.file_hash) {
    withMedia++
    const hex = b64ToHex(r.file_hash)
    const url = hex && casUrlByHash(hex)
    if (url) { media = url; linked++ } // ¡vinculado al archivo ya bajado en el CAS!
    mediaType = TYPE[r.type] || "file"
    if (mediaType === "document" || mediaType === "file") filename = r.media_name || (r.file_path || "").split("/").pop()
    if (!text) text = mediaType === "image" ? "🖼 Imagen" : mediaType === "video" ? "📹 Video" : mediaType === "audio" ? "🎤 Audio" : `📄 ${filename || "documento"}`
  }
  if (!text && !media) continue
  const chatNum = numOf(r.chat_jid)
  const senderNum = numOf(r.sender_jid) || chatNum
  const rec = {
    channel: "whatsapp", account: "history",
    id: "wah:" + r.id + ":" + chatNum,
    jid: r.chat_jid || ("import:" + chatNum),
    sender: mine ? "" : (senderNum || ""),
    name: mine ? owner() : (isGroup ? senderNum : chatNum),
    text, ts: Number(r.ts) || 0, dir: mine ? "out" : "in",
  }
  if (isGroup && r.group_subject) rec.group = r.group_subject
  if (media) { rec.media = media; rec.mediaType = mediaType; if (filename) rec.filename = filename }
  appendFileSync(STORE, JSON.stringify(rec) + "\n"); n++
}
console.log(`\n✅ ${n} mensajes históricos importados`)
console.log(`   ${withMedia} con media · ${linked} vinculados a archivos del CAS (${withMedia - linked} sin archivo local)`)
