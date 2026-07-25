// Wave 5 — characterization tests de los reads de brain.mjs. Todos reads → congelan output sobre fixture :memory:.
// Runner: node --test test/wave5.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle } from "../src/lib/db-core.mjs"
import {
  threadStats, threadMediaCount, threadChannelCounts, threadMediaGallery, channelActivityStats,
  lastInboundName, channelAccountActivity, topInboundNames, repliedThreads, latestThreadLike,
  sentCountSince, recvCountSince, topThreadsSince, threadMessagesSinceAll, groupMembershipRows,
  threadCountFirstLast, threadChannelActivity, threadDirTimeline, threadInboundSenders,
  threadTextRowids, messagesByRowids, clipsForNotes, pinnedNotesClips, insertClip, clipFlag,
} from "../src/lib/db.mjs"

const NOW = 1_000_000_000_000

test("threadStats: total/sent/first/last de un hilo", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", dir: "in", text: "a", ts: NOW },
    { thread: "t", dir: "out", text: "b", ts: NOW + 5 },
    { thread: "t", dir: "in", text: "c", ts: NOW + 2 },
  ])
  const s = threadStats("t")
  assert.equal(s.total, 3); assert.equal(s.sent, 1); assert.equal(s.first, NOW); assert.equal(s.last, NOW + 5)
})

test("threadMediaCount: adjuntos reales (no stickers)", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", media: "/a", mediaType: "image", ts: NOW },
    { thread: "t", media: "/b", mediaType: "sticker", ts: NOW + 1 }, // sticker → fuera
    { thread: "t", text: "sin media", ts: NOW + 2 },
  ])
  assert.equal(threadMediaCount("t"), 1)
})

test("threadChannelCounts / channelActivityStats / channelAccountActivity", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", channel: "whatsapp", account: "wa1", dir: "in", text: "a", ts: NOW },
    { thread: "t", channel: "whatsapp", account: "wa1", dir: "in", text: "b", ts: NOW + 1 },
    { thread: "t", channel: "email", account: "gmail", dir: "in", text: "c", ts: NOW + 2 },
  ])
  assert.deepEqual(threadChannelCounts("t").map((r) => [r.channel, r.n]), [["whatsapp", 2], ["email", 1]])
  const ca = channelActivityStats(NOW - 100, NOW - 100)
  assert.equal(ca.find((r) => r.channel === "whatsapp").n30, 2)
  assert.equal(channelAccountActivity().length, 2) // (whatsapp,wa1) + (email,gmail)
})

test("threadMediaGallery: adjuntos de un hilo, más nuevos primero", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", media: "/a", mediaType: "image", name: "Ana", dir: "in", ts: NOW },
    { thread: "t", media: "/b", mediaType: "video", dir: "out", ts: NOW + 5 },
  ])
  assert.deepEqual(threadMediaGallery("t").map((r) => r.media), ["/b", "/a"])
})

test("lastInboundName: último nombre entrante", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", dir: "in", name: "Ana", text: "x", ts: NOW },
    { thread: "t", dir: "in", name: "Ana B", text: "y", ts: NOW + 5 },
    { thread: "t", dir: "out", name: "yo", text: "z", ts: NOW + 9 },
  ])
  assert.equal(lastInboundName("t").name, "Ana B")
})

test("topInboundNames: nombres entrantes más frecuentes, excluye owner", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", dir: "in", name: "Ana", text: "1", ts: NOW },
    { thread: "t", dir: "in", name: "Ana", text: "2", ts: NOW + 1 },
    { thread: "t", dir: "in", name: "Beto", text: "3", ts: NOW + 2 },
    { thread: "t", dir: "in", name: "Yo", text: "4", ts: NOW + 3 },
  ])
  assert.deepEqual(topInboundNames("t", "Yo", { limit: 3 }).map((r) => r.name), ["Ana", "Beto"])
})

test("repliedThreads (FEEDER de listThreads): hilos distintos con salientes", () => {
  resetDb(":memory:")
  seed([
    { thread: "a", dir: "out", text: "x", ts: NOW },
    { thread: "a", dir: "out", text: "y", ts: NOW + 1 },
    { thread: "b", dir: "in", text: "z", ts: NOW + 2 },   // solo entrante → fuera
    { thread: "c", dir: "out", text: "w", ts: NOW + 3 },
  ])
  assert.deepEqual(repliedThreads().map((r) => r.thread).sort(), ["a", "c"])
})

test("latestThreadLike: hilo más reciente que matchea LIKE", () => {
  resetDb(":memory:")
  seed([
    { thread: "whatsapp:51999@s.whatsapp.net", dir: "in", text: "a", ts: NOW },
    { thread: "whatsapp:51999@s.whatsapp.net", dir: "in", text: "b", ts: NOW + 5 },
  ])
  assert.equal(latestThreadLike("whatsapp:51999@%").thread, "whatsapp:51999@s.whatsapp.net")
  assert.equal(latestThreadLike("whatsapp:000@%"), undefined)
})

test("sentCountSince / recvCountSince: excluye self/spam/broadcast en recv", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "out", text: "a", ts: NOW + 1 },
    { thread: "ana", dir: "in", text: "b", ts: NOW + 2 },
    { thread: "self", dir: "in", text: "nota", ts: NOW + 3 },   // recv → fuera
    { thread: "spam:x", dir: "in", text: "spam", ts: NOW + 4 }, // recv → fuera
  ])
  assert.equal(sentCountSince(NOW), 1)
  assert.equal(recvCountSince(NOW), 1)
})

test("topThreadsSince: hilos con más ida y vuelta (excluye grupos/spam/self)", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", dir: "in", text: "1", ts: NOW + 1 }, { thread: "ana", dir: "out", text: "2", ts: NOW + 2 },
    { thread: "beto", dir: "in", text: "3", ts: NOW + 3 },
    { thread: "g@g.us", dir: "in", text: "4", ts: NOW + 4 }, // grupo → fuera
  ])
  assert.deepEqual(topThreadsSince(NOW, { limit: 12 }).map((r) => [r.thread, r.c]), [["ana", 2], ["beto", 1]])
})

test("threadMessagesSinceAll: todos (cualquier dir) de un hilo desde una marca", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", dir: "in", text: "viejo", ts: NOW - 10 },  // <= since → fuera
    { thread: "t", dir: "in", text: "a", ts: NOW + 1 },
    { thread: "t", dir: "out", text: "b", ts: NOW + 2 },
  ])
  assert.deepEqual(threadMessagesSinceAll("t", NOW, { limit: 500 }).map((r) => r.text), ["a", "b"])
})

test("groupMembershipRows: remitentes por grupo (only groups, dir in, no bots)", () => {
  resetDb(":memory:")
  seed([
    { thread: "g@g.us", dir: "in", sender: "@wa_1", name: "Ana", text: "x", ts: NOW },
    { thread: "g@g.us", dir: "in", sender: "@wa_2", name: "Beto", text: "y", ts: NOW + 1 },
    { thread: "g@g.us", dir: "in", sender: "@wa_3", name: "grupbot", text: "z", ts: NOW + 2 }, // bot → fuera
    { thread: "ana", dir: "in", sender: "@wa_1", name: "Ana", text: "dm", ts: NOW + 3 },        // no grupo → fuera
  ])
  const rows = groupMembershipRows()
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Ana", "Beto"])
})

test("threadCountFirstLast / threadChannelActivity / threadDirTimeline / threadInboundSenders", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", channel: "whatsapp", dir: "in", sender: "@wa_1", text: "a", ts: NOW },
    { thread: "t", channel: "whatsapp", dir: "out", text: "b", ts: NOW + 5 },
    { thread: "t", channel: "email", dir: "in", sender: "x@y", text: "c", ts: NOW + 2 },
  ])
  const s = threadCountFirstLast("t"); assert.equal(s.c, 3); assert.equal(s.first, NOW); assert.equal(s.last, NOW + 5)
  assert.equal(threadChannelActivity("t").find((r) => r.channel === "whatsapp").n, 2)
  assert.deepEqual(threadDirTimeline("t", { limit: 3000 }).map((r) => r.dir), ["in", "in", "out"]) // por ts ASC
  assert.deepEqual(threadInboundSenders("t", { limit: 30 }).map((r) => r.sender).sort(), ["@wa_1", "x@y"])
})

test("threadTextRowids + messagesByRowids: muestreo por rowid en orden cronológico", () => {
  resetDb(":memory:")
  seed([
    { thread: "t", dir: "in", text: "hola charla", ts: NOW },
    { thread: "t", dir: "out", text: "http://link.com", ts: NOW + 1 },  // http → fuera de textRowids
    { thread: "t", dir: "in", text: "Nota de voz", ts: NOW + 2 },        // nota de voz → fuera
    { thread: "t", dir: "out", text: "todo bien", ts: NOW + 3 },
  ])
  const rids = threadTextRowids("t").map((r) => r.rowid)
  const msgs = messagesByRowids(rids)
  assert.deepEqual(msgs.map((m) => m.text), ["hola charla", "todo bien"])
  assert.deepEqual(messagesByRowids([]), [])
})

test("clipsForNotes: filtros por kind + paginado", () => {
  resetDb(":memory:")
  seed([
    { id: "n1", thread: "self", text: "una idea suelta", ts: NOW + 3 },
    { id: "n2", thread: "self", text: "mirá http://x.com", ts: NOW + 2 },
    { id: "n3", thread: "self", media: "/a", mediaType: "image", ts: NOW + 1 },
    { id: "n4", thread: "otro", text: "no self", ts: NOW + 4 },
  ])
  assert.deepEqual(clipsForNotes({ kind: "all", limit: 40 }).map((r) => r.id), ["n1", "n2", "n3"]) // DESC por ts
  assert.deepEqual(clipsForNotes({ kind: "link", limit: 40 }).map((r) => r.id), ["n2"])
  assert.deepEqual(clipsForNotes({ kind: "media", limit: 40 }).map((r) => r.id), ["n3"])
  assert.deepEqual(clipsForNotes({ kind: "text", limit: 40 }).map((r) => r.id), ["n1"])
})

test("clipsForNotes archived + pinnedNotesClips", () => {
  resetDb(":memory:")
  seed([{ id: "n1", thread: "self", text: "clip fijado", ts: NOW + 1 }, { id: "n2", thread: "self", text: "clip archivado", ts: NOW + 2 }])
  insertClip("n1", NOW + 1, "text", null, "Fijado", "", 0, NOW)
  insertClip("n2", NOW + 2, "text", null, "Archivado", "", 1, NOW) // archived=1
  clipFlag("n1", "pinned", true)
  assert.deepEqual(clipsForNotes({ kind: "all", limit: 40 }).map((r) => r.id), ["n1"]) // n2 archivado → fuera
  assert.deepEqual(clipsForNotes({ kind: "archived", limit: 40 }).map((r) => r.id), ["n2"])
  assert.deepEqual(pinnedNotesClips().map((r) => r.id), ["n1"])
})
