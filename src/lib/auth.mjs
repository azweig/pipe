// Auth por PIN para exponer pipe en internet (hub.example.com) con un mínimo de seguridad.
// Modelo (según security-best-practices, backend Node): PIN hasheado con scrypt+salt server-side; la cookie SOLO lleva un
// token aleatorio (nunca el PIN); sesiones server-side de larga duración ("recordar este equipo"); rate-limit anti-fuerza-bruta.
import { readFileSync, writeFileSync, existsSync } from "fs"
import { randomBytes, scryptSync, timingSafeEqual } from "crypto"

const PIN_FILE = "./data/auth-pin.json"
const SESS_FILE = "./data/auth-sessions.json"
const SESSION_TTL = 90 * 86400000 // 90 días: en tus 3 celulares no volvés a tipear el PIN

const loadJ = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d)
const saveJ = (f, v) => writeFileSync(f, JSON.stringify(v), { mode: 0o600 }) // 600: el PIN hash y los tokens de sesión no deben ser legibles por otros usuarios del box

export function pinIsSet() { return existsSync(PIN_FILE) }

// setear/cambiar el PIN (6-12 dígitos). scrypt es lento a propósito → frena fuerza bruta offline si roban el archivo.
// Mínimo 6 (no 4): en un endpoint expuesto a internet, 10⁴ es brute-forceable; 10⁶ + rate-limit lo hace inviable.
export function setPin(pin) {
  if (!/^\d{6,12}$/.test(String(pin || ""))) return { error: "El PIN debe tener entre 6 y 12 dígitos." }
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(String(pin), salt, 64).toString("hex")
  saveJ(PIN_FILE, { salt, hash })
  return { ok: true }
}

// cambiar el PIN desde adentro (ya autenticado): exige el PIN actual → nadie con una sesión robada lo cambia sin saberlo.
export function changePin(oldPin, newPin, ip, keepToken) {
  if (!pinIsSet()) return { error: "Todavía no hay un PIN configurado." }
  if (rateLimited(ip)) return { error: "Demasiados intentos fallidos. Esperá 15 minutos." } // igual que login: sin esto, una cookie robada da intentos ILIMITADOS contra los 6 dígitos
  if (!verifyPin(oldPin)) { recordFail(ip); return { error: "El PIN actual es incorrecto." } }
  if (ip) attempts.delete(ip)
  const r = setPin(newPin)
  if (r.ok) logoutOthers(keepToken) // "me robaron el celu → cambio el PIN" DEBE cerrar las otras sesiones; antes la de 90 días del ladrón seguía viva
  return r
}

function verifyPin(pin) {
  const p = loadJ(PIN_FILE, null); if (!p) return false
  const h = scryptSync(String(pin || ""), p.salt, 64)
  const stored = Buffer.from(p.hash, "hex")
  return h.length === stored.length && timingSafeEqual(h, stored) // timing-safe: no filtra info por tiempo de comparación
}

// ── sesiones (cache en memoria, persistidas a disco) ──
let _sess = null
const sessions = () => (_sess ||= loadJ(SESS_FILE, {}))
function persist() { saveJ(SESS_FILE, sessions()) }

// ── rate-limit por IP (en memoria): 5 intentos → 15 min de bloqueo. Un PIN es corto, hay que frenar la fuerza bruta ONLINE. ──
const attempts = new Map()
const rateLimited = (ip) => { const a = attempts.get(ip); return !!(a && a.until > Date.now()) }
const RL_PRUNE = +process.env.RATE_MAP_PRUNE || 1000 // umbral de poda del Map (configurable para el test de regresión)
const RL_MAX = +process.env.RATE_MAP_MAX || 5000     // umbral de evict LRU (backstop de memoria)
function recordFail(ip) {
  const now = Date.now()
  const a = attempts.get(ip) || { n: 0, until: 0, last: 0 }
  a.n++; a.last = now; if (a.n >= 5) { a.until = now + 15 * 60000; a.n = 0 }
  attempts.set(ip, a) // setear ANTES de podar → la entrada del atacante activo (last fresco) nunca se poda
  if (attempts.size > RL_PRUNE) {
    // poda SOLO entradas inactivas hace >15min: ni en curso (n=1..4, until=0) ni bloqueadas vigentes. Antes borraba los contadores
    // en curso (until falsy) → pasado el umbral el rate-limiter quedaba MUERTO (el atacante nunca llegaba a 5). REGRESIÓN cerrada.
    for (const [k, v] of attempts) if (now - (v.last || 0) > 15 * 60000 && (!v.until || v.until < now)) attempts.delete(k)
    // backstop de memoria: evict LRU SOLO entre entradas TERMINADAS (ni bloqueadas vigentes `until>now`, ni en curso `n>0`). Evictar una
    // bloqueada le evapora el bloqueo; evictar una en curso resetea el contador de una víctima fresca → en ambos casos mata el rate-limit.
    // Si el Map se llena de entradas activas (flood real de IPs no-spoofeables por Caddy), no se evicta nada: crece acotado (~50B/IP, expira 15min).
    if (attempts.size > RL_MAX) {
      const evictable = [...attempts.entries()].filter(([, v]) => (!v.until || v.until < now) && !v.n).sort((x, y) => (x[1].last || 0) - (y[1].last || 0))
      for (const [k] of evictable.slice(0, attempts.size - RL_MAX)) attempts.delete(k)
    }
  }
}

// ── defensa contra fuerza-bruta DISTRIBUIDA (rotar IPs evade el límite por-IP) ──
// El rate-limit de arriba es por-IP: un atacante con miles de IPs (botnet/proxies) lo esquiva y ataca los 6 dígitos en horas.
// Contador GLOBAL de fallos en ventana: superado el umbral, se activa un cooldown que frena TODO intento remoto → colapsa el
// throughput del atacante. NO es un DoS para el dueño: SIEMPRE le queda el túnel SSH local (isLocal), que ni pasa por el PIN.
let gFails = [], gLockUntil = 0
const gThresh = () => +process.env.AUTH_GLOBAL_THRESH || 50 // dinámico → los tests lo ajustan; prod = 50 fallos / 10 min dispara el cooldown
const G_WIN = 10 * 60000, G_LOCK = 30000
const globalLocked = () => Date.now() < gLockUntil
function recordGlobalFail() {
  const now = Date.now()
  gFails = gFails.filter((t) => now - t < G_WIN)
  gFails.push(now)
  if (gFails.length >= gThresh()) { gLockUntil = now + G_LOCK; gFails = [] } // dispara cooldown y resetea → si el ataque continúa, se re-arma solo
}
// para los tests: limpiar TODO el estado de rate-limit en memoria (per-IP + global) entre casos
export function __resetLimits() { attempts.clear(); gFails = []; gLockUntil = 0 }

export function login(pin, ip) {
  if (globalLocked()) return { error: "Demasiados intentos en el sistema. Esperá unos minutos (o entrá por el túnel local)." }
  if (rateLimited(ip)) return { error: "Demasiados intentos fallidos. Esperá 15 minutos." }
  if (!verifyPin(pin)) { recordFail(ip); recordGlobalFail(); return { error: "PIN incorrecto." } }
  attempts.delete(ip)
  const token = randomBytes(32).toString("hex") // 256 bits aleatorios: no adivinable
  sessions()[token] = { created: Date.now(), expires: Date.now() + SESSION_TTL }
  persist()
  return { ok: true, token, ttl: SESSION_TTL }
}

export function validSession(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false
  const s = sessions()[token]
  if (!s || s.expires < Date.now()) { if (s) { delete sessions()[token]; persist() } return false }
  return true
}

export function logout(token) { if (token && sessions()[token]) { delete sessions()[token]; persist() } }

// cuántas sesiones activas (para mostrar "N dispositivos vinculados")
export function sessionCount() { const s = sessions(); const now = Date.now(); return Object.values(s).filter((x) => x.expires > now).length }
// REVOCAR TODO: cierra sesión en TODOS los dispositivos (si perdés/robaron un celu). Invalida cada token guardado.
export function logoutAll() { _sess = {}; persist(); return { ok: true } }
// cierra TODAS las sesiones MENOS la actual (para changePin: revoca dispositivos viejos sin desloguear a quien hace el cambio)
export function logoutOthers(keepToken) { const s = sessions(); for (const t of Object.keys(s)) if (t !== keepToken) delete s[t]; persist(); return { ok: true } }
