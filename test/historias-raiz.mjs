// HISTORIAS CONVERTIDAS EN CONVERSACIONES FALSAS — arreglo de RAÍZ, no por contacto.
//
// Saber si una sala es la de estados se preguntaba a la base del bridge en cada arranque. Esa base se traba, y cada
// fallo mandaba una historia al hilo equivocado: quedaba un hilo con el nombre de quien publicó, que en la bandeja
// parecía una conversación y adentro tenía una historia en vez de los mensajes de esa persona.
//
// Dos piezas, las dos genéricas:
//  1. la respuesta se PERSISTE apenas se averigua una vez → ninguna traba posterior puede desviar una historia;
//  2. lo ya archivado mal se corrige SOLO en cada arranque, por la firma del dato (jid de sala de estados + hilo
//     que no es el de historias). Sin listas de contactos ni casos particulares.
// Runner: node --test test/historias-raiz.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const MX = readFileSync("src/matrix.mjs", "utf8")
const MANT = readFileSync("src/lib/maintenance.mjs", "utf8")
const SRV = readFileSync("src/server.mjs", "utf8")

test("saber que una sala es de estados sobrevive a que la base del bridge falle", () => {
  assert.match(MX, /if \(statusPersistido\(\)\.has\(roomId\)\) return true/)
  assert.match(MX, /if \(v\) \{ recordarStatus\(roomId\); return true \}/)
})

test("un fallo de consulta NUNCA se guarda como \"no es estados\"", () => {
  const i = MX.indexOf("async function portalIsStatus")
  const fn = MX.slice(i, i + 1200)
  assert.match(fn, /if \(pudeMirar\) _isStatus\.set\(roomId, false\)/, "el negativo solo se cachea si se pudo mirar")
  assert.ok(!/catch \{[^}]*_isStatus\.set/.test(fn), "el catch no puede cachear nada")
})

test("la reparación se guía por la FIRMA del dato, no por nombres de contacto", () => {
  const i = MANT.indexOf("export function repararHistorias")
  const fn = MANT.slice(i, MANT.indexOf("export function fixGroupLeaks"))
  assert.match(fn, /thread='whatsapp:status@broadcast' AND jid LIKE '!%'/)
  assert.match(fn, /jid=\? AND thread<>'whatsapp:status@broadcast'/)
  assert.ok(!/Cynthia|Fernanda|Alexis|Nancy/i.test(fn), "nada de contactos concretos en el código")
})

test("recorre TODAS las salas de estados (hay una por número vinculado)", () => {
  const i = MANT.indexOf("export function repararHistorias")
  const fn = MANT.slice(i, MANT.indexOf("export function fixGroupLeaks"))
  assert.match(fn, /for \(const jid of salas\)/, "mirar solo la primera no encuentra nada")
})

test("corre sola en cada arranque", () => {
  assert.match(SRV, /maintenance\.repararHistorias\(\)/)
})
