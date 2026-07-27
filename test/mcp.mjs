// Invariantes del conector MCP: (1) CERO EGRESS — el server MCP no sale a la red; (2) registro de tools bien formado
// y toda acción OUTWARD (enviar/reenviar) exige confirmación. Estático + estructural (sin spawnear ni tocar la red).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

test("mcp: cero egress — src/mcp no hace fetch ni importa módulos de red", () => {
  const files = readdirSync("src/mcp").filter((f) => f.endsWith(".mjs"))
  assert.ok(files.length >= 2, "deben existir los archivos de src/mcp")
  for (const f of files) {
    const src = readFileSync(join("src/mcp", f), "utf8")
    assert.ok(!/\bfetch\s*\(/.test(src), `${f}: el server MCP no debe hacer fetch (invariante cero-egress)`)
    assert.ok(!/from\s+["'](node:net|node:dns|node:http|node:https|node:tls|node-fetch|axios|got|undici|ws)["']/.test(src), `${f}: no debe importar módulos de red`)
  }
})

test("mcp: registro de tools válido y writes outward confirmados", async () => {
  const { TOOLS } = await import("../src/mcp/tools.mjs")
  assert.ok(TOOLS.length >= 3, "debe haber tools")
  const names = new Set()
  for (const t of TOOLS) {
    assert.ok(t.name && !names.has(t.name), `nombre faltante o duplicado: ${t.name}`); names.add(t.name)
    assert.ok(t.description && t.inputSchema && typeof t.handler === "function", `${t.name}: campos faltantes`)
    assert.ok(["read", "write"].includes(t.scope), `${t.name}: scope inválido (${t.scope})`)
  }
  // enviar/reenviar salen HACIA AFUERA y son irreversibles → DEBEN pedir confirmación (elicitation)
  for (const n of ["send_reply", "forward_message"]) {
    const t = TOOLS.find((x) => x.name === n)
    assert.ok(t && typeof t.confirm === "function", `${n} debe requerir confirmación (campo confirm)`)
  }
})
