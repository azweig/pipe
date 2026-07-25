import { handle } from "./lib/db-core.mjs"
const h = handle()
const q = (s) => h.prepare(s).get().c
const ssh = q("SELECT COUNT(*) c FROM messages WHERE thread='self' AND lower(text) LIKE '%acceso ssh%'")
const sshU = q("SELECT COUNT(DISTINCT lower(trim(text))) c FROM messages WHERE thread='self' AND lower(text) LIKE '%acceso ssh%'")
console.log("acceso ssh → filas:", ssh, "· textos únicos:", sshU)
const lp = q("SELECT COUNT(*) c FROM note_meta WHERE category='Links para leer' AND status='active'")
const lpU = q("SELECT COUNT(DISTINCT lower(trim(substr(coalesce(nullif(m.summary,''),m.text),1,120)))) c FROM note_meta n JOIN messages m ON m.id=n.id WHERE n.category='Links para leer' AND n.status='active'")
console.log("Links para leer → filas:", lp, "· contenidos únicos:", lpU)
const s = h.prepare("SELECT m.text, n.title FROM note_meta n JOIN messages m ON m.id=n.id WHERE n.title LIKE '%Facebook%' AND n.status='active' LIMIT 5").all()
console.log("muestra de 'Facebook…' (texto crudo → título):")
for (const x of s) console.log("   ", String(x.text || "").slice(0, 66), "  →  ", x.title)
process.exit(0)
