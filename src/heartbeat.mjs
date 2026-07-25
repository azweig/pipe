// Heartbeat: detecta canales que dejaron de recibir mensajes (fallo silencioso del reader/bridge) y avisa por push.
// Lo corre el daemon cada hora. Dedup: no re-alerta el mismo canal en <20h. Uso manual: node src/heartbeat.mjs
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs"
import { channelHealth, ingestLag } from "./lib/brain.mjs"
import { storageStatus } from "./lib/quota.mjs"

const F = "./data/health-alert.json"
const NOW = Date.now()
// parse DEFENSIVO: el archivo se escribía no-atómicamente → un crash a mitad lo dejaba corrupto → este parse tiraba en el top-level
// y TODO el alerting quedaba muerto en silencio (el bug que el heartbeat existe para detectar). Ante JSON inválido reseteamos el estado.
let state = {}
try { if (existsSync(F)) state = JSON.parse(readFileSync(F, "utf8")) } catch (e) { console.error("[heartbeat] health-alert.json corrupto → reset:", e.message) }
const save = (s) => { const t = F + ".tmp"; writeFileSync(t, JSON.stringify(s)); renameSync(t, F) } // escritura ATÓMICA (tmp+rename): nunca deja el archivo a medias

const { stale, channels } = channelHealth()
const fresh = stale.filter((c) => NOW - (state[c.channel] || 0) > 20 * 3600e3) // no spamear: 1 alerta por canal cada 20h

// ingesta trabada: capturamos mensajes pero no entran a la DB (la bandeja se congela). Alerta aparte, más urgente.
const ing = ingestLag()
if (ing.stuck && NOW - (state.__ingest || 0) > 2 * 3600e3) {
  try {
    const push = await import("./lib/push.mjs")
    await push.sendPush({ title: "⚠️ Ingesta trabada", body: `Capturamos mensajes pero no entran a la bandeja (lag ${Math.round(ing.lagSec / 60)} min)`, url: "/", tag: "ingest-stuck" })
    state.__ingest = NOW; save(state)
    console.log(`heartbeat: INGESTA TRABADA lag=${ing.lagSec}s → push`)
  } catch (e) { console.error("heartbeat ingest push err:", e.message) }
}

// WhatsApp: SESIÓN CAÍDA (deslogueada del lado de Meta / BAD_CREDENTIALS). El número sigue recibiendo lo que se sincronizó, pero
// NO puede ENVIAR. El chequeo de "silencio" no lo agarra (siguen entrando mensajes viejos). Lo detectamos acá cada hora: un número
// que DEBERÍA estar vinculado (hub-config) ya no tiene sesión whatsmeow activa → avisamos "revinculá X" (no en 12h del self-test).
const MAUTRIX_WA_DB = process.env.MAUTRIX_WA_DB || "/opt/matrix/bridges/whatsapp/mautrix-whatsapp.db"
try {
  const { myNumbers } = await import("./lib/hub.mjs")
  const expected = myNumbers().map((n) => String(n).replace(/[^\d]/g, "")).filter((n) => n.length >= 8)
  if (expected.length && existsSync(MAUTRIX_WA_DB)) {
    const Database = (await import("better-sqlite3")).default
    const db = new Database(MAUTRIX_WA_DB, { readonly: true })
    const linked = db.prepare("SELECT id FROM user_login").all().length // el bridge ya tiene logins (evita alertar en setup inicial)
    const active = new Set(db.prepare("SELECT jid FROM whatsmeow_device").all().map((r) => String(r.jid).split(/[:@]/)[0])) // números con sesión VIVA
    db.close()
    if (linked) {
      const down = expected.filter((n) => !active.has(n))
      const downFresh = down.filter((n) => NOW - (state["wa:" + n] || 0) > 20 * 3600e3)
      if (downFresh.length) {
        const push = await import("./lib/push.mjs")
        const r = await push.sendPush({ title: "⚠️ WhatsApp desconectado", body: `Revinculá en /link: ${downFresh.join(", ")}. Reciben pero no pueden enviar.`, url: "/link", tag: "wa-loggedout" })
        console.log(`heartbeat: WhatsApp caído (${downFresh.join(", ")}) → push a ${r.sent}`)
        for (const n of downFresh) state["wa:" + n] = NOW
        save(state)
      } else console.log(`heartbeat WA: ${expected.length} número(s) esperados, ${active.size} con sesión viva — OK`)
    }
  }
} catch (e) { console.error("heartbeat WA check err:", e.message) }

// ALMACENAMIENTO cerca/al límite del plan (managed): avisar al 80% y cuando llenó (ahí se deja de guardar media pesada). Dedup 20h.
const store = storageStatus()
if (store.warn && NOW - (state.__storage || 0) > 20 * 3600e3) {
  try {
    const push = await import("./lib/push.mjs")
    await push.sendPush(store.over
      ? { title: "⚠️ Almacenamiento lleno", body: "Llegaste al límite de tu plan — dejamos de guardar fotos/videos nuevos. Subí de plan o liberá espacio en la papelera.", url: "/", tag: "storage" }
      : { title: `📦 Almacenamiento al ${store.pct}%`, body: "Estás cerca del límite de tu plan.", url: "/", tag: "storage" })
    state.__storage = NOW; save(state)
    console.log(`heartbeat: almacenamiento ${store.pct}% (${store.over ? "LLENO" : "warn"}) → push`)
  } catch (e) { console.error("heartbeat storage push err:", e.message) }
}

if (fresh.length) {
  const body = fresh.map((c) => `${c.channel}: sin mensajes hace ${Math.round(c.ageH)}h`).join(" · ")
  try {
    const push = await import("./lib/push.mjs")
    const r = await push.sendPush({ title: "⚠️ Canal en silencio", body, url: "/", tag: "heartbeat" })
    console.log(`heartbeat: ${fresh.length} canal(es) stale → push a ${r.sent} dispositivo(s): ${body}`)
    for (const c of fresh) state[c.channel] = NOW
    save(state)
  } catch (e) { console.error("heartbeat push err:", e.message) }
} else {
  console.log(`heartbeat OK — ${channels.map((c) => `${c.channel} ${Math.round(c.ageH)}h/${c.thresholdH}h`).join(", ")}`)
}
