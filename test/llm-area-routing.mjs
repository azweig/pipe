// El ruteo por ÁREA no puede romper el fail-closed local-only.
//
// Las suites de privacidad que ya existen (llm-privacy, llm-enforcement, llm-feature-policy) prueban `smartChain()` AISLADO:
// verifican que la cadena que se PIDE para una tarea sensible es "ollama". Ninguna seguía el camino hasta `llm()`, donde el
// ruteo por área elegía el proveedor final — y ahí `routed` ganaba sobre `localOnly`:
//
//     const providers = routed ? [routed.provider] : (localOnly ? ["ollama"] : […])
//
// La UI deja asignar cualquier key al área rotulada "🔒 privado" (graphify/learn/enrich/extract). Poniendo ahí una key de
// OpenAI, graphify seguía pidiendo chain:"ollama" y feature:"graphify", SENSITIVE_ALLOW_CLOUD sin setear… y el corpus entero
// de mensajes salía igual a la nube. Esta prueba recorre ese camino.
// Runner: node --test test/llm-area-routing.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// llm.mjs lee la config desde ./data — lo corremos en un directorio temporal para no tocar nada real
const dir = mkdtempSync(join(tmpdir(), "pipe-llm-"))
mkdirSync(join(dir, "data"), { recursive: true })
const cwd0 = process.cwd()
process.chdir(dir)

// el hub asignó una key de NUBE al área privada — exactamente lo que la UI permite hacer
writeFileSync("data/llm-config.json", JSON.stringify({
  keysList: [{ id: "k1", provider: "openai", name: "mía", token: "sk-lo-que-sea" }], // ← la forma real: keysList (array) o keys (objeto)
  routing: { private: { keyId: "k1" }, summarize: { keyId: "k1" } }, // ← el campo se llama "routing"
}))

const { llm } = await import("../src/lib/llm.mjs")

// Interceptamos la red: si algo intenta salir a un host de nube, lo sabemos.
const salidas = []
globalThis.fetch = async (url) => {
  salidas.push(String(url))
  return { ok: false, status: 500, text: async () => "cortado por la prueba", json: async () => ({}) }
}

const CLOUD = /openai\.com|anthropic\.com|googleapis\.com/

test("una tarea local-only NO sale a la nube aunque el área apunte a una key de nube", async () => {
  salidas.length = 0
  delete process.env.SENSITIVE_ALLOW_CLOUD
  // así llama graphify: cadena explícita solo-local + su feature (que mapea al área "private")
  await llm("hola", { chain: "ollama", feature: "graphify" }).catch(() => {})
  const fugas = salidas.filter((u) => CLOUD.test(u))
  assert.deepEqual(fugas, [], `una tarea local-only intentó salir a la nube: ${fugas.join(", ")}`)
})

test("lo mismo para learn/enrich/extract", async () => {
  for (const feature of ["learn", "enrich", "extract"]) {
    salidas.length = 0
    await llm("hola", { chain: "ollama", feature }).catch(() => {})
    const fugas = salidas.filter((u) => CLOUD.test(u))
    assert.deepEqual(fugas, [], `${feature} intentó salir a la nube`)
  }
})

test("una tarea NO sensible sí puede usar la key de nube del área (el ruteo sigue sirviendo)", async () => {
  salidas.length = 0
  await llm("hola", { area: "summarize" }).catch(() => {})
  assert.ok(salidas.some((u) => CLOUD.test(u)), "el ruteo por área dejó de funcionar para lo que NO es sensible")
})

// OJO: nada de process.chdir(cwd0) acá. node:test REGISTRA los tests y los corre DESPUÉS de evaluar el módulo: si volvemos
// al directorio original en esta línea, los tests leen la config REAL del hub en vez de la de mentira y pasan siempre —
// exactamente el falso verde que tuve mientras escribía esto. La restauración va al salir.
process.on("exit", () => { try { process.chdir(cwd0); rmSync(dir, { recursive: true, force: true }) } catch { /* da igual */ } })
