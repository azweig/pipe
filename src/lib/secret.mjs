// 🔒 CUENTAS SECRETAS — 2º PIN + sesión secreta + marca de cuenta. FASE 1 (cimientos).
// Modelo: hay UN PIN de entrada a la app (auth.mjs) y un 2º PIN OPCIONAL para "cuentas secretas". Las cuentas marcadas como secretas
// (un WhatsApp, un mail, etc.) y TODOS sus mensajes NO existen en ningún lado (bandeja, config, push, búsqueda, IA, contadores, piloto)
// hasta que se verifica el 2º PIN → se emite un token de sesión secreta CORTO (sliding, 5 min) POR DISPOSITIVO. El cliente además borra
// todo al perder foco (blur/segundo plano/refresh) y no persiste nada en local. Enforcement en el SERVIDOR (no solo en la UI).
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "fs"
import { randomBytes, scryptSync, timingSafeEqual } from "crypto"
import { verifyPin as verifyMainPin, rateLimitedScoped, recordFailScoped, clearFailsScoped } from "./auth.mjs"
import { handle } from "./db-core.mjs"
import { computeThread } from "./thread.mjs" // el jsonl crudo no trae `thread`: lo calcula la ingesta

const PIN_FILE = "./data/secret-pin.json"       // hash scrypt+salt del 2º PIN (gitignore como todo data/)
const ACC_FILE = "./data/secret-accounts.json"  // qué cuentas son secretas: [{channel, account}]  (email=por-cuenta; msgs=por-red channel:*)
const THR_FILE = "./data/secret-threads.json"   // qué HILOS puntuales son secretos: ["<thread key>"]  (WhatsApp/Telegram: se marca la CONVERSACIÓN)
const SECRET_TTL = 5 * 60000                     // sesión secreta = 5 min (sliding). Corta a propósito: privacidad > comodidad.

// Un archivo AUSENTE es normal (todavía no marcaste nada) → default. Un archivo PRESENTE PERO ILEGIBLE es una falla, y
// devolver el default ahí es fallar ABIERTO: si secret-numbers.json se corta a la mitad, listSecretNumbers() da [] y
// NADA vuelve a ser secreto — sin error, sin log, y sin el límite de 15s del cache. Ahora se distingue y se grita.
// Un archivo AUSENTE es normal (todavía no marcaste nada) → default, sin ruido.
// Un archivo PRESENTE PERO ILEGIBLE es una FALLA: devolver el default ahí sería fallar ABIERTO (nada sería secreto nunca
// más, en silencio). Tampoco lanzamos: probamos lanzar y fue peor — las llamadas viven fuera del try del gate, así que la
// excepción atravesaba todo, tiraba /api entero con 500 y los catch{} de ask/inbox/autopilot se la comían igual.
// En su lugar levantamos una BANDERA que el gate convierte en "ocultá todo" (ver secretGate).
let _marcasIlegibles = null // null = todo bien · string = qué archivo falló
const loadJ = (f, d) => {
  if (!existsSync(f)) return d
  try { const v = JSON.parse(readFileSync(f, "utf8")); if (_marcasIlegibles === f) _marcasIlegibles = null; return v } catch (e) {
    if (_marcasIlegibles !== f) console.error(`[secret] ${f} ilegible (${e?.message || e}) — oculto TODO hasta poder leerlo.`)
    _marcasIlegibles = f
    return d
  }
}
export function secretMarksBroken() { return _marcasIlegibles }
// Escritura ATÓMICA (tmp + rename): un corte a mitad de writeFileSync dejaba el JSON truncado, que es justo el caso de arriba.
const saveJ = (f, v) => { const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 }); renameSync(tmp, f) } // 600: hash y flags no legibles por otros users del box

// ── 2º PIN ──
export function secretPinSet() { return existsSync(PIN_FILE) }
// setear/cambiar el 2º PIN. Exige 6-12 dígitos (igual que el principal) y que sea DISTINTO del PIN de entrada (si no, no aísla nada).
// `oldPin` es OBLIGATORIO si ya hay un PIN puesto. Antes no se pedía: cualquiera con la sesión principal lo redefinía en un
// POST y veía todo lo oculto — y el modelo de amenaza de esta función es EXACTAMENTE ese (alguien con tu teléfono
// desbloqueado, tu pareja, tu socio). El PIN de entrada sí exigía el anterior desde siempre; este no. Ahora sí.
export function setSecretPin(pin, oldPin, ip = "") {
  if (secretPinSet()) {
    // MISMO límite que unlockSecret: sin esto el endpoint era un oráculo de fuerza bruta a ~28ms por intento (≈4h para
    // 6 dígitos), y peor: como cada intento fallido revelaba si el candidato era el PIN PRINCIPAL, se podía encadenar
    // para recuperarlo, saltando el rate-limit que changePin sí tiene.
    if (rateLimitedScoped("secret", ip)) return { error: "Demasiados intentos fallidos. Esperá 15 minutos." }
    if (!verifySecretPin(String(oldPin || ""))) recordFailScoped("secret", ip)
    // Si lo olvidaste no hay puerta trasera A PROPÓSITO (una la usaría cualquiera que tenga tu sesión abierta, que es
    // justo de quien esto te protege). La salida es borrar data/secret-pin.json desde el servidor.
    if (!verifySecretPin(String(oldPin || ""))) return { error: "Para cambiar el PIN secreto tenés que poner el actual. Si lo olvidaste, borrá data/secret-pin.json en tu servidor." }
  }
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
// `ip` para el rate-limit. No tenía NINGUNO: con la sesión principal ya abierta (que es justo el escenario que esta función
// existe para cubrir), 6 dígitos sin freno se rompen a fuerza bruta en minutos. El PIN de entrada lo tiene desde siempre.
export function unlockSecret(pin, ip = "") {
  if (!secretPinSet()) return { error: "no hay PIN secreto configurado" }
  if (rateLimitedScoped("secret", ip)) return { error: "Demasiados intentos fallidos. Esperá 15 minutos." }
  if (!verifySecretPin(pin)) { recordFailScoped("secret", ip); return { error: "PIN incorrecto" } }
  clearFailsScoped("secret", ip) // al acertar se limpia, igual que el login principal (si no, 4 fallos viejos te bloqueaban después)
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
let _accs = { ts: 0, val: null }
export function listSecretAccounts() { const now = Date.now(); if (_accs.val && now - _accs.ts < 15000) return _accs.val; _accs = { ts: now, val: loadJ(ACC_FILE, []) }; return _accs.val }
// ¿este (channel, account) de un mensaje cae en una cuenta secreta? (exacto O comodín de red channel:*)
export function isSecretAccount(channel, account) {
  const set = secretAccountSet()
  return set.has(accKey(channel, account)) || set.has(String(channel || "").toLowerCase() + ":*")
}
export function setSecretAccount(channel, account, secret) {
  const list = listSecretAccounts().filter((a) => accKey(a.channel, a.account) !== accKey(channel, account))
  if (secret) list.push({ channel: String(channel || "").toLowerCase(), account: String(account || "") })
  saveJ(ACC_FILE, list)
  _g = { ts: 0, val: null }; _jo = { ts: 0, map: null }; _nums = { ts: 0, val: null }; _accs = { ts: 0, val: null }  // invalida caches del gateo por-canal; NO re-bloquea
  return { ok: true, secret: !!secret }
}
export function secretAccountSet() { return new Set(listSecretAccounts().map((a) => accKey(a.channel, a.account))) }
export const secretKey = accKey

// ── CUENTA SECRETA (automática): marcás UNA cuenta (un número tuyo de WhatsApp, o una cuenta de correo) → TODA su actividad se oculta
// sola, sin marcar conversación por conversación. Para WhatsApp, la "cuenta" es tu NÚMERO owner; todos los rooms/jids donde ese número
// participa (sender o jid) pertenecen a esa cuenta → se ocultan enteros (in+out). Para email, la cuenta es el label (isSecretAccount). ──
const NUM_FILE = "./data/secret-numbers.json" // tus números de WhatsApp marcados como cuenta secreta
// Cache de 15s, igual que el gate. Sin esto isSecretRow() —que corre POR FILA en cada búsqueda— hacía un readFileSync
// + JSON.parse por fila, en el event loop del HTTP: medido, cientos de syscalls por búsqueda.
let _nums = { ts: 0, val: null }
export function listSecretNumbers() { const now = Date.now(); if (_nums.val && now - _nums.ts < 15000) return _nums.val; _nums = { ts: now, val: loadJ(NUM_FILE, []) }; return _nums.val }
export function isSecretNumber(n) { n = String(n || "").replace(/\D/g, ""); return !!n && listSecretNumbers().includes(n) }
export function setSecretNumber(num, secret) {
  num = String(num || "").replace(/\D/g, ""); if (!num) return { error: "número inválido" }
  const list = listSecretNumbers().filter((x) => x !== num)
  if (secret) list.push(num)
  saveJ(NUM_FILE, list)
  _g = { ts: 0, val: null }; _jo = { ts: 0, map: null }; _nums = { ts: 0, val: null }; _accs = { ts: 0, val: null } // invalida caches del gateo por-canal; NO re-bloquea
  return { ok: true, secret: !!secret }
}
// ── OCULTACIÓN POR CANAL (parcial, por-mensaje). CANAL de un mensaje = por qué cuenta tuya entró: email→la cuenta; WhatsApp→tu número
// dueño de esa sala (derivado: tu número —de la config— aparece como participante). Marcás un canal → se ocultan SUS mensajes. Contacto
// con canales mixtos → SIGUE visible mostrando lo no-secreto; 100% secreto → desaparece. Import viejo sin dueño → secreto si el hilo
// tiene un canal secreto de WhatsApp (elección del usuario). NADA hardcodeado: los números salen de hub-config.myNumbers. ──
// hub-config.json truncado devolvía [] en silencio → ninguna línea era secreta. La variante que propaga la usa el gate.
function myNumbersOrThrow() { return (JSON.parse(readFileSync("./data/hub-config.json", "utf8")).myNumbers || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean) }
function myNumbers() { try { return (JSON.parse(readFileSync("./data/hub-config.json", "utf8")).myNumbers || []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean) } catch { return [] } }
let _jo = { ts: 0, map: null }
function jidOwnerMap() { // sala(jid) → tu número dueño. Cache 60s.
  const now = Date.now(); if (_jo.map && now - _jo.ts < 60000) return _jo.map
  const map = new Map()
  try { const db = handle(); for (const n of myNumbers()) for (const r of db.prepare("SELECT DISTINCT jid FROM messages WHERE sender LIKE ? AND jid IS NOT NULL AND jid!=''").all("%" + n + "%")) if (!map.has(r.jid)) map.set(r.jid, n) } catch {}
  _jo = { ts: now, map }; return _jo.map
}
// Igual que jidOwnerMap pero PROPAGANDO el error. El catch mudo de arriba hacía que un fallo de DB devolviera un Map vacío
// y el gate se cacheara como SANO durante 15s, con hide vacío: exactamente el leak silencioso que había que cerrar.
function jidOwnerMapOrThrow() {
  const now = Date.now(); if (_jo.map && now - _jo.ts < 60000) return _jo.map
  const map = new Map()
  const db = handle()
  for (const n of myNumbersOrThrow()) for (const r of db.prepare("SELECT DISTINCT jid FROM messages WHERE sender LIKE ? AND jid IS NOT NULL AND jid!=''").all("%" + n + "%")) if (!map.has(r.jid)) map.set(r.jid, n)
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
// Último gate calculado BIEN. Ante un fallo transitorio (SQLITE_BUSY es rutina bajo carga) preferimos seguir usando el
// último bueno antes que dejar la bandeja vacía: oculta lo mismo que hace un rato y no rompe la app.
let _lastGood = null
// FALLO SIN ÚLTIMO BUENO = ocultar TODO. Es la única definición honesta de "falla cerrado": si no podemos calcular qué
// esconder, no mostramos nada en vez de mostrarlo todo. `blockAll` lo respetan los repos, el gate HTTP e isSecretMsg.
//
// `hide` NO puede ser un Set vacío acá: media docena de lectores (bandeja, home, ask, nudges) filtran con `hide.has(key)`
// y un Set vacío les decía "no ocultes nada" — exactamente lo contrario de fallar cerrado. Este Set contesta que SÍ a
// cualquier hilo. Sigue siendo un Set de verdad (vacío al recorrerlo) para no romper a quien lo itere, y `size` es
// positivo porque hay quien lo usa como "¿hay algo que ocultar?".
// ⚠️ TRAMPA: `has()` miente pero RECORRERLO no devuelve nada (es un Set vacío de verdad). Todo el que arme SQL a partir de
// este set —`[...hide]`, `Array.from(hide)`— tiene que preguntar por `blockAll` ANTES, o le sale una cláusula vacía justo
// cuando había que ocultar todo. Lo mismo copiarlo: `new Set([...hide])` pierde el "sí a todo".
class TodoEsSecreto extends Set {
  has() { return true }
  get size() { return Number.MAX_SAFE_INTEGER }
}
const BLOCK_ALL_GATE = () => ({ hide: new TodoEsSecreto(), preview: new Map(), any: true, secretJids: new Set(), waSecretThreads: new Set(), blockAll: true, degraded: true })

export function secretGate() {
  const now = Date.now(); if (_g.val && now - _g.ts < 15000) return _g.val
  // TODAS las lecturas van DENTRO del try. Antes estaban afuera, así que el catch "fail-closed" no las veía nunca —
  // justo el caso que su propio comentario citaba (un fallo de DB al mapear jids) pasaba de largo y el gate quedaba abierto.
  try {
    const secNums = new Set(listSecretNumbers()), secEmailLabels = listSecretAccounts().filter((a) => a.channel === "email" && a.account && a.account !== "*").map((a) => String(a.account).toLowerCase())
    if (_marcasIlegibles) throw new Error(`marcas ilegibles: ${_marcasIlegibles}`) // no sabemos qué ocultar → ocultamos todo
    if (!secNums.size && !secEmailLabels.length) { _g = { ts: now, val: EMPTY_GATE() }; return _g.val }
    const jo = jidOwnerMapOrThrow()
  const secretJids = [], nonSecretJids = []
  for (const [jid, owner] of jo) (secNums.has(owner) ? secretJids : nonSecretJids).push(jid)
  const IN = (a) => a.map(() => "?").join(",")
  const hide = new Set(), preview = new Map(), waSecretThreads = new Set()
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
    _lastGood = { hide, preview, any: true, secretJids: new Set(secretJids), waSecretThreads }
    _g = { ts: now, val: _lastGood }
    return _g.val
  } catch (e) {
    // No pudimos calcular el gate. Si tenemos uno bueno reciente, lo seguimos usando (un SQLITE_BUSY no debe vaciarte la
    // bandeja). Si NUNCA calculamos uno, ocultamos todo: preferimos una bandeja vacía y ruidosa antes que filtrar.
    console.error("[secret] no pude calcular el gate:", e?.message || e, _lastGood ? "— uso el último cálculo bueno" : "— OCULTO TODO hasta poder calcularlo")
    const val = _lastGood ? { ..._lastGood, degraded: true } : BLOCK_ALL_GATE()
    _g = { ts: now, val } // cachear 15s TAMBIÉN en degradado: sin esto se recomputaba por request Y por fila filtrada,
    return val            // y con busy_timeout cada recómputo bloquea → un lock momentáneo se volvía un stall total.
  }
}
// hilos que se ocultan ENTEROS (100% secretos). Los parciales NO están acá (se muestran filtrados por-mensaje).
export function secretThreadKeys() { return secretGate().hide }
// ¿ESTE mensaje es secreto? por CANAL: email de cuenta secreta, o WhatsApp de sala secreta, o import sin dueño en un hilo con canal secreto de WA.
export function isSecretMsg(m) {
  if (!m) return false
  if (secretGate().blockAll) return true // no sabemos qué es secreto → todo lo es (fail-closed)
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
  if (secretGate().blockAll) return { clause: "1=1", params: [] } // 🔒 sin poder calcular qué es secreto, TODA fila lo es
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
  if (secretGate().blockAll) return { clause: "1=1", params: [] } // 🔒 ídem: se excluye todo, no nada
  const jids = [...secretGate().secretJids], hide = [...secretThreadKeys()]
  const emails = listSecretAccounts().filter((a) => a.channel === "email" && a.account && a.account !== "*").map((a) => String(a.account).toLowerCase())
  const parts = [], params = []
  if (jids.length) { parts.push(`jid IN (${jids.map(() => "?").join(",")})`); params.push(...jids) }
  if (emails.length) { parts.push(`(channel='email' AND lower(account) IN (${emails.map(() => "?").join(",")}))`); params.push(...emails) }
  if (hide.length) { parts.push(`thread IN (${hide.map(() => "?").join(",")})`); params.push(...hide) }
  return parts.length ? { clause: parts.join(" OR "), params } : { clause: null, params: [] }
}
// 🔒 ¿esta línea CRUDA de data/messages.jsonl es de fuente secreta?
// Tres procesos leen ese archivo directo, salteándose la DB y todos sus filtros: el indexador del RAG, `learn` (que le manda
// 500 mensajes al LLM y escribe vault/_Brain) y `graphify` (que escribe vault/People). El jsonl NO trae `thread` — lo calcula
// la ingesta — y sin hilo no se ve el caso del import viejo, donde el número secreto vive SOLO en la clave del hilo.
// Ante cualquier duda devuelve true: preferimos no aprender de un mensaje a escribirlo en una nota que después se sincroniza.
let _jsonlIndeciso = false
// ¿alguna vez, en este proceso, NO se pudo decidir? Ojo: no alcanza con mirar secretGate(), porque computeThread lee sus
// propios mapas de contactos y un JSON roto ahí tira una excepción con el gate perfectamente sano — y entonces esto marca
// TODO como secreto. Quien tome decisiones irreversibles con este resultado (graphify avanza un offset) tiene que preguntar.
export function secretJsonlIndeciso() { return _jsonlIndeciso }
export function isSecretJsonl(r) {
  if (!r) return false
  try { return isSecretRow({ ...r, thread: r.thread || computeThread(r) }) } catch (e) {
    if (!_jsonlIndeciso) console.error("[secret] no pude calcular el hilo de una línea del jsonl:", e?.message || e, "— la doy por secreta")
    _jsonlIndeciso = true
    return true
  }
}
// no-leídos de hilos 100% secretos (para restar del contador). Los parciales no se restan (over-count menor, no filtra contenido).
export function secretUnread() {
  const keys = secretThreadKeys(); if (!keys.size) return 0
  try { const db = handle(); const rows = db.prepare("SELECT thread, unread FROM thread_stats").all(); return rows.filter((r) => keys.has(r.thread)).reduce((a, r) => a + (r.unread || 0), 0) } catch { return 0 }
}
