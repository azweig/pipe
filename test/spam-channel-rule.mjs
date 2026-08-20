// REGLA DEL USUARIO: "WhatsApp/Telegram/etc NUNCA es spam". `bucketOf` la respeta en el detector estructural
// (solo corre para emails puros) pero se la saltaba en la capa 2: el veredicto del LLM se aplicaba a TODOS los
// canales. Resultado real: los canales de Telegram a los que Alvaro se suscribió a propósito (High Rollers,
// Daily Drops, Stake Perú, VIP Notices) caían en spam y solo llegaba la notificación, nunca el mensaje.
// Runner: node --test test/spam-channel-rule.mjs
import "./_setup.mjs"
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { rebuildStats } from "../src/lib/db.mjs"
import { listThreads, invalidateThreads } from "../src/lib/brain/inbox.mjs"

const NOW = Date.now()
const TG = "telegram:-100199", MAIL = "email:promo@marca.com"
let cwd, dir

before(() => { // cwd temporal: spam.mjs lee ./data/spam-cache.json relativo
  cwd = process.cwd(); dir = mkdtempSync(join(tmpdir(), "pipe-spam-"))
  process.chdir(dir); mkdirSync("data", { recursive: true })
  writeFileSync("data/spam-cache.json", JSON.stringify({ [TG]: true, [MAIL]: true })) // el LLM marcó los DOS
})
after(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) })

test("un canal de Telegram NO es spam aunque el LLM lo marque (regla del usuario)", () => {
  resetDb(":memory:")
  seed([
    { thread: TG, channel: "telegram", account: "tg", jid: "-100199", sender: "-100199", dir: "in", name: "CanalQueSigo", text: "Bonus Drop: código abc123", ts: NOW },
    { thread: MAIL, channel: "email", account: "m", jid: "promo@marca.com", sender: "promo@marca.com", dir: "in", name: "Promo", text: "oferta imperdible, unsubscribe", ts: NOW },
  ])
  rebuildStats(); invalidateThreads()
  const all = listThreads({ limit: 50 })
  const tg = all.find((t) => t.key === TG), mail = all.find((t) => t.key === MAIL)
  assert.ok(tg, "el canal de Telegram tiene que estar en la bandeja")
  assert.notEqual(tg.bucket, "spam", "te suscribiste vos: no puede caer en spam y dejarte solo la notificación")
  assert.equal(mail.bucket, "spam", "en correo el veredicto del LLM SÍ tiene que seguir valiendo")
})
