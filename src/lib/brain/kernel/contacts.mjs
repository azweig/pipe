// brain/kernel/contacts — datos de contacto/avatar (fs JSON) + resolvers compuestos (contactName/threadName/photoFor).
// Depende de keys (puro) + vault + threads-repo. Los readFileSync viven ACÁ, no en keys → keys queda puro.
import { existsSync, readFileSync, statSync } from "fs"
import { phoneOf } from "../../thread.mjs"
import { owner } from "../../hub.mjs"
import { norm, digitsOf, canonOfKey, jidOfKey, stripWA } from "./keys.mjs"
import { peopleNodes } from "./vault.mjs"
import { topInboundNames } from "../../db.mjs"

export const jf = (f) => (existsSync(`./data/${f}`) ? JSON.parse(readFileSync(`./data/${f}`, "utf8")) : null)
export const idmap = () => jf("identity-map.json") || {}
export const aliases = () => jf("aliases.json") || { people: {}, companies: {} }
export const waGroups = () => jf("wa-groups.json") || {}
export const avatarMap = () => (existsSync("./auth/avatars.json") ? JSON.parse(readFileSync("./auth/avatars.json", "utf8")) : {})

// agenda del teléfono: número (solo dígitos) → nombre. Cache por mtime.
let _contacts = null, _contactsMtime = 0
export function contactsMap() {
  const f = "./data/contacts-map.json"; if (!existsSync(f)) return {}
  const m = statSync(f).mtimeMs; if (_contacts && m === _contactsMtime) return _contacts
  _contacts = JSON.parse(readFileSync(f, "utf8")); _contactsMtime = m; return _contacts
}
// usa phoneOf de thread.mjs → resuelve también LIDs (@lid / número crudo) a su teléfono real
export function contactName(jidOrNum) { const n = phoneOf(jidOrNum) || (digitsOf(jidOrNum).length >= 8 ? digitsOf(jidOrNum) : null); return n ? (contactsMap()[n] || null) : null }
// foto de un contacto: por nombre, o por cualquier alias manual que apunte a ese nombre (ej: "Ana García" → "Ana C. García")
export function photoFor(name, jid, threadKey) {
  const AV = avatarMap()
  if (AV[norm(name)]) return AV[norm(name)]
  const man = jf("identity-manual.json") || {}
  for (const [alias, canon] of Object.entries(man)) if (canon === name && AV[norm(alias)]) return AV[norm(alias)]
  const cn = jid ? contactName(jid) : null // por si el nombre de agenda difiere del alias
  if (cn && AV[norm(cn)]) return AV[norm(cn)]
  // fallback: avatar bajo el nombre de WhatsApp del contacto (difiere del de agenda)
  if (threadKey) { try { for (const x of topInboundNames(threadKey, owner(), { limit: 3 })) { const p = AV[norm(x.name)]; if (p) return p } } catch {} }
  return null
}
// name→canon del grafo (nombres del vault + aliases manuales)
export function nameToCanonMap() {
  const m = {}, al = aliases()
  for (const c of peopleNodes()) { m[c.toLowerCase()] = c; for (const a of al.people?.[c] || []) m[a.toLowerCase()] = c }
  return m
}
export const threadName = (key) => canonOfKey(key) || contactName(jidOfKey(key)) || contactName(key) || stripWA((key || "").replace(/^(whatsapp|email):/, "")) || key
