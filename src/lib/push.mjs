// Notificaciones push al celular vía Web Push (Service Worker + VAPID). Funciona en Android (browser) y en iPhone 16.4+
// con la PWA agregada a la pantalla de inicio. Sin depender de Firebase/APNs propios.
import webpush from "web-push"
import { readFileSync, writeFileSync, existsSync } from "fs"

let VAPID = existsSync("./data/vapid.json") ? JSON.parse(readFileSync("./data/vapid.json", "utf8")) : null
// AUTO-GEN por tenant: si no hay VAPID, generarlo y persistirlo → las notificaciones push funcionan out-of-box en cada hub nuevo.
if (!VAPID) { try { VAPID = webpush.generateVAPIDKeys(); writeFileSync("./data/vapid.json", JSON.stringify(VAPID, null, 2)); console.log("[push] VAPID auto-generado para este hub") } catch (e) { console.error("[push] no se pudo generar VAPID:", e.message) } }
if (VAPID) webpush.setVapidDetails(process.env.VAPID_MAILTO || "mailto:admin@pipe.app", VAPID.publicKey, VAPID.privateKey)

const SUBS = "./data/push-subs.json"
const load = () => (existsSync(SUBS) ? JSON.parse(readFileSync(SUBS, "utf8")) : [])
const save = (s) => writeFileSync(SUBS, JSON.stringify(s))

export const vapidPublic = () => VAPID?.publicKey || ""
export function subscribe(sub) {
  if (!sub || !sub.endpoint) return { error: "sub inválida" }
  const subs = load()
  if (!subs.find((s) => s.endpoint === sub.endpoint)) { subs.push(sub); save(subs) }
  return { ok: true, count: subs.length }
}
export function unsubscribe(endpoint) { save(load().filter((s) => s.endpoint !== endpoint)); return { ok: true } }
export function subCount() { return load().length }

// manda una notificación a TODOS los dispositivos suscritos. Limpia las suscripciones muertas (410/404).
export async function sendPush({ title, body, url = "/", tag, icon, image, timestamp, count, badge, thread, actions } = {}) {
  if (!VAPID) return { sent: 0, error: "sin VAPID" }
  const subs = load(); if (!subs.length) return { sent: 0 }
  // el SW usa estos campos para notificaciones ricas (foto, hora, badge de no-leídos, acciones/responder)
  const payload = JSON.stringify({ title: title || "pipe", body: body || "", url, tag, icon, image, timestamp, count, badge, thread, actions })
  let sent = 0; const dead = []
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s, payload); sent++ }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint) }
  }))
  if (dead.length) save(load().filter((s) => !dead.includes(s.endpoint)))
  return { sent, pruned: dead.length }
}
