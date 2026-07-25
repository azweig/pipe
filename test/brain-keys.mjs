// Candidato #2 / M1 — characterization tests del kernel PURO brain/kernel/keys.mjs.
// Funciones deterministas sin I/O → tests triviales y sólidos sobre la lógica de resolución de identidad
// (canon/counterpart/norm), que es donde se cuelan los bugs sutiles de homónimos. Runner: node --test test/brain-keys.mjs
import "./_setup.mjs" // identidad ficticia (owner=Test, myNumbers 15551230001..3) ANTES de cargar keys
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  jidOfKey, canonOfKey, numOf, digitsOf, channelId, initials, stripWA, norm, slug, plural,
  threadKind, isContainerJid, isGroupJid, isSelfThread, ownerTokens, isOwnerName, counterpartOf, dedupEvents,
} from "../src/lib/brain/kernel/keys.mjs"

test("claves de hilo: jidOfKey / canonOfKey", () => {
  assert.equal(jidOfKey("email:a@b.com"), "a@b.com")
  assert.equal(jidOfKey("whatsapp:519@s.whatsapp.net"), "519@s.whatsapp.net")
  assert.equal(jidOfKey("Diego Ramírez"), "") // sin ":" → sin jid
  assert.equal(canonOfKey("Diego Ramírez"), "Diego Ramírez") // clave sin ":" = nombre canónico
  assert.equal(canonOfKey("whatsapp:519@s"), null) // clave keyed → no es canon
  assert.equal(canonOfKey("self"), null)
})

test("numOf / digitsOf / channelId", () => {
  assert.equal(numOf("51999188771@s.whatsapp.net"), "51999188771")
  assert.equal(numOf("!room:pipe.local"), "!room") // no es número, pero determinista
  assert.equal(digitsOf("+51 999-188-771"), "51999188771")
  assert.equal(channelId({ channel: "email", jid: "a@b.com" }), "email:a@b.com")
  assert.equal(channelId({ channel: "whatsapp", account: "wa1" }), "whatsapp:wa1")
})

test("nombres: initials / stripWA / norm / slug / plural", () => {
  assert.equal(initials("Diego Ramírez"), "DR")
  assert.equal(initials("madonna"), "M")
  assert.equal(stripWA("Pedro G (WA)"), "Pedro G")
  assert.equal(norm("José  Pérez (WA)"), "jose perez") // NFD + saca acentos + saca (WA) + minúsculas + colapsa espacios
  assert.equal(norm("Águila"), "aguila")
  assert.equal(slug('Empresa: A/B *?"'), "Empresa AB ") // saca chars ilegales de path (no trimea la cola)
  assert.equal(plural(1, "persona"), "1 persona")
  assert.equal(plural(2, "persona"), "2 personas")
})

test("clasificación de jid: threadKind / isContainerJid / isGroupJid", () => {
  assert.equal(threadKind("120363@g.us"), "group")
  assert.equal(threadKind("abc@thread.v2"), "group")
  assert.equal(threadKind("x@newsletter"), "channel")
  assert.equal(threadKind("y@broadcast"), "broadcast")
  assert.equal(threadKind("51999@s.whatsapp.net"), "dm")
  assert.ok(isContainerJid("120363@g.us"))
  assert.ok(isContainerJid("!RoomAbc:pipe.local"))
  assert.ok(!isContainerJid("51999@s.whatsapp.net"))
  assert.ok(isGroupJid("120363@g.us"))
  assert.ok(!isGroupJid("51999@s.whatsapp.net"))
})

test("isSelfThread: whatsapp 1:1 con uno de MIS números", () => {
  assert.ok(isSelfThread({ channel: "whatsapp", jid: "15551230001@s.whatsapp.net" })) // ∈ myNumbers (test)
  assert.ok(!isSelfThread({ channel: "whatsapp", jid: "99999@s.whatsapp.net" }))       // ajeno
  assert.ok(!isSelfThread({ channel: "whatsapp", jid: "120363@g.us" }))                 // grupo, aunque tenga mi número
  assert.ok(!isSelfThread({ channel: "email", jid: "me@example.com" }))                 // no whatsapp
})

test("dueño del hub: ownerTokens / isOwnerName", () => {
  assert.deepEqual(ownerTokens().sort(), ["owner", "test", "test"]) // ownerFirst + owner.split, sin dedup: de "Test Owner" + "Test"
  assert.ok(isOwnerName("Test Owner"))
  assert.ok(isOwnerName("yo"))
  assert.ok(isOwnerName("Test · Notas"))
  assert.ok(!isOwnerName("Diego Ramírez"))
  assert.ok(!isOwnerName(""))
})

test("counterpartOf: resolución de identidad (homónimo) — es PURA, dado im + n2c", () => {
  const im = { "whatsapp:519@s": "Diego Ramírez" } // identity-map: este canal → esta persona
  const n2c = { "diego": "Diego hermano" }          // name→canon: 'diego' suelto → el hermano
  // el identity-map manda (canal exacto) → NO colapsa el homónimo por nombre suelto
  assert.equal(counterpartOf({ channel: "whatsapp", jid: "519@s", name: "Diego" }, im, n2c), "Diego Ramírez")
  // sin match de canal, cae al name→canon
  assert.equal(counterpartOf({ channel: "whatsapp", jid: "otro@s", name: "Diego" }, im, n2c), "Diego hermano")
  // un CONTENEDOR (grupo) nunca resuelve a persona (no colapsar por identidad)
  assert.equal(counterpartOf({ channel: "whatsapp", jid: "120363@g.us", name: "Diego" }, im, n2c), null)
  // sin ningún match → null
  assert.equal(counterpartOf({ channel: "whatsapp", jid: "z@s", name: "Nadie" }, im, n2c), null)
})

test("dedupEvents: colapsa el mismo id por canal, preserva orden y los sin-id", () => {
  const out = dedupEvents([
    { channel: "whatsapp", id: "m1", ts: 1 },
    { channel: "whatsapp", id: "m1", ts: 2 }, // dup → fuera
    { channel: "whatsapp", id: "m2", ts: 3 },
    { channel: "telegram", id: "m1", ts: 4 }, // otro canal, mismo id → distinto
    { channel: "whatsapp", ts: 5 },           // sin id → siempre entra
  ])
  assert.deepEqual(out.map((e) => e.ts), [1, 3, 4, 5])
})
