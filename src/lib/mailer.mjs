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
