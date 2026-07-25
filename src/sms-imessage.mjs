// SMS / iMessage reader (macOS) — lee la base de Messages (~/Library/Messages/chat.db) y empuja los mensajes nuevos al hub
// por /api/ingest/sms. Se VINCULAN POR NÚMERO al hilo de WhatsApp del mismo contacto (una sola conversación por persona).
//
// Dónde corre: en tu Mac (NO en el server del hub — iOS no deja leer SMS; la Mac sí, si tenés "Reenvío de SMS" activado + iMessage).
// Requiere: acceso a disco completo para el proceso (Ajustes → Privacidad → Acceso a disco completo → tu Terminal/app).
// Config (env):  HUB_URL=https://tu-hub   SMS_TOKEN=<el mismo que en el .env del server>   [SMS_POLL_MS=20000]
// Uso:  HUB_URL=… SMS_TOKEN=… node src/sms-imessage.mjs
import Database from "better-sqlite3"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const HUB = (process.env.HUB_URL || "http://localhost:3000").replace(/\/+$/, "")
const TOKEN = process.env.SMS_TOKEN || ""
const POLL = +process.env.SMS_POLL_MS || 20000
const DB = process.env.CHAT_DB || join(homedir(), "Library/Messages/chat.db")
const STATE = "./data/sms-imessage-since.json"

if (!TOKEN) { console.error("[sms] falta SMS_TOKEN (el mismo que en el .env del server)"); process.exit(1) }
if (!existsSync(DB)) { console.error(`[sms] no encuentro ${DB} — ¿es una Mac con Messages? ¿acceso a disco completo?`); process.exit(1) }

mkdirSync("./data", { recursive: true })
const digits = (s) => (s || "").replace(/[^\d]/g, "")
const APPLE_EPOCH_MS = 978307200000 // 2001-01-01 en ms unix
const toMs = (d) => d > 1e12 ? Math.round(d / 1e6) + APPLE_EPOCH_MS : d * 1000 + APPLE_EPOCH_MS // ns (macOS moderno) o s (viejo)
let lastRow = existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")).rowid || 0) : 0

// arranque: si es la 1ra vez, no re-importar toda la historia — empezar por el último rowid
function init() {
  if (lastRow) return
  try { const db = new Database(DB, { readonly: true }); lastRow = db.prepare("SELECT MAX(ROWID) m FROM message").get()?.m || 0; db.close(); writeFileSync(STATE, JSON.stringify({ rowid: lastRow })) } catch {}
  console.log(`[sms] arranque en rowid=${lastRow} (solo mensajes nuevos de acá en más)`)
}

async function tick() {
  let rows = []
  try {
    const db = new Database(DB, { readonly: true })
    // 1:1: mensajes con UN handle (evita grupos). text directo (los que están en attributedBody los saltea — la mayoría tiene text).
    rows = db.prepare(`
      SELECT m.ROWID rowid, m.text, m.date, m.is_from_me, h.id handle, m.service
      FROM message m JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID > ? AND m.text IS NOT NULL AND length(trim(m.text)) > 0
        AND m.cache_roomnames IS NULL   -- excluye chats grupales
      ORDER BY m.ROWID ASC LIMIT 200`).all(lastRow)
    db.close()
  } catch (e) { console.error("[sms] lectura chat.db:", e.message); return }
  if (!rows.length) return

  const messages = []
  let maxRow = lastRow
  for (const r of rows) {
    maxRow = Math.max(maxRow, r.rowid)
    const num = digits(r.handle)
    if (num.length < 8) continue // iMessage por email u otros → no linkea por número; los salteamos
    messages.push({ id: `imsg-${r.rowid}`, from: num, text: String(r.text).slice(0, 4000), ts: toMs(r.date), dir: r.is_from_me ? "out" : "in" })
  }

  if (messages.length) {
    try {
      const res = await fetch(`${HUB}/api/ingest/sms`, { method: "POST", headers: { "Content-Type": "application/json", "X-Token": TOKEN }, body: JSON.stringify({ messages }) })
      if (!res.ok) { console.error("[sms] hub respondió", res.status); return } // no avanzar el cursor → reintenta
      const j = await res.json().catch(() => ({}))
      console.log(`[sms] +${j.ingested ?? messages.length} mensajes → hub`)
    } catch (e) { console.error("[sms] POST al hub falló:", e.message); return } // no avanzar → reintenta
  }
  lastRow = maxRow
  writeFileSync(STATE, JSON.stringify({ rowid: lastRow }))
}

init()
console.log(`[sms] escuchando ${DB} → ${HUB} cada ${POLL / 1000}s`)
await tick()
setInterval(tick, POLL)
