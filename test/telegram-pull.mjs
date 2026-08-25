// TELEGRAM "VIVO PERO SORDO" — el 2026-08-25 el lector estuvo 16 h conectado sin ingerir un solo mensaje.
// El watchdog no lo vio porque sondeaba `getMe()`: la conexión respondía perfecto, lo que había muerto era la
// entrega de updates de GramJS. Medía conexión, no entrega.
//
// El arreglo es un pull de respaldo cada 5 min (pullDesde) que compara contra un corte fijo `since`.
// Runner: node --test test/telegram-pull.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { pullDesde } from "../src/lib/telegram-pull.mjs"

const seg = 1000
const msg = (id, tsMs) => ({ id, date: Math.floor(tsMs / 1000) })
// Cliente falso: un diálogo por entrada, con sus mensajes ordenados como los devuelve Telegram (nuevo → viejo).
function clienteFalso(chats) {
  const llamadas = { dialogs: 0, messages: 0 }
  const client = {
    async getDialogs() { llamadas.dialogs++; return chats.map((c) => ({ entity: c.nombre, message: c.msgs[0] })) },
    async getMessages(entity) { llamadas.messages++; return chats.find((c) => c.nombre === entity).msgs },
  }
  return { client, llamadas }
}
const recolector = () => { const vistos = []; return { vistos, store: async (m) => vistos.push(m.id) } }

test("un chat con actividad reciente no puede tapar lo no visto de otro chat", async () => {
  const ahora = 1_700_000_000_000
  const since = ahora - 60 * 60 * seg
  // A trae algo de hace un minuto; B algo de hace media hora. Si el corte se moviera al guardar A,
  // B quedaría "más viejo que el corte" y se perdería para siempre — que es el bug que se pagó caro.
  const { client } = clienteFalso([
    { nombre: "A", msgs: [msg("a1", ahora - 60 * seg)] },
    { nombre: "B", msgs: [msg("b1", ahora - 1800 * seg)] },
  ])
  const { vistos, store } = recolector()
  const { n } = await pullDesde({ client, store, since, ahora: () => ahora })
  assert.equal(n, 2)
  assert.deepEqual(vistos.sort(), ["a1", "b1"])
})

test("sin nada nuevo cuesta UNA sola llamada: no baja mensajes de ningún chat", async () => {
  const ahora = 1_700_000_000_000
  const { client, llamadas } = clienteFalso([
    { nombre: "A", msgs: [msg("a1", ahora - 5000 * seg)] },
    { nombre: "B", msgs: [msg("b1", ahora - 9000 * seg)] },
  ])
  const { vistos, store } = recolector()
  const { n } = await pullDesde({ client, store, since: ahora - 100 * seg, ahora: () => ahora })
  assert.equal(n, 0)
  assert.equal(vistos.length, 0)
  assert.equal(llamadas.dialogs, 1)
  assert.equal(llamadas.messages, 0, "no debe pedir mensajes de chats sin novedad")
})

test("`masViejo` distingue la carrera del stream sordo (el reader solo reinicia en el segundo caso)", async () => {
  const ahora = 1_700_000_000_000
  const carrera = clienteFalso([{ nombre: "A", msgs: [msg("a1", ahora - 2 * seg)] }])
  const r1 = await pullDesde({ client: carrera.client, store: recolector().store, since: ahora - 600 * seg, ahora: () => ahora })
  assert.ok(r1.masViejo < 180 * seg, "un mensaje de hace 2s es una carrera, no justifica reiniciar")

  const sordo = clienteFalso([{ nombre: "A", msgs: [msg("a1", ahora - 3600 * seg)] }])
  const r2 = await pullDesde({ client: sordo.client, store: recolector().store, since: ahora - 7200 * seg, ahora: () => ahora })
  assert.ok(r2.masViejo > 180 * seg, "un mensaje de hace una hora sin entregar = stream sordo")
})

test("un chat que falla no se lleva puestos a los demás", async () => {
  const ahora = 1_700_000_000_000
  const { client } = clienteFalso([
    { nombre: "roto", msgs: [msg("x", ahora - 60 * seg)] },
    { nombre: "sano", msgs: [msg("ok", ahora - 60 * seg)] },
  ])
  const original = client.getMessages
  client.getMessages = async (e) => { if (e === "roto") throw new Error("FLOOD_WAIT"); return original(e) }
  const { vistos, store } = recolector()
  const { n } = await pullDesde({ client, store, since: ahora - 600 * seg, ahora: () => ahora })
  assert.equal(n, 1)
  assert.deepEqual(vistos, ["ok"])
})
