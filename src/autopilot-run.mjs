// Corrida standalone del piloto automático (la lanza el daemon cada ~1min, aislada como video-fetch).
import { setBusyTimeout } from "./lib/db.mjs"
try { setBusyTimeout(30000) } catch {} // el daemon escribe mucho (ingesta 2M+ msgs) → 2s no alcanza y daba "database is locked". Esperar hasta 15s.
import { runAutopilot } from "./lib/brain/autopilot.mjs"
runAutopilot().then(() => process.exit(0)).catch((e) => { console.error("[autopilot]", e && e.message || e); process.exit(1) })
