// Una sala de Matrix (`!room:server`) puede ser un GRUPO o un DM del bridge — la clave NO lo dice.
// Los DM de WhatsApp no mostraban el problema porque rekeyBridge los renombra a la persona; los de Discord
// se quedan con la sala, y salían en la bandeja como "Grupo · 1 personas", sin nombre ni foto de quien te habla.
// Lo que sí lo dice es cuántos remitentes DISTINTOS escribieron: 1 = DM.
// Runner: node --test test/matrix-room-dm.mjs
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { rebuildStats } from "../src/lib/db.mjs"
import { listThreads, invalidateThreads } from "../src/lib/brain/inbox.mjs"

const NOW = Date.now()
const SALA = "discord:!AbCdEf:pipe.local"
const msg = (name, sender, text, ts) => ({ thread: SALA, channel: "discord", account: "matrix", jid: "!AbCdEf:pipe.local", sender, dir: "in", name, text, ts })
// listThreads cachea 15s: sin invalidar, el 2º caso recibiría la lista del 1º
const find = () => { invalidateThreads(); return listThreads({ limit: 50 }).find((t) => t.key === SALA) }

test("sala de Matrix con UN remitente = DM (no 'Grupo · 1 personas')", () => {
  resetDb(":memory:")
  seed([msg("longcat", "@discord_1:pipe.local", "hola", NOW), msg("longcat", "@discord_1:pipe.local", "che", NOW + 1)])
  rebuildStats()
  const t = find()
  assert.ok(t, "el hilo tiene que aparecer en la bandeja")
  assert.equal(t.group, false, "un DM del bridge no es un grupo")
  assert.equal(t.name, "longcat", "tiene que mostrar a quién te habla, no 'Grupo · N personas'")
})

test("sala de Matrix con VARIOS remitentes sí es grupo", () => {
  resetDb(":memory:")
  seed([msg("longcat", "@discord_1:pipe.local", "hola", NOW), msg("otro", "@discord_2:pipe.local", "buenas", NOW + 1)])
  rebuildStats()
  const t = find()
  assert.ok(t, "el hilo tiene que aparecer")
  assert.equal(t.group, true, "dos remitentes distintos = grupo de verdad")
})
