// Login self-service de Telegram (GramJS/MTProto), manejado desde el server: teléfono → código → 2FA opcional → sesión.
// Produce auth/telegram.session + auth/telegram-config.json (apiId/apiHash/phone) que después usa el reader src/telegram.mjs.
// El API_ID/HASH sale de: lo que manda la app > TG_API_ID/HASH del env (managed: el proveedor los pone) > config previa.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs"

const CFG = "./auth/telegram-config.json"
const SESSION = "./auth/telegram.session"
const readCfg = () => { try { return JSON.parse(readFileSync(CFG, "utf8")) } catch { return {} } }

let state = { stage: "idle", resolveCode: null, resolvePassword: null, error: null } // login en curso (en memoria)

export function telegramConnected() { try { return existsSync(SESSION) && readFileSync(SESSION, "utf8").trim().length > 10 } catch { return false } }
export function telegramConfigured() { // ¿el hub ya trae API_ID/HASH? (managed) → la app solo pide teléfono
  if (process.env.TG_API_ID && process.env.TG_API_HASH) return true
  const c = readCfg(); return !!(c.apiId && c.apiHash)
}
export function telegramLoginStatus() {
  return { stage: telegramConnected() ? "connected" : state.stage, error: state.error || null, configured: telegramConfigured(), connected: telegramConnected() }
}

// arranca el login: manda el código al Telegram del usuario y queda esperando /api/telegram/code
export async function telegramStartLogin({ phone, apiId, apiHash } = {}) {
  const { TelegramClient } = await import("telegram")
  const { StringSession } = await import("telegram/sessions/index.js")
  const { Logger } = await import("telegram/extensions/index.js")
  Logger.setLevel("error")
  const prev = readCfg()
  apiId = parseInt(apiId || process.env.TG_API_ID || prev.apiId || 0)
  apiHash = (apiHash || process.env.TG_API_HASH || prev.apiHash || "").trim()
  phone = (phone || prev.phone || "").trim()
  if (!apiId || !apiHash) return { error: "Falta el API ID / API Hash de Telegram (sacalos en my.telegram.org → API development tools)." }
  if (!/^\+?\d[\d\s]{6,}$/.test(phone)) return { error: "Poné tu teléfono con código de país (ej: +51 999 000 000)." }
  mkdirSync("./auth", { recursive: true })
  writeFileSync(CFG, JSON.stringify({ apiId, apiHash, phone: phone.replace(/\s/g, "") })) // el reader lo lee

  state = { stage: "code", resolveCode: null, resolvePassword: null, error: null }
  const codeP = new Promise((res) => { state.resolveCode = res })
  const pwP = new Promise((res) => { state.resolvePassword = res })
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 3 })
  client.start({
    phoneNumber: async () => phone.replace(/\s/g, ""),
    phoneCode: async () => await codeP,
    password: async () => { state.stage = "password"; return await pwP },
    onError: (err) => { state.error = err?.message || String(err) },
  }).then(() => {
    writeFileSync(SESSION, String(client.session.save())) // sesión → el reader ya no re-loguea
    state.stage = "connected"; state.error = null
    try { client.disconnect() } catch {}
  }).catch((e) => { state.stage = "error"; state.error = (e?.message || String(e)).slice(0, 160) })
  return { stage: "code" }
}

export function telegramSubmitCode(code) {
  if (!state.resolveCode) return { error: "No hay un login en curso. Volvé a pedir el código." }
  state.resolveCode(String(code || "").trim()); state.resolveCode = null; return { ok: true }
}
export function telegramSubmitPassword(pw) {
  if (!state.resolvePassword) return { error: "No hay un login esperando contraseña." }
  state.resolvePassword(String(pw || "")); state.resolvePassword = null; return { ok: true }
}
