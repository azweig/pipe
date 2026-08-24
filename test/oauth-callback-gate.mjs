// LA VUELTA DE GOOGLE TIENE QUE PASAR EL GATE.
//
// La cookie de sesión es SameSite=Strict: en la redirección de vuelta desde accounts.google.com el navegador NO la
// manda. Con el callback DEBAJO del gate, el server veía "no autenticado", respondía la pantalla del PIN, y el
// código de autorización de Google se perdía — sin log, sin token y sin error visible. El usuario solo veía que le
// pedían el PIN y creía que había conectado.
//
// Que el callback esté ANTES del gate no lo deja abierto: exige un `state` que coincida con una cookie que sólo
// emite /oauth/*/start, y ESE sigue detrás del gate. El flujo únicamente lo puede iniciar alguien con sesión.
// Runner: node --test test/oauth-callback-gate.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync("src/server.mjs", "utf8").split("\n")
const linea = (frag) => { const i = src.findIndex((l) => l.includes(frag)); assert.ok(i > 0, `no encontré: ${frag}`); return i }
const GATE = linea("if (!authed) { // no autenticado y remoto")

test("los callbacks de OAuth están ANTES del gate (si no, se pierde la autorización)", () => {
  for (const cb of ['path === "/oauth/google/callback"', 'path === "/oauth/backup/callback"'])
    assert.ok(linea(cb) < GATE, `${cb} quedó DEBAJO del gate: la vuelta de Google va a morir en la pantalla del PIN`)
})

test("los /start siguen DETRÁS del gate (solo con sesión se inicia el flujo)", () => {
  for (const st of ['path === "/oauth/google/start"', 'path === "/oauth/backup/start"'])
    assert.ok(linea(st) > GATE, `${st} quedó ANTES del gate: cualquiera podría iniciar el flujo`)
})

test("el callback exige que el state coincida con la cookie", () => {
  const s = readFileSync("src/server.mjs", "utf8")
  assert.match(s, /state !== cookies\.goauth/, "sin el chequeo de state, el callback abierto sí sería un problema")
  assert.match(s, /state !== cookies\.boauth/)
})

test("el backup avisa si no se tildó el permiso de Drive", () => {
  const s = readFileSync("src/server.mjs", "utf8")
  assert.match(s, /drive\.file[\s\S]{0,200}Reintentá|includes\("drive\.file"\)/,
    "sin validar el scope, quedaba 'conectado' y recién fallaba de noche al subir")
})
