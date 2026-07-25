// WhatsApp reader (Baileys) — SOLO LECTURA. Guarda en data/messages.jsonl con id (dedup), remitente, grupo,
// miniaturas de imagen/video/link, tipo real de mensaje, y SINCRONIZA HISTORIAL (syncFullHistory).
// Uso: node src/whatsapp.mjs <cuenta>   (wa1, wa2, wa3)
import pkg from "@whiskeysockets/baileys"
const makeWASocket = pkg.default ?? pkg.makeWASocket ?? pkg
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = pkg
const downloadMediaMessage = pkg.downloadMediaMessage ?? pkg.default?.downloadMediaMessage
import qrcode from "qrcode-terminal"
import QR from "qrcode"
import pino from "pino"
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "fs"
import { owner } from "./lib/hub.mjs"

mkdirSync("./data/media", { recursive: true })
const STORE = "./data/messages.jsonl"
const logger = pino({ level: "silent" })
const account = process.argv[2] || "wa1"
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
// números por cuenta → habilita CÓDIGO de vinculación (8 dígitos) además del QR
const PHONE = { wa1: process.env.WA1_PHONE || "" }

const GROUPS = "./data/wa-groups.json"
const loadGroups = () => (existsSync(GROUPS) ? JSON.parse(readFileSync(GROUPS, "utf8")) : {})
const saveGroups = (g) => writeFileSync(GROUPS, JSON.stringify(g, null, 2))
const saveBuf = (buf, name) => { try { writeFileSync(`./data/media/${name}`, Buffer.from(buf)); return `/media/${name}` } catch { return null } }
const tsOf = (msg) => (msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now())

async function start() {
  let loggedIn = false
  const { state, saveCreds } = await useMultiFileAuthState(`./auth/${account}`)
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, auth: state, logger, browser: Browsers.macOS("Desktop"), markOnlineOnConnect: false, syncFullHistory: false, qrTimeout: 45000 }) // ⚠️ syncFullHistory:true rompe la conexión (428). qrTimeout amplio para dar tiempo a escanear.
  sock.ev.on("creds.update", saveCreds)

  // CÓDIGO de vinculación (8 dígitos) — alternativa al QR, inmune al vencimiento
  if (PHONE[account] && !sock.authState.creds.registered) {
    await delay(4000)
    try {
      const code = await sock.requestPairingCode(PHONE[account].replace(/[^0-9]/g, ""))
      writeFileSync(`/tmp/wa_code_${account}`, code)
      console.log(`\n🔑 [${account}] CÓDIGO DE VINCULACIÓN: ${code}\n   WhatsApp → Dispositivos vinculados → Vincular un dispositivo → "Vincular con número de teléfono" → ingresá el código.\n`)
    } catch (e) { console.log(`[${account}] error pidiendo código:`, e.message) }
  }

  async function saveImage(msg) {
    try { const buf = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage }); return saveBuf(buf, `${account}_${msg.key.id}.jpg`) } catch { return null }
  }

  // convierte un mensaje de WhatsApp → registro unificado (o null). live=true descarga la imagen full; historial usa miniatura.
  async function toRecord(msg, live) {
    if (!msg.message) return null
    const jid = msg.key.remoteJid || ""
    if (jid === "status@broadcast") return null
    const mine = !!msg.key.fromMe
    const isGroup = jid.endsWith("@g.us")
    const senderJid = mine ? "" : (isGroup ? (msg.key.participant || "") : jid)
    const name = mine ? owner() : (msg.pushName || (senderJid || jid).split("@")[0])
    const m = msg.message, id = msg.key.id
    let text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || ""
    let media = null, kind = null
    try {
      if (m.imageMessage) { kind = "image"; media = live ? await saveImage(msg) : (m.imageMessage.jpegThumbnail && saveBuf(m.imageMessage.jpegThumbnail, `${account}_${id}_t.jpg`)); if (!text) text = "[imagen]" }
      else if (m.videoMessage) { kind = "video"; if (m.videoMessage.jpegThumbnail) media = saveBuf(m.videoMessage.jpegThumbnail, `${account}_${id}_t.jpg`); if (!text) text = "[video]" }
      else if (m.extendedTextMessage?.jpegThumbnail) { kind = "link"; media = saveBuf(m.extendedTextMessage.jpegThumbnail, `${account}_${id}_t.jpg`); if (!text) text = m.extendedTextMessage.title || m.extendedTextMessage.matchedText || "[enlace]" }
    } catch {}
    if (!text) {
      if (m.stickerMessage) text = "[sticker]"
      else if (m.audioMessage || m.pttMessage) text = "[audio]"
      else if (m.documentMessage) text = `[documento: ${m.documentMessage.fileName || ""}]`
      else if (m.locationMessage || m.liveLocationMessage) text = "[ubicación]"
      else if (m.contactMessage || m.contactsArrayMessage) text = `[contacto]`
      else if (m.reactionMessage) text = `reaccionó ${m.reactionMessage.text || ""}`
      else if (m.pollCreationMessage || m.pollCreationMessageV3) text = `[encuesta]`
      else { const t = Object.keys(m).find((k) => !["messageContextInfo", "senderKeyDistributionMessage"].includes(k)); text = `[${(t || "otro").replace(/Message.*$/, "").replace(/V\d$/, "")}]` }
    }
    let groupName = null
    if (isGroup) { const g = loadGroups(); groupName = g[jid]; if (!groupName) { try { const md = await sock.groupMetadata(jid); groupName = md.subject; g[jid] = groupName; saveGroups(g) } catch {} } }
    const rec = { channel: "whatsapp", account, id, jid, sender: senderJid, name, text, ts: tsOf(msg), dir: mine ? "out" : "in" }
    if (media) rec.media = media
    if (kind) rec.kind = kind
    if (groupName) rec.group = groupName
    return rec
  }

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log(`\n📱 [${account}] Escaneá el QR:\n`); qrcode.generate(qr, { small: true }); QR.toFile(`/tmp/wa_qr_${account}.png`, qr, { width: 400, margin: 2 }).catch(() => {}); try { unlinkSync(`/tmp/wa_ok_${account}`) } catch {} }
    if (connection === "open") {
      loggedIn = true
      console.log(`\n✅ [${account}] CONECTADO — leyendo mensajes...\n`)
      try { writeFileSync(`/tmp/wa_ok_${account}`, String(Date.now())) } catch {}
      try { unlinkSync(`/tmp/wa_code_${account}`) } catch {}
      try { const all = await sock.groupFetchAllParticipating(); const g = loadGroups(); for (const [jid, md] of Object.entries(all || {})) if (md.subject) g[jid] = md.subject; saveGroups(g); console.log(`[${account}] ${Object.keys(all || {}).length} grupos mapeados`) } catch {}
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        console.log(`[${account}] sesión cerrada (401) — limpio y regenero QR`)
        try { rmSync(`./auth/${account}`, { recursive: true, force: true }) } catch {}
        try { unlinkSync(`/tmp/wa_ok_${account}`) } catch {}
        setTimeout(start, 5000)
      } else if (!loggedIn) {
        // aún no vinculado (se agotaron los QR refs / QR vencido) → reintentar YA para tener QR fresco continuo
        console.log(`[${account}] QR vencido — genero uno nuevo al toque`)
        setTimeout(start, 1500)
      } else { console.log(`[${account}] reconectando en 60s...`); setTimeout(start, 60000) }
    }
  })

  // mensajes en vivo
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return
    for (const msg of messages) { const rec = await toRecord(msg, true); if (rec) { appendFileSync(STORE, JSON.stringify(rec) + "\n"); console.log(`${rec.dir === "out" ? "➡️ " : "💬"} [${account}] ${rec.group ? "(" + rec.group + ") " : ""}${rec.name}: ${rec.text}`) } }
  })

  // HISTORIAL (al vincular / reconectar WhatsApp manda el historial del teléfono)
  sock.ev.on("messaging-history.set", async ({ messages, isLatest }) => {
    let n = 0
    for (const msg of (messages || [])) { const rec = await toRecord(msg, false); if (rec) { appendFileSync(STORE, JSON.stringify(rec) + "\n"); n++ } }
    if (n) console.log(`[${account}] 📜 historial: +${n} mensajes${isLatest ? " (completo)" : ""}`)
  })
}
start().catch((e) => console.error("error:", e.message))
