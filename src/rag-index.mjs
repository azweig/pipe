// Indexador RAG — convierte cada mensaje + nota del vault en un vector semántico (data/rag.jsonl).
// INCREMENTAL: solo indexa lo nuevo (por id). Corre en el daemon cada N min. Uso: node src/rag-index.mjs
import { readFileSync, existsSync, appendFileSync, readdirSync, statSync } from "fs"
import { loadEnv } from "./lib/env.mjs"
import { embed } from "./lib/embed.mjs"
import { streamJsonl } from "./lib/jsonl.mjs"

loadEnv()

const OUT = "./data/rag.jsonl"
const have = new Set()
if (existsSync(OUT)) for (const l of readFileSync(OUT, "utf8").split("\n")) { if (!l) continue; try { have.add(JSON.parse(l).id) } catch {} }

let added = 0
async function add(id, kind, ref, text, ts) {
  if (have.has(id) || !text || text.trim().length < 4) return
  const v = await embed(text)
  if (!v) return
  appendFileSync(OUT, JSON.stringify({ id, kind, ref, text: text.slice(0, 500), ts: ts || 0, vec: v }) + "\n")
  have.add(id); added++
  if (added % 200 === 0) console.log(`  … +${added} indexados`)
}

// 1) mensajes — streaming línea por línea (el jsonl pesa >1GB: readFileSync utf8 rompía con ERR_STRING_TOO_LONG)
await streamJsonl("./data/messages.jsonl", async (r) => {
  if (!r.text || r.text.length < 4 || /^\[(imagen|video|audio|sticker|otro)\]$/.test(r.text)) return
  const id = "msg:" + (r.id || `${r.ts}:${r.channel}`)
  await add(id, "msg", `${r.channel}/${r.group || r.name || ""}`, `${r.name || ""}${r.group ? " en " + r.group : ""}: ${r.text}`, r.ts)
})

// 1.5) items de redes sociales (IG/FB/LinkedIn) → el ask() global conoce lo que pasó en tus feeds
if (existsSync("./data/social-items.jsonl")) {
  for (const l of readFileSync("./data/social-items.jsonl", "utf8").split("\n")) {
    if (!l.trim()) continue
    let r; try { r = JSON.parse(l) } catch { continue }
    if (!r.que || r.que.length < 6) continue
    await add(`social:${r.network}:${r.ts}:${(r.quien || "").slice(0, 12)}`, "social", `${r.network}/${r.cat || ""}`, `[${r.network}] ${r.quien}: ${r.que}`, r.ts)
  }
}

// 2) vault (People/Companies/Projects/_Brain) — en chunks por párrafo
function walk(dir) { const out = []; if (!existsSync(dir)) return out; for (const f of readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${f.name}`; if (f.isDirectory()) out.push(...walk(p)); else if (f.name.endsWith(".md")) out.push(p) } return out }
function chunks(md) { const parts = md.replace(/^---[\s\S]*?---/, "").split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length > 40); const out = []; let buf = ""; for (const p of parts) { if ((buf + p).length > 700) { if (buf) out.push(buf); buf = p } else buf += (buf ? "\n" : "") + p } if (buf) out.push(buf); return out }
for (const path of walk("./vault")) {
  const rel = path.replace("./vault/", "")
  let md; try { md = readFileSync(path, "utf8") } catch { continue }
  const cs = chunks(md)
  const mt = statSync(path).mtimeMs
  for (let i = 0; i < cs.length; i++) await add(`note:${rel}#${i}`, "note", rel.replace(/\.md$/, ""), cs[i], mt)
}

console.log(`✅ RAG index: +${added} nuevos · total ${have.size} vectores`)
