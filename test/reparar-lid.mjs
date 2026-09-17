// EL JID DICE QUIÉN HABLA, NO CON QUIÉN.
//
// Un mensaje de WhatsApp puede entrar con un LID (el identificador de privacidad) sin resolver y quedar archivado
// DENTRO de la conversación de otra persona. Reubicarlo es sano; el problema es la excepción.
//
// Caso real, y por poco se aplica: en dos conversaciones ajenas había 251 mensajes cuyo LID era MÍO. Mudarlos al
// "hilo de ese número" los habría sacado de conversaciones reales para meterlos en un hilo conmigo mismo. Cuando el
// LID resuelve a un número propio no identifica la conversación, identifica al que escribe, y el mensaje ya está
// donde corresponde. Eso es lo que fija este archivo.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { movimientos, duenioPorTelefono } from "../scripts/reparar-lid.mjs"

const LID = new Map([["999", "51900000001"], ["888", "51999999999"], ["777", "51900000002"]])
const DUENIO = new Map([
  ["51900000001", { thread: "Renata", n: 500 }],
  ["51999999999", { thread: "yo-mismo", n: 9 }],
  ["51900000002", { thread: "Ana", n: 3 }],
])
const MIOS = new Set(["51999999999"])
const ids = (r) => r.map((x) => `${x.id}→${x.a}`)

test("un mensaje archivado en la ficha equivocada se reubica", () => {
  assert.deepEqual(ids(movimientos([{ id: "a", thread: "Bruno", jid: "999@lid" }], LID, DUENIO, MIOS)), ["a→Renata"])
})

// LA REGLA QUE EVITA VACIAR CONVERSACIONES.
test("tu propio LID dentro de una conversación ajena NO se toca", () => {
  assert.deepEqual(movimientos([{ id: "b", thread: "Bruno", jid: "888@lid" }], LID, DUENIO, MIOS), [])
})

test("un LID que el puente no conoce no se adivina", () => {
  assert.deepEqual(movimientos([{ id: "d", thread: "Bruno", jid: "123@lid" }], LID, DUENIO, MIOS), [])
})

test("lo que ya está en su hilo se deja quieto", () => {
  assert.deepEqual(movimientos([{ id: "c", thread: "Renata", jid: "999@lid" }], LID, DUENIO, MIOS), [])
})

test("el dueño de un teléfono es el hilo con más mensajes suyos, no el primero que aparece", () => {
  const d = duenioPorTelefono([
    { thread: "Apodo", jid: "51900000003@s.whatsapp.net", n: 4 },
    { thread: "Nombre Real", jid: "51900000003@s.whatsapp.net", n: 900 },
  ])
  assert.equal(d.get("51900000003").thread, "Nombre Real")
})
