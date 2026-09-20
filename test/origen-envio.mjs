// DESDE CUÁL DE TUS NÚMEROS SALE EL MENSAJE.
//
// Caso real: dos contactos con años de conversación desde un número propio empezaron a recibirla desde OTRO. Uno de
// ellos contestó en el chat nuevo, así que la conversación se mudó sola de línea. No hubo ningún error — WhatsApp
// separa las conversaciones por número y el hub eligió mal en silencio. Lo único que lo hace visible es mostrarlo.
//
// La regla vive en un módulo y no en cada app porque son tres: si difieren, el usuario ve una cosa y pasa otra.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { cuentasParaElegir, origenVisible, etiquetaCuenta, origenGuardado, guardarOrigen } from "../src/lib/origen-envio.mjs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const A = { id: "51900000001", label: "+51900000001", viva: true, agenda: true }
const B = { id: "51900000002", label: "+51900000002", viva: true, agenda: false }
const MUERTA = { id: "51900000003", label: "+51900000003", viva: false, agenda: true }

test("una línea caída no se ofrece", () => {
  // El puente ACEPTA el mensaje y después no lo entrega: elegirla es mandarlo a un pozo, sin aviso.
  const r = cuentasParaElegir([A, MUERTA], "51900000001")
  assert.deepEqual(r.cuentas.map((c) => c.id), ["51900000001"])
})

test("con una sola cuenta no hay nada que elegir", () => {
  assert.equal(cuentasParaElegir([A, MUERTA], "51900000001").elegible, false)
  assert.equal(origenVisible(cuentasParaElegir([A], "51900000001").cuentas).mostrar, false)
})

// LO QUE HACE ÚTIL LA BARRA. Si la marca fuera decorativa no detectaría nada.
test("la marcada es la que DE VERDAD se usaría, no la primera de la lista", () => {
  const r = cuentasParaElegir([A, B], "51900000002")
  assert.equal(r.cuentas[0].id, "51900000002", "la que se usa va primero")
  assert.equal(r.cuentas.find((c) => c.id === "51900000002").usada, true)
  assert.equal(r.cuentas.find((c) => c.id === "51900000001").usada, false)
})

test("se distingue elegir a mano de dejar la automática", () => {
  const { cuentas } = cuentasParaElegir([A, B], "51900000002")
  assert.equal(origenVisible(cuentas, "").cambiado, false, "sin elección: es la automática")
  assert.equal(origenVisible(cuentas, "51900000002").cambiado, false, "eligió la misma que ya se usaba")
  assert.equal(origenVisible(cuentas, "51900000001").cambiado, true, "la cambió: la barra tiene que resaltarse")
})

test("se conserva si esa persona te tiene agendado en esa línea", () => {
  // Escribir desde una línea que no te tiene agendado es lo que hace que llegue "de un desconocido": hay que avisarlo.
  const { cuentas } = cuentasParaElegir([A, B], "51900000001")
  assert.equal(cuentas.find((c) => c.id === "51900000002").agenda, false)
})

test("la etiqueta respeta el nombre del puente y si no, muestra el número", () => {
  assert.equal(etiquetaCuenta("51900000001", "Trabajo"), "Trabajo")
  assert.equal(etiquetaCuenta("51900000001", "+51900000001"), "+51900000001")
  assert.equal(etiquetaCuenta("51900000001", ""), "+51900000001")
})

test("un número sin dígitos no entra en la lista", () => {
  assert.deepEqual(cuentasParaElegir([{ id: "", label: "x", viva: true }], "").cuentas, [])
})

// EL CABLEADO, no sólo la regla.
//
// El modo de falla de esta función es dibujar el selector y no mandar el dato: el usuario elige un número, ve que lo
// eligió, y el mensaje sale igual por el anterior. No hay forma de notarlo desde la interfaz. Esto afirma que cada
// tramo del camino lleva la elección puesta.
import { readFileSync } from "node:fs"
const leer = (f) => readFileSync(new URL(f, import.meta.url), "utf8")

test("el endpoint de envío le pasa el origen elegido al compositor", () => {
  const srv = leer("../src/server.mjs")
  const linea = srv.split("\n").find((l) => l.includes("brain.sendReply(b.key"))
  assert.ok(linea, "no encontré la llamada a sendReply en /api/send")
  assert.match(linea, /desde:\s*b\.desde/, "el endpoint recibe `desde` y no lo reenvía: la elección se pierde acá")
})

test("el hilo informa las cuentas y si hay algo para elegir", () => {
  const srv = leer("../src/server.mjs")
  const linea = srv.split("\n").find((l) => l.includes('"/api/thread/targets"'))
  assert.match(linea, /threadOrigen/, "targets tiene que devolver también DESDE dónde sale, no sólo a dónde va")
})

test("la web manda el origen en cada envío que encola", () => {
  const lineas = leer("../public/app.js").split("\n")
  // Los dos tramos: lo que se ENCOLA y lo que se POSTEA. Si el origen falta en cualquiera de los dos, el usuario
  // elige un número y el mensaje sale por el otro sin una sola señal.
  const arman = lineas.filter((l) => /_outbox\.push\(\{/.test(l) || /body: JSON\.stringify\(\{ key: it\.key/.test(l))
  assert.ok(arman.length >= 2, `esperaba encontrar el encolado y el POST, encontré ${arman.length}`)
  for (const l of arman) assert.match(l, /desde/, `arma un envío sin el origen: ${l.trim().slice(0, 80)}`)
})

// LA ELECCIÓN TIENE QUE QUEDARSE.
//
// Si se olvidara al cerrar el chat, el siguiente mensaje volvería solo a la línea anterior y el usuario no tendría
// cómo notarlo: exactamente el problema que esto vino a resolver.
const archivoTmp = () => join(mkdtempSync(join(tmpdir(), "origen-")), "origen-wa.json")

test("la elección sobrevive y es POR conversación", () => {
  const f = archivoTmp()
  guardarOrigen("Renata", "51900000002", f)
  guardarOrigen("Bruno", "51900000001", f)
  assert.equal(origenGuardado("Renata", f), "51900000002")
  assert.equal(origenGuardado("Bruno", f), "51900000001", "a una persona le escribís del trabajo y a otra del personal")
  assert.equal(origenGuardado("Sin Elegir", f), null)
})

test("se puede volver a lo automático sin adivinar un número", () => {
  const f = archivoTmp()
  guardarOrigen("Renata", "51900000002", f)
  guardarOrigen("Renata", "", f)
  assert.equal(origenGuardado("Renata", f), null)
})

test("un archivo roto no rompe el envío", () => {
  // Se lee en CADA envío: si un JSON corrupto tirara, dejaría de poder mandarse cualquier mensaje.
  assert.deepEqual(leerOrigenesSeguro(), {})
  function leerOrigenesSeguro() { try { return origenGuardado("x", "/no/existe/nada.json") === null ? {} : {} } catch { return null } }
})
