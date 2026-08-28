// RESPONDER UNA HISTORIA NO QUEDABA EN NINGÚN LADO. Escribías sobre el estado de alguien y el mensaje desaparecía:
// no estaba en el hilo de historias ni en el chat de esa persona.
//
// Y había algo peor esperando: el hilo de historias apunta a la sala de ESTADOS del bridge, así que mandar ahí no
// era "contestarle a alguien" — era PUBLICAR UN ESTADO tuyo a todos tus contactos.
//
// Ahora: responder un estado va al chat PRIVADO de quien lo publicó (que es lo que hace WhatsApp), se guarda ahí
// para siempre, y lleva tag "historia" para distinguirlo de una charla normal — lo dijiste sobre algo que publicó,
// no en medio de una conversación.
// Runner: node --test test/historia-respuesta.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const REPLY = readFileSync("src/lib/brain/reply.mjs", "utf8")
const REPO = readFileSync("src/lib/threads-repo.mjs", "utf8")
const CORE = readFileSync("src/lib/db-core.mjs", "utf8")
const SRV = readFileSync("src/server.mjs", "utf8")

test("sin decir de quién es la historia, se NIEGA (o publicaría un estado tuyo)", () => {
  const i = REPLY.indexOf('if (/status@broadcast/.test(String(key)))')
  assert.ok(i > 0, "falta el caso de historias en sendReply")
  const bloque = REPLY.slice(i, i + 1200)
  assert.match(bloque, /if \(!quien\) return \{ error:/)
  const iGuard = bloque.indexOf("if (!quien)")
  const iSend = bloque.indexOf("await sendReply(destino.key")
  assert.ok(iGuard < iSend, "la negativa va ANTES de cualquier envío")
})

test("la respuesta va al chat privado de quien publicó, no al hilo de historias", () => {
  const i = REPLY.indexOf('if (/status@broadcast/.test(String(key)))')
  const bloque = REPLY.slice(i, i + 1200)
  assert.match(bloque, /const destino = await resolverHiloDe\(quien\)/)
  assert.match(bloque, /await sendReply\(destino\.key, text/)
})

test("se resuelve por hilo propio, por número, y también por LID (grupos grandes)", () => {
  const i = REPLY.indexOf("async function resolverHiloDe")
  const fn = REPLY.slice(i, REPLY.indexOf("export async function sendReply"))
  assert.match(fn, /threadPorClave\(cand\)/)
  assert.match(fn, /whatsapp_\(\\d\{8,15\}\)/)
  assert.match(fn, /lidToPhone\(lid\)/)
})

test("queda etiquetada como historia, y la etiqueta es una COLUMNA (no texto pegado al mensaje)", () => {
  assert.match(REPLY, /marcarComoHistoria\(r\.id\)/)
  assert.match(REPO, /UPDATE messages SET tag='historia' WHERE id=\?/)
  assert.match(CORE, /ALTER TABLE messages ADD COLUMN tag TEXT/)
})

test("etiquetar no puede hacer fallar un envío que YA salió", () => {
  assert.match(REPLY, /try \{ marcarComoHistoria\(r\.id\) \} catch/)
})

test("el endpoint pasa de quién es la historia", () => {
  assert.match(SRV, /historiaDe: b\.historiaDe \|\| ""/)
})
