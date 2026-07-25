// Gestión de CUENTAS del hub para la pantalla de Configuración: listar las conectadas (email IMAP + Outlook + WhatsApp) y
// AGREGAR una cuenta de correo (valida credenciales por IMAP, la guarda en auth/imap-accounts.json; el reader se reconecta solo).
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs"
import { ImapFlow } from "imapflow"
import { db } from "./db.mjs"
import { MY_NUMBERS } from "./thread.mjs"
import { encSecret } from "./secrets.mjs"

const IMAP_CFG = "./auth/imap-accounts.json"
const readImap = () => { try { return existsSync(IMAP_CFG) ? JSON.parse(readFileSync(IMAP_CFG, "utf8")) : [] } catch { return [] } }
const writeImap = (arr) => { const tmp = IMAP_CFG + ".tmp"; writeFileSync(tmp, JSON.stringify(arr, null, 2)); renameSync(tmp, IMAP_CFG) }

// servidor IMAP sugerido por el dominio del correo
export function guessHost(email) {
  const d = (email.split("@")[1] || "").toLowerCase()
  if (/gmail\.com|googlemail/.test(d)) return "imap.gmail.com"
  if (/outlook|hotmail|live\.com|office365/.test(d)) return "outlook.office365.com"
  if (/zoho/.test(d)) return "imap.zoho.com"
  if (/yahoo/.test(d)) return "imap.mail.yahoo.com"
  if (/icloud|me\.com/.test(d)) return "imap.mail.me.com"
  return "imap." + d
}

// cuentas conectadas + actividad real (de la DB) → sin exponer contraseñas
export function listAccounts() {
  const stat = (acc) => { try { const r = db().prepare("SELECT COUNT(*) n, MAX(ts) last FROM messages WHERE account=?").get(acc); return { count: r?.n || 0, last: r?.last || 0 } } catch { return { count: 0, last: 0 } } }
  const email = readImap().map((a) => ({ label: a.label, user: a.user, host: a.host, kind: "imap", ...stat(a.label) }))
  // Outlook (Microsoft Graph) si tiene actividad
  const ol = stat("outlook"); if (ol.count) email.push({ label: "outlook", user: "Microsoft 365", host: "graph.microsoft.com", kind: "outlook", ...ol })
  const messaging = [{ network: "whatsapp", label: "WhatsApp", numbers: [...MY_NUMBERS] }]
  return { email, messaging, linkUrl: "/link" }
}

// valida credenciales conectándose por IMAP; si andan, guarda la cuenta. El reader mail-imap se reconecta y la ingesta arranca.
export async function addEmailAccount({ label, user, pass, host } = {}) {
  user = (user || "").trim(); pass = (pass || "").trim()
  if (!user || !pass) return { error: "Faltan el correo o la contraseña de aplicación." }
  host = (host || guessHost(user)).trim()
  label = (label || user.split("@")[0]).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-")
  const accts = readImap()
  if (accts.some((a) => (a.user || "").toLowerCase() === user.toLowerCase())) return { error: "Esa cuenta ya está conectada." }
  // probar la conexión (falla rápido si la contraseña es incorrecta)
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false })
  try { await client.connect(); await client.logout() }
  catch (e) {
    // mensaje ESPECÍFICO según el fallo (antes devolvía "Command failed", inútil): auth vs conexión vs servidor.
    const detail = e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(e.responseText || e.message || "")
      ? "Usuario o contraseña rechazados. En Gmail/Outlook usá una CONTRASEÑA DE APLICACIÓN de 16 letras (no la de tu cuenta) y activá IMAP en la configuración del correo."
      : `No pude conectar al servidor (${host}): ${(e.responseText || e.message || "sin respuesta").slice(0, 120)}. Revisá el servidor IMAP y que el puerto 993 esté abierto.`
    return { error: detail }
  }
  accts.push({ label, host, port: 993, user, pass: encSecret(pass) }) // contraseña CIFRADA en reposo
  writeImap(accts)
  return { ok: true, label, user, host }
}

export function removeEmailAccount(label) {
  const accts = readImap()
  const next = accts.filter((a) => a.label !== label)
  if (next.length === accts.length) return { error: "no encontrada" }
  writeImap(next)
  return { ok: true }
}
