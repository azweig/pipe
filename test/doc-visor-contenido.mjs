// DOS BUGS QUE SE VIERON RECIÉN AL PROBARLO CON DOCUMENTOS REALES, y que los tests anteriores no atrapaban porque
// probaban las piezas por separado y no el camino que recorre la app:
//
//  1. `docView` decidía por la EXTENSIÓN si valía la pena convertir, y recién después llamaba a `docPaginas` — que es
//     la única que sabe reconocer el archivo por su contenido. Con un documento guardado como `.bin` y sin filename,
//     el atajo cortaba antes y el visor contestaba "0 páginas" SIN HABER MIRADO el archivo.
//  2. El texto de un HTML salía siendo la hoja de estilos: quitar las ETIQUETAS no alcanza, porque el contenido de
//     <style> y <script> vive AFUERA de la etiqueta.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { resetDb, seed } from "../src/lib/db-core.mjs"

const HAY_POPPLER = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" }).status != null

function pdfUnaPagina() {
  const contenido = "BT /F1 14 Tf 15 60 Td (CONTRATO) Tj ET"
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${contenido.length}>>stream\n${contenido}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ]
  let out = "%PDF-1.4\n"; const offs = []
  objs.forEach((c, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${c}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of offs) out += String(o).padStart(10, "0") + " 00000 n \n"
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

async function enSandbox(fn) {
  const raiz = join(process.cwd(), "data-test-visor-" + process.pid + "-" + Math.random().toString(36).slice(2))
  const previo = process.cwd()
  mkdirSync(join(raiz, "data", "cas", "ab"), { recursive: true })
  process.chdir(raiz)
  try { return await fn() } finally { process.chdir(previo); rmSync(raiz, { recursive: true, force: true }) }
}

const mensaje = (media) => ({
  id: "m1", channel: "whatsapp", account: "wa", thread: "t1", jid: "j1", sender: "s1", name: "Cliente",
  text: "te paso esto", ts: 1, dir: "in", media, mediaType: "document", filename: null, // filename NULL, como llega de verdad
})

test("docView convierte un .bin sin filename: no puede cortar por la extensión", { skip: !HAY_POPPLER && "sin poppler" }, async () => {
  await enSandbox(async () => {
    resetDb(":memory:")
    delete process.env.OCR_URL
    writeFileSync(join("data", "cas", "ab", "deadbeef01.bin"), pdfUnaPagina())
    seed([mensaje("/cas/ab/deadbeef01.bin")])
    const { docView } = await import("../src/lib/brain/docs.mjs?" + Math.random())
    const v = await docView({ id: "m1" }, {})
    assert.equal(v.pages, 1, "el atajo por extensión devolvía 0 páginas sin abrir el archivo. err=" + (v.err || "-"))
    assert.equal(v.visor, true, "`visor` tiene que ser el RESULTADO de intentar, no un pronóstico por el nombre")
    assert.equal(v.urls.length, 1)
  })
})

test("el texto de un HTML es el TEXTO, no la hoja de estilos", async () => {
  await enSandbox(async () => {
    resetDb(":memory:")
    delete process.env.OCR_URL
    const html = `<!DOCTYPE html><html><head><title>Manual</title>
<style>:root{ --navy:#122A4E; --orange:#F2650F; } .sidebar{ width:290px;flex:none; }</style>
<script>var x = 1; function noVa(){ return "esto tampoco" }</script></head>
<body><h1>Manual del Administrador</h1><p>M&oacute;dulo 3: Moderaci&oacute;n de Rese&ntilde;as</p></body></html>`
    writeFileSync(join("data", "cas", "ab", "manual0001.bin"), html)
    seed([mensaje("/cas/ab/manual0001.bin")])
    const { docTextView } = await import("../src/lib/brain/docs.mjs?" + Math.random())
    const r = await docTextView({ id: "m1" }, {})

    assert.match(r.texto, /Manual del Administrador/, "el texto de verdad tiene que estar")
    assert.ok(!/122A4E|--orange|sidebar|width:290px/.test(r.texto), "se coló el CSS: " + r.texto.slice(0, 120))
    assert.ok(!/function noVa|var x = 1/.test(r.texto), "se coló el JavaScript: " + r.texto.slice(0, 120))
    assert.ok(!/<[a-z]/i.test(r.texto), "quedaron etiquetas sin limpiar")
  })
})

test("las entidades HTML se decodifican (un módulo no es un m&oacute;dulo)", async () => {
  await enSandbox(async () => {
    resetDb(":memory:")
    delete process.env.OCR_URL
    writeFileSync(join("data", "cas", "ab", "ent0001.bin"), "<html><body><p>Precio &amp; plazo &lt;30 d&iacute;as&gt;</p></body></html>")
    seed([mensaje("/cas/ab/ent0001.bin")])
    const { docTextView } = await import("../src/lib/brain/docs.mjs?" + Math.random())
    const r = await docTextView({ id: "m1" }, {})
    assert.match(r.texto, /Precio & plazo/, "&amp; tiene que volver a ser &: " + r.texto)
    assert.ok(!/&amp;|&lt;|&gt;/.test(r.texto), "quedaron entidades crudas: " + r.texto)
  })
})
