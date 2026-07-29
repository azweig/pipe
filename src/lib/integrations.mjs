// Integraciones configurables desde la Consola (Slack, Signal), al mismo nivel que WhatsApp/Gmail.
// El token / la URL se guardan CIFRADOS en reposo (encSecret) en auth/integrations.json (gitignoreado).
// Los readers (src/slack.mjs, src/signal.mjs) leen de acá cuando NO hay variable de entorno equivalente.
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs"
import { encSecret, decSecret } from "./secrets.mjs"

const CFG = "./auth/integrations.json"
const read = () => { try { return existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : {} } catch { return {} } }
const write = (o) => { const tmp = CFG + ".tmp"; writeFileSync(tmp, JSON.stringify(o, null, 2), { mode: 0o600 }); renameSync(tmp, CFG) }

// —— acceso DESCIFRADO, solo para los readers ——
export function getSlackToken() { const s = read().slack; return s && s.token ? decSecret(s.token) : "" }
export function getSignal() { const s = read().signal; return s && s.url ? { url: decSecret(s.url), number: s.number || "" } : null }

// —— estado ENMASCARADO para la UI (nunca devuelve el token) ——
export function getIntegrations() {
  const c = read()
  return {
    slack: { configured: !!(c.slack && c.slack.token), team: c.slack?.team || "" },
    signal: { configured: !!(c.signal && c.signal.url), number: c.signal?.number || "" },
  }
}

// —— Slack: valida el token con auth.test ANTES de guardar (falla rápido si es inválido) ——
export async function setSlack({ token } = {}) {
  token = (token || "").trim()
  if (!token) return { error: "Pegá el token de Slack (empieza con xoxp- o xoxb-)." }
  let r
  try { r = await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json()) }
  catch (e) { return { error: "No pude contactar a Slack: " + (e.message || "sin respuesta") } }
  if (!r || !r.ok) return { error: "Slack rechazó el token" + (r && r.error ? ` (${r.error})` : "") + ". Revisá los scopes (channels:history, im:history, users:read)." }
  const c = read(); c.slack = { token: encSecret(token), team: r.team || "", user: r.user || "" }; write(c) // token CIFRADO en reposo
  return { ok: true, team: r.team || "", user: r.user || "" }
}
export function removeSlack() { const c = read(); delete c.slack; write(c); return { ok: true } }

// —— Signal: guarda la URL de signal-cli-rest-api (en tu server) + tu número ——
export function setSignal({ url, number } = {}) {
  url = (url || "").trim().replace(/\/+$/, ""); number = (number || "").trim()
  if (!url || !number) return { error: "Faltan la URL de signal-cli y tu número (+…)." }
  if (!/^https?:\/\//.test(url)) return { error: "La URL debe empezar con http:// o https://" }
  if (!/^\+\d{6,}$/.test(number)) return { error: "El número debe estar en formato internacional, ej +51999000000." }
  const c = read(); c.signal = { url: encSecret(url), number }; write(c) // URL CIFRADA (puede exponer un host interno)
  return { ok: true }
}
export function removeSignal() { const c = read(); delete c.signal; write(c); return { ok: true } }
