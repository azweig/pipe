// Importa un chat de WhatsApp EXPORTADO (Exportar chat → Incluir archivos) al backup unificado del server.
// Parsea _chat.txt (formato Android/iOS) + copia la media. Queda como cualquier otro mensaje en messages.jsonl.
// Uso: node src/import-wa-export.mjs <carpeta-del-chat-descomprimido> "<Nombre del contacto>" ["<Mi nombre en el chat>"]
//   ej: node src/import-wa-export.mjs /tmp/chat-juan "Juan Pérez" "Tu Nombre"
import { readdirSync, readFileSync, existsSync, appendFileSync, copyFileSync, mkdirSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"
import { owner } from "./lib/hub.mjs"

const [dir, contact, myName] = process.argv.slice(2)
if (!dir || !contact) { console.error('Uso: node src/import-wa-export.mjs <carpeta> "<Contacto>" ["<Mi nombre>"]'); process.exit(1) }
mkdirSync("./data/media", { recursive: true })
const STORE = "./data/messages.jsonl"

const txtName = readdirSync(dir).find((f) => f.endsWith(".txt"))
if (!txtName) { console.error("No encontré el _chat.txt en", dir); process.exit(1) }
const raw = readFileSync(join(dir, txtName), "utf8").replace(/‎/g, "") // saca marcas LTR

// mes en varios idiomas no hace falta: WhatsApp exporta fecha numérica. Formatos:
//  iOS:     [d/m/yy, h:mm:ss a. m.] Sender: msg
//  Android: d/m/yy, h:mm a. m. - Sender: msg   (o dd/mm/yyyy, HH:mm - )
const LINE = /^\[?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|AM|PM)?\]?\s*(?:-\s*)?([^:]{1,60}?):\s([\s\S]*)$/i
const parseTs = (dd, mm, yy, h, mi, s, ap) => {
  let year = +yy < 100 ? 2000 + +yy : +yy, hour = +h
  if (/p/i.test(ap || "") && hour < 12) hour += 12
  if (/a/i.test(ap || "") && hour === 12) hour = 0
  return new Date(year, +mm - 1, +dd, hour, +mi, +(s || 0)).getTime()
}

// media: "<archivo adjunto: IMG-xxx.jpg>" | "IMG-xxx.jpg (archivo adjunto)" | "<attached: file>" | "‎<adjunto: file>"
const mediaRef = (t) => (t.match(/([\w\-]+\.\w{2,4})\s*\((?:archivo adjunto|file attached)\)/i) || t.match(/<(?:archivo adjunto|attached|adjunto):\s*([^>]+)>/i))?.[1]
const kind = (fn) => /\.(jpg|jpeg|png|webp|gif)$/i.test(fn) ? "image" : /\.(mp4|mov|3gp)$/i.test(fn) ? "video" : /\.(opus|ogg|mp3|m4a|aac)$/i.test(fn) ? "audio" : "file"

const lines = raw.split("\n")
const msgs = []
let cur = null
for (const ln of lines) {
  const m = ln.match(LINE)
  if (m) { if (cur) msgs.push(cur); cur = { ts: parseTs(m[1], m[2], m[3], m[4], m[5], m[6], m[7]), sender: m[8].trim(), text: m[9] } }
  else if (cur) cur.text += "\n" + ln // continuación multilínea
}
if (cur) msgs.push(cur)

const me = (myName || "").toLowerCase()
let n = 0, med = 0
const jid = "import:" + contact
for (const m of msgs) {
  const mine = me && m.sender.toLowerCase().includes(me)
  const rec = { channel: "whatsapp", account: "import", id: createHash("md5").update(m.ts + m.sender + m.text.slice(0, 40)).digest("hex").slice(0, 16), jid, sender: m.sender, name: mine ? owner() : m.sender, text: m.text.trim(), ts: m.ts, dir: mine ? "out" : "in" }
  const fn = mediaRef(m.text)
  if (fn && existsSync(join(dir, fn))) {
    const dest = `matrix_import_${rec.id}_${fn}`.replace(/[^\w.\-]/g, "_")
    try { copyFileSync(join(dir, fn), `./data/media/${dest}`); rec.media = `/media/${dest}`; rec.mediaType = kind(fn); if (rec.mediaType === "file") rec.filename = fn; rec.text = rec.text.replace(fn, "").replace(/\((?:archivo adjunto|file attached)\)|<[^>]*>/gi, "").trim() || (rec.mediaType === "image" ? "🖼 Imagen" : rec.mediaType === "video" ? "📹 Video" : `📄 ${fn}`); med++ } catch {}
  }
  if (!rec.text && !rec.media) continue
  appendFileSync(STORE, JSON.stringify(rec) + "\n"); n++
}
console.log(`✅ importados ${n} mensajes de "${contact}" (${med} con media) → messages.jsonl`)
