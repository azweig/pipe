// HEARTBEATS HUÉRFANOS — un lector puede escribir su heartbeat religiosamente y que el daemon no lo mire nunca.
// Pasó con /tmp/hb_telegram y /tmp/hb_teams: los dos se escribían, ninguno estaba en HB_WATCH, así que el
// vigilante de "readers colgados" no cubría esos dos canales. Un archivo que nadie lee no vigila nada.
//
// Invariante: todo heartbeat que se escriba en el código tiene que estar vigilado por el daemon.
// Runner: node --test test/heartbeat-watched.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"

const DAEMON = readFileSync("src/daemon.mjs", "utf8")

const escritos = new Set()
for (const f of readdirSync("src").filter((f) => f.endsWith(".mjs"))) {
  const src = readFileSync(`src/${f}`, "utf8")
  for (const m of src.matchAll(/writeFileSync\(\s*"(\/tmp\/hb_[a-z]+)"/g)) escritos.add(m[1])
}

const vigilados = new Set([...DAEMON.matchAll(/hb:\s*"(\/tmp\/hb_[a-z]+)"/g)].map((m) => m[1]))

test("todo heartbeat que se escribe está en HB_WATCH del daemon", () => {
  assert.ok(escritos.size >= 4, `esperaba encontrar heartbeats en el fuente, hallé ${escritos.size}`)
  const huerfanos = [...escritos].filter((hb) => !vigilados.has(hb))
  assert.deepEqual(huerfanos, [], `heartbeats que nadie vigila: ${huerfanos.join(", ")}`)
})

test("no se vigila un heartbeat que nadie escribe (quedaría matando readers sanos... o nunca)", () => {
  const fantasmas = [...vigilados].filter((hb) => !escritos.has(hb))
  assert.deepEqual(fantasmas, [], `vigilados pero nadie los escribe: ${fantasmas.join(", ")}`)
})

test("cada entrada de HB_WATCH nombra readers que existen en READERS", () => {
  const declarados = new Set([...DAEMON.matchAll(/^\s*\["([a-z-]+)",\s*NODE,/gm)].map((m) => m[1]))
  assert.ok(declarados.size > 5, "no pude leer la lista READERS")
  for (const m of DAEMON.matchAll(/readers:\s*\[([^\]]+)\]/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^"|"$/g, "")
      if (name) assert.ok(declarados.has(name), `HB_WATCH apunta a "${name}", que no está en READERS`)
    }
  }
})
