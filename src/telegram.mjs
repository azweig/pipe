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
import { tgRecord } from "./lib/telegram-store.mjs" // misma forma de fila que el importador de historial
import { pullDesde } from "./lib/telegram-pull.mjs"

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

// MODO ENVÍO (para responder desde la app): `node src/telegram.mjs send <chatId> <texto…>` → manda y sale. NO entra al loop de lectura.
if (process.argv.includes("send")) {
  const i = process.argv.indexOf("send"); const peer = process.argv[i + 1] || ""; const msg = process.argv.slice(i + 2).join(" ")
  try { await client.sendMessage(/^-?\d+$/.test(peer) ? BigInt(peer) : peer, { message: msg }); console.log("[telegram] enviado a " + peer) }
  catch (e) { console.error("[telegram] send:", e.message); try { await client.disconnect() } catch {}; process.exit(1) }
  try { await client.disconnect() } catch {}; process.exit(0)
}

console.log("\n✅ [telegram] CONECTADO — leyendo mensajes entrantes...\n")

const SINCE = "./auth/telegram-since.json"
let lastTs = existsSync(SINCE) ? (JSON.parse(readFileSync(SINCE, "utf8")).ts || 0) : 0
const saveSince = () => { try { writeFileSync(SINCE, JSON.stringify({ ts: lastTs })) } catch {} }

async function store(msg, { live = true } = {}) {
  const rec = await tgRecord(msg, owner()) // id NATIVO (chatId:msgId) + ts real — compartido con telegram-backfill
  if (!rec) return
  appendMessage(rec)
  if (rec.ts > lastTs) { lastTs = rec.ts; saveSince() }
  if (live) console.log(`${rec.dir === "out" ? "➡️ " : "💬"} [telegram] ${rec.name}: ${rec.text.slice(0, 80)}`)
}

const pull = (since) => pullDesde({ client, store, since })

// CATCH-UP al arrancar: recupera lo que llegó mientras el proceso estuvo caído (dedup por id en la DB cubre solapamientos).
if (!lastTs) { lastTs = Date.now(); saveSince() } // primera vez: no bajamos todo el historial
else {
  try { const { n } = await pull(lastTs); if (n) console.log(`[telegram] catch-up: ${n} mensajes recuperados del downtime`) }
  catch (e) { console.log("[telegram] catch-up err:", e.message) }
}

client.addEventHandler((event) => store(event.message).catch(() => {}), new NewMessage({ incoming: true, outgoing: true }))

// WATCHDOG. Son dos fallas distintas y hacen falta dos sondas:
//  a) sin conexión → getMe() falla → salimos y el daemon reinicia el lector (reconecta + catch-up).
//  b) "vivo pero sordo": la conexión responde pero GramJS dejó de entregar updates. getMe() NO lo ve — el
//     2026-08-25 estuvo 16 h conectado sin entregar un solo mensaje. Para eso está el pull de respaldo de abajo.
const heartbeat = () => { try { writeFileSync("/tmp/hb_telegram", String(Date.now())) } catch {} } // el reader está vivo → "conectado" aunque no haya mensajes
heartbeat()
setInterval(async () => {
  try { await Promise.race([client.getMe(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000))]); heartbeat() }
  catch (e) { console.error("[telegram] watchdog: sin conexión → reinicio:", e.message); process.exit(1) }
}, 120000)

// PULL DE RESPALDO (caso b): con el stream sano esto no encuentra nada, porque el handler ya guardó y movió lastTs.
// Si encuentra algo, el stream no lo entregó: lo guardamos igual y, si no fue una carrera, reiniciamos para resincronizar.
setInterval(async () => {
  try {
    const { n, masViejo } = await pull(lastTs)
    if (!n) return
    console.log(`[telegram] pull de respaldo: ${n} mensajes que el stream no entregó`)
    if (masViejo > 180000) { console.error("[telegram] stream sordo → reinicio para resincronizar"); process.exit(1) }
  } catch (e) { console.log("[telegram] pull err:", e.message) }
}, 300000)
