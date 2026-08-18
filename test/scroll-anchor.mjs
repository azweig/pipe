// SCROLL DE LA CONVERSACIÓN — el hilo "Historias de WhatsApp" (4409 mensajes, 4133 con media) no se podía leer:
// apenas subías, el autoscroll te devolvía al fondo.
//
// Causa: las imágenes se pintaban con `loading="lazy"` y SIN alto reservado → una imagen no cargada mide 0px.
// Con miles de imágenes debajo, `document.body.scrollHeight` era muchísimo menor que la altura real, así que
// el `nearBottom` del poll ("¿estoy a menos de 280px del final?") daba VERDADERO aunque estuvieras arriba de
// todo, y saltaba al fondo. En un hilo de texto la cuenta es correcta; por eso solo se notaba en Historias.
//
// Dos invariantes, las dos estáticas sobre el fuente (mismo enfoque que xss-escaping.mjs: falla en CI, sin navegador).
// Runner: node --test test/scroll-anchor.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SRC = readFileSync("public/app.js", "utf8")
const cuerpo = (desde, hasta) => { const i = SRC.indexOf(desde); assert.ok(i > 0, `no encontré ${desde}`); const j = SRC.indexOf(hasta, i); return SRC.slice(i, j > 0 ? j : i + 4000) }

test("las imágenes del chat reservan alto (si no, scrollHeight miente y el autoscroll se vuelve loco)", () => {
  const media = cuerpo("function mediaHtml(it)", "const audioSum")
  const img = media.split("\n").find((l) => l.includes('mediaType === "image"'))
  assert.ok(img, "no encontré la rama de imagen de mediaHtml")
  assert.ok(/min-height|aspect-ratio|height:\s*\d/.test(img),
    "la imagen se pinta sin alto reservado: mientras no carga mide 0px y falsea document.body.scrollHeight")
  if (img.includes('loading="lazy"')) {
    assert.ok(/onload=/.test(img), "si es lazy con alto reservado, hace falta soltar el alto en onload o quedan huecos")
  }
})

test("el autoscroll respeta que hayas subido (intención guardada, no una medición del momento)", () => {
  const refresh = cuerpo("async function refreshConv(key)", "// ── Calendarizador")
  assert.ok(/window\.scrollTo\(0, document\.body\.scrollHeight\)/.test(refresh), "refreshConv debería seguir pudiendo bajar solo")
  // la condición NO puede ser únicamente una cuenta recalculada contra scrollHeight: si la altura miente, te tira al fondo.
  const soloMedicion = /const nearBottom = window\.innerHeight \+ window\.scrollY >= document\.body\.scrollHeight - \d+\s*\n[\s\S]*if \(nearBottom\) window\.scrollTo/.test(refresh)
  assert.ok(!soloMedicion, "el autoscroll decide con una medición del momento; con media sin cargar esa medición es falsa")
  assert.ok(/stickBottom/.test(refresh), "debería consultar el estado de 'pegado al final' que mantiene el scroll del usuario")
})

test("el estado 'pegado al final' se apaga cuando el usuario sube y se enciende al volver", () => {
  assert.ok(/let stickBottom/.test(SRC), "falta la bandera stickBottom")
  assert.ok(/addEventListener\("scroll"[\s\S]{0,400}stickBottom/.test(SRC), "falta el listener de scroll que la mantiene")
  assert.ok(/stickBottom = true/.test(SRC) && /stickBottom = false/.test(SRC), "la bandera tiene que poder apagarse y encenderse")
})
