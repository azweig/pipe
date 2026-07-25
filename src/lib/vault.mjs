// Vault Obsidian propio — cada nota = un nodo (persona/empresa/proyecto/tema). [[wikilinks]] = aristas.
// Nodos "semilla" (seed:true) = verdad autoritativa que da el usuario; graphify NO los pisa, solo les suma Timeline.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "fs"

const ROOT = "./vault"
const FOLDER = { person: "People", company: "Companies", project: "Projects", topic: "Topics" }
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : [])
const uniq = (a) => [...new Set((a || []).filter(Boolean))]

export function slug(name) { return (name || "").trim().replace(/[\/\\:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").slice(0, 80) }
function pathFor(type, name) { return `${ROOT}/${FOLDER[type] || "Topics"}/${slug(name)}.md` }
function ensure(type) { mkdirSync(`${ROOT}/${FOLDER[type] || "Topics"}`, { recursive: true }) }

// --- frontmatter mínimo (strings y arrays de strings) ---
function parse(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: md }
  const fm = {}
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w[\w-]*):\s*(.*)$/); if (!mm) continue
    const k = mm[1], v = mm[2].trim()
    if (v.startsWith("[") && v.endsWith("]")) fm[k] = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    else fm[k] = v.replace(/^["']|["']$/g, "")
  }
  return { fm, body: m[2] }
}
function serialize(fm, body) {
  // SANITIZAR: aliases/tags/etc vienen del LLM (graphify). Un valor con newline crearía un `---` suelto que rompe el frontmatter;
  // una coma o `]` rompería el array. Quitamos newlines/brackets/comas de cada item y newlines de los escalares.
  const cleanItem = (s) => String(s).replace(/[\r\n]+/g, " ").replace(/[[\],]/g, "").trim()
  const cleanScalar = (s) => String(s).replace(/[\r\n]+/g, " ").trim()
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(cleanItem).filter(Boolean).join(", ")}]` : cleanScalar(v)}`)
  return `---\n${lines.join("\n")}\n---\n${body}`
}

// --- manejo de secciones "## X" del cuerpo ---
function getSectionLines(body, header) {
  const lines = (body || "").split("\n"); const s = lines.findIndex((l) => l.trim() === header)
  if (s === -1) return []
  const out = []
  for (let i = s + 1; i < lines.length; i++) { if (lines[i].startsWith("## ")) break; if (lines[i].startsWith("- ")) out.push(lines[i]) }
  return out
}
function replaceSection(body, header, content) {
  const lines = (body || "").split("\n"); const s = lines.findIndex((l) => l.trim() === header)
  if (s === -1) return (body || "").replace(/\s*$/, "") + `\n\n${header}\n${content}\n`
  let e = lines.length
  for (let i = s + 1; i < lines.length; i++) if (lines[i].startsWith("## ")) { e = i; break }
  return [...lines.slice(0, s + 1), content, ...lines.slice(e)].join("\n")
}

// --- escribir un nodo SEMILLA (autoritativo). Preserva Timeline previo. ---
export function writeSeedNote(type, name, extra = {}, bodyMd = "") {
  ensure(type); const path = pathFor(type, name)
  let fm = { type, seed: "true", aliases: [], channels: [], tags: [], orgs: [], projects: [], role: "", relation: "", first_seen: "", last_seen: "", mentions: "0" }
  let prevBody = ""
  if (existsSync(path)) { const p = parse(readFileSync(path, "utf8")); fm = { ...fm, ...p.fm }; prevBody = p.body }
  for (const k of ["aliases", "channels", "tags", "orgs", "projects"]) fm[k] = uniq([...arr(fm[k]), ...arr(extra[k])])
  for (const k of ["role", "relation"]) if (extra[k]) fm[k] = extra[k]
  fm.seed = "true"
  const prevTl = getSectionLines(prevBody, "## Timeline")
  const body = `${bodyMd.trim()}\n\n## Timeline\n${prevTl.join("\n")}\n`
  writeFileSync(path, serialize(fm, body)); return path
}

// --- upsert de graphify. Si el nodo es semilla, solo suma Timeline + aliases/channels (no pisa el cuerpo). ---
export function upsertNode(type, name, patch = {}, timeline = []) {
  ensure(type); const path = pathFor(type, name)
  let fm = { type, aliases: [], channels: [], orgs: [], projects: [], tags: [], first_seen: "", last_seen: "", mentions: "0" }
  let body = ""
  if (existsSync(path)) { const p = parse(readFileSync(path, "utf8")); fm = { ...fm, ...p.fm }; body = p.body }

  for (const k of ["aliases", "channels", "orgs", "projects", "tags"]) if (patch[k]) fm[k] = uniq([...arr(fm[k]), ...arr(patch[k])])
  const dates = timeline.map((t) => t.date).filter(Boolean)
  if (dates.length) { fm.first_seen = [fm.first_seen, ...dates].filter(Boolean).sort()[0]; fm.last_seen = [fm.first_seen, ...dates].filter(Boolean).sort().reverse()[0] }
  fm.mentions = String((parseInt(fm.mentions) || 0) + timeline.length)

  const prevTl = getSectionLines(body, "## Timeline")
  const tl = uniq([...prevTl, ...timeline.map((t) => `- ${t.date} ${t.line}`.trim())]).sort().slice(-200)

  if (fm.seed === "true") { // NO pisar cuerpo autoritativo, solo Timeline
    body = replaceSection(body, "## Timeline", tl.join("\n"))
    writeFileSync(path, serialize(fm, body)); return path
  }

  // nodo normal: regenerar Relaciones + Timeline
  const sec = splitSections(body)
  const rel = uniq([...(fm.orgs || []).map((o) => `- 🏢 [[${o}]]`), ...(fm.projects || []).map((p) => `- 📁 [[${p}]]`)])
  if (rel.length) sec["## Relaciones"] = "\n" + rel.join("\n") + "\n"
  sec["## Timeline"] = "\n" + tl.join("\n") + "\n"
  writeFileSync(path, serialize(fm, renderSections(sec, name))); return path
}

function splitSections(body) {
  const out = { __title: "" }; let cur = "__title"
  for (const line of (body || "").split("\n")) {
    if (line.startsWith("## ")) { cur = line.trim(); out[cur] = "" }
    else if (line.startsWith("# ") && cur === "__title") out.__title += line + "\n"
    else out[cur] = (out[cur] || "") + line + "\n"
  }
  return out
}
function renderSections(sec, name) {
  let out = sec.__title && sec.__title.includes("# ") ? sec.__title : `# ${name}\n`
  const order = ["## Resumen", "## Relaciones", "## Timeline"]
  const keys = [...order.filter((k) => sec[k] !== undefined), ...Object.keys(sec).filter((k) => k.startsWith("## ") && !order.includes(k))]
  for (const k of keys) out += `\n${k}\n${sec[k] || ""}`
  return out.replace(/\n{3,}/g, "\n\n")
}

// --- fusionar un nodo duplicado dentro del canónico (mueve Timeline + channels, borra el dup) ---
export function mergeNotes(type, fromName, intoName) {
  const fp = pathFor(type, fromName)
  if (!existsSync(fp) || slug(fromName) === slug(intoName)) return false
  const from = parse(readFileSync(fp, "utf8"))
  const tl = getSectionLines(from.body, "## Timeline").map((l) => { const m = l.match(/^- (\d{4}-\d\d-\d\d) (.*)$/); return m ? { date: m[1], line: m[2] } : { date: "", line: l.replace(/^- /, "") } })
  upsertNode(type, intoName, { aliases: [fromName, ...arr(from.fm.aliases)], channels: arr(from.fm.channels), orgs: arr(from.fm.orgs), projects: arr(from.fm.projects) }, tl)
  unlinkSync(fp); return true
}

export function noteExists(type, name) { return existsSync(pathFor(type, name)) }

// --- reescribir [[alias]] → [[canónico]] en TODAS las notas (colapsa nodos fantasma) ---
export function normalizeVaultLinks(rev) {
  let changed = 0
  for (const folder of ["People", "Companies", "Projects", "Topics"]) {
    const dir = `${ROOT}/${folder}`; if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue
      const p = `${dir}/${f}`; const src = readFileSync(p, "utf8")
      const out = src.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, name) => { const c = rev[name.trim().toLowerCase()]; return c && c !== name.trim() ? `[[${c}]]` : m })
      if (out !== src) { writeFileSync(p, out); changed++ }
    }
  }
  return changed
}

// --- mapa de identidad y alias ---
const IDMAP = "./data/identity-map.json"
export function loadIdentity() { return existsSync(IDMAP) ? JSON.parse(readFileSync(IDMAP, "utf8")) : {} }
export function saveIdentity(map) { writeFileSync(IDMAP, JSON.stringify(map, null, 2)) }
