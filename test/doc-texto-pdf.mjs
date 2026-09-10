// Antes, TODO PDF se mandaba al OCR de la GPU. La mayoría de los contratos y facturas son digitales: el texto ya
// está adentro y `pdftotext` lo saca gratis. El invariante que se afirma acá: con el OCR APAGADO, un PDF digital
// igual tiene que devolver su texto. Antes devolvía "" con err "OCR apagado", y el buscador quedaba ciego.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { resetDb } from "../src/lib/db-core.mjs"

const HAY_POPPLER = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status != null

// PDF de una página con una frase reconocible y un monto, que es justo lo que se busca en una factura.
function pdfConTexto(frase) {
  const contenido = `BT /F1 12 Tf 15 60 Td (${frase}) Tj ET`
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${contenido.length}>>stream\n${contenido}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]
  let out = "%PDF-1.4\n"
  const offs = []
  objs.forEach((c, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${c}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offs) out += String(o).padStart(10, "0") + " 00000 n \n"
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

async function enSandbox(fn) {
  const raiz = join(process.cwd(), "data-test-doctxt-" + process.pid + "-" + Math.random().toString(36).slice(2))
  const previo = process.cwd()
  mkdirSync(join(raiz, "data", "cas", "cd"), { recursive: true })
  process.chdir(raiz)
  try { return await fn() } finally { process.chdir(previo); rmSync(raiz, { recursive: true, force: true }) }
}

test("PDF digital → texto SIN OCR (el OCR es sólo para escaneados)", { skip: !HAY_POPPLER && "sin poppler" }, async () => {
  await enSandbox(async () => {
    delete process.env.OCR_URL // OCR explícitamente apagado: si igual hay texto, salió de pdftotext
    resetDb(":memory:")
    const { docTexto } = await import("../src/lib/doc-text.mjs?" + Math.random())
    const media = "/cas/cd/cdef1234567890.pdf"
    writeFileSync(join("data", "cas", "cd", "cdef1234567890.pdf"), pdfConTexto("Adenda por S/ 45800 con vencimiento 30-11-2026"))

    const texto = await docTexto(media, "adenda.pdf")
    assert.ok(texto.length > 20, "un PDF digital con OCR apagado tiene que dar texto igual, dio: " + JSON.stringify(texto))
    assert.match(texto, /Adenda/i, "tiene que salir la frase del documento")
    assert.match(texto, /45800/, "el MONTO es el dato que la gente busca: no se puede perder")
  })
})

test("el texto extraído se cachea: el segundo pedido no vuelve a abrir el archivo", { skip: !HAY_POPPLER && "sin poppler" }, async () => {
  await enSandbox(async () => {
    delete process.env.OCR_URL
    resetDb(":memory:")
    const { docTexto } = await import("../src/lib/doc-text.mjs?" + Math.random())
    const media = "/cas/cd/cafe000111222.pdf"
    const ruta = join("data", "cas", "cd", "cafe000111222.pdf")
    writeFileSync(ruta, pdfConTexto("Contrato marco de servicios"))

    const uno = await docTexto(media, "contrato.pdf")
    assert.match(uno, /Contrato marco/i)
    rmSync(ruta) // si volviera a leer el disco, esto lo rompería
    const dos = await docTexto(media, "contrato.pdf")
    assert.equal(dos, uno, "el mismo documento reenviado cinco veces se paga una sola vez")
  })
})
