// brain/reply — SEND-PATH (WhatsApp bridge/Unipile/email) + compositor (draft en tu voz, corrección, sugerencia).
// wrong-recipient es EL fallo temido → threadTargets (destinos + default) está characterizado en test/brain-reply.mjs.
// threadTargets / sendReply* son export function HOISTED: schedule/meetings/otros los importan por la fachada (brain.mjs).
import { isSecretMsg } from "../secret.mjs" // reenviar saca el mensaje del hub: los de línea oculta nunca salen
import { insertSent as dbInsertSent, threadMessagesTail as dbThreadMsgs, whatsappRoomsOf, roomInboundSenders, emailAddressesOf, lastInboundJid, lastEmailByAddress, lastEmailInThread, lastUnipileJid, lastWhatsappRoom, lastHistoricJid, messageById, directPeersOf, threadPorClave, senderPorNombre, marcarComoHistoria} from "../db.mjs"
import { readFileSync } from "fs"
import { join } from "path"
import { getSlackToken, getSignal } from "../integrations.mjs" // config Slack/Signal conectada desde la Consola (cifrada) — para que los senders la vean, no solo el .env
import { isSimpleSender, sendableDirectChannels, channelLabel } from "../channels.mjs" // registro de canales: qué canales tienen envío SIMPLE (target+texto) → dispatch genérico
import { phoneOf, MY_NUMBERS, MY_EMAILS, computeThread, isContainerJid } from "../thread.mjs"
import { sendMatrix, sendMatrixAudio, sendMatrixMedia, sendMatrixSticker, startWhatsAppChat, roomLogin } from "../../matrix.mjs"
import { unipileConfigured, unipileSend } from "../unipile-api.mjs"
import { teamsSend } from "../teams-send.mjs" // Graph: responder en un chat de Teams (permiso de envío aparte del lector)
import { sendEmailReply } from "../mailer.mjs"
import { casPutBuffer } from "../cas.mjs"
import { llm, smartChain } from "../llm.mjs"
import { maskLinks, unmaskLinks, isOnlyLinks } from "../linkmask.mjs" // #1: los links nunca se corrigen
import { harden, UNTRUSTED_NOTE } from "../safety.mjs"
import { ownerFirst, owner } from "../hub.mjs"
import { buildStyleProfile, buildStyleProfiles, styleExamples, categoryOf } from "../style.mjs"
import { jf, contactName } from "./kernel/contacts.mjs"
import { canonOfKey, stripWA } from "./kernel/keys.mjs"
import { spawn } from "child_process"

// ── envío por canales HTTP/proceso (Slack / Signal / Telegram) — cada uno gated por su config; error claro si no está montado ──
async function slackSend(channel, text) {
  const token = process.env.SLACK_TOKEN || getSlackToken() // .env o lo conectado desde la Consola (cifrado) — MISMA fuente que el reader
  if (!token) return { error: "Slack no está configurado — conectalo en Ajustes (o poné SLACK_TOKEN)." }
  try { const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ channel: String(channel).replace(/^slack:/, ""), text }) }).then((x) => x.json()); return r.ok ? { ok: true } : { error: r.error || "slack" } } catch (e) { return { error: e.message } }
}
async function signalSend(peer, text) {
  const stored = getSignal() || {} // lo conectado desde la Consola (cifrado) — fallback tras el .env, igual que el reader
  const url = (process.env.SIGNAL_CLI_URL || stored.url || "").replace(/\/+$/, ""); const me = (process.env.SIGNAL_NUMBER || stored.number || "").trim()
  if (!url || !me) return { error: "Signal no está configurado — conectalo en Ajustes." }
  const num = String(peer).replace(/^signal:/, ""); const to = /^\+/.test(num) ? num : "+" + num.replace(/[^\d]/g, "")
  try { const r = await fetch(`${url}/v2/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number: me, recipients: [to], message: text }) }); return r.ok ? { ok: true } : { error: "signal " + r.status } } catch (e) { return { error: e.message } }
}
function telegramSend(chatId, text) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["src/telegram.mjs", "send", String(chatId).replace(/^telegram:/, ""), text], { stdio: "ignore" })
    const to = setTimeout(() => { try { p.kill() } catch {}; resolve({ error: "timeout" }) }, 30000)
    p.on("exit", (c) => { clearTimeout(to); resolve(c === 0 ? { ok: true } : { error: "no se pudo enviar por Telegram" }) })
    p.on("error", (e) => { clearTimeout(to); resolve({ error: e.message }) })
  })
}
// mapa de senders SIMPLES por canal (keyed por el id del registro de canales). Agregar un canal de mensajería directo = su entrada
// en channels.mjs (send:"simple") + su fn acá. sendReply despacha genérico contra esto en vez de un if por canal.
const SIMPLE_SENDERS = { slack: slackSend, signal: signalSend, telegram: telegramSend, teams: teamsSend }
import { cleanMsg } from "./kernel/convo.mjs"

// error claro cuando el envío por el bridge falla: si el número dueño de la sala está deslogueado, decí cuál revincular.
async function waSendError(room) {
  const st = room && await roomLogin(room)
  return { error: st && !st.alive ? `El número ${st.receiver} está desconectado — revinculalo en /link para poder responder a este contacto.` : "no se pudo enviar por WhatsApp (el bridge no lo entregó)." }
}

// DESTINOS de un contacto unificado: sus números de WhatsApp (dedup, última sala por número) + sus emails (mensajes + los conocidos del identity manual). Default = donde escribió último (entrante).
export function threadTargets(key) {
  if (key === "self") return { targets: [], default: 0 } // Mis Notas: sin selector, solo notas locales
  // WhatsApp: salas portal → dedup por NÚMERO real (una entrada por número, la sala más reciente)
  const byNum = new Map()
  for (const r of whatsappRoomsOf(key)) {
    const senders = roomInboundSenders(key, r.jid)
    let num = null; for (const s of senders) { const p = phoneOf(s.sender); if (p && !MY_NUMBERS.has(p)) { num = p; break } }
    const nk = num || r.jid
    if (!byNum.has(nk) || byNum.get(nk).last < r.last) byNum.set(nk, { channel: "whatsapp", target: r.jid, label: num ? `+${num}` : "WhatsApp", last: r.last })
  }
  // Emails: de los mensajes + los conocidos del identity manual para este contacto
  const emails = new Map()
  for (const a of emailAddressesOf(key)) emails.set(a.jid.toLowerCase(), { channel: "email", target: a.jid, label: a.jid, last: a.last })
  const man = jf("identity-manual.json") || {}
  for (const [alias, canon] of Object.entries(man)) if (canon === key && /@/.test(alias) && !emails.has(alias.toLowerCase())) emails.set(alias.toLowerCase(), { channel: "email", target: alias, label: alias, last: 0 })
  if (String(key).startsWith("email:")) { const addr = key.slice(6); if (!emails.has(addr.toLowerCase())) emails.set(addr.toLowerCase(), { channel: "email", target: addr, label: addr, last: 0 }) }
  // Mensajería DIRECTA (Telegram, Slack, Signal, Teams…): un destino por (canal, jid) del hilo. Faltaba por completo, y era la
  // razón de que esos hilos no pudieran responderse: sin destino, el compositor mandaba sin canal.
  const direct = directPeersOf(key, sendableDirectChannels()).map((p) => ({
    channel: p.channel, target: p.jid, label: `${channelLabel(p.channel)}${p.jid && !/^\d+$/.test(p.jid) ? " · " + p.jid : ""}`, last: p.last,
  }))
  const targets = [...byNum.values(), ...emails.values(), ...direct].sort((a, b) => (b.last || 0) - (a.last || 0))
  // default = target del último mensaje ENTRANTE
  const lastIn = lastInboundJid(key)
  let def = 0
  if (lastIn) { const i = targets.findIndex((t) => t.target === lastIn.jid); if (i >= 0) def = i }
  targets.forEach((t, i) => (t.isDefault = i === def))
  return { targets, default: def }
}

// COMPOSITOR: responde al hilo. Con {channel,target} manda a ese destino puntual; sin él, auto (última sala / email del key).
// ¿A qué chat le mando la respuesta a una historia? Primero su hilo propio (si ya le hablaste), y si no, el número
// que sale de su identidad en el bridge — el mismo camino que hace contactable a quien solo aparece en grupos.
async function resolverHiloDe(nombre) {
  const limpio = String(nombre || "").replace(/ \(WA\)$/, "").trim()
  if (!limpio) return null
  for (const cand of [limpio, nombre]) {
    const row = threadPorClave(cand)
    if (row && (row.count || 0) > 0) return { key: row.thread, channel: "whatsapp" }
  }
  const sender = senderPorNombre(nombre) || senderPorNombre(limpio)
  if (!sender) return null
  let num = String(sender).match(/whatsapp_(\d{8,15})/)?.[1] || String(sender).match(/^(\d{8,15})/)?.[1]
  // en estados de gente que solo conocés por grupos grandes el remitente es un LID, no un número
  if (!num) {
    const lid = String(sender).match(/lid-(\d+)/)?.[1]
    if (lid) { try { const { lidToPhone } = await import("../../matrix.mjs"); num = await lidToPhone(lid) } catch { /* sin bridge: sin número */ } }
  }
  return num ? { key: "whatsapp:" + num + "@s.whatsapp.net", channel: "whatsapp" } : null
}

export async function sendReply(key, text, { channel, target, historiaDe = "" } = {}) {
  text = String(text || "").trim()
  if (!text) return { error: "mensaje vacío" }
  // "Mis Notas": escribir en el hilo propio GUARDA una nota, no manda nada. Salvo que el caller nombre una sala
  // EXPLÍCITA: ahí sí hay que enviar de verdad. Es el caso del asistente, que contesta dentro de tu chat de WhatsApp
  // — sin esta excepción sus respuestas se guardaban como notas y nunca llegaban al teléfono.
  const selfToRoom = key === "self" && channel === "whatsapp" && /^![^:]+:/.test(String(target || ""))
  if (key === "self" && !selfToRoom) return { ok: true, channel: "note", ...guardarEnviado("self", "note", text) }
  // HISTORIAS (estados de WhatsApp). Dos cosas, y las dos importan:
  //  · Responder un estado NO es escribir en el hilo de historias: en WhatsApp le llega como MENSAJE PRIVADO a quien
  //    lo publicó. Sin esto, mandar en ese hilo apuntaba a la sala de estados — o sea, ibas a PUBLICAR UN ESTADO tuyo
  //    a todos tus contactos creyendo que le contestabas a una persona.
  //  · La respuesta se guarda en el chat de ESA persona (donde le sirve al historial) con tag "historia", para poder
  //    distinguirla de una conversación normal: la dijiste sobre algo que publicó, no en medio de una charla.
  if (/status@broadcast/.test(String(key))) {
    const quien = String(historiaDe || "").trim()
    if (!quien) return { error: "Elegí a qué historia estás respondiendo: tocá el mensaje y respondé desde ahí." }
    const destino = await resolverHiloDe(quien)
    if (!destino) return { error: `No sé a quién mandarle esto: no encuentro el chat de ${quien}.` }
    const r = await sendReply(destino.key, text, { channel: destino.channel || "whatsapp", target: destino.target })
    if (r && r.error) return r
    // el envío ya salió por el camino normal (que lo guardó sin tag) → lo marcamos como respuesta a historia
    try { marcarComoHistoria(r.id) } catch (e) { console.error("[historia] no pude etiquetar:", e.message) }
    return { ...r, historia: true, para: quien }
  }
  // destino EXPLÍCITO elegido por el usuario
  if (channel === "email" && target) {
    const last = lastEmailByAddress(target) || lastEmailInThread(key)
    const r = await sendEmailReply(target, text, { account: last?.account, subject: (last?.text || "").split(" — ")[0], inReplyTo: last?.id, fromName: owner() })
    return r.error ? r : { ok: true, channel: "email" }
  }
  if (channel === "whatsapp" && target) {
    const r = await sendMatrix(target, text)
    return r.ok ? { ok: true, channel: "whatsapp", ...guardarEnviado(key, "whatsapp", text) } : await waSendError(target)
  }
  // canales de mensajería SIMPLES (slack/signal/telegram/…): dispatch genérico por el registro de canales (mismo comportamiento que el if-por-canal previo)
  if (target && isSimpleSender(channel) && SIMPLE_SENDERS[channel]) {
    const r = await SIMPLE_SENDERS[channel](target, text)
    return r.ok ? { ok: true, channel, ...guardarEnviado(key, channel, text) } : r
  }
  // AUTO (sin destino): email si el key es email, si no la última sala de WhatsApp
  if (String(key).startsWith("email:")) {
    const last = lastEmailInThread(key)
    const r = await sendEmailReply(key, text, { account: last?.account, subject: (last?.text || "").split(" — ")[0], inReplyTo: last?.id, fromName: owner() })
    return r.error ? r : { ok: true, channel: "email" }
  }
  // AUTO en canales de mensajería DIRECTA: el key ya nombra el canal ("telegram:123", "slack:C…"). Sin esto, un cliente que no
  // mande {channel,target} caía en la búsqueda de sala de WhatsApp y moría con "no encuentro por qué canal responder".
  const pfx = String(key).match(/^([a-z]+):(.+)$/)
  if (pfx && isSimpleSender(pfx[1]) && SIMPLE_SENDERS[pfx[1]]) {
    const r = await SIMPLE_SENDERS[pfx[1]](pfx[2], text)
    return r.ok ? { ok: true, channel: pfx[1], ...guardarEnviado(key, pfx[1], text) } : r
  }
  // ¿el contacto se maneja por Unipile? (sus mensajes recientes vienen con account='unipile') → enviar por Unipile, NO por el
  // bridge (que para ese número está deslogueado a propósito). Cierra el híbrido: recibe y envía por Unipile.
  if (unipileConfigured()) {
    const u = lastUnipileJid(key)
    if (u?.jid) {
      const r = await unipileSend(u.jid, text)
      return r.ok ? { ok: true, channel: "whatsapp", ...guardarEnviado(key, "whatsapp", text) } : { error: r.error }
    }
  }
  const room = lastWhatsappRoom(key)?.jid
  if (room) {
    const r = await sendMatrix(room, text)
    return r.ok ? { ok: true, channel: "whatsapp", ...guardarEnviado(key, "whatsapp", text) } : await waSendError(room)
  }
  // contacto HISTÓRICO (jid crudo <num>@s.whatsapp.net, sin sala del bridge) → iniciar chat nuevo por número
  const histJid = lastHistoricJid(key)?.jid
  // El número puede venir del historial O de la propia CLAVE del hilo. Lo segundo es lo que habilita empezar una
  // conversación NUEVA: con un contacto que nunca te escribió no hay jid histórico del que sacarlo, y todo esto moría
  // con "no encuentro por qué canal responder" — por eso no se podía iniciar un chat desde ninguna de las tres apps.
  // El número puede salir del historial O de la propia CLAVE del hilo (eso último habilita estrenar conversación con
  // alguien que nunca te escribió). PERO sólo si la clave es un 1:1 de WhatsApp: sin esta guarda, el id de un GRUPO
  // (120363…@g.us), una sala del bridge (!AbCd1234567890:dominio) o un id de Instagram se leían como "teléfono" y se
  // abría un DM de WhatsApp a un número real ajeno. Es el mensaje-al-destinatario-equivocado que este archivo declara
  // como su peor falla, y antes no ocurría porque lastHistoricJid ya filtraba por @s.whatsapp.net.
  const claveEsDmWa = /^whatsapp:/.test(String(key)) && !isContainerJid(String(key).replace(/^whatsapp:/, ""))
  const numDeClave = claveEsDmWa ? phoneOf(String(key).replace(/^whatsapp:/, "")) : null
  const histNum = (histJid && phoneOf(histJid)) || numDeClave
  if (histNum && !MY_NUMBERS.has(histNum)) {
    const mxid = await startWhatsAppChat(histNum)
    if (mxid) { const r = await sendMatrix(mxid, text); return r.ok ? { ok: true, channel: "whatsapp", ...guardarEnviado(key, "whatsapp", text) } : { error: "no se pudo enviar por WhatsApp (bridge)" } }
    return { error: "Estoy abriendo el chat de WhatsApp con este contacto (es la primera vez desde acá). Probá de nuevo en unos segundos." }
  }
  return { error: "No encuentro por qué canal responder (sin sala de WhatsApp ni dirección de email)." }
}

// ENVÍO DE NOTA DE VOZ: resuelve la sala del bridge (igual que sendReply) y manda el audio como voice message.
// Solo canales de mensajería bridgeados por Matrix (WhatsApp/Telegram/Discord/Signal/IG/FB). Email/notas NO soportan voz.
export async function sendReplyAudio(key, buffer, { channel, target, mime = "audio/ogg", durationMs = 0, waveform = null } = {}) {
  if (!buffer || !buffer.length) return { error: "audio vacío" }
  if (key === "self" || channel === "email" || String(key).startsWith("email:")) return { error: "este canal no soporta notas de voz" }
  // sala del bridge: target explícito (mxid) → última sala del hilo → iniciar chat por número (contacto histórico)
  let room = (target && /^![^:]+:/.test(target)) ? target : null // sala Matrix (!<id>:<dominio>), agnóstico del dominio
  if (!room) room = lastWhatsappRoom(key)?.jid
  if (!room) {
    const histJid = lastHistoricJid(key)?.jid
    const histNum = histJid && phoneOf(histJid)
    if (histNum && !MY_NUMBERS.has(histNum)) room = await startWhatsAppChat(histNum)
  }
  if (!room) return { error: "No encuentro un chat de mensajería para mandar el audio (las notas de voz van por WhatsApp/Telegram/etc., no por email)." }
  const r = await sendMatrixAudio(room, buffer, { mime, durationMs, waveform })
  if (!r.ok) return { error: r.error || "no se pudo enviar el audio (bridge)" }
  // el audio YA salió por el bridge. Guardamos copia local (CAS) para poder REPRODUCIRLO en la app y registramos el mensaje.
  // Si la DB está trabada (lock multi-proceso), NO fallamos el envío: el audio ya se entregó.
  let media = null
  try { media = casPutBuffer(buffer, /ogg/.test(mime) ? "ogg" : /m4a|mp4|aac/.test(mime) ? "m4a" : "ogg", `${channel || "whatsapp"}:sent`) } catch (e) { console.error("[send-audio] CAS:", e.message) }
  let ins = {}
  try { ins = dbInsertSent(key, channel || "whatsapp", "🎤 Nota de voz", { media, mediaType: "audio" }) } catch (e) { console.error("[send-audio] guardado local falló (audio ya enviado):", e.message) }
  return { ok: true, channel: channel || "whatsapp", media, mediaType: "audio", ...ins }
}

// ENVÍO DE IMAGEN / VIDEO / ARCHIVO: misma resolución de sala que sendReplyAudio. Solo canales bridgeados (no email/self).
const _mimeExt = (m) => ({ "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp", "application/pdf": "pdf" }[(m || "").toLowerCase()] || (m || "").split("/")[1] || "bin")
export async function sendReplyMedia(key, buffer, { channel, target, mime = "application/octet-stream", filename = "archivo", caption = "", placeholder = "" } = {}) {
  if (!buffer || !buffer.length) return { error: "archivo vacío" }
  if (key === "self" || channel === "email" || String(key).startsWith("email:")) return { error: "este canal no soporta enviar archivos (van por WhatsApp/Telegram/etc., no por email)." }
  let room = (target && /^![^:]+:/.test(target)) ? target : null // sala Matrix (!<id>:<dominio>), agnóstico del dominio
  if (!room) room = lastWhatsappRoom(key)?.jid
  if (!room) {
    const histJid = lastHistoricJid(key)?.jid
    const histNum = histJid && phoneOf(histJid)
    if (histNum && !MY_NUMBERS.has(histNum)) room = await startWhatsAppChat(histNum)
  }
  if (!room) return { error: "No encuentro un chat de mensajería para mandar el archivo." }
  const r = await sendMatrixMedia(room, buffer, { mime, filename, caption })
  if (!r.ok) return { error: r.error || "no se pudo enviar el archivo (bridge)" }
  // ya salió por el bridge → copia local (CAS) para verlo en la app + registrar. Lock de DB no debe fallar el envío.
  const kind = /^image\//.test(mime) ? "image" : /^video\//.test(mime) ? "video" : "file"
  let media = null
  try { media = casPutBuffer(buffer, _mimeExt(mime), `${channel || "whatsapp"}:sent`) } catch (e) { console.error("[send-media] CAS:", e.message) }
  const ph = placeholder || (kind === "image" ? "🖼 Imagen" : kind === "video" ? "📹 Video" : `📄 ${filename}`)
  let ins = {}
  try { ins = dbInsertSent(key, channel || "whatsapp", ph, { media, mediaType: kind, filename: kind === "file" ? filename : null }) } catch (e) { console.error("[send-media] guardado local falló (archivo ya enviado):", e.message) }
  return { ok: true, channel: channel || "whatsapp", media, mediaType: kind, ...ins }
}

// ENVIAR UN CONTACTO (vCard), armado con los datos que el hub YA tiene del contacto — no hay que escribir nada.
//
// OJO con cómo llega: mautrix-whatsapp NO sabe mandar tarjetas de contacto nativas. Su conversor solo traduce
// ContactMessage de WhatsApp HACIA Matrix (pkg/msgconv/wa-contact.go); en la dirección de salida, todo m.file
// —incluido text/vcard— termina siendo un DocumentMessage, o sea un archivo. Verificado en v26.06.
// Lo que sí podemos: mandarlo con LEYENDA (nombre + teléfono), así se lee de un vistazo sin abrir el .vcf, y el
// número queda tocable en WhatsApp. El archivo sigue sirviendo para agregarlo a la agenda.
// Escapado según RFC 6350: en un vCard la coma, el punto y coma y la barra son separadores — un apellido con coma
// partía la tarjeta en dos campos y el nombre llegaba cortado.
// El mensaje YA SALIÓ por el cable cuando llegamos acá. insertSent reintenta ante SQLITE_BUSY, pero si la base
// está muy trabada puede agotar los reintentos — y hasta ahora ese error subía y hacía fallar el envío ENTERO.
// Eso es doblemente malo desde que hay cola de reintentos: para el contacto el mensaje llegó, pero vos ves un
// error, la reserva del msgId se suelta y el reintento se lo manda DOS VECES. Preferimos perder la copia local
// (la ingesta la recupera) antes que duplicarle el mensaje a alguien.
const guardarEnviado = (thread, channel, text, extra) => {
  try { return dbInsertSent(thread, channel, text, extra) }
  catch (e) { console.error(`[send] salió por ${channel} pero no pude guardarlo local: ${e.message}`); return {} }
}

const vEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
export function buildVCard({ name, phones = [], emails = [], org = "" }) {
  const nm = String(name || "").trim() || (phones[0] ? "+" + phones[0] : "Contacto")
  const l = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vEsc(nm)}`, `N:${vEsc(nm)};;;;`]
  if (org) l.push(`ORG:${vEsc(org)}`)
  for (const p of phones.slice(0, 5)) l.push(`TEL;type=CELL;waid=${String(p).replace(/\D/g, "")}:+${String(p).replace(/\D/g, "")}`)
  for (const e of emails.slice(0, 3)) l.push(`EMAIL;type=INTERNET:${vEsc(e)}`)
  l.push("END:VCARD")
  return l.join("\r\n") + "\r\n" // CRLF: lo exige el RFC y algunos clientes no la parsean con \n solo
}

// manda el contacto <quien> al hilo <key>. Reusa el camino de media: ya resuelve sala, cifra y registra local.
export async function sendReplyContact(key, quien, { channel, target } = {}) {
  if (!quien || !quien.name) return { error: "no sé qué contacto mandar" }
  const phones = (quien.phones || []).filter(Boolean), emails = (quien.emails || []).filter(Boolean)
  if (!phones.length && !emails.length) return { error: `no tengo teléfono ni correo de ${quien.name}` }
  const vcf = Buffer.from(buildVCard(quien), "utf8")
  const archivo = String(quien.name).replace(/[^\w\s.-]/g, "").trim().slice(0, 40) || "contacto"
  const datos = [...phones.slice(0, 2).map((p) => "+" + String(p).replace(/\D/g, "")), ...emails.slice(0, 1)]
  const caption = `👤 ${quien.name}${datos.length ? "\n" + datos.join("\n") : ""}`
  return sendReplyMedia(key, vcf, { channel, target, mime: "text/vcard", filename: `${archivo}.vcf`, caption, placeholder: `👤 ${quien.name}` })
}

// ENVÍO DE STICKER: misma resolución de sala; manda un evento m.sticker (webp). El server ya convirtió la imagen a webp 512×512.
export async function sendReplySticker(key, buffer, { channel, target, mime = "image/webp" } = {}) {
  if (!buffer || !buffer.length) return { error: "sticker vacío" }
  if (key === "self" || channel === "email" || String(key).startsWith("email:")) return { error: "este canal no soporta stickers (van por WhatsApp/Telegram/etc.)." }
  let room = (target && /^![^:]+:/.test(target)) ? target : null
  if (!room) room = lastWhatsappRoom(key)?.jid
  if (!room) {
    const histJid = lastHistoricJid(key)?.jid
    const histNum = histJid && phoneOf(histJid)
    if (histNum && !MY_NUMBERS.has(histNum)) room = await startWhatsAppChat(histNum)
  }
  if (!room) return { error: "No encuentro un chat de mensajería para mandar el sticker." }
  const r = await sendMatrixSticker(room, buffer, { mime })
  if (!r.ok) return { error: r.error || "no se pudo enviar el sticker (bridge)" }
  let media = null
  try { media = casPutBuffer(buffer, "webp", `${channel || "whatsapp"}:sent`) } catch (e) { console.error("[send-sticker] CAS:", e.message) }
  let ins = {}
  try { ins = dbInsertSent(key, channel || "whatsapp", "🖼 Sticker", { media, mediaType: "image" }) } catch (e) { console.error("[send-sticker] guardado local falló (sticker ya enviado):", e.message) }
  return { ok: true, channel: channel || "whatsapp", media, mediaType: "image", ...ins }
}

// ── REENVIAR mensajes (preservando el MEDIA) ── Antes se mandaba solo el texto → reenviar un audio mandaba el placeholder "audio".
// Ahora: si el mensaje tiene media, se lee del CAS y se reenvía como audio/imagen/archivo; si no, como texto.
const EXT_MIME = { ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", mp4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp", pdf: "application/pdf" }
export async function forwardMessages(ids, key, { secretOn = false } = {}) {
  // 🔒 reenviar es SACAR el mensaje del hub: sin 2º PIN, uno de fuente secreta ni se lee (messageById lo niega y cae acá).
  const pedidos = (Array.isArray(ids) ? ids : [ids])
  const rows = pedidos.map((id) => messageById(id, { secretOn })).filter(Boolean).sort((a, b) => (a.ts || 0) - (b.ts || 0))
  if (!rows.length) return { error: "No encontré los mensajes a reenviar." }
  // 🔒 Y CON el 2º PIN puesto tampoco: desbloquear es para LEER lo tuyo, no para sacarlo del hub. Reenviar manda el
  // contenido a otra conversación —fuera del gateo— y desde ahí ya no hay vuelta atrás. Decisión del dueño del hub.
  if (rows.some((m) => isSecretMsg(m))) return { error: "Este mensaje es de una línea oculta: no se puede reenviar." }
  let sent = 0, lastErr = null
  for (const m of rows) {
    const hasMedia = m.media && String(m.media).startsWith("/cas/")
    if (hasMedia) {
      try {
        const buf = readFileSync(join(process.cwd(), "data", m.media))
        const ext = (String(m.media).match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase()
        const mime = EXT_MIME[ext] || "application/octet-stream"
        const r = m.mediaType === "audio" ? await sendReplyAudio(key, buf, { mime }) : await sendReplyMedia(key, buf, { mime, filename: m.filename || `archivo.${ext || "bin"}` })
        if (r && r.ok) { sent++; continue } // media reenviado → NO mandar además el placeholder de texto
        lastErr = (r && r.error) || "no se pudo reenviar el media"
      } catch (e) { lastErr = e.message; console.error("[forward] media:", e.message) }
    }
    const text = (m.text || "").trim() // sin media (o si el media falló y hay texto): reenviar el texto
    if (text) { const r = await sendReply(key, text, {}); if (r && r.ok) sent++; else lastErr = (r && r.error) || lastErr }
    else if (!hasMedia) lastErr = "mensaje sin texto ni media"
  }
  return sent ? { ok: true, sent } : { error: lastErr || "no se pudo reenviar" }
}

// ── DRAFT REPLY (en tu estilo, por categoría de relación) ──
// `localOnly`: el borrador es para un hilo SECRETO. Que vos lo hayas desbloqueado no habilita mandarle la conversación a
// un tercero — el mismo criterio que composeCorrect. Sin esto, con el 2º PIN puesto el hilo salía por la cadena por defecto.
export async function draftReply(nameOrKey, instruction = "", { localOnly = false } = {}) {
  const { personView } = await import("./people.mjs") // ciclo reply↔people → runtime-only (nunca en eval)
  const v = personView(nameOrKey)
  const canon = v.canon || v.name
  const lastInbound = [...v.timeline].reverse().find((e) => e.dir !== "out")
  if (!lastInbound) return { error: "El último mensaje ya es tuyo — nada pendiente." }
  const channel = lastInbound.channel
  const profile = await buildStyleProfile().catch(() => null)
  const byCat = await buildStyleProfiles().catch(() => ({}))
  const category = v.canon ? categoryOf(v.canon) : "otro"
  const examples = styleExamples(v.key || canon, channel, 6) // por thread del contacto (ya NO reparsea 80MB del jsonl por llamada)
  const recent = v.timeline.slice(-8).map((e) => `${e.dir === "out" ? ownerFirst() : canon}: ${(e.text || "").slice(0, 200)}`).join("\n")
  const draft = await llm(`Sos ${ownerFirst()} respondiendo por ${channel}. Escribí el borrador EN SU VOZ.
ESTILO GENERAL: ${profile ? JSON.stringify(profile) : "natural"}
ESTILO CON "${category}": ${byCat[category] ? JSON.stringify(byCat[category]) : "(usá el general + relación)"}
EJEMPLOS REALES:\n${examples.map((e) => `- "${e.slice(0, 180)}"`).join("\n") || "(sin ejemplos)"}
CON QUIÉN: ${canon} (${v.role || "contacto"}) categoría ${category}.
CONVERSACIÓN:\n${recent}
${instruction ? "LO QUE QUIERE DECIR: " + instruction : "Redactá respuesta apropiada al último mensaje."}
Devolvé SOLO el texto, como lo escribiría ${ownerFirst()}.`, { system: UNTRUSTED_NOTE, bypassCap: true, ...(localOnly ? { chain: smartChain({ sensitive: true, secreto: true, feature: "draft" }) } : {}) })
  return { to: canon, role: v.role, channel, category, replyingTo: lastInbound.text, draft: draft.trim() }
}

// ── COMPOSITOR: corrección rápida ANTES de enviar (los teclados son malos). Devuelve 3 opciones: original, corregido y
// una alternativa mejor redactada del MISMO mensaje. LLM liviano y rápido (es solo corregir un texto corto).

// `localOnly`: lo que estás escribiendo va para un hilo SECRETO. Esta función corregía SIEMPRE con la nube (y con un
// fallback que fuerza OpenAI), o sea que el texto que tecleabas en el chat secreto salía a un tercero antes de enviarlo.
// La firma no recibía el hilo, así que no había dónde decidir: ahora sí.
export async function composeCorrect(text, { channel, localOnly = false } = {}) {
  const { scheduleSlots } = await import("./schedule.mjs") // huecos libres para el "momento de espera" del envío (runtime)
  const t = (text || "").trim()
  if (t.length < 2) return { original: t, corrected: t, alternative: "" }
  // #1: si es puro link (o links), no lo mandamos a corregir — se envía idéntico.
  if (isOnlyLinks(t)) return { original: t, corrected: t, alternative: "", ...scheduleSlots(t) }
  const { masked: tMasked, urls } = maskLinks(t) // enmascarar links antes de que el LLM los vea
  // Corrección de texto: debe ser RÁPIDA (se dispara al tocar enviar). gpt-4o-mini (~1.5s, fiel) como primario;
  // fallback local qwen2.5:3b (más fiel que el 1.5b). Gemini queda fuera (free-tier 429). num_predict acota la salida.
  const prompt = `Sos un corrector de mensajes. Te doy un texto que ${ownerFirst()} va a enviar por ${channel || "chat"} y devolvés SOLO un JSON válido:
{"corregido":"...","alternativo":"..."}

"corregido": el MISMO texto corrigiendo únicamente ortografía, tildes, mayúsculas y puntuación. Reglas estrictas: NO cambies ninguna palabra por un sinónimo, NO reformules, NO agregues ni quites contenido, NO cambies el tono ni la jerga (dejá "pucha", "oe", "xfa", etc. tal cual). Solo arreglás cómo está escrito.
"alternativo": una reformulación más clara y natural del MISMO mensaje, tono directo y humano, sin inventar datos ni cambiar la intención.

Los tokens tipo LNK0X, LNK1X son enlaces: copialos EXACTAMENTE igual, no los toques ni los traduzcas.
Mantené el idioma original. Sin comillas de más ni explicaciones.
Texto: """${tMasked}"""`
  // CLOUD-OK: redactar/corregir borradores es INTERACTIVO (lo dispara el usuario y espera calidad+velocidad) y ve solo el hilo en
  // cuestión, no el corpus. Nube deliberada; local no da la voz. Con GPU: LLM_CHAIN_CORRECT=ollama.
  // PRIMARIO: como lo tenga ruteado el hub (feature:"correct" → puede ser la GPU box local), pero ACOTADO EN TIEMPO. Si tarda más
  // de CORRECT_TIMEOUT_MS (GPU fría/degradada) → FALLBACK INSTANTÁNEO a OpenAI (~1.5s). Así la corrección nunca se cuelga 60s.
  const CORRECT_TIMEOUT_MS = Number(process.env.CORRECT_TIMEOUT_MS) || 6000
  const primary = llm(prompt, {
    json: true,
    feature: "correct",
    chain: localOnly ? "ollama" : (process.env.LLM_CHAIN_CORRECT || "openai,ollama"), // 🔒 hilo secreto → solo modelo local
    models: { ollama: process.env.OLLAMA_MODEL_CORRECT || "qwen2.5:3b" },
    numPredict: 260,
    temperature: 0.2,
    task: "correct",
    bypassCap: true, // interactivo + chico (se dispara al tocar enviar) → nunca cae a ollama-CPU por el tope diario
  })
  primary.catch(() => {}) // si lo abandonamos por timeout, no dejar una promesa rechazada suelta (unhandled rejection)
  try {
    let r
    try {
      r = await Promise.race([primary, new Promise((_, rej) => setTimeout(() => rej(new Error("correct-timeout")), CORRECT_TIMEOUT_MS))])
    } catch (e1) {
      // fallback: SIN feature → no rutea a la GPU box; chain "openai" fuerza la nube (la key ya está validada). Solo si existe.
      if (localOnly) throw e1 // 🔒 hilo secreto: sin fallback a la nube — mejor no corregir que filtrar lo que estás escribiendo
      if (!process.env.OPENAI_API_KEY) throw e1
      r = await llm(prompt, { json: true, chain: "openai", numPredict: 260, temperature: 0.2, task: "correct-fallback", bypassCap: true })
    }
    // restaurar los links textualmente; safety net: si algún link se perdió en la salida, devolver el original (nunca romper un link)
    const allLinksOk = (s) => urls.every((u) => s.includes(u))
    let corrected = unmaskLinks((r?.corregido || t).trim() || t, urls)
    if (!allLinksOk(corrected)) corrected = t
    let alternative = unmaskLinks((r?.alternativo || "").trim(), urls)
    if (!allLinksOk(alternative)) alternative = ""
    if (alternative === corrected || alternative === t) alternative = "" // no ofrecer una "alternativa" idéntica
    return { original: t, corrected, alternative, ...scheduleSlots(t) }
  } catch (e) { return { original: t, corrected: t, alternative: "", slots: [], failed: true, error: e.message } } // falló/timeout → el UI lo distingue de "sin errores"
}
// mantiene CALIENTE el modelo de corrección (evita el cold-start de ~44s que hace timeout y muestra "sin errores"). Barato, se
// llama desde el daemon cada pocos minutos. Solo local (si LLM_CHAIN_CORRECT no tiene openai con key, la corrección depende de esto).
export async function warmCorrectModel() {
  try { await llm(`Corregí y devolvé JSON {"corregido":"ok"}. Texto: "ok"`, { json: true, feature: "correct", chain: "ollama", models: { ollama: process.env.OLLAMA_MODEL_CORRECT || "qwen2.5:3b" }, numPredict: 8, temperature: 0, task: "warm", bypassCap: true }) } catch {}
}

// SUGERIR RESPUESTA: la IA redacta un borrador en tu voz según la conversación reciente. NO envía — va al input para que edites.
// `localOnly`: el hilo es SECRETO → el borrador se arma con modelo local (mismo criterio que draftReply/composeCorrect).
export async function suggestReply(key, { localOnly = false } = {}) {
  if (key === "self") return { draft: "" }
  const rows = dbThreadMsgs(key, { limit: 25 })
  const who = canonOfKey(key) || contactName(key) || "el contacto"
  const lines = rows.map((r) => `${r.dir === "out" ? "Vos" : stripWA(contactName(r.sender) || contactName(r.name) || r.name || "?")}: ${cleanMsg(r.text) || `[${r.mediaType || "adjunto"}]`}`).filter((l) => l.trim())
  if (!lines.length) return { draft: "" }
  const sys = harden(`Sos ${ownerFirst()} respondiendo un WhatsApp/email. Escribí SOLO el texto del mensaje a enviar (sin comillas, sin firmar, sin "Hola" genérico si no corresponde), en español, natural y directo, en tu voz. Respondé a lo ÚLTIMO que te dijeron. Breve salvo que amerite. Nada de explicaciones ni opciones.`)
  const draft = await llm(`Conversación con ${who}:\n${lines.join("\n").slice(0, 4000)}\n\nMi respuesta:`, { system: sys, chain: localOnly ? smartChain({ sensitive: true, secreto: true, feature: "draft" }) : (process.env.LLM_CHAIN_CATCHUP || "gemini,ollama"), temperature: 0.5, bypassCap: true })
    .then((s) => (s || "").trim().replace(/^["'`]|["'`]$/g, "")).catch(() => "")
  return { draft }
}

// ── EMPEZAR UNA CONVERSACIÓN NUEVA ──
// Faltaba en las TRES apps: sólo se podía responder a alguien que ya te había escrito. Se resuelve un destino escrito a
// mano (un teléfono, un correo, un usuario) a la CLAVE de hilo que usa todo el resto del sistema; el envío después pasa
// por el mismo camino de siempre, así que no hay una segunda forma de mandar mensajes que mantener.
//
// La clave la calcula computeThread, la MISMA función que usa la ingesta. No se puede reimplementar: para un contacto
// que está en tu agenda o que tiene identidad manual, la ingesta keyea por su NOMBRE canónico, no por el número. Armar
// `whatsapp:<num>@s.whatsapp.net` a mano creaba un hilo NUEVO al lado del que ya existía, con la misma persona en los
// dos y los mensajes repartidos entre ambos.
const SOLO_DIGITOS = /^[+]?[\d\s()./-]{6,24}$/
const MAIL_OK = /^[^\s@<>,;"'\\]+@[^\s@<>,;"'\\]+\.[a-z]{2,}$/i
export function resolverDestino(destino, canal = "") {
  const raw = String(destino || "").trim().replace(/[\u200B-\u200D\uFEFF]/g, "") // sin invisibles
  if (!raw) return { error: "Escribí un teléfono, un correo o un usuario." }
  if (/[\r\n\t]/.test(raw)) return { error: "No reconozco ese destino." } // corta inyección por salto de línea
  const ch = String(canal || "").trim().toLowerCase()

  // ORDEN: el canal ELEGIDO manda sobre cualquier heurística. Al revés, elegías Telegram, escribías algo con arroba y
  // se abría un correo: creías estar mandando por un canal y salía por otro. La heurística sólo decide cuando no elegiste.
  // 0) CANAL EXPLÍCITO de mensajería simple (telegram/slack/signal/teams): el identificador va tal cual, pero validado.
  if (ch && ch !== "email" && ch !== "whatsapp" && isSimpleSender(ch)) {
    const id = raw.replace(/\s+/g, "")
    if (!id || id.length > 120) return { error: "Ese identificador no parece válido." }
    if (/[\u0000-\u001f]/.test(id)) return { error: "Ese identificador no parece válido." }
    return { key: computeThread({ channel: ch, jid: id, name: id }), channel: ch, target: id, name: id }
  }
  // 1) CORREO — explícito por canal, o porque tiene forma de dirección
  if (ch === "email" || (raw.includes("@") && !raw.startsWith("@"))) {
    if (!MAIL_OK.test(raw)) return { error: "Esa dirección de correo no parece válida." }
    const addr = raw.toLowerCase().normalize("NFKC")
    if (MY_EMAILS.has(addr)) return { error: "Esa es tu propia dirección: escribile a Mis Notas." }
    return { key: computeThread({ channel: "email", jid: addr, name: addr }), channel: "email", target: addr, name: addr }
  }
  // 3) TELÉFONO (WhatsApp). Se exige código de país: sin él el mensaje se va a otro país o a nadie, y el error es
  //    silencioso y caro. Un móvil local ya tiene 9 dígitos, así que el viejo mínimo de 8 no filtraba nada.
  if (SOLO_DIGITOS.test(raw)) {
    const num = raw.replace(/\D/g, "")
    if (num.length < 10 && !raw.trim().startsWith("+")) return { error: "Ese número parece incompleto: poné el código de país (ej: +51 999 111 222)." }
    if (num.length < 8) return { error: "Ese número parece incompleto: poné el código de país (ej: +51 999 111 222)." }
    if (/^(\d)\1+$/.test(num)) return { error: "Ese número no parece real." }
    if (MY_NUMBERS.has(num)) return { error: "Ese es tu propio número: escribile a Mis Notas." }
    return { key: computeThread({ channel: "whatsapp", jid: `${num}@s.whatsapp.net`, name: "" }), channel: "whatsapp", target: null, name: `+${num}` }
  }
  return { error: "No reconozco ese destino. Poné un teléfono con código de país o un correo." }
}
