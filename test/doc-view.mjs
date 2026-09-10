// Visor de documentos: convierte de verdad (poppler), no mockea. Lo que se afirma es el INVARIANTE — que de un PDF
// de 2 páginas salgan 2 imágenes en orden, que el resultado se cachee y que un formato sin vista previa se rechace
// con motivo. Nada de comparar contra el texto del código.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const HAY_POPPLER = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" }).status != null

// PDF de 2 páginas armado a mano, con la tabla xref bien calculada (poppler la usa; un xref inventado da "damaged").
function pdfDosPaginas() {
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]/Contents 5 0 R/Resources<</Font<</F1 7 0 R>>>>>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]/Contents 6 0 R/Resources<</Font<</F1 7 0 R>>>>>>",
    null, // 5: contenido pág 1
    null, // 6: contenido pág 2
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]
  const flujo = (txt) => { const s = `BT /F1 18 Tf 15 60 Td (${txt}) Tj ET`; return `<</Length ${s.length}>>stream\n${s}\nendstream` }
  objs[4] = flujo("PAGINA UNO")
  objs[5] = flujo("PAGINA DOS")

  let out = "%PDF-1.4\n"
  const offsets = []
  objs.forEach((cuerpo, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${cuerpo}\nendobj\n` })
  const inicioXref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += String(o).padStart(10, "0") + " 00000 n \n"
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

// El módulo resuelve rutas contra process.cwd()+/data, así que el test corre en su propio directorio temporal.
// ASYNC a propósito: con un `finally` sincrónico sobre un cuerpo asíncrono, el chdir de vuelta corría ANTES de que
// terminara la conversión y el test escribía en el directorio equivocado.
async function enSandbox(fn) {
  const raiz = join(process.cwd(), "data-test-docview-" + process.pid + "-" + Math.random().toString(36).slice(2))
  const cwdPrevio = process.cwd()
  mkdirSync(join(raiz, "data", "cas", "ab"), { recursive: true })
  process.chdir(raiz)
  try { return await fn() } finally { process.chdir(cwdPrevio); rmSync(raiz, { recursive: true, force: true }) }
}

test("PDF de 2 páginas → 2 imágenes numeradas en orden, y la segunda vez sale de cache", { skip: !HAY_POPPLER && "sin poppler" }, async () => {
  await enSandbox(async () => {
    const { docPaginas } = await import("../src/lib/doc-view.mjs?" + Math.random())
    const media = "/cas/ab/abc123deadbeef.pdf"
    writeFileSync(join("data", "cas", "ab", "abc123deadbeef.pdf"), pdfDosPaginas())

    const r = await docPaginas(media, "contrato.pdf")
    assert.equal(r.err, null, "no debería fallar: " + r.err)
    assert.equal(r.pages, 2, "un PDF de 2 páginas tiene que dar 2 imágenes")
    assert.deepEqual(r.urls, [
      "/docview/ab/abc123deadbeef/p001.jpg",
      "/docview/ab/abc123deadbeef/p002.jpg",
    ], "las páginas se numeran p001, p002 — el cliente pide la N sin adivinar el nombre")
    for (const u of r.urls) assert.ok(existsSync(join("data", u.replace(/^\//, ""))), "falta en disco: " + u)

    const otra = await docPaginas(media, "contrato.pdf")
    assert.equal(otra.cached, true, "el documento es inmutable: la segunda vez no se re-convierte")
    assert.equal(otra.pages, 2)
  })
})

test("formato sin vista previa → 0 páginas con motivo, y queda anotado para no reintentar", async () => {
  await enSandbox(async () => {
    const { docPaginas } = await import("../src/lib/doc-view.mjs?" + Math.random())
    writeFileSync(join("data", "cas", "ab", "abcdef0001.zip"), "no soy un documento")
    const r = await docPaginas("/cas/ab/abcdef0001.zip", "backup.zip")
    assert.equal(r.pages, 0)
    assert.match(r.err, /formato/i)
    const otra = await docPaginas("/cas/ab/abcdef0001.zip", "backup.zip")
    assert.equal(otra.cached, true, "el fracaso también se cachea: si no, se reintenta para siempre")
  })
})

test("archivo ausente del CAS → motivo claro, sin excepción", async () => {
  await enSandbox(async () => {
    const { docPaginas } = await import("../src/lib/doc-view.mjs?" + Math.random())
    const r = await docPaginas("/cas/ab/nodeexiste.pdf", "x.pdf")
    assert.equal(r.pages, 0)
    assert.match(r.err, /no está/i)
  })
})

test("XLSX abre en tabla y el PDF en página: LibreOffice parte las columnas anchas", async () => {
  const { vistaPorDefecto, esVisualizable } = await import("../src/lib/doc-view.mjs")
  assert.equal(vistaPorDefecto("ventas.xlsx"), "texto")
  assert.equal(vistaPorDefecto("contrato.pdf"), "paginas")
  assert.equal(vistaPorDefecto("adenda.docx"), "paginas")
  assert.ok(esVisualizable("a.pdf") && esVisualizable("b.docx") && esVisualizable("c.xlsx"))
  assert.ok(!esVisualizable("d.zip") && !esVisualizable("e.mp4"))
})
