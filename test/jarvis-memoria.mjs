// JARVIS NO RECORDABA NADA Y BUSCABA MENOS QUE EL BUSCADOR. El historial vivía en un array del navegador: se
// perdía al recargar, no existía en el celular ni en el escritorio, y lo que le preguntabas por WhatsApp quedaba
// en otro lado. Encima usaba solo el RAG de mensajes, así que la MISMA pregunta se contestaba distinta según por
// dónde la hicieras — en la app encontraba el monto de un contrato y en Jarvis no.
// Runner: node --test test/jarvis-memoria.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SRV = readFileSync("src/server.mjs", "utf8")
const REPO = readFileSync("src/lib/threads-repo.mjs", "utf8")
const ASIS = readFileSync("src/lib/brain/assistant.mjs", "utf8")
const APP = readFileSync("public/app.js", "utf8")

test("la charla se guarda en el hub, no en el navegador", () => {
  assert.match(REPO, /export function jarvisGuardar\(role, text, via = "app", meta = null\)/)
  assert.match(REPO, /export function jarvisHistorial/)
  assert.match(SRV, /path === "\/api\/jarvis" && req\.method === "POST"/)
})

test("usa el MISMO buscador que la app, no solo el RAG", () => {
  const i = SRV.indexOf('path === "/api/jarvis" && req.method === "POST"')
  assert.match(SRV.slice(i, i + 900), /brain\.routerSearch\(pregunta, \{ historial: previo \}\)/)
})

test("una búsqueda de mensajes también deja una línea legible en la charla", () => {
  const i = SRV.indexOf('path === "/api/jarvis" && req.method === "POST"')
  assert.match(SRV.slice(i, i + 1100), /Encontré \$\{r\.total\} mensaje/)
})

test("lo que preguntás por WhatsApp entra a la MISMA conversación", () => {
  assert.match(ASIS, /jarvisGuardar\("me", [\w.]+, "whatsapp"\)/)
  assert.match(ASIS, /jarvisGuardar\("ai", [\w.]+, "whatsapp"\)/)
})

// ⚠️ ESTA prueba nació de un bug real: la línea decía `jarvisGuardar("me", question, …)` y `question` no existe
// en runAssistant (la pregunta vive en `c.question`). Tiraba ReferenceError, el catch se lo tragaba y NADA de lo
// que preguntabas por WhatsApp quedaba guardado — el asistente no tenía contexto nunca. La prueba vieja copiaba
// esa línea tal cual, así que pasaba en verde. Ahora se comprueba el ALCANCE: dentro de runAssistant no puede
// usarse ningún identificador suelto que no esté declarado ahí.
test("runAssistant no usa variables fuera de alcance (el bug de `question`)", () => {
  const i = ASIS.indexOf("export async function runAssistant()")
  assert.ok(i > 0, "no encontré runAssistant")
  const cuerpo = ASIS.slice(i)
  const sinComentarios = cuerpo.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  for (const suelta of ["question", "out", "texto", "previo"]) {
    const usos = new RegExp(`(?<![.\\w])${suelta}(?![\\w])`, "g")
    if (!usos.test(sinComentarios)) continue
    const declarada = new RegExp(`(const|let|var)\\s+${suelta}\\b|\\b${suelta}\\s*=[^=]`).test(sinComentarios)
    assert.ok(declarada, `runAssistant usa "${suelta}" sin declararla: ReferenceError en runtime, y el catch lo esconde`)
  }
})

test("guardar la charla no puede voltear una respuesta que ya salió", () => {
  assert.match(ASIS, /try \{ jarvisGuardar\("me", [\w.]+, "whatsapp"\); jarvisGuardar\("ai", [\w.]+, "whatsapp"\) \} catch/)
})

test("el asistente de WhatsApp busca con routerSearch, con historial, y cae al RAG si falla", () => {
  assert.match(ASIS, /const rs = await routerSearch\(question, \{ historial \}\)/)
  assert.match(ASIS, /if \(!own\.answer\) own = await ask\(question/)
  assert.match(ASIS, /jarvisHistorial\(/, "sin leer el historial no hay continuidad")
})

test("el historial se devuelve en orden cronológico", () => {
  const i = REPO.indexOf("export function jarvisHistorial")
  assert.match(REPO.slice(i, i + 500), /ORDER BY ts DESC[\s\S]{0,60}\.reverse\(\)/)
})

test("la web carga el historial del hub al abrir Jarvis", () => {
  assert.match(APP, /window\.jarvisCargar = async/)
  assert.match(APP, /post\("\/api\/jarvis", \{ q, via: "web" \}\)/)
})
