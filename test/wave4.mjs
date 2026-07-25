// Wave 4 — characterization tests (signals + extract-actions + home-brief). Reads congelan output;
// WRITES asertan el estado de las filas. signals/home alimentan la Home/coach (user-facing) → cobertura sólida.
// Runner: node --test test/wave4.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle } from "../src/lib/db-core.mjs"
import {
  recentOutbound, lastInboundQuestions, lastOutboundPerThread, lastInboundPerThread, selfNotesText,
  maxMessageTs, activeThreadsSince, threadTextTail, messagesForResponseRate, activeOutboundThreads, recentCalls,
  insertTodo, insertPromesa, openActionItems, upsertMetric, metricHistory, rebuildStats,
} from "../src/lib/db.mjs"

const NOW = 1_000_000_000_000

// ─────────── signals (reads; los JOIN a thread_stats requieren rebuildStats) ───────────
test("recentOutbound: salientes recientes con texto (>6), no entrantes", () => {
  resetDb(":memory:")
  seed([
    { thread: "a", dir: "out", text: "te mando mañana el archivo", ts: NOW },  // ✓
    { thread: "a", dir: "in", text: "dale gracias totales", ts: NOW + 1 },     // in → fuera
    { thread: "b", dir: "out", text: "ok", ts: NOW + 2 },                      // len<=6 → fuera
    { thread: "c", dir: "out", text: "confirmo el precio final", ts: NOW - 500 }, // <= since → fuera
  ])
  rebuildStats()
  assert.deepEqual(recentOutbound(NOW - 100).map((r) => r.thread), ["a"])
})

test("lastInboundQuestions: último msg del hilo entrante y con '?', sin grupos", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "out", text: "hola como va", ts: NOW },
    { thread: "ana", dir: "in", name: "Ana", text: "me pasás el precio?", ts: NOW + 2 },  // último, in, ? → ✓
    { thread: "beto", dir: "in", text: "todo bien?", ts: NOW },
    { thread: "beto", dir: "out", text: "sí todo listo", ts: NOW + 1 },                   // último es out → fuera
    { thread: "g@g.us", dir: "in", text: "alguien sabe?", ts: NOW + 3 },                  // grupo → fuera
  ])
  rebuildStats()
  assert.deepEqual(lastInboundQuestions(NOW - 100, { limit: 10 }).map((r) => r.thread), ["ana"])
})

test("lastOutboundPerThread: último msg del hilo es TUYO (>10), no grupo/self", () => {
  resetDb(":memory:")
  seed([
    { thread: "c", dir: "out", text: "te confirmo el lunes sin falta", ts: NOW + 1 }, // último, out, >10 → ✓
    { thread: "d", dir: "out", text: "ok listo", ts: NOW + 2 },                        // len<=10 → fuera
    { thread: "self", dir: "out", text: "recordatorio personal largo", ts: NOW + 3 },  // self → fuera
  ])
  rebuildStats()
  assert.deepEqual(lastOutboundPerThread(NOW - 100, { limit: 10 }).map((r) => r.thread), ["c"])
})

test("lastInboundPerThread: último entrante, ts<maxTs, >8, sin self/grupo", () => {
  resetDb(":memory:")
  seed([
    { thread: "e", dir: "in", name: "E", text: "necesito el documento urgente", ts: NOW }, // ✓
    { thread: "f", dir: "in", text: "corto", ts: NOW + 1 },                                // len<=8 → fuera
  ])
  rebuildStats()
  assert.deepEqual(lastInboundPerThread(NOW - 100, NOW + 10, { limit: 10 }).map((r) => r.thread), ["e"])
})

test("selfNotesText: notas propias con texto (>4)", () => {
  resetDb(":memory:")
  seed([
    { thread: "self", text: "comprar pan mañana", ts: NOW + 1 },
    { thread: "self", text: "ok", ts: NOW + 2 },        // <=4 → fuera
    { thread: "otro", text: "no es self", ts: NOW + 3 }, // no self → fuera
  ])
  assert.deepEqual(selfNotesText({ limit: 10 }).map((r) => r.text), ["comprar pan mañana"])
})

// ─────────── extract-actions ───────────
test("maxMessageTs: max ts, o fallback si vacío", () => {
  resetDb(":memory:")
  assert.equal(maxMessageTs(42), 42) // vacío → fallback
  seed([{ thread: "t", text: "a", ts: NOW }, { thread: "t", text: "b", ts: NOW + 9 }])
  assert.equal(maxMessageTs(42), NOW + 9)
})

test("activeThreadsSince: hilos 1:1 reales nuevos (excluye email/grupo/spam/self)", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "in", name: "Ana", text: "hola", ts: NOW + 1 },  // ✓
    { thread: "email:x@y", dir: "in", text: "news", ts: NOW + 2 },         // email → fuera
    { thread: "g@g.us", dir: "in", text: "grupo", ts: NOW + 3 },           // grupo → fuera
    { thread: "spam:z", dir: "in", text: "spam", ts: NOW + 4 },            // spam → fuera
    { thread: "self", dir: "in", text: "nota", ts: NOW + 5 },              // self → fuera
  ])
  assert.deepEqual(activeThreadsSince(NOW, { limit: 10 }).map((r) => r.thread), ["ana"])
})

test("threadTextTail: cola de mensajes con texto de un hilo (desc)", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", dir: "in", name: "A", text: "primero", ts: NOW + 1 },
    { thread: "t", dir: "out", name: "yo", text: "segundo", ts: NOW + 2 },
    { thread: "t", dir: "in", name: "A", text: "", ts: NOW + 3 }, // text vacío → fuera
  ])
  assert.deepEqual(threadTextTail("t", { limit: 22 }).map((r) => r.text), ["segundo", "primero"])
})

// ─────────── home-brief ───────────
test("messagesForResponseRate: thread/ts/dir, excluye email/grupo/self", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "in", text: "hola", ts: NOW + 1 },
    { thread: "ana", dir: "out", text: "chau", ts: NOW + 2 },
    { thread: "email:x", dir: "in", text: "news", ts: NOW + 3 }, // email → fuera
    { thread: "self", dir: "in", text: "nota", ts: NOW + 4 },    // self → fuera
  ])
  assert.deepEqual(messagesForResponseRate(NOW).map((r) => r.thread), ["ana", "ana"])
})

test("activeOutboundThreads: nº de hilos 1:1 distintos a los que escribí", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "out", text: "a", ts: NOW + 1 },
    { thread: "beto", dir: "out", text: "b", ts: NOW + 2 },
    { thread: "ana", dir: "out", text: "c", ts: NOW + 3 }, // mismo hilo → no suma
    { thread: "g@g.us", dir: "out", text: "g", ts: NOW + 4 }, // grupo → fuera
    { thread: "self", dir: "out", text: "s", ts: NOW + 5 },   // self → fuera
  ])
  assert.equal(activeOutboundThreads(NOW), 2)
})

test("recentCalls: llamadas entrantes/perdidas recientes (mediaType='call')", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "in", name: "Ana", mediaType: "call", text: "llamada perdida", ts: NOW + 1 }, // ✓
    { thread: "beto", dir: "out", mediaType: "call", text: "llamada saliente", ts: NOW + 2 },            // out → fuera
    { thread: "ana", dir: "in", text: "mensaje normal", ts: NOW + 3 },                                   // no call → fuera
  ])
  assert.deepEqual(recentCalls(NOW, { limit: 30 }).map((r) => r.thread), ["ana"])
})

// ─────────── WRITES (asertan estado) ───────────
test("insertTodo / insertPromesa: crean fila done=0 (idempotente por id)", () => {
  resetDb(":memory:")
  assert.equal(insertTodo("t1", "mandar propuesta", "ana", "Ana", "mañana", NOW, NOW).changes, 1)
  insertPromesa("p1", "te confirmo el lunes", "ana", "Ana", "lunes", NOW, NOW)
  assert.deepEqual(handle().prepare("SELECT id,text,done FROM todos").all(), [{ id: "t1", text: "mandar propuesta", done: 0 }])
  assert.deepEqual(handle().prepare("SELECT id,text,done FROM promesas").all(), [{ id: "p1", text: "te confirmo el lunes", done: 0 }])
  assert.equal(insertTodo("t1", "OTRO", "x", "X", "", NOW, NOW).changes, 0) // OR IGNORE → no duplica
  assert.equal(handle().prepare("SELECT text FROM todos WHERE id='t1'").get().text, "mandar propuesta") // no pisa
})

test("openActionItems: abiertos (done=0) por allowlist; kind inválido → []", () => {
  resetDb(":memory:")
  insertTodo("t1", "abierta", "ana", "Ana", "", NOW + 2, NOW)
  insertTodo("t2", "cerrada", "ana", "Ana", "", NOW + 1, NOW)
  handle().prepare("UPDATE todos SET done=1 WHERE id='t2'").run() // cerrada → fuera
  insertPromesa("p1", "promesa abierta", "beto", "Beto", "", NOW, NOW)
  assert.deepEqual(openActionItems("todos").map((r) => r.id), ["t1"])
  assert.deepEqual(openActionItems("promesas").map((r) => r.id), ["p1"])
  assert.deepEqual(openActionItems("messages"), []) // allowlist: no arbitraria
  assert.deepEqual(openActionItems("../etc"), [])
})

test("upsertMetric + metricHistory: upsert por (metric,day) y lee historia", () => {
  resetDb(":memory:")
  upsertMetric("resp24", "2026-07-10", 80)
  upsertMetric("resp24", "2026-07-11", 90)
  upsertMetric("resp24", "2026-07-11", 95) // mismo día → UPDATE, no duplica
  const h = metricHistory("resp24", { limit: 14 })
  assert.deepEqual(h.map((r) => [r.day, r.value]), [["2026-07-11", 95], ["2026-07-10", 80]]) // DESC
})
