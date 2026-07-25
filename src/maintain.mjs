// Mantenimiento periódico: auto-sana thread_stats (rebuild si quedó desincronizado) + corrige hilos-fantasma de grupos.
// Corre como CRON (proceso APARTE), NO en el event loop del server: antes esto bloqueaba el HTTP ~3s cada 30 min
// (rebuildStats ~1.6s + fixGroupLeaks ~1.4s sobre 1.5GB) — el freeze que marcó el arquitecto. Uso: node src/maintain.mjs
import { loadEnv } from "./lib/env.mjs"
import { ensureStats, fixGroupLeaks } from "./lib/maintenance.mjs"

loadEnv()

try { ensureStats() } catch (e) { console.error("[maintain] ensureStats:", e.message) }
try { fixGroupLeaks() } catch (e) { console.error("[maintain] fixGroupLeaks:", e.message) }
console.log("[maintain] ✅ stats + hilos-fantasma revisados")
