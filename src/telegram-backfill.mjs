// IMPORTADOR DE HISTORIAL DE TELEGRAM.
//
// El lector en vivo (src/telegram.mjs) arranca desde CERO a propósito: su catch-up dice "primera vez: no bajar todo
// el historial". Consecuencia: si tenías conversaciones desde antes de conectar Telegram, en Pipe no existían.
// Esto las trae.
//
// Uso:
//   node src/telegram-backfill.mjs --dialogs 30 --per 300     # los 30 chats más recientes, 300 mensajes c/u
//   node src/telegram-backfill.mjs --chat "Thiago" --per 1000 # un chat puntual, más a fondo
//   node src/telegram-backfill.mjs --list                     # ver qué chats hay, sin importar nada
//
// IDEMPOTENTE: el id es nativo (telegram:<chatId>:<msgId>), así que re-correrlo no duplica. Va en lotes acotados y
// termina — no es fire-and-forget (ver pattern_backfill_safe). Usa la sesión YA guardada; no pide código de nuevo.
import { TelegramClient } from "telegram"
import { StringSession } from "telegram/sessions/index.js"
import { Logger } from "telegram/extensions/index.js"
import { readFileSync, existsSync } from "fs"
import { appendMessage } from "./lib/lock.mjs"
import { owner } from "./lib/hub.mjs"
import { tgRecord, tgDialogName } from "./lib/telegram-store.mjs"
import { loadEnv } from "./lib/env.mjs"

loadEnv()
Logger.setLevel("error")

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const DIALOGS = Number(arg("--dialogs", 30))
const PER = Number(arg("--per", 300))
const ONLY = arg("--chat", "")
const LIST = process.argv.includes("--list")

const sessionFile = "./auth/telegram.session"
const cfgFile = "./auth/telegram-config.json"
const cfg = (() => { try { return JSON.parse(readFileSync(cfgFile, "utf8")) } catch { return {} } })()
if (!existsSync(sessionFile)) { console.log("[tg-backfill] no hay sesión de Telegram — conectalo primero desde la app"); process.exit(1) }

const client = new TelegramClient(
  new StringSession(readFileSync(sessionFile, "utf8").trim()),
  parseInt(process.env.TG_API_ID || cfg.apiId || "0"),
  process.env.TG_API_HASH || cfg.apiHash || "",
  { connectionRetries: 5 },
)
await client.connect()
if (!(await client.isUserAuthorized())) { console.log("[tg-backfill] la sesión no está autorizada — reconectá Telegram desde la app"); process.exit(1) }

const me = owner()
const dialogs = await client.getDialogs({ limit: Math.max(DIALOGS, ONLY ? 200 : DIALOGS) })
const targets = ONLY
  ? dialogs.filter((d) => tgDialogName(d).toLowerCase().includes(ONLY.toLowerCase()) || String(d.id) === ONLY)
  : dialogs.slice(0, DIALOGS)

if (LIST) {
  console.log(`[tg-backfill] ${dialogs.length} chats:`)
  for (const d of dialogs) console.log(`  · ${tgDialogName(d)}  (id ${d.id})`)
  await client.disconnect(); process.exit(0)
}
if (!targets.length) { console.log(`[tg-backfill] ningún chat matchea "${ONLY}" — probá --list`); await client.disconnect(); process.exit(0) }

console.log(`[tg-backfill] importando ${targets.length} chat(s), hasta ${PER} mensajes cada uno`)
let total = 0
for (const d of targets) {
  const nm = tgDialogName(d)
  let n = 0
  try {
    for await (const m of client.iterMessages(d.entity, { limit: PER })) {
      const rec = await tgRecord(m, me)
      if (!rec) continue
      appendMessage(rec) // id nativo → si ya estaba, la DB lo ignora
      n++
    }
  } catch (e) { console.log(`  ✗ ${nm}: ${e.message}`); continue }
  total += n
  console.log(`  ✓ ${nm}: ${n}`)
}
console.log(`[tg-backfill] LISTO: ${total} mensajes. La ingesta (cada 15s) los pasa a la DB y aparecen en la bandeja.`)
await client.disconnect()
process.exit(0)
