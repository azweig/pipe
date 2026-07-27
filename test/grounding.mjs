// Tests de la lógica NUEVA de esta sesión: source grounding (anti-alucinación), el guard de homónimo/manual de identidad,
// y los handlers de LECTURA del conector MCP (con DB en memoria). Todo determinístico, sin red.
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { grounded, anchored, stripP, wordsOf, gstrip } from "../src/lib/grounding.mjs"
import { safeName } from "../src/lib/identity-repo.mjs"
import { TOOLS } from "../src/mcp/tools.mjs"

const NOW = Date.now()

// ── SOURCE GROUNDING (todos/promesas) ──
test("grounding: grounded() acepta la cita real, descarta la alucinación", () => {
  const t = "Juan: me mandás el presupuesto de la obra mañana? Yo: sí, mañana te lo paso"
  const hayNorm = stripP(t), hayWords = wordsOf(t)
  assert.equal(grounded("me mandás el presupuesto de la obra", hayNorm, hayWords), true, "cita textual")
  assert.equal(grounded("¿me mandás el presupuesto?", hayNorm, hayWords), true, "puntuación distinta")
  assert.equal(grounded("comprar pasajes a Madrid", hayNorm, hayWords), false, "no está → alucinación")
  assert.equal(grounded("", hayNorm, hayWords), false, "vacía")
  assert.equal(grounded("mandar cotizacion edificio", hayNorm, hayWords), false, "parafraseo >30% distinto")
})

// ── GROUNDING de entidades (graphify) ──
test("grounding: anchored() acepta la entidad mencionada, descarta la fabricada", () => {
  const hay = gstrip("Juan Pérez email:juan@acme.com hola te paso el informe. Beto whatsapp:5199 dale")
  assert.equal(anchored("Juan Pérez", hay), true, "por nombre")
  assert.equal(anchored("Acme", hay), true, "por dominio de email")
  assert.equal(anchored("Beto", hay), true, "por apodo")
  assert.equal(anchored("Roberto Sánchez", hay), false, "fabricada")
  assert.equal(anchored("Globex", hay), false, "empresa inventada")
})

// ── IDENTIDAD: guard de homónimo + prioridad del mapa manual (bugs Milagros/Helmut) ──
test("identity: safeName respeta homónimo y prioriza el mapa manual", () => {
  assert.equal(safeName({ "111": "Diego", "222": "Diego" }, "111"), null, "homónimo (2 números mismo nombre) → null, no fusiona")
  assert.equal(safeName({ "111": "Ana García", "222": "Otro" }, "111"), "Ana García", "nombre único → el nombre")
  assert.equal(safeName({ "999": "X" }, "111"), null, "número desconocido → null")
  assert.equal(safeName({ "111": "Diego", "222": "Diego" }, "111", { "111": "Diego Real" }), "Diego Real", "mapa manual = verdad del usuario → gana aunque sea homónimo en la agenda")
})

// ── HANDLERS DE LECTURA del MCP (con DB en memoria) ──
test("mcp: search_inbox / get_thread devuelven filas de la DB", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "in", name: "Ana", channel: "whatsapp", text: "te paso la factura del alquiler", ts: NOW },
    { thread: "ana", dir: "out", channel: "whatsapp", text: "dale gracias", ts: NOW + 1 },
    { thread: "beto", dir: "in", name: "Beto", channel: "email", text: "reunión el viernes", ts: NOW + 2 },
  ])
  const search = TOOLS.find((t) => t.name === "search_inbox").handler
  const r = search({ query: "factura", limit: 10 })
  assert.ok(r.count >= 1 && r.results.some((m) => /factura/.test(m.text)), "search encuentra 'factura'")
  const gt = TOOLS.find((t) => t.name === "get_thread").handler({ thread: "ana", limit: 10 })
  assert.equal(gt.count, 2, "get_thread('ana') → 2 mensajes")
  assert.equal(gt.messages[1].from, "yo", "el saliente se marca 'yo'")
})

test("mcp: list_todos y create_todo operan sobre la DB local", () => {
  resetDb(":memory:")
  const create = TOOLS.find((t) => t.name === "create_todo").handler
  create({ text: "llamar al contador el lunes" })
  const list = TOOLS.find((t) => t.name === "list_todos").handler({ limit: 10 })
  assert.ok(list.todos.some((t) => /contador/.test(t.tarea)), "el todo creado aparece en la lista")
})
