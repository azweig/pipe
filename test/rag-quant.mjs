// El vector del índice se guarda CUANTIZADO a int8 (~1KB) en vez de como texto JSON (~15KB): con 1.8M mensajes
// eso es la diferencia entre ~2GB y ~27GB de disco, y el índice se carga entero en RAM. Se puede porque el coseno
// es invariante a escala. Este test fija que la cuantización NO cambie a quién encuentra la búsqueda.
// Runner: node --test test/rag-quant.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { packVec, unpackVec, cosine, topK } from "../src/lib/embed.mjs"

const rnd = (n, seed) => { let x = seed; return Array.from({ length: n }, () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648 - 0.5 }) }

test("empaquetar y desempaquetar conserva el coseno (error < 1%)", () => {
  for (let s = 1; s <= 5; s++) {
    const a = rnd(768, s * 7), b = rnd(768, s * 13)
    const exacto = cosine(a, b)
    const aprox = cosine(unpackVec(packVec(a)), unpackVec(packVec(b)))
    assert.ok(Math.abs(exacto - aprox) < 0.01, `coseno se desvió: ${exacto} vs ${aprox}`)
  }
})

test("el ORDEN del top-K es el mismo que sin cuantizar", () => {
  const q = rnd(768, 99)
  const idx = Array.from({ length: 30 }, (_, i) => ({ id: i, vec: rnd(768, i + 1) }))
  const exacto = topK(q, idx, 10).map((x) => x.it.id)
  const cuant = topK(unpackVec(packVec(q)), idx.map((it) => ({ ...it, vec: unpackVec(packVec(it.vec)) })), 10).map((x) => x.it.id)
  assert.deepEqual(cuant, exacto, "la cuantización cambió qué documentos encuentra")
})

test("sigue leyendo el formato VIEJO (array de floats) sin migrar", () => {
  const v = rnd(768, 5)
  assert.equal(unpackVec(v), v, "un array pasa tal cual → el índice viejo sigue sirviendo")
})

test("ocupa ~14x menos", () => {
  const v = rnd(768, 3)
  const viejo = JSON.stringify(v).length, nuevo = packVec(v).length
  assert.ok(nuevo * 8 < viejo, `esperaba mucho menos: ${nuevo}B vs ${viejo}B`)
})
