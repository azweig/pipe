// Wave 6 — cierre del seam: withRetry (SQLITE_BUSY), últimos reads/writes migrados, y que db() ya NO existe.
// Runner: node --test test/wave6.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle, withRetry } from "../src/lib/db-core.mjs"
import { mediaWithoutFile, emailsToSummarize, linkMediaBatch } from "../src/lib/db.mjs"

const NOW = 1_000_000_000_000
const busyErr = () => { const e = new Error("database is locked"); e.code = "SQLITE_BUSY"; return e }

// ─────────── withRetry ───────────
test("withRetry: éxito devuelve el valor sin reintentar", () => {
  let calls = 0
  assert.equal(withRetry(() => { calls++; return 42 }), 42)
  assert.equal(calls, 1)
})

test("withRetry: error NO-BUSY se re-lanza YA (no traga, no reintenta)", () => {
  let calls = 0
  assert.throws(() => withRetry(() => { calls++; throw new Error("boom-no-busy") }, { tries: 5, baseMs: 1 }), /boom-no-busy/)
  assert.equal(calls, 1) // no reintenta un error que no es BUSY
})

test("withRetry: BUSY reintenta con backoff y luego pasa", () => {
  let n = 0
  const r = withRetry(() => { if (++n < 3) throw busyErr(); return "ok" }, { tries: 6, baseMs: 1 })
  assert.equal(r, "ok"); assert.equal(n, 3)
})

test("withRetry: BUSY persistente agota los intentos y re-lanza el último", () => {
  let n = 0
  assert.throws(() => withRetry(() => { n++; throw busyErr() }, { tries: 3, baseMs: 1 }), /database is locked/)
  assert.equal(n, 3) // exactamente `tries` intentos
})

// ─────────── últimos reads/writes migrados ───────────
test("mediaWithoutFile: mensajes con mediaType pero sin archivo", () => {
  resetDb(":memory:")
  seed([
    { id: "a", thread: "t", mediaType: "image", media: null, ts: NOW },   // ✓
    { id: "b", thread: "t", mediaType: "video", media: "/cas/x", ts: NOW }, // ya tiene media → fuera
    { id: "c", thread: "t", text: "sin media", ts: NOW },                   // sin mediaType → fuera
  ])
  assert.deepEqual(mediaWithoutFile().map((r) => r.id), ["a"])
})

test("emailsToSummarize: emails con body y sin resumen", () => {
  resetDb(":memory:")
  seed([
    { id: "e1", thread: "email:x", channel: "email", body: "cuerpo", text: "Asunto", name: "X", ts: NOW + 2 }, // ✓
    { id: "e2", thread: "email:y", channel: "email", body: "cuerpo", summary: "ya", ts: NOW + 1 },              // ya resumido → fuera
    { id: "e3", thread: "email:z", channel: "email", ts: NOW },                                                 // sin body → fuera
    { id: "e4", thread: "wa", channel: "whatsapp", body: "x", ts: NOW + 3 },                                    // no email → fuera
  ])
  assert.deepEqual(emailsToSummarize({ limit: 12 }).map((r) => r.id), ["e1"])
})

test("linkMediaBatch: vincula media SOLO si estaba null; devuelve #cambios", () => {
  resetDb(":memory:")
  seed([
    { id: "m1", thread: "t", mediaType: "image", media: null, ts: NOW },
    { id: "m2", thread: "t", mediaType: "image", media: "/ya", ts: NOW }, // ya tiene → no se toca
  ])
  const n = linkMediaBatch([["m1", "/cas/new.jpg"], ["m2", "/cas/other.jpg"]])
  assert.equal(n, 1) // solo m1 cambió (m2 tenía media)
  assert.equal(handle().prepare("SELECT media FROM messages WHERE id='m1'").get().media, "/cas/new.jpg")
  assert.equal(handle().prepare("SELECT media FROM messages WHERE id='m2'").get().media, "/ya")
})

// ─────────── el seam está CERRADO ───────────
test("db.mjs ya NO exporta db() (handle no cruza el seam)", async () => {
  const facade = await import("../src/lib/db.mjs")
  assert.equal(facade.db, undefined, "db() debería estar eliminado de la fachada")
  assert.equal(typeof facade.setBusyTimeout, "function", "las named ops sí se exportan")
  assert.equal(typeof facade.threadsSummary, "function", "las named queries sí se exportan")
})
