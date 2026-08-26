// "(no se pudo transcribir)" EN AUDIOS QUE SÍ SE TRANSCRIBIERON — el mensaje mentía. La transcripción (whisper)
// había funcionado; lo que expiraba era el RESUMEN (Ollama por CPU, porque la caja GPU está clasificada como nube
// y esta función es local-only). El fallo del resumen caía al mismo catch que el de la transcripción, así que tras
// 3 intentos marcaba el audio como no transcribible y te dejaba sin lo único útil: lo que dijeron.
// Runner: node --test test/audio-summary-fallback.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SRC = readFileSync("src/audio-summarize.mjs", "utf8")
const cuerpo = SRC.slice(SRC.indexOf("export async function summarizeBatch"))

test("si falla el resumen se guarda la TRANSCRIPCIÓN, no un error", () => {
  assert.match(cuerpo, /catch \(e\) \{[\s\S]{0,300}setMessageSummary\(r\.id, text\.slice\(0, 600\)\)/,
    "el fallo de resumen tiene que guardar el texto transcripto")
})

test("el fallo de resumen NO cae al dead-letter de transcripción", () => {
  const iLlm = cuerpo.indexOf("audioSummaryPrompt(text)")
  const iCatch = cuerpo.indexOf("catch", iLlm)
  const iDead = cuerpo.indexOf("n >= 3") // el dead-letter REAL, no el comentario que lo menciona
  assert.ok(iCatch > 0 && iCatch < iDead, "el llm() necesita su propio catch antes del dead-letter")
  assert.match(cuerpo.slice(iCatch, iCatch + 400), /continue/, "y tiene que cortar ahí, sin seguir al catch de afuera")
})

test("un resumen vacío tampoco pierde la transcripción", () => {
  assert.match(cuerpo, /setMessageSummary\(r\.id, \(sum \|\| text\)\.slice\(0, 600\)\)/)
})

test("sigue habiendo dead-letter: un audio irrecuperable no se reintenta para siempre", () => {
  assert.match(cuerpo, /n >= 3.*setMessageSummary\(r\.id, "\(no se pudo transcribir\)"\)/)
})
