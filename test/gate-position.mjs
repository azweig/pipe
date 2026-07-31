// INVARIANTE POSICIONAL del gate (hallazgo #5 en su forma correcta): el riesgo no es una ruta mal testeada, es una ruta NUEVA
// nacida ARRIBA del gate de auth, sin protección, que nadie nota. Esto es estático (parsea server.mjs) — sin server, sin fixtures,
// milisegundos — y falla en el PR exacto que introduce el problema. Es la red que 128 requests e2e no dan.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// rutas que LEGÍTIMAMENTE viven antes del gate (bootstrap de auth + monitoreo público). Agregar acá debe ser deliberado.
const PRE_GATE_OK = new Set([
  "/api/auth/status", "/api/auth/setup", "/api/auth", "/api/auth/logout", "/api/auth/revoke-all", "/api/auth/change-pin", "/api/health",
  "/api/webhook/kofi", // webhook público de Ko-fi: verifica su propio verification_token (KOFI_TOKEN), no puede usar PIN. Deliberado y revisado.
  "/api/ingest/sms", // ingesta de SMS desde un forwarder de teléfono/Mac (chat.db): autentica con SMS_TOKEN por header, el forwarder no tiene PIN. Deliberado y revisado.
  "/api/gpu-health", // salud del GPU box: el monitor gpu-health.sh (otro host) postea con GPU_HEALTH_TOKEN por header → 401 sin token; no puede usar PIN. Deliberado y revisado.
])

const src = readFileSync("src/server.mjs", "utf8").split("\n")
// el gate: la línea que devuelve 401 para /api cuando !authed. Todo path === "/api/…" por ENCIMA de acá corre sin auth.
const gateLine = src.findIndex((l) => l.includes('path.startsWith("/api/")) return json(res, 401'))

test("el marcador del gate existe (si esto falla, el test quedó desanclado — arreglalo, no lo borres)", () => {
  assert.ok(gateLine > 0, "no encontré la línea del gate en server.mjs")
})

test("ninguna ruta /api vive arriba del gate salvo el allowlist de bootstrap/health", () => {
  const above = []
  for (let i = 0; i < gateLine; i++) {
    const m = src[i].match(/path === "(\/api\/[a-z0-9/_.-]+)"/gi)
    if (m) for (const frag of m) { const path = frag.match(/"(\/api\/[^"]+)"/)[1]; if (!PRE_GATE_OK.has(path)) above.push(`${path} (línea ${i + 1})`) }
  }
  assert.deepEqual([...new Set(above)], [], `RUTA /api ARRIBA DEL GATE sin auth: ${above.join(", ")} — movéla abajo del gate o justificá el allowlist`)
})
