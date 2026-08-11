// 🔒 E2E de superficies DERIVADAS: prueba que radar/home/notas/calendar/search/espacios NO exponen mensajes de fuente secreta.
// Modelo por-canal: se marca un NÚMERO tuyo (owner) secreto → sus salas/jids y sus notas self se ocultan; un contacto con
// línea secreta + línea normal SIGUE visible mostrando SOLO lo no-secreto. Corre en cwd temporal + DB :memory: (no toca prod).
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-secsurf-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
// config: dos números MÍOS; el primero se marcará secreto. NADA hardcodeado en la lib: sale de acá.
writeFileSync(join(dir, "data", "hub-config.json"), JSON.stringify({ myNumbers: ["51999000001", "51999000002"] }))

const dbc = await import("../src/lib/db-core.mjs")
const secret = await import("../src/lib/secret.mjs")
const tr = await import("../src/lib/threads-repo.mjs")
const esp = await import("../src/lib/espacios-repo.mjs")

const SJID = "whatsapp:!roomSecreta:x"   // sala de la línea SECRETA (owner 51999000001)
const NJID = "whatsapp:!roomNormal:x"    // sala de la línea NORMAL  (owner 51999000002)

before(() => {
  dbc.resetDb(":memory:")
  dbc.seed([
    // — contacto PARCIAL "Mili": misma persona en dos salas (una secreta, una normal) —
    { thread: "mili", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000001:x", jid: SJID, text: "hola desde la secreta", ts: 10 },
    { thread: "mili", channel: "whatsapp", dir: "in", name: "Mili", sender: "@whatsapp_5111:x", jid: SJID, text: "MENSAJE_SECRETO_MILI", ts: 11 },
    { thread: "mili", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000002:x", jid: NJID, text: "hola desde la normal", ts: 12 },
    { thread: "mili", channel: "whatsapp", dir: "in", name: "Mili", sender: "@whatsapp_5111:x", jid: NJID, text: "MENSAJE_NORMAL_MILI", ts: 13 },
    // — contacto 100% SECRETO "Solo" (solo en la línea secreta) —
    { thread: "solo", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000001:x", jid: SJID, text: "hola solo", ts: 20 },
    { thread: "solo", channel: "whatsapp", dir: "in", name: "Solo", sender: "@whatsapp_5122:x", jid: SJID, text: "MENSAJE_DE_SOLO", ts: 21 },
    // — notas propias (thread='self'): una por la línea secreta, una normal —
    { thread: "self", channel: "whatsapp", dir: "out", name: "yo", jid: SJID, text: "NOTA_SECRETA_XYZ", ts: 30 },
    { thread: "self", channel: "whatsapp", dir: "out", name: "yo", jid: NJID, text: "NOTA_NORMAL_XYZ", ts: 31 },
    // — llamada perdida por la línea secreta —
    { thread: "solo", channel: "whatsapp", dir: "in", name: "Solo", jid: SJID, mediaType: "call", text: "Llamada perdida", ts: 22 },
    // — import VIEJO: DM 1:1 cuya CLAVE es el número secreto, con jid="" (el número solo vive en la clave) —
    { thread: "whatsapp:51999000001@s.whatsapp.net", channel: "whatsapp", dir: "out", name: "yo", jid: "", sender: "me", text: "IMPORT_VIEJO_SECRETO", ts: 40 },
  ])
  secret.setSecretNumber("51999000001", true) // marca la línea 1 como cuenta secreta
})
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

test("isSecretMsg: mensaje de la sala secreta sí, de la normal no", () => {
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: SJID, thread: "mili" }), true)
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: NJID, thread: "mili" }), false)
})

test("secretGate: 'solo' se oculta entero (100% secreto); 'mili' NO (parcial, sigue visible)", () => {
  const g = secret.secretGate()
  assert.equal(g.hide.has("solo"), true, "solo debe estar en hide")
  assert.equal(g.hide.has("mili"), false, "mili es parcial → NO se oculta entero")
})

test("selfNotesSince (Notas/digest): excluye la nota de la línea secreta", () => {
  const notes = tr.selfNotesSince(0, { limit: 50 }).map((n) => n.text)
  assert.ok(notes.includes("NOTA_NORMAL_XYZ"), "la nota normal debe estar")
  assert.ok(!notes.includes("NOTA_SECRETA_XYZ"), "la nota SECRETA NO debe aparecer")
})

test("recentCalls (Home/radar): no muestra la llamada de la línea secreta (hilo 100%-secreto)", () => {
  const calls = tr.recentCalls(0, { limit: 30 })
  assert.equal(calls.length, 0, "la llamada de 'solo' (secreto) no debe listarse")
})

test("espacioMessages (Espacios): un espacio por nombre 'Mili' muestra SOLO lo no-secreto", () => {
  const r = esp.espacioMessages([{ type: "name", value: "Mili" }], { limit: 50 })
  const texts = r.recent.map((m) => m.text)
  assert.ok(texts.includes("MENSAJE_NORMAL_MILI"), "el mensaje normal debe estar")
  assert.ok(!texts.includes("MENSAJE_SECRETO_MILI"), "el mensaje SECRETO NO debe aparecer")
})

test("import viejo con jid='': DM cuya clave es el número secreto queda oculto entero", () => {
  const k = "whatsapp:51999000001@s.whatsapp.net"
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: "", thread: k }), true, "isSecretMsg por clave DM")
  assert.equal(secret.secretThreadKeys().has(k), true, "debe estar en hide (100% secreto)")
  // un DM 1:1 con un número NO secreto NO se oculta
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: "", thread: "whatsapp:51999000002@s.whatsapp.net" }), false)
  // un GRUPO cuyo id contiene el número secreto NO se oculta por esto
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: "", thread: "whatsapp:51999000001-123@g.us" }), false, "grupo no se oculta")
})

test("desmarcar la cuenta secreta restaura la visibilidad en las superficies derivadas", () => {
  secret.setSecretNumber("51999000001", false)
  const notes = tr.selfNotesSince(0, { limit: 50 }).map((n) => n.text)
  assert.ok(notes.includes("NOTA_SECRETA_XYZ"), "sin marca secreta, la nota vuelve a verse")
  const calls = tr.recentCalls(0, { limit: 30 })
  assert.equal(calls.length, 1, "sin marca secreta, la llamada vuelve")
  secret.setSecretNumber("51999000001", true) // restaurar estado por si otro test corre después
})

// 🔒 EL BUSCADOR DE LA BANDEJA: buscar por nombre no puede ser una puerta trasera a un hilo 100% secreto.
// (regresión: la búsqueda server-side se agregó para llegar a contactos fuera de la ventana de recientes;
//  si no respetara el gate, escribir el nombre revelaría que esa conversación existe).
test("searchThreadKeys encuentra el hilo secreto, pero el gate lo tapa antes de salir", () => {
  const keys = tr.searchThreadKeys("solo", { limit: 20 })
  assert.ok(keys.includes("solo"), "el índice sí lo encuentra (por eso el gate es imprescindible)")
  const hide = secret.secretThreadKeys()
  assert.equal(hide.has("solo"), true, "un hilo 100% secreto NO puede salir en resultados de búsqueda")
  // el parcial sí puede aparecer: se muestra filtrado por-mensaje, no oculto
  assert.equal(hide.has("mili"), false)
})

test("searchThreadKeys: sin query o con 1 letra no devuelve nada (no barre la base entera)", () => {
  assert.deepEqual(tr.searchThreadKeys("", { limit: 20 }), [])
  assert.deepEqual(tr.searchThreadKeys("a", { limit: 20 }), [])
})

test("searchThreadKeys: tolera sintaxis de FTS5 sin explotar", () => {
  for (const q of ['"', 'a OR b', 'x NEAR(y)', "mili*", "((("]) {
    assert.ok(Array.isArray(tr.searchThreadKeys(q, { limit: 5 })), `no debe tirar con: ${q}`)
  }
})
