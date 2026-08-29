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
  assert.match(fn, /docsRelevantes\(consulta/)
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

// EL RECORTE CORTABA LA RESPUESTA POR LA MITAD. En una adenda real el primer monto estaba en el carácter 2469 y el
// segundo en el 2670: el corte a 2500 dejó afuera la mitad de la respuesta, y salió incompleta sin que nada avisara.
test("los documentos no se cortan a ciegas por el principio", () => {
  assert.match(DOC, /export function recortarUtil\(texto, pregunta = "", tope = 8000\)/)
  // conserva el principio (de qué contrato se trata) Y los tramos con cifras o con lo que preguntaste
  assert.match(DOC, /const cabeza = t\.slice\(0, Math\.floor\(tope \* 0\.4\)\)/)
  assert.match(DOC, /\\\$\|S\/\|USD\|EUR/)
  assert.ok(!/\.slice\(0, 2500\)/.test(ASK), "ningún camino puede volver al corte fijo a 2500")
})

test("los dos caminos usan el recorte útil", () => {
  const usos = [...ASK.matchAll(/recortarUtil\(/g)].length
  assert.ok(usos >= 2, `retrieveContext y routerSearch; encontré ${usos}`)
})

test("un candidato mucho más flojo que el mejor se descarta (gasta prompt y mete ruido)", () => {
  assert.match(DOC, /if \(mejor >= 10 && c\.p < mejor \* 0\.5\) continue/)
})

test("se corrigen las confusiones de OCR que pegan en las siglas peruanas", () => {
  // un PDF escaneado devuelve "HGV" por "IGV": el monto está bien pero la respuesta se ve mal. Solo palabras
  // COMPLETAS y lista corta — corregir de más arruina el texto original.
  assert.match(DOC, /const OCR_FIX = \[/)
  assert.match(DOC, /"IGV"/)
  assert.match(DOC, /"RUC"/)
  assert.match(DOC, /texto = arreglarOcr\(/)
})
