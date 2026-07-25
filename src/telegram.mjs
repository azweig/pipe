// Telegram reader (GramJS / MTProto user client) — SOLO LECTURA. Inicia sesión como TU usuario y lee tus chats.
// Necesita: TG_API_ID + TG_API_HASH (de https://my.telegram.org → API development tools) + TG_PHONE.
// El código que manda Telegram se pasa escribiéndolo en /tmp/tg_code ; la contraseña de 2 pasos en /tmp/tg_pass.
import { TelegramClient } from "telegram"
import { StringSession } from "telegram/sessions/index.js"
import { NewMessage } from "telegram/events/index.js"
import { Logger } from "telegram/extensions/index.js"
import { mkdirSync, readFileSync, existsSync, writeFileSync, unlinkSync } from "fs"
import { appendMessage } from "./lib/lock.mjs"
import { owner } from "./lib/hub.mjs"

mkdirSync("./data", { recursive: true })
mkdirSync("./auth", { recursive: true })
Logger.setLevel("error") // menos ruido

const sessionFile = "./auth/telegram.session"
const cfgFile = "./auth/telegram-config.json"
const readCfg = () => { try { return JSON.parse(readFileSync(cfgFile, "utf8")) } catch { return {} } }
const hasSession = () => { try { return existsSync(sessionFile) && readFileSync(sessionFile, "utf8").trim().length > 10 } catch { return false } }
const isConfigured = () => { const c = readCfg(); return !!((process.env.TG_API_ID || c.apiId) && (process.env.TG_API_HASH || c.apiHash)) }
// Sin sesión/config todavía (tenant nuevo, no conectaste Telegram): ESPERAR, no crashear. El login self-service (server) escribe
// telegram-config.json + telegram.session; con una sesión válida, client.start() conecta sin volver a pedir código.
let _warned = false
while (!(isConfigured() && hasSession())) {
  if (!_warned) { console.log("[telegram] sin sesión/config — esperando a que conectes Telegram desde la app (Configuración → Agregar conexión → Telegram)…"); _warned = true }
  await new Promise((r) => setTimeout(r, 5000))
}
const cfg = readCfg()
const apiId = parseInt(process.env.TG_API_ID || cfg.apiId || "0")
const apiHash = process.env.TG_API_HASH || cfg.apiHash || ""
const phone = process.env.TG_PHONE || cfg.phone || ""
const saved = readFileSync(sessionFile, "utf8").trim()

async function waitForFile(path, label) {
  console.log(`\n⏳ [telegram] Esperando ${label} — el asistente lo va a escribir en ${path}\n`)
  while (!existsSync(path)) await new Promise((r) => setTimeout(r, 1500))
  const v = readFileSync(path, "utf8").trim()
  try { unlinkSync(path) } catch {}
  return v
}

const client = new TelegramClient(new StringSession(saved), apiId, apiHash, { connectionRetries: 5 })

await client.start({
  phoneNumber: async () => phone,
  phoneCode: async () => await waitForFile("/tmp/tg_code", "el CÓDIGO que te mandó Telegram"),
  password: async () => await waitForFile("/tmp/tg_pass", "tu contraseña de verificación en 2 pasos (si tenés)"),
  onError: (err) => console.log("error:", err?.message || err),
})

writeFileSync(sessionFile, String(client.session.save())) // sesión guardada → no re-login
console.log("\n✅ [telegram] CONECTADO — leyendo mensajes entrantes...\n")

const SINCE = "./auth/telegram-since.json"
let lastTs = existsSync(SINCE) ? (JSON.parse(readFileSync(SINCE, "utf8")).ts || 0) : 0
const saveSince = () => { try { writeFileSync(SINCE, JSON.stringify({ ts: lastTs })) } catch {} }

async function store(msg, { live = true } = {}) {
  if (!msg) return
  const mine = !!msg.out // capturamos también lo que VOS enviás
  let name = mine ? owner() : "?"
  if (!mine) try { const s = await msg.getSender(); name = s?.firstName || s?.username || s?.title || String(msg.senderId || "?") } catch {}
  const text = msg.message || "[media/otro]"
  // id NATIVO estable (chatId:msgId) → sin colisiones de dedup; ts = fecha REAL del mensaje (msg.date en segundos).
  const id = `telegram:${msg.chatId}:${msg.id}`
  const ts = msg.date ? Number(msg.date) * 1000 : Date.now()
  appendMessage({ id, channel: "telegram", account: "tg", jid: String(msg.chatId), name, text, ts, dir: mine ? "out" : "in" })
  if (ts > lastTs) { lastTs = ts; saveSince() }
  if (live) console.log(`${mine ? "➡️ " : "💬"} [telegram] ${name}: ${text.slice(0, 80)}`)
}

// CATCH-UP: recupera lo que llegó mientras el proceso estuvo caído (dedup por id en la DB cubre solapamientos).
async function catchUp() {
  if (!lastTs) { lastTs = Date.now(); saveSince(); return } // primera vez: no bajar todo el historial
  try {
    const dialogs = await client.getDialogs({ limit: 25 })
    let n = 0
    for (const d of dialogs) {
      try { for (const m of await client.getMessages(d.entity, { limit: 30 })) { const ts = m.date ? Number(m.date) * 1000 : 0; if (ts > lastTs) { await store(m, { live: false }); n++ } } } catch {}
    }
    if (n) console.log(`[telegram] catch-up: ${n} mensajes recuperados del downtime`)
  } catch (e) { console.log("[telegram] catch-up err:", e.message) }
}
await catchUp()

client.addEventHandler((event) => store(event.message).catch(() => {}), new NewMessage({ incoming: true, outgoing: true }))

// WATCHDOG: GramJS puede quedar "vivo pero sordo" (agota reintentos sin salir del proceso). Sondeamos cada 2 min;
// si el ping falla, salimos → el daemon reinicia el lector (que reconecta + hace catch-up).
const heartbeat = () => { try { writeFileSync("/tmp/hb_telegram", String(Date.now())) } catch {} } // el reader está vivo → "conectado" aunque no haya mensajes
heartbeat()
setInterval(async () => {
  try { await Promise.race([client.getMe(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000))]); heartbeat() }
  catch (e) { console.error("[telegram] watchdog: sin conexión → reinicio:", e.message); process.exit(1) }
}, 120000)
