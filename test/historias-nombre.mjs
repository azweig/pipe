// LAS HISTORIAS SE "MEZCLABAN" CON CONTACTOS — un contacto aparecía en la bandeja como conversación propia, con
// una sola historia adentro y sin ningún historial. No era una conversación: era el hilo de historias mal rotulado.
//
// Causa: el hilo de historias tiene clave `whatsapp:status@broadcast`, pero su `jid` es la SALA DE MATRIX
// (!xxx:dominio) que creó el bridge. El código probaba /status@broadcast/ contra el jid, así que nunca daba
// verdadero; el hilo caía al caso genérico de grupo y tomaba el nombre de quien había publicado ÚLTIMO.
// Runner: node --test test/historias-nombre.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SRC = readFileSync("src/lib/brain/inbox.mjs", "utf8")

test("las historias se detectan por la CLAVE del hilo, no solo por el jid", () => {
  const i = SRC.indexOf('name = "Historias de WhatsApp"')
  assert.ok(i > 0, "no encontré el rótulo de historias")
  const linea = SRC.slice(SRC.lastIndexOf("\n", i), i)
  assert.match(linea, /r\.key/, "sin mirar r.key, el jid de Matrix hace que nunca dispare")
})

test("sigue reconociéndolas por jid (hilos viejos o sin sala de Matrix)", () => {
  const i = SRC.indexOf('name = "Historias de WhatsApp"')
  const linea = SRC.slice(SRC.lastIndexOf("\n", i), i)
  assert.match(linea, /\/status@broadcast\/\.test\(jid\)/)
})

test("el rótulo va ANTES del caso genérico de grupo (si no, gana el nombre del último que publicó)", () => {
  const iStatus = SRC.indexOf('name = "Historias de WhatsApp"')
  const iGenerico = SRC.indexOf('`Grupo · ${plural(', iStatus - 2000)
  assert.ok(iStatus < iGenerico, "el caso de historias tiene que evaluarse primero")
})
