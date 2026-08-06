// 🔒 CUENTAS SECRETAS — 2º PIN + sesión secreta + marca de cuenta. FASE 1 (cimientos).
// Modelo: hay UN PIN de entrada a la app (auth.mjs) y un 2º PIN OPCIONAL para "cuentas secretas". Las cuentas marcadas como secretas
// (un WhatsApp, un mail, etc.) y TODOS sus mensajes NO existen en ningún lado (bandeja, config, push, búsqueda, IA, contadores, piloto)
// hasta que se verifica el 2º PIN → se emite un token de sesión secreta CORTO (sliding, 5 min) POR DISPOSITIVO. El cliente además borra
// todo al perder foco (blur/segundo plano/refresh) y no persiste nada en local. Enforcement en el SERVIDOR (no solo en la UI).
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs"
import { randomBytes, scryptSync, timingSafeEqual } from "crypto"
import { verifyPin as verifyMainPin } from "./auth.mjs"
import { handle } from "./db-core.mjs"

const PIN_FILE = "./data/secret-pin.json"       // hash scrypt+salt del 2º PIN (gitignore como todo data/)
const ACC_FILE = "./data/secret-accounts.json"  // qué cuentas son secretas: [{channel, account}]  (email=por-cuenta; msgs=por-red channel:*)
const THR_FILE = "./data/secret-threads.json"   // qué HILOS puntuales son secretos: ["<thread key>"]  (WhatsApp/Telegram: se marca la CONVERSACIÓN)
const SECRET_TTL = 5 * 60000                     // sesión secreta = 5 min (sliding). Corta a propósito: privacidad > comodidad.

const loadJ = (f, d) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : d } catch { return d } }
const saveJ = (f, v) => writeFileSync(f, JSON.stringify(v), { mode: 0o600 }) // 600: hash y flags no legibles por otros users del box

// ── 2º PIN ──
export function secretPinSet() { return existsSync(PIN_FILE) }
// setear/cambiar el 2º PIN. Exige 6-12 dígitos (igual que el principal) y que sea DISTINTO del PIN de entrada (si no, no aísla nada).
export function setSecretPin(pin) {
  if (!/^\d{6,12}$/.test(String(pin || ""))) return { error: "El PIN secreto debe tener entre 6 y 12 dígitos." }
  if (verifyMainPin(String(pin))) return { error: "El PIN secreto tiene que ser DISTINTO del PIN de entrada." }
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(String(pin), salt, 64).toString("hex")
  saveJ(PIN_FILE, { salt, hash })
  return { ok: true }
}
export function verifySecretPin(pin) {
  const p = loadJ(PIN_FILE, null); if (!p) return false
  const h = scryptSync(String(pin || ""), p.salt, 64)
  const stored = Buffer.from(p.hash, "hex")
  return h.length === stored.length && timingSafeEqual(h, stored) // timing-safe
}
// borrar el 2º PIN (lo usa el flujo de reset y al desactivar la función). También cierra TODAS las sesiones secretas.
export function clearSecretPin() { try { if (existsSync(PIN_FILE)) unlinkSync(PIN_FILE) } catch {} ; _sess.clear(); return { ok: true } }

// ── sesión secreta (SOLO en memoria; nunca a disco → un reinicio del server re-bloquea todo) ──
// token aleatorio de 256 bits; expira a los 5 min de inactividad. validSecretSession DESLIZA la expiración en cada uso (actividad).
const _sess = new Map() // token -> expiresAt
export function unlockSecret(pin) {
  if (!secretPinSet()) return { error: "no hay PIN secreto configurado" }
  if (!verifySecretPin(pin)) return { error: "PIN incorrecto" }
  const token = randomBytes(32).toString("hex")
  _sess.set(token, Date.now() + SECRET_TTL)
  return { ok: true, token, ttl: SECRET_TTL }
}
export function validSecretSession(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false
  const exp = _sess.get(token)
  if (!exp || exp < Date.now()) { if (exp) _sess.delete(token); return false }
  _sess.set(token, Date.now() + SECRET_TTL) // sliding: cada request válido corre la expiración 5 min más
  return true
}
export function lockSecret(token) { if (token) _sess.delete(token) }         // botón "Ocultar" / blur del cliente
export function lockAllSecret() { _sess.clear() }                            // pánico / cambio de PIN

// ── marca de cuenta secreta ──
// Modelo: EMAIL es por-cuenta (account = label limpio: gmail-personal, outlook…). MENSAJERÍA (whatsapp/telegram/…) es por-RED
// completa, porque el `account` de esos mensajes es la fuente de ingesta (history/matrix/wa1…), no una cuenta → se marca con account="*".
const accKey = (channel, account) => `${String(channel || "").toLowerCase()}:${String(account || "").toLowerCase()}`
export function listSecretAccounts() { return loadJ(ACC_FILE, []) }
// ¿este (channel, account) de un mensaje cae en una cuenta secreta? (exacto O comodín de red channel:*)
export function isSecretAccount(channel, account) {
  const set = secretAccountSet()
  return set.has(accKey(channel, account)) || set.has(String(channel || "").toLowerCase() + ":*")
}
export function setSecretAccount(channel, account, secret) {
  const list = listSecretAccounts().filter((a) => accKey(a.channel, a.account) !== accKey(channel, account))
  if (secret) list.push({ channel: String(channel || "").toLowerCase(), account: String(account || "") })
  saveJ(ACC_FILE, list)
  _g = { ts: 0, val: null }; _jo = { ts: 0, map: null }  // invalida caches del gateo por-canal; NO re-bloquea
  return { ok: true, secret: !!secret }
}
export function secretAccountSet() { return new Set(listSecretAccounts().map((a) => accKey(a.channel, a.account))) }
export const secretKey = accKey

// ── CUENTA SECRETA (automática): marcás UNA cuenta (un número tuyo de WhatsApp, o una cuenta de correo) → TODA su actividad se oculta
// sola, sin marcar conversación por conversación. Para WhatsApp, la "cuenta" es tu NÚMERO owner; todos los rooms/jids donde ese número
// participa (sender o jid) pertenecen a esa cuenta → se ocultan enteros (in+out). Para email, la cuenta es el label (isSecretAccount). ──
const NUM_FILE = "./data/secret-numbers.json" // tus números de WhatsApp marcados como cuenta secreta
export function listSecretNumbers() { return loadJ(NUM_FILE, []) }
export function isSecretNumber(n) { n = String(n || "").replace(/\D/g, ""); return !!n && listSecretNumbers().includes(n) }
export function setSecretNumber(num, secret) {
  num = String(num || "").replace(/\D/g, ""); if (!num) return { error: "número inválido" }
  const list = listSecretNumbers().filter((x) => x !== num)
  if (secret) list.push(num)
  saveJ(NUM_FILE, list)
  _g = { ts: 0, val: null }; _jo = { ts: 0, map: null } // invalida caches del gateo por-canal; NO re-bloquea
  return { ok: true, secret: !!secret }
}
// ── OCULTACIÓN POR CANAL (parcial, por-mensaje). CANAL de un mensaje = por qué cuenta tuya entró: email→la cuenta; WhatsApp→tu número
// dueño de esa sala (derivado: tu número —de la config— aparece como participante). Marcás un canal → se ocultan SUS mensajes. Contacto
// con canales mixtos → SIGUE visible mostrando lo no-secreto; 100% secreto → desaparece. Import viejo sin dueño → secreto si el hilo
// tiene un canal secreto de WhatsApp (elección del usuario). NADA hardcodeado: los números salen de hub-config.myNumbers. ──
function myNumbers() { try { return (JSON.parse(readFileSync("./data/hub-config.json", "utf8")).myNumbers || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean) } catch { return [] } }
let _jo = { ts: 0, map: null }
function jidOwnerMap() { // sala(jid) → tu número dueño. Cache 60s.
  const now = Date.now(); if (_jo.map && now - _jo.ts < 60000) return _jo.map
  const map = new Map()
  try { const db = handle(); for (const n of myNumbers()) for (const r of db.prepare("SELECT DISTINCT jid FROM messages WHERE sender LIKE ? AND jid IS NOT NULL AND jid!=''").all("%" + n + "%")) if (!map.has(r.jid)) map.set(r.jid, n) } catch {}
  _jo = { ts: now, map }; return _jo.map
}
// ¿la CLAVE del hilo es un DM 1:1 (no grupo) cuyo número es una cuenta secreta? Cubre imports viejos con jid="" donde el número
// SOLO vive en la clave (whatsapp:<num>@s.whatsapp.net / @c.us / whatsapp:<num>). Los grupos (@g.us) NO se ocultan por esto.
function secretNumberInDMKey(key) {
  key = String(key || "")
  if (/@g\.us|@newsletter|@broadcast|@thread\.v2|:!/.test(key)) return false // grupo/canal/sala → NO
  if (!/@s\.whatsapp\.net$|@c\.us$/.test(key) && !/^whatsapp:\d+$/.test(key)) return false // solo DM 1:1
  const digits = key.replace(/\D/g, "")
  return !!digits && listSecretNumbers().includes(digits)
}
let _g = { ts: 0, val: null }
const EMPTY_GATE = () => ({ hide: new Set(), preview: new Map(), any: false, secretJids: new Set(), waSecretThreads: new Set() })
export function secretGate() {
  const now = Date.now(); if (_g.val && now - _g.ts < 15000) return _g.val
  const secNums = new Set(listSecretNumbers()), secEmailLabels = listSecretAccounts().filter((a) => a.channel === "email" && a.account && a.account !== "*").map((a) => String(a.account).toLowerCase())
  if (!secNums.size && !secEmailLabels.length) { _g = { ts: now, val: EMPTY_GATE() }; return _g.val }
  const jo = jidOwnerMap()
  const secretJids = [], nonSecretJids = []
  for (const [jid, owner] of jo) (secNums.has(owner) ? secretJids : nonSecretJids).push(jid)
  const IN = (a) => a.map(() => "?").join(",")
  const hide = new Set(), preview = new Map(), waSecretThreads = new Set()
  try {
    const db = handle()
    // condición SECRETO: whatsapp de sala secreta, o email de cuenta secreta
    const sParts = [], sParams = []
    if (secretJids.length) { sParts.push(`jid IN (${IN(secretJids)})`); sParams.push(...secretJids) }
    if (secEmailLabels.length) { sParts.push(`(channel='email' AND lower(account) IN (${IN(secEmailLabels)}))`); sParams.push(...secEmailLabels) }
    if (sParts.length) {
      const secretThreads = new Set(db.prepare(`SELECT DISTINCT thread FROM messages WHERE ${sParts.join(" OR ")}`).all(...sParams).map((r) => r.thread))
      if (secretJids.length) for (const r of db.prepare(`SELECT DISTINCT thread FROM messages WHERE jid IN (${IN(secretJids)})`).all(...secretJids)) waSecretThreads.add(r.thread)
      if (secretThreads.size) {
        // condición NO-SECRETO (canal conocido no marcado): whatsapp de sala no-secreta, o email de cuenta NO secreta
        const nParts = [], nParams = []
        if (nonSecretJids.length) { nParts.push(`jid IN (${IN(nonSecretJids)})`); nParams.push(...nonSecretJids) }
        nParts.push(secEmailLabels.length ? `(channel='email' AND lower(account) NOT IN (${IN(secEmailLabels)}))` : `channel='email'`)
        if (secEmailLabels.length) nParams.push(...secEmailLabels)
        const st = [...secretThreads]
        const withNS = new Set(db.prepare(`SELECT DISTINCT thread FROM messages WHERE thread IN (${IN(st)}) AND (${nParts.join(" OR ")})`).all(...st, ...nParams).map((r) => r.thread))
        const lastNS = db.prepare(`SELECT text, ts, channel, media, mediaType FROM messages WHERE thread=? AND (${nParts.join(" OR ")}) ORDER BY ts DESC LIMIT 1`)
        for (const t of secretThreads) {
          if (!withNS.has(t)) { hide.add(t); continue }                    // sin ningún canal no-secreto → 100% secreto → ocultar entero
          try { const m = lastNS.get(t, ...nParams); if (m) preview.set(t, m) } catch {} // parcial → preview del último NO-secreto
        }
      }
    }
    // DM 1:1 cuya CLAVE es un número secreto (imports viejos con jid="" donde el número solo vive en la clave) → ocultar entero.
    // Patrón 'whatsapp:<num>@%' matchea el DM (whatsapp:<num>@s.whatsapp.net) y NO el grupo (whatsapp:<num>-<ts>@g.us). Usa el índice de thread.
    for (const n of secNums) for (const r of db.prepare("SELECT DISTINCT thread FROM messages WHERE thread LIKE ? OR thread = ?").all(`whatsapp:${n}@%`, `whatsapp:${n}`)) if (secretNumberInDMKey(r.thread) && !preview.has(r.thread)) hide.add(r.thread)
  } catch {}
  _g = { ts: now, val: { hide, preview, any: true, secretJids: new Set(secretJids), waSecretThreads } }
  return _g.val
}
// hilos que se ocultan ENTEROS (100% secretos). Los parciales NO están acá (se muestran filtrados por-mensaje).
export function secretThreadKeys() { return secretGate().hide }
// ¿ESTE mensaje es secreto? por CANAL: email de cuenta secreta, o WhatsApp de sala secreta, o import sin dueño en un hilo con canal secreto de WA.
export function isSecretMsg(m) {
  if (!m) return false
  if (secretNumberInDMKey(String(m.thread || ""))) return true // DM 1:1 con un número secreto (incluye imports viejos con jid="")
  if (String(m.channel) === "email") return isSecretAccount("email", m.account)
  const g = secretGate(); const jid = String(m.jid || "")
  if (g.secretJids.has(jid)) return true
  if (!jidOwnerMap().has(jid)) return g.waSecretThreads.has(String(m.thread || "")) // import sin atribuir
  return false
}
// helper de conveniencia para superficies DERIVADAS (home/coach/search/people/espacios): ¿este row es de fuente secreta?
// Cubre hilo 100%-secreto (thread en hide) Y mensaje parcial (isSecretMsg). El row debe traer thread y, si es msg, channel/account/jid.
export function isSecretRow(r) { if (!r) return false; return secretThreadKeys().has(String(r.thread || "")) || isSecretMsg(r) }
// ESTRICTO para "Mis Notas" (thread='self', hilo mezcla de todos tus números): oculta una nota SOLO si ESE mensaje vino de un canal
// secreto (jid de número secreto o email de cuenta secreta). NO usa la rama waSecretThreads (evita nukear todas las notas si una
// self-DM secreta cae en 'self'). Requiere channel/account/jid en el row.
export function isSecretSelfNote(r) {
  if (!r) return false
  if (String(r.channel) === "email") return isSecretAccount("email", r.account)
  return secretGate().secretJids.has(String(r.jid || ""))
}
// fragmento SQL "ESTE row (alias.jid / alias.channel+account) es de canal secreto", para excluir self-notes secretas en agregados
// (categorías, conteos) sin traer columnas extra a JS. Devuelve {clause,params} o {clause:null} si no hay nada marcado.
export function secretSelfClause(alias = "m") {
  const jids = [...secretGate().secretJids]
  const emails = listSecretAccounts().filter((a) => a.channel === "email" && a.account && a.account !== "*").map((a) => String(a.account).toLowerCase())
  const parts = [], params = []
  if (jids.length) { parts.push(`${alias}.jid IN (${jids.map(() => "?").join(",")})`); params.push(...jids) }
  if (emails.length) { parts.push(`(${alias}.channel='email' AND lower(${alias}.account) IN (${emails.map(() => "?").join(",")}))`); params.push(...emails) }
  return parts.length ? { clause: parts.join(" OR "), params } : { clause: null, params: [] }
}
// fragmento SQL para EXCLUIR mensajes secretos en agregados cross-hilo (espacios): jid de número secreto, email de cuenta secreta,
// o hilo 100%-secreto. Sin la rama import/waSecretThreads (evita sub-contar mensajes NO-secretos de un hilo parcial). {clause,params} o null.
export function secretMsgExcludeSql() {
  const jids = [...secretGate().secretJids], hide = [...secretThreadKeys()]
  const emails = listSecretAccounts().filter((a) => a.channel === "email" && a.account && a.account !== "*").map((a) => String(a.account).toLowerCase())
  const parts = [], params = []
  if (jids.length) { parts.push(`jid IN (${jids.map(() => "?").join(",")})`); params.push(...jids) }
  if (emails.length) { parts.push(`(channel='email' AND lower(account) IN (${emails.map(() => "?").join(",")}))`); params.push(...emails) }
  if (hide.length) { parts.push(`thread IN (${hide.map(() => "?").join(",")})`); params.push(...hide) }
  return parts.length ? { clause: parts.join(" OR "), params } : { clause: null, params: [] }
}
// no-leídos de hilos 100% secretos (para restar del contador). Los parciales no se restan (over-count menor, no filtra contenido).
export function secretUnread() {
  const keys = secretThreadKeys(); if (!keys.size) return 0
  try { const db = handle(); const rows = db.prepare("SELECT thread, unread FROM thread_stats").all(); return rows.filter((r) => keys.has(r.thread)).reduce((a, r) => a + (r.unread || 0), 0) } catch { return 0 }
}
