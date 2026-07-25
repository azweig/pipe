// CLASS-KILLER, derivado de la CAPA DE DATOS (no de una lista a mano — esa era el mismo modo de falla: una política que nadie te
// obliga a llamar). La serie fue de 4: LLM_CHAIN_SENSITIVE → SENSITIVE_ALLOW_CLOUD truthy → LLM_CHAIN_ENRICH → SPAM_CHAIN. Cada
// ronda tapaba la instancia y la clase reaparecía en la variable de al lado. Un módulo NO es sensible por estar en una lista: es
// sensible porque LEE EL CORPUS. Este test lo deriva de los readers importados → la lista se autogestiona, la escribe el import.
//
// REGLA: todo módulo que importe un reader del corpus Y mande algo a un LLM debe, o bien derivar su chain de smartChain({sensitive}),
// o bien llevar un `// CLOUD-OK: <razón>` explícito. No dicta a dónde van los datos — obliga a que exista un ARTEFACTO de la decisión.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// funciones de la capa de datos que exponen contenido de mensajes/hilos/emails (el corpus). Ampliá esto cuando nazca un reader nuevo.
const CORPUS_READERS = /\b(threadTextTail|threadMessagesTail|threadMessages|activeThreadsSince|threadsSummary|getBody|inboundUnansweredThreads|staleConversations|emailsToSummarize|loadNewEvents)\b/
const SENDS_TO_LLM = /\b(llm|visionLLM|geminiMultimodal|geminiUploadFile)\(/
const HAS_SMARTCHAIN = /smartChain\(/
const HAS_CLOUD_OK = /CLOUD-OK/

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (e.endsWith(".mjs")) acc.push(p.replace(/\\/g, "/"))
  }
  return acc
}

// deriva la lista: archivos que importan un reader del corpus Y mandan a un LLM. Nadie la mantiene a mano.
const sensitive = walk("src").filter((f) => { const s = readFileSync(f, "utf8"); return CORPUS_READERS.test(s) && SENDS_TO_LLM.test(s) })

test("la derivación encuentra módulos (si da 0, el regex de readers quedó desanclado — arreglalo, no lo borres)", () => {
  assert.ok(sensitive.length >= 4, `esperaba ≥4 módulos que lean el corpus + llamen LLM, encontré ${sensitive.length}`)
})

for (const f of sensitive) {
  test(`${f}: lee el corpus + llama LLM → debe usar smartChain({sensitive}) o llevar // CLOUD-OK: <razón>`, () => {
    const s = readFileSync(f, "utf8")
    assert.ok(HAS_SMARTCHAIN.test(s) || HAS_CLOUD_OK.test(s),
      `${f} manda contenido del corpus a un LLM SIN artefacto de decisión: usá smartChain({sensitive:true}) para local-only, o poné // CLOUD-OK: <razón> si la nube es deliberada`)
  })
}
