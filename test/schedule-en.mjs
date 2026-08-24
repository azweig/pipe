// AGENDAR: el caso real que se perdió (24-ago, conversación con un contacto que escribe en inglés).
//   18:56  "tonight 8pm?"            ← la hora, sin palabra de reunión
//   18:56  "send me an invite please" ← el pedido, sin hora
//   18:56  "f@boss.technology"
// Pipe no ofreció agendar nada. Tres huecos que se combinaban: el parser de fechas era SOLO español
// (chrono.es no entiende "tonight"), las palabras clave eran casi todas en español (faltaba "invite"),
// y se exigía que la hora y la intención estuvieran en el MISMO mensaje — cuando la gente las escribe seguidas.
// Runner: node --test test/schedule-en.mjs
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { detectSchedule } from "../src/lib/intents.mjs"

const NOW = new Date("2026-08-24T15:00:00").getTime() // 15:00 hora local
const msg = (text, min) => ({ text, dir: "in", name: "Fede", ts: NOW + min * 60000 })

test("caso real: la hora en un mensaje y el pedido en el siguiente", () => {
  const r = detectSchedule([msg("tonight 8pm?", 0), msg("send me an invite please", 1)], { now: NOW })
  assert.equal(r.found, true, "no detectó la reunión")
  assert.equal(r.date.hour, 20, "tiene que ser a las 20:00")
})

test("inglés en un solo mensaje", () => {
  const r = detectSchedule([msg("can we meet tomorrow at 3pm?", 0)], { now: NOW })
  assert.equal(r.found, true)
  assert.equal(r.date.hour, 15)
})

test("el español sigue funcionando igual", () => {
  const r = detectSchedule([msg("dale, nos juntamos mañana a las 10", 0)], { now: NOW })
  assert.equal(r.found, true)
  assert.equal(r.date.hour, 10)
})

test("no inventa reuniones donde no las hay", () => {
  assert.equal(detectSchedule([msg("tonight 8pm?", 0)], { now: NOW }).found, false, "una hora suelta sin intención NO es una reunión")
  assert.equal(detectSchedule([msg("send me an invite please", 0)], { now: NOW }).found, false, "un pedido sin fecha tampoco")
  assert.equal(detectSchedule([msg("meeting cancelled, let's do it another day", 0)], { now: NOW }).found, false, "cancelar no es agendar")
})
