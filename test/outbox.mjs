// COLA DE ENVÍO IDEMPOTENTE — "a veces sale 502, ¿no podemos reintentar hasta que se envíe?".
// Sí, pero un 502 NO significa "no se envió". El 2026-08-25 hubo dos, opuestos entre sí:
//   · 0 ms    → el server estaba reiniciando, el pedido ni llegó. Reintentar es seguro.
//   · 62.457 ms → el server aceptó el pedido y se colgó. El mensaje PUDO haber salido igual.
// Reintentar el segundo a ciegas manda el mensaje dos veces. De ahí la reserva por `msgId`.
// Runner: node --test test/outbox.mjs
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { resetDb } from "../src/lib/db-core.mjs"
import { claimSend, finishSend, releaseSend, pruneSends } from "../src/lib/outbox-repo.mjs"

beforeEach(() => resetDb(":memory:"))

test("el primer intento se queda con la reserva", () => {
  assert.equal(claimSend("m1").estado, "nuevo")
})

test("un reintento MIENTRAS el primero sigue mandando NO manda de nuevo", () => {
  claimSend("m1")
  assert.equal(claimSend("m1").estado, "en-curso")
})

test("después de que salió, el reintento devuelve el resultado viejo en vez de mandar otra vez", () => {
  claimSend("m1")
  finishSend("m1", { ok: true, id: "wa:123" })
  const r = claimSend("m1")
  assert.equal(r.estado, "hecho")
  assert.deepEqual(r.resultado, { ok: true, id: "wa:123" })
})

test("si el envío falló, la reserva se suelta y el reintento SÍ manda", () => {
  claimSend("m1")
  releaseSend("m1") // el envío tiró error → nunca salió
  assert.equal(claimSend("m1").estado, "nuevo")
})

test("soltar no puede borrar un envío que YA salió (o se duplicaría)", () => {
  claimSend("m1")
  finishSend("m1", { ok: true })
  releaseSend("m1") // una limpieza tardía no debe deshacer lo hecho
  assert.equal(claimSend("m1").estado, "hecho")
})

test("una reserva abandonada (el proceso murió a mitad) se puede retomar — si no, el mensaje nunca saldría", async () => {
  process.env.OUTBOX_STALE_MS = "1"
  const { claimSend: claimFresco } = await import("../src/lib/outbox-repo.mjs?stale=1")
  claimFresco("m1")
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(claimFresco("m1").estado, "nuevo", "a los 2 min una reserva sin terminar se da por abandonada")
  delete process.env.OUTBOX_STALE_MS
})

test("sin msgId (cliente viejo) se comporta como siempre: manda, sin idempotencia", () => {
  assert.equal(claimSend(null).estado, "nuevo")
  assert.equal(claimSend(undefined).estado, "nuevo")
  assert.equal(claimSend("").estado, "nuevo")
})

test("ids distintos no se pisan", () => {
  assert.equal(claimSend("m1").estado, "nuevo")
  assert.equal(claimSend("m2").estado, "nuevo")
  finishSend("m1", { ok: true })
  assert.equal(claimSend("m2").estado, "en-curso")
})

test("la poda borra los viejos y deja los de ahora", async () => {
  claimSend("viejo"); finishSend("viejo", { ok: true })
  await new Promise((r) => setTimeout(r, 25))
  claimSend("reciente"); finishSend("reciente", { ok: true })
  assert.equal(pruneSends(15), 1, "solo el que pasó la edad máxima")
  assert.equal(claimSend("reciente").estado, "hecho", "el reciente sigue protegiendo contra duplicados")
  assert.equal(claimSend("viejo").estado, "nuevo", "el podado ya no bloquea (a esa altura nadie reintenta)")
})
