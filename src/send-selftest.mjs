// AUTO-TEST DE ENVÍO por canal. Cada ~12h manda un mensaje de prueba a VOS MISMO (de tu celu a tu celu / a tu propio correo)
// y verifica que salió DE VERDAD — no solo que Matrix/SMTP lo aceptó (que es lo que engaña: el bridge puede aceptar el evento
// y NO entregarlo a WhatsApp si el login está caído). Si un canal está roto, avisa por push. Guarda el último resultado en
// meta['selftest'] → la app lo muestra. Uso: node src/send-selftest.mjs
import { existsSync } from "fs"
import { getMeta, setMeta } from "./lib/db.mjs"
import { myNumbers, myEmails } from "./lib/hub.mjs"
import { startWhatsAppChat, sendMatrix } from "./matrix.mjs"
import { sendEmailReply } from "./lib/mailer.mjs"

const MAUTRIX_WA_DB = process.env.MAUTRIX_WA_DB || "/opt/matrix/bridges/whatsapp/mautrix-whatsapp.db"
const CHANNELS = (process.env.SELFTEST_CHANNELS || "whatsapp,email").split(",").map((s) => s.trim()).filter(Boolean)

// VERIFICACIÓN REAL de WhatsApp: el bridge solo crea una fila en `message` (mxid → id de WhatsApp) cuando whatsmeow
// transmitió el mensaje a los servidores de WhatsApp. Si Matrix aceptó pero el login está caído, esa fila NO aparece.
async function bridgeDelivered(eventId, { tries = 10, waitMs = 1500 } = {}) {
  if (!eventId || !existsSync(MAUTRIX_WA_DB)) return null // null = no verificable (otro deploy / sin acceso a la DB del bridge)
  const Database = (await import("better-sqlite3")).default
  for (let i = 0; i < tries; i++) {
    try {
      const db = new Database(MAUTRIX_WA_DB, { readonly: true })
      const row = db.prepare("SELECT id FROM message WHERE mxid=? LIMIT 1").get(eventId)
      db.close()
      if (row?.id) return true
    } catch {}
    await new Promise((r) => setTimeout(r, waitMs))
  }
  return false
}

// qué número (login) es dueño de la sala portal → para decir cuál revincular cuando el envío falla ("login caído").
async function portalReceiver(mxid) {
  if (!mxid || !existsSync(MAUTRIX_WA_DB)) return ""
  try {
    const Database = (await import("better-sqlite3")).default
    const db = new Database(MAUTRIX_WA_DB, { readonly: true })
    const row = db.prepare("SELECT receiver FROM portal WHERE mxid=? LIMIT 1").get(mxid)
    db.close()
    return row?.receiver || ""
  } catch { return "" }
}

async function testWhatsApp(token) {
  const num = String(process.env.SELFTEST_WA_NUMBER || myNumbers()[0] || "").replace(/[^\d]/g, "")
  if (!num) return { channel: "whatsapp", ok: false, detail: "sin número propio configurado (myNumbers)" }
  let room
  try { room = await startWhatsAppChat(num) } catch (e) { return { channel: "whatsapp", ok: false, detail: "no se pudo abrir el chat propio: " + e.message } }
  if (!room) return { channel: "whatsapp", ok: false, detail: "el bridge no abrió el portal a tu número (¿login caído?)" }
  const r = await sendMatrix(room, `🔧 pipe self-test ${token}`)
  if (!r.ok) return { channel: "whatsapp", ok: false, detail: "Matrix rechazó el envío" }
  const delivered = await bridgeDelivered(r.event)
  if (delivered === false) {
    const recv = await portalReceiver(room)
    return { channel: "whatsapp", ok: false, detail: `el bridge NO entregó a WhatsApp — el número ${recv || "?"} está deslogueado, revinculalo en /link` }
  }
  return { channel: "whatsapp", ok: true, verified: delivered === true, detail: delivered === true ? "entregado a WhatsApp ✓" : "enviado (entrega no verificable acá)" }
}

async function testEmail(token) {
  const to = String(process.env.SELFTEST_EMAIL || myEmails().find((e) => /gmail/i.test(e)) || myEmails()[0] || "").trim()
  if (!to) return { channel: "email", ok: false, detail: "sin correo propio configurado (myEmails)" }
  const r = await sendEmailReply(to, `Auto-test de envío de pipe. Token ${token}. Si ves esto, el envío por email funciona.`, { subject: "pipe self-test" })
  return r.error ? { channel: "email", ok: false, detail: r.error } : { channel: "email", ok: true, verified: true, detail: "SMTP aceptó ✓ → " + (r.from || to) }
}

const TESTERS = { whatsapp: testWhatsApp, email: testEmail }

// corre los canales pedidos (o los de CHANNELS), guarda el resultado y avisa por push si algo falló. Reutilizable (cron + endpoint).
export async function runSelfTest(channels = CHANNELS) {
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const results = []
  for (const ch of channels) {
    const fn = TESTERS[ch]
    if (!fn) { results.push({ channel: ch, ok: false, detail: "canal sin test de envío definido" }); continue }
    try { results.push(await fn(token)) } catch (e) { results.push({ channel: ch, ok: false, detail: "excepción: " + (e?.message || e) }) }
  }
  const out = { ts: Date.now(), token, results }
  try { setMeta("selftest", JSON.stringify(out)) } catch {}
  for (const r of results) console.log(`[selftest] ${r.channel}: ${r.ok ? "OK" : "FALLO"} — ${r.detail}`)

  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    try {
      const { sendPush } = await import("./lib/push.mjs")
      await sendPush({
        title: "⚠️ Envío caído",
        body: failed.map((r) => `${r.channel}: ${r.detail}`).join(" · "),
        url: "/#config", tag: "selftest-fail",
      })
    } catch (e) { console.error("[selftest] no se pudo pushear el fallo:", e?.message) }
  }
  return out
}

export function lastSelfTest() { try { return JSON.parse(getMeta("selftest") || "null") } catch { return null } }

// solo corre como CLI (importar el módulo para el endpoint NO dispara el test)
if (process.argv[1] && process.argv[1].endsWith("send-selftest.mjs")) runSelfTest().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
