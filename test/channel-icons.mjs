// PARIDAD de canales: si el registro sabe conectar un canal de mensajería, la bandeja tiene que saber DIBUJARLO.
// La web filtra los canales por `CHAN_ICON[c]`: un canal sin entrada ahí llega, se guarda… y aparece sin ninguna
// marca. Pasó con Discord (y de paso Slack y Signal estaban igual). Estático sobre el fuente, como xss-escaping.
// Runner: node --test test/channel-icons.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { CHANNELS } from "../src/lib/channels.mjs"

test("todo canal de mensajería del registro tiene ícono en la web", () => {
  const src = readFileSync("public/app.js", "utf8")
  const i = src.indexOf("const CHAN_ICON = {"), j = src.indexOf("\n}", i)
  assert.ok(i > 0 && j > i, "no encontré CHAN_ICON en public/app.js")
  const bloque = src.slice(i, j)
  const faltan = Object.values(CHANNELS)
    .filter((c) => c.kind === "messaging")
    .map((c) => c.id)
    .filter((id) => !new RegExp(`^\\s*${id}:`, "m").test(bloque))
  assert.deepEqual(faltan, [], `sin ícono en la bandeja (llegan pero no se ven): ${faltan.join(", ")}`)
})

test("todo canal de mensajería tiene nombre para mostrar", () => {
  const src = readFileSync("public/app.js", "utf8")
  const i = src.indexOf("const CH = {"), j = src.indexOf("}", i)
  const bloque = src.slice(i, j)
  const faltan = Object.values(CHANNELS).filter((c) => c.kind === "messaging").map((c) => c.id)
    .filter((id) => !new RegExp(`\\b${id}:`).test(bloque))
  assert.deepEqual(faltan, [], `sin etiqueta: ${faltan.join(", ")}`)
})
