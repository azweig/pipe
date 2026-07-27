// Test del modo encubierto: round-trip por estilo, clave equivocada falla, texto ajeno no da falso positivo.
import test from "node:test"
import assert from "node:assert"
import { encodeCovert, decodeCovert, styles } from "../src/lib/covertext.mjs"

const PASS = "nuestro café de 2019"
const MSGS = ["nos vemos mañana 3pm en el café", "ok", "traé el paquete, no digas nada por acá 🤫", "1234 clave puerta"]

for (const { id } of styles()) {
  test(`round-trip estilo ${id}`, () => {
    for (const m of MSGS) {
      const cover = encodeCovert(m, PASS, id)
      assert.ok(cover.length > m.length, "el texto tapadera debería tener forma de lenguaje")
      const got = decodeCovert(cover, PASS)
      assert.ok(got, `${id}: no decodificó "${m}"`)
      assert.equal(got.text, m, `${id}: el texto no coincide`)
      assert.equal(got.style, id, `${id}: detectó el estilo equivocado`)
    }
  })
}

test("passphrase equivocada → null (no se lee)", () => {
  const cover = encodeCovert("mensaje secreto", PASS, "poema")
  assert.equal(decodeCovert(cover, "clave mala"), null)
})

test("style-agnóstico: decodifica sin saber el estilo", () => {
  const cover = encodeCovert("hola", PASS, "receta")
  const got = decodeCovert(cover, PASS) // no le paso el estilo
  assert.equal(got?.text, "hola")
})

test("texto ajeno (no encubierto) → null, sin falso positivo", () => {
  for (const t of ["hola como estas", "Cita mañana a las 4 en el consultorio del Dr. Pérez", "la luna arde y el mar canta"]) {
    assert.equal(decodeCovert(t, PASS), null, `falso positivo con: ${t}`)
  }
})

test("el texto tapadera se lee (tiene palabras del idioma, sin bytes raros)", () => {
  const cover = encodeCovert("reunión secreta", PASS, "poema")
  assert.match(cover, /^[A-Za-zÀ-ÿ0-9\s,.\n]+$/, "solo letras/espacios/puntuación")
})
