// Generic IMAP mail reader (Gmail, Zoho, cualquier IMAP) — LECTURA en tiempo real (IDLE).
// Durable: usa App Password, NO OAuth → nunca se reautoriza. Soporta varias cuentas.
// Config (gitignoreada): auth/imap-accounts.json →
//   [{ "label":"gmail-personal", "host":"imap.gmail.com", "port":993, "user":"tu@gmail.com", "pass":"app password 16 letras" }, ...]
import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { appendMessage } from "./lib/lock.mjs"
import { casPutBuffer } from "./lib/cas.mjs"
import { decSecret } from "./lib/secrets.mjs"
import { gmailAccessToken } from "./lib/google.mjs"

// credenciales IMAP: OAuth (Gmail conectado por "Permitir") → XOAUTH2 con access_token fresco; si no, app-password cifrada.
async function imapAuth(acc) {
  if (acc.oauth === "google") return { user: acc.user, accessToken: await gmailAccessToken(decSecret(acc.refreshToken)) }
  return { user: acc.user, pass: decSecret(acc.pass) }
}

mkdirSync("./data", { recursive: true })
const cfgFile = "./auth/imap-accounts.json"
const hasAccounts = () => { try { return existsSync(cfgFile) && (JSON.parse(readFileSync(cfgFile, "utf8")) || []).length > 0 } catch { return false } }
// Sin cuentas todavía (tenant nuevo / hub sin correo): ESPERAR, no salir con error. Antes hacía process.exit(1) → el supervisor
// lo reiniciaba cada 3s en CRASH-LOOP eterno (CPU + logs). Ahora sondeamos cada 5s y arrancamos apenas agregás una cuenta desde la app.
let _warned = false
while (!hasAccounts()) {
  if (!_warned) { console.log("[mail-imap] sin cuentas IMAP configuradas — esperando (agregá una en la app → Correo)…"); _warned = true }
  await new Promise((r) => setTimeout(r, 5000))
}
const accounts = JSON.parse(readFileSync(cfgFile, "utf8"))

// Dedup a nivel jsonl. SIN esto, el backfill de 60 al (re)conectar —el IDLE de Gmail corta ~cada 29min— re-appendea los
// MISMOS emails (cuerpo HTML completo, hasta 2.5MB c/u) a data/messages.jsonl → crecía ~24GB/día (el .db ya deduplica por
// id, pero el log append-only no). Persistimos los ids vistos para sobrevivir reinicios del daemon (si no, cada arranque
// re-appendearía los 60). Cap in-memory + en disco para no crecer sin límite. Ver mail-outlook.mjs (mismo patrón seenIds).
const SEEN_FILE = "./data/.imap-seen.json"
let seenIds = new Set()
try { seenIds = new Set(JSON.parse(readFileSync(SEEN_FILE, "utf8"))) } catch {}
let _seenDirty = 0
const saveSeen = () => { try { if (seenIds.size > 4000) seenIds = new Set([...seenIds].slice(-3000)); writeFileSync(SEEN_FILE, JSON.stringify([...seenIds].slice(-3000))) } catch {} }

// ext del adjunto: por la extensión del nombre, o por el mimetype (para que el visor sirva el Content-Type correcto; .pdf/.xlsx/etc.)
const _MIMEXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "text/csv": "csv", "application/zip": "zip", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/msword": "doc", "application/vnd.ms-excel": "xls", "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx" }
const attExt = (name, mime) => { const m = String(name || "").match(/\.([a-z0-9]{1,6})$/i); return m ? m[1].toLowerCase() : (_MIMEXT[String(mime || "").toLowerCase()] || "bin") }
// parsea el source RFC822 → {preview, body (HTML), attachments (JSON de adjuntos REALES bajados al CAS)}
async function parseBody(source) {
  if (!source) return { preview: "", body: null, attachments: null }
  try {
    const p = await simpleParser(source)
    const preview = (p.text || "").replace(/\s+/g, " ").trim().slice(0, 200)
    const body = p.html || (p.textAsHtml ? p.textAsHtml : (p.text ? `<pre>${p.text}</pre>` : null))
    const atts = []
    for (const a of (p.attachments || [])) {
      if (!a.content || !a.content.length) continue               // vacío → no es adjunto
      if (a.content.length > 25 * 1024 * 1024) continue           // cap 25MB (no reventar el CAS con un adjunto gigante)
      // las INLINE (a.related, referenciadas por cid: en el HTML) también se guardan: son las imágenes del cuerpo (tablas,
      // capturas, firma). Antes se descartaban y el visor mostraba recuadros vacíos. Van marcadas inline:true + su cid,
      // para que el server las inline como data: al servir el cuerpo y la lista de adjuntos no se llene de logos.
      const inline = !!a.related
      try {
        const cas = casPutBuffer(a.content, attExt(a.filename, a.contentType), "email/attach")
        const at = { name: a.filename || (inline ? "imagen" : "adjunto"), cas, mime: a.contentType || "", size: a.content.length }
        if (inline) { at.inline = true; at.cid = String(a.cid || a.contentId || "").replace(/^<|>$/g, "") }
        atts.push(at)
      } catch (e) { console.log("[imap] adjunto no bajó:", e.message) }
    }
    return { preview, body, attachments: atts.length ? JSON.stringify(atts) : null }
  } catch { return { preview: "", body: null, attachments: null } }
}

function store(label, party, subject, preview, ts, unread, dir = "in", body = null, msgId = "", attachments = null) {
  // id = Message-ID del correo (estable y único). Sin esto, el fallback sintético colisiona por (canal,ts,name) y descarta emails legítimos del mismo remitente/segundo.
  const id = msgId ? `email:${msgId}` : ""
  if (id && seenIds.has(id)) return // ya lo appendeamos antes (re-fetch del backfill al reconectar) → NO duplicar en el jsonl
  const rec = { ...(id ? { id } : {}), channel: "email", account: label, jid: party.address || "", name: party.name || party.address || "?", text: `${subject} — ${preview}`.slice(0, 260), ts, unread, dir, body }
  if (attachments) rec.attachments = attachments
  appendMessage(rec)
  if (id) { seenIds.add(id); if (++_seenDirty >= 10) { _seenDirty = 0; saveSeen() } }
  console.log(`${dir === "out" ? "➡️ " : "📧"} [${label}${dir === "out" ? "→" : ""}] ${party.name || party.address}: ${subject}${attachments ? " 📎" : ""}`)
}

// ENVIADOS — conexión aparte, poll cada 2 min. jid = destinatario, dir = out (para saber qué ya respondiste)
// Cierre con tope. `logout()` habla con el servidor: contra un socket vivo-pero-sordo se queda esperando el timeout
// interno del cliente (5 min), y mientras tanto no reconecta. A los 10s cortamos por lo sano.
async function cerrar(client) {
  try { await Promise.race([client.logout(), new Promise((r) => setTimeout(r, 10000))]) } catch {}
  try { client.close() } catch {}
}

async function runSent(acc) {
  const client = new ImapFlow({ host: acc.host, port: acc.port || 993, secure: true, tls: acc.insecure ? { rejectUnauthorized: false } : undefined, auth: await imapAuth(acc), logger: false }) // insecure: cert self-signed (Mailcow self-hosted, mismo box)
  client.on("error", () => {})
  await client.connect()
  // Mismo criterio que run(): desde el connect() hay un socket abierto y TODO lo que siga va dentro del try/finally.
  // Acá el hueco era client.list(): si fallaba, la conexión quedaba viva y el supervisor abría otra encima cada 8s.
  try {
  const boxes = await client.list()
  const sentBox = boxes.find((b) => (b.specialUse === "\\Sent") || /sent/i.test(b.path))?.path
  if (!sentBox) { console.log(`[${acc.label}] sin carpeta Enviados`); return }
  let lastSeq = 0
  const pull = async () => {
    const lock = await client.getMailboxLock(sentBox)
    try {
      const status = await client.status(sentBox, { messages: true })
      const total = status.messages || 0
      const from = lastSeq ? lastSeq + 1 : Math.max(1, total - 9)
      if (total >= from) for await (const msg of client.fetch(`${from}:${total}`, { envelope: true })) {
        const to = msg.envelope?.to?.[0] || {}
        store(acc.label, to, msg.envelope?.subject || "(sin asunto)", "", +new Date(msg.envelope?.date || Date.now()), false, "out", null, msg.envelope?.messageId)
      }
      lastSeq = total
    } finally { lock.release() }
  }
  // loop con sleep (no setInterval): si la conexión se cae, pull() tira → runSent RETORNA → el supervisor reconecta.
  for (;;) { await pull(); try { writeFileSync("/tmp/hb_email", String(Date.now())) } catch {}; await new Promise((r) => setTimeout(r, 120000)) } // heartbeat: pull IMAP OK
  } finally { await cerrar(client) }
}

async function run(acc) {
  const client = new ImapFlow({ host: acc.host, port: acc.port || 993, secure: true, tls: acc.insecure ? { rejectUnauthorized: false } : undefined, auth: await imapAuth(acc), logger: false }) // insecure: cert self-signed (Mailcow self-hosted, mismo box)
  client.on("error", (e) => console.log(`[${acc.label}] error:`, e.message))
  await client.connect()
  // Desde acá hay un socket abierto: TODO lo que siga va dentro del try/finally. Antes el logout vivía solo alrededor del
  // idle() del final, así que si fallaba el lock del buzón (o cualquier cosa entre medio) la conexión quedaba viva y el
  // supervisor reconectaba ENCIMA cada 8s. Con un servidor que limita conexiones simultáneas, eso se acumula hasta que
  // rechaza todo — y desde afuera parece "el correo dejó de entrar" sin ningún error claro.
  try {
  console.log(`✅ [${acc.label}] CONECTADO (${acc.user}) — escuchando INBOX...`)
  const lock = await client.getMailboxLock("INBOX")
  let lastSeq = 0
  try {
    // trae los últimos 15 al conectar
    const status = await client.status("INBOX", { messages: true })
    const total = status.messages || 0
    lastSeq = total
    if (total > 0) {
      const from = Math.max(1, total - 59) // backfill de cuerpo: últimos 60 al conectar
      for await (const msg of client.fetch(`${from}:${total}`, { envelope: true, flags: true, source: true })) {
        const e = msg.envelope
        const { preview, body, attachments } = await parseBody(msg.source)
        store(acc.label, e.from?.[0] || {}, e.subject || "(sin asunto)", preview, +new Date(e.date || Date.now()), !msg.flags?.has("\\Seen"), "in", body, e.messageId, attachments)
      }
    }
  } finally { lock.release() }

  // tiempo real: cada mensaje nuevo dispara "exists"
  client.on("exists", async (data) => {
    if (data.count <= lastSeq) return
    const l2 = await client.getMailboxLock("INBOX")
    try {
      for await (const msg of client.fetch(`${lastSeq + 1}:${data.count}`, { envelope: true, flags: true, source: true })) {
        const e = msg.envelope
        const { preview, body, attachments } = await parseBody(msg.source)
        store(acc.label, e.from?.[0] || {}, e.subject || "(sin asunto)", preview, +new Date(e.date || Date.now()), !msg.flags?.has("\\Seen"), "in", body, e.messageId, attachments)
      }
      lastSeq = data.count
    } finally { l2.release() }
  })
  // idle() resuelve/tira cuando la conexión termina → run() RETORNA → el supervisor reconecta (y el backfill de 60 recupera el downtime).
  await client.idle()
  } finally { await cerrar(client) }
}

// SUPERVISOR: IMAP-IDLE puede quedar "vivo pero sordo" (la promesa idle no vuelve o la conexión se cae sin salir del proceso).
// Reconecta con backoff. El backfill de 60 al reconectar es el catch-up del downtime.
async function supervise(acc, fn, label) {
  for (;;) {
    try { await fn(acc) } catch (e) { console.log(`[${acc.label}] ${label} caído: ${e.message}`) }
    await new Promise((r) => setTimeout(r, 8000))
    console.log(`[${acc.label}] reconectando ${label}...`)
  }
}
for (const acc of accounts) { supervise(acc, run, "INBOX"); supervise(acc, runSent, "Enviados") }
