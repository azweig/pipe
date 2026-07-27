// Cobertura de las funciones de RE-KEYING de identidad (donde vivieron los bugs de contactos duplicados Milagros/Helmut).
// Harness con fixtures: DB en memoria + números FAKE (no colisionan con MY_NUMBERS ni el lid-map de prod → determinístico).
// Las funciones reciben contactsMap/manual como PARÁMETROS, así que la agenda real de prod no influye.
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle } from "../src/lib/db-core.mjs"
import { rekeyBridge, unifyByNumber, rekeyManual, rekeyContacts, rebuildStats } from "../src/lib/db.mjs"

const NOW = Date.now()
const countIn = (thread) => handle().prepare("SELECT COUNT(*) c FROM messages WHERE thread=?").get(thread).c

// ── unifyByNumber: fusiona TODOS los hilos 1:1 del mismo número bajo el nombre del MAPA MANUAL (fix Milagros) ──
test("identity: unifyByNumber fusiona hilos del mismo número bajo el nombre manual", () => {
  resetDb(":memory:")
  const NUM = "15550009999"
  seed([
    { thread: `whatsapp:${NUM}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${NUM}@s.whatsapp.net`, sender: `${NUM}@s.whatsapp.net`, dir: "in", name: "Mili", text: "hola", ts: NOW },
    { thread: "Persona Vieja", channel: "whatsapp", account: "matrix", jid: `${NUM}@s.whatsapp.net`, sender: `${NUM}@s.whatsapp.net`, dir: "in", name: "Mili", text: "chau", ts: NOW + 1 },
  ])
  rebuildStats() // unifyByNumber lee thread_stats
  unifyByNumber({}, { [NUM]: "Milagros Manual" })
  assert.equal(countIn("Milagros Manual"), 2, "los 2 hilos del mismo número → un solo hilo con el nombre manual")
  assert.equal(countIn(`whatsapp:${NUM}@s.whatsapp.net`), 0)
  assert.equal(countIn("Persona Vieja"), 0)
})

// ── rekeyBridge: resuelve la SALA por su remitente ENTRANTE y arrastra los SALIENTES sueltos (fix Helmut) ──
test("identity: rekeyBridge reancla los salientes sueltos de una sala DM", () => {
  resetDb(":memory:")
  const NUM = "15550008888"
  seed([
    { thread: `whatsapp:${NUM}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: "!room1:test", sender: `@whatsapp_${NUM}:test`, dir: "in", name: "Helmut", text: "hola", ts: NOW },
    { thread: "Helmut Stray", channel: "whatsapp", account: "matrix", jid: "!room1:test", sender: "@whatsapp_15550001111:test", dir: "out", name: "yo", text: "nop", ts: NOW + 1 }, // saliente huérfano
  ])
  rekeyBridge({}, { [NUM]: "Helmut Manual" })
  assert.equal(countIn("Helmut Manual"), 2, "entrante + saliente de la MISMA sala → juntos bajo el nombre manual")
  assert.equal(countIn("Helmut Stray"), 0, "el saliente suelto dejó de estar huérfano")
})

// ── rekeyBridge NO toca grupos (sala con >1 número entrante distinto) ──
test("identity: rekeyBridge no colapsa un grupo como 1:1", () => {
  resetDb(":memory:")
  seed([
    { thread: "grupo:x", channel: "whatsapp", account: "matrix", jid: "!grp:test", sender: "@whatsapp_15550002222:test", dir: "in", text: "a", ts: NOW },
    { thread: "grupo:x", channel: "whatsapp", account: "matrix", jid: "!grp:test", sender: "@whatsapp_15550003333:test", dir: "in", text: "b", ts: NOW + 1 },
  ])
  rekeyBridge({}, {})
  assert.equal(countIn("grupo:x"), 2, "2 números entrantes distintos = grupo → no se re-keyea a una persona")
})

// ── rekeyManual: mueve el hilo del número al nombre manual (por jid) ──
test("identity: rekeyManual mueve el hilo del número al nombre manual", () => {
  resetDb(":memory:")
  const NUM = "15550007777"
  seed([{ thread: `whatsapp:${NUM}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${NUM}@s.whatsapp.net`, sender: `${NUM}@s.whatsapp.net`, dir: "in", text: "hey", ts: NOW }])
  rekeyManual({ [NUM]: "Nombre Manual" })
  assert.equal(countIn("Nombre Manual"), 1)
  assert.equal(countIn(`whatsapp:${NUM}@s.whatsapp.net`), 0)
})

// ── rekeyContacts: número → nombre de agenda, con guard de homónimo (dos números mismo nombre → NO fusiona) ──
test("identity: rekeyContacts usa la agenda pero respeta homónimos", () => {
  resetDb(":memory:")
  const A = "15550004444", B = "15550005555"
  seed([
    { thread: `whatsapp:${A}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${A}@s.whatsapp.net`, sender: `${A}@s.whatsapp.net`, dir: "in", text: "1", ts: NOW },
    { thread: `whatsapp:${B}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${B}@s.whatsapp.net`, sender: `${B}@s.whatsapp.net`, dir: "in", text: "2", ts: NOW + 1 },
  ])
  // A es único → se re-keyea al nombre; B es homónimo (mismo nombre en 2 números) → queda por número
  rekeyContacts({ [A]: "Único Nombre", [B]: "Homónimo", "15550006666": "Homónimo" })
  assert.equal(countIn("Único Nombre"), 1, "nombre único → hilo por nombre")
  assert.equal(countIn(`whatsapp:${B}@s.whatsapp.net`), 1, "homónimo → queda por número (no fusiona personas distintas)")
})
