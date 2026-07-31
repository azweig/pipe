// brain/people — PERSONAS: perfil de contacto, resolución (resolvePerson/personCard, superficie del bug de homónimos),
// ficha+timeline unificada (personView), tarjetas pre-generadas (bio/temas/stats/en común) y fusión de hilos.
// resolvePerson/personView son export function HOISTED (schedule/meetings los importan por la fachada). Pesado: vault+contacts+db.
import { threadStats, threadMediaCount, threadChannelCounts, mergeThreads as dbMergeThreads, getMeta, setMeta, groupMembershipRows, threadCountFirstLast, threadChannelActivity, threadDirTimeline, threadInboundSenders, threadTextRowids, messagesByRowids } from "../db.mjs"
import { jidOfKey, canonOfKey, isContainerJid, norm, stripWA, initials, channelId, threadKind, numOf, plural, dedupEvents, isSelfThread, isOwnerName } from "./kernel/keys.mjs"
import { contactName, photoFor, avatarMap, aliases, idmap, nameToCanonMap, jf, waGroups } from "./kernel/contacts.mjs"
import { peopleNodes, companyNodes, cardFor, fm } from "./kernel/vault.mjs"
import { j } from "./kernel/jsonl.mjs"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { phoneOf, MY_NUMBERS, nameExtends } from "../thread.mjs"
import { ownerFirst, company } from "../hub.mjs"
import { llm } from "../llm.mjs"
import { threadTargets } from "./reply.mjs" // contactProfile compone los destinos del contacto (hoisted, llamada en runtime)

// PERFIL de contacto (rico, desde la DB → confiable y completo). Para la página de persona.
export function contactProfile(key) {
  const s = threadStats(key)
  const media = threadMediaCount(key)
  const channels = threadChannelCounts(key)
  const jid = jidOfKey(key), isGroup = isContainerJid(jid)
  const name = key === "self" ? "Mis Notas" : (canonOfKey(key) || contactName(jid) || contactName(key) || stripWA(String(key).replace(/^(whatsapp|email):/, "")) || key)
  const AV = avatarMap()
  const photo = isGroup ? (AV[norm(name)] || null) : (key === "self" ? null : photoFor(name, jid, key))
  const targets = threadTargets(key).targets || []
  const total = s.total || 0, sent = s.sent || 0
  return { key, name, photo, isGroup, total, sent, recv: total - sent, first: s.first || 0, last: s.last || 0, media, channels, email: key.startsWith("email:") ? key.slice(6) : null, targets }
}

export function resolvePerson(query) {
  const q = (query || "").trim().toLowerCase(), people = peopleNodes(), al = aliases()
  let canon = people.find((p) => p.toLowerCase() === q)
  if (!canon) for (const [c, a] of Object.entries(al.people || {})) if (c.toLowerCase() === q || a.map((x) => x.toLowerCase()).includes(q)) canon = c
  if (!canon) { const m = people.filter((p) => p.toLowerCase().includes(q)); if (m.length) canon = m[0] }
  return canon || null
}

// ── FICHA + CONVERSACIÓN UNIFICADA de una persona (o grupo, o "yo") ──
export function personView(nameOrKey) {
  const events = dedupEvents(j("messages.jsonl")), im = idmap(), n2c = nameToCanonMap()
  const self = nameOrKey === "self"
  let canon = self ? null : resolvePerson(nameOrKey)
  let filter
  if (self) filter = isSelfThread
  else if (canon) {
    const names = new Set([canon.toLowerCase(), ...((aliases().people[canon] || []).map((x) => x.toLowerCase()))])
    const chans = new Set(Object.entries(im).filter(([, v]) => v === canon).map(([k]) => k))
    const card = cardFor("People", canon)
    for (const c of (fm(card, "channels")).split(",").map((s) => s.trim()).filter(Boolean)) chans.add(c)
    filter = (e) => chans.has(channelId(e)) || names.has((e.name || "").toLowerCase())
  } else filter = (e) => `${e.channel}:${e.jid || e.account}` === nameOrKey
  const timeline = events.filter(filter).sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((e) => ({ ts: e.ts, channel: e.channel, dir: e.dir || "in", text: e.text || "", media: e.media || null, kind: e.kind || null, who: e.dir === "out" ? "Vos" : (e.name || canon || numOf(e.jid) || "?") }))
  const card = canon ? cardFor("People", canon) : ""
  const links = [...new Set([...card.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]))].filter((x) => x !== canon)
  const byChannel = {}; for (const t of timeline) byChannel[t.channel] = (byChannel[t.channel] || 0) + 1
  const meetings = [...j("calendar.jsonl"), ...j("calendar-google.jsonl")].filter((m) => canon && (m.attendees || []).concat(m.organizer).some((a) => String(a || "").toLowerCase().includes(canon.toLowerCase())))
    .map((m) => ({ title: m.title, start: m.start }))
  const jidPart = self ? "" : nameOrKey.split(":").slice(1).join(":")
  const kind = self ? "self" : canon ? "dm" : threadKind(jidPart)
  const group = kind === "group" || kind === "channel"
  let name
  if (self) name = "Yo · notas (mis teléfonos)"
  else if (kind === "group") name = waGroups()[jidPart] || `Grupo · ${plural(new Set(timeline.filter((t) => t.dir !== "out").map((t) => t.who)).size, "persona")}`
  else if (kind === "channel") name = "Canal"
  else name = canon || (nameOrKey.includes(":") ? numOf(jidPart) : nameOrKey)
  return {
    group, self, name, canon,
    initials: self ? "🟢" : kind === "group" ? "👥" : kind === "channel" ? "📢" : initials(canon || nameOrKey),
    role: canon ? fm(card, "role") : "", tags: canon ? fm(card, "tags") : "", orgs: canon ? fm(card, "orgs") : "",
    aliases: canon ? fm(card, "aliases") : "", links, byChannel: Object.entries(byChannel).map(([c, n]) => ({ channel: c, n })),
    meetings, timeline,
  }
}

// ── DIRECTORIO ──
export function directory() {
  const people = peopleNodes().map((p) => ({ name: p, role: fm(cardFor("People", p), "role"), tags: fm(cardFor("People", p), "tags"), initials: initials(p) }))
  const companies = companyNodes().map((c) => ({ name: c, relation: fm(cardFor("Companies", c), "relation"), tags: fm(cardFor("Companies", c), "tags") }))
  return { people: people.sort((a, b) => a.name.localeCompare(b.name)), companies: companies.sort((a, b) => a.name.localeCompare(b.name)) }
}

// ═══════════════ PERSONAS v2 — tarjetas PRE-GENERADAS (bio, stats, canales, grafo) que evolucionan ═══════════════
const _median = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
// ÍNDICE DE MEMBRESÍA DE GRUPOS: un scan → miembros de cada grupo con [nombre, clave, n]. clave = número real (phoneOf) para
// matchear a la persona aunque en el grupo aparezca con otro nombre/LID. Base del "en común". Se guarda en meta.
const _cleanName = (n) => String(n || "").replace(/\s*\(WA\)\s*$/i, "").trim()
function buildMembershipIndex() {
  const rows = groupMembershipRows()
  const g = new Map()
  for (const r of rows) {
    const key = phoneOf(r.sender) || String(r.sender || "").replace(/\D/g, "") || (r.name || "").replace(/\D/g, "") || ""
    let nm = _cleanName(r.name)
    if (!nm || /^\d+$/.test(nm)) nm = contactName(key) || contactName(r.name) || nm || key // número → nombre de la agenda
    if (!g.has(r.thread)) g.set(r.thread, { thread: r.thread, grp: r.grp, members: [] })
    g.get(r.thread).members.push([nm, key, r.n])
  }
  const groups = [...g.values()].filter((x) => (x.members || []).length >= 2).map((x) => ({ thread: x.thread, grp: x.grp, members: x.members.sort((a, b) => b[2] - a[2]).slice(0, 30) }))
  return { groups, generatedAt: Date.now() }
}
function getMembership() { const raw = getMeta("membership_idx"); if (raw) { try { return JSON.parse(raw) } catch {} } return null }
// EN COMÚN: grupos donde la persona participa (match por número/nombre) + co-miembros, ponderados por grupos compartidos
function sharedFor(canon, ids, idx) {
  if (!idx || !idx.groups) return { groups: [], people: [] }
  const cl = canon.toLowerCase(), first = cl.split(/\s+/)[0]
  const isThem = ([nm, key]) => (key && ids.has(key)) || (nm || "").toLowerCase() === cl || (nm || "").toLowerCase().startsWith(first + " ")
  const myGroups = idx.groups.filter((g) => (g.members || []).some(isThem))
  const co = new Map()
  for (const g of myGroups) for (const m of (g.members || [])) { const nm = m[0]; if (isThem(m) || isOwnerName(nm) || (nm || "").length < 3 || /^\d+$/.test(nm)) continue; const k = nm.toLowerCase(); const cur = co.get(k) || { name: nm, shared: 0 }; cur.shared++; co.set(k, cur) }
  return {
    groups: myGroups.sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0)).slice(0, 6).map((g) => ({ name: g.grp || "Grupo", thread: g.thread })),
    people: [...co.values()].sort((a, b) => b.shared - a.shared).slice(0, 6),
  }
}
async function buildPersonCard(canon, t, mem) {
  const key = canon
  const stats = threadCountFirstLast(key)
  const chans = threadChannelActivity(key)
  const vcard = cardFor("People", canon), role = fm(vcard, "role"), tags = fm(vcard, "tags"), orgs = fm(vcard, "orgs")
  const msgs = threadDirTimeline(key, { limit: 3000 })
  const deltas = []; let lastIn = null
  for (const m of msgs) { if (m.dir === "in") lastIn = m.ts; else if (m.dir === "out" && lastIn) { const d = m.ts - lastIn; if (d > 0 && d < 86400000) deltas.push(d); lastIn = null } }
  const respMin = deltas.length >= 3 ? Math.round(_median(deltas) / 60000) : null
  const links = [...new Set([...vcard.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]))].filter((x) => x !== canon).slice(0, 5)
  // ids de la persona (números + LID) para matchear su participación en grupos aunque figure con otro nombre
  const ids = new Set()
  try { const im = jf("identity-manual.json") || {}; for (const [k, v] of Object.entries(im)) if (String(v).toLowerCase() === canon.toLowerCase() && /^\d{8,}$/.test(k)) { ids.add(k); const r = phoneOf(k + "@lid"); if (r) ids.add(r) } } catch {}
  for (const m of vcard.matchAll(/whatsapp:(\d+)/g)) { ids.add(m[1]); const r = phoneOf(m[1] + "@lid"); if (r) ids.add(r) }
  // el número REAL sale del propio hilo (sender de sus mensajes entrantes), excluyendo mis números
  try { for (const r of threadInboundSenders(key, { limit: 30 })) { const p = phoneOf(r.sender); if (p && !MY_NUMBERS.has(p)) ids.add(p) } } catch {}
  const shared = sharedFor(canon, ids, mem || getMembership())
  // BIO + TEMAS sobre TODO el HISTÓRICO (no solo la última charla): muestreo de mensajes repartido en toda la relación + lo reciente
  const ids0 = threadTextRowids(key)
  const pick = new Set(), step = Math.max(1, Math.floor(ids0.length / 45))
  for (let i = 0; i < ids0.length; i += step) pick.add(ids0[i].rowid) // ~45 repartidos por toda la historia
  for (const r of ids0.slice(-20)) pick.add(r.rowid) // + los 20 más recientes
  const rids = [...pick]
  const conv = messagesByRowids(rids)
  let bio = "", topics = []
  try {
    const r = await llm(`Sos el asistente de ${ownerFirst()} (dueño de ${company()}). Sobre su contacto ${canon} (rol=${role || "?"}, orgs=${orgs || "?"}, tags=${tags || "?"}, en común: ${shared.people.map((p) => p.name).join(", ") || "?"}).
Esta es una MUESTRA de TODA la relación (mensajes de distintas épocas, del más viejo al más nuevo; → = ${ownerFirst()}):
${conv.map((m) => (m.dir === "out" ? "→ " : "") + (m.text || "").slice(0, 140)).join("\n").slice(0, 4000) || "(sin mensajes)"}

Devolvé SOLO JSON:
{"bio":"3-4 frases: quién es para ${ownerFirst()}, la dinámica y la HISTORIA de la relación (cómo evolucionó, de qué trata en general), en 2da persona","temas":["tema recurrente/importante en 3-6 palabras","otro","otro","otro"]}
Los "temas" son los ejes de QUÉ hablan a lo largo del tiempo (concretos, no 'saludos'). Usá SOLO lo que está acá, NO inventes nombres ni hechos.`, { json: true, chain: process.env.LLM_CHAIN_CORRECT || "openai,ollama", numPredict: 320, temperature: 0.3 })
    bio = (r?.bio || "").trim(); topics = (r?.temas || []).filter(Boolean).slice(0, 4)
  } catch {}
  return {
    v: 4, canon, name: canon, role, tags, orgs, bio, topics,
    stats: { messages: stats.c || 0, respMin, firstTs: stats.first || 0, lastTs: stats.last || 0 },
    channels: chans.map((c) => ({ channel: c.channel, last: c.last, n: c.n })),
    links, shared, photo: (t && t.photo) || null, generatedAt: Date.now(),
  }
}
// PRE-GENERA tarjetas de personas (bio+temas+stats+canales+en común). Arma el índice de membresía UNA vez y lo reusa.
// topN alto = recorre TODA la agenda (contactos reales). El skip de frescas hace que las corridas siguientes sean baratas.
export async function genPersonCards({ topN = 1000, minMsgs = 15 } = {}) {
  const { listThreads } = await import("./inbox.mjs") // inbox ya es su propio módulo (M4b); people→inbox no tiene ciclo
  const mem = buildMembershipIndex() // 1 scan, compartido por todas las cards de esta corrida
  try { setMeta("membership_idx", JSON.stringify(mem)) } catch { } // guardar para on-demand; si el server tiene el lock, no es fatal (las cards ya usan `mem`)
  const threads = listThreads({ limit: 1500 }).filter((t) => !t.group && !t.self && t.canon && t.bucket !== "spam" && (t.count || 0) >= minMsgs)
  const top = threads.sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, topN)
  let n = 0
  for (const t of top) {
    const canon = t.canon, prev = getMeta("personcard:" + canon.toLowerCase())
    if (prev) { try { const p = JSON.parse(prev); if (p.v === 4 && p.generatedAt && Date.now() - p.generatedAt < 3 * 86400000 && p.stats?.messages === (t.count || 0)) continue } catch {} }
    try { const card = await buildPersonCard(canon, t, mem); setMeta("personcard:" + canon.toLowerCase(), JSON.stringify(card)); n++ } catch {}
  }
  return n
}
// DATOS DE CONTACTO de la persona: números reales + emails (de threadTargets + senders entrantes). Baratos → se computan al LEER.
function contactData(key) {
  const phones = new Set(), emails = new Set()
  try { for (const tg of (threadTargets(key).targets || [])) {
    if (tg.channel === "email" && /@/.test(tg.target || "")) emails.add(String(tg.target).toLowerCase())
    else if (tg.channel === "whatsapp") { const d = String(tg.label || "").replace(/[^\d]/g, ""); if (d.length >= 8) phones.add(d) }
  } } catch {}
  try { for (const r of threadInboundSenders(key, { limit: 40 })) { const p = phoneOf(r.sender); if (p && !MY_NUMBERS.has(p)) phones.add(p) } } catch {}
  const km = String(key).match(/(\d{8,15})@s\.whatsapp\.net/) || String(key).match(/(?:whatsapp|wa):\+?(\d{8,15})\b/) // el número está en el jid del hilo (whatsapp:NUM@…) aunque no haya target
  if (km && !MY_NUMBERS.has(km[1])) phones.add(km[1])
  if (String(key).startsWith("email:")) emails.add(String(key).slice(6).toLowerCase())
  return { phones: [...phones].slice(0, 6), emails: [...emails].slice(0, 6) }
}
// añade los MIEMBROS a cada grupo EN COMÚN (para el modal clickeable) desde el índice de membresía. Excluye owner/números sueltos.
function withGroupMembers(shared) {
  const mem = getMembership()
  if (mem && shared && shared.groups) for (const g of shared.groups) {
    const gi = (mem.groups || []).find((x) => x.thread === g.thread)
    g.members = gi ? (gi.members || []).filter(([nm]) => nm && String(nm).length >= 2 && !/^\d+$/.test(nm) && !isOwnerName(nm)).map(([nm, k, n]) => ({ name: nm, key: k, n })).slice(0, 40) : []
  }
  return shared
}
// miembros del PROPIO grupo (cuando la card ES un grupo @g.us / sala) → para mostrarlos al abrir el grupo. Clickeables en la UI.
function ownGroupMembers(card) {
  const key = card.canon || "", nm = card.name || ""
  if (!(card.group || /@g\.us$|@broadcast$|@newsletter$/.test(key) || /@g\.us/.test(key))) return null
  const mem = getMembership(); if (!mem) return []
  // el índice keyea por THREAD, pero la card puede venir por NOMBRE → matchear por thread O por nombre de grupo (grp).
  const gi = (mem.groups || []).find((x) => x.thread === key || (x.grp && (x.grp === nm || x.grp === key)))
  return gi ? (gi.members || []).filter(([m]) => m && String(m).length >= 2 && !/^\d+$/.test(m) && !isOwnerName(m)).map(([m, k, n]) => ({ name: m, key: k, n })).slice(0, 60) : []
}
// enriquece una card (de cache o fresca) con datos baratos que NO conviene cachear: contacto + miembros de grupo.
function enrichCard(card) {
  if (card) { // OJO: los grupos tienen canon=null → NO gatear por canon (si no, no se enriquecen)
    const ck = card.key || card.canon // la KEY real del hilo (whatsapp:NUM@… / email:…) tiene el dato de contacto; el canon puede ser solo un nombre
    if (ck) card.contacts = contactData(ck)
    withGroupMembers(card.shared)
    const gm = ownGroupMembers(card); if (gm) card.groupMembers = gm
  }
  return card
}

// lectura RÁPIDA de la tarjeta de persona. Top pre-generadas; la cola larga se genera y CACHEA en la 1ra vista (nunca lenta 2 veces).
export async function personCard(nameOrKey, { force = false } = {}) {
  const { listThreads } = await import("./inbox.mjs") // inbox ya es su propio módulo (M4b); people→inbox no tiene ciclo
  const norm = (s) => String(s || "").trim().toLowerCase()
  // alias APRENDIDO: nombre completo del calendario ("Carlos Mendoza") → nombre del chat ("Carlos"). Redirige al hilo real.
  const alias = getMeta("personalias:" + norm(nameOrKey))
  const eff = alias || nameOrKey
  const canon = resolvePerson(eff)
  // force → saltear la cache y REGENERAR el grafify completo (botón "Explorar" del perfil)
  if (!force) for (const k of [...new Set([norm(eff), norm(nameOrKey), canon ? norm(canon) : ""].filter(Boolean))]) {
    const v = getMeta("personcard:" + k); if (v) { try { const c = JSON.parse(v); if (c && c.canon) return enrichCard(c) } catch {} }
  }
  // hilo por nombre canónico exacto → generá + cacheá
  const want = canon ? norm(canon) : norm(eff)
  const threads = listThreads({ limit: 600 })
  // match por CANON, y si no, por NOMBRE display o por KEY exacta: los contactos de WhatsApp tienen canon=número/jid pero se abren
  // por nombre ("Uzimock") o por número crudo desde el chat → sin esto el grafify nunca corría para ellos (quedaba "Generando…").
  let t = threads.find((x) => x.canon && (norm(x.canon) === want || norm(x.canon) === norm(eff)))
    || threads.find((x) => (norm(x.name) === want || norm(x.name) === norm(nameOrKey)) && (x.count || 0) > 0)
    || threads.find((x) => x.key && (x.key === nameOrKey || x.key === eff))
  // FALLBACK por NOMBRE: el nombre pedido no tiene hilo propio pero SÍ existe el chat de la misma persona bajo otro nombre
  // (ej "Carlos Mendoza" del calendario → hilo "Carlos" con 20k msgs). Match por prefijo de primer nombre o ≥2 tokens.
  if (!t || (t.count || 0) === 0) {
    const reqN = norm(nameOrKey), reqTok = reqN.split(/\s+/).filter((x) => x.length > 2)
    if (reqTok.length) {
      const cand = threads.filter((x) => !x.group && x.canon && (x.count || 0) > 5).map((x) => {
        const cn = norm(x.canon), ct = cn.split(/\s+/).filter((y) => y.length > 2)
        // superset REAL (con apellido), nunca dos nombres de pila idénticos → homónimos NO se fusionan (caso Diego Ramírez vs Diego hermano)
        const prefix = nameExtends(reqN, cn)
        return { x, prefix, overlap: ct.filter((y) => reqTok.includes(y)).length }
      }).filter((c) => c.prefix || c.overlap >= 2).sort((a, b) => (b.prefix - a.prefix) || (b.overlap - a.overlap) || ((b.x.count || 0) - (a.x.count || 0)))
      if (cand[0]) { t = cand[0].x; setMeta("personalias:" + reqN, t.canon) } // aprender el alias para la próxima
    }
  }
  if (t && (t.count || 0) > 0) { const idKey = t.canon || t.name || t.key; try { const card = await buildPersonCard(idKey, t); card.key = card.key || t.key; setMeta("personcard:" + norm(idKey), JSON.stringify(card)); return enrichCard(card) } catch (e) { if (process.env.LLM_DEBUG) console.error("[personCard] buildPersonCard falló:", e.message) } }
  const pv = personView(eff) // último recurso (grupos, o nombre sin hilo) — lo que se pueda al toque, sin bio
  const tl = pv.timeline || []
  return enrichCard({ canon: pv.canon, name: pv.name, role: pv.role, tags: pv.tags, orgs: pv.orgs, bio: "", topics: [], shared: { groups: [], people: [] }, stats: { messages: tl.length, respMin: null, firstTs: tl[0]?.ts || 0, lastTs: tl[tl.length - 1]?.ts || 0 }, channels: (pv.byChannel || []).map((c) => ({ channel: c.channel, n: c.n, last: 0 })), links: pv.links || [], photo: null, group: pv.group, pending: true })
}

// fusiona hilos: mueve <sources[]> al hilo <target>. Base del botón "es la misma persona".
export function mergeThreadsInto(target, sources) {
  const srcs = (sources || []).filter((s) => s !== target)
  const moved = dbMergeThreads(target, srcs)
  // PERSISTIR la identidad: si el target es un NOMBRE canónico (no un jid crudo whatsapp:/email:…), mapeá el número de cada source
  // → ese nombre en identity-manual.json. Sin esto, mover los mensajes no alcanza: el próximo mensaje del número re-parte el hilo.
  try {
    const targetName = /^(whatsapp|email|telegram|signal|sms):/.test(target) ? "" : String(target || "").trim()
    if (targetName) {
      const f = "./data/identity-manual.json"
      const map = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}
      let changed = false
      for (const s of srcs) { const num = phoneOf(jidOfKey(s)) || phoneOf(s); if (num && map[num] !== targetName) { map[num] = targetName; changed = true } }
      if (changed) writeFileSync(f, JSON.stringify(map, null, 2))
    }
  } catch {}
  return moved
}
// sugerencias de fusión PARA UN hilo dado: otros hilos con nombre igual/parecido (candidatos a "es la misma persona")
export async function mergeSuggestions(ws, forKey = "") {
  const { listThreads } = await import("./inbox.mjs") // inbox ya es su propio módulo (M4b); people→inbox no tiene ciclo
  const threads = listThreads({ limit: 600 }).filter((t) => !t.group && !t.self && !isOwnerName(t.name))
  const CH = { whatsapp: "WhatsApp", email: "Email", teams: "Teams", telegram: "Telegram" }
  const nk = (s) => norm(s || "")
  const target = forKey ? threads.find((t) => t.key === forKey) : null
  const byName = {}
  for (const t of threads) { const n = nk(t.name); if (n.length < 4) continue; (byName[n] = byName[n] || []).push(t) }
  const mk = (group, name) => {
    const chans = [...new Set(group.flatMap((t) => t.channels || []))]
    const fullName = (name || "").trim().split(/\s+/).length >= 2
    return { key: group[0].key, name, channels: chans, channelIds: group.map((t) => t.key), keys: group.map((t) => t.key),
      samples: group.slice(0, 4).map((t) => ({ channel: t.lastChannel, label: CH[t.lastChannel] || t.lastChannel, text: (t.lastText || "").slice(0, 60) })),
      confidence: fullName ? 80 : 58,
      reasons: [`${group.length} conversaciones distintas con el nombre "${name}"`, fullName ? "Nombre y apellido coinciden" : "⚠️ Solo coincide el nombre de pila — revisá los ejemplos"] }
  }
  if (target) { // candidatos para ESTE contacto
    const same = byName[nk(target.name)] || []
    if (same.length >= 2) { const s = mk(same, target.name); s.key = forKey; return [s] }
    return []
  }
  const sugs = []
  for (const [n, ts] of Object.entries(byName)) { if (ts.length < 2) continue; sugs.push(mk(ts, ts[0].name)) }
  return sugs.sort((a, b) => b.confidence - a.confidence).slice(0, 12)
}
