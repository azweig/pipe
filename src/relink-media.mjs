// Re-vincula media que quedó sin CAS: mensajes importados ANTES de que su archivo llegara al CAS quedaron con media=NULL.
// Ahora que el CAS está completo, re-busca el file_hash de cada uno y lo vincula. Uso: node src/relink-media.mjs
import Database from "better-sqlite3"
import { existsSync } from "fs"
import { mediaWithoutFile, linkMediaBatch } from "./lib/db.mjs"
import { casUrlByHash } from "./lib/cas.mjs"

const casUrl = (b64) => { try { return casUrlByHash(Buffer.from(b64, "base64").toString("hex")) } catch { return null } }
// mensajes con tipo de media pero SIN archivo vinculado
const nulls = mediaWithoutFile()
console.log(`mensajes con media sin vincular: ${nulls.length}`)

// abrir los 3 msgstore y cachear message_media por _id
const stores = {}
for (const [tag, f] of [["wah", "data/msgstore.db"], ["wah2", "data/msgstore2.db"], ["wah3", "data/msgstore3.db"]]) {
  if (existsSync("./" + f)) stores[tag] = new Database("./" + f, { readonly: true }).prepare("SELECT file_hash, media_name FROM message_media WHERE message_row_id=?")
}

const pairs = []
let notInCas = 0, noStore = 0
for (const { id } of nulls) {
  const [tag, _id] = id.split(":")
  const stmt = stores[tag]; if (!stmt) { noStore++; continue }
  const mm = stmt.get(+_id)
  if (!mm?.file_hash) { notInCas++; continue }
  const url = casUrl(mm.file_hash)
  if (url) pairs.push([id, url]); else notInCas++
}
const linked = linkMediaBatch(pairs) // UPDATE atómico en una transacción (named query)
console.log(`✅ re-vinculados: ${linked} · sin archivo en CAS: ${notInCas} · sin msgstore: ${noStore}`)
