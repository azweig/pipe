// CÁMARA EN LA WEB — "no puedo sacar fotos desde la web". La causa NO era un permiso: el botón 📷 estaba
// oculto en escritorio (`display:none` si no es móvil), porque el atributo `capture` del <input type=file>
// solo funciona en el celular. En la computadora, entonces, no había forma de sacar una foto.
// Ahora en escritorio se abre la webcam con getUserMedia y se captura a canvas.
// Runner: node --test test/camara-web.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const APP = readFileSync("public/app.js", "utf8")

test("la cámara está disponible en escritorio (afuera o en el menú ⋯), nunca escondida por plataforma", () => {
  // el botón dejó de tener id fijo: ahora es una acción del compositor, y sale afuera o dentro de "⋯" según cuánto
  // la uses. Lo que NO puede volver es esconderla por ser escritorio, que era el bug original.
  assert.match(APP, /\{ id: "cam", icono: "📷", label: "Sacar una foto"/)
  assert.ok(!/display:\$\{_esMovil \? "block" : "none"\}[^`]*📷/.test(APP), "volvió a esconderse en escritorio")
})

test("en celular usa el input con `capture`; en escritorio abre la webcam", () => {
  const i = APP.indexOf("window.pickCam")
  const fn = APP.slice(i, i + 260)
  assert.match(fn, /_esMovil/, "en el celular tiene que seguir usando el input nativo")
  assert.match(fn, /camInput/)
  assert.match(fn, /abrirCamara\(\)/)
  assert.match(APP, /getUserMedia\(\{ video:/)
})

test("la cámara se apaga al cerrar el panel (si no, la luz queda prendida)", () => {
  const i = APP.indexOf("window.closeSheet")
  assert.match(APP.slice(i, i + 300), /_camStop\(\)/)
  // y _camStop tiene que ser alcanzable desde closeSheet, que está más abajo en el archivo
  assert.match(APP, /^function _camStop\(\)/m, "si es const/let queda en TDZ y closeSheet explota")
  assert.match(APP, /^var _camStream = null/m)
})

test("la foto capturada entra por el mismo camino que el resto de la media", () => {
  const i = APP.indexOf("window.sacarFoto")
  const fn = APP.slice(i, i + 700)
  assert.match(fn, /toBlob/)
  assert.match(fn, /handleMediaChoice\(\[new File\(/)
  assert.match(fn, /_camStop\(\)/, "hay que soltar la cámara después de sacar la foto")
})
