// Paso 6 — Responder en TU estilo. Dado un contacto (o pendiente), redacta un borrador en la voz del dueño.
// NO envía: te muestra el borrador para aprobar. Uso:
//   node src/reply.mjs "Juan Pérez"                  → responde el último mensaje de esa persona
//   node src/reply.mjs "Juan Pérez" "decile que sí, mañana lo mando"   → con instrucción de qué decir
import { readFileSync, existsSync, readdirSync } from "fs"
import { llm } from "./lib/llm.mjs"
import { buildStyleProfile, buildStyleProfiles, styleExamples, categoryOf } from "./lib/style.mjs"
import { ownerFirst, company } from "./lib/hub.mjs"
import { isSecretJsonl } from "./lib/secret.mjs" // 🔒 lo que se le manda al LLM no puede incluir canales secretos

const argv = process.argv.slice(2)
const query = (argv[0] || "").trim()
const instruction = argv.slice(1).join(" ").trim()
if (!query) { console.log('Uso: node src/reply.mjs "Persona" ["qué querés decir"]'); process.exit(1) }

const j = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])
const slug = (n) => (n || "").trim().replace(/[\/\\:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ")
const idmap = existsSync("./data/identity-map.json") ? JSON.parse(readFileSync("./data/identity-map.json", "utf8")) : {}
const aliases = existsSync("./data/aliases.json") ? JSON.parse(readFileSync("./data/aliases.json", "utf8")) : { people: {} }
const channelId = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)
const fmt = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ")

// resolver persona
const people = existsSync("./vault/People") ? readdirSync("./vault/People").filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : []
let canon = people.find((p) => p.toLowerCase() === query.toLowerCase())
if (!canon) for (const [c, al] of Object.entries(aliases.people || {})) if (c.toLowerCase() === query.toLowerCase() || al.map((x) => x.toLowerCase()).includes(query.toLowerCase())) canon = c
if (!canon) { const m = people.filter((p) => p.toLowerCase().includes(query.toLowerCase())); if (m.length === 1) canon = m[0]; else if (m.length > 1) { console.log(`Varios: ${m.join(", ")}`); process.exit(0) } }
if (!canon) { console.log(`No encontré a "${query}".`); process.exit(0) }

// hilo con esa persona
const names = new Set([canon.toLowerCase(), ...((aliases.people[canon] || []).map((x) => x.toLowerCase()))])
const chans = new Set(Object.entries(idmap).filter(([, v]) => v === canon).map(([k]) => k))
const card = existsSync(`./vault/People/${slug(canon)}.md`) ? readFileSync(`./vault/People/${slug(canon)}.md`, "utf8") : ""
for (const c of (card.match(/channels: \[(.*?)\]/)?.[1] || "").split(",").map((s) => s.trim()).filter(Boolean)) chans.add(c)
// 🔒 el filtro por fuente secreta va primero; el orden cronológico es imprescindible (de acá salen "los últimos 8" y el último entrante)
const thread = j("./data/messages.jsonl").filter((e) => !isSecretJsonl(e) && (chans.has(channelId(e)) || names.has((e.name || "").toLowerCase()))).sort((a, b) => (a.ts || 0) - (b.ts || 0))
if (!thread.length) { console.log(`No tengo historial con ${canon} para responder.`); process.exit(0) }

const lastInbound = [...thread].reverse().find((e) => e.dir !== "out")
if (!lastInbound) { console.log(`El último mensaje con ${canon} ya es tuyo — no hay nada pendiente de responder.`); process.exit(0) }
const channel = lastInbound.channel
const O = ownerFirst()
const recent = thread.slice(-8).map((e) => `${e.dir === "out" ? O.toUpperCase() : canon}: ${(e.text || "").slice(0, 220)}`).join("\n")

// estilo: global + el ESPECÍFICO de la categoría de relación (cómo le escribe a ese grupo)
const profile = await buildStyleProfile().catch(() => null)
const byCat = await buildStyleProfiles().catch(() => ({}))
const category = categoryOf(canon)
const catProfile = byCat[category] || null
const examples = styleExamples(lastInbound.jid, channel, 6)
const role = (card.match(/^role:\s*(.*)$/m)?.[1] || "").trim()
const tags = (card.match(/^tags:\s*\[(.*?)\]/m)?.[1] || "").trim()

console.log(`\n${"═".repeat(60)}\n✍️  Borrador de respuesta a ${canon}${role ? ` (${role})` : ""} · por ${channel}\n${"═".repeat(60)}`)
console.log(`📨 Le respondés a (${fmt(lastInbound.ts)}): "${(lastInbound.text || "").slice(0, 200)}"\n`)

const draft = await llm(
  `Sos ${O}${company() ? ` (dueño de ${company()})` : ""} respondiendo un mensaje. Escribí el borrador EN SU VOZ, listo para enviar por ${channel}.

ESTILO GENERAL DE ${O.toUpperCase()}: ${profile ? JSON.stringify(profile) : "(natural, español)"}
ESTILO ESPECÍFICO CON "${category.toUpperCase()}" (cómo trata ${O} a este tipo de relación — PRIORIZÁ esto): ${catProfile ? JSON.stringify(catProfile) : "(sin perfil propio; usá el general + sentido común según la relación)"}
EJEMPLOS REALES DE CÓMO ESCRIBE ${O.toUpperCase()}${examples.length ? ` (imitá este tono/formato)` : ""}:\n${examples.map((e) => `- "${e.slice(0, 200)}"`).join("\n") || "(sin ejemplos aún)"}

CON QUIÉN HABLA: ${canon}${role ? `, ${role}` : ""}${tags ? ` [${tags}]` : ""} → categoría: ${category}. Ajustá el registro EXACTAMENTE a cómo ${O} trata a un "${category}" (no a un genérico).

CONVERSACIÓN RECIENTE:\n${recent}

${instruction ? `LO QUE ${O.toUpperCase()} QUIERE DECIR: ${instruction}` : "Redactá una respuesta apropiada al último mensaje de " + canon + "."}

Devolvé SOLO el texto del mensaje, sin comillas ni explicaciones, como lo escribiría ${O}.`
)
console.log(draft.trim())
console.log(`${"═".repeat(60)}`)
console.log(`(borrador — NO enviado. Ajustá con: node src/reply.mjs "${canon}" "lo que quieras cambiar")\n`)
