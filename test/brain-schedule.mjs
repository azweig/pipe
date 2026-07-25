// M2 (schedule) — characterization de la lógica SIN side-effect. PINEA la quirk de tz (naive = Lima), NO la arregla:
// el fix de tz es tarea aparte. Runner: node --test test/brain-schedule.mjs
import "./_setup.mjs" // tz = America/Lima
import { test } from "node:test"
import assert from "node:assert/strict"
import { tzOffset, tz } from "../src/lib/hub.mjs"
import { parseCalTs, mtgWhen, durMin, mtgId, catOf, freeSlots, conflictsAt } from "../src/lib/brain.mjs"

test("parseCalTs: QUIRK tz — un timestamp NAIVE se interpreta como hora LIMA (no UTC, no la del server)", () => {
  const OFF = tzOffset() // "-05:00" para America/Lima (test)
  // naive (Outlook manda "2026-07-08T15:00:00.0000000") → se le pega el offset de Lima
  assert.equal(parseCalTs("2026-07-08T15:00:00"), Date.parse("2026-07-08T15:00:00" + OFF))
  assert.equal(parseCalTs("2026-07-08T15:00:00.0000000"), Date.parse("2026-07-08T15:00:00" + OFF)) // saca los .fff
  // con Z (UTC explícito) → se respeta tal cual, NO se le pega Lima
  assert.equal(parseCalTs("2026-07-08T15:00:00Z"), Date.parse("2026-07-08T15:00:00Z"))
  // con offset explícito → tal cual
  assert.equal(parseCalTs("2026-07-08T15:00:00-03:00"), Date.parse("2026-07-08T15:00:00-03:00"))
  assert.ok(Number.isNaN(parseCalTs("")))
})

test("mtgWhen: display de horas en Lima (naive 15:00 → t1 '15:00'), pinneando la quirk", () => {
  const w = mtgWhen({ start: "2026-07-08T15:00:00", end: "2026-07-08T16:30:00" })
  assert.equal(w.t1, "15:00")
  assert.equal(w.t2, "16:30")
  assert.equal(typeof w.dayLabel, "string")
  assert.equal(w.startMs, parseCalTs("2026-07-08T15:00:00"))
})

test("durMin: duración en minutos entre start/end (fallback 30)", () => {
  assert.equal(durMin({ start: "2026-07-08T15:00:00", end: "2026-07-08T16:00:00" }), 60)
  assert.equal(durMin({ start: "2026-07-08T15:00:00" }), 30) // sin end → 30
})

test("mtgId: clave estable title|start(0..16)", () => {
  assert.equal(mtgId({ title: "Demo Globex", start: "2026-07-15T15:00:00Z" }), "demo globex|2026-07-15T15:00")
})

test("catOf: categoriza por regex (viaje/salud/cita/…); default trabajo", () => {
  assert.equal(catOf({ title: "Vuelo a Lima LATAM 2401" }).cat, "viaje")
  assert.equal(catOf({ title: "Café con Beto" }).cat, "cita")
  assert.equal(catOf({ title: "Turno con el dentista" }).cat, "salud")
  assert.equal(catOf({ title: "Sprint planning" }).cat, "trabajo") // fallback
})

test("freeSlots: día futuro sin eventos → 4 huecos en horario laboral (empieza 9:00)", () => {
  // año lejano → _calEvents no matchea nada y minStart (ahora+2h) queda muy por debajo → 4 slots
  const slots = freeSlots({ year: 2099, month: 1, day: 15 }, 30)
  assert.equal(slots.length, 4)
  assert.deepEqual(slots[0], { hour: 9, minute: 0, label: "9:00" })
  assert.ok(slots.every((s) => s.hour >= 9 && s.hour < 19)) // horario laboral default
})

test("conflictsAt: horario en año lejano (sin eventos) → sin conflictos", () => {
  assert.deepEqual(conflictsAt({ year: 2099, month: 1, day: 15, hour: 10, minute: 0 }, 30), [])
})
