// brain/inbox — la BANDEJA (hot path). listThreads arma una fila por hilo/persona juntando canales, dedup, buckets
// (spam/familia/amigos/trabajo), read-state y espacios-como-hilos. Es la lectura más caliente de todo el sistema.
// M4: listThreads acepta un 2º arg {cache} para el SHADOW-ASSERT — compute fresco sin cache → comparar viejo-vs-nuevo
// sobre el MISMO snapshot de la DB (sin skew de los 15s de cache). Tras la ventana de canary (0 divergencias) pasa a ser
// la única impl y brain la re-exporta por `export *`.
import { readFileSync, existsSync, statSync, mkdirSync } from "fs"
import { join, basename } from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { tmpdir } from "os"
import { threadsSummary as dbThreads, repliedThreads, getBody as dbGetBody, threadMediaGallery, threadPage as dbThreadPage, threadCount as dbThreadCount, threadMessagesTail as dbThreadMsgs, threadSince as dbThreadSince, threadUnreadCount as dbUnreadCount, search as dbSearch, threadMessagesSinceAll, threadDelta as dbThreadDelta, threadMaxRev as dbThreadMaxRev } from "../db.mjs"
import { autopilotSentIds, listAutopilot, getAutopilot, listEscalations, clearEscalation } from "./autopilot.mjs" // 🤖 tag de mensajes/contactos del piloto automático
import { secretThreadKeys, isSecretMsg } from "../secret.mjs" // 🔒 cuentas/números secretos (excluir de bandeja/búsqueda; filtrar por-mensaje en el hilo)
import { jidOfKey, canonOfKey, numOf, initials, stripWA, norm, plural, isContainerJid } from "./kernel/keys.mjs"
import { enrichCovert, getCovert } from "./covert.mjs"
import { jf, waGroups, avatarMap, contactName, photoFor } from "./kernel/contacts.mjs"
import { peopleNodes, cardFor, fm } from "./kernel/vault.mjs"
import { cleanMsg } from "./kernel/convo.mjs"
import { owner, ownerFirst } from "../hub.mjs"
import { llm, geminiMultimodal, geminiUploadFile } from "../llm.mjs"
import { MY_EMAILS } from "../thread.mjs"
import { isSpam, llmSpam, notSpam } from "../spam.mjs"
import { ocrCas, ocrEnabled } from "../ocr.mjs"
import { espacioThreads, _espRulesOf } from "./espacios.mjs"
const pexecFile = promisify(execFile)

let _ptCache = { ts: 0 } // tags/seed del vault (cambian raro) — memoizado 60s
function peopleTagsCached() {
  if (_ptCache.ptags && Date.now() - _ptCache.ts < 600000) return _ptCache // 10 min: el vault cambia muy raro; leer 221 md era el ~800ms del cold path
  const ptags = {}, pseed = {}
  for (const p of peopleNodes()) { const c = cardFor("People", p); ptags[p] = (fm(c, "tags") + " " + fm(c, "role")).toLowerCase(); pseed[p] = /^seed:\s*true/m.test(c) }
  _ptCache = { ts: Date.now(), ptags, pseed }
  return _ptCache
}
let _ltCache = { ts: 0 } // resultado de la bandeja — cache corto (6s) para que navegar entre pestañas sea instantáneo
export function invalidateThreads() { _ltCache = { ts: 0 } } // llamar tras enviar/archivar/pinear
export function listThreads({ limit = 200 } = {}, { cache = true } = {}) {
  if (cache && _ltCache.data && _ltCache.limit === limit && Date.now() - _ltCache.ts < 15000) return _ltCache.data // 15s: la ingesta es cada 15s, no hace falta recomputar el inbox más seguido
  const rows = dbThreads({ limit: Math.min(limit * 3, 600) }) // amplio: mostrar TODO (menos spam)
  const grpNames = waGroups()
  const cats = (jf("contact-overrides.json") || {}).categories || {} // categorías manuales del usuario (familia/amigos/trabajo)
  const pinned = new Set(jf("pins.json") || []) // hilos fijados arriba
  const seen = jf("seen.json") || {} // última vez visto por hilo (mismo estado que el catchup) → para "sin leer"
  const replied = new Set(repliedThreads().map((r) => r.thread)) // hilos donde YA respondí (correspondencia real)
  const arch = new Set(jf("archived.json") || []) // hilos archivados (ocultos)
  const sil = new Set(jf("silenced.json") || []) // hilos silenciados (ruido que no es spam) — NO se ocultan: se marcan y viven en su pestaña
  const autoOn = new Set(listAutopilot()) // contactos con piloto automático → 🤖 en la foto (las 3 apps)
  const esc = listEscalations() // hilos que el piloto escaló → fijar arriba + color hasta que respondas
  const spamS = new Set((jf("spam-senders.json") || []).map((x) => String(x).toLowerCase())) // remitentes marcados spam
  // hilos que caen en un ESPACIO → NO se muestran sueltos en la bandeja (viven DENTRO del espacio, como una carpeta). Misma semántica que las reglas (db.espacioMessages).
  const allEsp = jf("espacios.json") || []
  const matchEspRule = (r, k, nm, addr) => { const v = String(r.value || "").trim().toLowerCase(); if (!v) return false
    if (r.type === "email") return addr === v
    if (r.type === "domain") { const d = v.replace(/^@/, ""); return !!addr && (addr.endsWith("@" + d) || addr.endsWith("." + d)) }
    if (r.type === "name") return nm === v || k === v
    if (r.type === "phone") { const n = v.replace(/\D/g, ""); return n.length >= 6 && k.replace(/\D/g, "").includes(n) }
    return false }
  const inEspacio = (key, name) => {
    if (!allEsp.length) return false
    const nm = String(name || "").toLowerCase(), k = String(key || "").toLowerCase(), addr = k.startsWith("email:") ? k.slice(6) : ""
    return allEsp.some((esp) => {
      const rules = _espRulesOf(esp); if (!rules.length || !rules.some((r) => matchEspRule(r, k, nm, addr))) return false
      return !(esp.exceptions || []).some((r) => matchEspRule(r, k, nm, addr)) // en el espacio solo si NO cae en una excepción
    })
  }
  const CATMAP = { familia: "family", amigos: "amigos", trabajo: "trabajo" }
  const { ptags, pseed } = peopleTagsCached() // memoizado 60s — leer 221 md del vault en cada carga era ~800ms
  // ANTISPAM: usa el detector COMPARTIDO (lib/spam.mjs) — el mismo que filtra el coach/IA. Antes había una regex local
  // distinta acá → inbox y coach clasificaban distinto (Plaud se colaba en el coach). Ahora es un solo detector.
  const AV = avatarMap()
  const bucketOf = (r, kind, canon, jid, name, grp) => {
    if (spamS.has(String(jid).toLowerCase()) || spamS.has(String(r.key).replace(/^email:/, "").toLowerCase())) return "spam" // remitente marcado spam por el usuario
    if (cats[r.key]) return CATMAP[cats[r.key]] || "other" // categoría manual manda
    // 🛡️ TUS PROPIAS cuentas conectadas → NUNCA spam (es tu inbox). Antes hilos de hola@tudominio.com / ventas@… salían spam y se ocultaban.
    const own = MY_EMAILS.has(String(jid || "").toLowerCase()) || MY_EMAILS.has(String(r.key || "").replace(/^email:/, "").toLowerCase())
    if (kind !== "group" && !own && llmSpam(r.key) && !notSpam(r.key)) return "spam" // veredicto LLM (capa 2), salvo que el usuario lo haya des-marcado
    if (kind === "self") return "other"
    // ANTISPAM: SOLO para emails puros. WhatsApp/Telegram/etc NUNCA es spam (regla del usuario).
    const chans = r.channels || r.lastChannel || ""
    const pureEmail = /email/.test(chans) && !/whatsapp|telegram|instagram|signal|teams/.test(chans)
    if (pureEmail && !own && isSpam(jid, name, r.lastText || "") && !notSpam(r.key)) return "spam" // detector compartido, salvo des-marcado por el usuario
    if (kind === "group") return /familia|family|casa|hogar|amig/i.test(grp || grpNames[jid] || name || "") ? "family" : "other"
    if (canon) { const t = ptags[canon] || ""; if (/familia/.test(t)) return "family"; if (/amigo/.test(t)) return "amigos"; if (pseed[canon] && /cliente|inversor|socio|partner|proveedor|empleado|due[ñn]o|contacto|finanzas/.test(t)) return "trabajo" }
    return "other"
  }
  let result = rows.map((r) => {
    const jid = jidOfKey(r.key), canon = canonOfKey(r.key)
    const self = r.key === "self"
    // grupo SOLO si el jid es contenedor (@g.us / thread.v2 / sala !room). Un 1:1 fusionado puede tener varios nombres → NO es grupo.
    const kind = self ? "self" : (isContainerJid(jid) ? "group" : "dm")
    let name = canon || r.name || numOf(jid), avatar = initials(name)
    if (kind === "self") { name = "Mis Notas"; avatar = "📝" }
    else if (kind === "group") {
      // casos especiales de WhatsApp que NO son grupos de verdad → nombre propio en vez del genérico "Grupo · N personas"
      if (/status@broadcast/.test(jid)) { name = "Historias de WhatsApp"; avatar = "📸" }
      else if (/@newsletter/.test(jid)) { name = r.grp || grpNames[jid] || "Canal de WhatsApp"; avatar = "📢" }
      else { name = r.grp || grpNames[jid] || `Grupo · ${plural(r.nsenders || 2, "persona")}`; avatar = "👥" }
    }
    else if (kind === "dm" && !canon) { const cn = contactName(jid) || contactName(name); if (cn) name = cn } // resolver número → nombre de la agenda
    const clean = stripWA(name)
    const photo = kind === "group" ? (AV[norm(clean)] || AV[norm(r.grp || "")] || null) : (kind === "dm" ? photoFor(clean, jid, r.key) : null)
    const bucket = bucketOf(r, kind, canon, jid, clean, r.grp)
    const lt = (cleanMsg(r.lastText) || "").replace(/\s+/g, " ")
    // read-state: sin leer = último mensaje ENTRANTE y más nuevo que la última vez que abrí el hilo
    const unseen = r.lastDir === "in" && (r.ts || 0) > (seen[r.key] || 0)
    // sugerido de responder (proactividad tipo coach): un CONTACTO (no grupo) que espera MI respuesta, mensaje real y reciente,
    // NO spam/newsletter, NO mensaje de sistema del bridge, NO notificación automática de banco/factura.
    const SYS_MSG = /incoming call|missed call|failed to bridge|use the whatsapp app|this message was deleted|waiting for this message|llamada perdida|se eliminó este mensaje/i
    const NOTIF_RE = /notificaci[oó]n|aviso|alerta|comprobante|estado de cuenta|verificaci[oó]n|c[oó]digo|\botp\b|no-?reply|factura|recibo|pedido|order|receipt|newsletter|promo|it is me again|unsubscribe|boletín/i
    const ageDays = (Date.now() - (r.ts || 0)) / 86400000
    const emailAddr = r.key.startsWith("email:") ? r.key.slice(6) : null
    // sugerido: contacto real (no grupo/spam/sistema), reciente. Para EMAIL además exige correspondencia real (ya le respondí) y que no sea notificación → mata recibos/marketing.
    const suggested = r.lastDir === "in" && kind !== "group" && bucket !== "spam" && lt.length > 10 && ageDays <= 30
      && !isSpam(jid, clean, lt) && !SYS_MSG.test(lt)
      && (r.lastChannel === "email" ? (replied.has(r.key) && !NOTIF_RE.test(`${emailAddr || ""} ${clean} ${lt}`) && !MY_EMAILS.has((emailAddr || "").toLowerCase())) : true)
    // ident buscable: nombre + número (del jid/sender) + email → permite filtrar por tel/email aunque el hilo esté keyeado por nombre
    const ident = [numOf(jid), r.ident].filter(Boolean).join(" ").toLowerCase() || null
    // escalada del piloto: activa solo mientras NO respondiste (si tu último msg es saliente, ya lo atendiste → limpiar)
    let escalated = false, escalatedReason = null
    if (esc[r.key]) { if (r.lastDir === "out") clearEscalation(r.key); else { escalated = true; escalatedReason = esc[r.key].reason || null } }
    return { key: r.key, canon, self, group: kind === "group", name: clean, photo, initials: avatar, channels: r.channels || [], lastChannel: r.lastChannel, count: r.count, unread: r.unread || 0, unseen, suggested, email: emailAddr, account: r.account || null, ident, ts: r.ts, lastText: lt.slice(0, 120) || "…", lastDir: r.lastDir, bucket, pinned: pinned.has(r.key), silenced: sil.has(r.key), autopilot: autoOn.has(r.key), escalated, escalatedReason }
  }).filter((t) => t.key !== "self" && !arch.has(t.key) && !inEspacio(t.key, t.name) && !/whatsapp status broadcast/i.test(t.name || "")) // self va en su pestaña; archivados ocultos; los de un espacio viven ahí; status no es conversación
  for (const er of espacioThreads(seen)) result.push(er) // los espacios entran como una conversación más
  result = result
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0)) // fijados arriba, resto por recencia (incluido "Mis Notas")
    .slice(0, limit)
  if (cache && result.length) _ltCache = { ts: Date.now(), limit, data: result } // NUNCA cachear vacío: un read transitorio malo no se queda pegado (shadow: cache=false → no ensucia el cache)
  return result
}

// ── LECTURAS DE HILO / BANDEJA (movidas desde brain en M4 tranche b) ──
export function emailBody(id) { return dbGetBody(id) }

// GALERÍA: todos los adjuntos (fotos/docs/videos/audios) intercambiados en un hilo. Para la vista "📎 Adjuntos" del contacto.
export function threadMedia(key) {
  const rows = threadMediaGallery(key)
  return { items: rows.map((r) => ({ media: r.media, type: r.mediaType || "file", filename: r.filename, ts: r.ts, who: r.dir === "out" ? "Vos" : stripWA(r.name || "") })) }
}

// ── BÚSQUEDA FULL-TEXT en todos los mensajes/mails ──
export function searchMessages(query, { limit = 80 } = {}) {
  // FTS5 en SQLite → instantáneo sobre millones de mensajes
  let secretKeys = new Set(); try { secretKeys = secretThreadKeys() } catch {} // 🔒 no buscar en cuentas secretas
  // excluye hilos 100%-secretos Y, en hilos PARCIALES (contacto con línea secreta + no-secreta), los mensajes de canal secreto (dbSearch trae m.*)
  const rows = dbSearch(query, { limit: secretKeys.size ? limit + 40 : limit }).filter((e) => !secretKeys.has(e.thread) && !isSecretMsg(e))
  return rows.slice(0, limit).map((e) => ({ key: e.thread, who: stripWA(e.grp || e.name || ""), channel: e.channel, ts: e.ts || 0, dir: e.dir || "in", text: cleanMsg(e.text || "").slice(0, 240) }))
}

// transforma UNA fila de la DB en el item liviano que renderiza el cliente (mismo shape para el hilo completo y para el delta).
// `text` opcional (ya limpio); si no viene se calcula. Adjunta `rev` para que el cliente sepa hasta dónde sincronizó.
function msgToItem(e, AV, text) {
  const t = text != null ? text : cleanMsg(e.text)
  const nm = e.dir === "out" ? owner() : (contactName(e.sender) || contactName(e.name) || stripWA(e.name))
  const item = { id: e.id || `${e.ts}`, channel: e.channel, dir: e.dir || "in", name: nm, photo: AV[norm(nm)] || null, ts: e.ts, text: t || "", media: e.media || null, mediaType: e.mediaType || null, filename: e.filename || null, rev: e.rev || 0 }
  if (e.channel === "email") { item.full = e.text; if (e.body) item.hasBody = true; if (e.summary) item.summary = e.summary; if (e.attachments) item.attachments = e.attachments }
  if (e.channel === "meeting") { item.meeting = true; if (e.body) item.hasBody = true; if (e.summary) item.summary = e.summary }
  if (e.mediaType === "audio" && e.summary) { item.summary = e.summary; item.audioSummary = true }
  return item
}

// DELTA edit-aware: items del hilo con rev > sinceRev (NUEVOS o editados). El cliente los mergea por id en su copia local.
// Devuelve { items, maxRev } — maxRev es la revisión más alta del hilo (aunque el batch venga paginado por el limit).
// SYNC de texto completo (para clientes que quieren TODO el historial local): página LIVIANA hacia atrás (items = texto + path de
// media, SIN blobs). El cliente pagina por `before` hasta hasMore=false. Sin enrich de covert/ai-notes (velocidad para backfills grandes).
export function threadSyncPage(key, before = 0, { limit = 800 } = {}) {
  const rows = dbThreadPage(key, { before: before || 0, limit })
  const AV = avatarMap()
  const items = []
  for (const e of rows) { const text = cleanMsg(e.text); if (!text && !e.media && !e.body) continue; items.push(msgToItem(e, AV, text)) }
  return { items, oldestTs: rows.length ? rows[0].ts : 0, hasMore: rows.length >= limit }
}
export function threadDeltaItems(key, sinceRev = 0, { limit = 500 } = {}) {
  const rows = dbThreadDelta(key, sinceRev, { limit })
  const AV = avatarMap()
  const items = []
  for (const e of rows) {
    const text = cleanMsg(e.text)
    if (!text && !e.media && !e.body) continue // filas vacías (placeholders internos) no son items
    items.push(msgToItem(e, AV, text))
  }
  const autoSet = autopilotSentIds(); items.forEach((it) => { if (it.dir === "out" && autoSet.has(it.id)) it.auto = true }) // 🤖
  enrichCovert(key, items) // mismo tratamiento que el hilo completo: descifra los tapadera si el contacto tiene clave
  return { items, maxRev: dbThreadMaxRev(key) }
}

export async function unifiedThread(key, ws, { before = 0, limit = 100, secretOn = false } = {}) {
  // 🔒 POR-MENSAJE: si NO está desbloqueado, saco los mensajes de números/cuentas secretos (contacto fusionado → ves solo lo no-secreto)
  const rows = dbThreadPage(key, { before, limit }).filter((e) => secretOn || !isSecretMsg(e.thread ? e : { ...e, thread: key }))
  const total = dbThreadCount(key)
  const AV = avatarMap()
  const items = []
  let lastOutText = "", lastOutTs = 0
  for (const e of rows) {
    const text = cleanMsg(e.text)
    if (!text && !e.media && !e.body) continue
    // DEDUP del ECO: mandar TEXTO por el bridge inserta la fila local Y el bridge la ecoa → 2 filas 'out' idénticas.
    // Colapsar el 2do 'out' con el MISMO texto dentro de ~90s (rows cronológicas). SOLO texto real: nunca media
    // (dos imágenes/videos/audios distintos comparten placeholder "🖼 Imagen" y NO deben colapsarse).
    const isPlainOut = (e.dir || "in") === "out" && text && !e.media && !/^(🖼|📹|🎤|📄|🌟|📎|📍|👤)/.test(text)
    if (isPlainOut && text === lastOutText && e.ts - lastOutTs < 90000) continue
    if (isPlainOut) { lastOutText = text; lastOutTs = e.ts }
    const it = msgToItem(e, AV, text)
    if (secretOn && isSecretMsg(e)) it.secret = true // 🔒 desbloqueado: marcar los mensajes del número/cuenta secreto para el candado + fondo
    items.push(it)
  }
  const oldestTs = rows.length ? rows[0].ts : 0
  const hasMore = total > items.length && rows.length >= limit // hay mensajes más antiguos
  // metadata del hilo (nombre/foto/grupo) — usa la cola para detectar grupo, no depende de la página
  const tail = dbThreadMsgs(key, { limit: 60 })
  const senders = new Set(tail.filter((m) => m.dir !== "out" && m.name).map((m) => m.name))
  // grupo solo si la KEY es contenedor, o si hay un jid de grupo REAL de WhatsApp en la cola (@g.us/thread/newsletter/broadcast).
  // OJO: NO usar isContainerJid sobre el jid del mensaje — los DMs bridgeados llegan como sala matrix "!room:server" y eso los marcaría como grupo.
  const isGroup = isContainerJid(jidOfKey(key)) || tail.some((m) => /@g\.us$|@thread\.v2$|@newsletter$|@broadcast$/.test(m.jid || ""))
  const groupName = tail.map((m) => m.grp || m.group).find(Boolean)
  const last = [...tail].reverse().find((m) => m.dir !== "out" && m.name)
  const dmNum = jidOfKey(key) || last?.jid
  const name = key === "self" ? "Mis Notas" : (isGroup ? (groupName || `Grupo · ${senders.size} personas`) : (canonOfKey(key) || contactName(dmNum) || contactName(last?.sender) || contactName(last?.name) || stripWA(last?.name || key)))
  const photo = key === "self" ? null : (ws.contactOverrides().photos[key.toLowerCase()] || (isGroup ? (AV[norm(name)] || AV[norm(groupName || "")] || null) : photoFor(name, dmNum, key)))
  // read state: cuántos mensajes entrantes hay desde la última vez que entré (para ofrecer resumen de "lo que me perdí")
  const lastSeen = key === "self" ? 0 : ws.lastSeen(key)
  const unread = lastSeen ? dbUnreadCount(key, lastSeen) : 0
  const email = key.startsWith("email:") ? key.slice(6) : null // dirección del remitente (para saber QUIÉN es)
  const account = email ? (tail.find((m) => m.channel === "email" && m.account)?.account || null) : null // a qué cuenta MÍA llegó
  // notas IA (resúmenes guardados) intercaladas en la conversación por fecha — NO son mensajes, no se envían
  const aiN = (ws.aiNotes(key) || []).map((n) => ({ id: n.id, channel: "ai-summary", dir: "ai", name: "Resumen IA", ts: n.ts, text: n.text, aiRange: n.range }))
  const autoSet = autopilotSentIds(); items.forEach((it) => { if (it.dir === "out" && autoSet.has(it.id)) it.auto = true }) // 🤖 marca lo que mandó el piloto
  const mergedItems = aiN.length ? [...items, ...aiN].sort((a, b) => (a.ts || 0) - (b.ts || 0)) : items
  enrichCovert(key, mergedItems) // modo encubierto: si el contacto tiene clave, descifra los mensajes-tapadera y adjunta it.covert
  const cv = getCovert(key) // el front usa esto para mostrar el toggle 🕊️ SOLO si este contacto tiene modo encubierto configurado
  return { key, name, group: isGroup, channels: [...new Set(tail.map((m) => m.channel))], photo, items: mergedItems, hasMore, oldestTs, total, lastSeen, unread, email, account, covert: cv.enabled ? cv.style : null, autopilot: getAutopilot(key).enabled, maxRev: dbThreadMaxRev(key) }
}

// mime por extensión — para que Gemini sepa cómo interpretar cada adjunto del CAS
const CATCHUP_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", bmp: "image/bmp",
  mp4: "video/mp4", mov: "video/quicktime", "3gp": "video/3gpp", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", mp3: "audio/mp3", m4a: "audio/aac", aac: "audio/aac", wav: "audio/wav", amr: "audio/amr", flac: "audio/flac",
  pdf: "application/pdf",
}
const CATCHUP_LABEL = { image: "una imagen", sticker: "un sticker", audio: "un audio", video: "un video", document: "un documento", gif: "un gif", file: "un archivo" }
// archivos de texto plano → se leen y se pasan como texto (Gemini los entiende directo)
const TEXT_EXT = new Set(["txt", "csv", "tsv", "json", "xml", "html", "htm", "md", "markdown", "log", "yml", "yaml", "sql", "js", "mjs", "ts", "py", "php", "css", "ini", "conf", "srt", "vtt", "ics", "eml"])
// documentos de Office → se convierten a PDF con LibreOffice (Gemini lee PDF nativo)
const OFFICE_EXT = new Set(["docx", "doc", "xlsx", "xls", "xlsm", "xlsb", "pptx", "ppt", "odt", "ods", "odp", "rtf"])
// convierte un doc de Office a PDF con LibreOffice headless (cacheado por hash). Perfil único → permite concurrencia.
async function officeToPdf(srcPath) {
  const hash = basename(srcPath).split(".")[0]
  const cacheDir = join(process.cwd(), "data", "cas-pdf")
  const out = join(cacheDir, hash + ".pdf")
  if (existsSync(out)) return out
  mkdirSync(cacheDir, { recursive: true })
  const profile = "file://" + join(tmpdir(), "lo-" + hash)
  await pexecFile("soffice", ["--headless", `-env:UserInstallation=${profile}`, "--convert-to", "pdf", "--outdir", cacheDir, srcPath], { timeout: 90000 })
  return existsSync(out) ? out : null
}
// resuelve el archivo del CAS de un mensaje → parte para Gemini. Texto→{text}; imagen/audio/pdf→inline; video/grande→Files API; Office→pdf. null = no procesable.
async function catchupMediaPart(r, budget) {
  if (!r.media) return null
  let path = join(process.cwd(), "data", r.media.replace(/^\//, "")) // /cas/xx/hash.ext → data/cas/xx/hash.ext
  if (!existsSync(path)) return null
  const ext = (r.media.split(".").pop() || "").toLowerCase()
  if (TEXT_EXT.has(ext)) { // archivo de texto → contenido como texto
    try { const t = readFileSync(path, "utf8").slice(0, 20000); return t.trim() ? { text: `\n[contenido del archivo:]\n${t}\n[fin del archivo]` } : null } catch { return null }
  }
  let mime = CATCHUP_MIME[ext] || null
  if (!mime && OFFICE_EXT.has(ext)) { const pdf = await officeToPdf(path).catch(() => null); if (!pdf) return null; path = pdf; mime = "application/pdf" }
  if (!mime) return null // binario no soportado (zip/apk/exe/etc)
  let size = 0; try { size = statSync(path).size } catch { return null }
  if (size > 30 * 1024 * 1024) return null // demasiado grande
  const isVideo = mime.startsWith("video/")
  const inlineOK = !isVideo && size <= 4 * 1024 * 1024 && budget.inline + size <= 14 * 1024 * 1024
  try {
    if (inlineOK) { budget.inline += size; return { mime, data: readFileSync(path).toString("base64") } }
    if (budget.uploads >= 6) return null // cap de subidas (video/audio grande/pdf pesado) por latencia/costo
    budget.uploads++
    return await geminiUploadFile(path, mime)
  } catch { return null }
}


// RESUMEN MULTIMODAL de lo que me perdí: TODO lo entrante desde la última vez visto — texto + imágenes + documentos/PDF + audios + video con audio.
export async function catchup(key, ws, since = 0) {
  const marker = Number(since) || ws.lastSeen(key)
  if (!marker) return { summary: "", count: 0 }
  const rows = dbThreadSince(key, marker, { limit: 300 })
  if (!rows.length) return { summary: "", count: 0 }
  const isGroup = rows.some((m) => /@g\.us$|@thread\.v2$|@newsletter$|@broadcast$/.test(m.jid || ""))
  const dias = Math.max(1, Math.round((Date.now() - marker) / 86400000))
  const sys = `Sos un asistente que le pone al día a ${ownerFirst()} sobre ${isGroup ? "un grupo" : "un contacto"} que no revisó hace ${dias} día(s). Te paso TODO lo que pasó: textos, imágenes, documentos, audios y videos. DEBÉS mirar las imágenes, leer los documentos y escuchar los audios/videos — no te quedes solo con el texto (a veces el texto solo dice "ok" y lo importante está en un audio o un PDF adjunto). Resumí en español, directo y humano (no suenes a IA), SOLO lo importante: qué pasó, qué dicen los audios/documentos/imágenes, qué le preguntaron o pidieron, qué decisiones/fechas hay, y qué requiere respuesta suya. Viñetas cortas. Marcá con ⚠️ lo urgente o que espera respuesta. No inventes: si un audio no se entiende, decilo.`
  // armar transcripción MULTIMODAL intercalada (texto + media en orden cronológico)
  const budget = { inline: 0, uploads: 0 }
  const MAX_MEDIA = 14
  const parts = []
  let mediaAttached = 0, ocrN = 0
  for (const r of rows) {
    const who = stripWA(contactName(r.sender) || contactName(r.name) || r.name || "?")
    const txt = cleanMsg(r.text)
    if (r.media && r.mediaType !== "sticker" && mediaAttached < MAX_MEDIA) {
      const part = await catchupMediaPart(r, budget)
      if (part) {
        parts.push({ text: `\n${who} envió ${CATCHUP_LABEL[r.mediaType] || "un archivo"}${r.filename ? ` "${r.filename}"` : ""}${txt ? ` (con nota: "${txt}")` : ""} — analizalo:` })
        parts.push(part); mediaAttached++
        if (ocrEnabled() && ocrN < 2 && /image|document/.test(r.mediaType || "")) { const ot = await ocrCas(r.media).catch(() => ""); if (ot) { parts.push({ text: `[texto extraído del documento (OCR local):]\n${ot.slice(0, 4000)}` }); ocrN++ } } // OCR local: texto del documento para el resumen
        continue
      }
    }
    const line = txt || (r.media ? `[${CATCHUP_LABEL[r.mediaType] || "adjunto"}]` : "")
    if (line) parts.push({ text: `${who}: ${line}` })
  }
  const intro = `Estos son los mensajes que ${ownerFirst()} se perdió en ${isGroup ? "un grupo" : "un chat"}, del más viejo al más nuevo. Contenido (texto + adjuntos):`
  const closing = `\n\nAhora resumí TODO lo que se perdió (incluí lo que ves/escuchás en los adjuntos):`
  // #token: sin LLM para lo trivial (poco texto, sin adjuntos) → template. No gasta tokens en resumir 1-2 mensajes cortos.
  const plain = parts.filter((p) => p.text).map((p) => p.text).join("\n")
  if (mediaAttached === 0 && plain.replace(/\s+/g, "").length < 50) {
    return { summary: "Te escribieron poco:\n" + plain.slice(0, 300), count: rows.length, days: dias, media: 0, trivial: true }
  }
  // CLOUD-OK: los resúmenes de bandeja son INTERACTIVOS (el usuario los pide y espera al instante) y el multimodal (imágenes/PDF/
  // audio/video) NO existe en local sin GPU. Nube deliberada. El texto puro cae a LLM_CHAIN_CATCHUP (gemini,ollama). Con GPU: local.
  let summary = ""
  if (mediaAttached > 0) { // Gemini nativo ve imágenes, lee PDFs, escucha audios y procesa video+audio
    try { summary = (await geminiMultimodal(intro, [...parts, { text: closing }], { system: sys, temperature: 0.3 })).trim() } catch { summary = "" }
  }
  if (!summary) { // sin media procesable o falló el multimodal → resumen de texto (rápido, gemini→ollama)
    const transcript = parts.filter((p) => p.text).map((p) => p.text).join("\n").slice(0, 9000)
    summary = await llm(`${intro}\n\n${transcript}${closing}`, { system: sys, chain: process.env.LLM_CHAIN_CATCHUP || "gemini,ollama", temperature: 0.3 }).then((s) => (s || "").trim()).catch(() => "")
  }
  return { summary, count: rows.length, days: dias, media: mediaAttached }
}



// RESUMIR CHAT: resumen de toda/parte de la conversación (ambos lados + adjuntos), GUARDADO como nota IA en el hilo. NO se envía ni se puede enviar.
const CHAT_RANGE_MS = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 }
export async function summarizeChat(key, range = "all", ws) {
  const since = range === "all" ? 0 : Date.now() - (CHAT_RANGE_MS[range] || 0)
  const rows = threadMessagesSinceAll(key, since, { limit: 500 })
  if (!rows.length) return { summary: "", count: 0, range }
  const budget = { inline: 0, uploads: 0 }; const parts = []; let media = 0, ocrN = 0
  for (const r of rows) {
    const who = r.dir === "out" ? "Vos" : stripWA(contactName(r.sender) || contactName(r.name) || r.name || "?")
    const txt = cleanMsg(r.text)
    if (r.media && r.mediaType !== "sticker" && media < 12) {
      const p = await catchupMediaPart(r, budget)
      if (p) { parts.push({ text: `\n${who} envió ${CATCHUP_LABEL[r.mediaType] || "un archivo"}:` }); parts.push(p); media++
        if (ocrEnabled() && ocrN < 2 && /image|document/.test(r.mediaType || "")) { const ot = await ocrCas(r.media).catch(() => ""); if (ot) { parts.push({ text: `[texto extraído del documento (OCR local):]\n${ot.slice(0, 4000)}` }); ocrN++ } }
        continue }
    }
    const line = txt || (r.media ? `[${CATCHUP_LABEL[r.mediaType] || "adjunto"}]` : "")
    if (line) parts.push({ text: `${who}: ${line}` })
  }
  const isGroup = key !== "self" && isContainerJid(jidOfKey(key))
  const grpName = rows.find((r) => r.grp)?.grp
  const who = key === "self" ? "tus notas" : (isGroup ? (grpName || "el grupo") : (canonOfKey(key) || contactName(key) || "el contacto"))
  const rangeLabel = { all: "toda la historia", month: "el último mes", week: "la última semana", day: "el último día" }[range] || "el período"
  // GRUPO: encuadre NEUTRAL — no centrar en el dueño (si no, la IA asume que la charla gira en torno a él aunque no se lo mencione).
  const sys = isGroup
    ? `Resumí lo que se conversó en el grupo «${who}» (${rangeLabel}), en español, directo y humano (no suenes a IA). Es una conversación GRUPAL de varios participantes. Contá de qué hablaron, decisiones/acuerdos, fechas y qué queda pendiente. IMPORTANTE: NO asumas que la conversación gira en torno a ${ownerFirst()} — ${ownerFirst()} es solo un integrante más y puede no ser el tema; hablá de lo que realmente dijeron los participantes. Mirá también los adjuntos (imágenes/docs/audios). Viñetas cortas. No inventes.`
    : `Resumí la conversación de ${ownerFirst()} con ${who} (${rangeLabel}) en español, directo y humano (no suenes a IA). Contá de qué se habló, decisiones/acuerdos, fechas, y qué queda pendiente. Mirá también los adjuntos (imágenes/docs/audios). Viñetas cortas. No inventes.`
  let summary = ""
  if (media > 0) { try { summary = (await geminiMultimodal("Conversación (texto + adjuntos):", [...parts, { text: "\n\nResumen:" }], { system: sys, temperature: 0.3 })).trim() } catch { summary = "" } }
  if (!summary) {
    const tr = parts.filter((p) => p.text).map((p) => p.text).join("\n").slice(0, 16000)
    summary = await llm(`Conversación:\n${tr}\n\nResumen:`, { system: sys, chain: process.env.LLM_CHAIN_CATCHUP || "gemini,ollama", temperature: 0.3 }).then((s) => (s || "").trim()).catch(() => "")
  }
  if (summary && ws) ws.addAiNote(key, { text: summary, ts: Date.now(), range, count: rows.length }) // queda grabado en el hilo
  return { summary, count: rows.length, range, media }
}
