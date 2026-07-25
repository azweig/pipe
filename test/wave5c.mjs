// Wave 5c — characterization de las MUTATIONS de brain (writes) + los reads del send-path (resolución de destino).
// Writes asertan el ESTADO resultante. Runner: node --test test/wave5c.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed, handle } from "../src/lib/db-core.mjs"
import {
  whatsappRoomsOf, roomInboundSenders, emailAddressesOf, lastInboundJid, lastEmailByAddress,
  lastEmailInThread, lastUnipileJid, lastWhatsappRoom, lastHistoricJid,
  insertSocialDigest, markDone, insertTodo, insertPromesa,
} from "../src/lib/db.mjs"

const NOW = 1_000_000_000_000
const ROOM = "!AbC:pipe.local"

// ─────────── WRITES (asertan estado) ───────────
test("insertSocialDigest: inserta mensaje entrante (unread) + upsert de thread_stats, atómico", () => {
  resetDb(":memory:")
  insertSocialDigest({ id: "social:instagram:1", network: "instagram", thread: "social:instagram", name: "IG Feed", digest: "3 posts nuevos", ts: NOW })
  const m = handle().prepare("SELECT channel, account, thread, name, text, dir, unread FROM messages WHERE id=?").get("social:instagram:1")
  assert.deepEqual(m, { channel: "instagram", account: "feed", thread: "social:instagram", name: "IG Feed", text: "3 posts nuevos", dir: "in", unread: 1 })
  const s = handle().prepare("SELECT count, unread, channels, last_ts FROM thread_stats WHERE thread='social:instagram'").get()
  assert.deepEqual(s, { count: 1, unread: 1, channels: "instagram", last_ts: NOW })
})

test("markDone: marca done=1 en la tabla correcta por allowlist", () => {
  resetDb(":memory:")
  insertTodo("t1", "tarea", "ana", "Ana", "", NOW, NOW)
  insertPromesa("p1", "promesa", "ana", "Ana", "", NOW, NOW)
  markDone("todo", "t1")
  markDone("prom", "p1")
  assert.equal(handle().prepare("SELECT done FROM todos WHERE id='t1'").get().done, 1)
  assert.equal(handle().prepare("SELECT done FROM promesas WHERE id='p1'").get().done, 1)
  // kind desconocido → fallback 'todos' (fiel al ternario original), nunca interpola input
  insertTodo("t2", "otra", "x", "X", "", NOW, NOW)
  markDone("cualquier-cosa", "t2")
  assert.equal(handle().prepare("SELECT done FROM todos WHERE id='t2'").get().done, 1)
})

// ─────────── SEND-PATH reads (resolución de destino) ───────────
test("whatsappRoomsOf + roomInboundSenders: salas portal y sus remitentes", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", jid: ROOM, dir: "in", sender: "@whatsapp_51999188771", text: "hola", ts: NOW },
    { thread: "ana", jid: ROOM, dir: "in", sender: "@whatsapp_51999188771", text: "?", ts: NOW + 1 },
    { thread: "ana", jid: "otro@s.whatsapp.net", dir: "in", text: "x", ts: NOW + 2 }, // no es sala portal
  ])
  assert.deepEqual(whatsappRoomsOf("ana").map((r) => r.jid), [ROOM])
  assert.deepEqual(roomInboundSenders("ana", ROOM).map((r) => r.sender), ["@whatsapp_51999188771"])
})

test("emailAddressesOf + lastEmailByAddress + lastEmailInThread", () => {
  resetDb(":memory:")
  seed([
    { thread: "email:a@x.com", channel: "email", jid: "a@x.com", account: "gmail", dir: "in", text: "Asunto — cuerpo", ts: NOW },
    { thread: "email:a@x.com", channel: "email", jid: "a@x.com", account: "gmail", dir: "in", text: "Otro", ts: NOW + 5 },
  ])
  assert.deepEqual(emailAddressesOf("email:a@x.com").map((r) => r.jid), ["a@x.com"])
  assert.equal(lastEmailByAddress("a@x.com").account, "gmail")
  assert.equal(lastEmailInThread("email:a@x.com").text, "Otro") // el más reciente
})

test("lastInboundJid / lastUnipileJid / lastWhatsappRoom / lastHistoricJid", () => {
  resetDb(":memory:")
  seed([
    { thread: "ana", jid: "51999@s.whatsapp.net", dir: "in", text: "viejo", ts: NOW },
    { thread: "ana", jid: ROOM, dir: "in", text: "sala", ts: NOW + 3 },
    { thread: "ana", jid: "uni@x", account: "unipile", channel: "whatsapp", dir: "in", text: "u", ts: NOW + 1 },
    { thread: "ana", jid: "51999@s.whatsapp.net", dir: "out", text: "mío", ts: NOW + 4 }, // out → no cuenta para lastInbound
  ])
  assert.equal(lastInboundJid("ana").jid, ROOM)                    // último entrante
  assert.equal(lastUnipileJid("ana").jid, "uni@x")
  assert.equal(lastWhatsappRoom("ana").jid, ROOM)
  assert.equal(lastHistoricJid("ana").jid, "51999@s.whatsapp.net") // el más reciente @s.whatsapp.net
  assert.equal(lastWhatsappRoom("sin-sala"), undefined)
})
