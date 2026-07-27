// Test del parser de export de WhatsApp: formatos iOS/Android, multi-línea, media, sistema, detección out/in, fechas.
import test from "node:test"
import assert from "node:assert"
import { parseWhatsAppExport } from "../src/lib/wa-import.mjs"

test("iOS (corchetes, AM/PM) + multi-línea + media + owner", () => {
  const txt = [
    "[12/31/23, 10:30:45 PM] John Doe: Hey how are you?",
    "[12/31/23, 10:31:02 PM] Alvaro: Good!",
    "esta es la segunda línea",
    "[12/31/23, 10:32:00 PM] John Doe: ‎image omitted",
  ].join("\n")
  const m = parseWhatsAppExport(txt, { owner: "Alvaro", dateOrder: "MDY", tzOffsetMin: 0 })
  assert.equal(m.length, 3)
  assert.equal(m[0].sender, "John Doe"); assert.equal(m[0].dir, "in"); assert.equal(m[0].text, "Hey how are you?")
  assert.equal(m[1].dir, "out"); assert.equal(m[1].text, "Good!\nesta es la segunda línea") // continuación
  assert.equal(m[2].mediaType, "image")
  assert.equal(new Date(m[0].ts).getUTCFullYear(), 2023)
})

test("Android (guión, 24h) + línea de sistema ignorada", () => {
  const txt = [
    "31/12/2023, 22:00 - Los mensajes y las llamadas están cifrados de extremo a extremo.",
    "31/12/2023, 22:30 - María: hola!",
    "31/12/2023, 22:31 - Alvaro: qué tal",
    "31/12/2023, 22:32 - María: <Media omitted>",
  ].join("\n")
  const m = parseWhatsAppExport(txt, { owner: "Alvaro", dateOrder: "DMY" })
  assert.equal(m.length, 3, "la línea de cifrado E2E (sistema) no cuenta")
  assert.equal(m[0].sender, "María"); assert.equal(m[0].dir, "in")
  assert.equal(m[1].dir, "out")
  assert.equal(m[2].mediaType, "document"); assert.equal(m[2].text, "📎 Multimedia") // <Media omitted> genérico → tipo desconocido + marcador limpio
  assert.equal(new Date(m[0].ts).getUTCMonth(), 11) // diciembre (DMY: 31/12)
})

test("desambiguación de fecha auto (día>12 → DMY)", () => {
  const m = parseWhatsAppExport("31/01/2024, 09:15 - Ana: test", { dateOrder: "auto" })
  assert.equal(new Date(m[0].ts).getUTCDate(), 31)
  assert.equal(new Date(m[0].ts).getUTCMonth(), 0) // enero
})

test("owner por alias 'Tú' / 'You'", () => {
  const m = parseWhatsAppExport("31/12/2023, 22:30 - Tú: mensaje mío", {})
  assert.equal(m[0].dir, "out")
})

test("texto con ':' interno no rompe el sender", () => {
  const m = parseWhatsAppExport("31/12/2023, 22:30 - Pedro: mirá esto: https://x.com/a", {})
  assert.equal(m[0].sender, "Pedro")
  assert.equal(m[0].text, "mirá esto: https://x.com/a")
})

test("archivo vacío / no-export → 0 mensajes, sin crashear", () => {
  assert.equal(parseWhatsAppExport("cualquier cosa\nsin formato", {}).length, 0)
  assert.equal(parseWhatsAppExport("", {}).length, 0)
})
