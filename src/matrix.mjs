// Cliente Matrix de pipe. Conecta al homeserver Matrix (Synapse) y lee TODOS los mensajes de los
// bridges (WhatsApp/Instagram/Messenger/Telegram/LinkedIn) → data/messages.jsonl, formato unificado.
// También expone helpers para VINCULAR una red vía su bridge bot (login qr / login phone).
// Uso: node src/matrix.mjs            → corre el lector (loop /sync)
//      node src/matrix.mjs link whatsapp phone +15551234567   → pide código de vinculación
//      node src/matrix.mjs link whatsapp qr                    → genera QR (a /tmp/matrix_qr_whatsapp.png)
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs"
import { loadEnv } from "./lib/env.mjs"
import { appendMessage } from "./lib/lock.mjs"
const MEDIA_TIMEOUT = +process.env.MATRIX_MEDIA_TIMEOUT_MS || 25000 // una media lenta no debe estancar el loop /sync
import { casPutBuffer } from "./lib/cas.mjs"
import { phoneOf, MY_NUMBERS, computeThread } from "./lib/thread.mjs"
import { shouldStoreMedia } from "./lib/media-policy.mjs"
import { owner, myNumbers } from "./lib/hub.mjs"

loadEnv()

const HS = process.env.MATRIX_HS || "http://localhost:8008"
const MAUTRIX_WA_DB = process.env.MAUTRIX_WA_DB || "/opt/matrix/bridges/whatsapp/mautrix-whatsapp.db" // env-driven → cada tenant su propio bridge

// grupo-vs-DM AUTORITATIVO desde la tabla portal de mautrix (room_type/@g.us), en vez del conteo de miembros (un grupo donde solo
// habló/quedó 1 miembro visible se tomaba como DM → mensajes de grupo dispersos como chat personal, y ahora aplicaría su política de media).
let _mautrixDb = null // null=no intentado, handle=ok, false=no existe/falló
async function mautrixDb() {
  if (_mautrixDb !== null) return _mautrixDb || null
  if (!existsSync(MAUTRIX_WA_DB)) { _mautrixDb = false; return null }
  try { const Database = (await import("better-sqlite3")).default; _mautrixDb = new Database(MAUTRIX_WA_DB, { readonly: true }); return _mautrixDb } catch { _mautrixDb = false; return null }
}
const _roomKind = new Map() // mxid → 'dm'|'group' (cache; el tipo de sala no cambia)
async function portalIsGroup(roomId) {
  if (_roomKind.has(roomId)) return _roomKind.get(roomId) === "group"
  const db = await mautrixDb(); if (!db) return null // sin DB de mautrix → desconocido → cae al conteo de miembros
  try {
    const p = db.prepare("SELECT room_type, id FROM portal WHERE mxid=? LIMIT 1").get(roomId)
    if (!p) return null // sin portal registrado (aún) → desconocido
    const isG = p.room_type === "group" || /@g\.us$/.test(p.id || "")
    _roomKind.set(roomId, isG ? "group" : "dm")
    return isG
  } catch { return null }
}
// Peer AUTORITATIVO de un DM desde la tabla portal del bridge (cuando la membresía aún no sincronizó y `peers` está vacío).
// Cierra el bug que dispersaba DMs por pushname tras un corte del bridge: el portal SIEMPRE sabe con quién es el 1:1.
const _dmPeer = new Map() // mxid → other_user_id|id (cache; no cambia)
async function portalDmPeer(roomId) {
  if (_dmPeer.has(roomId)) return _dmPeer.get(roomId)
  let peer = null
  try { const db = await mautrixDb(); const p = db && db.prepare("SELECT room_type, other_user_id, id FROM portal WHERE mxid=? LIMIT 1").get(roomId); if (p && p.room_type === "dm") peer = p.other_user_id || p.id || null } catch {}
  _dmPeer.set(roomId, peer); return peer
}
// JID REAL del grupo (@g.us) desde el portal de mautrix, para keyear en el INGEST por el @g.us y NO por la sala "!room" efímera →
// elimina de RAÍZ el duplicado grupo (!room vs @g.us) que antes solo arreglaba syncBridgePortals cada 20min (y se rompía si la DB estaba trabada).
const _portalJid = new Map() // mxid → @g.us (cache; no cambia)
async function portalGroupJid(roomId) {
  if (_portalJid.has(roomId)) return _portalJid.get(roomId)
  let jid = null
  try { const db = await mautrixDb(); const p = db && db.prepare("SELECT id FROM portal WHERE mxid=? LIMIT 1").get(roomId); if (p && /@(g\.us|broadcast|newsletter|thread\.v2)$/.test(p.id || "")) jid = p.id } catch {}
  _portalJid.set(roomId, jid); return jid
}
// ¿la sala es el WhatsApp Status Broadcast (estados/historias)? → sus mensajes NUNCA son una conversación; van a un hilo oculto, no por remitente.
const _isStatus = new Map()
async function portalIsStatus(roomId) {
  if (_isStatus.has(roomId)) return _isStatus.get(roomId)
  let v = false
  try { const db = await mautrixDb(); const p = db && db.prepare("SELECT id FROM portal WHERE mxid=? LIMIT 1").get(roomId); v = !!(p && p.id === "status@broadcast") } catch {}
  _isStatus.set(roomId, v); return v
}
const USER = process.env.MATRIX_USER || "admin"
const DOMAIN = process.env.MATRIX_DOMAIN || "localhost" // server_name de Synapse; setealo en .env (MATRIX_DOMAIN)
const STORE = "./data/messages.jsonl"
const TOKEN_FILE = "./auth/matrix-token.json"
const SINCE_FILE = "./auth/matrix-since.txt"
mkdirSync("./auth", { recursive: true }); mkdirSync("./data/media", { recursive: true })

// bridge bots + detección de canal por membresía del room (los ghosts llevan el prefijo de la red)
const BRIDGES = {
  whatsapp: { bot: `@whatsappbot:${DOMAIN}`, ghost: /@whatsapp_/i, prefix: "!wa" },
  instagram: { bot: `@instagrambot:${DOMAIN}`, ghost: /@instagram_/i, prefix: "!ig" },
  facebook: { bot: `@facebookbot:${DOMAIN}`, ghost: /@facebook_/i, prefix: "!fb" },
  telegram: { bot: `@telegrambot:${DOMAIN}`, ghost: /@telegram_/i, prefix: "!tg" },
  linkedin: { bot: `@linkedinbot:${DOMAIN}`, ghost: /@linkedin_/i, prefix: "!li" },
  discord: { bot: `@discordbot:${DOMAIN}`, ghost: /@discord_/i, prefix: "!discord" },
  signal: { bot: `@signalbot:${DOMAIN}`, ghost: /@signal_/i, prefix: "!signal" },
}
const isBotSender = (u) => /bot:/.test(u) // @whatsappbot:... etc (avisos de bridge, no mensajes reales)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, path, token, body, raw) {
  const r = await fetch(HS + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return raw ? r : r.json()
}

export async function login() {
  if (existsSync(TOKEN_FILE)) { const t = JSON.parse(readFileSync(TOKEN_FILE, "utf8")); if (t.access_token) return t.access_token }
  const pw = (process.env.MATRIX_PW || (existsSync("./auth/matrix-pw") && readFileSync("./auth/matrix-pw", "utf8")) || "").trim()
  if (!pw) throw new Error("falta MATRIX_PW o auth/matrix-pw")
  const d = await api("POST", "/_matrix/client/v3/login", null, { type: "m.login.password", identifier: { type: "m.id.user", user: USER }, password: pw, initial_device_display_name: "pipe" })
  if (!d.access_token) throw new Error("login falló: " + JSON.stringify(d))
  writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: d.access_token, device_id: d.device_id }, null, 2))
  return d.access_token
}

// crea (o reusa) el room de management con un bridge bot
async function botRoom(token, network) {
  const bot = BRIDGES[network]?.bot
  if (!bot) throw new Error("red desconocida: " + network)
  const key = `./auth/matrix-room-${network}.txt`
  if (existsSync(key)) return readFileSync(key, "utf8").trim()
  const room = await api("POST", "/_matrix/client/v3/createRoom", token, { invite: [bot], is_direct: true, preset: "trusted_private_chat" })
  if (!room.room_id) throw new Error("no se pudo crear room: " + JSON.stringify(room))
  writeFileSync(key, room.room_id)
  return room.room_id
}
async function sendText(token, room, text) {
  return api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${Date.now()}${Math.random().toString(36).slice(2)}`, token, { msgtype: "m.text", body: text })
}
// ENVÍO: manda un mensaje a una sala del bridge (WhatsApp/IG/…) → el bridge lo entrega al contacto. Usado por /api/send.
export async function sendMatrix(room, text) {
  const token = await login()
  const r = await sendText(token, room, text)
  return { ok: !!(r && (r.event_id || r.eventId)), event: r?.event_id }
}

// sube un binario al content-repo de Matrix → devuelve mxc://
async function uploadMedia(token, buffer, mime, filename = "voz.ogg") {
  const r = await fetch(HS + `/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`, { method: "POST", headers: { "Content-Type": mime, Authorization: "Bearer " + token }, body: buffer })
  if (!r.ok) return null
  const d = await r.json().catch(() => ({}))
  return d.content_uri || null
}
// ENVÍO DE NOTA DE VOZ: m.audio con los marcadores MSC1767/MSC3245 → los bridges (WhatsApp/Telegram/Discord/Signal) la entregan
// como mensaje de voz (PTT), no como archivo. El audio ya viene en ogg/opus (convertido por el server). Usado por /api/send-audio.
export async function sendMatrixAudio(room, buffer, { mime = "audio/ogg", durationMs = 0, waveform = null } = {}) {
  const token = await login()
  const mxc = await uploadMedia(token, buffer, mime)
  if (!mxc) return { ok: false, error: "no se pudo subir el audio al servidor Matrix" }
  // waveform (64 amplitudes 0..1024): sin él WhatsApp puede mostrar la nota como archivo que no reproduce. Si no vino, uno plano.
  const wf = (Array.isArray(waveform) && waveform.length) ? waveform : new Array(64).fill(256)
  const content = {
    msgtype: "m.audio", body: "Nota de voz.ogg", url: mxc,
    info: { mimetype: mime, size: buffer.length, duration: durationMs },
    "org.matrix.msc1767.audio": { duration: durationMs, waveform: wf },
    "org.matrix.msc3245.voice": {}, // ← marca de "voice message" (PTT) para los bridges
  }
  const r = await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${Date.now()}${Math.random().toString(36).slice(2)}`, token, content)
  return { ok: !!(r && (r.event_id || r.eventId)), event: r?.event_id }
}

// ENVÍO DE IMAGEN / VIDEO / ARCHIVO: sube al content-repo y manda m.image/m.video/m.file → los bridges lo entregan como adjunto.
export async function sendMatrixMedia(room, buffer, { mime = "application/octet-stream", filename = "archivo", width = 0, height = 0 } = {}) {
  const token = await login()
  const mxc = await uploadMedia(token, buffer, mime, filename)
  if (!mxc) return { ok: false, error: "no se pudo subir el archivo al servidor Matrix" }
  const msgtype = /^image\//.test(mime) ? "m.image" : /^video\//.test(mime) ? "m.video" : "m.file"
  const info = { mimetype: mime, size: buffer.length }
  if (width && height) { info.w = width; info.h = height }
  const content = { msgtype, body: filename, url: mxc, info }
  const r = await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${Date.now()}${Math.random().toString(36).slice(2)}`, token, content)
  return { ok: !!(r && (r.event_id || r.eventId)), event: r?.event_id }
}

// ENVÍO DE STICKER: evento m.sticker (tipo de evento propio, no m.room.message) con la imagen webp → los bridges lo entregan
// como sticker nativo (WhatsApp exige webp; el server lo convierte a 512×512 antes). Usado por /api/send-sticker.
export async function sendMatrixSticker(room, buffer, { mime = "image/webp" } = {}) {
  const token = await login()
  const mxc = await uploadMedia(token, buffer, mime, "sticker.webp")
  if (!mxc) return { ok: false, error: "no se pudo subir el sticker al servidor Matrix" }
  const content = { body: "sticker.webp", url: mxc, info: { mimetype: mime, size: buffer.length, w: 512, h: 512 } }
  const r = await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.sticker/${Date.now()}${Math.random().toString(36).slice(2)}`, token, content)
  return { ok: !!(r && (r.event_id || r.eventId)), event: r?.event_id }
}

// INICIAR un chat de WhatsApp NUEVO por número (contacto histórico sin sala en el bridge). Le pide al bot del bridge que
// cree el portal (start-chat) y devuelve el mxid de la sala. Resuelve por el número EXACTO → no hay riesgo de mandar a otro.
export async function startWhatsAppChat(number) {
  const num = String(number || "").replace(/[^\d]/g, "")
  if (num.length < 8) return null
  const token = await login()
  const botR = await botRoom(token, "whatsapp")
  await sendText(token, botR, `start-chat +${num}`) // comando del bridge (mautrix-whatsapp bridgev2)
  const Database = (await import("better-sqlite3")).default
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const mdb = new Database(MAUTRIX_WA_DB, { readonly: true })
      // ROBUSTEZ: puede haber VARIOS portales al mismo contacto (uno por cada número tuyo que lo tenga). Elegí el que sea de un
      // login con SESIÓN VIVA — si no, el mensaje se rutea por un número deslogueado y el bridge lo descarta silenciosamente.
      const alive = new Set(mdb.prepare("SELECT jid FROM whatsmeow_device").all().map((r) => String(r.jid).split(/[:@]/)[0]))
      const cands = mdb.prepare("SELECT mxid, receiver FROM portal WHERE other_user_id LIKE ? AND room_type='dm' AND mxid IS NOT NULL AND mxid!='' ORDER BY rowid DESC").all(`%${num}%`)
      mdb.close()
      const best = cands.find((c) => alive.has(String(c.receiver))) || cands[0]
      if (best?.mxid) return best.mxid
    } catch {}
  }
  return null
}
// estado del login (número) DUEÑO de una sala portal: { receiver, alive }. Sirve para decir "revinculá X" cuando el envío
// falla porque ese número está deslogueado (el bridge acepta el evento en Matrix pero no lo entrega a WhatsApp).
export async function roomLogin(mxid) {
  if (!mxid || !existsSync(MAUTRIX_WA_DB)) return null
  try {
    const Database = (await import("better-sqlite3")).default
    const db = new Database(MAUTRIX_WA_DB, { readonly: true })
    const p = db.prepare("SELECT receiver FROM portal WHERE mxid=? LIMIT 1").get(mxid)
    if (!p?.receiver) { db.close(); return null }
    const alive = !!db.prepare("SELECT 1 FROM whatsmeow_device WHERE jid LIKE ? LIMIT 1").get(p.receiver + "%")
    db.close()
    return { receiver: p.receiver, alive }
  } catch { return null }
}
// números propios (hub-config) que están DESLOGUEADOS en el bridge (reciben pero no envían). Para el banner de re-link in-app.
export async function loggedOutNumbers() {
  if (!existsSync(MAUTRIX_WA_DB)) return []
  try {
    const expected = myNumbers().map((n) => String(n).replace(/[^\d]/g, "")).filter((n) => n.length >= 8)
    if (!expected.length) return []
    const Database = (await import("better-sqlite3")).default
    const db = new Database(MAUTRIX_WA_DB, { readonly: true })
    const hasLogins = db.prepare("SELECT COUNT(*) n FROM user_login").get().n
    if (!hasLogins) { db.close(); return [] } // bridge sin vincular todavía → no alarmar
    const active = new Set(db.prepare("SELECT jid FROM whatsmeow_device").all().map((r) => String(r.jid).split(/[:@]/)[0]))
    db.close()
    // los números gestionados por Unipile NO se revinculan en el bridge → no los marques como caídos
    const viaUnipile = new Set((process.env.UNIPILE_NUMBERS || "").split(",").map((s) => s.replace(/[^\d]/g, "")).filter(Boolean))
    return expected.filter((n) => !active.has(n) && !viaUnipile.has(n))
  } catch { return [] }
}
async function mediaToFile(token, mxc, dest) {
  const m = mxc.match(/^mxc:\/\/([^/]+)\/(.+)$/); if (!m) return null
  const r = await api("GET", `/_matrix/client/v1/media/download/${m[1]}/${m[2]}`, token, null, true)
  if (!r.ok) return null
  writeFileSync(dest, Buffer.from(await r.arrayBuffer())); return dest
}
async function mediaToBuffer(token, mxc) {
  const m = mxc.match(/^mxc:\/\/([^/]+)\/(.+)$/); if (!m) return null
  const r = await api("GET", `/_matrix/client/v1/media/download/${m[1]}/${m[2]}`, token, null, true)
  if (!r.ok) return null
  return Buffer.from(await r.arrayBuffer())
}
// ── avatares de contacto (fotos de perfil que el bridge sincroniza) ──
mkdirSync("./data/avatars", { recursive: true })
const AV_FILE = "./auth/avatars.json"
let avatarMap = existsSync(AV_FILE) ? JSON.parse(readFileSync(AV_FILE, "utf8")) : {}
const avatarTried = new Set()
// nombre normalizado (sin tildes/mayúsculas/(WA)) → UNA foto por persona sin importar cómo se escriba el nombre
const norm = (n) => (n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s*\(wa\)$/i, "").toLowerCase().replace(/\s+/g, " ").trim()
async function ensureAvatar(token, name, mxc) {
  const key = norm(name)
  if (!key || !mxc || avatarMap[key] || avatarTried.has(key)) return
  avatarTried.add(key)
  const safe = key.replace(/[^a-z0-9]/gi, "_").slice(0, 40) || "x"
  const dest = `./data/avatars/${safe}.jpg`
  if (await mediaToFile(token, mxc, dest)) { avatarMap[key] = `/avatars/${safe}.jpg`; writeFileSync(AV_FILE, JSON.stringify(avatarMap)); return true }
  return false
}

// SYNC COMPLETO desde la DB de mautrix: avatares (ghost + portal) + nombres, keyeados por el nombre real del contacto/grupo.
// Las fotos SÍ están en el bridge (columna avatar_mxc). Uso: node src/matrix.mjs bridge-avatars
export async function syncBridgeAvatars() {
  const token = await login()
  const Database = (await import("better-sqlite3")).default
  const mdb = new Database(MAUTRIX_WA_DB, { readonly: true })
  const { readFileSync, existsSync } = await import("fs")
  const contacts = existsSync("./data/contacts-map.json") ? JSON.parse(readFileSync("./data/contacts-map.json", "utf8")) : {}
  const { phoneOf } = await import("./lib/thread.mjs")
  let done = 0, tried = 0
  const ghosts = mdb.prepare("SELECT id, name, avatar_mxc FROM ghost WHERE avatar_mxc IS NOT NULL AND avatar_mxc!=''").all()
  for (const g of ghosts) {
    tried++
    const num = phoneOf(g.id) || phoneOf("lid-" + g.id) || (/^\d{8,}$/.test(g.id) ? g.id : null)
    const names = new Set()
    if (num && contacts[num]) names.add(contacts[num]) // nombre de agenda (canónico)
    if (g.name) names.add(g.name) // push name (para el fallback)
    if (num) names.add(num)
    for (const nm of names) { if (await ensureAvatar(token, nm, g.avatar_mxc)) done++ }
    if (tried % 200 === 0) console.log(`  ...${tried}/${ghosts.length} ghosts · ${done} fotos`)
  }
  const portals = mdb.prepare("SELECT id, name, avatar_mxc FROM portal WHERE avatar_mxc IS NOT NULL AND name IS NOT NULL AND name!=''").all()
  for (const p of portals) { if (await ensureAvatar(token, p.name, p.avatar_mxc)) done++ }
  console.log(`✅ bridge avatars: ${done} fotos guardadas (de ${ghosts.length} ghosts + ${portals.length} grupos con avatar)`)
}
const extOf = (mime, body) => { const m = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov", "video/webm": "webm", "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr", "audio/wav": "wav", "application/pdf": "pdf" }
  const base = (mime || "").split(";")[0].trim().toLowerCase() // WhatsApp manda "audio/ogg; codecs=opus" → hay que quitar los params
  if (base && m[base]) return m[base]; const e = (body || "").match(/\.([a-z0-9]{2,4})$/i); return e ? e[1].toLowerCase() : "bin" }

// VINCULAR: manda login y captura QR/código del bot. Escribe /tmp/matrix_qr_<net>.png y /tmp/matrix_code_<net>.
export async function linkNetwork(network, flow = "qr", phone = "") {
  const token = await login()
  const room = await botRoom(token, network)
  await sleep(1500)
  let s0 = await api("GET", "/_matrix/client/v3/sync?timeout=1000", token); let since = s0.next_batch
  const readNew = async () => { const s = await api("GET", `/_matrix/client/v3/sync?timeout=3000&since=${since}`, token); since = s.next_batch; const r = s.rooms?.join?.[room]; return r ? (r.timeline?.events || []).filter((e) => e.type === "m.room.message" && e.sender.includes("bot:")) : [] }
  // cancelar cualquier login en curso (permite AGREGAR otra cuenta sin el "already ongoing")
  await sendText(token, room, `${BRIDGES[network].prefix} cancel`).catch(() => {})
  await sleep(1200); await readNew()
  // mautrix-discord usa comandos con guion (login-qr / login-token); el resto usa "login <flow>"
  await sendText(token, room, network === "discord" ? (flow === "token" ? "login-token" : "login-qr") : `login ${flow}`)
  await sleep(2500); await readNew()
  if (flow === "phone" && phone) { await sendText(token, room, phone) }
  for (let i = 0; i < 40; i++) {
    await sleep(2500)
    for (const e of await readNew()) {
      const b = e.content.body || ""
      if (e.content.msgtype === "m.image" && e.content.url) { await mediaToFile(token, e.content.url, `/tmp/matrix_qr_${network}.png`); console.log(`📱 [${network}] QR actualizado`) }
      else {
        console.log(`🤖 [${network}] ${b.slice(0, 200)}`)
        const code = b.match(/`([A-Z0-9]{4}-?[A-Z0-9]{4})`/)?.[1]
        if (code) writeFileSync(`/tmp/matrix_code_${network}`, code)
        if (/logged in|successfully|already logged/i.test(b)) { console.log(`✅ [${network}] VINCULADO`); try { writeFileSync(`/tmp/matrix_ok_${network}`, String(Date.now())); import("fs").then((fs) => { try { fs.unlinkSync(`/tmp/matrix_code_${network}`) } catch {} }) } catch {}; return true }
      }
    }
  }
  return false
}

// VINCULAR POR TOKEN/COOKIE: para redes cuyo login no es QR (Discord=token, meta=cookies). Manda el comando y espera el ok.
export async function linkWithToken(network, cred) {
  if (!cred) { console.log(`[${network}] sin credencial`); return false }
  const token = await login()
  const room = await botRoom(token, network)
  await sleep(1200)
  let s0 = await api("GET", "/_matrix/client/v3/sync?timeout=1000", token); let since = s0.next_batch
  const readNew = async () => { const s = await api("GET", `/_matrix/client/v3/sync?timeout=3000&since=${since}`, token); since = s.next_batch; const r = s.rooms?.join?.[room]; return r ? (r.timeline?.events || []).filter((e) => e.type === "m.room.message" && e.sender.includes("bot:")) : [] }
  const cmd = network === "discord" ? `login-token user ${cred}` : `login-token ${cred}`
  await sendText(token, room, cmd)
  let ok = false
  for (let i = 0; i < 10; i++) {
    await sleep(2000)
    for (const e of await readNew()) {
      const b = e.content.body || ""; console.log(`🤖 [${network}] ${b.slice(0, 200)}`)
      if (/logged in|successfully|logueado|conectad|success/i.test(b)) { console.log(`✅ [${network}] VINCULADO`); try { writeFileSync(`/tmp/matrix_ok_${network}`, String(Date.now())) } catch {}; ok = true }
      if (/invalid|error|failed|expired|no such/i.test(b)) { console.log(`❌ [${network}] falló`); return false }
    }
    if (ok) return true
  }
  return ok
}

// LECTOR: loop /sync, escribe cada mensaje de room bridgeado a messages.jsonl.
// El canal se detecta por presencia de un GHOST (conversación real), NO por el bot (la sala de management es solo del bot → se ignora).
function channelOf(members) { for (const [net, cfg] of Object.entries(BRIDGES)) if (members.some((u) => cfg.ghost.test(u))) return net; return null }

export async function runReader() {
  let token = await login()
  console.log(`🔗 Matrix conectado a ${HS} como @${USER}:${DOMAIN}`)
  let since = existsSync(SINCE_FILE) ? readFileSync(SINCE_FILE, "utf8").trim() : ""
  let stuckSince = null, stuckN = 0 // circuit-breaker: cuántos ciclos seguidos falló el MISMO batch (evita loop eterno si algo no se cura)
  const names = {} // room_id -> {channel, name, members{user->displayname}}
  // filtro amplio; primer sync sin since trae estado
  for (;;) {
    try {
      // en el sync inicial (sin since) pedimos hasta 80 eventos por sala para recuperar backlog reciente; luego incremental normal
      const initFilter = since ? "" : `&filter=${encodeURIComponent(JSON.stringify({ room: { timeline: { limit: 80 } } }))}`
      const s = await api("GET", `/_matrix/client/v3/sync?timeout=25000&full_state=${since ? "false" : "true"}${since ? `&since=${since}` : ""}${initFilter}`, token)
      // TOKEN inválido (pw cambió, device deslogueado, purge): Synapse devuelve M_UNKNOWN_TOKEN → antes se loopeaba eterno.
      // Borramos el token cacheado y re-logueamos, en vez de quedar sordos para siempre.
      if (s.errcode === "M_UNKNOWN_TOKEN" || s.errcode === "M_MISSING_TOKEN") { console.error("[matrix] token inválido → re-login"); try { unlinkSync(TOKEN_FILE) } catch {}; await sleep(2000); token = await login(); continue }
      if (!s.next_batch) { await sleep(3000); continue }
      try { writeFileSync("/tmp/hb_whatsapp", String(Date.now())) } catch {} // heartbeat: el /sync volvió OK = bridge conectado (aunque no lleguen mensajes)
      const nextSince = s.next_batch // NO persistir aún: solo tras procesar OK (si crasheamos, reprocesamos este batch)
      let batchOk = true // si un mensaje se cae por LOCK ocupado, NO avanzamos el token → se reprocesa (dedup por id), en vez de perderlo en silencio
      // auto-aceptar invitaciones a salas portal (cada chat de WhatsApp/IG/... es una sala que el bridge te invita)
      for (const roomId of Object.keys(s.rooms?.invite || {})) {
        const j = await api("POST", `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, token).catch(() => ({}))
        if (j.room_id) console.log(`↪️  unido a sala bridgeada ${roomId}`)
      }
      for (const [roomId, r] of Object.entries(s.rooms?.join || {})) {
        const meta = (names[roomId] ||= { channel: null, name: null, members: {} })
        // estado: miembros + nombre
        for (const e of [...(r.state?.events || []), ...(r.timeline?.events || [])]) {
          if (e.type === "m.room.member") { if (e.content?.displayname) meta.members[e.state_key] = e.content.displayname; if (e.content?.avatar_url && e.content?.displayname) await ensureAvatar(token, e.content.displayname, e.content.avatar_url); meta.membersList = Object.keys({ ...(meta.membersList ? Object.fromEntries(meta.membersList.map((x) => [x, 1])) : {}), [e.state_key]: 1 }) }
          if (e.type === "m.room.name" && e.content?.name) meta.name = e.content.name
        }
        const hasMsgs = (r.timeline?.events || []).some((e) => e.type === "m.room.message")
        // CRÍTICO: tras un restart el /sync incremental NO re-manda members ni nombre de sala. Hay que traerlos ANTES de decidir el canal;
        // si no, una sala con mensajes pero sin membership conocida se descarta en el `continue` de abajo → SE PIERDEN sus mensajes.
        if (hasMsgs && !meta.membersFetched) { // SIEMPRE traer membresía completa antes de decidir DM/grupo (si no, un grupo con 1 remitente visible se toma como DM y dispersa los mensajes)
          const jm = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`, token).catch(() => null)
          if (jm?.joined) { meta.membersFetched = true; meta.membersList = Object.keys(jm.joined); for (const [u, info] of Object.entries(jm.joined)) { if (info.display_name) meta.members[u] ||= info.display_name; if (info.avatar_url && info.display_name) await ensureAvatar(token, info.display_name, info.avatar_url) } } // marcar hecho SOLO si el fetch tuvo éxito; capturar avatar del ghost
          if (!meta.name) { const nm = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name/`, token).catch(() => null); if (nm?.name) meta.name = nm.name }
        }
        if (!meta.channel) meta.channel = channelOf(meta.membersList || Object.keys(meta.members))
        if (!meta.channel) continue // room no bridgeado (management del bot sin ghosts) → ok saltarlo (ya intentamos traer members)
        // contraparte del 1:1: ghost de la red que NO sea mío. Exactamente 1 = DM (esa es la persona). Varios = grupo → dmPeer null.
        const gx = BRIDGES[meta.channel]?.ghost
        const allGhosts = gx ? (meta.membersList || Object.keys(meta.members)).filter((u) => gx.test(u)) : []
        const peers = allGhosts.filter((u) => !MY_NUMBERS.has(phoneOf(u) || ""))
        const isG = await portalIsGroup(roomId) // señal AUTORITATIVA de mautrix; null = desconocido → heurística de membresía (como antes)
        // ESTADOS de WhatsApp (status broadcast): NUNCA una conversación → forzar hilo oculto, jamás dispersar por remitente (bug que metía estados en el chat de la persona).
        if (await portalIsStatus(roomId)) { meta.dmPeer = null; meta.name = "WhatsApp Status Broadcast" }
        // grupo confirmado → NUNCA DM. DM confirmado por el portal pero sin membresía sincronizada (peers vacío) → peer autoritativo del portal (NO cae al pushname).
        else meta.dmPeer = isG === true ? null : isG === false ? (peers[0] || await portalDmPeer(roomId)) : (peers.length === 1 ? peers[0] : null)
        meta.selfChat = allGhosts.length > 0 && peers.length === 0 // sala 1:1 solo con MIS ghosts = me escribo a mí (Mis Notas)
        // GRUPO: keyear por el @g.us del portal (no por la sala "!room") → cero duplicado en el ingest, sin depender del cron de dedup
        const gjid = (isG === true && !meta.dmPeer && !meta.selfChat) ? await portalGroupJid(roomId) : null
        for (const e of (r.timeline?.events || [])) {
         try {
          if (e.type !== "m.room.message" && e.type !== "m.sticker") continue // stickers llegan como evento m.sticker (no m.room.message)
          if (e.sender === `@${USER}:${DOMAIN}`) continue // comandos míos al bot, no son mensajes reales
          if (isBotSender(e.sender)) continue // avisos del bridge bot (código, instrucciones), no mensajes reales
          const c = e.content || {}
          const bt = (c.body || "").trim()
          // avisos de SISTEMA del bridge (media que no pudo bajar, mensajes borrados) → NO son mensajes reales, ensucian el inbox
          if (/^(Failed to bridge|Waiting for this message|Call ended|This message was deleted)/i.test(bt)) continue
          let text = c.body || ""
          let callKind = null
          // LLAMADAS de WhatsApp: NO se pueden atender desde acá (WhatsApp no expone el audio al bridge), pero SÍ registramos
          // que entró/perdiste una → aparece en la conversación con nombre y dispara notificación (sonido+vibración).
          if (/^Incoming call\. Use the WhatsApp/i.test(bt)) { text = "📞 Llamada de WhatsApp"; callKind = "call" }
          else if (/^(Missed (voice|video) call|You missed a (voice|video) call)/i.test(bt)) { text = "📞 Llamada perdida"; callKind = "call" }
          const name = meta.members[e.sender] || e.sender.replace(/^@/, "").split(":")[0].replace(new RegExp(`^${meta.channel}_`), "")
          const mine = !!(phoneOf(e.sender) && MY_NUMBERS.has(phoneOf(e.sender))) // mensaje enviado por MÍ (desde el celu u otra cuenta) → saliente
          // rec de IDENTIDAD primero: el gate de media y el guardado deben usar la MISMA clave. Si divergen (p.ej. identity-manual.json
          // canoniza por nombre y el gateRec no lo tenía), el gate cae al default "store" y guarda lo que el usuario pidió NO guardar.
          const rec = { channel: meta.channel, account: "matrix", id: e.event_id, jid: gjid || roomId, sender: e.sender, name: mine ? owner() : name, ts: e.origin_server_ts, dir: mine ? "out" : "in" }
          if (meta.dmPeer) rec.dm = meta.dmPeer // 1:1 del bridge → computeThread lo keyea por número (no por la sala)
          if (meta.selfChat) rec.self = true // sala solo con mis ghosts → "Mis Notas"
          if (meta.name && !meta.dmPeer) rec.group = meta.name // solo grupos llevan nombre de sala; un DM NO (su "nombre de sala" es el contacto)
          const threadKey = computeThread(rec) // una sola fuente de verdad para la política de media
          let media = null, mediaType = callKind, filename = null
          // un sticker (evento m.sticker) tiene el MISMO shape que una imagen (url + info webp) → lo tratamos como imagen
          const isSticker = e.type === "m.sticker"
          const mtype = isSticker ? "m.image" : c.msgtype
          if (["m.image", "m.video", "m.audio", "m.file"].includes(mtype) && c.url) {
            const kind = mtype.replace("m.", "") // image/video/audio/file — el audio SIEMPRE se guarda
            const store = shouldStoreMedia(threadKey, kind) // política: no guardar fotos/videos/docs de este chat
            if (store) {
              const buf = await Promise.race([mediaToBuffer(token, c.url), new Promise((res) => setTimeout(() => res(null), MEDIA_TIMEOUT))]).catch(() => null) // timeout: no estancar /sync por una media lenta
              if (buf) { media = casPutBuffer(buf, isSticker ? "webp" : extOf(c.info?.mimetype, c.body), `${meta.channel}/${meta.name || name}`); mediaType = isSticker ? "image" : kind } // sticker=imagen webp; el resto conserva su kind (video/audio/file) — NO forzar image
            }
            const skip = store ? "" : " · (no guardada)"
            if (isSticker) text = "🖼 Sticker" + skip
            else if (c.msgtype === "m.image") text = (store && c.body && !/^image|\.(jpg|png|webp)$/i.test(c.body)) ? c.body : "🖼 Imagen" + skip
            else if (c.msgtype === "m.video") text = "📹 Video" + skip
            else if (c.msgtype === "m.audio") text = "🎤 Audio"
            else if (c.msgtype === "m.file") { text = `📄 ${c.body || "documento"}` + skip; filename = store ? c.body : null }
          }
          rec.text = text
          if (media) { rec.media = media; rec.mediaType = mediaType; if (filename) rec.filename = filename }
          else if (callKind) rec.mediaType = callKind // llamada: sin media, pero marca el tipo para render/notif
          appendMessage(rec)
          console.log(`💬 [${meta.channel}] ${rec.group ? "(" + rec.group + ") " : ""}${name}: ${text.slice(0, 80)}`)
         } catch (err) {
           // FAIL-CLOSED por defecto: cualquier throw (ELOCK, SQLITE_BUSY u otro transitorio) NO avanza el token → se reprocesa
           // (dedup por id). Antes solo ELOCK reprocesaba y un SQLITE_BUSY de casPutBuffer caía acá → mensaje+media perdidos para siempre.
           batchOk = false; console.error("⚠️ msg error (no avanzo el token, reproceso):", err.code || "", err.message)
         }
        }
      }
      if (batchOk) { since = nextSince; writeFileSync(SINCE_FILE, since); stuckSince = null; stuckN = 0 } // token avanza SOLO si NADA se perdió
      else {
        // circuit-breaker: si el MISMO batch falla repetido (un mensaje de dato malo irrecuperable, o un lock que no cede), no loopear
        // eterno re-bajando media: tras 3 ciclos avanzamos igual (se pierde ESE batch, pero VISIBLE en el log) para no bloquear lo nuevo.
        if (nextSince === stuckSince) stuckN++; else { stuckSince = nextSince; stuckN = 1 }
        if (stuckN >= 3) { console.error(`⚠️ batch atascado ${stuckN}× — avanzo el token igual (posible pérdida VISIBLE, no bloqueo el reader)`); since = nextSince; writeFileSync(SINCE_FILE, since); stuckSince = null; stuckN = 0 }
        else await sleep(2000)
      }
    } catch (e) { console.error("sync error:", e.message); await sleep(5000) }
  }
}

// lista las cuentas conectadas de una red (via `list-logins` al bot). Escribe /tmp/matrix_logins_<net>.json
export async function listLogins(network) {
  const token = await login()
  const room = await botRoom(token, network)
  let s0 = await api("GET", "/_matrix/client/v3/sync?timeout=1000", token); let since = s0.next_batch
  await sendText(token, room, "list-logins")
  await sleep(2800)
  const s = await api("GET", `/_matrix/client/v3/sync?timeout=3000&since=${since}`, token)
  const r = s.rooms?.join?.[room]; const out = []
  if (r) for (const e of (r.timeline?.events || [])) if (e.type === "m.room.message" && isBotSender(e.sender)) {
    const b = e.content.body || ""
    if (/no logins|not logged/i.test(b)) continue
    for (const m of b.matchAll(/\+?\d[\d\s]{7,}\d/g)) out.push(m[0].replace(/[\s+]/g, ""))
  }
  const list = [...new Set(out)]
  try { writeFileSync(`/tmp/matrix_logins_${network}.json`, JSON.stringify(list)) } catch {}
  return list
}

// backfill de avatares: recorre todas las salas y baja las fotos de perfil de los miembros (sin tocar mensajes)
// Backfill REAL contacto-por-contacto: por cada hilo le pide a Matrix la foto (profile del ghost para DMs, m.room.avatar para grupos)
// y la guarda bajo el NOMBRE del contacto/grupo (no el push-name). Uso: node src/matrix.mjs avatars-all
export async function backfillAllAvatars() {
  const token = await login()
  const { handle } = await import("./lib/db-core.mjs") // one-off backfill (avatars): handle explícito de db-core (excepción marcada al seam)
  const d = handle()
  const threads = d.prepare("SELECT thread FROM thread_stats WHERE thread!='' AND thread!='self' AND thread NOT LIKE 'spam:%'").all()
  const ghostQ = d.prepare("SELECT sender FROM messages WHERE thread=? AND dir='in' AND sender LIKE '@whatsapp\\_%' ESCAPE '\\' GROUP BY sender ORDER BY COUNT(*) DESC LIMIT 1")
  const domLike = "!%:%" // AGNÓSTICO del dominio: matchea salas portal !<id>:<dominio> de cualquier Matrix (no depende de DOMAIN/MATRIX_DOMAIN)
  const roomQ = d.prepare(`SELECT jid FROM messages WHERE thread=? AND jid LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 1`)
  const nameQ = d.prepare("SELECT name FROM messages WHERE thread=? AND dir='in' AND name!='' GROUP BY name ORDER BY COUNT(*) DESC LIMIT 1")
  const grpQ = d.prepare("SELECT grp FROM messages WHERE thread=? AND grp IS NOT NULL LIMIT 1")
  let done = 0, tried = 0
  for (const t of threads) {
    tried++
    try {
      const isGroup = /@g\.us|@thread\.v2|@newsletter|@broadcast/.test(t.thread) || /^whatsapp:!/.test(t.thread)
      if (isGroup) {
        const room = roomQ.get(t.thread, domLike)?.jid || (t.thread.startsWith("whatsapp:!") ? t.thread.slice(9) : null)
        if (!room) continue
        const gname = grpQ.get(t.thread)?.grp; if (!gname) continue
        if (avatarMap[norm(gname)]) continue
        const st = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/state/m.room.avatar/`, token).catch(() => null)
        if (st?.url) { await ensureAvatar(token, gname, st.url); if (avatarMap[norm(gname)]) done++ }
      } else {
        const g = ghostQ.get(t.thread)?.sender; if (!g) continue
        const names = new Set()
        if (!t.thread.includes(":")) names.add(t.thread) // hilo con nombre canónico
        const pn = nameQ.get(t.thread)?.name; if (pn) names.add(pn) // push name (para el fallback)
        if (![...names].some((n) => !avatarMap[norm(n)])) continue // ya tiene foto
        const prof = await api("GET", `/_matrix/client/v3/profile/${encodeURIComponent(g)}/avatar_url`, token).catch(() => null)
        if (!prof?.avatar_url) continue
        for (const nm of names) { const before = avatarMap[norm(nm)]; await ensureAvatar(token, nm, prof.avatar_url); if (avatarMap[norm(nm)] && !before) done++ }
      }
    } catch {}
    if (tried % 50 === 0) console.log(`  ...${tried}/${threads.length} hilos · ${done} fotos nuevas`)
  }
  console.log(`✅ backfill fotos: ${done} nuevas de ${tried} hilos (total avatares: ${Object.keys(avatarMap).length})`)
}

// SYNC de portales: pone el NOMBRE real de cada grupo (de la DB del bridge) y unifica los DMs del bridge con el contacto.
export async function syncBridgePortals() {
  const { mergeThreads, rebuildStats } = await import("./lib/db.mjs")
  const { handle } = await import("./lib/db-core.mjs") // one-off backfill (grupos): handle explícito de db-core (excepción marcada al seam)
  const Database = (await import("better-sqlite3")).default
  const mdb = new Database(MAUTRIX_WA_DB, { readonly: true })
  const { readFileSync, existsSync } = await import("fs")
  const contacts = existsSync("./data/contacts-map.json") ? JSON.parse(readFileSync("./data/contacts-map.json", "utf8")) : {}
  const { phoneOf } = await import("./lib/thread.mjs")
  const d = handle()
  const portals = mdb.prepare("SELECT id, mxid, name, other_user_id, room_type FROM portal WHERE mxid IS NOT NULL").all()
  const setGrp = d.prepare("UPDATE messages SET grp=? WHERE thread=?")
  let mergedG = 0, mergedD = 0, named = 0
  for (const p of portals) {
    if (p.room_type === "space") continue
    const live = "whatsapp:" + p.mxid
    if (p.room_type === "dm") {
      const num = phoneOf(p.other_user_id) || phoneOf(p.id)
      if (num && MY_NUMBERS.has(num)) { mergedD += mergeThreads("self", [live]); continue } // DM conmigo mismo → Mis Notas
      if (!num) continue
      const canon = contacts[num] || `whatsapp:${num}@s.whatsapp.net`
      if (canon !== live) mergedD += mergeThreads(canon, [live])
    } else { // GRUPO: fusionar la sala live !room con el hilo histórico @g.us (elimina duplicados) + nombre
      const canon = "whatsapp:" + p.id
      if (canon !== live) mergedG += mergeThreads(canon, [live])
      if (p.name) named += setGrp.run(p.name, canon).changes
    }
  }
  // LID→número: WhatsApp está migrando todos los contactos a "LID" (@lid), un identificador de privacidad distinto del número (@s.whatsapp.net).
  // El mismo contacto entra a veces como @lid y a veces como @s.whatsapp.net → DOS hilos para una persona (contacto duplicado). El bridge
  // guarda el mapeo real en whatsmeow_lid_map(lid, pn); lo usamos para fusionar cada hilo @lid en su hilo por número. Cero hardcodeo.
  let mergedL = 0
  try {
    const lids = mdb.prepare("SELECT lid, pn FROM whatsmeow_lid_map").all()
    for (const { lid, pn } of lids) {
      if (!lid || !pn) continue
      const live = `whatsapp:${lid}@lid`
      const num = String(pn).replace(/[:@].*$/, "") // pn puede venir "595...@s.whatsapp.net" o "595...:12@..."
      const canon = MY_NUMBERS.has(num) ? "self" : (contacts[num] || `whatsapp:${num}@s.whatsapp.net`)
      if (canon !== live) mergedL += mergeThreads(canon, [live])
    }
  } catch (e) { console.warn("lid-merge:", e.message) }
  rebuildStats()
  console.log(`portales: grupos unificados ${mergedG} msgs, DMs unificados ${mergedD} msgs, LID→número ${mergedL} msgs, ${named} nombrados`)
}

export async function backfillAvatars() {
  const token = await login()
  const s = await api("GET", "/_matrix/client/v3/sync?timeout=10000&full_state=true", token)
  let seen = 0
  for (const [, r] of Object.entries(s.rooms?.join || {}))
    for (const e of [...(r.state?.events || []), ...(r.timeline?.events || [])])
      if (e.type === "m.room.member" && e.content?.avatar_url && e.content?.displayname) { await ensureAvatar(token, e.content.displayname, e.content.avatar_url); seen++ }
  console.log(`avatares: ${Object.keys(avatarMap).length} fotos guardadas (${seen} miembros vistos)`)
}

// CLI (solo al ejecutar directo, no al importar)
if (process.argv[1] && process.argv[1].endsWith("matrix.mjs")) {
  const [, , cmd, net, flow, phone] = process.argv
  if (cmd === "link") { linkNetwork(net, flow || "qr", phone || "").then((ok) => process.exit(ok ? 0 : 1)) }
  else if (cmd === "link-token") { linkWithToken(net, process.env.LINK_CRED || "").then((ok) => process.exit(ok ? 0 : 1)) }
  else if (cmd === "logins") { listLogins(net).then((l) => { console.log(l); process.exit(0) }) }
  else if (cmd === "avatars") { backfillAvatars().then(() => process.exit(0)) }
  else if (cmd === "avatars-all") { backfillAllAvatars().then(() => process.exit(0)) }
  else if (cmd === "bridge-avatars") { syncBridgeAvatars().then(() => process.exit(0)) }
  else if (cmd === "bridge-portals") { syncBridgePortals().then(() => process.exit(0)) }
  else { runReader() }
}
