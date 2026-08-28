// FICHA DE GRUPO — los grupos no tenían ninguna: entrabas y solo veías la lista de mensajes, sin saber quién habla,
// de qué se habla, ni si es un grupo donde participás o uno que solo mirás. Las personas sí tenían ficha.
//
// Se calcula al vuelo con SQL (sin IA y sin costo, por eso se puede mostrar al abrir el grupo). Los temas salen del
// enriquecedor que ya corría; si un grupo no los tiene, se OMITEN — un tema inventado es peor que ninguno.
// Runner: node --test test/grupo-card.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const REPO = readFileSync("src/lib/threads-repo.mjs", "utf8")
const PEOPLE = readFileSync("src/lib/brain/people.mjs", "utf8")
const SRV = readFileSync("src/server.mjs", "utf8")
const APP = readFileSync("public/app.js", "utf8")

test("quién habla más y tu participación salen de SQL, no de la IA", () => {
  assert.match(REPO, /export function grupoStats\(clave\)/)
  assert.match(REPO, /GROUP BY name ORDER BY n DESC LIMIT 10/)
  assert.match(REPO, /dir='out'/, "tus mensajes se cuentan aparte para saber cuánto participás")
})

test("los números se pasan por la agenda (si no, la lista es una columna de teléfonos)", () => {
  const i = PEOPLE.indexOf("export function grupoCard")
  const fn = PEOPLE.slice(i, i + 2400)
  assert.match(fn, /contactName\(d\)/)
  assert.match(fn, /porNombre/, "dos números de la misma persona tienen que sumar, no competir")
})

test("tu participación se dice con palabras, no solo con un número", () => {
  const i = PEOPLE.indexOf("export function grupoCard")
  const fn = PEOPLE.slice(i, i + 3200)
  assert.match(fn, /perfil: st\.mios === 0 \? "solo lees"/, "0% no es lo mismo que 'escribo poco'")
  assert.match(fn, /puesto/)
})

test("si el grupo no tiene temas extraídos, se omiten (no se inventan)", () => {
  assert.match(REPO, /export function grupoTemas\(clave\)/)
  assert.match(REPO, /catch \{ return \{ temas: \[\], resumen: "" \} \}/)
})

test("🔒 la ficha de un grupo oculto no se sirve", () => {
  const i = SRV.indexOf('path === "/api/group"')
  const linea = SRV.slice(i, i + 300)
  assert.match(linea, /secret\.secretThreadKeys\(\)\.has\(k\)/)
})

test("la web la pide solo para grupos y la pinta con barras", () => {
  assert.match(APP, /p\.isGroup\) \? await api\("\/api\/group\?key="/)
  assert.match(APP, /Cómo se mueve este grupo/)
  assert.match(APP, /width:\$\{Math\.max\(2, t\.pct\)\}%/)
})

test("la misma persona con dos nombres SUMA, no compite (o el ranking miente)", () => {
  const i = PEOPLE.indexOf("export function grupoCard")
  const fn = PEOPLE.slice(i, i + 2400)
  assert.match(fn, /const canonizar = \(nm\)/)
  // el alias aprendido va PRIMERO: nameToCanonMap devuelve el nombre a sí mismo cuando ya es nodo del grafo, y
  // consultarlo antes cortocircuita la unificación.
  const iAlias = fn.indexOf('getMeta("personalias:" + k)')
  const iN2c = fn.indexOf("n2c[k2]")
  assert.ok(iAlias > 0 && iN2c > iAlias, "personalias tiene que consultarse antes que nameToCanonMap")
})
