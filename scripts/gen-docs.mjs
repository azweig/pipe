// Genera docs/REFERENCE.md AUTOMÁTICAMENTE escaneando el código → la documentación no se desactualiza.
// Correr tras cambios grandes:  node scripts/gen-docs.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

const read = (f) => readFileSync(f, "utf8")
function modules() {
  const files = []
  for (const dir of ["src", "src/lib"]) for (const f of readdirSync(dir)) if (f.endsWith(".mjs")) files.push(join(dir, f))
  return files.sort()
}
// exports + el comentario que los precede (doc)
function exportsOf(file) {
  const lines = read(file).split("\n"); const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export (async function|function|const|class) (\w+)/)
    if (!m) continue
    let doc = ""; for (let k = i - 1; k >= 0 && /^\s*\/\//.test(lines[k]); k--) doc = lines[k].replace(/^\s*\/\/\s?/, "") + (doc ? " " + doc : "")
    out.push({ name: m[2], kind: m[1].replace("async function", "async").replace("function", "fn"), doc: doc.slice(0, 180) })
  }
  return out
}
function endpoints() {
  const out = []
  for (const line of read("src/server.mjs").split("\n")) {
    const m = line.match(/path === "(\/api\/[^"]+)"(?:\s*&&\s*req\.method === "(\w+)")?/)
    if (!m) continue
    const cm = line.match(/\/\/\s?(.+?)\s*$/) // comentario inline como summary
    out.push({ path: m[1], method: m[2] || "GET", summary: cm ? cm[1].slice(0, 130) : "" })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
function dbSchema() {
  const s = read("src/lib/db.mjs")
  const tables = [...new Set([...s.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/g)].map((m) => m[1]))]
  const indexes = [...s.matchAll(/CREATE INDEX(?: IF NOT EXISTS)?\s+(\w+) ON (\w+)\s*\(([^)]+)\)/g)].map((m) => `${m[1]} → ${m[2]}(${m[3]})`)
  const cols = [...s.matchAll(/ADD COLUMN (\w+)/g)].map((m) => m[1])
  return { tables, indexes, cols }
}
function daemon() {
  const s = read("src/daemon.mjs")
  const readers = [...s.matchAll(/\["([a-z-]+)", NODE, \["(src\/[^"]+)"\]\]/g)].map((m) => `${m[1]} \`${m[2]}\``)
  const jobs = [...s.matchAll(/setInterval\((run\w+),\s*([^,)]+)\)/g)].map((m) => `${m[1]} — cada ${m[2].trim()}`)
  return { readers, jobs }
}

const ep = endpoints(), db = dbSchema(), dm = daemon(), mods = modules()
let md = `# pipe.one — Referencia técnica (AUTO-GENERADA)\n\n> Generado por \`node scripts/gen-docs.mjs\`. **No editar a mano** — se regenera. Última corrida: (stamp al commitear).\n\n`
md += `## 🌐 API — ${ep.length} endpoints\n\n| Método | Endpoint |\n|---|---|\n${ep.map((e) => `| ${e.method} | \`${e.path}\` |`).join("\n")}\n\n`
md += `## 🗄️ Base de datos (SQLite)\n\n**Tablas:** ${db.tables.map((t) => `\`${t}\``).join(", ")}\n\n**Columnas migradas:** ${db.cols.map((c) => `\`${c}\``).join(", ") || "—"}\n\n**Índices:**\n${db.indexes.map((i) => `- \`${i}\``).join("\n")}\n\n`
md += `## ⚙️ Daemon (supervisor)\n\n**Readers (auto-restart):**\n${dm.readers.map((r) => `- ${r}`).join("\n")}\n\n**Jobs periódicos:**\n${dm.jobs.map((j) => `- ${j}`).join("\n")}\n\n`
md += `## 📦 Módulos (${mods.length}) y sus exports\n\n`
for (const f of mods) {
  const ex = exportsOf(f); if (!ex.length) continue
  md += `### \`${f}\`\n${ex.map((e) => `- **${e.name}** *(${e.kind})*${e.doc ? ` — ${e.doc}` : ""}`).join("\n")}\n\n`
}
mkdirSync("docs", { recursive: true })
writeFileSync("docs/REFERENCE.md", md)

// ── openapi.json: preserva los paths ya especificados (con schema detallado) y AGREGA los faltantes con summary del comentario ──
let base = {}
try { base = JSON.parse(read("docs/openapi.json")) } catch {}
const paths = { ...(base.paths || {}) }
let added = 0
for (const e of ep) {
  const p = (paths[e.path] = paths[e.path] || {})
  const meth = e.method.toLowerCase()
  if (!p[meth]) { p[meth] = { summary: e.summary || e.path.split("/").slice(-1)[0].replace(/-/g, " "), responses: { "200": { description: "OK" } } }; added++ }
}
const openapi = { openapi: base.openapi || "3.0.3", info: base.info || { title: "pipe.one API", version: "1.0.0" }, ...(base.servers ? { servers: base.servers } : {}), ...(base.tags ? { tags: base.tags } : {}), paths: Object.fromEntries(Object.keys(paths).sort().map((k) => [k, paths[k]])) }
writeFileSync("docs/openapi.json", JSON.stringify(openapi, null, 2))
console.log(`✅ docs/REFERENCE.md — ${ep.length} endpoints · ${db.tables.length} tablas · ${db.indexes.length} índices · ${mods.length} módulos`)
console.log(`✅ docs/openapi.json — ${Object.keys(paths).length} paths (${added} agregados, resto conservados)`)
