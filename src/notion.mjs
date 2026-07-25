// Notion reader (API oficial, token interno — NO expira). Lee las páginas/DBs compartidas con la integración.
// Snapshot de páginas recientes en data/notion.jsonl + novedades (editadas) al feed unificado data/messages.jsonl.
// Config: NOTION_TOKEN en .env (Internal Integration Secret). Compartí páginas con la integración desde Notion.
import { Client } from "@notionhq/client"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import { appendMessage } from "./lib/lock.mjs"

mkdirSync("./data", { recursive: true })
const token = process.env.NOTION_TOKEN || ""
if (!token) { console.log("Falta NOTION_TOKEN en .env"); process.exit(1) }
const notion = new Client({ auth: token })
const stateFile = "./auth/notion.state.json"
const POLL_MS = 120000

let seen = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {}
const saveSeen = () => writeFileSync(stateFile, JSON.stringify(seen))

function rich(arr) { return (Array.isArray(arr) ? arr : []).map((t) => t?.plain_text || "").join("") }
function titleOf(page) {
  if (page.object === "database") return rich(page.title) || "(base de datos)"
  const props = page.properties || {}
  for (const k of Object.keys(props)) {
    const p = props[k]
    if (p?.type === "title") return rich(p.title) || "(sin título)"
  }
  return "(sin título)"
}

async function poll() {
  const res = await notion.search({ sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 50 })
  const items = res.results || []
  const snapshot = []
  for (const it of items) {
    const title = titleOf(it)
    const edited = it.last_edited_time || ""
    const rec = { channel: "notion", account: "notion", id: it.id, type: it.object, title, url: it.url || "", edited }
    snapshot.push(JSON.stringify(rec))
    // novedad: si cambió desde la última vez, va al feed unificado
    if (seen[it.id] !== edited) {
      seen[it.id] = edited
      const feed = { channel: "notion", account: "notion", jid: it.id, name: title, text: `${it.object === "database" ? "🗂️" : "📄"} ${title}`, ts: +new Date(edited || Date.now()), url: it.url || "" }
      appendMessage(feed)
      console.log(`📝 [notion] ${it.object === "database" ? "DB" : "página"}: ${title}`)
    }
  }
  writeFileSync("./data/notion.jsonl", snapshot.join("\n") + (snapshot.length ? "\n" : ""))
  saveSeen()
  console.log(`[notion] ${items.length} páginas/DBs accesibles (snapshot actualizado).`)
}

const me = await notion.users.me()
console.log(`\n✅ [notion] CONECTADO como integración "${me.name || me.bot?.owner?.type || "pipe"}" — leyendo cada ${POLL_MS / 60000} min...\n`)
await poll()
setInterval(() => poll().catch((e) => console.log("[notion] err:", e.message)), POLL_MS)
