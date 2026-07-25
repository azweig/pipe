// HARD_CAP de nube (hallazgo #6): visionLLM / geminiMultimodal / geminiUploadFile saltean llm(), así que el tope duro
// (el que protege el key managed de un tenant descontrolado — mismo class que el incidente de cloud-leak) NO los cubría.
// Este test pone el contador diario POR ENCIMA del cap y verifica que los 3 paths multimodales se NIEGAN sin tocar la nube.
// Hermético: cwd temporal propio (NO toca tu data/ real) + fetch stubbeado. Archivo aparte = aislamiento total del resto de la suite.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-cap-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
process.env.GEMINI_API_KEY = "test-key"
const today = new Date().toISOString().slice(0, 10)
// contador diario MUY por encima del HARD_CAP (default = 3M×3 = 9M tokens nube)
writeFileSync(join(dir, "data", "llm-usage-day.json"), JSON.stringify({ date: today, cloudTok: 999_999_999, warned: true, byTask: {} }))
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

const CLOUD = /generativelanguage\.googleapis\.com|api\.openai\.com|anthropic\.com/i
const hits = []
global.fetch = async (url) => { hits.push(String(url)); return { ok: true, status: 200, text: async () => "", json: async () => ({ candidates: [{ content: { parts: [{ text: "x" }] } }], file: { uri: "u", state: "ACTIVE" } }) } }

const { cloudOverCap, geminiMultimodal, visionLLM, geminiUploadFile } = await import("../src/lib/llm.mjs")

test("cloudOverCap detecta que el contador diario superó el HARD_CAP", () => {
  assert.equal(cloudOverCap(), true)
})

test("multimodal sobre el cap → geminiMultimodal se niega SIN tocar la nube", async () => {
  hits.length = 0
  await assert.rejects(() => geminiMultimodal("resume este audio sensible", [{ mime: "audio/ogg", data: "AAAA" }]), /HARD_CAP/)
  assert.equal(hits.filter((u) => CLOUD.test(u)).length, 0, "no debe haber llamado a la nube por encima del cap")
})

test("visión sobre el cap → visionLLM se niega SIN tocar la nube", async () => {
  hits.length = 0
  await assert.rejects(() => visionLLM("describe esta captura", [{ mime: "image/png", data: "AAAA" }]), /HARD_CAP/)
  assert.equal(hits.filter((u) => CLOUD.test(u)).length, 0)
})

test("subida sobre el cap → geminiUploadFile se niega SIN tocar la nube", async () => {
  hits.length = 0
  writeFileSync(join(dir, "blob.bin"), "xx")
  await assert.rejects(() => geminiUploadFile(join(dir, "blob.bin"), "audio/ogg"), /HARD_CAP/)
  assert.equal(hits.filter((u) => CLOUD.test(u)).length, 0)
})
