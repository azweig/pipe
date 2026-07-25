// Importa el histórico COMPLETO de WhatsApp (msgstore.db descifrada) → SQLite (data/messages.db).
// Vincula cada media por su HASH al CAS. Escribe en lotes (maneja millones sin cargar todo en memoria).
// Uso: node src/import-msgstore-db.mjs <ruta-msgstore.db>
import { existsSync } from "fs"
import Database from "better-sqlite3"
import { insertMany, count, setMeta } from "./lib/db.mjs"
import { owner } from "./lib/hub.mjs"
import { casUrlByHash } from "./lib/cas.mjs"

const SRC = process.argv[2]
const TAG = process.argv[3] || "wah" // prefijo de id por dispositivo (evita colisión entre teléfonos)
const ACCT = process.argv[4] || "history"
if (!SRC || !existsSync(SRC)) { console.error("Uso: node src/import-msgstore-db.mjs <msgstore.db> [idPrefix] [account]"); process.exit(1) }
const casUrl = (b64) => { try { return casUrlByHash(Buffer.from(b64, "base64").toString("hex")) } catch { return null } }

const TYPE = { 0: "text", 1: "image", 2: "audio", 3: "video", 4: "contact", 5: "location", 9: "document", 13: "gif", 20: "sticker" }
const numOf = (jid) => (jid || "").split("@")[0]
const src = new Database(SRC, { readonly: true })

const total = src.prepare("SELECT COUNT(*) c FROM message").get().c
console.log(`Base: ${total} mensajes. Importando en lotes…`)

const stmt = src.prepare(`
  SELECT m._id AS id, m.from_me, m.timestamp AS ts, m.text_data AS text, m.message_type AS type,
    j.raw_string AS chat_jid, c.subject AS grp,
    sj.raw_string AS sender_jid,
    mm.file_hash, mm.media_name, mm.file_path, mm.mime_type
  FROM message m
  JOIN chat c ON m.chat_row_id=c._id
  JOIN jid j ON c.jid_row_id=j._id
  LEFT JOIN jid sj ON m.sender_jid_row_id=sj._id
  LEFT JOIN message_media mm ON mm.message_row_id=m._id
  WHERE (m.text_data IS NOT NULL AND m.text_data!='') OR mm.file_hash IS NOT NULL
  ORDER BY m.timestamp ASC`)

let batch = [], n = 0, withMedia = 0, linked = 0
function flush() { if (!batch.length) return; n += insertMany(batch); batch = [] }
for (const r of stmt.iterate()) {
  const isGroup = (r.chat_jid || "").includes("@g.us")
  const mine = r.from_me === 1
  let text = (r.text || "").trim(), media = null, mediaType = null, filename = null
  if (r.file_hash) {
    withMedia++
    const url = casUrl(r.file_hash); if (url) { media = url; linked++ }
    mediaType = TYPE[r.type] || "file"
    if (mediaType === "document" || mediaType === "file") filename = r.media_name || (r.file_path || "").split("/").pop()
    if (!text) text = mediaType === "image" ? "🖼 Imagen" : mediaType === "video" ? "📹 Video" : mediaType === "audio" ? "🎤 Audio" : `📄 ${filename || "documento"}`
  }
  if (!text && !media) continue
  const chatNum = numOf(r.chat_jid), senderNum = numOf(r.sender_jid) || chatNum
  batch.push({
    id: TAG + ":" + r.id + ":" + chatNum,
    channel: "whatsapp", account: ACCT,
    thread: "whatsapp:" + (r.chat_jid || chatNum),
    jid: r.chat_jid || chatNum,
    sender: mine ? "" : senderNum,
    name: mine ? owner() : (isGroup ? senderNum : chatNum),
    text, ts: Number(r.ts) || 0, dir: mine ? "out" : "in",
    grp: isGroup && r.grp ? r.grp : null, media, mediaType, filename,
  })
  if (batch.length >= 5000) { flush(); if (n % 100000 < 5000) console.log(`  … ${n} importados`) }
}
flush()
setMeta("history_imported", Date.now())
console.log(`\n✅ ${n} mensajes históricos → DB · ${withMedia} con media · ${linked} vinculados al CAS`)
console.log(`   Total en la DB ahora: ${count()}`)
