// "PRIORITARIOS" ERA SOLO LO QUE FIJABAS A MANO. Nada podía destacarse solo, así que una invitación real a un
// programa beta quedó mezclada con el marketing del MISMO dominio y se perdió — nadie la marcó porque no había
// nada que marcara.
//
// El detector es heurístico a propósito (0 tokens, explicable). No intenta adivinar "importancia" en abstracto:
// busca las dos señales que separan una oportunidad de un boletín — que sea PERSONAL, y que te pida u ofrezca algo.
// Runner: node --test test/importante.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { evaluarImportancia } from "../src/lib/importante.mjs"

const ev = (o) => evaluarImportancia({ nombrePropio: "Ana", ...o }).importante

test("una invitación personal a un programa se destaca", () => {
  assert.equal(ev({ subject: "Builder Program", text: "Hola Ana, te invitamos al testing team. Confirmanos antes del viernes.", from: "research@empresa.com" }), true)
})

test("una promo del MISMO dominio no", () => {
  assert.equal(ev({ subject: "Sale: 15% off", text: "Oferta exclusiva. unsubscribe", from: "hi@empresa.com" }), false)
})

test("un boletín tampoco, aunque prometa cosas", () => {
  assert.equal(ev({ subject: "Novedades", text: "Oportunidad única. Ver este correo en el navegador.", from: "news@empresa.com" }), false)
})

test("un pedido concreto de una persona real sí", () => {
  assert.equal(ev({ subject: "Reunión", text: "¿Podés confirmar disponibilidad para una llamada?", from: "pedro@cliente.com" }), true)
})

test("una charla normal NO se destaca (o la pestaña se vuelve inútil)", () => {
  assert.equal(ev({ subject: "Re: tema", text: "dale, lo vemos mañana", from: "pedro@cliente.com" }), false)
})

test("un buzón automático nunca, aunque el texto suene urgente", () => {
  assert.equal(ev({ subject: "Su factura vence", text: "Confirme el pago antes del 30", from: "facturacion@proveedor.com" }), false)
  assert.equal(ev({ subject: "Alerta", text: "Confirmá tu cuenta antes del 5", from: "no-reply@servicio.com" }), false)
})

test("un '?' suelto no alcanza: la mitad de los mensajes de trabajo terminan preguntando", () => {
  const SRC = readFileSync("src/lib/importante.mjs", "utf8")
  assert.ok(!/\/\\\?\\s\*\$\/m/.test(SRC), "la regla del signo de pregunta suelto llenaba la pestaña de ruido")
})

test("solo se evalúa lo ENTRANTE y sin responder", () => {
  const INBOX = readFileSync("src/lib/brain/inbox.mjs", "utf8")
  assert.match(INBOX, /if \(r\.lastDir !== "out" && \(r\.unread \|\| unseen\) && bucket !== "spam"\)/)
})
