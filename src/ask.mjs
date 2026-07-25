// "Preguntale a tu cerebro" — pregunta en lenguaje natural sobre TODO tu grafo + historial. Responde con fuentes.
// RAG v1: (1) el LLM planifica qué buscar → (2) recuperamos eventos/nodos/agenda relevantes → (3) el LLM responde citando.
// Uso: node src/ask.mjs "¿qué pendientes tengo con clientes de Colombia?"
import { readFileSync, existsSync, readdirSync } from "fs"
import { ownerFirst, company } from "./lib/hub.mjs"
import { llm } from "./lib/llm.mjs"

const question = process.argv.slice(2).join(" ").trim()
if (!question) { console.log('Uso: node src/ask.mjs "tu pregunta"'); process.exit(1) }

const j = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])
const slug = (n) => (n || "").trim().replace(/[\/\\:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ")
const idmap = existsSync("./data/identity-map.json") ? JSON.parse(readFileSync("./data/identity-map.json", "utf8")) : {}
const aliases = existsSync("./data/aliases.json") ? JSON.parse(readFileSync("./data/aliases.json", "utf8")) : { people: {}, companies: {} }
const channelId = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)
const fmt = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ")

// catálogo de nodos del grafo (para que el LLM sepa qué existe)
const nodes = { person: [], company: [], project: [] }
for (const [t, folder] of [["person", "People"], ["company", "Companies"], ["project", "Projects"]])
  if (existsSync(`./vault/${folder}`)) nodes[t] = readdirSync(`./vault/${folder}`).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
const allNames = [...nodes.person, ...nodes.company, ...nodes.project]

const events = j("./data/messages.jsonl")
const cal = [...j("./data/calendar.jsonl"), ...j("./data/calendar-google.jsonl")]
const holidays = existsSync("./data/holidays.json") ? JSON.parse(readFileSync("./data/holidays.json", "utf8")) : {}

// ── 1. plan de recuperación ──
const plan = await llm(
  `Pregunta del usuario (${ownerFirst()}, dueño de la empresa ${company()}): "${question}"\n\nENTIDADES CONOCIDAS en su grafo (personas/empresas/proyectos):\n${allNames.join(", ").slice(0, 3000)}\n\nDevolvé JSON con qué buscar para responder:\n{"entities":["nombres EXACTOS de la lista que sean relevantes"],"keywords":["palabras clave a buscar en los mensajes"],"countries":["PE","AR","CO","BO","US" si aplica"],"needsCalendar":true/false,"needsHolidays":true/false}`,
  { json: true }
).catch(() => ({ entities: [], keywords: question.toLowerCase().split(/\s+/).filter((w) => w.length > 4) }))

const ents = (plan.entities || []).filter((e) => allNames.some((n) => n.toLowerCase() === e.toLowerCase()))
const kws = (plan.keywords || []).map((k) => k.toLowerCase()).filter(Boolean)

// ── 2. recuperar ──
// canales/nombres de las entidades pedidas
const wantChans = new Set(), wantNames = new Set()
for (const e of ents) {
  const canon = allNames.find((n) => n.toLowerCase() === e.toLowerCase())
  wantNames.add(canon.toLowerCase())
  for (const a of aliases.people?.[canon] || aliases.companies?.[canon] || []) wantNames.add(a.toLowerCase())
  for (const [ch, v] of Object.entries(idmap)) if (v === canon) wantChans.add(ch)
}
const scored = []
for (const ev of events) {
  const text = (ev.text || "").toLowerCase()
  let hit = 0
  if (wantChans.has(channelId(ev)) || wantNames.has((ev.name || "").toLowerCase())) hit += 3
  for (const k of kws) if (text.includes(k) || (ev.name || "").toLowerCase().includes(k)) hit += 1
  if (hit > 0) scored.push({ ev, hit })
}
scored.sort((a, b) => b.hit - a.hit || (b.ev.ts || 0) - (a.ev.ts || 0))
const picked = scored.slice(0, 70).map((s) => s.ev).sort((a, b) => (a.ts || 0) - (b.ts || 0))

// fichas de grafo de las entidades
const cards = ents.map((e) => {
  for (const folder of ["People", "Companies", "Projects"]) { const p = `./vault/${folder}/${slug(allNames.find((n) => n.toLowerCase() === e.toLowerCase()))}.md`; if (existsSync(p)) return readFileSync(p, "utf8").slice(0, 800) }
  return ""
}).filter(Boolean)

// agenda + feriados si aplica
const now = new Date().toISOString().slice(0, 10)
const meetings = plan.needsCalendar ? cal.filter((m) => (m.start || "") >= now).slice(0, 15) : []
let holiCtx = ""
if (plan.needsHolidays || (plan.countries || []).length) for (const c of plan.countries || []) if (holidays[c]) holiCtx += `\n${holidays[c].country}: ` + holidays[c].holidays.filter((h) => h.date >= now).slice(0, 5).map((h) => `${h.date} ${h.localName}`).join(", ")

// ── 3. responder con fuentes ──
console.log(`\n🔎 buscando: ${ents.join(", ") || "—"}${kws.length ? ` · keywords: ${kws.join(", ")}` : ""}  (${picked.length} mensajes relevantes)\n`)
const ctx = [
  cards.length ? `FICHAS DEL GRAFO:\n${cards.join("\n---\n")}` : "",
  picked.length ? `MENSAJES/HISTORIAL:\n${picked.map((e) => `[${fmt(e.ts)}][${e.channel}] ${e.name}: ${(e.text || "").slice(0, 220)}`).join("\n")}` : "",
  meetings.length ? `AGENDA PRÓXIMA:\n${meetings.map((m) => `${(m.start || "").slice(0, 16)} ${m.title} (${(m.attendees || []).slice(0, 5).join(", ")})`).join("\n")}` : "",
  holiCtx ? `FERIADOS:\n${holiCtx}` : "",
].filter(Boolean).join("\n\n")

const answer = await llm(
  `Sos el segundo cerebro de ${ownerFirst()} (dueño de ${company()}). Respondé su pregunta usando SOLO el CONTEXTO. Sé concreto y accionable, en español. Citá fuentes entre paréntesis (fecha, canal y/o persona). Si el contexto no alcanza, decilo claramente y sugerí qué falta.\n\nPREGUNTA: ${question}\n\nCONTEXTO:\n${ctx || "(sin datos relevantes encontrados)"}`,
)
console.log(`${"═".repeat(60)}\n${answer.trim()}\n${"═".repeat(60)}\n`)
