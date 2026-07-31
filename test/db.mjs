// Wave 0 — test de humo del harness de datos in-memory (db-core).
// Prueba que initSchema + resetDb(':memory:') + seed + query funcionan de punta a punta.
// NO toca la DB de prod: cada test abre una ':memory:' fresca y aislada.
// Runner nativo:  node --test test/db.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle, initSchema } from "../src/lib/db-core.mjs"

test("harness :memory: — initSchema crea el esquema y las queries corren", () => {
  const h = resetDb(":memory:")
  // el esquema existe (messages + FTS + tablas del router)
  const tables = new Set(h.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name))
  for (const t of ["messages", "meta", "todos", "promesas", "clips", "conversations", "conv_facets", "graph_edges", "thread_stats"]) {
    assert.ok(tables.has(t), `falta tabla ${t}`)
  }
})

test("seed inserta filas y son consultables", () => {
  resetDb(":memory:")
  const n = seed([
    { thread: "t1", channel: "whatsapp", dir: "in", name: "Ana", text: "hola mundo", ts: 1 },
    { thread: "t1", channel: "whatsapp", dir: "out", name: "yo", text: "chau", ts: 2 },
    { thread: "t2", channel: "email", dir: "in", name: "Beto", text: "factura", ts: 3, body: "monto 500" },
  ])
  assert.equal(n, 3)
  const c = handle().prepare("SELECT COUNT(*) c FROM messages").get().c
  assert.equal(c, 3)
})

test("los triggers de FTS5 funcionan en :memory: (asunto y body)", () => {
  resetDb(":memory:")
  seed([
    { thread: "t1", text: "reunión el martes", name: "Ana", ts: 1 },
    { thread: "t2", channel: "email", text: "factura", body: "el monto es 500 dólares", ts: 2 },
  ])
  const fts = handle().prepare("SELECT COUNT(*) c FROM messages_fts WHERE messages_fts MATCH ?").get("martes").c
  assert.ok(fts >= 1, "messages_fts no indexó el asunto")
  const bodyFts = handle().prepare("SELECT COUNT(*) c FROM email_fts WHERE email_fts MATCH ?").get("dólares").c
  assert.ok(bodyFts >= 1, "email_fts no indexó el body")
})

test("resetDb aísla: cada :memory: arranca vacía", () => {
  resetDb(":memory:")
  seed([{ thread: "t1", text: "uno", ts: 1 }])
  assert.equal(handle().prepare("SELECT COUNT(*) c FROM messages").get().c, 1)
  resetDb(":memory:") // nueva DB fresca
  assert.equal(handle().prepare("SELECT COUNT(*) c FROM messages").get().c, 0)
})

test("initSchema es idempotente (se puede correr dos veces sin romper)", () => {
  const h = resetDb(":memory:")
  assert.doesNotThrow(() => initSchema(h))
})

// GUARDRAIL: seed() debe cubrir TODAS las columnas de messages. Un fixture que no round-trip-ea todo
// enmascara diffs (pasó con `summary` en Wave 2). Este test rompe si el esquema gana una columna y SEED_COLS no.
test("seed() cubre TODAS las columnas de messages (sin drift silencioso)", () => {
  const h = resetDb(":memory:")
  const schemaCols = h.prepare("PRAGMA table_info(messages)").all().map((c) => c.name).sort()
  // un valor NO-null distinto por columna → si seed() dropea alguna, el readback la deja null y el test falla
  const row = { id: "X1", channel: "ch", account: "ac", thread: "th", jid: "jd", sender: "sn", name: "nm", text: "tx", ts: 12345, dir: "out", grp: "gp", media: "md", mediaType: "mt", filename: "fn", unread: 1, body: "bd", summary: "sm", attachments: "at", rev: 1 }
  seed([row])
  const back = h.prepare("SELECT * FROM messages WHERE id=?").get("X1")
  for (const c of schemaCols) assert.ok(back[c] !== null && back[c] !== undefined, `columna '${c}' no round-trip-eó por seed()`)
  // el fixture enumera EXACTAMENTE las columnas del esquema → agregar una al esquema obliga a actualizar SEED_COLS aquí
  assert.deepEqual(Object.keys(row).sort(), schemaCols)
})
