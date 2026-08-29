// "¿HAY ALGUNA URGENCIA HOY?" CONTESTABA CON MENSAJES DE 2020. El buscador ignoraba el tiempo por completo:
// rankeaba por relevancia sobre todo el historial, así que una pregunta sobre las últimas horas se respondía con
// un trámite de hace meses — coherente y completamente inútil. Y tardaba 296 segundos, porque el contexto se
// llenaba de años de mensajes.
//
// Y "¿tengo mails que necesiten mi asistencia?" no se contesta buscando la palabra "urgente": eso trae cualquier
// mensaje donde alguien la escribió y se pierde justo lo que importa. Esa respuesta ya está calculada en la
// bandeja (el ✦), así que se contesta con eso — exacta y sin tokens.
// Runner: node --test test/tiempo-y-pendientes.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ventanaTemporal, pidePendientes } from "../src/lib/brain/ask.mjs"

const ASK = readFileSync("src/lib/brain/ask.mjs", "utf8")
const SEARCH = readFileSync("src/lib/search-repo.mjs", "utf8")

test("reconoce cuándo la pregunta habla de un momento", () => {
  assert.equal(ventanaTemporal("hay alguna urgencia hoy?").etiqueta, "hoy")
  assert.equal(ventanaTemporal("que paso ayer?").etiqueta, "desde ayer")
  assert.equal(ventanaTemporal("que hubo esta semana?").etiqueta, "esta semana")
})

test('"nuevos" y "urgente" también son AHORA, aunque no nombren fecha', () => {
  assert.ok(ventanaTemporal("tengo mails nuevos?").desde > 0)
  assert.ok(ventanaTemporal("algo urgente?").desde > 0)
})

test("una pregunta SIN tiempo no se recorta (o perderíamos el archivo)", () => {
  assert.equal(ventanaTemporal("cuanto firme en la adenda?").desde, 0)
  assert.equal(ventanaTemporal("cual es el ruc de la empresa?").desde, 0)
})

test("el corte se calcula en la zona del USUARIO", () => {
  // "hoy" a las 23:00 de Lima son las 06:00 del día siguiente en Europa: sin esto el corte se iba un día entero
  assert.match(ASK, /toLocaleString\("en-US", \{ timeZone: TZ\(\) \}\)/)
})

test("la búsqueda acepta el corte y lo aplica en SQL, no filtrando después", () => {
  assert.match(SEARCH, /desde = 0 \} = \{\}\)/)
  assert.match(SEARCH, /AND m\.ts >= \?/)
})

test("al modelo se le dice desde cuándo mira (si no, inventa que 'no hay')", () => {
  assert.match(ASK, /SOLO estás viendo lo de \$\{ventG\.etiqueta\}/)
  assert.match(ASK, /no busques más atrás/)
})

test("las preguntas por pendientes se reconocen", () => {
  for (const q of ["tengo mails que necesiten mi asistencia?", "hay algo urgente?", "que tengo pendiente de responder?", "que me falta responder?"]) {
    assert.ok(pidePendientes(q), `no reconoció: ${q}`)
  }
})

test("una pregunta normal NO se confunde con un pedido de pendientes", () => {
  for (const q of ["cuanto firme en la adenda?", "quien me escribio ayer?"]) assert.ok(!pidePendientes(q), q)
})

test("los pendientes salen de la señal ya calculada, sin gastar tokens", () => {
  const i = ASK.indexOf("if (pidePendientes(consulta))")
  const fn = ASK.slice(i, ASK.indexOf("\n  }", i) + 4) // la rama entera, no una ventana de N caracteres
  assert.match(fn, /t\.importante/)
  assert.match(fn, /tokens: 0/)
  assert.match(fn, /No hay nada sin responder/, "cuando no hay, se dice claro")
})
