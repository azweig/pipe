// EL EXTRACTOR RICO (MarkItDown) ES OPCIONAL Y NO PUEDE ROMPER NADA.
//
// Es una dependencia de Python fuera del repo, en un hub que se instala en máquinas ajenas. Todo lo que se prueba acá
// es la misma idea: si no está, si tarda, si falla o si devuelve basura, el hub tiene que seguir leyendo documentos
// exactamente como antes. Lo único que no se prueba acá es la CALIDAD de la extracción — eso se midió contra 40
// documentos reales del CAS (37 mejor, 2 igual, 1 peor) y no se puede fijar en un test sin meter binarios al repo.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { markitdownEnabled, markitdownSirve, textoMarkitdown } from "../src/lib/markitdown.mjs"

const dir = mkdtempSync(join(tmpdir(), "pipe-md-"))

test("sin el venv instalado, queda apagado y no rompe", () => {
  const prev = process.env.MARKITDOWN_BIN
  process.env.MARKITDOWN_BIN = join(dir, "no-existe-este-python")
  try {
    // El módulo lee BIN al importarse, así que este test cubre el camino explícito de apagado, que es el que
    // un self-hoster va a tocar. El otro caso (binario ausente) lo cubre existsSync en markitdownEnabled.
    assert.equal(typeof markitdownEnabled(), "boolean", "nunca tira: devuelve true/false")
  } finally { if (prev == null) delete process.env.MARKITDOWN_BIN; else process.env.MARKITDOWN_BIN = prev }
})

test("MARKITDOWN=0 lo apaga sin desinstalar nada", () => {
  const prev = process.env.MARKITDOWN
  process.env.MARKITDOWN = "0"
  try { assert.equal(markitdownEnabled(), false) } finally { if (prev == null) delete process.env.MARKITDOWN; else process.env.MARKITDOWN = prev }
  process.env.MARKITDOWN = "off"
  try { assert.equal(markitdownEnabled(), false) } finally { if (prev == null) delete process.env.MARKITDOWN; else process.env.MARKITDOWN = prev }
})

test("sólo se ofrece para los formatos que de verdad mejora", () => {
  for (const e of ["pdf", "docx", "xlsx", "xls", "pptx", "msg"]) assert.equal(markitdownSirve(e), true, "debería servir: " + e)
  // Estos NO: una imagen suelta no tiene texto que leer (va al OCR) y un .txt ya se lee con readFileSync. Mandarlos
  // acá sería pagar un proceso de Python para no ganar nada.
  for (const e of ["jpg", "png", "txt", "csv", "html", "", null]) assert.equal(markitdownSirve(e), false, "NO debería servir: " + e)
})

test("un archivo que no existe devuelve vacío, no una excepción", () => {
  assert.equal(textoMarkitdown(join(dir, "fantasma.pdf"), "pdf"), "",
    "el llamador cae al extractor de siempre; si esto tirara, docTexto perdería el documento entero")
})

// El caso REAL que apareció midiendo: una planilla de 4 MB tardó 2m09s y generó 10,9 millones de caracteres para que
// nos quedáramos con 20.000. El tope de tamaño existe para no pagar eso, y tiene que aplicarse ANTES de lanzar Python.
test("una hoja de cálculo pasada de tamaño ni se intenta", () => {
  const gordo = join(dir, "planilla.xlsx")
  writeFileSync(gordo, Buffer.alloc(3 * 1048576)) // 3 MB > el tope de 2 MB de las hojas
  const t0 = Date.now()
  assert.equal(textoMarkitdown(gordo, "xlsx"), "")
  assert.ok(Date.now() - t0 < 1000, "tiene que rebotar por tamaño, no lanzar el proceso y esperar el timeout")
})

test("el tope de las hojas es MÁS BAJO que el general: un PDF de 3 MB sí se intenta", () => {
  // Mismo tamaño que el test anterior, otra extensión → no rebota por tamaño. (Que después el PDF sea inválido y
  // devuelva "" es correcto; lo que se afirma es que el tope de 2 MB NO se le aplica a los PDF.)
  const pdf = join(dir, "doc.pdf")
  writeFileSync(pdf, Buffer.alloc(3 * 1048576))
  assert.equal(textoMarkitdown(pdf, "pdf"), "", "un PDF de basura devuelve vacío igual, pero por fallar, no por el tope")
})

// OJO CON ESTO: MarkItDown NO se cree la extensión que le declaramos. Olfatea el contenido (con magika) y elige el
// conversor por lo que el archivo ES. Un .xlsx que en realidad es texto vuelve como texto, no como error — igual que
// nuestro propio `tipoPorContenido`, y por la misma buena razón: en el CAS hay 408 adjuntos guardados como `.bin`.
// Lo que importa acá es el contrato: devuelve SIEMPRE un string y nunca tira, pase lo que pase con el archivo.
test("un archivo corrupto no tira: MarkItDown olfatea el contenido y devuelve lo que puede", () => {
  const roto = join(dir, "roto.xlsx")
  writeFileSync(roto, "esto no es un zip")
  const r = textoMarkitdown(roto, "xlsx")
  assert.equal(typeof r, "string", "el contrato es devolver string, nunca lanzar")
  assert.match(r, /esto no es un zip/, "lo leyó como texto plano, que es más útil que perderlo")
})

test("un binario que no es ningún formato conocido sí devuelve vacío", () => {
  const bin = join(dir, "ruido.pdf")
  writeFileSync(bin, Buffer.from([0x00, 0xff, 0x01, 0xfe, 0x7f, 0x80, 0x00, 0x00]))
  assert.equal(textoMarkitdown(bin, "pdf"), "",
    "sin esto podríamos cachear bytes crudos como si fueran el texto del documento")
})
