// Wave 2 — characterization tests de las named queries que absorben el SQL crudo de 6 crons/libs.
// Cada test siembra un fixture :memory: y CONGELA el output actual de la query (misma SQL movida verbatim)
// → red de seguridad antes de migrar cada call-site. Runner: node --test test/wave2.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import {
  inboundUnansweredThreads, selfNotesSince, allThreadLastTs,
  sentMessages, emailMessagesInThread, accountMessageStats, rebuildStats,
} from "../src/lib/db.mjs"

const NOW = 1_000_000_000_000 // marca fija (los tests no pueden depender de Date.now)

test("inboundUnansweredThreads: solo entrantes recientes, sin grupos/self/respondidos/texto-corto", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "in", name: "Ana", jid: "ana@x", text: "hola necesito ayuda con esto", ts: NOW },         // ✓ candidato
    { thread: "ana", dir: "in", name: "Ana", jid: "ana@x", text: "sigue ahí mi consulta pendiente", ts: NOW + 5 },  // mismo hilo (representativo = último)
    { thread: "beto", dir: "in", name: "Beto", jid: "b@x", text: "hola respondeme cuando puedas", ts: NOW },        // respondido ↓ → excluido
    { thread: "beto", dir: "out", name: "yo", jid: "", text: "ya te contesto", ts: NOW + 1 },
    { thread: "grupo@g.us", dir: "in", name: "G", jid: "g", text: "mensaje largo de un grupo cualquiera", ts: NOW }, // grupo → excluido
    { thread: "conmarca", dir: "in", name: "C", jid: "c", text: "otro mensaje largo con grp marca", ts: NOW, grp: "Equipo" }, // grp!=null → excluido
    { thread: "self", dir: "in", name: "yo", jid: "", text: "una nota mía bien larga acá", ts: NOW },                // self → excluido
    { thread: "corto", dir: "in", name: "X", jid: "x", text: "hola", ts: NOW },                                      // len<=12 → excluido
    { thread: "viejo", dir: "in", name: "V", jid: "v", text: "mensaje viejo largo de hace mucho", ts: NOW - 500 },   // ts <= since → excluido
  ])
  const rows = inboundUnansweredThreads(NOW - 100)
  assert.deepEqual(rows.map((r) => r.thread), ["ana"])
  assert.equal(rows[0].ts, NOW + 5) // MAX(ts) del hilo
})

test("selfNotesSince: notas de 'self' desde una marca, más nuevas primero, con límite", () => {
  resetDb(":memory:")
  seed([
    { thread: "self", text: "nota vieja", ts: NOW - 10 },      // <= since → fuera
    { thread: "self", text: "nota A", ts: NOW + 1 },
    { thread: "self", text: "nota B", ts: NOW + 3, summary: "resumen B" },
    { thread: "otro", text: "no es self", ts: NOW + 2 },       // otro hilo → fuera
  ])
  const rows = selfNotesSince(NOW, { limit: 120 })
  assert.deepEqual(rows.map((r) => r.text), ["nota B", "nota A"]) // DESC
  assert.equal(rows[0].summary, "resumen B")
  assert.equal(selfNotesSince(NOW, { limit: 1 }).length, 1)      // respeta el límite
})

test("allThreadLastTs: last_ts por hilo desde thread_stats", () => {
  resetDb(":memory:")
  seed([
    { thread: "t1", dir: "in", text: "a", ts: NOW },
    { thread: "t1", dir: "in", text: "b", ts: NOW + 9 },
    { thread: "t2", dir: "in", text: "c", ts: NOW + 4 },
  ])
  rebuildStats() // thread_stats se deriva de messages
  const map = Object.fromEntries(allThreadLastTs().map((r) => [r.thread, r.last_ts]))
  assert.equal(map.t1, NOW + 9)
  assert.equal(map.t2, NOW + 4)
})

test("sentMessages: solo salientes con texto real, orden cronológico", () => {
  resetDb(":memory:")
  seed([
    { thread: "t1", dir: "out", channel: "whatsapp", text: "segundo enviado", ts: NOW + 2 },
    { thread: "t1", dir: "out", channel: "whatsapp", text: "primer enviado", ts: NOW + 1 },
    { thread: "t1", dir: "in", text: "entrante, no cuenta", ts: NOW },   // dir=in → fuera
    { thread: "t1", dir: "out", text: "ok", ts: NOW + 3 },               // trim len<=3 → fuera
    { thread: "t1", dir: "out", text: null, ts: NOW + 4 },               // text null → fuera
  ])
  const rows = sentMessages()
  assert.deepEqual(rows.map((r) => r.text), ["primer enviado", "segundo enviado"]) // ASC por ts
})

test("emailMessagesInThread: entrantes email con id 'email:%' del hilo", () => {
  resetDb(":memory:")
  seed([
    { thread: "t1", channel: "email", dir: "in", id: "email:aaa", account: "gmail", text: "x", ts: NOW },      // ✓
    { thread: "t1", channel: "email", dir: "out", id: "email:bbb", account: "gmail", text: "x", ts: NOW + 1 }, // out → fuera
    { thread: "t1", channel: "whatsapp", dir: "in", id: "wa:ccc", text: "x", ts: NOW + 2 },                    // no email → fuera
    { thread: "t2", channel: "email", dir: "in", id: "email:ddd", account: "out", text: "x", ts: NOW + 3 },    // otro hilo → fuera
  ])
  const rows = emailMessagesInThread("t1")
  assert.deepEqual(rows, [{ id: "email:aaa", account: "gmail" }])
})

test("accountMessageStats: conteo + última ts de una cuenta", () => {
  resetDb(":memory:")
  seed([
    { thread: "t1", account: "gmail", dir: "in", text: "a", ts: NOW },
    { thread: "t2", account: "gmail", dir: "in", text: "b", ts: NOW + 5 },
    { thread: "t3", account: "outlook", dir: "in", text: "c", ts: NOW + 9 },
  ])
  const r = accountMessageStats("gmail")
  assert.equal(r.n, 2)
  assert.equal(r.last, NOW + 5)
  assert.equal(accountMessageStats("nadie").n, 0) // cuenta inexistente → 0
})
