// El esquema se aplica UNA vez y después abrir la base es solo-lectura (un atajo por marca de versión: sin él, cada
// open tomaba write-lock y con >20 procesos escribiendo mataba jobs enteros con "database is locked").
// El precio de ese atajo: si cambiás initSchema y NO subís SCHEMA_V, las bases que ya existen se saltean la
// migración EN SILENCIO. Este test es el que no te deja olvidarte.
// Runner: node --test test/schema-version.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { SCHEMA_V } from "../src/lib/db-core.mjs"

// huella del CUERPO de initSchema (sin comentarios ni espacios) → cambia si cambia el esquema
const HUELLAS = { 1: "43f27fb7a7ed9315" }

test("si cambia initSchema, hay que subir SCHEMA_V (y anotar su huella acá)", () => {
  const s = readFileSync("src/lib/db-core.mjs", "utf8")
  const i = s.indexOf("export function initSchema(h) {"), j = s.indexOf("\n}\n", i)
  assert.ok(i > 0 && j > i, "no encontré initSchema")
  const cuerpo = s.slice(i, j).replace(/\/\/.*/g, "").replace(/\s+/g, " ").trim()
  const huella = createHash("sha256").update(cuerpo).digest("hex").slice(0, 16)
  assert.equal(huella, HUELLAS[SCHEMA_V],
    `initSchema cambió pero SCHEMA_V sigue en ${SCHEMA_V}. Subilo y poné la huella nueva (${huella}) en HUELLAS.`)
})

test("la marca de versión se estampa al final de initSchema", () => {
  const s = readFileSync("src/lib/db-core.mjs", "utf8")
  assert.match(s, /schema_v.*SCHEMA_V|SCHEMA_V.*schema_v/s, "sin la marca, el atajo nunca se activa")
  assert.match(s, /SELECT v FROM meta WHERE k='schema_v'/, "falta la lectura del atajo al abrir")
})
