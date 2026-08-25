// Watchdog de embeddings / Ollama (safety pedido por el dueño del hub). Cada corrida hace un embed de prueba que:
//   (1) MANTIENE CALIENTE el modelo de embeddings → evita el cold-start que degradaba el RAG semántico del "segundo cerebro" a FTS.
//   (2) chequea salud: si el embed falla N veces SEGUIDAS, reinicia Ollama (systemd local) para destrabarlo.
// Lo corre el daemon cada ~5 min. Standalone (aislado como los otros crons). NO reinicia por un solo timeout (evita flapping).
import { loadEnv } from "./lib/env.mjs"
loadEnv()
import { spawnSync } from "child_process"
import { readFileSync, writeFileSync } from "fs"

const HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const MODEL = process.env.EMBED_MODEL || "nomic-embed-text"
const STATE = "data/.embed-watchdog.json"
const FAIL_LIMIT = 3 // fallos consecutivos antes de reiniciar (un timeout suelto NO reinicia)

async function ping() {
  try {
    const r = await Promise.race([
      fetch(HOST + "/api/embeddings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, prompt: "ping" }) }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 40000)),
    ])
    if (!r.ok) return false
    const d = await r.json()
    return Array.isArray(d.embedding) && d.embedding.length > 0
  } catch { return false }
}
const load = () => { try { return JSON.parse(readFileSync(STATE, "utf8")) } catch { return { fails: 0 } } }
const save = (o) => { try { writeFileSync(STATE, JSON.stringify(o)) } catch {} }

const ok = await ping()
const st = load()
if (ok) {
  if (st.fails) console.log("[embed-wd] embeddings OK de nuevo (se recuperó)")
  save({ fails: 0, lastOk: Date.now() })
} else {
  st.fails = (st.fails || 0) + 1
  console.warn(`[embed-wd] embeddings NO responden (${st.fails}/${FAIL_LIMIT})`)
  if (st.fails >= FAIL_LIMIT) {
    console.warn("[embed-wd] reiniciando ollama para destrabar el motor semántico…")
    const r = spawnSync("systemctl", ["restart", "ollama"], { timeout: 60000 })
    save({ fails: 0, lastRestart: Date.now(), restartCode: r.status })
  } else save(st)
}
process.exit(0)
