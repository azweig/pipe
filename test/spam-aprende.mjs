// UN CORREO IMPORTANTE ENTERRADO EN SPAM. Una invitación real quedó clasificada como spam junto al marketing del
// MISMO dominio, y el usuario se la perdió: nunca la vio. Había 337 hilos marcados spam.
//
// El clasificador va a seguir equivocándose — lo que no puede pasar es que el error sea permanente. Tu atención es
// la señal más honesta: si abriste algo, o peor, si lo respondiste, no es spam. Y eso no requiere que busques
// ningún botón.
// Runner: node --test test/spam-aprende.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SRV = readFileSync("src/server.mjs", "utf8")

test("abrir un hilo lo saca de spam", () => {
  const i = SRV.indexOf('path === "/api/thread/seen"')
  const linea = SRV.slice(i, i + 320)
  assert.match(linea, /setNotSpam\(b\.key\)/)
})

test("responder también, que es la señal más fuerte", () => {
  const i = SRV.indexOf("finishSend(b.msgId, r)")
  assert.match(SRV.slice(i, i + 260), /setNotSpam\(b\.key\)/)
})

test("si falla el des-marcado NO se cae el envío ni el marcado de leído", () => {
  const i = SRV.indexOf('path === "/api/thread/seen"')
  assert.match(SRV.slice(i, i + 320), /try \{ setNotSpam\(b\.key\) \} catch \{\}/)
  const j = SRV.indexOf("finishSend(b.msgId, r)")
  assert.match(SRV.slice(j, j + 260), /try \{ if \(b\.key\) setNotSpam\(b\.key\) \} catch \{\}/)
})
