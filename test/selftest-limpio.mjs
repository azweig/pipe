// EL AUTO-TEST TE LLENABA LA BANDEJA. Cada 12 h Pipe se manda un mensaje a sí mismo por cada canal para detectar
// que algo dejó de enviar. Útil — pero el mensaje quedaba en la bandeja como si fuera correspondencia. Había 499
// acumulados en tres hilos.
//
// Peor: corría a los 6 min de CADA arranque del daemon. Con varios reinicios en un día (un despliegue, un
// mantenimiento) te llegaban decenas. El resultado del test vive en meta['selftest']; el mensaje no aporta nada
// una vez verificado.
// Runner: node --test test/selftest-limpio.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const MANT = readFileSync("src/lib/maintenance.mjs", "utf8")
const DAEMON = readFileSync("src/daemon.mjs", "utf8")

test("los mensajes de prueba se borran solos después de verificarse", () => {
  assert.match(MANT, /export function purgeSelfTest\(ventanaMs = 10 \* 60000\)/)
  assert.match(MANT, /DELETE FROM messages WHERE ts < \? AND \(text LIKE \? OR body LIKE \?\)/)
  assert.match(DAEMON, /maintenance\.purgeSelfTest\(\)/)
})

test("hay una ventana antes de borrar: el lector tiene que poder confirmar la entrega", () => {
  const i = MANT.indexOf("export function purgeSelfTest")
  assert.match(MANT.slice(i, i + 400), /const corte = Date\.now\(\) - ventanaMs/)
})

test("las firmas NO dependen del nombre del producto", () => {
  // los viejos decían "comms-hub self-test" y los nuevos "pipe self-test": atarse al nombre dejó 108 sin borrar
  const i = MANT.indexOf("const FIRMAS")
  const linea = MANT.slice(i, MANT.indexOf("\n", i))
  assert.ok(!/pipe|comms-hub/i.test(linea), `las firmas no pueden nombrar el producto: ${linea}`)
})

test("borrar recalcula la bandeja (o el hilo sigue mostrando la prueba como último mensaje)", () => {
  const i = MANT.indexOf("export function purgeSelfTest")
  assert.match(MANT.slice(i, i + 900), /rebuildStats\(\)/)
})

test("no se re-testea en cada arranque, solo si pasó la ventana", () => {
  assert.match(DAEMON, /if \(Date\.now\(\) - ultimo >= SELFTEST_HOURS \* 3600000\) runSelfTest\(\)/)
  assert.match(DAEMON, /salteo/)
})
