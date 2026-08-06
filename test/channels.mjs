// Tests del REGISTRO de canales (src/lib/channels.mjs) — única fuente de verdad de qué canales existen y cómo se conectan/envían.
// Módulo puro (sin DB ni red) → import directo.
import { test } from "node:test"
import assert from "node:assert/strict"
import { CHANNELS, channelList, getChannel, isChannel, bridgeNets, tokenNets, isSimpleSender, channelCatalog } from "../src/lib/channels.mjs"

test("cada entrada tiene id===clave + label + kind válido", () => {
  const KINDS = new Set(["messaging", "email", "calendar", "files", "notes"])
  for (const [key, c] of Object.entries(CHANNELS)) {
    assert.equal(c.id, key, `id de ${key} debe ser la clave`)
    assert.ok(c.label, `${key} sin label`)
    assert.ok(KINDS.has(c.kind), `${key} kind inválido: ${c.kind}`)
    if (c.connect) assert.ok(typeof c.connect.method === "string", `${key} connect sin method`)
  }
})

test("getChannel/isChannel: case-insensitive, null si no existe", () => {
  assert.equal(getChannel("WhatsApp")?.id, "whatsapp")
  assert.equal(getChannel("SLACK")?.id, "slack")
  assert.equal(getChannel("noexiste"), null)
  assert.equal(isChannel("telegram"), true)
  assert.equal(isChannel("myspace"), false)
})

test("bridgeNets = redes con connect matrix-bridge (whatsapp/instagram/facebook/linkedin)", () => {
  const nets = bridgeNets().sort()
  assert.deepEqual(nets, ["facebook", "instagram", "linkedin", "whatsapp"])
  // invariante: el server valida /api/matrix-link contra esto → las redes históricas deben seguir estando
  for (const n of ["whatsapp", "instagram", "facebook", "linkedin"]) assert.ok(nets.includes(n), `falta net ${n}`)
})

test("tokenNets = redes por token (discord)", () => {
  assert.deepEqual(tokenNets(), ["discord"])
})

test("isSimpleSender: slack/signal/telegram sí; whatsapp/email NO (envío especial)", () => {
  for (const s of ["slack", "signal", "telegram"]) assert.equal(isSimpleSender(s), true, `${s} debería ser simple sender`)
  for (const s of ["whatsapp", "email", "instagram"]) assert.equal(isSimpleSender(s), false, `${s} NO es simple sender`)
})

test("channelCatalog NO filtra internos (reader/gate/send) — solo metadata pública", () => {
  const cat = channelCatalog()
  assert.equal(cat.length, channelList().length)
  for (const c of cat) {
    assert.ok(c.id && c.label && c.kind)
    assert.equal("reader" in c, false, `${c.id}: reader no debe salir en el catálogo`)
    assert.equal("send" in c, false, `${c.id}: send interno no debe salir`)
    assert.equal("gate" in c, false, `${c.id}: gate (env vars) no debe salir`)
  }
  // whatsapp aparece como conectable por bridge multi-cuenta
  const wa = cat.find((c) => c.id === "whatsapp")
  assert.equal(wa.connect.method, "matrix-bridge")
  assert.equal(wa.connect.multi, true)
  assert.equal(wa.canSend, true)
})
