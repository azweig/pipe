// brain/correo — LEER Y ESCRIBIR UN CORREO COMO CORREO.
//
// La vista de Correo necesita cosas que un chat no tiene: asunto, De/Para/CC, cuerpo HTML, adjuntos, y poder
// responder / responder a todos / reenviar sin salir de ahí. Este módulo junta lo que ya existe (el hilo en la DB,
// el cuerpo HTML, las firmas, el transporte SMTP) y lo entrega con forma de correo.
import { handle as db } from "../db-core.mjs"
import { emailBody } from "./inbox.mjs"
import { enviarCorreo } from "../mailer.mjs"
import { owner, myEmails, tz } from "../hub.mjs"
import { armarCuerpo, citaHtml, citaTexto, reenvioHtml, limpiarHtml, htmlATexto, parseDirecciones,
  asuntoRespuesta, asuntoReenvio, destinatariosRespuesta } from "../correo.mjs"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"

// El texto de un email se guarda como "Asunto — resumen": el asunto es lo de antes del primer " — ".
const asuntoDe = (t) => String(t || "").split(" — ")[0]
const cuerpoDe = (t) => String(t || "").split(" — ").slice(1).join(" — ")

function fila(m, secretOn) {
  let dests = null; try { dests = m.dests ? JSON.parse(m.dests) : null } catch {}
  let adj = []; try { adj = JSON.parse(m.attachments || "[]") || [] } catch {}
  return {
    id: m.id, ts: m.ts, dir: m.dir, cuenta: m.account,
    de: m.dir === "out" ? "" : m.jid, deNombre: m.dir === "out" ? owner() : m.name,
    para: dests?.to || (m.dir === "out" ? [m.jid].filter(Boolean) : []),
    cc: dests?.cc || [],
    // `dests` se empezó a guardar en el esquema v7: el correo anterior no lo tiene y hay que DECIRLO, no simularlo.
    // Sin esta bandera, "responder a todos" sobre correo viejo mandaría una respuesta a medias sin que nadie lo note.
    sinDestinatarios: !dests,
    asunto: asuntoDe(m.text), resumen: cuerpoDe(m.text),
    html: emailBody(m.id, { secretOn }) || "",
    adjuntos: adj.map((a) => ({ nombre: a.name, mime: a.mime, tam: a.size, media: a.cas })),
  }
}

// Un hilo de correo COMPLETO, del más nuevo al más viejo, listo para mostrar y para responder.
export function correoCompleto(key, { secretOn = false, id = "" } = {}) {
  const k = String(key || "").trim()
  if (!k && !id) return { error: "falta la conversación" }
  let msgs = []
  try {
    msgs = id
      ? [db().prepare("SELECT * FROM messages WHERE id=?").get(id)].filter(Boolean)
      : db().prepare("SELECT * FROM messages WHERE thread=? AND channel='email' ORDER BY ts DESC LIMIT 50").all(k)
  } catch { return { error: "no se pudo leer la conversación" } }
  if (!msgs.length) return { error: "no encontrado" }
  const items = msgs.map((m) => fila(m, secretOn))
  return { key: k, asunto: items[0].asunto, cuenta: items[0].cuenta, n: items.length, mensajes: items }
}

// Qué precargar al tocar Responder / Responder a todos / Reenviar. Se calcula en el SERVER para que las tres apps
// hagan exactamente lo mismo: si cada una arma la cita y los destinatarios por su cuenta, se desincronizan.
export function prepararRespuesta(key, { modo = "responder", id = "", secretOn = false } = {}) {
  const hilo = correoCompleto(key, { secretOn, id })
  if (hilo.error) return hilo
  const m = hilo.mensajes[0]
  const base = { from: m.de, fromName: m.deNombre, to: (m.para || []).join(", "), cc: (m.cc || []).join(", "),
    subject: m.asunto, ts: m.ts, html: m.html, text: htmlATexto(m.html) }
  const zona = tz()
  if (modo === "reenviar") {
    return { modo, cuenta: m.cuenta, to: [], cc: [], asunto: asuntoReenvio(m.asunto),
      cita: reenvioHtml(base, zona), citaTxt: "", inReplyTo: "", adjuntos: m.adjuntos, sinDestinatarios: m.sinDestinatarios }
  }
  const d = destinatariosRespuesta(base, myEmails(), modo === "todos")
  return { modo, cuenta: m.cuenta, to: d.to, cc: d.cc, asunto: asuntoRespuesta(m.asunto),
    cita: citaHtml(base, zona), citaTxt: citaTexto(base, zona), inReplyTo: m.id, adjuntos: [],
    sinDestinatarios: m.sinDestinatarios }
}

// Enviar lo que el usuario compuso. El HTML se SANEA acá, del lado del server: el editor es contentEditable y lo que
// llega puede traer cualquier cosa pegada desde Word o desde una web. Confiar en que el cliente ya limpió es confiar
// en que nadie va a llamar al endpoint a mano.
export async function enviarCorreoCompuesto(b = {}) {
  const to = parseDirecciones(b.to), cc = parseDirecciones(b.cc), bcc = parseDirecciones(b.bcc)
  if (!to.length) return { error: "Falta el destinatario." }
  const asunto = String(b.asunto || "").trim()
  const htmlUsuario = limpiarHtml(b.html || "")
  if (!htmlUsuario.trim() && !String(b.texto || "").trim()) return { error: "El correo está vacío." }
  const cuerpo = armarCuerpo({
    html: htmlUsuario, texto: b.texto || "", cuenta: b.cuenta || "",
    cita: limpiarHtml(b.cita || ""), citaTxt: b.citaTxt || "",
    conFirma: b.conFirma !== false, tz: tz(),
  })
  const adj = normalizarAdjuntos(b.adjuntos)
  if (adj.error) return adj
  const r = await enviarCorreo({
    cuenta: b.cuenta, to, cc, bcc, subject: asunto, html: cuerpo.html, text: cuerpo.text,
    inReplyTo: b.inReplyTo || "", fromName: owner(), adjuntos: adj.items,
  })
  if (r.error) return r
  if (b.borradorId) { try { borrarBorrador(b.borradorId) } catch {} }
  return { ok: true, to, cc, bcc, asunto, messageId: r.messageId }
}

// ── ADJUNTOS ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Llegan en base64 dentro del pedido. Hay tope porque un adjunto grande no falla acá: falla en el SMTP del otro lado,
// minutos después, con un rebote que el usuario ve como "mandé el correo y no llegó". Mejor decirlo antes de enviar.
const MAX_ADJ_MB = +process.env.MAIL_MAX_ADJ_MB || 20
export function normalizarAdjuntos(lista) {
  const items = []
  let total = 0
  for (const a of Array.isArray(lista) ? lista : []) {
    const b64 = String(a?.b64 || "").replace(/^data:[^;]*;base64,/, "")
    if (!b64) continue
    const content = Buffer.from(b64, "base64")
    total += content.length
    if (total > MAX_ADJ_MB * 1048576) return { error: `Los adjuntos pasan de ${MAX_ADJ_MB} MB. La mayoría de los servidores los rechaza.` }
    items.push({ filename: String(a.nombre || "archivo").slice(0, 120), mime: a.mime || "application/octet-stream", content })
  }
  return { items }
}

// ── BORRADORES ───────────────────────────────────────────────────────────────────────────────────────────────────
// En archivo y no en la DB a propósito: un borrador no es un mensaje del hilo. Si viviera en `messages` aparecería
// en la bandeja, en la búsqueda y en los resúmenes como si fuera algo que pasó.
const FILE = "./data/mail-drafts.json"
const cargar = () => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [] } catch { return [] } }
const guardar = (v) => { mkdirSync("./data", { recursive: true }); writeFileSync(FILE, JSON.stringify(v, null, 2)) }

export const listarBorradores = () => cargar().sort((a, b) => b.ts - a.ts)
export function guardarBorrador(b = {}) {
  const todos = cargar()
  const id = b.id || "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const d = { id, ts: Date.now(), cuenta: b.cuenta || "", to: b.to || "", cc: b.cc || "", bcc: b.bcc || "",
    asunto: b.asunto || "", html: limpiarHtml(b.html || ""), cita: limpiarHtml(b.cita || ""),
    citaTxt: b.citaTxt || "", inReplyTo: b.inReplyTo || "" }
  const i = todos.findIndex((x) => x.id === id)
  if (i >= 0) todos[i] = d; else todos.push(d)
  // Tope: los borradores se guardan solos mientras escribís. Sin límite, el archivo crece para siempre.
  guardar(todos.sort((a, b2) => b2.ts - a.ts).slice(0, 100))
  return { ok: true, id, ts: d.ts }
}
export function borrarBorrador(id) {
  const todos = cargar().filter((x) => x.id !== id)
  guardar(todos)
  return { ok: true }
}
