// One-off: re-titula las notas "Links para leer" ya categorizadas cuyo texto es una URL → título = la URL
// (así se distinguen entre sí en vez de decir todas "Facebook share link"). Correr: node src/notes-retitle.mjs
import { handle } from "./lib/db-core.mjs"
import { isSecretSelfNote } from "./lib/secret.mjs" // 🔒 no derivar títulos desde notas de canal secreto
const h = handle()
h.pragma("busy_timeout = 60000")
const URLONLY = /^\s*(https?:\/\/\S+)/i
const linkTitle = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").slice(0, 60)
const rows = h.prepare("SELECT n.id, m.text, m.channel, m.account, m.jid FROM note_meta n JOIN messages m ON m.id=n.id WHERE n.status='active' AND n.category='Links para leer'").all().filter((r) => !isSecretSelfNote(r))
const upd = h.prepare("UPDATE note_meta SET title=? WHERE id=?")
let n = 0
for (const r of rows) { const um = String(r.text || "").match(URLONLY); if (um) { upd.run(linkTitle(um[1]), r.id); n++ } }
console.log("links re-titulados con su URL:", n, "/", rows.length)
process.exit(0)
