// COLA DE ENVÍO EN LA WEB — antes, si el envío fallaba, la burbuja se borraba, el texto volvía al compositor y
// salía un alert. Con 502 intermitentes eso es perder el mensaje a mano. Ahora entra a una cola que reintenta.
// Tests estáticos sobre el fuente (mismo enfoque que xss-escaping/scroll-anchor: fallan en CI, sin navegador).
// Runner: node --test test/outbox-web.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const APP = readFileSync("public/app.js", "utf8")
const trozo = (desde, largo = 2500) => { const i = APP.indexOf(desde); assert.ok(i > 0, `no encontré ${desde}`); return APP.slice(i, i + largo) }

test("cada envío lleva un msgId que viaja al server (sin eso no hay idempotencia)", () => {
  const send = trozo("window.doSend = async (text)")
  assert.match(send, /const msgId = nuevoMsgId\(\)/)
  assert.match(send, /_outbox\.push\(\{ msgId/)
  assert.match(trozo("async function flushOutbox"), /msgId: it\.msgId/)
})

test("doSend ya no borra la burbuja ni tira alert: encola", () => {
  const send = trozo("window.doSend = async (text)")
  assert.ok(!/alert\(/.test(send), "el alert vuelve a hacer que el usuario pierda el mensaje")
  assert.ok(!/filter\(\(x\) => x\.id !== optId\)/.test(send), "ya no se borra la burbuja optimista")
  assert.match(send, /pendiente: true/)
})

test("distingue reintentable de rechazo definitivo — si no, un 400 se reintentaría para siempre", () => {
  const f = trozo("async function flushOutbox")
  assert.match(f, /if \(!r\) \{ reintentar/, "red caída → reintentar")
  assert.match(f, /r\.status >= 500[\s\S]{0,40}reintentar/, "502/503 → reintentar")
  assert.match(f, /r\.status === 202[\s\S]{0,60}reintentar/, "el server dice 'saliendo' → esperar, NO mandar de nuevo")
  assert.match(f, /r\.status >= 400[\s\S]{0,200}_outbox = _outbox\.filter/, "400 → sacarlo de la cola")
})

test("la espera entre reintentos crece y tiene techo (no martillar un hub caído)", () => {
  assert.match(APP, /esperaReintento = \(intentos\) => Math\.min\(60000, 2000 \* Math\.pow\(2/)
})

test("la cola sobrevive a recargar y reintenta al volver la red o la app", () => {
  assert.match(APP, /localStorage\.setItem\(OUTBOX_KEY/)
  assert.match(APP, /JSON\.parse\(localStorage\.getItem\(OUTBOX_KEY\)/)
  assert.match(APP, /addEventListener\("online", \(\) => flushOutbox\(\)\)/)
  assert.match(APP, /visibilitychange[\s\S]{0,80}flushOutbox\(\)/)
})

test("un mensaje en cola NO muestra ✓✓ (decir 'enviado' sin haber enviado es lo peor en mensajería)", () => {
  assert.match(APP, /const estadoEl = \(it\) => \(it\.pendiente \? " 🕐" : it\.fallo \? " ⚠️" : " ✓✓"\)/)
})

test("lo pendiente se re-inyecta al pintar el hilo (si no, desaparece al refrescar)", () => {
  const r = trozo("function renderConv()", 1200)
  assert.match(r, /for \(const it of _outbox\)/)
  assert.match(r, /it\.key !== d\.key/, "solo lo de ESTE hilo")
  assert.match(r, /some\(\(x\) => x\.id === it\.msgId\)/, "sin duplicar la que ya está")
})
