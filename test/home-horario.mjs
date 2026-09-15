// EL HORARIO DEL RESUMEN DE LA HOME (2×/día, configurable).
// El valor de esto es que el usuario pueda confiar en el trato: "si entro a la mañana, ya está lo del día".
// Eso se rompe de tres formas distintas —la hora recién llegó, el daemon estuvo caído, cambiaron el horario—
// y las tres tienen que resolverse con el MISMO chequeo, o alguna se olvida.
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizarHoras, ultimaProgramada, proximaProgramada, tocaCorrer, partesLocales, horasEs, HORAS_DEFAULT }
  from "../src/lib/home-horario.mjs"

const TZ = "America/Lima" // UTC-5 todo el año
// un instante conocido: 2026-09-15 10:30:00 en Lima
const LIMA_10_30 = Date.parse("2026-09-15T15:30:00Z")

test("por defecto son las 4 de la mañana y las 4 de la tarde", () => {
  assert.deepEqual(HORAS_DEFAULT, [4, 16])
  assert.deepEqual(normalizarHoras(undefined), [4, 16])
  assert.deepEqual(normalizarHoras([]), [4, 16], "una lista vacía no puede dejar la Home sin horario")
})

test("el horario se puede escribir como a uno le salga", () => {
  assert.deepEqual(normalizarHoras("4,16"), [4, 16])
  assert.deepEqual(normalizarHoras("07:00, 19:00"), [7, 19], "los minutos no se configuran: la corrida es en la hora")
  assert.deepEqual(normalizarHoras([16, 4, 16]), [4, 16], "desordenado y repetido")
  assert.deepEqual(normalizarHoras(["9"]), [9], "una sola corrida es válida")
})

test("una hora imposible se descarta, no rompe ni se guarda", () => {
  assert.deepEqual(normalizarHoras("25, 99, -3"), [4, 16], "nada válido → default")
  assert.deepEqual(normalizarHoras("4, 25"), [4], "lo válido se queda, lo otro se va")
  assert.deepEqual(normalizarHoras("0"), [0], "medianoche ES una hora válida (y es falsy: ojo con el filtro)")
})

test("partesLocales lee la hora del hub, no la del servidor", () => {
  const p = partesLocales(LIMA_10_30, TZ)
  assert.deepEqual([p.y, p.m, p.d, p.h, p.mi], [2026, 9, 15, 10, 30])
  assert.equal(partesLocales(LIMA_10_30, "UTC").h, 15, "el mismo instante, otra zona")
})

test("a las 10:30 la última corrida fue la de las 4 de HOY", () => {
  const u = ultimaProgramada(LIMA_10_30, [4, 16], TZ)
  const p = partesLocales(u, TZ)
  assert.deepEqual([p.d, p.h, p.mi, p.s], [15, 4, 0, 0])
})

test("a las 2 de la mañana la última fue la de las 16 de AYER", () => {
  const dosAM = Date.parse("2026-09-15T07:00:00Z") // 02:00 en Lima
  const p = partesLocales(ultimaProgramada(dosAM, [4, 16], TZ), TZ)
  assert.deepEqual([p.d, p.h], [14, 16], "antes de la primera corrida del día hay que mirar hacia atrás, no adelante")
})

test("la próxima corrida es la que el usuario ve anunciada", () => {
  assert.equal(partesLocales(proximaProgramada(LIMA_10_30, [4, 16], TZ), TZ).h, 16)
  const cincoPM = Date.parse("2026-09-15T22:00:00Z") // 17:00 Lima, ya pasaron las dos de hoy
  const p = partesLocales(proximaProgramada(cincoPM, [4, 16], TZ), TZ)
  assert.deepEqual([p.d, p.h], [16, 4], "pasada la última del día, la próxima es mañana temprano")
})

// EL CHEQUEO QUE IMPORTA. Los tres casos son el mismo: "lo que tengo es más viejo que la última corrida que tocaba".
test("corre cuando acaba de llegar la hora, y no de nuevo un minuto después", () => {
  const cuatroUnMin = Date.parse("2026-09-15T09:01:00Z") // 04:01 Lima
  const generadoAnoche = Date.parse("2026-09-14T21:05:00Z") // ayer 16:05 Lima
  assert.equal(tocaCorrer(cuatroUnMin, generadoAnoche, [4, 16], TZ), true)
  const reciencorrido = Date.parse("2026-09-15T09:00:30Z")
  assert.equal(tocaCorrer(cuatroUnMin, reciencorrido, [4, 16], TZ), false,
    "el tick es cada minuto: sin esto, el resumen se regenera 60 veces dentro de la misma hora")
})

test("si el daemon estuvo caído, al volver se pone al día solo", () => {
  const tresDiasAtras = LIMA_10_30 - 3 * 86400000
  assert.equal(tocaCorrer(LIMA_10_30, tresDiasAtras, [4, 16], TZ), true)
})

test("cambiar el horario en Configuración corre la nueva hora sin reiniciar nada", () => {
  // Generado a las 04:00 de hoy. Con el horario viejo no toca nada hasta las 16.
  const alas4 = Date.parse("2026-09-15T09:00:00Z")
  assert.equal(tocaCorrer(LIMA_10_30, alas4, [4, 16], TZ), false)
  // El usuario agrega las 9: a las 10:30 esa corrida YA pasó y lo que hay es previo → toca.
  assert.equal(tocaCorrer(LIMA_10_30, alas4, [4, 9, 16], TZ), true)
})

test("sin nada generado todavía, corre", () => {
  assert.equal(tocaCorrer(LIMA_10_30, 0, [4, 16], TZ), true)
  assert.equal(tocaCorrer(LIMA_10_30, undefined, [4, 16], TZ), true)
})

test("el horario se le muestra al usuario en horas, no en milisegundos", () => {
  assert.equal(horasEs([4, 16]), "04:00 y 16:00")
})
