// ¿EN QUÉ SALA LE ESCRIBO A ESTA PERSONA?
//
// Con varias cuentas de WhatsApp conectadas, el puente crea un portal POR CUENTA: la misma persona tiene dos o tres
// salas, una por cada número tuyo. Elegir mal no da error — el mensaje sale desde un número que esa persona no
// conoce, o no sale. No hay forma de que el usuario lo note salvo que el otro no conteste nunca.
//
// La regla anterior era "la sala creada más recientemente", y eso convertía un error en permanente: un intento que
// resuelve mal crea un portal nuevo bajo la cuenta equivocada, ese portal pasa a ser el más nuevo, y gana siempre
// desde entonces. Medido en producción: un contacto con meses de conversación bajo un número propio recibía los
// mensajes por un portal creado ese mismo día bajo otro número.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { elegirPortal } from "../src/matrix.mjs"

const VIEJO = { rowid: 10, mxid: "!vieja:d", receiver: "51900000001" } // tu número de siempre
const NUEVO = { rowid: 99, mxid: "!nueva:d", receiver: "51900000002" } // el que creó un intento equivocado hoy

// EL CASO QUE ROMPÍA. Las dos cuentas están vivas; la vieja es la que tiene a la persona en su agenda y su historial.
test("gana la cuenta que habla con esa persona, no la sala más nueva", () => {
  const r = elegirPortal([NUEVO, VIEJO], {
    vivos: new Set(["51900000001", "51900000002"]),
    agenda: new Set(["51900000001"]),
    historial: new Map([["51900000001", 480], ["51900000002", 1]]),
  })
  assert.equal(r.mxid, "!vieja:d")
})

test("una sesión muerta no se elige aunque tenga todo lo demás", () => {
  // El puente ACEPTA el evento y después no lo entrega: falla en silencio, que es el peor modo de fallar.
  const r = elegirPortal([VIEJO, NUEVO], {
    vivos: new Set(["51900000002"]),
    agenda: new Set(["51900000001"]),
    historial: new Map([["51900000001", 480]]),
  })
  assert.equal(r.mxid, "!nueva:d")
})

test("a igualdad de pruebas gana la sala VIEJA, no la que acaba de crear un intento", () => {
  const ctx = { vivos: new Set(["51900000001", "51900000002"]), agenda: new Set(["51900000001", "51900000002"]) }
  assert.equal(elegirPortal([NUEVO, VIEJO], ctx).mxid, "!vieja:d")
  assert.equal(elegirPortal([VIEJO, NUEVO], ctx).mxid, "!vieja:d", "el orden de entrada no puede cambiar la decisión")
})

test("el historial desempata entre dos cuentas que la tienen en agenda", () => {
  const r = elegirPortal([VIEJO, NUEVO], {
    vivos: new Set(["51900000001", "51900000002"]),
    agenda: new Set(["51900000001", "51900000002"]),
    historial: new Map([["51900000002", 900]]),
  })
  assert.equal(r.mxid, "!nueva:d")
})

test("sin portales no se inventa ninguno", () => {
  assert.equal(elegirPortal([], {}), null)
})
