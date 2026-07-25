// One-off: re-junk de notas ACTIVAS que en realidad son ruido de la app/sistema (self-test, verificaciones)
// por si quedaron mal categorizadas antes de agregar el pre-filtro. Correr: node src/notes-rejunk.mjs
import { handle } from "./lib/db-core.mjs"

const NOISE = /verás este mensaje|verifica( tu| cuenta)|el env[íi]o|self.?test|prueba de env|c[óo]digo de verif|verification|comms.?hub|no.?reply|tu cuenta de email/i
const h = handle()
h.pragma("busy_timeout = 60000")
const rows = h.prepare("SELECT n.id, m.text, m.summary FROM note_meta n JOIN messages m ON m.id=n.id WHERE n.status='active'").all()
const upd = h.prepare("UPDATE note_meta SET status='junk', category=NULL WHERE id=?")
let fixed = 0
for (const r of rows) { const t = r.summary || r.text || ""; if (NOISE.test(t)) { upd.run(r.id); fixed++ } }
console.log("re-junk:", fixed, "· activos restantes:", h.prepare("SELECT COUNT(*) c FROM note_meta WHERE status='active'").get().c)
process.exit(0)
