// "BUSCA CUALQUIER MENSAJE QUE DIGA F12" DEVOLVÍA UN RESUMEN INÚTIL. La respuesta era "te enviaste mensajes con F12
// en varias fechas: 2022-07-05, 2022-09-08…" — o sea las FECHAS, no los mensajes. Y existían 102.
//
// Buscar no es preguntar: si pediste los mensajes, se muestran los mensajes. Va antes que el grafo y no gasta un
// solo token — no hay nada que sintetizar.
// Runner: node --test test/buscar-mensajes.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { intentoBuscarTexto } from "../src/lib/brain/ask.mjs"

const ASK = readFileSync("src/lib/brain/ask.mjs", "utf8")
const APP = readFileSync("public/app.js", "utf8")

test("reconoce un pedido de búsqueda y saca el término literal", () => {
  const r = intentoBuscarTexto("busca cualquier mensaje de whatsapp que me haya enviado a mi mismo que diga F12 o algo similar")
  assert.ok(r, "tiene que reconocerlo")
  assert.equal(r.termino, "F12")
  assert.equal(r.soloMios, true, '"a mí mismo" restringe a lo que enviaste vos')
})

test("respeta el término entre comillas", () => {
  assert.equal(intentoBuscarTexto('mostrame los mensajes que digan "orden 4521"')?.termino, "orden 4521")
})

test("una PREGUNTA no se confunde con una búsqueda", () => {
  for (const q of ["cuanta plata me debe el proveedor?", "cual es el ruc de la empresa?", "cuanto firme en la adenda?"]) {
    assert.equal(intentoBuscarTexto(q), null, `"${q}" es una pregunta, no una búsqueda`)
  }
})

test("va ANTES del grafo y no gasta tokens", () => {
  const i = ASK.indexOf("export async function routerSearch")
  const fn = ASK.slice(i, i + 1800)
  const iBuscar = fn.indexOf("const buscar = intentoBuscarTexto(question)")
  const iGrafo = fn.indexOf("activateGraph(question)")
  assert.ok(iBuscar > 0 && iBuscar < iGrafo, "la búsqueda se resuelve antes de activar el grafo")
  assert.match(fn, /tokens: 0/)
})

test("si pediste 'a mí mismo' y no hay ninguno, NO dice que no hay: muestra los otros y avisa", () => {
  const i = ASK.indexOf("const usar = buscar.soloMios")
  assert.ok(i > 0)
  assert.match(ASK.slice(i, i + 400), /mios\.length \? mios : crudos/)
  assert.match(ASK.slice(i, i + 500), /pero hay \$\{crudos\.length\}/)
})

test("🔒 no devuelve mensajes de fuentes ocultas", () => {
  const i = ASK.indexOf("const crudos = dbSearch(buscar.termino")
  assert.match(ASK.slice(i, i + 220), /!hide2\.has\(m\.thread\) && !isSec2\(m\)/)
})

test("la web muestra los mensajes, no un resumen", () => {
  assert.match(APP, /if \(r\.type === "mensajes"\)/)
  assert.match(APP, /mensaje\$\{n === 1 \? "" : "s"\} con/)
})
