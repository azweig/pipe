// ENVIAR UN CONTACTO — llega como ARCHIVO, no como tarjeta nativa de WhatsApp, y no es un bug de Pipe:
// mautrix-whatsapp solo convierte ContactMessage de WhatsApp HACIA Matrix (pkg/msgconv/wa-contact.go). En la
// dirección de salida (from-matrix.go) todo m.file —incluido text/vcard— termina en DocumentMessage. Verificado
// en v26.06: no existe ninguna construcción de ContactMessage saliente.
//
// Lo que sí se puede es mandarlo con LEYENDA. El bridge solo la toma si el evento trae `filename` Y un `body`
// DISTINTO (MSC2530); si los dos son iguales, la ignora en silencio y se pierde el nombre y el teléfono.
// Runner: node --test test/send-contact.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildVCard } from "../src/lib/brain/reply.mjs"

const MATRIX = readFileSync("src/matrix.mjs", "utf8")
const REPLY = readFileSync("src/lib/brain/reply.mjs", "utf8")

test("con leyenda, el evento manda `filename` aparte y un `body` distinto", () => {
  const i = MATRIX.indexOf("export async function sendMatrixMedia")
  const fn = MATRIX.slice(i, i + 1400)
  assert.match(fn, /cap !== filename/, "si body === filename el bridge descarta la leyenda")
  assert.match(fn, /\{ msgtype, body: cap, filename, url: mxc, info \}/)
  assert.match(fn, /\{ msgtype, body: filename, url: mxc, info \}/, "sin leyenda tiene que seguir como antes")
})

test("el contacto se manda con nombre y teléfono en la leyenda", () => {
  const i = REPLY.indexOf("export async function sendReplyContact")
  const fn = REPLY.slice(i, i + 900)
  assert.match(fn, /caption = `👤 \$\{quien\.name\}/)
  assert.match(fn, /mime: "text\/vcard"/)
  assert.match(fn, /placeholder: `👤 \$\{quien\.name\}`/, "en tu propio hilo no debe verse '📄 archivo.vcf'")
})

test("el vCard sigue siendo válido y escapa los separadores del RFC 6350", () => {
  const v = buildVCard({ name: "Pérez, Ana; la jefa", phones: ["51999888777"], emails: ["ana@ejemplo.pe"], org: "Acme" })
  assert.match(v, /^BEGIN:VCARD\r\n/)
  assert.match(v, /\r\nEND:VCARD\r\n$/)
  assert.match(v, /FN:Pérez\\, Ana\\; la jefa/, "la coma y el punto y coma parten la tarjeta si no se escapan")
  assert.match(v, /TEL;type=CELL;waid=51999888777:\+51999888777/)
  assert.match(v, /EMAIL;type=INTERNET:ana@ejemplo\.pe/)
})

test("sin teléfono ni correo no se manda nada (no tiene sentido una tarjeta vacía)", async () => {
  const { sendReplyContact } = await import("../src/lib/brain/reply.mjs")
  const r = await sendReplyContact("k", { name: "Fulano", phones: [], emails: [] })
  assert.equal(r.error, "no tengo teléfono ni correo de Fulano")
})
