// Cobertura de las funciones de RE-KEYING de identidad (donde vivieron los bugs de contactos duplicados Ana/Beto).
// Harness con fixtures: DB en memoria + números FAKE (no colisionan con MY_NUMBERS ni el lid-map de prod → determinístico).
// Las funciones reciben contactsMap/manual como PARÁMETROS, así que la agenda real de prod no influye.
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle } from "../src/lib/db-core.mjs"
import { rekeyBridge, unifyByNumber, rekeyManual, rekeyContacts, rekeyPushNames, rebuildStats } from "../src/lib/db.mjs"

const NOW = Date.now()
const countIn = (thread) => handle().prepare("SELECT COUNT(*) c FROM messages WHERE thread=?").get(thread).c

// ── unifyByNumber: fusiona TODOS los hilos 1:1 del mismo número bajo el nombre del MAPA MANUAL (fix Ana) ──
test("identity: unifyByNumber fusiona hilos del mismo número bajo el nombre manual", () => {
  resetDb(":memory:")
  const NUM = "15550009999"
  seed([
    { thread: `whatsapp:${NUM}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${NUM}@s.whatsapp.net`, sender: `${NUM}@s.whatsapp.net`, dir: "in", name: "Ana", text: "hola", ts: NOW },
    { thread: "Persona Vieja", channel: "whatsapp", account: "matrix", jid: `${NUM}@s.whatsapp.net`, sender: `${NUM}@s.whatsapp.net`, dir: "in", name: "Ana", text: "chau", ts: NOW + 1 },
  ])
  rebuildStats() // unifyByNumber lee thread_stats
  unifyByNumber({}, { [NUM]: "Ana Manual" })
  assert.equal(countIn("Ana Manual"), 2, "los 2 hilos del mismo número → un solo hilo con el nombre manual")
  assert.equal(countIn(`whatsapp:${NUM}@s.whatsapp.net`), 0)
  assert.equal(countIn("Persona Vieja"), 0)
})

// ── rekeyBridge: resuelve la SALA por su remitente ENTRANTE y arrastra los SALIENTES sueltos (fix Beto) ──
test("identity: rekeyBridge reancla los salientes sueltos de una sala DM", () => {
  resetDb(":memory:")
  const NUM = "15550008888"
  seed([
    { thread: `whatsapp:${NUM}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: "!room1:test", sender: `@whatsapp_${NUM}:test`, dir: "in", name: "Beto", text: "hola", ts: NOW },
    { thread: "Beto Stray", channel: "whatsapp", account: "matrix", jid: "!room1:test", sender: "@whatsapp_15550001111:test", dir: "out", name: "yo", text: "nop", ts: NOW + 1 }, // saliente huérfano
  ])
  rekeyBridge({}, { [NUM]: "Beto Manual" })
  assert.equal(countIn("Beto Manual"), 2, "entrante + saliente de la MISMA sala → juntos bajo el nombre manual")
  assert.equal(countIn("Beto Stray"), 0, "el saliente suelto dejó de estar huérfano")
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
  // A es único → se re-keyea al nombre. B comparte nombre con OTRO NÚMERO QUE TAMBIÉN CONVERSA (C) → choque REAL → queda por número.
  const C = "15550006666"
  seed([{ thread: `whatsapp:${C}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${C}@s.whatsapp.net`, sender: `${C}@s.whatsapp.net`, dir: "in", text: "3", ts: NOW + 2 }])
  rekeyContacts({ [A]: "Único Nombre", [B]: "Homónimo", [C]: "Homónimo" })
  assert.equal(countIn("Único Nombre"), 1, "nombre único → hilo por nombre")
  assert.equal(countIn(`whatsapp:${B}@s.whatsapp.net`), 1, "homónimo REAL → queda por número (no fusiona personas distintas)")
  assert.equal(countIn(`whatsapp:${C}@s.whatsapp.net`), 1, "el otro homónimo también queda por número")
})

// ── el guard es sobre choques REALES: la agenda repite muchísimo un nombre en números que NUNCA escribieron
// (contactos duplicados, o el mismo número con y sin el "9" de Argentina). Eso bloqueaba a gente con miles de
// mensajes (varios, con miles de mensajes) sin que hubiera nada que fusionar. Caso real 2026-08-18. ──
test("identity: el nombre repetido en números QUE NO CONVERSAN no bloquea el re-key", () => {
  resetDb(":memory:")
  const REAL = "15550003001", SIN_USO_1 = "15550003002", SIN_USO_2 = "15550003003" // variantes del mismo contacto en la agenda
  seed([{ thread: `whatsapp:${REAL}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${REAL}@s.whatsapp.net`, sender: `${REAL}@s.whatsapp.net`, dir: "in", name: "Ana", text: "hola", ts: NOW }])
  rekeyContacts({ [REAL]: "Ana García", [SIN_USO_1]: "Ana García", [SIN_USO_2]: "Ana García" })
  assert.equal(countIn("Ana García"), 1, "solo un número conversa → renombrar no puede fusionar a nadie")
  assert.equal(countIn(`whatsapp:${REAL}@s.whatsapp.net`), 0)
})

// ── rekeyPushNames: WhatsApp trae el nombre que la persona se puso, aunque NO esté en tu agenda.
// Es la única forma de que esos hilos dejen de verse como un número. Con las mismas guardas anti-homónimo. ──
const mkMsg = (num, name, ts, text = "hola") => ({ thread: `whatsapp:${num}@s.whatsapp.net`, channel: "whatsapp", account: "matrix", jid: `${num}@s.whatsapp.net`, sender: `${num}@s.whatsapp.net`, dir: "in", name, text, ts })

test("pushname: hilo por número sin agenda → toma el nombre que trae WhatsApp", () => {
  resetDb(":memory:")
  const N = "15550001111"
  seed([mkMsg(N, "Nadia Ferrer (WA)", NOW)])
  rekeyPushNames({}, {})
  assert.equal(countIn("Nadia Ferrer"), 1, "usa el push name, sin el sufijo (WA)")
  assert.equal(countIn(`whatsapp:${N}@s.whatsapp.net`), 0)
})

test("pushname: dos números con el MISMO nombre → ninguno se renombra (serían personas distintas)", () => {
  resetDb(":memory:")
  const A = "15550002222", B = "15550003333"
  seed([mkMsg(A, "Marcos", NOW), mkMsg(B, "Marcos", NOW + 1)])
  rekeyPushNames({}, {})
  assert.equal(countIn(`whatsapp:${A}@s.whatsapp.net`), 1, "choque de push name → queda por número")
  assert.equal(countIn(`whatsapp:${B}@s.whatsapp.net`), 1)
  assert.equal(countIn("Marcos"), 0)
})

test("pushname: no pisa un hilo que YA existe con ese nombre (no fusiona por coincidencia)", () => {
  resetDb(":memory:")
  const N = "15550004321"
  seed([
    { thread: "Julia Ortega", channel: "whatsapp", account: "matrix", jid: "15559998888@s.whatsapp.net", sender: "15559998888@s.whatsapp.net", dir: "in", name: "Marco", text: "ya resuelto", ts: NOW },
    mkMsg(N, "Julia Ortega", NOW + 1),
  ])
  rekeyPushNames({}, {})
  assert.equal(countIn("Julia Ortega"), 1, "el hilo existente no se toca")
  assert.equal(countIn(`whatsapp:${N}@s.whatsapp.net`), 1, "el otro queda por número (fusionar sería adivinar)")
})

test("pushname: no toca los que ya cubre la agenda ni un nombre inservible", () => {
  resetDb(":memory:")
  const CONAGENDA = "15550005432", NUMERICO = "15550006543"
  seed([mkMsg(CONAGENDA, "Como se llame", NOW), mkMsg(NUMERICO, "+51 999 888 777", NOW + 1)])
  rekeyPushNames({ [CONAGENDA]: "De la agenda" }, {})
  assert.equal(countIn(`whatsapp:${CONAGENDA}@s.whatsapp.net`), 1, "si está en la agenda lo resuelve rekeyContacts, no este")
  assert.equal(countIn(`whatsapp:${NUMERICO}@s.whatsapp.net`), 1, "un 'nombre' que es un número no sirve")
})
