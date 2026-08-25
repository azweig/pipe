// ESPACIOS EN LAS TRES APPS — el reclamo fue que los espacios "solo se podían manejar desde la web". Al revisar,
// cada superficie tenía un pedazo distinto: la web y el escritorio no podían ELIMINAR, y el móvil no tenía
// excepciones, subespacios ni icono. Este test cuida el lado del server + la web; los otros dos repos tienen el
// suyo (pipe-desktop/src/__tests__/espacios.test.ts, pipe-app/__tests__/espacios.test.js).
// Runner: node --test test/espacios-surfaces.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SERVER = readFileSync("src/server.mjs", "utf8")
const APP = readFileSync("public/app.js", "utf8")

const OPS = ["/api/espacios", "/api/espacio", "/api/espacio/delete", "/api/espacio/rule", "/api/espacio/rule/delete", "/api/espacio/exception", "/api/espacio/exception/delete", "/api/espacio/view"]

test("el server expone las 8 operaciones de espacios", () => {
  for (const op of OPS) assert.ok(SERVER.includes(`"${op}"`), `falta el endpoint ${op}`)
})

test("la web las usa todas (si el server gana una y la web no la toca, se nota acá)", () => {
  for (const op of OPS) assert.ok(APP.includes(op), `la web no llama a ${op}`)
})

test("eliminar un espacio pide confirmación con Cancelar/Eliminar — nunca de un click", () => {
  const i = APP.indexOf("window.delEspacio")
  assert.ok(i > 0, "no encontré el botón de eliminar espacio en la web")
  const sheet = APP.slice(i, i + 700)
  assert.match(sheet, /openSheet/, "tiene que abrir un sheet, no borrar directo")
  assert.match(sheet, /Cancelar/)
  assert.match(sheet, /btn-danger/, "el botón de eliminar va en rojo")
  // el borrado real vive en otra función: el botón de la vista solo abre el sheet
  assert.ok(!/window\.delEspacio = async/.test(APP), "delEspacio no debe borrar directo")
  assert.match(APP, /window\.doDelEspacio = async \(id\) => \{ await post\("\/api\/espacio\/delete"/)
})

test("el nombre del espacio se escapa al pintarlo en el sheet (viene del usuario)", () => {
  const i = APP.indexOf("window.delEspacio")
  assert.match(APP.slice(i, i + 300), /esc\(name\)/)
})
