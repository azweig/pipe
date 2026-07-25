// brain/kernel/keys — resolución PURA de claves / nombres / jids. SIN I/O (ni fs ni DB).
// Es el núcleo determinista de la resolución de identidad (donde se cuelan los bugs sutiles de homónimos):
// probable con characterization tests triviales, sin fixtures. Importa SOLO config (hub) + MY_NUMBERS.
import { owner, ownerFirst } from "../../hub.mjs"
import { MY_NUMBERS } from "../../thread.mjs"

// ── claves de hilo ──
export const jidOfKey = (key) => (key || "").includes(":") ? key.slice(key.indexOf(":") + 1) : ""
export const canonOfKey = (key) => (key || "").includes(":") || key === "self" ? null : key // clave sin ":" = nombre canónico
export const numOf = (jid) => (jid || "").split("@")[0].split(":")[0].split("-")[0]
export const digitsOf = (s) => (s || "").replace(/[^\d]/g, "")
export const channelId = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)

// ── nombres ──
export const initials = (n) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase()
export const stripWA = (s) => (s || "").replace(/\s*\(WA\)$/i, "").trim() // quita el sufijo de ghost del bridge
export const norm = (n) => (n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s*\(wa\)$/i, "").toLowerCase().replace(/\s+/g, " ").trim()
export const slug = (n) => (n || "").trim().replace(/[\/\\:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ")
export const plural = (n, s) => `${n} ${s}${n === 1 ? "" : "s"}`

// ── clasificación de jid (contenedor vs 1:1) ──
export const threadKind = (jid) => /@g\.us$|@thread\.v2$/.test(jid || "") ? "group" : /@newsletter$/.test(jid || "") ? "channel" : /@broadcast$/.test(jid || "") ? "broadcast" : "dm"
// un "contenedor" (grupo WA @g.us, thread de Teams @thread.v2, sala de Matrix !room, newsletter) NO es una persona → nunca colapsar por identidad
export const isContainerJid = (jid) => /@g\.us$|@thread\.v2$|@newsletter$|@broadcast$/.test(jid || "") || /^![^:]+:/.test(jid || "")
export const isGroupJid = (jid) => threadKind(jid) !== "dm"
// ¿el hilo es conmigo mismo? (whatsapp 1:1 cuyo número es uno de mis teléfonos)
export const isSelfThread = (e) => e.channel === "whatsapp" && !isGroupJid(e.jid) && MY_NUMBERS.has(numOf(e.jid))

// ── dueño del hub ──
export const ownerTokens = () => [ownerFirst(), ...String(owner()).split(/\s+/)].map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2)
// ¿este nombre corresponde al DUEÑO del hub? (para excluir "yo" del co-occurrence y de las sugerencias de fusión).
export const isOwnerName = (nm) => { const n = String(nm || "").trim().toLowerCase(); if (!n) return false; if (/^yo($|\s|·)/.test(n) || n.includes("· notas")) return true; return ownerTokens().some((t) => n.includes(t)) }

// contraparte de un evento → nombre canónico del grafo (o null), dado el identity-map (im) y el name→canon (n2c). PURO.
export function counterpartOf(e, im, n2c) { if (isContainerJid(e.jid)) return null; return im[channelId(e)] || n2c[(e.name || "").toLowerCase()] || null }

// deduplicar el MISMO mensaje capturado por varias cuentas (mismo id) o el mismo auto-mensaje entre mis teléfonos
export function dedupEvents(events) {
  const seen = new Set(), out = []
  for (const e of events) { if (e.id) { const k = `${e.channel}:${e.id}`; if (seen.has(k)) continue; seen.add(k) } out.push(e) }
  return out
}

export const CH_ICON = { whatsapp: "📱", telegram: "✈️", teams: "🔷", email: "📧", linkedin: "💼", notion: "📝", calendar: "📅" }
