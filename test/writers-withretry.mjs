// TODA ESCRITURA A LA BASE PASA POR withRetry.
//
// SQLite da SQLITE_BUSY cuando un writer pesado tiene el lock, y una transacción sin reintento no falla ruidosamente:
// se pierde el dato y el que llamó recibe un error genérico. Caso medido: el lector de redes sacaba capturas, las
// pasaba por un modelo de visión y el hub le contestaba 400 "database is locked" — trabajo caro tirado a la basura,
// tres canales sin entrar nada durante 16 días, y ninguna alarma.
//
// El repositorio de ingest es el writer más caliente del sistema, así que acá es donde más barato sale afirmarlo.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../src/lib/ingest-repo.mjs", import.meta.url), "utf8")

test("ninguna transacción de ingest se ejecuta sin withRetry", () => {
  const sueltas = []
  const lineas = src.split("\n")
  lineas.forEach((l, i) => {
    const codigo = l.replace(/\/\/.*$/, "")
    // Ejecutar una transacción es `tx()` o `db().transaction(...)()`. Lo que importa es que en la MISMA expresión
    // aparezca withRetry: envolverla después, en otra línea, no la protege.
    if (!/(^|[^.\w])tx\(\)/.test(codigo) && !/\.transaction\([\s\S]*\)\(\)/.test(codigo)) return
    if (/withRetry/.test(codigo)) return
    // una transacción definida (`const tx = db().transaction(`) no es una ejecución
    if (/=\s*db\(\)\.transaction\(/.test(codigo)) return
    sueltas.push(`${i + 1}: ${l.trim().slice(0, 80)}`)
  })
  assert.deepEqual(sueltas, [], "estas transacciones corren sin reintento: un SQLITE_BUSY les pierde el dato en silencio")
})
