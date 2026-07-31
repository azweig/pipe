// IMPORT de historial de WhatsApp desde "Exportar chat" (.txt) — el ÚNICO camino sin root ni PC: el usuario exporta un chat en
// WhatsApp (⋮ → Más → Exportar chat → Sin multimedia) y lo COMPARTE/SUBE a Pipe. Parseamos el formato (iOS y Android, varios locales)
// y lo mergeamos al hilo existente con dedup por contenido (no duplica lo que ya trajo el bridge). Es por-chat (WhatsApp no exporta todo).
import { handle as db, withRetry } from "./db-core.mjs"
import { insertMany } from "./ingest-repo.mjs"
import { owner as hubOwner } from "./hub.mjs"
import { createHash } from "crypto"
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "fs"
import { spawnSync } from "child_process"
import { tmpdir } from "os"
import { join, extname } from "path"
import { casPutBuffer } from "./cas.mjs"

// Inicio de mensaje. iOS: "[dd/mm/yy, hh:mm:ss a. m.] Sender: text". Android: "dd/mm/yy, hh:mm - Sender: text". El ‎ (LTR mark) aparece a veces.
const RE_IOS = /^‎?\[(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:([ap])\.?\s?m\.?)?\]\s?‎?([\s\S]*)$/i
const RE_AND = /^‎?(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:([ap])\.?\s?m\.?)?\s+-\s+‎?([\s\S]*)$/i
const OWNER_ALIASES = /^(you|t[úu]|yo)$/i
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "")

const MEDIA_ANY = /(<\s*media omitted\s*>|multimedia omitido|media omitted|imagen omitida|image omitted|video omitido|vídeo omitido|audio omitido|sticker omitido|sticker omitted|gif omitido|documento omitido|document omitted|<attached:|null\s*$)/i
const MEDIA_KIND = [
  [/imagen omitida|image omitted|foto omitida|\.(jpe?g|png|webp)>?|sticker omit/i, "image"],
  [/v[íi]deo omitido|video omitted|gif omit|\.mp4>?/i, "video"],
  [/audio omit|voice|ptt|\.(opus|ogg|m4a|mp3|aac)>?/i, "audio"],
  [/documento omit|document omit|\.(pdf|docx?|xlsx?|pptx?|zip|txt)>?/i, "document"],
]

function parseDate(dstr, tstr, ap, order, tzOff) {
  const p = dstr.split(/[\/.\-]/).map(Number); let a = p[0], b = p[1], y = p[2], day, month
  if (order === "MDY") { month = a; day = b }
  else if (order === "DMY") { day = a; month = b }
  else { if (a > 12) { day = a; month = b } else if (b > 12) { month = a; day = b } else { day = a; month = b } } // auto: >12 desambigua, si no → DMY (mayoría del mundo)
  if (y < 100) y += 2000
  const t = tstr.split(":").map(Number); let hh = t[0], mm = t[1], ss = t[2] || 0
  if (ap) { const pm = /p/i.test(ap); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0 }
  // el export usa hora LOCAL del teléfono; tzOff (min, ej. Lima=-300) lo pasa la app para llevarlo a epoch UTC real
  return Date.UTC(y, month - 1, day, hh, mm, ss) - (tzOff || 0) * 60000
}

// ── PARSER puro: texto del export → [{ts, sender, dir, text, mediaType}] ──
export function parseWhatsAppExport(text, { owner = "", dateOrder = "auto", tzOffsetMin = 0 } = {}) {
  const lines = String(text || "").replace(/\r/g, "").split("\n")
  const ownerN = norm(owner)
  const msgs = []
  let cur = null
  const push = () => { if (cur && (cur.text || cur.mediaType)) msgs.push(cur); cur = null }
  for (const line of lines) {
    const m = line.match(RE_IOS) || line.match(RE_AND)
    if (m) {
      push()
      const [, dstr, tstr, ap, rest] = m
      const ts = parseDate(dstr, tstr, ap, dateOrder, tzOffsetMin)
      const sm = rest.match(/^([^:\n]{1,80}?):\s([\s\S]*)$/) // "Sender: text" vs línea de sistema (sin "sender: ")
      if (!sm) { cur = null; continue } // sistema (cifrado E2E, "creó el grupo", "cambió el asunto"…) → ignorar
      const sender = sm[1].trim(); let body = sm[2]
      let mediaType = null, mediaFile = null
      if (MEDIA_ANY.test(body)) {
        for (const [re, t] of MEDIA_KIND) { if (re.test(body)) { mediaType = t; break } }
        mediaType = mediaType || "document"
        // export CON multimedia: el archivo real viaja en el .zip. Capturamos su nombre para linkearlo. iOS/Android nuevo: "<attached: FILE>"; Android viejo: "FILE (file attached)".
        const att = body.match(/<attached:\s*([^>]+?)\s*>/i) || body.match(/^‎?\s*(.+?)\s*\((?:file attached|archivo adjunto|arquivo anexado)\)\s*$/i)
        if (att) mediaFile = att[1].trim()
      }
      const dir = (OWNER_ALIASES.test(sender) || (ownerN && norm(sender) === ownerN)) ? "out" : "in"
      // el export "Sin multimedia" no trae el archivo → marcador limpio como texto. Con multimedia, el resolver adjunta el archivo real.
      const MARK = { image: "🖼 Imagen", video: "📹 Video", audio: "🎤 Audio", document: "📎 Multimedia" }
      cur = { ts, sender, dir, text: mediaType ? MARK[mediaType] : body.trim(), mediaType, mediaFile }
    } else if (cur) {
      cur.text += "\n" + line // continuación multi-línea del mensaje actual
    }
  }
  push()
  return msgs.filter((x) => Number.isFinite(x.ts))
}

// resuelve a qué hilo existente pertenece este export (para MERGEAR, no crear uno paralelo): por nombre del chat o del contacto 1-a-1
function resolveThread(chatName, msgs, isGroup) {
  const cand = (chatName || "").trim() || (!isGroup ? (msgs.find((m) => m.dir === "in")?.sender || "") : "")
  if (cand) {
    const row = db().prepare("SELECT thread FROM messages WHERE channel='whatsapp' AND name=? GROUP BY thread ORDER BY COUNT(*) DESC LIMIT 1").get(cand)
    if (row?.thread) return { thread: row.thread, name: cand, matched: true }
  }
  return { thread: "whatsapp:import:" + (norm(cand) || createHash("sha1").update(String(chatName || Date.now())).digest("hex").slice(0, 10)), name: cand || "Chat importado", matched: false }
}

// ── IMPORT: parsea + mergea al hilo con dedup por contenido (ts±90s + texto). Devuelve stats. ──
export function importWhatsApp(text, { owner = "", chatName = "", isGroup = false, dateOrder = "auto", tzOffsetMin = 0, mediaResolver = null } = {}) {
  owner = owner || hubOwner() // el nombre del owner (hub-config) es cómo aparecen TUS mensajes salientes en el export → detecta dir:out
  const msgs = parseWhatsAppExport(text, { owner, dateOrder, tzOffsetMin })
  if (!msgs.length) return { parsed: 0, inserted: 0, skipped: 0, thread: null, error: "no pude leer mensajes en el archivo (¿es un export de WhatsApp?)" }
  const { thread, name, matched } = resolveThread(chatName, msgs, isGroup)
  const dupe = db().prepare("SELECT 1 FROM messages WHERE thread=? AND ts BETWEEN ? AND ? AND text=? LIMIT 1")
  const records = []
  let skipped = 0, mediaN = 0
  for (const m of msgs) {
    if (dupe.get(thread, m.ts - 90000, m.ts + 90000, m.text)) { skipped++; continue } // ya está (lo trajo el bridge o un import previo)
    let media = null, filename = null, mediaType = m.mediaType
    if (m.mediaFile && mediaResolver) { const r = mediaResolver(m.mediaFile); if (r && r.media) { media = r.media; if (r.mediaType) mediaType = r.mediaType; filename = m.mediaFile; mediaN++ } } // export CON media → adjunta el archivo real del zip
    const id = "waimp:" + createHash("sha1").update(thread + "|" + m.ts + "|" + m.dir + "|" + m.text + "|" + (filename || "")).digest("hex").slice(0, 20)
    records.push({
      id, channel: "whatsapp", account: "import", thread, jid: null,
      sender: m.dir === "out" ? null : m.sender, name: isGroup ? m.sender : name, text: m.text, ts: m.ts, dir: m.dir,
      grp: isGroup ? name : null, media, mediaType, filename, unread: 0, body: null, attachments: null,
    })
  }
  const inserted = records.length ? withRetry(() => insertMany(records)) : 0
  return { parsed: msgs.length, inserted, skipped, media: mediaN, thread, name, matched, isGroup }
}

// IMPORT desde el .zip "Exportar chat CON multimedia": descomprime (python3 zipfile), lee el .txt, y adjunta CADA foto/audio/video
// del zip al mensaje correspondiente (guardándolo en el CAS = tu backup). Así traés el historial COMPLETO, no solo el texto.
const _extKind = (fn) => { const e = extname(fn || "").toLowerCase(); if (/\.(jpe?g|png|webp|gif|heic|bmp)$/.test(e)) return "image"; if (/\.(mp4|mov|3gp|webm|mkv|avi)$/.test(e)) return "video"; if (/\.(opus|ogg|m4a|mp3|aac|wav|amr)$/.test(e)) return "audio"; return "document" }
export function importWhatsAppZip(zipBuf, { chatName = "", isGroup = false, dateOrder = "auto", tzOffsetMin = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "waimp-")); const zipPath = join(dir, "export.zip")
  try {
    writeFileSync(zipPath, zipBuf)
    const un = spawnSync("python3", ["-c", "import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nz.extractall(sys.argv[2])", zipPath, dir], { timeout: 180000 })
    if (un.status !== 0) return { error: "no pude descomprimir el .zip (¿es un export de WhatsApp con multimedia?)" }
    const files = readdirSync(dir)
    const txtName = files.find((f) => /_chat\.txt$/i.test(f)) || files.find((f) => /\.txt$/i.test(f) && /chat|whatsapp/i.test(f)) || files.find((f) => /\.txt$/i.test(f))
    if (!txtName) return { error: "el .zip no tiene el archivo de chat (.txt)" }
    const text = readFileSync(join(dir, txtName), "utf8")
    // resolver: nombre de archivo del export → blob del zip → CAS. Cache por nombre para no re-guardar.
    const cache = new Map()
    const mediaResolver = (fname) => {
      if (cache.has(fname)) return cache.get(fname)
      let out = null
      try {
        const p = join(dir, fname)
        if (existsSync(p)) { const buf = readFileSync(p); if (buf.length) { const kind = _extKind(fname); const media = casPutBuffer(buf, extname(fname).slice(1).toLowerCase() || "bin", "whatsapp:import"); out = { media, mediaType: kind } } }
      } catch {}
      cache.set(fname, out); return out
    }
    return importWhatsApp(text, { chatName: chatName || chatNameFromTxt(txtName), isGroup, dateOrder, tzOffsetMin, mediaResolver })
  } finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
}
const chatNameFromTxt = (fn = "") => String(fn).replace(/\.txt$/i, "").replace(/^_?chat( de whatsapp con| de whatsapp)?\s*/i, "").replace(/^whatsapp chat( -| with)?\s*/i, "").replace(/^chat -\s*/i, "").trim()
