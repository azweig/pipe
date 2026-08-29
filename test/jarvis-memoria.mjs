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
  assert.match(SRV.slice(i, i + 900), /brain\.routerSearch\(pregunta\)/)
})

test("una búsqueda de mensajes también deja una línea legible en la charla", () => {
  const i = SRV.indexOf('path === "/api/jarvis" && req.method === "POST"')
  assert.match(SRV.slice(i, i + 1100), /Encontré \$\{r\.total\} mensaje/)
})

test("lo que preguntás por WhatsApp entra a la MISMA conversación", () => {
  assert.match(ASIS, /jarvisGuardar\("me", question, "whatsapp"\)/)
  assert.match(ASIS, /jarvisGuardar\("ai", out, "whatsapp"\)/)
})

test("guardar la charla no puede voltear una respuesta que ya salió", () => {
  assert.match(ASIS, /try \{ jarvisGuardar\("me", question, "whatsapp"\); jarvisGuardar\("ai", out, "whatsapp"\) \} catch/)
})

test("el asistente de WhatsApp también busca con routerSearch, y cae al RAG si falla", () => {
  assert.match(ASIS, /const rs = await routerSearch\(question\)/)
  assert.match(ASIS, /if \(!own\.answer\) own = await ask\(question/)
})

test("el historial se devuelve en orden cronológico", () => {
  const i = REPO.indexOf("export function jarvisHistorial")
  assert.match(REPO.slice(i, i + 500), /ORDER BY ts DESC[\s\S]{0,60}\.reverse\(\)/)
})

test("la web carga el historial del hub al abrir Jarvis", () => {
  assert.match(APP, /window\.jarvisCargar = async/)
  assert.match(APP, /post\("\/api\/jarvis", \{ q, via: "web" \}\)/)
})
