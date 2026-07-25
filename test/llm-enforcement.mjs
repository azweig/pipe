// ENFORCEMENT DE PRIVACIDAD (contra el incidente de cloud-leak de 9M tok/día).
// El test anterior (llm-privacy) testeaba smartChain SUELTO — que nadie llamaba. Este ancla en el CAMINO REAL:
// summarizeMeeting → llmSafe → llm(). Reproduce la fuga que el reviewer confirmó: reunión sensible + ollama caído → antes caía a Gemini.
// Hermético: cwd temporal (NO toca tu data/ real ni tus keys BYOK) + fetch stubbeado.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-enf-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
// config BYOK de prueba: gemini CON key → la nube es POSIBLE. Así probamos que NO se usa por privacidad (no que falta key).
writeFileSync(join(dir, "data", "llm-config.json"), JSON.stringify({ chain: ["gemini", "ollama"], keys: {}, models: {} }))
process.env.GEMINI_API_KEY = "test-key"
process.env.OLLAMA_HOST = "http://127.0.0.1:11434"
delete process.env.SENSITIVE_ALLOW_CLOUD // fail-closed por defecto
delete process.env.LLM_CHAIN_SENSITIVE
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

const CLOUD = /generativelanguage\.googleapis\.com|api\.openai\.com|anthropic\.com/i
const hits = []
// ollama (11434) siempre TIRA (simula el hang/error normal del box CPU); cualquier otra respuesta OK (para detectar si SE llamó a la nube)
global.fetch = async (url) => {
  const u = String(url); hits.push(u)
  if (/11434/.test(u)) throw new Error("ollama down (simulado)")
  return { ok: true, status: 200, json: async () => ({ response: "x", candidates: [{ content: { parts: [{ text: "x" }] } }] }) }
}

const { smartChain } = await import("../src/lib/llm.mjs")
const { summarizeMeeting } = await import("../src/lib/meetings.mjs")

test("smartChain: sensible sin escape → SOLO ollama (local); con escape consciente → ollama,gemini", () => {
  delete process.env.SENSITIVE_ALLOW_CLOUD
  assert.equal(smartChain({ sensitive: true }), "ollama", "sensible sin escape debe ser local-only")
  process.env.SENSITIVE_ALLOW_CLOUD = "1"
  assert.match(smartChain({ sensitive: true }), /gemini|openai|anthropic/, "con escape global usa la cadena BYOK (incluye nube)")
  delete process.env.SENSITIVE_ALLOW_CLOUD
})

test("paridad política sensible: SOLO '1' prende la nube — '0'/''/'false'/undefined = local (fail-CLOSED en el valor intuitivo)", () => {
  // daemon.mjs / enrich-convos.mjs / resync(server.mjs) ahora TODOS derivan de smartChain → esta tabla es su contrato único.
  delete process.env.LLM_CHAIN_SENSITIVE
  for (const v of [undefined, "", "0", "false", "no"]) {
    if (v === undefined) delete process.env.SENSITIVE_ALLOW_CLOUD; else process.env.SENSITIVE_ALLOW_CLOUD = v
    assert.equal(smartChain({ sensitive: true }), "ollama", `SENSITIVE_ALLOW_CLOUD=${JSON.stringify(v)} debe ser local-only`)
  }
  process.env.SENSITIVE_ALLOW_CLOUD = "1"
  assert.match(smartChain({ sensitive: true }), /gemini|openai|anthropic/, "solo '1' habilita la nube")
  process.env.LLM_CHAIN_SENSITIVE = "ollama,anthropic" // el override a medida SOLO cuenta con el escape activo
  assert.equal(smartChain({ sensitive: true }), "ollama,anthropic", "con escape activo respeta LLM_CHAIN_SENSITIVE")
  process.env.SENSITIVE_ALLOW_CLOUD = "0"
  assert.equal(smartChain({ sensitive: true }), "ollama", "override ignorado si el escape NO está activo (no fail-open)")
  delete process.env.SENSITIVE_ALLOW_CLOUD; delete process.env.LLM_CHAIN_SENSITIVE
})

test("FUGA sensible: reunión con cap table + ollama caído → CERO fetch a la nube (fail-closed, sin fallback a gemini)", async () => {
  hits.length = 0
  await summarizeMeeting("Hablamos del cap table y el term sheet con el inversor sobre el salario", { title: "Sync", attendees: [], sensitive: true })
  const leaked = hits.filter((u) => CLOUD.test(u))
  assert.equal(leaked.length, 0, `FUGA CONFIRMADA — transcripción sensible salió a la nube: ${leaked.join(", ")}`)
})

test("no-sensible: reunión normal + ollama caído → SÍ puede caer a gemini (fallback esperado)", async () => {
  hits.length = 0
  await summarizeMeeting("Coordinamos el horario de la próxima daily y quién trae el café", { title: "Daily", attendees: [], sensitive: false })
  // no assert de fuga acá: para contenido NO sensible el fallback a nube es el comportamiento deseado. Solo confirmamos que no explota.
  assert.ok(hits.length > 0, "debe haber intentado al menos ollama")
})
