// Checklist de primer arranque. Lo importante que se prueba acá NO es que cuente bien, sino que sin el 2º PIN vea
// EXACTAMENTE lo mismo que /api/status y /api/accounts: el booleano de "ya tenés correo" delata una cuenta oculta, y el
// checklist además DESAPARECE cuando está completo, que se nota todavía más.
import { test } from "node:test"
import assert from "node:assert/strict"
import { calcularOnboarding } from "../src/lib/onboarding.mjs"

const conKeyNube = { providers: [{ id: "openai", hasKey: true }], chain: ["openai", "ollama"] }
const sinIA = { providers: [{ id: "ollama", hasKey: true }], chain: ["gemini", "openai", "ollama"] }
const ok = (r, id) => r.steps.find((s) => s.id === id).ok

test("las tres reglas de negocio", () => {
  assert.equal(ok(calcularOnboarding({ st: { whatsapp: { bridge: ["51999000002"] } } }), "whatsapp"), true, "un login en el bridge alcanza")
  assert.equal(ok(calcularOnboarding({ chans: [{ channel: "whatsapp", n30: 5 }] }), "whatsapp"), true, "o mensajes que ya entraron")
  assert.equal(ok(calcularOnboarding({}), "whatsapp"), false)
  assert.equal(ok(calcularOnboarding({ acc: { email: [{ label: "trabajo" }] } }), "email"), true)
  assert.equal(ok(calcularOnboarding({ llm: conKeyNube }), "ia"), true, "key de nube")
  assert.equal(ok(calcularOnboarding({ llm: { providers: [], chain: ["ollama"] } }), "ia"), true, "ollama elegido como primario")
  assert.equal(ok(calcularOnboarding({ llm: sinIA }), "ia"), false, "ollama en la cadena por default NO cuenta: en un tenant no corre")
})

test("🔒 sin 2º PIN ve lo mismo que /api/accounts: una cuenta secreta no marca el paso como hecho", () => {
  const acc = { email: [{ label: "secreta" }] }
  const esCuentaSecreta = (canal, label) => canal === "email" && label === "secreta"
  const bloqueado = calcularOnboarding({ acc, esCuentaSecreta, secretOn: false })
  assert.equal(ok(bloqueado, "email"), false, "bloqueado NO puede decir que ya tenés correto configurado")
  const desbloqueado = calcularOnboarding({ acc, esCuentaSecreta, secretOn: true })
  assert.equal(ok(desbloqueado, "email"), true, "con el 2º PIN sí")
})

test("🔒 lo mismo para un número de WhatsApp secreto (bridge, baileys y mensajes)", () => {
  const st = { whatsapp: { bridge: ["51999000001"], baileys: [{ num: "51999000001" }] } }
  const esNumeroSecreto = (n) => String(n) === "51999000001"
  const args = { st, esNumeroSecreto, numerosSecretos: ["51999000001"], chans: [{ channel: "whatsapp", n30: 40 }] }
  assert.equal(ok(calcularOnboarding({ ...args, secretOn: false }), "whatsapp"), false,
    "ni por el bridge ni por el conteo de mensajes, que no distingue de qué línea son")
  assert.equal(ok(calcularOnboarding({ ...args, secretOn: true }), "whatsapp"), true)
  // pero una línea NORMAL junto a una secreta sí cuenta
  const mixto = { whatsapp: { bridge: ["51999000001", "51999000002"], baileys: [] } }
  assert.equal(ok(calcularOnboarding({ ...args, st: mixto, secretOn: false }), "whatsapp"), true, "la línea que no es secreta sigue valiendo")
})

test("un correo secreto NO apaga la señal de WhatsApp (son cosas distintas)", () => {
  const r = calcularOnboarding({ chans: [{ channel: "whatsapp", n30: 3 }], esCuentaSecreta: () => true, numerosSecretos: [], secretOn: false })
  assert.equal(ok(r, "whatsapp"), true)
})

test("el backup entra en el checklist inicial, no queda para 'después'", () => {
  // Un hub con los canales andando pero SIN copia afuera no está listo: todo vive en un disco. Por eso el
  // backup es un paso más del arranque y no una recomendación escondida en la documentación.
  const r = calcularOnboarding({ st: { whatsapp: { bridge: ["1"] } }, acc: { email: [{ label: "x" }] }, llm: conKeyNube })
  assert.ok(r.steps.some((s) => s.id === "backup"), "falta el paso de backup")
  assert.equal(r.total, 4)
  assert.equal(r.listo, false, "sin backup configurado el checklist NO está completo")
})

test("listo=true sólo con los cuatro", () => {
  process.env.BACKUP_RCLONE_REMOTE = "remoto:" // una de las dos formas de tener copia afuera
  const r = calcularOnboarding({ st: { whatsapp: { bridge: ["1"] } }, acc: { email: [{ label: "x" }] }, llm: conKeyNube })
  delete process.env.BACKUP_RCLONE_REMOTE
  assert.equal(r.done, 4); assert.equal(r.listo, true)
  assert.equal(calcularOnboarding({}).listo, false)
})
