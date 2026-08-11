// FIRMAS de correo. Un email se responde con firma; un WhatsApp no. Hasta ahora Pipe mandaba los dos igual —
// texto pelado— y las respuestas por mail se leían como un SMS.
//
// Por CUENTA: quien escribe desde ventas@empresa no firma igual que desde su correo personal. Se guarda en
// data/signatures.json → { "<label o email>": {text, html}, "*": {…} }  ("*" = la de por defecto).
// Si no configuraste ninguna, se arma una mínima y correcta con la identidad del hub (nombre + empresa).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { owner, company } from "./hub.mjs"

const FILE = "./data/signatures.json"
const load = () => { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {} } catch { return {} } }

export function listSignatures() { return load() }
export function getSignature(account) {
  const all = load()
  const key = String(account || "").toLowerCase()
  return all[key] || all[String(account || "")] || all["*"] || null
}
export function setSignature(account, sig) {
  const all = load()
  const key = String(account || "*").toLowerCase() || "*"
  if (sig && (String(sig.text || "").trim() || String(sig.html || "").trim())) all[key] = { text: String(sig.text || "").trim(), html: String(sig.html || "").trim() }
  else delete all[key] // vaciar = volver a la de por defecto
  mkdirSync("./data", { recursive: true })
  writeFileSync(FILE, JSON.stringify(all, null, 2))
  return all
}

// Firma por defecto: sobria y sin inventar datos. Solo lo que el hub SABE (nombre y, si hay, empresa).
export function defaultSignature() {
  const nm = owner() || "", co = company() || ""
  if (!nm && !co) return null
  const text = ["--", nm, co].filter(Boolean).join("\n")
  const html = `<div>--<br>${esc(nm)}${co ? `<br><span style="color:#666">${esc(co)}</span>` : ""}</div>`
  return { text, html }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
// texto plano → HTML seguro (escapado, saltos de línea respetados, links clicables)
export function textToHtml(t) {
  return esc(t)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>")
}

/**
 * Arma el cuerpo final de un email: tu texto + la firma de esa cuenta.
 * Devuelve {text, html} — se manda multipart para que la firma se vea bien en cualquier cliente.
 * `skip` = true cuando el texto YA trae firma (el usuario la escribió a mano) → no duplicar.
 */
export function composeEmailBody(text, account, { skip = false } = {}) {
  const body = String(text || "")
  const sig = skip ? null : (getSignature(account) || defaultSignature())
  if (!sig) return { text: body, html: `<div>${textToHtml(body)}</div>` }
  return {
    text: `${body}\n\n${sig.text || ""}`.trimEnd(),
    html: `<div>${textToHtml(body)}</div><br>${sig.html || textToHtml(sig.text || "")}`,
  }
}

// ¿el texto ya termina con una firma escrita a mano? Evita la firma duplicada cuando pegás una respuesta completa.
export function looksSigned(text) {
  const t = String(text || "").trimEnd()
  if (!t) return false
  const last = t.split("\n").slice(-6).join("\n").toLowerCase()
  if (/^--\s*$/m.test(last)) return true // separador estándar de firma
  const nm = String(owner() || "").toLowerCase()
  if (nm && last.includes(nm) && /saludos|abrazo|atentamente|cordial|slds|gracias/i.test(last)) return true
  return false
}
