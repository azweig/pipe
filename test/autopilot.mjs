// Piloto automático: config por-contacto (activar/ajustar/listar/desactivar + kill switch). Path del config aislado por env.
import { test } from "node:test"
import assert from "node:assert/strict"
import { tmpdir } from "os"
import { join } from "path"
import { rmSync } from "fs"

const TMP = join(tmpdir(), "autopilot-cfg-" + process.pid + ".json")
process.env.AUTOPILOT_CFG = TMP // los getters de path son lazy → leen esto en cada llamada

const { getAutopilot, setAutopilot, listAutopilot } = await import("../src/lib/brain/autopilot.mjs")
const KEY = "whatsapp:51999000771@s.whatsapp.net"

test.after(() => { try { rmSync(TMP) } catch {} })

test("por defecto un contacto NO tiene piloto automático y sin límite diario (0)", () => {
  const c = getAutopilot(KEY)
  assert.equal(c.enabled, false)
  assert.equal(c.maxPerDay, 0) // 0 = sin límite (son conversaciones)
  assert.deepEqual(listAutopilot(), [])
})

test("activar sin tope = sin límite; y respeta un tope opcional si se pone", () => {
  setAutopilot(KEY, true) // sin maxPerDay → sin límite
  assert.equal(getAutopilot(KEY).maxPerDay, 0)
  setAutopilot(KEY, true, { maxPerDay: 8 }) // tope opcional
  const c = getAutopilot(KEY)
  assert.equal(c.enabled, true)
  assert.equal(c.maxPerDay, 8)
  assert.ok(listAutopilot().includes(KEY))
})

test("desactivar (kill switch por contacto) lo saca de la lista", () => {
  setAutopilot(KEY, false)
  assert.equal(getAutopilot(KEY).enabled, false)
  assert.equal(listAutopilot().includes(KEY), false)
})
