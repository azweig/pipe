// #5: guards de summarizeMedia (transcribir+resumir). Testea las salidas de error sin depender de whisper/LLM (que son externos).
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { summarizeMedia } from "../src/lib/brain/media-ai.mjs"

test("mensaje inexistente → error 'no encontrado'", async () => {
  resetDb(":memory:")
  const r = await summarizeMedia("no-existe")
  assert.ok(r.error && /no encontrado/i.test(r.error), r.error)
})

test("mensaje sin archivo → error", async () => {
  resetDb(":memory:")
  seed([{ id: "m1", channel: "whatsapp", account: "a", thread: "t", jid: "j", sender: "s", name: "X", text: "hola", ts: 1, dir: "in", media: null, mediaType: null }])
  const r = await summarizeMedia("m1")
  assert.ok(r.error && /archivo/i.test(r.error), r.error)
})

test("archivo que ya no está en CAS → error 'disponible'", async () => {
  resetDb(":memory:")
  seed([{ id: "m2", channel: "whatsapp", account: "a", thread: "t", jid: "j", sender: "s", name: "X", text: "", ts: 1, dir: "in", media: "/cas/zz/nope.mp4", mediaType: "video" }])
  const r = await summarizeMedia("m2")
  assert.ok(r.error && /disponible/i.test(r.error), r.error)
})
