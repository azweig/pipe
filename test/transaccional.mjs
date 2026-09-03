// EL REMITENTE NO DECIDE SOLO — correo transaccional vs promoción.
//
// El antispam etiqueta DIRECCIONES. Funciona para promociones, pero la misma dirección que manda "40% OFF" manda
// "problema de facturación" o "se corta tu servicio". Con el remitente marcado, esos avisos se ocultaban junto con
// las promos — y la bandeja esconde el cajón de spam por completo (app.js: bucketCat === "spam" → no se muestra).
//
// Medido sobre la casilla real antes del arreglo: 223 de 267 hilos de correo estaban ocultos, y entre ellos había
// un "Problema de facturación" de Apple, un "service disruption" de Vercel y la notificación de una reunión.
//
// Runner: node --test test/transaccional.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { esTransaccional } from "../src/lib/transaccional.mjs"

// Asuntos REALES que estaban ocultos y no debían estarlo.
const RESCATAR = [
  "Problema de facturación",
  "Approaching your limits: Upgrade now to avoid service disruption",
  "Notificación: Weekly de Planeamiento mié 2 sept 2026 3pm - 3:30pm",
  "COMUNICADO CANCELACION DE MANTENIMIENTO",
  "Se rechazó tu compra por fondos insuficientes",
  "Constancia de Transferencia a cuentas propias o a terceros",
  "BOLETA DE VENTA ELECTRÓNICA B001-1234",
  "Vencimientos del Mes 09-2026",
  "Invitación: Pendientes vie 4 sept 2026 1:30pm",
  "Llegó tu compra, ¡que la disfrutes!",
  "Tu compra está en camino",
  "Password Reset Link",
]
// Asuntos REALES que sí son promoción y deben seguir ocultos.
const OCULTAR = [
  "Stack these with today's offers: free shipping + extra 10% off",
  "Carolina Herrera, Armani y más con hasta 60% DSCTO.",
  "Punta Cana con hasta 42% DTO.",
  "Elige tu megarecorrido",
  "Edition 61 | 2026 — The Economics of Reliability",
  "Reclama tu bonificación en criptomonedas.",
  "just a nudge to finalize your order...",
  "[RSVP] Slash MTTR and keep systems reliable",
  "weekly #33: ISO 27001, zero findings",
  "Your fall startup calendar starts NOW",
]

test("rescata lo transaccional aunque el remitente esté marcado", () => {
  for (const s of RESCATAR) assert.equal(esTransaccional(s), true, `debería mostrarse: ${s}`)
})

test("no rescata promociones", () => {
  for (const s of OCULTAR) assert.equal(esTransaccional(s), false, `debería seguir oculto: ${s}`)
})

test("una promo con urgencia fingida sigue siendo promo", () => {
  assert.equal(esTransaccional("¡Último día! Vence tu 40% de descuento"), false,
    "'vence' + '% descuento' es marketing, no un vencimiento real")
})

test("no se cae con entrada vacía o rara", () => {
  for (const s of ["", null, undefined, "   ", "😀"]) assert.equal(esTransaccional(s), false)
})

test("la bandeja lo consulta ANTES de mandar el hilo a spam", () => {
  const INBOX = readFileSync("src/lib/brain/inbox.mjs", "utf8")
  assert.match(INBOX, /esTransaccional/, "inbox tiene que usar el detector")
  const i = INBOX.indexOf("const rescatar")
  const iLlm = INBOX.indexOf("llmSpam(r.key)", i)
  assert.ok(i > 0 && iLlm > i, "el rescate se calcula ANTES de aplicar el veredicto del LLM")
  const rama = INBOX.slice(i, INBOX.indexOf('return "spam"', iLlm) + 14)
  assert.match(rama, /!rescatar/, "el veredicto del LLM tiene que ceder ante un mensaje transaccional")
})

test("lo que marcaste spam A MANO sigue mandando", () => {
  const INBOX = readFileSync("src/lib/brain/inbox.mjs", "utf8")
  const iManual = INBOX.indexOf("spamS.has(")
  const iRescate = INBOX.indexOf("const rescatar")
  assert.ok(iManual > 0 && iManual < iRescate, "la lista manual del usuario se evalúa primero y no la pisa el rescate")
})
