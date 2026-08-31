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

// ¿ESTÁ VIVO? — distinto de ¿está libre? /api/tags no infiere: contesta al toque aunque haya una generación en curso.
// Ollama atiende de a UNO: mientras un cron largo ocupa el motor, cualquier otra llamada espera en la cola.
async function vivo() {
  try {
    const r = await Promise.race([
      fetch(HOST + "/api/tags"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ])
    return !!(r && r.ok)
  } catch { return false }
}

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
// ⚠️ ESTE VIGILANTE SE PEGABA UN TIRO EN EL PIE. El ping de embeddings espera 40s, pero ollama atiende de a uno:
// mientras graphify ocupaba el motor ~200s por lote, el ping se encolaba y vencía. A los 3 fallos seguidos —o sea
// 15 minutos de trabajo normal— reiniciaba ollama y MATABA el lote en curso. Como graphify no avanza el offset si
// falló algún lote, reempezaba de cero y volvía a pasar lo mismo: un ciclo infinito, con el grafo sin actualizar.
// Un motor OCUPADO no es un motor MUERTO. Antes de reiniciar nada se pregunta si está vivo con una llamada que no
// infiere; si contesta, está trabajando y no se toca.
if (!ok && (await vivo())) {
  console.log("[embed-wd] el embed no entró a tiempo, pero ollama responde: está ocupado, no colgado → no lo toco")
  save({ fails: 0, lastBusy: Date.now() })
} else if (ok) {
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
