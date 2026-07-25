// Wave 3 — characterization tests. Reads congelan el output; WRITES asertan el ESTADO resultante
// (las filas después del op), no solo el retorno — las writes son más riesgosas. Runner: node --test test/wave3.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle } from "../src/lib/db-core.mjs"
import {
  videoCandidates, inbound1to1Since, totalUnread, audioToSummarize, messageById, clipCandidates,
  setVideoMedia, setMessageSummary, updateMessageContent, insertClip, rebuildMessagesFts, rebuildStats,
} from "../src/lib/db.mjs"

const NOW = 1_000_000_000_000

// ─────────── READS ───────────
test("videoCandidates: mensajes con link de video y sin media", () => {
  resetDb(":memory:")
  seed([
    { id: "a", thread: "t", text: "mirá https://youtu.be/x", ts: NOW },                    // ✓
    { id: "b", thread: "t", text: "reel https://instagram.com/reel/y", ts: NOW + 1 },       // ✓
    { id: "c", thread: "t", text: "https://youtu.be/z", media: "/cas/z.mp4", ts: NOW + 2 }, // media set → fuera
    { id: "d", thread: "t", text: "solo texto sin link", ts: NOW + 3 },                     // sin link → fuera
  ])
  assert.deepEqual(videoCandidates().map((r) => r.id).sort(), ["a", "b"])
})

test("inbound1to1Since: entrantes 1:1 desde marca, sin grupos/canales/spam/salientes", () => {
  resetDb(":memory:")
  seed([
    { id: "1", thread: "ana", dir: "in", name: "Ana", text: "hola", ts: NOW + 1 },     // ✓
    { id: "2", thread: "g@g.us", dir: "in", text: "grupo", ts: NOW + 2 },              // grupo → fuera
    { id: "3", thread: "spam:x", dir: "in", text: "spam", ts: NOW + 3 },               // spam → fuera
    { id: "4", thread: "n@newsletter", dir: "in", text: "news", ts: NOW + 4 },         // newsletter → fuera
    { id: "5", thread: "beto", dir: "out", text: "salida", ts: NOW + 5 },              // out → fuera
    { id: "6", thread: "ana", dir: "in", name: "Ana", text: "viejo", ts: NOW - 10 },   // <= since → fuera
  ])
  assert.deepEqual(inbound1to1Since(NOW).map((r) => r.text), ["hola"]) // la query trae thread/name/text/ts/jid (no id)
})

test("totalUnread: suma de no-leídos desde thread_stats", () => {
  resetDb(":memory:")
  seed([
    { thread: "t1", dir: "in", text: "a", ts: NOW, unread: 1 },
    { thread: "t1", dir: "in", text: "b", ts: NOW + 1, unread: 1 },
    { thread: "t2", dir: "in", text: "c", ts: NOW + 2, unread: 1 },
  ])
  rebuildStats()
  assert.equal(totalUnread(), 3)
})

test("audioToSummarize: audios sin resumen (recibidos + notas propias), respeta piso y límite", () => {
  resetDb(":memory:")
  seed([
    { id: "au1", thread: "x", mediaType: "audio", media: "/a1", dir: "in", ts: NOW + 5 },               // ✓
    { id: "au2", thread: "self", mediaType: "audio", media: "/a2", dir: "out", ts: NOW + 4 },           // nota propia (self out) → ✓
    { id: "au3", thread: "y", mediaType: "audio", media: "/a3", dir: "in", summary: "ya", ts: NOW + 3 }, // ya resumido → fuera
    { id: "au4", thread: "z", mediaType: "audio", media: "/a4", dir: "out", ts: NOW + 2 },              // out no-self → fuera
    { id: "au5", thread: "x", mediaType: "audio", media: "/a5", dir: "in", ts: NOW - 10 },              // < piso → fuera
  ])
  assert.deepEqual(audioToSummarize(NOW, { limit: 10 }).map((r) => r.id), ["au1", "au2"])
})

test("messageById: fila por id, o undefined", () => {
  resetDb(":memory:")
  seed([{ id: "m1", thread: "t", text: "hola", ts: NOW }])
  assert.equal(messageById("m1").text, "hola")
  assert.equal(messageById("nope"), undefined)
})

// ─────────── WRITES (asertan estado resultante) ───────────
test("setVideoMedia: setea media+mediaType SOLO si media era null", () => {
  resetDb(":memory:")
  seed([
    { id: "v1", thread: "t", text: "link", ts: NOW },                  // media null → se actualiza
    { id: "v2", thread: "t", text: "link", media: "/ya", ts: NOW + 1 }, // media ya set → NO se toca
  ])
  assert.equal(setVideoMedia("v1", "/cas/new.mp4").changes, 1)
  const m1 = messageById("v1")
  assert.equal(m1.media, "/cas/new.mp4")
  assert.equal(m1.mediaType, "video")
  assert.equal(setVideoMedia("v2", "/cas/other.mp4").changes, 0)       // guard `media IS NULL`
  assert.equal(messageById("v2").media, "/ya")                         // intacto
})

test("setMessageSummary: escribe summary en la fila", () => {
  resetDb(":memory:")
  seed([{ id: "s1", thread: "self", mediaType: "audio", media: "/a", ts: NOW }])
  setMessageSummary("s1", "resumen del audio")
  assert.equal(messageById("s1").summary, "resumen del audio")
})

test("updateMessageContent: setea text/body/summary; faltantes → null", () => {
  resetDb(":memory:")
  seed([{ id: "mt1", thread: "mt1", text: "⏳", body: "viejo", summary: "viejo", ts: NOW }])
  updateMessageContent("mt1", { text: "listo", body: "<b>b</b>", summary: "pitch" })
  let m = messageById("mt1")
  assert.equal(m.text, "listo"); assert.equal(m.body, "<b>b</b>"); assert.equal(m.summary, "pitch")
  updateMessageContent("mt1", { text: "solo texto" })                   // sin body/summary → null (como el original con `|| null`)
  m = messageById("mt1")
  assert.equal(m.text, "solo texto"); assert.equal(m.body, null); assert.equal(m.summary, null)
})

test("insertClip: crea la fila (idempotente por id); archived refleja spam; done=0 literal", () => {
  resetDb(":memory:")
  insertClip("c1", NOW, "link", "http://x", "Título", "para leer", 0, NOW)
  insertClip("c2", NOW + 1, "text", null, "Spam", "", 1, NOW + 1)
  assert.deepEqual(handle().prepare("SELECT id,kind,title,archived,done FROM clips ORDER BY id").all(), [
    { id: "c1", kind: "link", title: "Título", archived: 0, done: 0 },
    { id: "c2", kind: "text", title: "Spam", archived: 1, done: 0 },
  ])
  insertClip("c1", NOW, "link", "http://x", "OTRO", "", 0, NOW)          // OR IGNORE → ni duplica ni pisa
  assert.equal(handle().prepare("SELECT COUNT(*) n FROM clips").get().n, 2)
  assert.equal(handle().prepare("SELECT title FROM clips WHERE id='c1'").get().title, "Título")
})

test("clipCandidates: mensajes 'self' sin fila en clips todavía", () => {
  resetDb(":memory:")
  seed([
    { id: "n1", thread: "self", text: "nota 1", ts: NOW + 2 },
    { id: "n2", thread: "self", mediaType: "audio", media: "/a", ts: NOW + 1 },
    { id: "n3", thread: "otro", text: "no es self", ts: NOW },          // no self → fuera
  ])
  insertClip("n1", NOW + 2, "text", null, "ya", "", 0, NOW)             // n1 ya tiene clip → fuera
  assert.deepEqual(clipCandidates({ limit: 10 }).map((r) => r.id), ["n2"])
})

test("rebuildMessagesFts: reindexa el FTS de asuntos sin romper", () => {
  resetDb(":memory:")
  seed([{ id: "f1", thread: "t", text: "reunión importante mañana", name: "Ana", ts: NOW }])
  assert.doesNotThrow(() => rebuildMessagesFts())
  assert.ok(handle().prepare("SELECT COUNT(*) c FROM messages_fts WHERE messages_fts MATCH ?").get("importante").c >= 1)
})
