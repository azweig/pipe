// SYNC edit-aware: el `rev` monotónico (por trigger) sube en INSERT y en UPDATE, y threadDelta/threadMaxRev devuelven
// exactamente lo NUEVO o EDITADO desde una revisión. Es la base del cache incremental (el cliente pide solo rev > lastSeen).
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { threadDelta, threadMaxRev } from "../src/lib/threads-repo.mjs"
import { handle } from "../src/lib/db-core.mjs"

function insert(id, thread, text, ts) {
  handle().prepare("INSERT INTO messages (id, channel, thread, sender, name, text, ts, dir) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, "whatsapp", thread, "s", "X", text, ts, "in")
}

test("cada INSERT sube rev de forma monotónica", () => {
  resetDb(":memory:")
  insert("m1", "T", "hola", 1000)
  insert("m2", "T", "que tal", 2000)
  const rows = handle().prepare("SELECT id, rev FROM messages ORDER BY rev").all()
  assert.equal(rows.length, 2)
  assert.ok(rows[0].rev >= 1 && rows[1].rev > rows[0].rev, `rev debe crecer: ${JSON.stringify(rows)}`)
  assert.equal(threadMaxRev("T"), rows[1].rev)
})

test("threadDelta devuelve SOLO lo posterior a sinceRev", () => {
  resetDb(":memory:")
  insert("m1", "T", "uno", 1000)
  const r1 = threadMaxRev("T")
  insert("m2", "T", "dos", 2000)
  insert("m3", "T", "tres", 3000)
  const delta = threadDelta("T", r1)
  assert.deepEqual(delta.map((x) => x.id), ["m2", "m3"], "solo los que llegaron después de r1")
  assert.equal(threadDelta("T", threadMaxRev("T")).length, 0, "sin nada nuevo → delta vacío")
})

test("un UPDATE de una fila VIEJA la vuelve a aparecer en el delta (edit-aware: media backfilleada, resumen…)", () => {
  resetDb(":memory:")
  insert("m1", "T", "audio", 1000)
  insert("m2", "T", "texto", 2000)
  const rSync = threadMaxRev("T") // el cliente ya vio hasta acá
  // se backfillea el audio de m1 (fila vieja) → su rev tiene que superar rSync
  handle().prepare("UPDATE messages SET media=? WHERE id=?").run("/cas/aa/x.ogg", "m1")
  const delta = threadDelta("T", rSync)
  assert.deepEqual(delta.map((x) => x.id), ["m1"], "la fila editada reaparece aunque sea vieja")
  assert.equal(delta[0].media, "/cas/aa/x.ogg")
})

test("otro hilo no contamina el delta", () => {
  resetDb(":memory:")
  insert("a1", "A", "en A", 1000)
  const rA = threadMaxRev("A")
  insert("b1", "B", "en B", 2000)
  assert.equal(threadDelta("A", rA).length, 0, "un mensaje en B no aparece en el delta de A")
})
