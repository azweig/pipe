// EL CAMINO DEL GRAFO NO VEÍA LOS ADJUNTOS. Cuando la pregunta menciona a alguien conocido, el router usa el grafo
// —no el RAG— y ese camino armaba su contexto solo con mensajes y cuerpos de email. Justo las preguntas sobre plata
// y acuerdos ("¿cuánto me debe X?", "¿cuánto firmé en la adenda?") caen ahí, y la respuesta vive en un adjunto.
//
// Segundo hueco, más de fondo: la prebúsqueda elegía documentos por NOMBRE DE ARCHIVO, así que no podía encontrar
// algo que está DENTRO del PDF (el nombre de la contraparte de un contrato, por ejemplo). Ahora también busca en el
// texto ya extraído — y la búsqueda mejora sola a medida que se extraen más documentos.
// Runner: node --test test/docs-en-grafo.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const ASK = readFileSync("src/lib/brain/ask.mjs", "utf8")
const DOC = readFileSync("src/lib/doc-text.mjs", "utf8")

test("el camino del grafo también mira adjuntos", () => {
  const i = ASK.indexOf("export async function routerSearch")
  const fn = ASK.slice(i)
  assert.match(fn, /docsRelevantes\(question/)
  assert.match(fn, /DOCUMENTOS:/)
})

test("y respeta el gate de lo secreto, igual que el resto del contexto", () => {
  const i = ASK.indexOf("export async function routerSearch")
  const fn = ASK.slice(i)
  assert.match(fn, /excluir: \(c\) => hide\.has\(c\.thread\) \|\| isSecret\(c\)/)
})

test("los dos caminos usan la MISMA prebúsqueda (o uno queda ciego otra vez)", () => {
  const usos = [...ASK.matchAll(/docsRelevantes\(/g)].length
  assert.ok(usos >= 2, `retrieveContext y routerSearch tienen que usarla; encontré ${usos}`)
})

test("la prebúsqueda también mira DENTRO de lo ya extraído", () => {
  assert.match(DOC, /SELECT media FROM doc_text WHERE texto IS NOT NULL/)
  assert.match(DOC, /tokens\.map\(\(\) => "texto LIKE \?"\)\.join\(" AND "\)/, "todos los tokens, o un token suelto trae cualquier cosa")
})

test("un documento que MENCIONA lo que preguntás pesa más que uno que solo lo tiene en el nombre", () => {
  assert.match(DOC, /if \(r\._porContenido\) p \+= 12/)
  assert.match(DOC, /if \(fn\.includes\(t\)\) p \+= 10/)
})
