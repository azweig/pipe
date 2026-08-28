// "SOLO APARECE EN GRUPOS Y NO TENGO SU NÚMERO" — teniendo el número al lado.
//
// En grupos grandes WhatsApp ya no expone el teléfono: manda un LID (identificador interno). Quien te escribió solo
// ahí quedaba inalcanzable desde Pipe: no podías abrirle chat ni con el nombre ni a mano, porque el número no
// aparecía en ningún lado de la app. Pero el bridge mantiene whatsmeow_lid_map con miles de equivalencias
// LID→teléfono, y nadie las estaba usando.
// Runner: node --test test/lid-telefono.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const MX = readFileSync("src/matrix.mjs", "utf8")
const PEOPLE = readFileSync("src/lib/brain/people.mjs", "utf8")
const REPO = readFileSync("src/lib/threads-repo.mjs", "utf8")

test("hay traducción LID → teléfono contra el mapa del bridge", () => {
  assert.match(MX, /export async function lidToPhone\(lid\)/)
  assert.match(MX, /SELECT pn FROM whatsmeow_lid_map WHERE lid=\? OR lid=\?/)
})

test("un fallo de la base del bridge NO se cachea (si no, quedaría sin número para siempre)", () => {
  const i = MX.indexOf("export async function lidToPhone")
  const fn = MX.slice(i, i + 800)
  assert.match(fn, /catch \{[^}]*return null \}/, "el catch sale sin escribir en la cache")
  const iCatch = fn.indexOf("catch {")
  const iSet = fn.indexOf("_lidPn.set")
  assert.ok(iSet > iCatch, "solo se cachea después del catch, o sea con resultado real")
})

test("la ficha de quien solo está en grupos igual trae teléfono", () => {
  assert.match(PEOPLE, /const ghost = grupoSenderDe\(eff\)/)
  assert.match(PEOPLE, /String\(ghost\)\.match\(\/lid-\(\\d\+\)\/\)/)
  assert.match(PEOPLE, /\.\.\.\(telGrupo \? \{ contacts: \{ phones: \[telGrupo\], emails: \[\] \} \} : \{\}\)/)
})

test("también resuelve ghosts que ya vienen con número (no todos son LID)", () => {
  assert.match(PEOPLE, /whatsapp_\(\\d\{8,15\}\)/)
})

test("el remitente sale del nombre, tomando el más frecuente", () => {
  assert.match(REPO, /export function senderPorNombre\(nombre\)/)
  assert.match(REPO, /GROUP BY sender ORDER BY c DESC LIMIT 1/)
})

test("🔒 si el número es de una línea oculta NO se devuelve (sería un oráculo del 2º PIN)", () => {
  const i = PEOPLE.indexOf("const ghost = grupoSenderDe(eff)")
  const fn = PEOPLE.slice(i, i + 900)
  assert.match(fn, /if \(telGrupo\) \{ const oc = secretThreadKeys\(\)/)
  assert.match(fn, /telGrupo = null/)
})

test("sin teléfono, la ficha es IDÉNTICA a la de un nombre inventado", () => {
  // si agregara `contacts: {phones: []}` siempre, la forma de la respuesta ya distinguiría "existe pero oculto" de
  // "no existe" — y eso solo alcanza para enumerar contactos ocultos probando nombres.
  assert.match(PEOPLE, /\.\.\.\(telGrupo \? \{ contacts:/, "el campo contacts es condicional, no siempre presente")
})
