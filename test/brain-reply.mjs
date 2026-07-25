// M3 (reply) — characterization del RUTEO de destinos: threadTargets compone las salas WhatsApp (dedup por número,
// última sala por número) + los emails (mensajes + identity-manual) y elige el DEFAULT = último ENTRANTE. El
// wrong-recipient es EL fallo que da miedo del send-path → esto PINEA la selección de destino/default.
// Runner: node --test test/brain-reply.mjs
import "./_setup.mjs" // MY_NUMBERS = 15551230001/2/3
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { threadTargets } from "../src/lib/brain.mjs" // por la fachada (invariante: sigue resolviendo tras el split)

const NOW = 1_000_000_000_000
const ROOM_A = "!AAA:pipe.local", ROOM_B = "!BBB:pipe.local"

test("threadTargets: self → sin selector (solo notas locales)", () => {
  resetDb(":memory:")
  assert.deepEqual(threadTargets("self"), { targets: [], default: 0 })
})

test("threadTargets: dedup por NÚMERO real — una entrada por número, la sala más reciente", () => {
  resetDb(":memory:")
  // dos salas portal del MISMO número (51999188771): debe quedar UNA sola entrada, la de ts más nuevo (ROOM_B)
  seed([
    { thread: "ana", jid: ROOM_A, dir: "in", sender: "@whatsapp_51999188771", text: "vieja", ts: NOW },
    { thread: "ana", jid: ROOM_B, dir: "in", sender: "@whatsapp_51999188771", text: "nueva", ts: NOW + 100 },
  ])
  const { targets } = threadTargets("ana")
  const wa = targets.filter((t) => t.channel === "whatsapp")
  assert.equal(wa.length, 1)          // dedup por número
  assert.equal(wa[0].target, ROOM_B)  // la sala MÁS reciente de ese número
  assert.equal(wa[0].label, "+51999188771")
})

test("threadTargets: default = target del último mensaje ENTRANTE (no el más reciente por otra vía)", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", jid: ROOM_A, dir: "in", sender: "@whatsapp_51900000001", text: "primer contacto", ts: NOW },
    { thread: "ana", jid: ROOM_B, dir: "in", sender: "@whatsapp_51900000002", text: "último entrante", ts: NOW + 500 },
    { thread: "ana", jid: ROOM_A, dir: "out", text: "mi respuesta", ts: NOW + 999 }, // out NO define el default
  ])
  const { targets, default: def } = threadTargets("ana")
  assert.equal(targets[def].target, ROOM_B) // el default apunta al último ENTRANTE (ROOM_B), no a mi último 'out'
  assert.ok(targets[def].isDefault)
})

test("threadTargets: emails del hilo + del identity-manual; ordenados por recencia; default=último entrante", () => {
  resetDb(":memory:")
  seed([
    { thread: "email:a@x.com", channel: "email", jid: "a@x.com", account: "gmail", dir: "in", text: "hola", ts: NOW + 10 },
  ])
  const { targets, default: def } = threadTargets("email:a@x.com")
  const emails = targets.filter((t) => t.channel === "email").map((t) => t.target)
  assert.ok(emails.includes("a@x.com"))    // email visto en el hilo
  assert.equal(targets[def].target, "a@x.com") // último (y único) entrante → default
})

test("threadTargets: key email: sin mensajes → igual ofrece la dirección del propio key como destino", () => {
  resetDb(":memory:")
  const { targets } = threadTargets("email:nuevo@x.com")
  assert.deepEqual(targets.map((t) => ({ ch: t.channel, target: t.target })), [{ ch: "email", target: "nuevo@x.com" }])
})

test("threadTargets: contacto sin salas ni emails → sin destinos", () => {
  resetDb(":memory:")
  assert.deepEqual(threadTargets("fantasma"), { targets: [], default: 0 })
})
