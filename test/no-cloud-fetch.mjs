// INVARIANTE ESTRUCTURAL (la lección de estas rondas): todo egress a la nube pasa por una capa conocida — ahí viven el HARD_CAP,
// el medidor y el fail-closed. Dos capas de defensa, porque un solo regex de hostnames deja pasar al PRÓXIMO proveedor:
//   (A) DENYLIST de hosts de LLM-nube conocidos → SOLO en llm.mjs / voice.mjs.
//   (B) ALLOWLIST de superficie de egress → cualquier ARCHIVO nuevo con fetch(https://…) obliga a tocar esta lista a propósito.
// (B) es la que caza un proveedor futuro sin que sepamos su host (p.ej. el "Hook Mistral OCR" ya escrito en llm.mjs:86): un
// mistral-ocr.mjs nuevo rompe el build aunque su hostname no esté en ningún regex.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const AI_HOSTS = /api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com/
const AI_ALLOW = new Set(["src/lib/llm.mjs", "src/lib/voice.mjs"]) // única capa autorizada a hablar con LLMs en la nube
// superficie de egress https ACTUAL (Graph, Google, holidays, búsqueda…). Agregar un archivo acá debe ser un acto CONSCIENTE.
const EGRESS_ALLOW = new Set([
  "src/lib/llm.mjs", "src/lib/voice.mjs", "src/calendar-outlook.mjs", "src/files-sharepoint.mjs", "src/holidays.mjs",
  "src/lib/briefing.mjs", "src/lib/calendar.mjs", "src/lib/mail-archive.mjs", "src/lib/research.mjs",
  "src/mail-backfill.mjs", "src/mail-outlook.mjs", "src/teams.mjs",
  // Egress de canales de MENSAJERÍA (no IA): la API de Slack de TU propia cuenta conectada. Revisado y deliberado.
  "src/lib/brain/reply.mjs", // chat.postMessage: envía TU respuesta a Slack
  "src/lib/integrations.mjs", // auth.test: valida TU token de Slack antes de guardarlo
])
const FETCH_HTTPS = /fetch\(\s*[`"']https:\/\//

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (e.endsWith(".mjs")) acc.push(p.replace(/\\/g, "/"))
  }
  return acc
}
const files = walk("src")

test("(A) los hosts de LLM-nube conocidos SOLO aparecen en llm.mjs / voice.mjs", () => {
  const offenders = files.filter((f) => !AI_ALLOW.has(f) && AI_HOSTS.test(readFileSync(f, "utf8")))
  assert.deepEqual(offenders, [], `LLM-nube fuera de la capa central: ${offenders.join(", ")} — ruteá por llm.mjs`)
})

test("(B) ningún ARCHIVO nuevo hace fetch(https://…) sin estar en el allowlist de egress", () => {
  const offenders = files.filter((f) => !EGRESS_ALLOW.has(f) && FETCH_HTTPS.test(readFileSync(f, "utf8")))
  assert.deepEqual(offenders, [], `EGRESS a la nube en archivo no declarado: ${offenders.join(", ")} — si es AI, va por llm.mjs; si no, agregalo al allowlist a propósito`)
})
