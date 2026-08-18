// Indexador RAG — convierte cada mensaje + nota del vault en un vector semántico (data/rag.jsonl).
// INCREMENTAL: solo indexa lo nuevo (por id). Corre en el daemon cada N min. Uso: node src/rag-index.mjs
import { readFileSync, existsSync, appendFileSync, readdirSync, statSync } from "fs"
import { loadEnv } from "./lib/env.mjs"
import { embed } from "./lib/embed.mjs"
import { streamJsonl } from "./lib/jsonl.mjs"
import { isSecretJsonl } from "./lib/secret.mjs" // 🔒 lo que entra al índice sale en respuestas de IA: los canales secretos no entran
import { computeThread } from "./lib/thread.mjs" // el jsonl NO trae `thread` (lo calcula la ingesta): hay que calcularlo para guardarlo

loadEnv()

const OUT = "./data/rag.jsonl"
const have = new Set()
// STREAMING obligatorio: el propio índice ya pesa >512MB y leerlo como un solo string tira ERR_STRING_TOO_LONG
// (tope de string de Node). Cuando pasó, este job crasheaba ANTES de indexar nada y el índice quedó congelado un
// mes entero, en silencio: la búsqueda semántica seguía respondiendo, pero sin ver nada nuevo.
if (existsSync(OUT)) await streamJsonl(OUT, (r) => { if (r && r.id) have.add(r.id) })

let added = 0, saltados = 0
// `thread` va en la línea a propósito: sin él, quien consulta el índice no puede decidir si el mensaje es de un canal
// secreto y el filtro de ask() quedaba ciego. Las notas del vault no tienen hilo y no lo necesitan.
async function add(id, kind, ref, text, ts, thread) {
  if (have.has(id) || !text || text.trim().length < 4) return
  const v = await embed(text)
  if (!v) return
  appendFileSync(OUT, JSON.stringify({ id, kind, ref, text: text.slice(0, 500), ts: ts || 0, ...(thread ? { thread } : {}), vec: v }) + "\n")
  have.add(id); added++
  if (added % 200 === 0) console.log(`  … +${added} indexados`)
}

// 1) mensajes — streaming línea por línea (el jsonl pesa >1GB: readFileSync utf8 rompía con ERR_STRING_TOO_LONG)
await streamJsonl("./data/messages.jsonl", async (r) => {
  if (!r.text || r.text.length < 4 || /^\[(imagen|video|audio|sticker|otro)\]$/.test(r.text)) return
  if (isSecretJsonl(r)) { saltados++; return } // 🔒 número/cuenta secreta: no se vectoriza (si la desmarcás, la próxima corrida la indexa)
  // el hilo se calcula igual que en la ingesta (el jsonl no lo trae) para GUARDARLO en la línea: sin él, quien consulta
  // el índice no puede decidir nada. Va después del filtro para no calcularlo dos veces por cada línea de un jsonl de >1GB.
  const thread = r.thread || computeThread(r)
  // MISMA fórmula de id que la ingesta (src/lib/ingest-repo.mjs normalizeRec): si no coincide, el ítem no se puede
  // resolver contra la DB y ask() lo descarta por las dudas → perdés recall en silencio.
  const id = "msg:" + (r.id || `${r.channel}:${r.ts}:${(r.name || "").slice(0, 12)}`)
  await add(id, "msg", `${r.channel}/${r.group || r.name || ""}`, `${r.name || ""}${r.group ? " en " + r.group : ""}: ${r.text}`, r.ts, thread)
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
// 🔒 las notas del vault entran al índice como `note:` y el filtro de ask() las deja pasar sin revisar (no son mensajes de
// un canal, así que no hay fila que consultar). La cuarentena las saca del vault, pero esto es el cinturón: si por lo que
// sea una nota de una cuenta secreta sigue acá, no se vectoriza.
const { esNotaSecreta, objetivosSecretos } = await import("./lib/secret-vault.mjs")
const _objs = objetivosSecretos()
for (const path of walk("./vault")) {
  const rel = path.replace("./vault/", "")
  let md; try { md = readFileSync(path, "utf8") } catch { continue }
  if (esNotaSecreta(path, md, _objs)) { saltados++; continue }
  const cs = chunks(md)
  const mt = statSync(path).mtimeMs
  for (let i = 0; i < cs.length; i++) await add(`note:${rel}#${i}`, "note", rel.replace(/\.md$/, ""), cs[i], mt)
}

console.log(`✅ RAG index: +${added} nuevos · total ${have.size} vectores${saltados ? ` · ${saltados} omitidos por secretos 🔒` : ""}`)
