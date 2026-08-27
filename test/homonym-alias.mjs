// DOS BUGS DE IDENTIDAD ENCONTRADOS JUNTOS.
//
// 1) "Ana Colegio Padres Cuotas" (un contacto guardado así en la agenda) mostraba los teléfonos, el correo y
//    la bio de "Ana", que es OTRA persona. No fue una fusión de hilos: personCard tiene un fallback que busca "el chat de la
//    misma persona bajo otro nombre" (legítimo para "Carlos Mendoza"→"Carlos"), y nameExtends() da por bueno
//    cualquier nombre que EMPIECE igual. Encima cachea la decisión como alias aprendido, o sea que el error se
//    vuelve permanente. El detalle fino: un mismo contacto suele estar dos veces, con su número Y con su LID
//    (id interno de WhatsApp). El de LID SÍ es la misma persona, así que la guarda no puede ser "está en la
//    agenda" a secas — partiría su ficha en dos.
//
// 2) Un grupo de WhatsApp era ilocalizable por su nombre: la búsqueda mira la CLAVE del hilo
//    (whatsapp:<creador>-<ts>@g.us) y el nombre del REMITENTE (números crudos). El título del grupo no estaba en
//    ninguno de los dos.
// Runner: node --test test/homonym-alias.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const PEOPLE = readFileSync("src/lib/brain/people.mjs", "utf8")
const THREAD = readFileSync("src/lib/thread.mjs", "utf8")
const REPO = readFileSync("src/lib/threads-repo.mjs", "utf8")

test("un nombre guardado contra un TELÉFONO propio no se fusiona con nadie", () => {
  assert.match(PEOPLE, /if \(reqTok\.length && !telefonoGuardadoDe\(nameOrKey\)\)/)
})

test("contra un LID sí se puede fusionar (es el mismo contacto, otra identidad)", () => {
  assert.match(THREAD, /const esLid = \(d\) => d\.length >= 14/)
  const i = THREAD.indexOf("export function telefonoGuardadoDe")
  assert.match(THREAD.slice(i, i + 500), /!esLid\(d\)/, "solo devuelve teléfonos reales, nunca LIDs")
})

test("si dos contactos encajan por prefijo, no se adivina (el error se cachearía)", () => {
  assert.match(PEOPLE, /const porPrefijo = cand\.filter\(\(c\) => c\.prefix\)\.length/)
  assert.match(PEOPLE, /if \(cand\[0\] && porPrefijo <= 1\)/)
})

test("nameExtends sigue siendo laxo a propósito — por eso hace falta la guarda de afuera", () => {
  assert.match(THREAD, /return a\.startsWith\(b \+ " "\) \|\| b\.startsWith\(a \+ " "\)/)
})

test("la búsqueda encuentra grupos por su TÍTULO, no solo por clave y remitente", () => {
  const i = REPO.indexOf("export function searchThreadKeys")
  const fn = REPO.slice(i, REPO.indexOf("export function threadsSummary"))
  assert.match(fn, /waGroups\(\)/)
  assert.match(fn, /String\(nombre \|\| ""\)\.toLowerCase\(\)\.includes\(raw\.toLowerCase\(\)\)/)
  assert.match(fn, /"whatsapp:" \+ jid/)
  assert.match(fn, /SELECT last_ts FROM thread_stats WHERE thread=\?/, "solo se suman grupos que existan como hilo")
})
