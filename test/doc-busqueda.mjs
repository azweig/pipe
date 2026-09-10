// EL AGUJERO QUE ESTO CIERRA: buscar una palabra que existe SÓLO dentro de un PDF. Hasta acá el buscador veía el
// nombre del archivo y nada más, así que contestaba "no hay información" teniendo el monto escrito en el documento.
// El invariante que se afirma: un término que no aparece en el texto del mensaje ni en el nombre del archivo —sólo
// en el contenido— tiene que devolver el mensaje que trajo ese documento.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle as db } from "../src/lib/db-core.mjs"
import { searchDocs, rebuildDocFts, search } from "../src/lib/search-repo.mjs"

const CONTRATO = "Adenda al contrato marco entre Globex SAC y el proveedor. El monto acordado asciende a S/ 45800 " +
  "y el vencimiento opera el 30 de noviembre de 2026. Responsable designado: Mariana Quispe."

function conUnDocumento({ secreta = false } = {}) {
  resetDb(":memory:")
  seed([{
    id: "m1", channel: secreta ? "whatsapp" : "email", account: secreta ? "wa-secreta" : "buzon",
    thread: "t-globex", jid: "j1", sender: "s1", name: "Globex",
    text: "te paso lo que hablamos", // OJO: el texto del mensaje NO dice nada del contenido
    ts: 1_700_000_000_000, dir: "in",
    media: "/cas/ab/abcdef123456.pdf", mediaType: "document", filename: "adjunto-final.pdf", // el NOMBRE tampoco
  }])
  db().prepare("INSERT INTO doc_text (media, texto, chars, ts, err) VALUES (?,?,?,?,NULL)")
    .run("/cas/ab/abcdef123456.pdf", CONTRATO, CONTRATO.length, Date.now())
}

test("un término que sólo vive DENTRO del PDF encuentra el mensaje", () => {
  conUnDocumento()
  // "Mariana Quispe" no está ni en el text del mensaje ni en el filename: sólo en el contenido del documento
  const r = searchDocs("Mariana Quispe")
  assert.equal(r.length, 1, "tendría que encontrarlo por contenido")
  assert.equal(r[0].id, "m1")
  assert.equal(r[0].thread, "t-globex")
  assert.ok(r[0].snip && /Mariana/i.test(r[0].snip), "tiene que traer el fragmento para poder citarlo: " + r[0].snip)
})

test("el monto que vive dentro del PDF es buscable", () => {
  conUnDocumento()
  assert.equal(searchDocs("45800").length, 1, "el monto es exactamente el dato que la gente busca")
})

test("la búsqueda normal NO lo encuentra: por eso hacía falta doc_fts", () => {
  conUnDocumento()
  assert.equal(search("Mariana Quispe").length, 0,
    "si messages_fts ya lo encontrara, este índice sobraría — el test documenta por qué existe")
})

test("el mismo contrato reenviado cinco veces es UN resultado, no cinco", () => {
  conUnDocumento()
  for (let i = 2; i <= 6; i++) {
    seed([{ id: "m" + i, channel: "whatsapp", account: "wa", thread: "t-otro-" + i, jid: "j", sender: "s", name: "Otro",
      text: "mirá esto", ts: 1_700_000_000_000 + i, dir: "in",
      media: "/cas/ab/abcdef123456.pdf", mediaType: "document", filename: "adjunto-final.pdf" }])
  }
  assert.equal(searchDocs("Mariana").length, 1, "se dedupea por ruta del CAS")
})

test("🔒 un documento de una cuenta secreta no aparece en los resultados", async () => {
  // la marca de cuenta secreta se persiste en ./data, así que este test corre en su propio directorio
  const { mkdirSync, rmSync } = await import("node:fs")
  const { join } = await import("node:path")
  const raiz = join(process.cwd(), "data-test-docsec-" + process.pid)
  const previo = process.cwd()
  mkdirSync(join(raiz, "data"), { recursive: true })
  process.chdir(raiz)
  try {
    const secret = await import("../src/lib/secret.mjs")
    conUnDocumento({ secreta: true }) // canal whatsapp, account "wa-secreta"
    secret.setSecretAccount("whatsapp", "wa-secreta", true)
    const r = searchDocs("Mariana Quispe")
    assert.equal(r.length, 0, "el fragmento de un contrato secreto iría derecho al contexto de la IA")
  } finally { process.chdir(previo); rmSync(raiz, { recursive: true, force: true }) }
})

test("rebuildDocFts indexa lo que ya estaba extraído de antes", () => {
  conUnDocumento()
  db().exec("DELETE FROM doc_fts") // simula la base de hoy: doc_text lleno, doc_fts todavía sin existir
  assert.equal(searchDocs("Mariana").length, 0)
  const n = rebuildDocFts()
  assert.equal(n, 1)
  assert.equal(searchDocs("Mariana").length, 1, "los 10.248 documentos ya extraídos tienen que entrar al índice")
})

test("borrar el texto extraído lo saca del índice (rowid reusado = resultado equivocado)", () => {
  conUnDocumento()
  db().prepare("DELETE FROM doc_text WHERE media=?").run("/cas/ab/abcdef123456.pdf")
  assert.equal(searchDocs("Mariana").length, 0, "sin el trigger de DELETE, el índice queda apuntando a otro documento")
})
