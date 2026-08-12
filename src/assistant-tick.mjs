// Una corrida del ASISTENTE (lo lanza el daemon cada 60s). Script propio y no `node -e`: con -e Node trata el
// código como CommonJS y el await de nivel superior explota.
import { loadEnv } from "./lib/env.mjs"
loadEnv()
// La ingesta escribe en la misma DB cada 15s. El busy_timeout por defecto (2s) es muy corto para un proceso corto
// que compite con ella: el tick moría con "database is locked" y la pregunta quedaba sin responder. 20s = espera,
// no falla. (SQLite bloquea a nivel archivo; esto no roba tiempo a nadie, solo hace cola.)
const { setBusyTimeout } = await import("./lib/db.mjs")
try { setBusyTimeout(20000) } catch {}
const { runAssistant } = await import("./lib/brain/assistant.mjs")
const r = await runAssistant().catch((e) => ({ error: e.message }))
if (r?.error) console.log("[asistente] error:", r.error)
else if (r?.answered) console.log(`[asistente] respondí ${r.answered}`)
else if (r?.skipped && !["apagado", "nada nuevo"].includes(r.skipped)) console.log("[asistente]", r.skipped)
process.exit(0)
