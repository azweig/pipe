// ABRIR LA CONVERSACIÓN AL ENTRAR, NO AL ENVIAR.
//
// Caso real: un chat importado desde un .txt de WhatsApp tenía 913 mensajes de historial pero ninguna sala del
// puente. Al responder, el hub pedía abrirla y esperaba ~12s; con la caja cargada no llegaba, el envío fallaba con
// "probá de nuevo en unos segundos", y para el usuario eso es indistinguible de "está roto".
//
// Lo que se fija acá es sobre todo lo que NO tiene que pasar: un id de grupo NO es un teléfono. Un grupo de WhatsApp
// se llama <número del creador>-<timestamp>@g.us, así que leerlo como número abre un chat con una persona ajena.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { numeroParaAbrir, calentarChat, _resetCalentar } from "../src/lib/brain/wa-calentar.mjs"

const msg = (o) => ({ id: "m" + Math.random().toString(36).slice(2), channel: "whatsapp", account: "history",
  jid: "", sender: "s", name: "X", text: "hola", ts: Date.now(), dir: "in", ...o })

test("un hilo importado 1:1 sí se abre", () => {
  assert.equal(numeroParaAbrir("Contacto Importado", { room: null, histJid: "51900000001@s.whatsapp.net" }), "51900000001")
})

// LA REGLA QUE PROTEGE DE MANDARLE UN MENSAJE A UN DESCONOCIDO.
test("un GRUPO nunca se trata como teléfono", () => {
  // El id de un grupo arranca con el número de SU CREADOR: leerlo como teléfono abre un chat con esa persona.
  assert.equal(numeroParaAbrir("whatsapp:51900000002-1613864780@g.us", {}), null)
  assert.equal(numeroParaAbrir("whatsapp:120363024887454918@g.us", {}), null)
  assert.equal(numeroParaAbrir("g", { histJid: "51900000002-1613864780@g.us" }), null)
})

test("si ya hay sala del puente no se abre nada", () => {
  assert.equal(numeroParaAbrir("X", { room: "!sala:dominio.local", histJid: "51900000003@s.whatsapp.net" }), null)
})

test("sin número utilizable, no se inventa uno", () => {
  assert.equal(numeroParaAbrir("email:alguien@ejemplo.com", {}), null)
  assert.equal(numeroParaAbrir("Solo Un Nombre", {}), null)
  assert.equal(numeroParaAbrir("", {}), null)
  assert.equal(numeroParaAbrir("whatsapp:123", {}), null, "demasiado corto para ser un teléfono")
})

// El disparo es FIRE-AND-FORGET (regla del proyecto: abrir una conversación no espera al bridge), así que ocurre en
// la microtarea siguiente. Hay que dejarla correr antes de comprobar; si no, el test mira antes de que pase nada.
const tick = () => new Promise((r) => setImmediate(r))

test("entrar diez veces al mismo hilo dispara UN comando, no diez", async () => {
  resetDb(":memory:")
  _resetCalentar()
  seed([msg({ thread: "importado", jid: "51900000004@s.whatsapp.net" })])
  const llamadas = []
  const abrir = (n) => { llamadas.push(n); return Promise.resolve("!x:y") }
  const t0 = Date.now()
  for (let i = 0; i < 10; i++) calentarChat("importado", abrir, { ahora: t0 + i * 100 })
  await tick()
  assert.deepEqual(llamadas, ["51900000004"])
  // Pasado el plazo sí se vuelve a intentar: si el bridge falló la primera vez, no puede quedar bloqueado para siempre.
  calentarChat("importado", abrir, { ahora: t0 + 200000 })
  await tick()
  assert.equal(llamadas.length, 2)
})

test("un hilo que ya tiene sala no dispara nada", async () => {
  resetDb(":memory:")
  _resetCalentar()
  seed([msg({ thread: "vivo", jid: "!sala:dominio.local", account: "matrix" })])
  const llamadas = []
  calentarChat("vivo", (n) => { llamadas.push(n) })
  await tick()
  assert.deepEqual(llamadas, [])
})
