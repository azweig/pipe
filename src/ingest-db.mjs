// Ingesta incremental messages.jsonl → SQLite (data/messages.db). Corre en el daemon cada 45s.
// STREAMING desde el offset (antes hacía .toString sobre 1.5GB → ERR_STRING_TOO_LONG cuando el offset se reseteaba,
// y un off-by-one en el conteo de bytes dejaba offset=size+1 → gatillaba el reset → crash loop → ingesta trabada).
import { existsSync, statSync, createReadStream } from "fs"
import { createInterface } from "readline"
import { insertMany, getMeta, setMeta, count } from "./lib/db.mjs"
import { computeThread } from "./lib/thread.mjs"

const JSONL = "./data/messages.jsonl"
if (!existsSync(JSONL)) { console.log("[ingest] sin messages.jsonl"); process.exit(0) }

const size = statSync(JSONL).size
let offset = parseInt(getMeta("jsonl_offset") || "0")
if (!(offset >= 0) || offset > size) offset = 0 // truncado/rotó → reingesta completa (segura, por streaming)

let added = 0, seen = 0, dropped = 0, batch = []
const flush = () => { if (batch.length) { added += insertMany(batch); batch = [] } }

if (offset < size) {
  const rl = createInterface({ input: createReadStream(JSONL, { start: offset, end: size - 1, encoding: "utf8" }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    seen++
    // una línea que no parsea suele ser interleave de dos readers escribiendo el JSONL a la vez. NO la tragues en silencio:
    // contala y logueala para que el problema sea VISIBLE (antes: catch vacío → pérdida invisible de mensajes).
    try { const r = JSON.parse(line); r.thread = computeThread(r); batch.push(r) } catch { dropped++; if (dropped <= 3) console.error(`[ingest] línea corrupta (posible append concurrente): ${line.slice(0, 120)}`) }
    if (batch.length >= 2000) flush() // por lotes → memoria acotada aunque sea el archivo entero
  }
  flush()
}
// leímos hasta EOF (size capturado al inicio) → el offset ES size. Sin conteo de bytes → sin off-by-one.
setMeta("jsonl_offset", size)
console.log(`[ingest] +${added} mensajes (de ${seen} líneas${dropped ? `, ${dropped} DESCARTADAS por corrupción` : ""}) · total DB: ${count()}`)
