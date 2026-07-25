// M2 (coach) — characterization de la lógica PURA de matcheo evento↔objetivo, vía el kernel y el hook _testMatchObjetivo.
// Pinnea el comportamiento ACTUAL (stemming es/s, stopwords, norm de acentos) — es donde un cambio sutil rompería el tag de la agenda.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { matchObjetivo } from "../src/lib/brain/kernel/objetivos.mjs"
import { _testMatchObjetivo } from "../src/lib/brain.mjs" // por la fachada (debe seguir resolviendo)

const OBJ = { title: "cerrar 5 clientes", scope: "TestCo", unit: "clientes", target: 5, current: 2 }

test("matchObjetivo: matchea por stem (clientes→client) y calcula pct = current/target", () => {
  const r = matchObjetivo({ title: "Reunión con Globex sobre clientes nuevos", attendees: [] }, [OBJ])
  assert.ok(r, "debería matchear")
  assert.equal(r.title, "cerrar 5 clientes")
  assert.equal(r.pct, 40) // 100 * 2/5
  assert.equal(r.scope, "TestCo")
})

test("matchObjetivo: matchea sobre attendees y location, no solo title", () => {
  assert.ok(matchObjetivo({ title: "Call", attendees: [{ name: "cliente Beto" }] }, [OBJ]))
  assert.ok(matchObjetivo({ title: "Call", location: "oficina del cliente" }, [OBJ]))
})

test("matchObjetivo: NO matchea si el evento no menciona ningún stem significativo", () => {
  assert.equal(matchObjetivo({ title: "Almuerzo con la familia", attendees: [] }, [OBJ]), null)
})

test("matchObjetivo: objetivo SOLO-stopwords no matchea nada (evita que todo enganche)", () => {
  // "mantener/tiempo" están en _OBJ_STOP, "el" es <3 → sin stems → nunca matchea
  assert.equal(matchObjetivo({ title: "cualquier evento de clientes" }, [{ title: "mantener el tiempo" }]), null)
})

test("matchObjetivo: acentos — norma NFD, matchea 'operación' vs 'operacion'", () => {
  // 'operación' NO es stopword aquí (lo son operacion/operación en _OBJ_STOP)… test del norm: 'límite' vs 'limite'
  assert.ok(matchObjetivo({ title: "revisar el límite de gasto" }, [{ title: "bajar limite mensual", target: 1 }]))
})

test("_testMatchObjetivo (hook por la fachada) delega en matchObjetivo", () => {
  const r = _testMatchObjetivo("Reunión sobre clientes", [OBJ])
  assert.ok(r); assert.equal(r.title, "cerrar 5 clientes")
  assert.equal(_testMatchObjetivo("Almuerzo familiar", [OBJ]), null)
})
