// PRE-GENERA las tarjetas de eventos del calendario (categoría, asistentes+roles, objetivo, preparación IA).
// Corre en cron (cada ~2h) y al sincronizar el calendario → la UI de calendario/reunión carga instantánea, nada on-click.
import { setBusyTimeout } from "./lib/db.mjs"
import { genMeetingCards } from "./lib/brain.mjs"

try { setBusyTimeout(8000) } catch {}
const n = await genMeetingCards({ horizonDays: 21 })
console.log(`[calendar-prep] ${n} tarjetas de evento pre-generadas`)
process.exit(0)
