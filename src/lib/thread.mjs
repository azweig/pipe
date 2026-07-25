// Cálculo de la clave de HILO (conversación), compartido por el ingestor y la app. Debe ser determinístico.
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { myNumbers, myEmails } from "./hub.mjs"

const jf = (f) => (existsSync(`./data/${f}`) ? JSON.parse(readFileSync(`./data/${f}`, "utf8")) : null)
// agenda del teléfono: número → nombre. Unifica el histórico (número) con el bridge/email (nombre).
let _cm = null, _cmM = 0
function contactsMap() { const f = "./data/contacts-map.json"; if (!existsSync(f)) return {}; const m = statSync(f).mtimeMs; if (_cm && m === _cmM) return _cm; _cm = JSON.parse(readFileSync(f, "utf8")); _cmM = m; return _cm }
const digitsOf = (s) => (s || "").replace(/[^\d]/g, "")
// mapa LID → número real (de jid_map de WhatsApp). Resuelve los chats @lid a su teléfono.
let _lid = null, _lidM = 0
function lidMap() { const f = "./data/lid-map.json"; if (!existsSync(f)) return {}; const m = statSync(f).mtimeMs; if (_lid && m === _lidM) return _lid; _lid = JSON.parse(readFileSync(f, "utf8")); _lidM = m; return _lid }
// número real de cualquier identificador WhatsApp (jid @s.whatsapp.net, @lid, sender @whatsapp_<num> o @whatsapp_lid-<lid>)
export function phoneOf(x) {
  const s = String(x || "")
  const map = lidMap()
  // LID explícito (@lid, lid-<n>) o número crudo que resulta ser un LID conocido
  const lid = s.match(/(?:lid[-_]?)(\d{6,})/i)?.[1] || (/@lid\b/.test(s) ? digitsOf(s.split("@")[0]) : null)
  if (lid) return map[lid] || null // es LID: si está en el mapa → número real; si no, no es teléfono
  // local-part del número: jid "<num>@s.whatsapp.net" (antes del @) o ghost del bridge matrix "@red_<num>:server" (después de red_).
  // OJO: los senders del bridge EMPIEZAN con @, así que split("@")[0] daría "" — hay que quitar el prefijo "@red_" primero.
  const local = s.startsWith("@") ? s.replace(/^@\w+?_/, "").split(":")[0] : s.split("@")[0]
  const n = digitsOf(local)
  if (map[n]) return map[n] // número crudo que en realidad es un LID (senders del histórico guardados sin @lid)
  return n.length >= 8 ? n : null
}
export function contactName(x) { const n = phoneOf(x) || (digitsOf(x).length >= 8 ? digitsOf(x) : null); return n ? (contactsMap()[n] || null) : null }

// ¿un nombre EXTIENDE al otro con apellido? (superset real: "Carlos Mendoza" ⊃ "Carlos"). Devuelve FALSE para dos nombres de
// pila IDÉNTICOS ("Diego" vs "Diego") → son homónimos, personas distintas. Evita fusionar contactos que solo comparten el 1er nombre.
export function nameExtends(a, b) {
  a = String(a || "").trim().toLowerCase(); b = String(b || "").trim().toLowerCase()
  if (!a || !b || a === b) return false
  return a.startsWith(b + " ") || b.startsWith(a + " ")
}
// identidades MANUALES (verdad del usuario): email/número/jid → nombre canónico. Máxima prioridad. Base del "es la misma persona".
let _man = null, _manM = 0
function manualId() { const f = "./data/identity-manual.json"; if (!existsSync(f)) return {}; const m = statSync(f).mtimeMs; if (_man && m === _manM) return _man; _man = JSON.parse(readFileSync(f, "utf8")); _manM = m; return _man }
export function manualCanon(e) {
  const man = manualId(); if (!Object.keys(man).length) return null
  for (const v of [e.jid, e.sender, (e.name || "").toLowerCase()]) { if (v && man[String(v).toLowerCase()]) return man[String(v).toLowerCase()] }
  const n = digitsOf(e.jid); if (n.length >= 8 && man[n]) return man[n]
  return null
}
const idmap = () => jf("identity-map.json") || {}
const aliases = () => jf("aliases.json") || { people: {}, companies: {} }
const channelId = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)
// identidad del dueño desde la config por-hub (data/hub-config.json). Defaults = genéricos → cada instancia define su identidad ahí.
export const MY_NUMBERS = new Set(myNumbers())
export const MY_EMAILS = new Set(myEmails())
const numOf = (jid) => (jid || "").split("@")[0].split(":")[0].split("-")[0]

// un contenedor (grupo/thread/sala/newsletter/broadcast) NUNCA es una persona
export const isContainerJid = (jid) => /@g\.us$|@thread\.v2$|@newsletter$|@broadcast$/.test(jid || "") || /^![^:]+:/.test(jid || "")
export const isGroupJid = (jid) => isContainerJid(jid)
// SELF ("Mis Notas"): de mí para mí, en cualquier combinación → email a una de MIS direcciones, o WhatsApp donde la contraparte es uno de MIS números.
const isSelfThread = (e) => {
  if (e.channel === "email") return MY_EMAILS.has(String(e.jid || "").toLowerCase())
  if (e.channel !== "whatsapp") return false
  if (e.self) return true // self-chat del bridge (sala 1:1 solo con mis ghosts), lo estampa el lector
  const peer = (e.dm && phoneOf(e.dm)) || (!isContainerJid(e.jid) && (phoneOf(e.jid) || phoneOf(e.sender)))
  return !!(peer && MY_NUMBERS.has(peer))
}

let _n2c = null, _n2cMtime = 0
function nameToCanonMap() {
  const al = aliases(), m = {}
  if (existsSync("./vault/People")) for (const f of readdirSync("./vault/People").filter((x) => x.endsWith(".md"))) {
    const c = f.slice(0, -3); m[c.toLowerCase()] = c; for (const a of al.people?.[c] || []) m[(a?.name || a || "").toLowerCase()] = c
  }
  return m
}
function n2c() { const now = Date.now(); if (!_n2c || now - _n2cMtime > 60000) { _n2c = nameToCanonMap(); _n2cMtime = now }; return _n2c }

export function computeThread(e) {
  if ((e.jid || "") === "status@broadcast") return "spam:status"
  if (isSelfThread(e)) return "self" // de mí para mí (cualquier canal/combinación) → "Mis Notas". ANTES del container/dm.
  if (e.channel === "recording") return "self" // grabaciones (Plaud/memos de voz) → tus notas propias (pasan por STT + el pipeline de Notas)
  // DM del bridge Matrix: la sala llega como "!room" (contenedor) pero es 1:1 → el lector estampa e.dm (la contraparte) → keyear por su NÚMERO, no por la sala.
  // OJO: si el mensaje trae `grp` (nombre de grupo), ES un grupo — nunca al DM, aunque el lector haya marcado e.dm por membresía incompleta.
  if (e.channel === "whatsapp" && e.dm && !e.grp) {
    const num = phoneOf(e.dm)
    if (num && !MY_NUMBERS.has(num)) { const man = manualCanon(e); if (man) return man; return contactsMap()[num] || `whatsapp:${num}@s.whatsapp.net` }
  }
  if (isContainerJid(e.jid)) return `${e.channel}:${e.jid}` // grupos/canales quedan en el grupo, no en un hilo personal
  // SMS / Signal: keyear por NÚMERO al MISMO hilo donde vive el WhatsApp 1:1 de ese teléfono (`whatsapp:<num>@s.whatsapp.net`) →
  // SMS + Signal + WhatsApp del mismo número = UNA sola conversación. VA ANTES de manualCanon (que si no los mandaría a un hilo por-nombre aparte).
  if (e.channel === "sms" || e.channel === "signal") {
    const num = phoneOf(e.jid) || (digitsOf(e.jid).length >= 8 ? digitsOf(e.jid) : null)
    if (num && !MY_NUMBERS.has(num)) return `whatsapp:${num}@s.whatsapp.net`
    return `${e.channel}:${e.jid || e.account}`
  }
  const manual = manualCanon(e) // verdad del usuario (email/número/nombre → persona) — máxima prioridad
  if (manual) return manual
  // WhatsApp 1:1: por NÚMERO real (jid, sender del bridge, o LID→número via jid_map). Determinístico → unifica todo lo del mismo teléfono.
  if (e.channel === "whatsapp") {
    const num = phoneOf(e.jid) || phoneOf(e.sender) || null
    const canon = (num && contactsMap()[num]) || contactName(e.name)
    if (canon) return canon
    if (num) return `whatsapp:${num}@s.whatsapp.net` // sin nombre en agenda, pero unificado por número
    return `whatsapp:${e.jid || e.account}`
  }
  // Email: SIEMPRE por la dirección del contraparte (jid). NO usar el grafo (hace merges erróneos: "Sofía Vega" ≠ "Informacion Mensual").
  if (e.channel === "email") {
    const addr = (e.jid || "").toLowerCase().trim()
    return addr ? `email:${addr}` : `email:${e.account}`
  }
  return `${e.channel}:${e.jid || e.account}`
}
