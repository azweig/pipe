// #1: los links nunca se corrigen. Testea el enmascarado/restaurado y la detección de "solo links".
import { test } from "node:test"
import assert from "node:assert/strict"
import { maskLinks, unmaskLinks, isOnlyLinks } from "../src/lib/linkmask.mjs"

test("isOnlyLinks: detecta mensajes que son solo un link", () => {
  assert.equal(isOnlyLinks("https://meet.google.com/abc-defg-hij"), true)
  assert.equal(isOnlyLinks("  https://youtu.be/xY_z1  "), true)
  assert.equal(isOnlyLinks("juan@empresa.com"), true)
  assert.equal(isOnlyLinks("mirá esto https://x.com/a"), false)
  assert.equal(isOnlyLinks("8 soles vb porfa"), false)
  assert.equal(isOnlyLinks(""), false)
})

test("maskLinks/unmaskLinks: roundtrip exacto de la URL (con query params y guiones)", () => {
  const cases = [
    "te paso el link https://us02web.zoom.us/j/8391?pwd=Xy_z-1 nos vemos",
    "hola, mandame un mail a juan@empresa.com xfa",
    "dos links https://a.com/1 y https://b.com/2?x=3 dale",
  ]
  for (const c of cases) {
    const { masked, urls } = maskLinks(c)
    assert.equal(unmaskLinks(masked, urls), c, "el roundtrip debe devolver el texto idéntico")
    assert.ok(!/https?:\/\//.test(masked), "el texto enmascarado no debe contener URLs crudas")
  }
})

test("maskLinks: NO colisiona con dígitos del texto ('8 soles')", () => {
  const { masked, urls } = maskLinks("8 soles vb, son 2 personas")
  assert.equal(masked, "8 soles vb, son 2 personas")
  assert.equal(urls.length, 0)
})

test("unmaskLinks: si el LLM 'perdió' un token, ese link queda vacío (el caller usa el original)", () => {
  const { urls } = maskLinks("link https://a.com/x")
  // simula una salida del LLM que borró el token
  assert.equal(unmaskLinks("link", urls).includes("https://a.com/x"), false)
})
