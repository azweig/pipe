// Smoke de la capa HTTP: bootea el server REAL en un puerto efímero contra una DB temporal y valida que
// responde + que el GATE de auth funciona. El más alto ROI para quien toque server.mjs. Portable (no toca prod):
// MESSAGES_DB temporal + HUB_CONFIG ficticio. El gate: 127.0.0.1 sin X-Forwarded-For = confiable (túnel SSH,
// sin PIN); con X-Forwarded-For = "remoto vía proxy" → exige sesión → 401.
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import net from "node:net"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "pipe-api-"))
const hubCfg = join(dir, "hub.json")
writeFileSync(hubCfg, JSON.stringify({ ownerName: "Test Owner", ownerFirst: "Test", company: "TestCo", myNumbers: ["15551230001"], myEmails: ["me@example.com"], timezone: "America/Lima", domain: "localhost" }))

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)) }) })

let proc, PORT
const base = () => `http://127.0.0.1:${PORT}`

before(async () => {
  PORT = await freePort()
  proc = spawn(process.execPath, ["src/server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", MESSAGES_DB: join(dir, "messages.db"), HUB_CONFIG: hubCfg, LLM_CHAIN: "ollama" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let childOut = ""
  proc.stdout.on("data", (b) => { childOut += b })
  proc.stderr.on("data", (b) => { childOut += b })
  proc.on("exit", (code, sig) => { if (code) childOut += `\n[server salió code=${code} sig=${sig}]` })
  const deadline = Date.now() + 20000
  for (;;) {
    try { const r = await fetch(`${base()}/api/auth/status`); if (r.ok) break } catch {}
    if (Date.now() > deadline) throw new Error("el server no arrancó a tiempo. Salida del proceso:\n" + (childOut.slice(-2000) || "(sin salida)"))
    await new Promise((r) => setTimeout(r, 250))
  }
})

after(() => { if (proc) proc.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }) })

test("/api/auth/status responde 200 y marca authed desde localhost (sin PIN)", async () => {
  const r = await fetch(`${base()}/api/auth/status`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.authed, true, "127.0.0.1 sin X-Forwarded-For = confiable")
  assert.equal(j.pinSet, false, "DB/data limpia → todavía sin PIN")
})

test("una API protegida (/api/threads) responde desde local", async () => {
  const r = await fetch(`${base()}/api/threads?limit=5`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.ok(Array.isArray(j), "listThreads → array (vacío con DB temporal)")
})

test("GATE: request 'remota' (X-Forwarded-For) a una API sin sesión → 401", async () => {
  const r = await fetch(`${base()}/api/threads`, { headers: { "x-forwarded-for": "8.8.8.8" } })
  assert.equal(r.status, 401)
})

test("/api/auth/status con X-Forwarded-For → 200 pero authed:false", async () => {
  const r = await fetch(`${base()}/api/auth/status`, { headers: { "x-forwarded-for": "8.8.8.8" } })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).authed, false)
})

// LAND-GRAB del primer arranque: el bootstrap del PIN es privilegiado y NUNCA debe poder hacerse desde remoto, aunque aún no haya PIN.
test("GATE: /api/auth/setup 'remoto' (X-Forwarded-For) → 403 aunque no haya PIN todavía", async () => {
  const r = await fetch(`${base()}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" }, body: JSON.stringify({ pin: "123456" }) })
  assert.equal(r.status, 403, "el PIN solo se configura desde localhost (túnel SSH)")
})

// CSRF/drive-by: un GET con efecto disparado cross-site (Sec-Fetch-Site) se bloquea ANTES del gate, aunque el request sea local.
test("GATE: GET cross-site (Sec-Fetch-Site) a /api/ → 403 (hay GETs con efecto)", async () => {
  const r = await fetch(`${base()}/api/threads?limit=5`, { headers: { "sec-fetch-site": "cross-site" } })
  assert.equal(r.status, 403, "cross-site bloqueado aunque venga de 127.0.0.1")
})

// TABLA de rutas destructivas/sensibles (versión focalizada del hallazgo #5): cada una, 'remota' y sin sesión, debe caer en el gate → 401.
// Que agregar una ruta con efecto ARRIBA del gate rompa este test. (No son las 128, pero sí las que borran/mandan/reconfiguran.)
const PROTEGIDAS = [
  ["POST", "/api/send"], ["POST", "/api/reply"], ["POST", "/api/send-media"], ["POST", "/api/send-audio"],
  ["POST", "/api/media/trash"], ["POST", "/api/media/free"], ["POST", "/api/hub-config/save"], ["POST", "/api/llm-config/save"],
  ["POST", "/api/company/delete"], ["POST", "/api/espacio/delete"], ["POST", "/api/objetivo/delete"], ["POST", "/api/schedule/delete"],
  ["POST", "/api/contact/archive"], ["POST", "/api/thread/suggest-reply"], ["GET", "/api/thread/media"],
]
for (const [method, path] of PROTEGIDAS) {
  test(`GATE: ${method} ${path} remoto sin sesión → 401`, async () => {
    const r = await fetch(`${base()}${path}`, { method, headers: { "x-forwarded-for": "8.8.8.8", ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { body: "{}" } : {}) })
    assert.equal(r.status, 401, `${path} debe exigir sesión desde remoto`)
  })
}
