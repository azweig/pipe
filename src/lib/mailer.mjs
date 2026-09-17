// Envío de emails vía SMTP. Genérico por CUENTA: Gmail (app-password u OAuth), Mailcow self-hosted, o cualquier IMAP+SMTP.
// La cuenta define: host/smtp_host, smtp_port, insecure (cert self-signed), oauth|pass. Usado por el compositor (/api/send) + avisos.
import nodemailer from "nodemailer"
import { readFileSync, existsSync } from "node:fs"
import { decSecret } from "./secrets.mjs"
import { gmailAccessToken } from "./google.mjs"
import { composeEmailBody, looksSigned } from "./signature.mjs"

const imapAccounts = () => (existsSync("./auth/imap-accounts.json") ? JSON.parse(readFileSync("./auth/imap-accounts.json", "utf8")) : [])

// auth de una cuenta: OAuth (Gmail "Permitir") → XOAUTH2; si no, app-password/clave DESCIFRADA (mail-imap ya la descifra igual).
async function acctAuth(acc) {
  return acc.oauth === "google"
    ? { type: "OAuth2", user: acc.user, accessToken: await gmailAccessToken(decSecret(acc.refreshToken)) }
    : { user: acc.user, pass: decSecret(acc.pass) }
}

// SMTP de una cuenta: explícito (smtp_host/smtp_port), o Gmail, o el mismo host IMAP (Mailcow: mail.X sirve IMAP y SMTP).
function smtpOf(acc) {
  const host = acc.smtp_host || (/gmail/i.test(acc.host || "") ? "smtp.gmail.com" : acc.host)
  return { host, port: acc.smtp_port || 587, tls: acc.insecure ? { rejectUnauthorized: false } : undefined }
}

// transporte SMTP para una cuenta concreta → {t, from} o {error}. 465=SSL, 587=STARTTLS.
async function transportFor(acc) {
  if (!acc) return { error: "sin cuenta configurada para enviar" }
  const { host, port, tls } = smtpOf(acc)
  const t = nodemailer.createTransport({ host, port, secure: port === 465, requireTLS: port !== 465, ...(tls ? { tls } : {}), auth: await acctAuth(acc), connectionTimeout: 12000, greetingTimeout: 8000, socketTimeout: 15000 })
  return { t, from: acc.user }
}

// cuenta que puede ENVIAR (tiene pass u oauth). Si se pasa label, prioriza esa; si no, la 1ª de Gmail (continuidad de lo transaccional), luego cualquiera.
function sendableAccount(label) {
  const accts = imapAccounts(); const ok = (a) => a.oauth === "google" || a.pass
  return (label && accts.find((a) => a.label === label && ok(a))) || accts.find((a) => ok(a) && /gmail/i.test(a.host || "")) || accts.find(ok) || null
}

// Envío TRANSACCIONAL genérico (no-reply): notificaciones del sistema (ej. suscripción Ko-fi). fromName = display, replyTo opcional.
// Cuentas desde las que se PUEDE enviar (tienen SMTP configurado). Es lo que llena el selector "De:".
export function cuentasQueEnvian() {
  try {
    // imapAccounts() ya es la fuente que usa sendableAccount: se filtra con el MISMO criterio (tiene clave u OAuth),
    // así el selector nunca ofrece una cuenta desde la que después no se puede enviar.
    return imapAccounts()
      .filter((a) => a.oauth === "google" || a.pass)
      .map((a) => ({ label: a.label, user: a.user, nombre: a.name || "" }))
  } catch { return [] }
}

export async function sendEmail({ to, subject, text, html, fromName = "pipe", replyTo } = {}) {
  const dst = String(to || "").replace(/^email:/, "").trim()
  if (!/^[^@\s]+@[^@\s]+$/.test(dst)) return { error: "email inválido" }
  const { t, from, error } = await transportFor(sendableAccount()); if (error) return { error }
  try { await t.sendMail({ from: `"${fromName}" <${from}>`, to: dst, subject: subject || "(sin asunto)", text, ...(html ? { html } : {}), ...(replyTo ? { replyTo } : {}) }); return { ok: true, from } }
  catch (e) { return { error: `SMTP: ${e.message}` } }
}

// RESPUESTA a un hilo de email: usa el SMTP de la cuenta que recibió el hilo (Gmail, Mailcow, lo que sea).
// Un correo NO es un mensaje de texto: va con FIRMA, con parte HTML (para que la firma se vea) y con las cabeceras
// de hilo (In-Reply-To/References) para que el cliente del otro lo enganche a la conversación en vez de abrir una nueva.
// `inReplyTo` es el Message-ID del correo que estás respondiendo (nuestro id de mensaje es "email:<Message-ID>").
// ENVÍO DE CORREO COMPLETO — el que usa la vista de Correo. A diferencia de sendEmailReply (que responde un hilo con
// texto), acá el usuario compone: elige cuenta, destinatarios, CC/CCO, asunto y cuerpo HTML ya armado y saneado.
// El cuerpo llega LISTO desde correo.mjs (firma + cita incluidas): este módulo sólo sabe de transporte.
export async function enviarCorreo({ cuenta, to, cc = [], bcc = [], subject, html, text, inReplyTo, references, fromName, adjuntos = [] } = {}) {
  const dst = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (!dst.length) return { error: "falta el destinatario" }
  const acc = sendableAccount(cuenta); if (!acc) return { error: "sin cuenta configurada para enviar" }
  const { t, from, error } = await transportFor(acc); if (error) return { error }
  const ref = normalizeMsgId(inReplyTo)
  // El Message-ID de lo que mandamos se devuelve para poder encadenar la PRÓXIMA respuesta del hilo sin releer IMAP.
  try {
    const info = await t.sendMail({
      from: fromName ? `"${fromName}" <${from}>` : from,
      to: dst, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}),
      subject: subject || "(sin asunto)", text, html,
      ...(ref ? { inReplyTo: ref, references: [...(references || []), ref] } : {}),
      ...(adjuntos.length ? { attachments: adjuntos.map((a) => ({ filename: a.filename, content: a.content, contentType: a.mime })) } : {}),
    })
    return { ok: true, from, messageId: info?.messageId || null, to: dst, cc, bcc }
  } catch (e) { return { error: `SMTP: ${e.message}` } }
}

export async function sendEmailReply(toRaw, text, { account, subject, inReplyTo, fromName } = {}) {
  const to = String(toRaw).replace(/^email:/, "").trim()
  if (!/^[^@\s]+@[^@\s]+$/.test(to)) return { error: "dirección de email inválida" }
  const acc = sendableAccount(account); if (!acc) return { error: "sin cuenta configurada para enviar" }
  const subj = subject ? (/^re:/i.test(subject) ? subject : `Re: ${subject}`) : "Re:"
  const { t, from, error } = await transportFor(acc); if (error) return { error }
  const body = composeEmailBody(text, acc.label || acc.user, { skip: looksSigned(text) })
  const ref = normalizeMsgId(inReplyTo)
  try {
    await t.sendMail({
      from: fromName ? `"${fromName}" <${from}>` : from,
      to, subject: subj, text: body.text, html: body.html,
      ...(ref ? { inReplyTo: ref, references: [ref] } : {}),
    })
    return { ok: true, from }
  } catch (e) { return { error: `SMTP: ${e.message}` } }
}
// nuestro id es "email:<abc@host>" (IMAP) o "email:AQMk…" (Graph, opaco). Solo el primero sirve como Message-ID RFC.
function normalizeMsgId(id) {
  const raw = String(id || "").replace(/^email:/, "").trim()
  return /^<[^>]+@[^>]+>$/.test(raw) ? raw : null
}
