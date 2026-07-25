// Invariante de PRIVACIDAD del router LLM (guarda contra el incidente de cloud-leak):
// el contenido marcado `sensitive` NUNCA se rutea a un proveedor de nube por defecto — ni siquiera si
// la tarea también es `complex`/`vision`. Sólo el escape consciente SENSITIVE_ALLOW_CLOUD=1 lo permite.
import { test } from "node:test"
import assert from "node:assert/strict"
import { smartChain } from "../src/lib/llm.mjs"

const CLOUD = ["gemini", "openai", "anthropic"]
const hasCloud = (chain) => chain.split(",").map((s) => s.trim()).some((p) => CLOUD.includes(p))

test("sensible → SOLO local (ollama), cero nube", () => {
  delete process.env.SENSITIVE_ALLOW_CLOUD
  assert.equal(smartChain({ sensitive: true }), "ollama")
  assert.equal(hasCloud(smartChain({ sensitive: true })), false)
})

test("sensible GANA sobre complex/vision — no se fuga aunque sea pesado", () => {
  delete process.env.SENSITIVE_ALLOW_CLOUD
  for (const flags of [{ sensitive: true, complex: true }, { sensitive: true, vision: true }, { sensitive: true, complex: true, vision: true }]) {
    assert.equal(hasCloud(smartChain(flags)), false, `sensible+${JSON.stringify(flags)} NO debe tocar la nube`)
    assert.equal(smartChain(flags), "ollama")
  }
})

test("escape consciente SENSITIVE_ALLOW_CLOUD=1: permite nube (usa la cadena BYOK del hub)", () => {
  // Nuevo contrato: el escape global (sin feature) usa la cadena configurada del hub. La granularidad fina vive en la política
  // por-feature (Configuración → Motor de IA), testeada en llm-feature-policy.mjs. Acá solo importa: con escape, la nube es POSIBLE.
  process.env.SENSITIVE_ALLOW_CLOUD = "1"
  assert.ok(hasCloud(smartChain({ sensitive: true })), "con el escape sí permite nube")
  delete process.env.SENSITIVE_ALLOW_CLOUD
})

test("NO sensible + complex/vision → nube capaz (comportamiento esperado)", () => {
  assert.equal(smartChain({ complex: true }), "gemini,openai,anthropic")
  assert.equal(smartChain({ vision: true }), "gemini,openai,anthropic")
})
