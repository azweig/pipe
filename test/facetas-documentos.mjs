// El robotito del buscador enruta con facetas pre-computadas (0 tokens). Esas facetas salen de lo que el
// enriquecedor le CUENTA al LLM sobre cada conversación. Hasta acá, de un contrato adjunto le contaba el nombre del
// archivo y nada más → las facetas del hilo quedaban vacías de contenido y el router no podía llevarte a la
// conversación donde estaba el monto.
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, handle as db } from "../src/lib/db-core.mjs"
import { convText, textoAdjunto } from "../src/lib/conv-text.mjs"

const CONTRATO = "Adenda al contrato marco con Globex SAC. Monto acordado S/ 45800, vencimiento 30 de noviembre de 2026. Responsable: Mariana Quispe."

const mensajeConDoc = (extra = {}) => ({
  channel: "whatsapp", dir: "in", name: "Globex", text: "te paso lo que hablamos",
  media: "/cas/ab/abcdef123456.pdf", mediaType: "document", filename: "adjunto-final.pdf", ...extra,
})

function conTextoExtraido(texto = CONTRATO) {
  resetDb(":memory:")
  db().prepare("INSERT INTO doc_text (media, texto, chars, ts, err) VALUES (?,?,?,?,NULL)")
    .run("/cas/ab/abcdef123456.pdf", texto, texto.length, Date.now())
}

test("lo que dice DENTRO del documento llega al enriquecedor", () => {
  conTextoExtraido()
  const t = convText([mensajeConDoc()])
  assert.match(t, /Mariana Quispe/, "sin esto, las facetas del hilo no saben quién es el responsable")
  assert.match(t, /45800/, "el monto es lo que después permite rutear la pregunta a este hilo")
  assert.match(t, /adjunto-final\.pdf/, "el nombre del archivo se conserva, no se reemplaza")
})

test("el contenido del PDF NO se recorta con el presupuesto de un mensaje de chat", () => {
  const largo = "Preambulo. ".repeat(30) + "EL MONTO ES 45800 SOLES."
  conTextoExtraido(largo)
  const t = convText([mensajeConDoc()])
  assert.match(t, /45800/, "con el tope de 160 de mensajería el monto quedaba afuera: por eso el documento tiene su propio presupuesto")
})

test("si el documento tiene resumen, se usa el resumen (ya viene destilado)", () => {
  conTextoExtraido()
  const t = convText([mensajeConDoc({ summary: "Adenda de Globex por S/ 45800 que vence el 30/11." })])
  assert.match(t, /Adenda de Globex/)
  assert.ok(!/Responsable: Mariana/.test(t), "con resumen no hace falta volcar el texto completo")
})

test("cache-only: un documento SIN extraer no dispara extracción, sólo cae al nombre", () => {
  resetDb(":memory:") // doc_text vacío
  const t = convText([mensajeConDoc()])
  assert.match(t, /adjunto-final\.pdf/)
  assert.ok(!/Mariana/.test(t), "no debe extraer acá: este cron recorre miles de mensajes por corrida")
})

test("un audio o una imagen no se tocan: esto es sólo para documentos", () => {
  conTextoExtraido()
  assert.equal(textoAdjunto(mensajeConDoc({ mediaType: "audio" })), "")
  assert.equal(textoAdjunto(mensajeConDoc({ mediaType: "image" })), "")
  assert.equal(textoAdjunto({ text: "hola" }), "")
})

test("el correo sigue aportando su cuerpo, sin romperse", () => {
  resetDb(":memory:")
  const t = convText([{ channel: "email", dir: "in", name: "Banco", text: "Estado de cuenta", body: "<p>Saldo <b>S/ 1200</b></p>" }])
  assert.match(t, /Estado de cuenta/)
  assert.match(t, /1200/, "el detalle del correo vive en el body, no en el asunto")
})
