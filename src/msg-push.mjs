// Push de MENSAJES NUEVOS al celu cuando la app está cerrada. Corre en el daemon cada ~2 min.
// Solo DMs (no grupos/newsletters/broadcast), throttle 1 push por hilo cada 10 min, tope por corrida. Uso: node src/msg-push.mjs
import { readFileSync, writeFileSync, existsSync } from "fs"
import { tz } from "./lib/hub.mjs"
import { inbound1to1Since, totalUnread as getTotalUnread } from "./lib/db.mjs"
import { threadIsSpam } from "./lib/spam.mjs"
import { secretThreadKeys, secretUnread, isSecretMsg } from "./lib/secret.mjs"

const F = "./data/msg-push-state.json"
const NOW = Date.now()
const st = existsSync(F) ? JSON.parse(readFileSync(F, "utf8")) : { lastTs: 0, byThread: {} }
const since = st.lastTs || NOW - 5 * 60000
const THROTTLE = 10 * 60000, MAX = 6

// mensajes entrantes nuevos, SOLO de conversaciones 1:1 (excluye grupos/canales/spam)
// 🔒 POR-MENSAJE: nunca notificar un mensaje de un número/cuenta secreto (aunque el hilo sea parcial, el preview delataría)
const rows = inbound1to1Since(since).filter((r) => !isSecretMsg(r))

const maxTs = rows.reduce((m, r) => Math.max(m, r.ts || 0), st.lastTs || 0)
// agrupar por hilo → contar + último texto
const byThread = new Map()
for (const r of rows) {
  const t = (r.text || "").trim(); if (t.length < 2) continue
  const cur = byThread.get(r.thread) || { name: r.name || "", count: 0, last: "", ts: 0, jid: "" }
  cur.count++; cur.last = t; cur.name = r.name || cur.name; cur.ts = r.ts; cur.jid = r.jid || cur.jid
  byThread.set(r.thread, cur)
}

// preferencias de notificación: horas de silencio (DND) + hilos muteados
const prefs = existsSync("./data/notif-prefs.json") ? JSON.parse(readFileSync("./data/notif-prefs.json", "utf8")) : {}
const limaHour = +new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: tz() }).slice(0, 2)
const inQuiet = (() => { const s = prefs.quietStart, e = prefs.quietEnd; if (s == null || e == null || s === e) return false; return s < e ? (limaHour >= s && limaHour < e) : (limaHour >= s || limaHour < e) })()
const muted = new Set(prefs.mutedThreads || [])
// avatar del remitente (foto) + total de no-leídos para el badge del ícono
const avatars = existsSync("./data/avatars.json") ? JSON.parse(readFileSync("./data/avatars.json", "utf8")) : {}
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s*\(wa\)$/, "").trim()
const secretKeys = secretThreadKeys()                     // 🔒 hilos de cuentas secretas → NUNCA notificar ni contar (el preview delataría)
const totalUnread = Math.max(0, getTotalUnread() - secretUnread())

const toPush = []
for (const [thread, m] of byThread) {
  if (secretKeys.has(thread)) continue // 🔒 cuenta secreta → sin push (aunque el server esté "bloqueado", el mensaje NO se anuncia)
  if (NOW - (st.byThread[thread] || 0) < THROTTLE) continue // ya avisé de este hilo hace poco
  if (muted.has(thread)) continue // hilo silenciado por el usuario
  if (threadIsSpam(thread, m.jid, m.name, m.last)) continue // NO notificar spam (estructural o veredicto LLM), salvo des-marcado
  toPush.push({ thread, ...m })
}
toPush.sort((a, b) => b.ts - a.ts)

if (inQuiet) {
  console.log(`[msg-push] hora de silencio (${limaHour}h Lima) → no molesto; ${toPush.length} hilo(s) esperan`)
} else if (toPush.length) {
  const push = await import("./lib/push.mjs")
  for (const m of toPush.slice(0, MAX)) {
    const fullName = (m.name || "Alguien").replace(/\s*\(WA\)$/, "")
    const name = fullName.split(" ")[0]
    const preview = m.last.replace(/\s+/g, " ").slice(0, 90)
    const isCall = /^📞/.test(m.last || "") // llamada de WhatsApp entrante/perdida
    const body = isCall ? preview : (m.count > 1 ? `${m.count} mensajes · "${preview}"` : preview)
    const icon = avatars[norm(fullName)] || avatars[norm(name)] || undefined
    await push.sendPush({ title: `${isCall ? "📞" : "💬"} ${name}`, body, url: "/#conv/" + encodeURIComponent(m.thread), tag: "msg:" + m.thread, thread: m.thread, icon, timestamp: m.ts, count: m.count, badge: totalUnread })
    st.byThread[m.thread] = NOW
  }
  console.log(`[msg-push] ${Math.min(toPush.length, MAX)} hilo(s) notificado(s) (de ${byThread.size} con mensajes)`)
} else {
  console.log(`[msg-push] ${byThread.size} hilos con mensajes, ninguno para notificar (throttle)`)
}
st.lastTs = maxTs
writeFileSync(F, JSON.stringify(st))
