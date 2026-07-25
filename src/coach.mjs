// Paso 5 — Coach ejecutivo proactivo. Analiza eventos + grafo + agenda → detecta pendientes/patrones → PROPONE.
// Persiste nudges (los re-insiste y escala prioridad hasta resolver) en data/coach-nudges.json. Reporte en data/coach-report.md.
// Uso: node src/coach.mjs            (genera/actualiza el digest)
//      node src/coach.mjs --done <key>   ·   --snooze <key>
import { readFileSync, existsSync, readdirSync, writeFileSync } from "fs"
import { ownerFirst, company, tz } from "./lib/hub.mjs"
import { llm } from "./lib/llm.mjs"
import { promises as promisesSig, unansweredQuestions, waitingOnThem, recentNotes, importanceMap, pendingReplies } from "./lib/signals.mjs"
import { UNTRUSTED_NOTE } from "./lib/safety.mjs"

const j = (f) => (existsSync(`./data/${f}`) ? readFileSync(`./data/${f}`, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) : [])
const idmap = existsSync("./data/identity-map.json") ? JSON.parse(readFileSync("./data/identity-map.json", "utf8")) : {}
const channelId = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)
const NOW = Date.now(), DAY = 86400000
const STORE = "./data/coach-nudges.json"
const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : {}

// comandos de gestión
const arg = process.argv[2]
if (arg === "--done" || arg === "--snooze") {
  const k = process.argv.slice(3).join(" ")
  if (store[k]) { store[k].status = arg === "--done" ? "done" : "snoozed"; store[k].snoozed_until = arg === "--snooze" ? NOW + 3 * DAY : 0; writeFileSync(STORE, JSON.stringify(store, null, 2)); console.log(`✔ ${k} → ${store[k].status}`) }
  else console.log("no existe:", k)
  process.exit(0)
}

// último contacto por hilo desde la DB (recencia REAL) — ya NO leemos el messages.jsonl gigante (superaba el límite de string de Node)
let lastByThread = {}
try { const { allThreadLastTs } = await import("./lib/db.mjs"); for (const r of allThreadLastTs()) lastByThread[r.thread] = r.last_ts } catch {}

// ── 1. señales estructurales ──
// a) pendientes de respuesta (último mensaje entrante) — desde la DB
const pending = pendingReplies({ limit: 25 })

// b) contactos importantes sin hablar hace tiempo
const stale = []
const people = existsSync("./vault/People") ? readdirSync("./vault/People").filter((f) => f.endsWith(".md")) : []
for (const f of people) {
  const md = readFileSync(`./vault/People/${f}`, "utf8")
  const tags = (md.match(/tags: \[(.*?)\]/)?.[1] || "")
  if (!/cliente|inversor|socio|partner|proveedor/.test(tags)) continue
  const name = f.slice(0, -3)
  // último contacto REAL desde la DB (los hilos se llaman por el nombre del contacto) — no del JSONL chico (daría fechas falsas)
  const last = lastByThread[name] || 0
  if (!last) continue // sin conversación conocida → no inventar "561 días"
  const age = Math.round((NOW - last) / DAY)
  if (age > 14 && age < 3650) stale.push({ key: `reconectar:${name}`, name, tags: tags.replace(/[\[\]]/g, ""), ageDays: age })
}
stale.sort((a, b) => b.ageDays - a.ageDays)

// c) reuniones próximas 48h
const cal = [...j("calendar.jsonl"), ...j("calendar-google.jsonl")]
const soon = cal.filter((m) => { const t = Date.parse(m.start || ""); return t > NOW && t < NOW + 2 * DAY }).map((m) => ({ key: `reunion:${(m.title || "").slice(0, 30)}`, title: m.title, start: (m.start || "").slice(0, 16), attendees: (m.attendees || []).slice(0, 6) }))

// ── 2. señales nuevas (DB): promesas, preguntas colgadas, bola en su cancha, notas ──
let proms = [], questions = [], waiting = [], notes = [], imp = {}
try { proms = promisesSig(); questions = unansweredQuestions(); waiting = waitingOnThem(); notes = recentNotes(); imp = importanceMap() } catch (e) { console.error("signals err:", e.message) }
const impOf = (name) => imp[(name || "").toLowerCase()] || imp[(name || "").toLowerCase().replace(/\s*\(wa\)$/, "")] || 1

// ── CONTEXTO DE IDENTIDAD: quién es cada persona (del grafo/vault). El coach es proactivo → no puede asumir que ${ownerFirst()}
// recuerda quién es "JL"; tiene que DECIRLE quién es. Si no hay ficha, se marca explícito como no identificado.
function whoIs(name) {
  if (!name) return ""
  const f = `./vault/People/${name.replace(/\//g, "-")}.md`
  if (!existsSync(f)) return ""
  let md = ""; try { md = readFileSync(f, "utf8") } catch { return "" }
  const fm = md.split(/^---$/m)[1] || md
  const get = (k) => (fm.match(new RegExp("^" + k + ":\\s*\\[?(.*?)\\]?\\s*$", "m"))?.[1] || "").replace(/[\[\]]/g, "").trim()
  const tags = get("tags"), orgs = get("orgs"), projects = get("projects")
  const bits = []
  if (tags) bits.push(tags)
  if (orgs) bits.push(`en ${orgs}`)
  if (projects) bits.push(`temas: ${projects.split(",").slice(0, 2).join(", ").trim()}`)
  return bits.join(" · ")
}
const idNames = [...new Set([...pending.map((p) => p.who), ...questions.map((q) => q.who), ...stale.map((s) => s.name)].filter(Boolean))]
const idContext = idNames.map((nm) => `- ${nm}: ${whoIs(nm) || `(SIN ficha en el grafo — contacto que ${ownerFirst()} NO tiene identificado)`}`).join("\n")

// ── 3. el coach digiere y PROPONE (1 llamada) ──
const signals = [
  `PENDIENTES DE RESPUESTA (la última palabra fue del otro):\n${pending.slice(0, 20).map((p) => `- key=${p.key} · ${p.who} (${p.channel}, hace ${p.ageDays}d, importancia ${impOf(p.who)}/5): "${p.lastText}"`).join("\n") || "(ninguno)"}`,
  `PREGUNTAS SIN RESPONDER (te preguntaron algo y quedó colgado):\n${questions.slice(0, 15).map((q) => `- responder:${q.thread} · ${q.who} (hace ${q.ageDays}d): "${q.text}"`).join("\n") || "(ninguna)"}`,
  `PROMESAS TUYAS (dijiste que harías algo — ¿cumpliste?):\n${proms.slice(0, 15).map((p) => `- promesa:${p.thread} · ${p.stillOpen ? "SIN CERRAR" : "quizás ya seguiste"}: "${p.text}"`).join("\n") || "(ninguna)"}`,
  `BOLA EN SU CANCHA (escribiste último, no te respondieron — reinsistir?):\n${waiting.slice(0, 10).map((w) => `- reinsistir:${w.thread} · hace ${w.ageDays}d: "${w.text}"`).join("\n") || "(ninguna)"}`,
  `CONTACTOS IMPORTANTES SIN CONTACTO HACE TIEMPO:\n${stale.slice(0, 12).map((s) => `- key=${s.key} · ${s.name} (${s.tags}) — hace ${s.ageDays}d`).join("\n") || "(ninguno)"}`,
  `REUNIONES EN LAS PRÓXIMAS 48h:\n${soon.map((s) => `- key=${s.key} · ${s.start} ${s.title} (${s.attendees.join(", ")})`).join("\n") || "(ninguna)"}`,
  `NOTAS QUE ${ownerFirst()} SE MANDÓ A SÍ MISMO (ideas/TODOs sin revisar — extraé acciones):\n${notes.slice(0, 20).map((n) => `- "${n.text}"`).join("\n") || "(ninguna)"}`,
  `CONTEXTO DE IDENTIDAD (QUIÉN es cada persona — usalo SIEMPRE para identificarla en el nudge; NO asumas que ${ownerFirst()} la recuerda):\n${idContext || "(nadie)"}`,
].join("\n\n")

const digest = await llm(
  `Sos el COACH EJECUTIVO / asistente proactivo de ${ownerFirst()} (dueño de ${company()}). No esperes, PROPONÉ. Analizá TODAS las señales y devolvé JSON:
{"brief":"2-3 frases: el panorama de HOY para ${ownerFirst()}, en tu voz, directo y humano",
 "focus":["acción concreta y accionable #1 para HOY (con nombre de persona/tema)","#2","#3"],
 "nudges":[{"key":"usá el key= dado o inventá uno estable tipo:sujeto","type":"responder|pregunta|promesa|reinsistir|reconectar|reunion|nota|riesgo","subject":"persona CON su identificación (ej 'JL — colega, equipo producto') o tema","insight":"qué pasa y por qué importa (1-2 frases)","steps":["paso concreto 1","paso 2"],"priority":1-5}],
 "proposals":[{"key":"propuesta:tema","title":"propuesta proactiva","rationale":"patrón recurrente/oportunidad que detectaste","steps":["..."]}]}
Reglas:
- PREGUNTAS sin responder y PROMESAS sin cerrar son ALTA prioridad (son bolas que dejaste caer). Para promesas, el nudge type="promesa" y el insight recuerda qué prometiste.
- Más importancia (inversor/cliente/familia = 4-5) o más días = mayor priority.
- De las NOTAS que ${ownerFirst()} se mandó a sí mismo, extraé TODOs/ideas accionables como nudges type="nota" (ej. "revisá esta idea que te mandaste", "seguí este link").
- IGNORÁ newsletters, promos, notificaciones automáticas, no-reply.
- NÚMEROS Y DÍAS EXACTOS: cualquier "hace Nd" / "N días" / fecha que menciones en insight o subject DEBE ser EXACTAMENTE el que figura en las SEÑALES. Está PROHIBIDO inventar, redondear o cambiar un número de días. Si una señal no trae el dato, NO lo menciones. Nunca digas "más de 3 años" ni un número que no esté en los datos.
- ROLES/VÍNCULOS solo si están en el CONTEXTO DE IDENTIDAD. No inventes que alguien es "cliente/proveedor/relevante para ${company()}" si no lo dice el contexto.
- CRÍTICO — IDENTIFICÁ SIEMPRE A LA PERSONA: en "subject" e "insight" decí QUIÉN es usando el CONTEXTO DE IDENTIDAD (rol/empresa/de qué tema la conocés). Ej: "JL — colega del equipo de producto" en vez de solo "JL". Si el contexto dice que NO está identificada, escribilo tal cual ("contacto de WhatsApp sin identificar, número X") — NUNCA tires un nombre o número suelto que ${ownerFirst()} no pueda ubicar. Sos vos quien tiene que recordar por él.
- En "proposals": oportunidades de negocio, clientes potenciales, mejoras que ${ownerFirst()} debería encarar SIN que nadie se lo pida.
Español, concreto, accionable.

SEÑALES:\n${signals}`,
  { json: true, chain: process.env.LLM_CHAIN_COACH || "openai,gemini", system: UNTRUSTED_NOTE } // openai primero: gemini free-tier da 429 y el coach quedaba mudo
).catch((e) => { console.error("coach LLM err:", e.message); return { nudges: [], proposals: [], brief: "" } })

// ── 3. merge + escalado + persistencia ──
const seen = new Set()
// KEY CANÓNICO: el LLM inventa un key distinto por corrida (promesa:x, promesa:y) para el MISMO contacto → duplicados.
// Derivamos un key estable: por número de contacto, o por el thread si el key ya lo referencia, o por slug del subject.
function canonicalKey(n) {
  const hay = `${n.subject || n.title || ""} ${n.key || ""}`
  const num = hay.match(/\b(\d{9,16})\b/)
  if (num) return `${n.type || "x"}:num:${num[1]}` // mismo número = mismo nudge
  // si el key referencia un thread REAL (canal:… o con @) es estable → usalo tal cual
  if (/(?:whatsapp|email|telegram|instagram|facebook|teams|linkedin):/.test(n.key || "") || /@/.test(n.key || "")) return n.key
  // si no, normalizá por el NÚCLEO del subject (sin descriptores "— cliente", "(WA)", etc.) para colapsar las variantes que inventa el LLM
  const core = (n.subject || n.title || (n.key || "").split(":").slice(1).join(":") || "")
    .split(/\s*[—(·,|]|\s+-\s+/)[0]
    .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)
  return `${n.type || "prop"}:${core || "nudge"}`
}
function upsert(n, kind) {
  const key = canonicalKey(n)
  seen.add(key)
  if (store[key] && store[key].status === "done") return
  if (store[key] && store[key].status === "snoozed" && (store[key].snoozed_until || 0) > NOW) return
  if (store[key]) { store[key] = { ...store[key], ...n, key, kind, times_surfaced: (store[key].times_surfaced || 1) + 1, last_surfaced: NOW, status: "open" } }
  else store[key] = { ...n, key, kind, first_seen: NOW, last_surfaced: NOW, times_surfaced: 1, status: "open" }
}
for (const n of digest.nudges || []) upsert(n, "nudge")
for (const p of digest.proposals || []) upsert(p, "proposal")
// resolver los que ya no aparecen hace >4 días (asumimos atendidos)
for (const k of Object.keys(store)) if (store[k].status === "open" && !seen.has(k) && NOW - (store[k].last_surfaced || 0) > 4 * DAY) store[k].status = "resolved"
writeFileSync(STORE, JSON.stringify(store, null, 2))

// ── 4. render + reporte ──
const open = Object.values(store).filter((n) => n.status === "open")
// prioridad = base + escala por DÍAS abierto + boost por IMPORTANCIA del contacto (inversor/cliente/familia)
const prio = (n) => Math.min(5, (n.priority || 3) + Math.floor((NOW - (n.first_seen || NOW)) / (3 * DAY)) + (impOf(n.subject) >= 4 ? 1 : 0))
open.sort((a, b) => prio(b) - prio(a) || (b.times_surfaced || 1) - (a.times_surfaced || 1))
const P = ["", "🟢", "🟡", "🟠", "🔴", "🔴"]
let out = `# 🧠 Coach — ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n\n`
const nudges = open.filter((n) => n.kind === "nudge"), props = open.filter((n) => n.kind === "proposal")
out += `## ⚡ Acciones (${nudges.length})\n`
for (const n of nudges) out += `\n**${P[prio(n)]} ${n.subject || n.type}** ${n.times_surfaced > 1 ? `· 🔁 recordado ${n.times_surfaced}×` : ""}\n${n.insight || ""}\n${(n.steps || []).map((s) => `  - [ ] ${s}`).join("\n")}\n  \`key: ${n.key}\`\n`
out += `\n## 💡 Propuestas proactivas (${props.length})\n`
for (const p of props) out += `\n**${p.title}** ${p.times_surfaced > 1 ? `· 🔁 ${p.times_surfaced}×` : ""}\n${p.rationale || ""}\n${(p.steps || []).map((s) => `  - ${s}`).join("\n")}\n`
writeFileSync("./data/coach-report.md", out)
// brief del día (para la pestaña IA + push)
writeFileSync("./data/coach-brief.json", JSON.stringify({ text: (digest.brief || "").trim(), focus: (digest.focus || []).slice(0, 3), ts: NOW, nudges: nudges.length, proposals: props.length }))
// notificar al celu 1x/día con el foco del día — solo en horario diurno (Lima), sin spamear
try {
  const F = "./data/push-last.json"
  const last = existsSync(F) ? JSON.parse(readFileSync(F, "utf8")).ts : 0
  const hourLima = +new Date(NOW).toLocaleString("en-US", { timeZone: tz(), hour: "2-digit", hour12: false })
  const foco = (digest.focus || [])[0] || (digest.brief || "").slice(0, 120)
  if (NOW - last > 20 * 3600e3 && hourLima >= 7 && hourLima <= 21 && foco) {
    const push = await import("./lib/push.mjs")
    const r = await push.sendPush({ title: "🎯 Tu foco de hoy", body: foco, url: "/", tag: "daily-brief" })
    if (r.sent) writeFileSync(F, JSON.stringify({ ts: NOW }))
    console.log(`push brief → ${r.sent} dispositivo(s)`)
  }
} catch (e) { console.error("push brief err:", e.message) }
console.log(out)
console.log(`\n(guardado en data/coach-report.md · ${nudges.length} acciones, ${props.length} propuestas · "node src/coach.mjs --done <key>" para cerrar una)`)
