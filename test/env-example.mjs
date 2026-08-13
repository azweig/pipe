// El .env.example NO es documentación: es el archivo que el README manda a copiar y que install.sh copia solo.
// Cualquier cosa que lo haga parsear mal rompe TODA instalación nueva, y en silencio.
//
// Historia: los comentarios estaban en la misma línea que el valor y el parser se quedaba con ellos →
//   HOST="127.0.0.1   # 0.0.0.0 dentro de un container…"  → server.listen() nunca abría el puerto
//   SECRETS_KEY="# clave AES-256…"                        → truthy → toda instalación cifraba con una clave del repo público
// Runner: node --test test/env-example.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "../src/lib/env.mjs"

// carga .env.example en un objeto, con el MISMO parser que usa el server
function parseExample() {
  const dir = mkdtempSync(join(tmpdir(), "pipe-env-"))
  const f = join(dir, ".env")
  writeFileSync(f, readFileSync(".env.example", "utf8"))
  const before = new Set(Object.keys(process.env))
  loadEnv(f)
  const got = {}
  for (const k of Object.keys(process.env)) if (!before.has(k)) { got[k] = process.env[k]; delete process.env[k] }
  rmSync(dir, { recursive: true, force: true })
  return got
}

test("ningún valor de .env.example se queda con un comentario pegado", () => {
  for (const [k, v] of Object.entries(parseExample())) {
    assert.ok(!v.includes("#"), `${k} quedó con el comentario dentro: ${JSON.stringify(v.slice(0, 60))} — poné el comentario en su propia línea`)
  }
})

test("HOST de .env.example es una dirección que se puede escuchar", () => {
  const { HOST } = parseExample()
  if (HOST === undefined) return // válido: sin HOST el server usa 127.0.0.1
  assert.match(HOST, /^(127\.0\.0\.1|0\.0\.0\.0|localhost|::1?)$/, `HOST inválido (${JSON.stringify(HOST)}): server.listen() no abriría el puerto`)
})

test("SECRETS_KEY de .env.example queda VACÍA (si no, se cifra con una clave pública)", () => {
  const { SECRETS_KEY } = parseExample()
  assert.ok(!SECRETS_KEY, `SECRETS_KEY trae valor (${JSON.stringify(String(SECRETS_KEY).slice(0, 40))}) — toda instalación por defecto usaría la MISMA clave, publicada en el repo`)
})

test("install.sh detecta que SECRETS_KEY está vacía y genera una", () => {
  // el guard vive en install.sh; acá pineamos la forma del archivo de la que depende: la línea existe y no tiene valor
  const ex = readFileSync(".env.example", "utf8")
  const line = ex.split("\n").find((l) => l.startsWith("SECRETS_KEY="))
  assert.ok(line, "falta la línea SECRETS_KEY= en .env.example")
  assert.equal(line.trim(), "SECRETS_KEY=", "SECRETS_KEY= debe quedar sin valor NI comentario en la misma línea")
})

test("el parser respeta comillas y no corta un # que forma parte del valor", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-env-"))
  const f = join(dir, ".env")
  writeFileSync(f, ['T_PLAIN=abc # comentario', 'T_HASH=pa#ss', 'T_QUOTED="a # b"', 'T_ONLY=   # solo comentario', "T_SINGLE='x # y'"].join("\n"))
  for (const k of ["T_PLAIN", "T_HASH", "T_QUOTED", "T_ONLY", "T_SINGLE"]) delete process.env[k]
  loadEnv(f)
  assert.equal(process.env.T_PLAIN, "abc")      // comentario al final → se corta
  assert.equal(process.env.T_HASH, "pa#ss")     // sin espacio antes → es parte del valor (contraseñas)
  assert.equal(process.env.T_QUOTED, "a # b")   // entre comillas → literal
  assert.equal(process.env.T_SINGLE, "x # y")
  assert.equal(process.env.T_ONLY, "")          // solo comentario → vacío, NO el texto del comentario
  for (const k of ["T_PLAIN", "T_HASH", "T_QUOTED", "T_ONLY", "T_SINGLE"]) delete process.env[k]
  rmSync(dir, { recursive: true, force: true })
})
