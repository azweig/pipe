// graphify avanza un offset de BYTES sobre data/messages.jsonl: lo que queda atrás no se vuelve a mirar nunca.
// Estos tests cubren la contabilidad de fallos — el archivo no tenía ninguno, y de acá salen dos formas de perder datos:
// avanzar el offset con todos los lotes fallados, o quedar clavado para siempre por un lote que falla siempre.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-gfy-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

const store = await import("../src/lib/store.mjs")
const vault = await import("../src/lib/vault.mjs")

test("loadNewEvents expone hasta qué byte llegó (para saber si dos corridas están atascadas en lo mismo)", async () => {
  writeFileSync(join(dir, "data", "messages.jsonl"), [
    JSON.stringify({ ts: 1, channel: "whatsapp", name: "A", text: "hola", dir: "in" }),
    JSON.stringify({ ts: 2, channel: "whatsapp", name: "B", text: "chau", dir: "in" }),
  ].join("\n") + "\n")
  writeFileSync(join(dir, "data", ".graphify-offsets.json"), JSON.stringify({ "messages.jsonl": 0, _fmt: "bytes" }))
  const r = await store.loadNewEvents({ limit: 800 })
  assert.equal(r.events.length, 2)
  assert.equal(typeof r.endByte, "number", "hace falta para poder decir QUÉ rango se descarta")
  assert.ok(r.endByte > 0)
  // sin commit(), el offset NO se mueve: la próxima corrida reprocesa
  const off = JSON.parse(readFileSync(join(dir, "data", ".graphify-offsets.json"), "utf8"))
  assert.equal(off["messages.jsonl"], 0, "el offset solo avanza con commit()")
  r.commit()
  assert.equal(JSON.parse(readFileSync(join(dir, "data", ".graphify-offsets.json"), "utf8"))["messages.jsonl"], r.endByte)
})

test("upsertNode es IDEMPOTENTE: reprocesar un lote no infla el contador de menciones", () => {
  // de esto depende todo el diseño de reintentos: si rehacer un lote bueno cambiara el vault, no se podría reintentar.
  const tl = [{ date: "2026-08-01", line: "[whatsapp] dijo algo" }, { date: "2026-08-02", line: "[whatsapp] dijo otra" }]
  let ruta
  for (let i = 0; i < 3; i++) ruta = vault.upsertNode("person", "Ana Prueba", {}, tl)
  const menciones = readFileSync(ruta, "utf8").match(/mentions: (\d+)/)?.[1]
  assert.equal(menciones, "2", "tres pasadas idénticas → el mismo número, no 6")
  // y una mención NUEVA sí suma
  vault.upsertNode("person", "Ana Prueba", {}, [...tl, { date: "2026-08-03", line: "[whatsapp] algo nuevo" }])
  assert.equal(readFileSync(ruta, "utf8").match(/mentions: (\d+)/)?.[1], "3")
})
