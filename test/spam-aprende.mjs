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

// Se revisan TODOS los caminos de envío, no el primero que aparezca en el archivo. La versión anterior usaba
// indexOf() —o sea, la primera aparición— y pasaba por casualidad: al agregar un endpoint de envío ANTES en el
// archivo, el test empezó a mirar el nuevo y descubrió que ese camino no marcaba nada. Afirmar el invariante en
// todos lados, no el texto en un lugar.
const enviosQueTerminan = () => {
  const out = []
  for (let i = SRV.indexOf("finishSend("); i >= 0; i = SRV.indexOf("finishSend(", i + 1)) out.push(SRV.slice(i, i + 420))
  return out
}
test("responder también, que es la señal más fuerte — en TODOS los caminos de envío", () => {
  const caminos = enviosQueTerminan()
  assert.ok(caminos.length >= 2, "hay más de un endpoint que envía; si este número baja, revisá por qué")
  for (const c of caminos) assert.match(c, /setNotSpam\(/, "este camino de envío no le avisa al clasificador")
})

test("si falla el des-marcado NO se cae el envío ni el marcado de leído", () => {
  const i = SRV.indexOf('path === "/api/thread/seen"')
  assert.match(SRV.slice(i, i + 320), /try \{ setNotSpam\(b\.key\) \} catch \{\}/)
  // El des-marcado nunca puede tumbar un envío que YA salió: va envuelto en try/catch en todos los caminos.
  for (const c of enviosQueTerminan()) assert.match(c, /try \{[^}]*setNotSpam\(/, "setNotSpam sin try: si falla, se cae un envío ya hecho")
})
