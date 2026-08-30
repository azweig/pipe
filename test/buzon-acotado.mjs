// PREGUNTAS ACOTADAS A UN BUZÓN — "¿de qué hablé por el mail de X?" nombra un ÁMBITO, no un tema.
//
// Caso real: con miles de correos en esa casilla, el buscador contestaba con hilos de WhatsApp. Busca por parecido
// semántico, y el nombre de una casilla no se parece a nada. Y "¿qué le respondí?" daba "no hay información"
// teniendo cientos de correos enviados, porque el contexto se llenaba de lo ENTRANTE.
//
// Runner: node --test test/buzon-acotado.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const ASK = readFileSync("src/lib/brain/ask.mjs", "utf8")
const REPO = readFileSync("src/lib/threads-repo.mjs", "utf8")
const rama = (() => {
  const i = ASK.indexOf("const buzones = buzonMencionado(question)")
  assert.ok(i > 0, "no encontré la rama de buzón en routerSearch")
  return ASK.slice(i, ASK.indexOf("const buscar = intentoBuscarTexto", i))
})()

test("las casillas se descubren de los datos, no se escriben a mano", () => {
  const i = REPO.indexOf("export function cuentasDeCorreo")
  assert.ok(i > 0, "falta cuentasDeCorreo")
  const fn = REPO.slice(i, REPO.indexOf("\nexport ", i + 10))
  assert.match(fn, /SELECT account/, "las cuentas salen de la DB")
  assert.ok(!/@[a-z0-9-]+\.(io|com|co|pe)\b/i.test(fn), "no puede haber ninguna dirección escrita en el código")
})

test("hace falta que la pregunta sea sobre correo, no solo que nombre la palabra", () => {
  const i = ASK.indexOf("export function buzonMencionado")
  const fn = ASK.slice(i, ASK.indexOf("\nexport ", i + 10))
  assert.match(fn, /mail|correos\?/, "sin señal de 'correo' no debería secuestrar la pregunta")
  assert.match(fn, /return null/, "si no reconoce casilla, devuelve null y sigue el camino normal")
})

test("'¿qué respondí?' se contesta con lo SALIENTE", () => {
  assert.match(rama, /soloMios/, "falta detectar que la pregunta es por lo que él escribió")
  assert.match(rama, /respond\[i[íi]\]|escrib|mand\[e[ée]\]/i, "faltan los verbos que indican autoría propia")
  assert.match(rama, /m\.dir === "out"/, "hay que filtrar a los enviados")
})

test("el contexto se arma SOLO con esa casilla", () => {
  assert.match(rama, /buzones\.includes\(m\.account\)/, "sin esto se cuela correo de otras casillas")
  assert.match(rama, /recientesEnCuentas\(buzones/, "el fallback también tiene que estar acotado")
})

test("si la casilla no tiene nada, no niega: sigue de largo", () => {
  assert.ok(!/answer: `No /.test(rama), "un 'no hay' falso es peor que caer al camino normal")
  assert.match(rama, /seguimos por el camino normal/, "el fallback tiene que quedar documentado")
})

test("respeta el 2º PIN", () => {
  const i = REPO.indexOf("export function recientesEnCuentas")
  const fn = REPO.slice(i, REPO.indexOf("\nexport ", i + 10))
  assert.match(fn, /isSecretRow/, "un correo de una cuenta secreta no puede entrar al contexto de la IA")
})
