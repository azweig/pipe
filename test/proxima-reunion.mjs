// CUÁNTO FALTA PARA LA PRÓXIMA REUNIÓN. Tener la agenda no sirve de nada si hay que ir a buscarla: lo que uno
// quiere saber, sin abrir nada, es cuánto tiempo le queda.
//
// Dos trampas que costaron una pasada: el servidor está en Europa y el usuario en Lima, así que formatear con la
// hora del proceso mostraba un evento de las 09:00 como las 16:00. Y "mañana" no es "faltan menos de 48 h" — es
// día de calendario: faltando 40 h decía "mañana" cuando era pasado mañana.
// Runner: node --test test/proxima-reunion.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SCH = readFileSync("src/lib/brain/schedule.mjs", "utf8")
const SRV = readFileSync("src/server.mjs", "utf8")
const APP = readFileSync("public/app.js", "utf8")

test("devuelve la primera reunión que todavía no empezó", () => {
  assert.match(SCH, /export function proximaReunion\(ahora = Date\.now\(\)\)/)
  assert.match(SCH, /if \(!ini \|\| ini <= ahora\) continue/)
})

test("la hora se formatea en la zona del USUARIO, no la del servidor", () => {
  const i = SCH.indexOf("function textoFalta")
  const fn = SCH.slice(i, i + 900)
  assert.match(fn, /timeZone: z/)
  assert.ok(!/getHours\(\)/.test(fn), "getHours() usa la zona del proceso: el server está en otro huso")
})

test('"mañana" se decide por DÍA DE CALENDARIO, no por horas', () => {
  const i = SCH.indexOf("function textoFalta")
  const fn = SCH.slice(i, i + 900)
  assert.match(fn, /const dia = \(ms\) =>/)
  assert.match(fn, /cuando === manana/)
  assert.ok(!/48 \* 60/.test(fn), "el umbral de 48 h daba 'mañana' para pasado mañana")
})

test("el endpoint no falla cuando no hay nada agendado", () => {
  assert.match(SRV, /brain\.proximaReunion\(\) \|\| \{ none: true \}/)
})

test("la web lo pinta sin atrasar la bandeja, y se destaca si ya casi empieza", () => {
  assert.match(APP, /void pintarProximaReunion\(\)/, "no puede bloquear el render de la lista")
  assert.match(APP, /r\.enCurso \|\| r\.faltanMin <= 30/)
  assert.match(APP, /if \(!r \|\| r\.none\) \{ el\.innerHTML = ""; return \}/, "sin reunión no ocupa espacio")
})
