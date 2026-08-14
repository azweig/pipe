// "Una sola conversación" — dado un nombre, junta TODO sobre esa persona sin importar el canal:
//   ficha del grafo (rol, empresa, relaciones) + historial unificado (WhatsApp+mail+Teams+Telegram) + reuniones + resumen IA.
// Uso: node src/who.mjs "Juan Pérez"
import { readFileSync, existsSync, readdirSync } from "fs"
import { llm } from "./lib/llm.mjs"
import { ownerFirst, company } from "./lib/hub.mjs"
import { isSecretJsonl } from "./lib/secret.mjs" // 🔒 lo que se le manda al LLM no puede incluir canales secretos

const query = process.argv.slice(2).join(" ").trim()
if (!query) { console.log('Uso: node src/who.mjs "Nombre Persona"'); process.exit(1) }

const j = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])
const slug = (n) => (n || "").trim().replace(/[\/\\:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ")
const idmap = existsSync("./data/identity-map.json") ? JSON.parse(readFileSync("./data/identity-map.json", "utf8")) : {}
const aliases = existsSync("./data/aliases.json") ? JSON.parse(readFileSync("./data/aliases.json", "utf8")) : { people: {} }
const channelId = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)

// ── 1. resolver canónico ──
const people = existsSync("./vault/People") ? readdirSync("./vault/People").filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : []
let canon = people.find((p) => p.toLowerCase() === query.toLowerCase())
if (!canon) for (const [c, al] of Object.entries(aliases.people || {})) if (c.toLowerCase() === query.toLowerCase() || al.map((x) => x.toLowerCase()).includes(query.toLowerCase())) canon = c
if (!canon) { const m = people.filter((p) => p.toLowerCase().includes(query.toLowerCase())); if (m.length === 1) canon = m[0]; else if (m.length > 1) { console.log(`Varios coinciden con "${query}":\n  ${m.join("\n  ")}\nSé más específico.`); process.exit(0) } }
if (!canon) { console.log(`No encontré a "${query}" en el grafo. ¿Ya corrió graphify?`); process.exit(0) }

// ── 2. identificadores de esa persona (nombre + alias + channel-ids) ──
const names = new Set([canon.toLowerCase(), ...((aliases.people[canon] || []).map((x) => x.toLowerCase()))])
const chans = new Set(Object.entries(idmap).filter(([, v]) => v === canon).map(([k]) => k))
const card = existsSync(`./vault/People/${slug(canon)}.md`) ? readFileSync(`./vault/People/${slug(canon)}.md`, "utf8") : ""
for (const c of (card.match(/channels: \[(.*?)\]/)?.[1] || "").split(",").map((s) => s.trim()).filter(Boolean)) chans.add(c)

// ── 3. juntar eventos de TODOS los canales ──
const events = j("./data/messages.jsonl").filter((e) => !isSecretJsonl(e) && (chans.has(channelId(e)) || names.has((e.name || "").toLowerCase()))) // 🔒
events.sort((a, b) => (a.ts || 0) - (b.ts || 0))
const byChan = {}
for (const e of events) byChan[e.channel] = (byChan[e.channel] || 0) + 1

// ── 4. reuniones (calendario) con esa persona ──
const cal = [...j("./data/calendar.jsonl"), ...j("./data/calendar-google.jsonl")]
const meetings = cal.filter((ev) => [...(ev.attendees || []), ev.organizer].some((a) => a && names.has(String(a).toLowerCase()) || String(a || "").toLowerCase().includes(canon.toLowerCase())))

// ── 5. ficha del grafo (frontmatter + relaciones) ──
const fm = {}
for (const line of (card.match(/^---\n([\s\S]*?)\n---/)?.[1] || "").split("\n")) { const m = line.match(/^(\w[\w-]*):\s*(.*)$/); if (m) fm[m[1]] = m[2] }
const rel = (card.match(/## Relaciones\n([\s\S]*?)(\n## |$)/)?.[1] || "").trim()
const bodyLinks = [...card.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1])

// ── 6. render ──
const ICON = { whatsapp: "📱", telegram: "✈️", teams: "🔷", email: "📧", notion: "📝" }
const fmt = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ")
console.log(`\n${"═".repeat(60)}\n👤  ${canon}${fm.role ? `  ·  ${fm.role}` : ""}${fm.tags ? `  ·  ${fm.tags}` : ""}\n${"═".repeat(60)}`)
if (fm.orgs && fm.orgs !== "[]") console.log(`🏢 ${fm.orgs.replace(/[\[\]]/g, "")}`)
if (fm.aliases && fm.aliases !== "[]") console.log(`   alias: ${fm.aliases.replace(/[\[\]]/g, "")}`)
if (bodyLinks.length) console.log(`🔗 conectado con: ${[...new Set(bodyLinks)].filter((x) => x !== canon).join(", ") || "—"}`)
console.log(`\n📊 ${events.length} interacciones · ${Object.entries(byChan).map(([c, n]) => `${ICON[c] || c} ${n}`).join("  ")}`)
if (meetings.length) console.log(`📅 ${meetings.length} reunión(es): ${meetings.slice(0, 3).map((m) => `${(m.start || "").slice(0, 10)} ${m.title}`).join(" · ")}`)

console.log(`\n─── HISTORIAL UNIFICADO (últimas 25) ${"─".repeat(24)}`)
for (const e of events.slice(-25)) console.log(`${fmt(e.ts)}  ${ICON[e.channel] || e.channel}  ${(e.text || "").replace(/\s+/g, " ").slice(0, 90)}`)

// ── 7. resumen IA de la relación ──
if (events.length && process.env.GEMINI_API_KEY) {
  const ctx = events.slice(-60).map((e) => `[${fmt(e.ts)}][${e.channel}] ${e.name}: ${(e.text || "").slice(0, 200)}`).join("\n")
  const facts = `DATOS DEL GRAFO (verdad, usalos para no equivocarte):\n- ${canon}: ${fm.role || "contacto"}${fm.orgs && fm.orgs !== "[]" ? ` de ${fm.orgs.replace(/[\[\]]/g, "")}` : ""}${fm.tags ? ` (${fm.tags.replace(/[\[\]]/g, "")})` : ""}.\n- Conectado con: ${[...new Set(bodyLinks)].filter((x) => x !== canon).join(", ") || "—"}.\n- El "dueño" del sistema es ${ownerFirst()}${company() ? ` (${company()})` : ""}. Distinguí bien quién es empleado/cliente/proveedor según el grafo.`
  try {
    const s = await llm(`Sos el asistente personal de ${ownerFirst()}. Con estos DATOS DEL GRAFO y el HISTORIAL, dame en español 4-5 bullets: (1) quién es y la relación con ${ownerFirst()}, (2) de qué vienen hablando, (3) PENDIENTES o cosas sin responder de parte de ${ownerFirst()}/su equipo, (4) próximo paso sugerido. Sé concreto y respetá los roles del grafo.\n\n${facts}\n\nHISTORIAL:\n${ctx}`)
    console.log(`\n─── 🧠 RESUMEN IA ${"─".repeat(42)}\n${s.trim()}`)
  } catch (e) { console.log(`\n(resumen IA no disponible: ${e.message})`) }
}
console.log("")
