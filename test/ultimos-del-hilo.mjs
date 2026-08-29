// "¿LO ÚLTIMO DE X ES MÍO O DE ELLOS?" — mirar el final de un hilo, no buscar por parecido.
//
// Caso real: había 111 mensajes de ese remitente y el asistente contestó "no hay información sobre los últimos
// mensajes". El RAG busca por SEMEJANZA SEMÁNTICA, y "lo último de X" no se parece a nada en particular: la
// pregunta no era de significado, era de posición. Se resuelve leyendo el hilo, sin gastar un token.
//
// Runner: node --test test/ultimos-del-hilo.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { pideUltimos } from "../src/lib/brain/ask.mjs"

const ASK = readFileSync("src/lib/brain/ask.mjs", "utf8")

test("reconoce la pregunta y saca a quién se refiere", () => {
  const a = pideUltimos("Lo ultimo de acuarela para el ronda2 es mio o de ellos ?cual fue los ultimos dos mensakes")
  assert.ok(a, "una pregunta escrita rápido, con el signo en el medio y una palabra mal tipeada")
  assert.equal(a.n, 2, "pidió DOS mensajes (aunque haya escrito 'mensakes')")
  assert.ok(a.sujetos.includes("acuarela"), `el sujeto es acuarela, no ${JSON.stringify(a.sujetos)}`)
})

test("cuenta escrita con letra o con número", () => {
  assert.equal(pideUltimos("dame los ultimos 5 mensajes de Renata").n, 5)
  assert.equal(pideUltimos("cual fue el ultimo mensaje de Renata?").n, 1)
  assert.equal(pideUltimos("los ultimos mensajes de Renata").n, 3, "sin número, unos pocos")
})

test("'de ellos', 'de emails', 'de hoy' no son personas", () => {
  const a = pideUltimos("cual fue el ultimo mensaje de ellos")
  assert.equal(a, null, "'ellos' no nombra un hilo: mejor seguir por el camino normal que inventar uno")
})

test("no se roba preguntas que no son de posición", () => {
  for (const q of ["cuanto firme en la adenda del contrato?", "hay algo urgente?", "cual es el ruc de la empresa?"]) {
    assert.equal(pideUltimos(q), null, q)
  }
})

test("la rama no gasta tokens y respeta el 2º PIN", () => {
  const i = ASK.indexOf("const ult = pideUltimos(question)")
  assert.ok(i > 0, "no encontré la rama en routerSearch")
  const rama = ASK.slice(i, ASK.indexOf("const buscar = intentoBuscarTexto", i))
  assert.match(rama, /tokens: 0/, "es una lectura de la DB: no puede costar tokens")
  assert.match(rama, /secretThreadKeys/, "sin esto, un hilo bajo el 2º PIN se contestaría igual")
  assert.match(rama, /isSecU\(m\)/, "también hay que filtrar el mensaje suelto de una línea secreta")
  assert.match(rama, /dir === "out" \? "Lo mandaste vos"/, "la pregunta es MÍO o DE ELLOS: hay que decirlo")
})

test("si no resuelve el hilo, sigue de largo en vez de negar", () => {
  const i = ASK.indexOf("const ult = pideUltimos(question)")
  const rama = ASK.slice(i, ASK.indexOf("const buscar = intentoBuscarTexto", i))
  assert.ok(!/return \{[^}]*answer: `No /.test(rama), "un 'no hay' falso es peor que caer al camino normal")
  assert.match(rama, /seguimos con el camino normal/, "debería quedar documentado el fallback")
})
