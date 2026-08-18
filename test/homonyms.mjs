// HOMÓNIMOS — el "en común" de una persona NO puede contaminarse con el de otro contacto que comparte
// el nombre de pila. Caso real que motivó el test: "Marcos Salinas" (WhatsApp) heredaba los grupos de
// "Marcos Beltrán" (RPA) porque el match era por PREFIJO DE NOMBRE DE PILA ("marcos ").
// La prioridad tiene que ser la identidad del contacto (su número/LID), no el nombre suelto.
// Runner: node --test test/homonyms.mjs
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { sharedFor } from "../src/lib/brain/people.mjs"

// índice de membresía mínimo, calcado del real: [nombre, clave(número), n]
const IDX = {
  groups: [
    { thread: "whatsapp:g1@g.us", grp: "Globex - Ops", members: [["Marcos Beltrán", "15550002002", 116], ["Julia Ortega", "15550002003", 40]] },
    { thread: "whatsapp:g2@g.us", grp: "Cumple Salinas", members: [["Marcos Salinas", "15550002001", 30], ["Lucía", "15550002004", 12]] },
    { thread: "whatsapp:g3@g.us", grp: "Proyecto X", members: [["Marcos Salinas Peralta", "15550002001", 22], ["Renata", "15550002005", 9]] },
  ],
}

test("NO atribuye los grupos de un homónimo (mismo nombre de pila, distinto apellido)", () => {
  const r = sharedFor("Marcos Salinas", new Set(), IDX)
  const grupos = r.groups.map((g) => g.name)
  assert.ok(!grupos.includes("Globex - Ops"), `el grupo de Marcos Beltrán se filtró: ${JSON.stringify(grupos)}`)
  const gente = r.people.map((p) => p.name)
  assert.ok(!gente.includes("Julia Ortega"), `co-miembro del homónimo se filtró: ${JSON.stringify(gente)}`)
})

test("SÍ reconoce a la persona por su número aunque en el grupo figure con otro nombre", () => {
  const idx = { groups: [{ thread: "t", grp: "Sólo número", members: [["Marquitos", "15550002001", 5], ["Otro", "999", 2]] }] }
  const r = sharedFor("Marcos Salinas", new Set(["15550002001"]), idx)
  assert.deepEqual(r.groups.map((g) => g.name), ["Sólo número"])
})

test("SÍ reconoce el nombre EXTENDIDO (mismo nombre + apellido de más)", () => {
  const r = sharedFor("Marcos Salinas", new Set(), IDX)
  const grupos = r.groups.map((g) => g.name)
  assert.ok(grupos.includes("Proyecto X"), `'Marcos Salinas Peralta' es la misma persona: ${JSON.stringify(grupos)}`)
  assert.ok(grupos.includes("Cumple Salinas"), "el match exacto de nombre debe seguir andando")
})

test("no se cuenta a sí misma como persona en común", () => {
  const r = sharedFor("Marcos Salinas", new Set(), IDX)
  assert.ok(!r.people.some((p) => /altamira/i.test(p.name)), "la propia persona no va en 'en común'")
})
