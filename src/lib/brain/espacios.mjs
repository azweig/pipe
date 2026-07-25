// brain/espacios — espacios (carpetas por reglas): pre-gen del rollup (cron), vista de detalle, y espacios-como-hilos en la bandeja.
// espacioThreads lo consume listThreads (inbox, aún en brain) → se exporta; en M4 lo importará brain/inbox.mjs. Leaf.
import { setMeta, getMeta, espacioMessages as dbEspacioMsgs } from "../db.mjs"
import { jf } from "./kernel/contacts.mjs"
import { cleanMsg } from "./kernel/convo.mjs"

// reglas del subárbol (padre agrega lo de sus subespacios). Compartido por pre-gen y vista.
export const _espRulesOf = (e) => [...((e && e.rules) || []), ...(((e && e.members) || []).map((m) => ({ type: "name", value: (m && m.name) || m })))] // exportado: listThreads (inbox, aún en brain) lo usa en inEspacio
function espacioRulesFor(esp, all) {
  const descIds = new Set([esp.id]); for (let grew = true; grew;) { grew = false; for (const e of all) if (e.parent && descIds.has(e.parent) && !descIds.has(e.id)) { descIds.add(e.id); grew = true } }
  let rules, exclude = []
  if (esp.catchAll) { const parent = all.find((e) => e.id === esp.parent); rules = [..._espRulesOf(parent || {}), ..._espRulesOf(esp)]; exclude = all.filter((e) => e.parent === esp.parent && e.id !== esp.id && !e.catchAll).flatMap(_espRulesOf) }
  else rules = all.filter((e) => descIds.has(e.id)).flatMap(_espRulesOf)
  exclude = [...exclude, ...all.filter((e) => descIds.has(e.id)).flatMap((e) => e.exceptions || [])] // EXCEPCIONES → sacan lo que matchean, aunque cumplan una regla
  return { rules, exclude }
}
// PRE-GENERA el rollup de cada espacio (count + recientes + canales). El scan de reglas sobre 1.96M msgs es caro (~5s) → cron, NO en cada carga.
export function genEspacioCards() {
  const all = jf("espacios.json") || []
  let n = 0
  for (const esp of all) {
    const { rules, exclude } = espacioRulesFor(esp, all)
    let count = 0, recent = []
    if (rules.length) { const r = dbEspacioMsgs(rules, { limit: 20, exclude }); count = r.count; recent = r.recent }
    setMeta("espcard:" + esp.id, JSON.stringify({ id: esp.id, count, recent: recent.map((r) => ({ name: r.name, channel: r.channel, text: (r.text || "").slice(0, 120), ts: r.ts, dir: r.dir, thread: r.thread })), channels: [...new Set(recent.map((r) => r.channel).filter(Boolean))], generatedAt: Date.now() }))
    n++
  }
  return n
}
function espCard(esp, all) { // lee la tarjeta pre-generada; si no existe aún, cae al scan en vivo (lento, solo hasta el 1er cron)
  const raw = getMeta("espcard:" + esp.id)
  if (raw) { try { const c = JSON.parse(raw); if (c && c.id) return c } catch {} }
  const { rules, exclude } = espacioRulesFor(esp, all)
  if (!rules.length) return { count: 0, recent: [], channels: [] }
  const r = dbEspacioMsgs(rules, { limit: 20, exclude })
  return { count: r.count, recent: r.recent, channels: [...new Set(r.recent.map((x) => x.channel).filter(Boolean))] }
}
// ── ESPACIOS COMO HILOS: cada espacio de nivel superior aparece en la bandeja como una conversación más (lee la tarjeta pre-gen) ──
export function espacioThreads(seen = {}) {
  const all = jf("espacios.json") || []
  if (!all.length) return []
  const out = []
  for (const esp of all.filter((e) => !e.parent)) {
    const card = espCard(esp, all)
    if (!card.count || !card.recent.length) continue
    const last = card.recent[0], seenTs = seen[`espacio:${esp.id}`] || 0
    out.push({
      key: `espacio:${esp.id}`, espacio: true, espId: esp.id, canon: null, self: false, group: false,
      name: esp.name, icon: esp.icon || "🗂", photo: null, initials: esp.icon || "🗂",
      channels: card.channels, lastChannel: last.channel, count: card.count,
      unread: card.recent.filter((r) => r.dir === "in" && (r.ts || 0) > seenTs).length,
      unseen: last.dir === "in" && (last.ts || 0) > seenTs, suggested: false,
      email: null, account: null, ts: last.ts, lastText: (cleanMsg(last.text) || "").replace(/\s+/g, " ").slice(0, 120) || "…", lastDir: last.dir, bucket: "espacio", pinned: false,
    })
  }
  return out
}
export async function espacioView(ws, id) {
  const all = ws.espacios(), esp = all.find((e) => e.id === id)
  if (!esp) return { error: "no existe" }
  const children = all.filter((e) => e.parent === id).map((c) => ({ id: c.id, name: c.name, icon: c.icon, members: _espRulesOf(c).length }))
  const card = espCard(esp, all) // count + recientes de la tarjeta pre-generada (instantáneo); fallback a scan en vivo
  return {
    id: esp.id, name: esp.name, icon: esp.icon, parent: esp.parent || null, catchAll: !!esp.catchAll,
    rules: esp.rules || [], exceptions: esp.exceptions || [], members: esp.members || [], children, count: card.count,
    recent: (card.recent || []).map((e) => ({ name: e.name, channel: e.channel, text: (e.text || "").slice(0, 120), ts: e.ts, dir: e.dir, thread: e.thread })),
  }
}
