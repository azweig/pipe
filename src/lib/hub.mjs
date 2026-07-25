// CONFIG POR-HUB (base multi-cliente). Todo lo que antes estaba hardcodeado al owner sale de acá: dueño, empresa, números/mails
// propios (para routing "self"/"mío"), timezone. Defaults = genéricos → cada instancia define su identidad en data/hub-config.json.
// Cada instancia dedicada tiene su propio data/hub-config.json. Editable desde Configuración → "Este hub".
import { existsSync, readFileSync, writeFileSync, statSync, renameSync } from "fs"
import { withLock } from "./lock.mjs"

const CFG = process.env.HUB_CONFIG || "./data/hub-config.json" // override para tests/instancias no estándar
// DEFAULTS genéricos → cada instancia define SU identidad en data/hub-config.json (o desde Configuración → "Este hub").
// Copiá hub-config.example.json a data/hub-config.json y edítalo. Nunca pongas datos reales en los DEFAULTS de abajo: este archivo es público.
const DEFAULTS = {
  ownerName: "Owner",                  // nombre completo (así aparecen TUS mensajes salientes)
  ownerFirst: "Owner",                 // nombre de pila (saludo del Home)
  company: "",                         // empresa (contexto de los prompts de IA)
  myNumbers: [],                       // MIS números de WhatsApp → routing self/mine
  myEmails: [],                        // MIS correos → routing self/mine
  timezone: "America/Lima",
  domain: "localhost",
}
let _c = null, _m = -1
function cfg() {
  try { const m = existsSync(CFG) ? statSync(CFG).mtimeMs : 0; if (!_c || m !== _m) { _c = { ...DEFAULTS, ...(existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : {}) }; _m = m } } catch { _c = { ...DEFAULTS } }
  return _c
}
export const owner = () => cfg().ownerName
export const ownerFirst = () => cfg().ownerFirst
export const company = () => cfg().company
export const myNumbers = () => cfg().myNumbers || []
export const myEmails = () => (cfg().myEmails || []).map((s) => s.toLowerCase())
export const tz = () => cfg().timezone || "America/Lima"
export const hubDomain = () => cfg().domain
// offset UTC actual de la tz configurada, formato "-05:00" (para parsear datetimes naive de Outlook/calendario)
export function tzOffset() {
  const now = new Date()
  const diffMin = Math.round((new Date(now.toLocaleString("en-US", { timeZone: tz() })) - new Date(now.toLocaleString("en-US", { timeZone: "UTC" }))) / 60000)
  const sign = diffMin < 0 ? "-" : "+", a = Math.abs(diffMin)
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`
}

export function hubConfig() { return { ...cfg() } } // para la UI
export function setHubConfig(input = {}) {
  const next = { ...cfg() }
  for (const k of ["ownerName", "ownerFirst", "company", "timezone", "domain"]) if (input[k] != null && String(input[k]).trim()) next[k] = String(input[k]).trim()
  if (input.myNumbers != null) next.myNumbers = (Array.isArray(input.myNumbers) ? input.myNumbers : String(input.myNumbers).split(",")).map((s) => String(s).replace(/[^\d]/g, "")).filter((s) => s.length >= 8)
  if (input.myEmails != null) next.myEmails = (Array.isArray(input.myEmails) ? input.myEmails : String(input.myEmails).split(",")).map((s) => String(s).trim().toLowerCase()).filter((s) => s.includes("@"))
  withLock(CFG, () => { const tmp = CFG + "." + process.pid + ".tmp"; writeFileSync(tmp, JSON.stringify(next, null, 2)); renameSync(tmp, CFG) })
  _c = null; _m = -1
  return { ok: true, config: next }
}
