// Modelo de datos del rediseño: objetivos/KPIs, empresas, espacios anidados, y overrides de contacto (fusión/foto).
// Todo en data/*.json, editable por el usuario Y por la IA. Ver project_pipe_redesign.
import { readFileSync, existsSync, writeFileSync } from "fs"

const load = (f, def) => (existsSync(`./data/${f}`) ? JSON.parse(readFileSync(`./data/${f}`, "utf8")) : def)
const save = (f, v) => writeFileSync(`./data/${f}`, JSON.stringify(v, null, 2))
const uid = () => Math.random().toString(36).slice(2, 9)

// ── EMPRESAS (las agrega el usuario/IA; un hub nuevo arranca SIN empresas → no ve las de nadie más) ──
const SEED_COMPANIES = []
export function companies() {
  let c = load("companies.json", null)
  if (!c) { c = SEED_COMPANIES; save("companies.json", c) }
  return c
}
export function saveCompany(co) {
  const c = companies()
  if (co.id && c.find((x) => x.id === co.id)) { Object.assign(c.find((x) => x.id === co.id), co) }
  else { co.id = co.id || uid(); c.push(co) }
  save("companies.json", c); return co
}
export function deleteCompany(id) { save("companies.json", companies().filter((c) => c.id !== id)) }

// ── OBJETIVOS / KPIs (personales o de una empresa) ──
export function objetivos() { return load("objetivos.json", []) }
export function saveObjetivo(o) {
  const list = objetivos()
  if (o.id && list.find((x) => x.id === o.id)) Object.assign(list.find((x) => x.id === o.id), o)
  else { o.id = o.id || uid(); o.source = o.source || "user"; list.push(o) }
  save("objetivos.json", list); return o
}
export function deleteObjetivo(id) { save("objetivos.json", objetivos().filter((o) => o.id !== id)) }

// ── ESPACIOS ANIDADOS (parent = null es raíz; se ven como contactos en la lista) ──
// hilos fijados arriba de la bandeja (por key). El usuario "pinea" personas/grupos importantes.
export function pins() { return load("pins.json", []) }
export function setPin(key, pinned) {
  let p = pins()
  if (pinned) { if (!p.includes(key)) p.push(key) } else p = p.filter((k) => k !== key)
  save("pins.json", p); return p
}

// archivar hilos (ocultar de la bandeja) + marcar remitentes de email como spam (ese y los futuros)
export function archived() { return load("archived.json", []) }
export function archive(key, on = true) { let a = archived(); if (on) { if (!a.includes(key)) a.push(key) } else a = a.filter((k) => k !== key); save("archived.json", a); return a }
// SILENCIAR: ruido que NO es spam (grupos que no me interesan ahora). NO se ocultan como los archivados: viven en la pestaña "Silenciados".
export function silenced() { return load("silenced.json", []) }
export function silence(key, on = true) { let s = silenced(); if (on) { if (!s.includes(key)) s.push(key) } else s = s.filter((k) => k !== key); save("silenced.json", s); return s }
export function spamSenders() { return load("spam-senders.json", []) }
export function addSpamSender(addr, on = true) { let s = spamSenders(); const a = String(addr || "").toLowerCase().trim(); if (!a) return s; if (on) { if (!s.includes(a)) s.push(a) } else s = s.filter((x) => x !== a); save("spam-senders.json", s); return s }

// ── "ÚLTIMA VEZ VISTO" por hilo (read state) — para ofrecer resumen de lo que me perdí desde la última vez que entré ──
export function seenMap() { return load("seen.json", {}) }
export function lastSeen(key) { return seenMap()[key] || 0 }
export function markSeen(key, ts) {
  const s = seenMap(), t = Number(ts) || 0
  if (t > (s[key] || 0)) { s[key] = t; save("seen.json", s) }
  return s[key] || 0
}

// ── NOTAS DE IA por hilo (resúmenes de chat que la IA genera y quedan GRABADOS para vos — nunca se envían) ──
export function aiNotes(key) { return load("ai-notes.json", {})[key] || [] }
export function addAiNote(key, note) {
  const m = load("ai-notes.json", {})
  m[key] = [...(m[key] || []), { id: "ai:" + uid(), ...note }].slice(-30)
  save("ai-notes.json", m); return m[key]
}

export function espacios() { return load("espacios.json", []) }
export function saveEspacio(e) {
  const list = espacios()
  if (e.id && list.find((x) => x.id === e.id)) Object.assign(list.find((x) => x.id === e.id), e)
  else { e.id = e.id || uid(); e.members = e.members || []; list.push(e) }
  save("espacios.json", list); return e
}
export function deleteEspacio(id) {
  // borra el espacio y re-parenta sus hijos a la raíz
  const list = espacios().filter((e) => e.id !== id).map((e) => (e.parent === id ? { ...e, parent: null } : e))
  save("espacios.json", list)
}
// reglas de pertenencia de un espacio: {type: email|domain|phone|name, value}. Los mensajes que matchean cualquier regla entran al espacio.
export function espacioAddRule(id, rule) {
  const list = espacios(), e = list.find((x) => x.id === id)
  if (!e) return { error: "no existe" }
  const type = ["email", "domain", "phone", "name"].includes(rule?.type) ? rule.type : null
  let value = String(rule?.value || "").trim()
  if (type === "domain") value = value.replace(/^[@*]+/, "").toLowerCase() // "*@colegio.edu.pe" o "@colegio.edu.pe" → "colegio.edu.pe"
  if (type === "email") value = value.toLowerCase()
  if (type === "phone") value = value.replace(/[^\d]/g, "") // solo dígitos
  if (!type || !value) return { error: "regla inválida" }
  e.rules = e.rules || []
  if (!e.rules.some((r) => r.type === type && r.value === value)) e.rules.push({ type, value })
  save("espacios.json", list); return e
}
export function espacioRemoveRule(id, idx) {
  const list = espacios(), e = list.find((x) => x.id === id)
  if (!e) return { error: "no existe" }
  e.rules = (e.rules || []).filter((_, i) => i !== Number(idx))
  save("espacios.json", list); return e
}
// normaliza {type,value} (compartido por reglas y excepciones)
function normRule(rule) {
  const type = ["email", "domain", "phone", "name"].includes(rule?.type) ? rule.type : null
  let value = String(rule?.value || "").trim()
  if (type === "domain") value = value.replace(/^[@*]+/, "").toLowerCase()
  else if (type === "email") value = value.toLowerCase()
  else if (type === "phone") value = value.replace(/[^\d]/g, "")
  return type && value ? { type, value } : null
}
// EXCEPCIONES: {type,value} igual que las reglas, pero SACAN del espacio lo que matchean (aunque cumplan una regla).
// Ej: regla domain "acme.com" + excepción email "ceo@acme.com" → toda la empresa entra menos el CEO.
export function espacioAddException(id, rule) {
  const list = espacios(), e = list.find((x) => x.id === id)
  if (!e) return { error: "no existe" }
  const r = normRule(rule); if (!r) return { error: "excepción inválida" }
  e.exceptions = e.exceptions || []
  if (!e.exceptions.some((x) => x.type === r.type && x.value === r.value)) e.exceptions.push(r)
  save("espacios.json", list); return e
}
export function espacioRemoveException(id, idx) {
  const list = espacios(), e = list.find((x) => x.id === id)
  if (!e) return { error: "no existe" }
  e.exceptions = (e.exceptions || []).filter((_, i) => i !== Number(idx))
  save("espacios.json", list); return e
}

// ── OVERRIDES DE CONTACTO: fusiones manuales, separaciones y fotos elegidas ──
// { merges: { canonKey: [channelIds...] }, splits: [channelId...], photos: { key: url } }
export function contactOverrides() { return load("contact-overrides.json", { merges: {}, splits: [], photos: {} }) }
export function saveContactOverrides(o) { save("contact-overrides.json", o) }
export function mergeContacts(canonKey, channelIds) {
  const o = contactOverrides(); o.merges[canonKey] = [...new Set([...(o.merges[canonKey] || []), ...channelIds])]
  o.splits = o.splits.filter((s) => !channelIds.includes(s)); saveContactOverrides(o); return o.merges[canonKey]
}
export function unmergeContact(channelId) {
  const o = contactOverrides()
  for (const k of Object.keys(o.merges)) o.merges[k] = o.merges[k].filter((id) => id !== channelId)
  if (!o.splits.includes(channelId)) o.splits.push(channelId); saveContactOverrides(o)
}
export function setContactPhoto(key, url) { const o = contactOverrides(); o.photos[key] = url; saveContactOverrides(o) }
// categoría manual del contacto: familia | amigos | trabajo | otro. Manda sobre lo que adivine la IA.
export function contactCategories() { const o = contactOverrides(); return o.categories || {} }
export function setContactCategory(key, category) { const o = contactOverrides(); o.categories = o.categories || {}; if (category && category !== "auto") o.categories[key] = category; else delete o.categories[key]; saveContactOverrides(o) }
