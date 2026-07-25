// One-off: recupera notas mandadas a junk por error (ej. rate-limit que devolvió vacío en el backfill rápido).
// Borra de note_meta el junk cuyo texto NO es ruido real (no matchea el pre-filtro) → vuelven a estar sin categorizar
// y el cron las re-procesa. El junk que SÍ es ruido de la app (self-test/verificaciones) se queda. Correr: node src/notes-recover.mjs
import { handle } from "./lib/db-core.mjs"

const NOISE = /verás este mensaje|verifica( tu| cuenta)|el env[íi]o|self.?test|prueba de env|c[óo]digo de verif|verification|comms.?hub|no.?reply|tu cuenta de email/i
const h = handle()
h.pragma("busy_timeout = 60000")
const rows = h.prepare("SELECT n.id, m.text, m.summary FROM note_meta n JOIN messages m ON m.id=n.id WHERE n.status='junk'").all()
const del = h.prepare("DELETE FROM note_meta WHERE id=?")
let recovered = 0
for (const r of rows) { const t = r.summary || r.text || ""; if (!NOISE.test(t)) { del.run(r.id); recovered++ } }
console.log("junk no-ruido reseteados a re-categorizar:", recovered, "· junk-ruido restante:", h.prepare("SELECT COUNT(*) c FROM note_meta WHERE status='junk'").get().c)
process.exit(0)
