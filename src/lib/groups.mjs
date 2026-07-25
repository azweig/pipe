// Grupos de la Bandeja (unifica los auto-cats editables + grupos propios). Store liviano en data/groups.json.
// Auto-grupos (familia/amigos/trabajo/grupos) = la IA los llena sola por relación; el usuario puede renombrarlos u ocultarlos.
// Grupos custom = el usuario los crea y les asigna contactos (por key). Un hilo pertenece a: su auto-cat + los custom que lo incluyan.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs"

const FILE = "./data/groups.json"
const AUTO = [ // orden y labels por defecto (editables)
  { id: "familia", name: "Familia", icon: "👨‍👩‍👧" },
  { id: "amigos", name: "Amigos", icon: "🧑‍🤝‍🧑" },
  { id: "trabajo", name: "Trabajo", icon: "💼" },
  { id: "grupos", name: "Grupos", icon: "👥" },
]
const AUTO_IDS = new Set(AUTO.map((a) => a.id))

function read() { try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {} } catch { return {} } }
function write(c) { mkdirSync("./data", { recursive: true }); const t = FILE + ".tmp"; writeFileSync(t, JSON.stringify(c, null, 2)); renameSync(t, FILE) }

// lista de grupos resuelta para la UI (auto con overrides + custom), en orden.
export function listGroups() {
  const c = read(), ov = c.overrides || {}, custom = Array.isArray(c.custom) ? c.custom : []
  const auto = AUTO.filter((a) => !(ov[a.id] && ov[a.id].hidden)).map((a) => ({ id: a.id, name: (ov[a.id] && ov[a.id].name) || a.name, icon: (ov[a.id] && ov[a.id].icon) || a.icon, kind: "auto" }))
  const cust = custom.map((g) => ({ id: g.id, name: g.name, icon: g.icon || "🏷️", kind: "custom", count: (g.keys || []).length }))
  const order = Array.isArray(c.order) ? c.order : []
  const all = [...auto, ...cust]
  if (order.length) all.sort((a, b) => { const ia = order.indexOf(a.id), ib = order.indexOf(b.id); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) })
  return all
}
// mapa key→[groupIds custom] para el cliente (así el filtro por tab es client-side)
export function contactGroupsMap() {
  const c = read(), custom = Array.isArray(c.custom) ? c.custom : [], m = {}
  for (const g of custom) for (const k of (g.keys || [])) (m[k] = m[k] || []).push(g.id)
  return m
}
// renombrar/ocultar un auto-grupo
export function setAutoGroup(id, { name, icon, hidden } = {}) {
  if (!AUTO_IDS.has(id)) return { error: "grupo auto desconocido" }
  const c = read(); c.overrides = c.overrides || {}; const o = c.overrides[id] = c.overrides[id] || {}
  if (name !== undefined) o.name = String(name).slice(0, 30).trim() || undefined
  if (icon !== undefined) o.icon = String(icon).slice(0, 8) || undefined
  if (hidden !== undefined) o.hidden = !!hidden
  if (!o.name && !o.icon && !o.hidden) delete c.overrides[id]
  write(c); return { ok: true }
}
// crear / renombrar grupo custom
export function saveGroup({ id, name, icon } = {}) {
  const nm = String(name || "").slice(0, 30).trim(); if (!nm) return { error: "falta nombre" }
  const c = read(); c.custom = Array.isArray(c.custom) ? c.custom : []
  if (id) { const g = c.custom.find((x) => x.id === id); if (g) { g.name = nm; if (icon !== undefined) g.icon = String(icon).slice(0, 8); write(c); return { ok: true, id } } }
  const gid = "g" + Math.abs([...nm].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)).toString(36) + (c.custom.length)
  c.custom.push({ id: gid, name: nm, icon: (icon && String(icon).slice(0, 8)) || "🏷️", keys: [] })
  write(c); return { ok: true, id: gid }
}
export function deleteGroup(id) { const c = read(); c.custom = (c.custom || []).filter((g) => g.id !== id); write(c); return { ok: true } }
// asignar / quitar un contacto (por thread key) de un grupo custom
export function assignContact(key, groupId, on) {
  const c = read(); c.custom = Array.isArray(c.custom) ? c.custom : []; const g = c.custom.find((x) => x.id === groupId); if (!g) return { error: "grupo no existe" }
  g.keys = g.keys || []; const has = g.keys.includes(key)
  if (on && !has) g.keys.push(key); else if (!on && has) g.keys = g.keys.filter((k) => k !== key)
  write(c); return { ok: true }
}
