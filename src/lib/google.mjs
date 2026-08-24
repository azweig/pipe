// Google multi-cuenta — OAuth por cuenta para Calendar + Drive (Docs/Sheets se leen vía export de Drive).
// Reusa el MISMO client OAuth (auth/google-oauth.json). Token por cuenta en auth/google-token-<label>.json.
import { google } from "googleapis"
import { readFileSync, existsSync, writeFileSync } from "fs"
import http from "http"

const CFG = () => JSON.parse(readFileSync("./auth/google-oauth.json", "utf8"))
const REDIRECT = "http://localhost:53682/oauth2callback"
// credenciales OAuth por cuenta (cada Workspace/org puede tener su propia app); si no, usa la default
function clientCreds(label) {
  const a = googleAccounts().find((x) => x.label === label)
  if (a && a.client_id && a.client_secret) return { client_id: a.client_id, client_secret: a.client_secret }
  return CFG()
}
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
]
const tokenFile = (label) => `./auth/google-token-${label}.json`
export function googleAccounts() { return existsSync("./auth/google-accounts.json") ? JSON.parse(readFileSync("./auth/google-accounts.json", "utf8")) : [] }
export function hasToken(label) { return existsSync(tokenFile(label)) }

export function oauthClient(label) {
  const c = clientCreds(label); const o = new google.auth.OAuth2(c.client_id, c.client_secret, REDIRECT)
  if (existsSync(tokenFile(label))) o.setCredentials(JSON.parse(readFileSync(tokenFile(label), "utf8")))
  o.on("tokens", (t) => { const cur = existsSync(tokenFile(label)) ? JSON.parse(readFileSync(tokenFile(label), "utf8")) : {}; writeFileSync(tokenFile(label), JSON.stringify({ ...cur, ...t })) })
  return o
}

// autoriza una cuenta (flujo loopback). Devuelve la URL primero (para compartir), luego espera el código.
export async function authorizeAccount(label, email, onUrl) {
  const c = clientCreds(label); const o = new google.auth.OAuth2(c.client_id, c.client_secret, REDIRECT)
  const url = o.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, login_hint: email || undefined })
  if (onUrl) onUrl(url)
  const code = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith("/oauth2callback")) { const cc = new URL(req.url, REDIRECT).searchParams.get("code"); res.end("pipe: cuenta conectada, cerrá esta pestaña."); server.close(); resolve(cc) }
    }).listen(53682)
  })
  const { tokens } = await o.getToken(code)
  writeFileSync(tokenFile(label), JSON.stringify(tokens))
  return true
}

// ══ Gmail vía OAuth WEB — el flujo "app normal": "Conectar Gmail → Permitir" en el navegador (nada de app-passwords) ══
// Scope full-mailbox (https://mail.google.com/) → habilita IMAP (leer) Y SMTP (responder) por XOAUTH2 con el mismo token.
export const GMAIL_SCOPES = ["https://mail.google.com/", "https://www.googleapis.com/auth/userinfo.email"]
// credenciales del client OAuth: env por-tenant (GOOGLE_CLIENT_ID/SECRET) o auth/google-oauth.json como fallback.
function webCreds() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return { client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET }
  try { return CFG() } catch { return null }
}
export function googleConfigured() { return !!webCreds() } // la UI solo muestra "Conectar Gmail" si hay app OAuth
function webClient(redirectUri) { const c = webCreds(); if (!c) throw new Error("Google OAuth no configurado (falta GOOGLE_CLIENT_ID/SECRET)"); return new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri) }
// URL de consentimiento (el usuario va a Google y aprueba). state = anti-CSRF.
export function gmailAuthUrl(redirectUri, state, loginHint) {
  return webClient(redirectUri).generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GMAIL_SCOPES, state, login_hint: loginHint || undefined })
}
// canjea el ?code= por tokens + resuelve el email de la cuenta conectada
export async function exchangeGmailCode(code, redirectUri) {
  const o = webClient(redirectUri)
  const { tokens } = await o.getToken(code)
  o.setCredentials(tokens)
  let email = ""
  try { const oauth2 = google.oauth2({ version: "v2", auth: o }); const me = await oauth2.userinfo.get(); email = me.data.email || "" } catch {}
  return { tokens, email } // guardamos tokens.refresh_token (cifrado); el access_token se refresca al vuelo
}
// dado un refresh_token, devuelve un access_token FRESCO (para IMAP/SMTP XOAUTH2; expiran ~1h)
export async function gmailAccessToken(refreshToken) {
  const o = webClient("https://localhost/oauth/google/callback") // el redirect no importa para refrescar
  o.setCredentials({ refresh_token: refreshToken })
  const { token } = await o.getAccessToken()
  return token
}

// ══ BACKUP EN TU DRIVE — "Conectar → Permitir" desde la Consola, igual que Gmail ══════════════════════════════
// Scope `drive.file`: pipe SOLO ve los archivos que él mismo crea. No puede leer, listar ni tocar el resto de tu
// Drive — ni tus documentos ni tus fotos. Es el permiso mínimo que existe para poder subir algo.
// El bundle que sube ya va CIFRADO con tu passphrase (secrets/backup.pass), así que Google guarda un blob opaco.
export const BACKUP_SCOPES = ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/userinfo.email"]
const BACKUP_TOKEN = "./auth/google-backup-token.json"

export function backupAuthUrl(redirectUri, state) {
  return webClient(redirectUri).generateAuthUrl({ access_type: "offline", prompt: "consent", scope: BACKUP_SCOPES, state })
}
export async function exchangeBackupCode(code, redirectUri) {
  const o = webClient(redirectUri)
  const { tokens } = await o.getToken(code)
  o.setCredentials(tokens)
  let email = ""
  try { const oauth2 = google.oauth2({ version: "v2", auth: o }); const me = await oauth2.userinfo.get(); email = me.data.email || "" } catch {}
  return { tokens, email }
}
export function saveBackupToken(tokens, email) {
  const prev = existsSync(BACKUP_TOKEN) ? JSON.parse(readFileSync(BACKUP_TOKEN, "utf8")) : {}
  // el refresh_token solo viene la PRIMERA vez que autorizás: si no llega, conservamos el que ya teníamos
  writeFileSync(BACKUP_TOKEN, JSON.stringify({ ...prev, ...tokens, refresh_token: tokens.refresh_token || prev.refresh_token, email: email || prev.email }))
}
export function backupStatus() {
  if (!existsSync(BACKUP_TOKEN)) return { connected: false }
  try { const t = JSON.parse(readFileSync(BACKUP_TOKEN, "utf8")); return { connected: !!t.refresh_token, email: t.email || "" } } catch { return { connected: false } }
}
// cliente de Drive listo para subir (refresca el access_token solo y lo persiste)
export function backupDrive() {
  if (!existsSync(BACKUP_TOKEN)) return null
  const c = webCreds(); if (!c) return null
  const o = new google.auth.OAuth2(c.client_id, c.client_secret)
  o.setCredentials(JSON.parse(readFileSync(BACKUP_TOKEN, "utf8")))
  o.on("tokens", (t) => { try { saveBackupToken(t, "") } catch {} })
  return google.drive({ version: "v3", auth: o })
}
