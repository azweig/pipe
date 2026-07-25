// POLÍTICA POR-FEATURE (toggle UI): cada tarea sensible es local por DEFAULT; el hub la manda a nube por feature en Configuración →
// Motor de IA. Verifica el contrato: default local, "cloud" usa la cadena BYOK, "local" vuelve a local, y la persistencia valida input.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-feat-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
writeFileSync(join(dir, "data", "llm-config.json"), JSON.stringify({ chain: ["gemini", "ollama"], keys: {}, models: {} }))
delete process.env.SENSITIVE_ALLOW_CLOUD
delete process.env.LLM_CHAIN_SENSITIVE
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

const { smartChain, featureWantsCloud, setLlmConfig, llmConfigMasked, SENSITIVE_FEATURES } = await import("../src/lib/llm.mjs")
const cfg = () => JSON.parse(readFileSync(join(dir, "data", "llm-config.json"), "utf8"))

test("default: toda feature sensible es LOCAL (ollama), sin config", () => {
  for (const f of SENSITIVE_FEATURES) assert.equal(smartChain({ sensitive: true, feature: f.key }), "ollama", `${f.key} default local`)
})

test("toggle una feature a 'cloud' → usa la cadena BYOK del hub; las demás siguen local", () => {
  setLlmConfig({ sensitivePolicy: { extract: "cloud" } })
  assert.equal(featureWantsCloud("extract"), true)
  assert.equal(smartChain({ sensitive: true, feature: "extract" }), "gemini,ollama", "extract=cloud → cadena configurada")
  assert.equal(smartChain({ sensitive: true, feature: "graphify" }), "ollama", "graphify sigue local")
})

test("llmConfigMasked expone el modo por feature (para pintar los selects)", () => {
  const m = llmConfigMasked().sensitiveFeatures
  assert.equal(m.find((f) => f.key === "extract").mode, "cloud")
  assert.equal(m.find((f) => f.key === "graphify").mode, "local")
})

test("volver a 'local' BORRA la entrada (local = default = ausente, no basura en el archivo)", () => {
  setLlmConfig({ sensitivePolicy: { extract: "local" } })
  assert.equal(smartChain({ sensitive: true, feature: "extract" }), "ollama")
  assert.equal(cfg().sensitivePolicy.extract, undefined, "local no se persiste")
})

test("persistencia sanea: features desconocidas y valores inválidos se ignoran", () => {
  setLlmConfig({ sensitivePolicy: { extract: "cloud", noexiste: "cloud", graphify: "banana" } })
  const p = cfg().sensitivePolicy
  assert.equal(p.extract, "cloud")
  assert.equal(p.noexiste, undefined, "feature desconocida no entra")
  assert.equal(p.graphify, undefined, "valor inválido no entra (solo local|cloud)")
})

test("sin feature (legacy/headless): manda el switch global SENSITIVE_ALLOW_CLOUD", () => {
  delete process.env.SENSITIVE_ALLOW_CLOUD
  assert.equal(smartChain({ sensitive: true }), "ollama", "sin escape global → local")
  process.env.SENSITIVE_ALLOW_CLOUD = "1"
  assert.equal(smartChain({ sensitive: true }), "gemini,ollama", "escape global → nube")
  delete process.env.SENSITIVE_ALLOW_CLOUD
})
