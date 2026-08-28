// COMPOSITOR WEB INUSABLE POR CANTIDAD DE ICONOS — eran 6 botones en fila (📎 📷 👤 🩷 🎤 🎤IA) más el de IA, el
// de canal, el corrector y enviar. El input quedaba aplastado.
//
// Ahora afuera van solo las DOS acciones que más usa la persona —contadas de verdad en localStorage, no elegidas a
// dedo— y el resto a un "⋯". Enviar y el corrector NO entran al menú: enviar es obvio, y el corrector cambia lo que
// se manda, así que tiene que estar siempre visible.
// Runner: node --test test/composer-acciones.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const APP = readFileSync("public/app.js", "utf8")

test("las acciones se ordenan por uso REAL, no por una lista fija", () => {
  assert.match(APP, /const usoComposer = \(\) => \{ try \{ return JSON\.parse\(localStorage\.getItem\("compUso"\)/)
  assert.match(APP, /window\.marcarUso = \(id\)/)
  assert.match(APP, /\.sort\(\(a, b\) => \(u\[b\.id\] \|\| 0\) - \(u\[a\.id\] \|\| 0\)/)
})

test("cada acción cuenta su uso al tocarla (si no, el orden nunca aprende)", () => {
  const i = APP.indexOf("window.accComp = (id)")
  assert.ok(i > 0, "falta el despachador")
  assert.match(APP.slice(i, i + 300), /marcarUso\(id\)/)
})

test("el onclick NO interpola la función: solo el id, escapado (idioma anti-XSS del proyecto)", () => {
  const i = APP.indexOf("const btn = (a) =>")
  assert.match(APP.slice(i, i + 300), /onclick="accComp\(\$\{escj\(a\.id\)\}\)"/)
  assert.ok(!/eval\(a\.fn\)/.test(APP), "nada de eval, aunque el dato sea constante")
})

test("afuera quedan exactamente dos; el resto en ⋯", () => {
  assert.match(APP, /const fuera = orden\.slice\(0, 2\), dentro = orden\.slice\(2\)/)
  assert.match(APP, /dentro\.length \? `<button id="masBtn"/)
})

test("sin historial el orden por defecto es 📎 y 🎤 (lo que usa cualquiera al empezar)", () => {
  const i = APP.indexOf("const COMP_ACCIONES = [")
  const lista = APP.slice(i, i + 700)
  const ids = [...lista.matchAll(/id: "(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(ids.slice(0, 2), ["attach", "mic"])
})

test("enviar y el corrector NO se esconden en el menú", () => {
  const i = APP.indexOf("const COMP_ACCIONES = [")
  const lista = APP.slice(i, i + 700)
  assert.ok(!/correctBtn|toggleCorrect|sendMsg\(\)/.test(lista), "el corrector y enviar quedan siempre a la vista")
})

test("el menú abre un sheet y marca el uso también desde ahí", () => {
  const i = APP.indexOf("window.masAcciones")
  const fn = APP.slice(i, i + 600)
  assert.match(fn, /openSheet\(/)
  assert.match(fn, /accComp\(\$\{escj\(a\.id\)\}\)/)
})
