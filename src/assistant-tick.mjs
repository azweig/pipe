// Una corrida del ASISTENTE (lo lanza el daemon cada 60s). Script propio y no `node -e`: con -e Node trata el
// código como CommonJS y el await de nivel superior explota.
import { loadEnv } from "./lib/env.mjs"
loadEnv()
const { runAssistant } = await import("./lib/brain/assistant.mjs")
const r = await runAssistant().catch((e) => ({ error: e.message }))
if (r?.error) console.log("[asistente] error:", r.error)
else if (r?.answered) console.log(`[asistente] respondí ${r.answered}`)
else if (r?.skipped && !["apagado", "nada nuevo"].includes(r.skipped)) console.log("[asistente]", r.skipped)
process.exit(0)
