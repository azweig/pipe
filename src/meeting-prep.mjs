// Paso 4 — Prep de reuniones. Dado un evento del calendario, arma el briefing: asistentes (quién es cada uno + historial),
// empresa/tema, mails y pendientes relacionados, y marca a los DESCONOCIDOS para investigar (web/LinkedIn).
// Uso: node src/meeting-prep.mjs "acme"   (matchea título; sin arg = próxima reunión)
import { readFileSync, existsSync, readdirSync } from "fs"
import { llm } from "./lib/llm.mjs"
import { researchEntity, hasWebSearch, linkedinProfile } from "./lib/research.mjs"
import { owner, myEmails, ownerFirst, company } from "./lib/hub.mjs"

const query = process.argv.slice(2).join(" ").trim().toLowerCase()
const j = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])
const slug = (n) => (n || "").trim().replace(/[\/\\:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ")
const idmap = existsSync("./data/identity-map.json") ? JSON.parse(readFileSync("./data/identity-map.json", "utf8")) : {}
const channelId = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)
const fmt = (ts) => new Date(ts).toISOString().slice(0, 16).replace("T", " ")
// "yo" del hub: nombre del dueño + sus correos (config por-hub) → no confundir al dueño con un asistente externo
const ME = [owner().toLowerCase(), ...myEmails().map((e) => e.toLowerCase())].filter(Boolean)

// catálogo de nodos
const nodesOf = (folder) => (existsSync(`./vault/${folder}`) ? readdirSync(`./vault/${folder}`).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [])
const PEOPLE = nodesOf("People"), COMPANIES = nodesOf("Companies")
const cardOf = (folder, name) => { const p = `./vault/${folder}/${slug(name)}.md`; return existsSync(p) ? readFileSync(p, "utf8") : "" }

// ── 1. elegir reunión ──
const today = new Date().toISOString().slice(0, 10)
let cal = [...j("./data/calendar.jsonl"), ...j("./data/calendar-google.jsonl")].filter((e) => (e.start || "") >= today).sort((a, b) => (a.start || "").localeCompare(b.start || ""))
let mtg = query ? cal.find((e) => (e.title || "").toLowerCase().includes(query)) : cal[0]
if (!mtg) { console.log(query ? `No encontré reunión con "${query}".` : "No hay reuniones próximas."); process.exit(0) }

// ── 2. asistentes: resolver a nodos, separar desconocidos ──
const events = j("./data/messages.jsonl")
const attendees = [...new Set([...(mtg.attendees || []), mtg.organizer].filter(Boolean))].filter((a) => !ME.includes(String(a).toLowerCase()))
const known = [], unknown = []
for (const a of attendees) {
  const node = PEOPLE.find((p) => p.toLowerCase() === String(a).toLowerCase()) || PEOPLE.find((p) => p.toLowerCase().includes(String(a).toLowerCase()) && a.length > 4)
  if (node) {
    const chans = new Set(Object.entries(idmap).filter(([, v]) => v === node).map(([k]) => k))
    const hist = events.filter((e) => chans.has(channelId(e)) || (e.name || "").toLowerCase() === node.toLowerCase()).slice(-6)
    known.push({ name: node, card: cardOf("People", node).slice(0, 500), hist })
  } else unknown.push(a)
}

// ── 3. empresa/tema de la reunión ──
const titleWords = (mtg.title || "").toLowerCase()
const companies = COMPANIES.filter((c) => titleWords.includes(c.toLowerCase()) || c.toLowerCase().split(" ").some((w) => w.length > 4 && titleWords.includes(w)))
const topicKw = (mtg.title || "").toLowerCase().replace(/[^\wáéíóúñ ]/g, " ").split(/\s+/).filter((w) => w.length > 4)
const related = events.filter((e) => { const t = (e.text || "").toLowerCase(); return topicKw.some((k) => t.includes(k)) }).slice(-15)

// ── 3b. investigar desconocidos + empresas (web + LinkedIn) ──
let researchCtx = ""
const topic = (mtg.title || "").replace(/\(.*?\)/g, "").trim()
if (hasWebSearch() || existsSync("./auth/linkedin-cookies.json")) {
  const webTargets = [...unknown.map((u) => ({ name: u, ctx: topic })), ...companies.slice(0, 2).map((c) => ({ name: c, ctx: "empresa" }))]
  const [web, li] = await Promise.all([
    hasWebSearch() ? Promise.all(webTargets.map((t) => researchEntity(t.name, t.ctx).catch(() => null))) : [],
    Promise.all(unknown.map((u) => linkedinProfile(u).catch(() => null))), // LinkedIn solo para personas
  ])
  const parts = []
  web.forEach((f, i) => f && parts.push(`### ${webTargets[i].name} (web)\n${f.profile}`))
  li.forEach((p, i) => p && parts.push(`### ${unknown[i]} (LinkedIn)\n${[p.jobtitle || p.headline, p.location, (p.experience || []).map((e) => `${e.title} @ ${e.company}`).join("; ")].filter(Boolean).join(" · ") || "perfil hallado"}`))
  researchCtx = parts.join("\n\n")
  if (researchCtx) console.log("🌐 investigación (web + LinkedIn) hecha\n")
}

// ── 4. armar contexto y briefing ──
const ctx = [
  researchCtx ? `INVESTIGACIÓN WEB:\n${researchCtx}` : "",
  `REUNIÓN: ${mtg.title}\nCUÁNDO: ${(mtg.start || "").replace("T", " ").slice(0, 16)}\nORGANIZA: ${mtg.organizer || "?"}\nASISTENTES: ${attendees.join(", ")}`,
  companies.length ? `EMPRESAS/TEMA (del grafo):\n${companies.map((c) => cardOf("Companies", c).slice(0, 400)).join("\n---\n")}` : "",
  known.length ? `ASISTENTES CONOCIDOS:\n${known.map((k) => `### ${k.name}\n${k.card}\nÚltimos mensajes:\n${k.hist.map((e) => `[${fmt(e.ts)}][${e.channel}] ${(e.text || "").slice(0, 150)}`).join("\n") || "(sin historial directo)"}`).join("\n\n")}` : "",
  related.length ? `MENSAJES RELACIONADOS AL TEMA:\n${related.map((e) => `[${fmt(e.ts)}][${e.channel}] ${e.name}: ${(e.text || "").slice(0, 180)}`).join("\n")}` : "",
  unknown.length ? `ASISTENTES DESCONOCIDOS (sin datos en el grafo): ${unknown.join(", ")}` : "",
].filter(Boolean).join("\n\n")

console.log(`\n${"═".repeat(64)}\n📅  PREP: ${mtg.title}\n    ${(mtg.start || "").replace("T", " ").slice(0, 16)} · organiza ${mtg.organizer}\n${"═".repeat(64)}`)
console.log(`👥 Asistentes: ${attendees.join(" · ")}`)
console.log(`   ✅ conocidos: ${known.map((k) => k.name).join(", ") || "—"}`)
console.log(`   🔍 a investigar: ${unknown.join(", ") || "—"}\n`)

const brief = await llm(
  `Sos el jefe de gabinete de ${ownerFirst()}${company() ? ` (dueño de ${company()})` : ""}. Preparalo para esta reunión con un BRIEFING accionable en español. Estructura:\n1. 🎯 Objetivo probable de la reunión\n2. 👥 Quién es cada asistente y su relación con ${ownerFirst()} (usá el grafo)\n3. 📌 Estado del tema / últimos avances\n4. ⚠️ Pendientes o puntos calientes a tener presentes\n5. 💡 Qué debería preparar/decir ${ownerFirst()}\n6. 🔍 Sobre los desconocidos: qué conviene averiguar antes\nSé concreto y breve.\n\nCONTEXTO:\n${ctx}`
)
console.log(`${brief.trim()}\n${"═".repeat(64)}`)
if (unknown.length) console.log(`\n💡 Para investigar a ${unknown.join(", ")}: puedo hacer búsqueda web ahora, o enchufar Proxycurl para su LinkedIn. Decime.`)
console.log("")
