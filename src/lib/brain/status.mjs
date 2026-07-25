// brain/status — SALUD / MONITOREO (reads primitivos que alimentan /api/status y el health-check): salud por canal,
// lag de ingesta, última actividad por cuenta, ts del último mensaje. No es inbox ni composición-home → módulo propio.
import { readFileSync } from "fs"
import { tailJsonl } from "../jsonl.mjs"
import { channelActivityStats, channelAccountActivity, maxMessageTs, recentIngestByChannel, channelTotals } from "../db.mjs"

// SYNC STATUS: canales bajando su carga inicial AHORA (ráfaga de ingesta reciente = primera sync/backfill en curso). Alimenta el sync bar del front.
const SYNC_LABEL = { whatsapp: "WhatsApp", email: "Correo", telegram: "Telegram", teams: "Teams", instagram: "Instagram", facebook: "Messenger", discord: "Discord", notion: "Notion", calendar: "Calendar" }
export function syncStatus() {
  let rows = []
  try { rows = recentIngestByChannel(Date.now() - 120000) } catch {}
  const active = rows.filter((r) => r.n >= 3)
  if (!active.length) return { syncing: [] }
  let totals = {}
  try { for (const t of channelTotals(active.map((r) => r.channel))) totals[t.channel] = t.n } catch {}
  const syncing = active.map((r) => ({ channel: r.channel, label: SYNC_LABEL[r.channel] || r.channel, count: totals[r.channel] || r.n, rate: r.n }))
  return { syncing }
}

// SALUD POR CANAL: detecta si un canal dejó de recibir mensajes (fallo silencioso del reader/bridge).
// Umbral ADAPTATIVO por cadencia: un canal muy activo (WhatsApp) se marca stale a las horas; uno de baja
// frecuencia (Notion) tolera días. Solo se consideran canales con actividad real en los últimos 30d.
export function channelHealth() {
  const now = Date.now(), H = 3600e3, d30 = now - 30 * 86400e3, d7 = now - 7 * 86400e3
  const minH = +process.env.COMMS_HEARTBEAT_MIN_H || 8
  const rows = channelActivityStats(d30, d7)
  // reader vivo (heartbeat fresco <10min) → el canal está CONECTADO aunque no llegue nada (ej: Teams quieto el finde no es "desconectado")
  const hbFresh = (ch) => { try { return Date.now() - Number(readFileSync(`/tmp/hb_${ch}`, "utf8")) < 10 * 60000 } catch { return false } }
  const out = rows.map((r) => {
    const ageH = (now - r.last) / H
    const active = r.n30 >= 5                       // sin actividad reciente no tiene sentido alertar
    const typicalGapH = r.n30 > 0 ? (30 * 24) / r.n30 : Infinity
    const threshold = Math.max(minH, 3 * typicalGapH) // 3× la cadencia típica, con piso
    return { channel: r.channel, lastTs: r.last, ageH: Math.round(ageH * 10) / 10, n7: r.n7, n30: r.n30, thresholdH: Math.round(threshold), stale: active && ageH > threshold && !hbFresh(r.channel) }
  }).sort((a, b) => b.n30 - a.n30)
  return { ok: !out.some((c) => c.stale), channels: out, stale: out.filter((c) => c.stale) }
}

// LAG DE INGESTA: compara lo capturado (jsonl) vs lo consultable (DB). Si el jsonl tiene mensajes MUCHO más
// nuevos que la DB, la ingesta está trabada (capturamos pero no ingerimos → la bandeja se congela). Caza rápido
// el fallo que el heartbeat por canal tardaba 8h en notar.
export function ingestLag() {
  let jsonlTs = 0
  try { for (const r of tailJsonl("./data/messages.jsonl", 400 * 1024)) if ((r.ts || 0) > jsonlTs) jsonlTs = r.ts } catch {}
  const dbTs = maxMessageTs(0)
  const lagSec = jsonlTs && dbTs ? Math.max(0, Math.round((jsonlTs - dbTs) / 1000)) : 0
  return { jsonlTs, dbTs, lagSec, stuck: lagSec > 600 } // >10 min de diferencia = ingesta trabada
}

// última actividad (ts) por canal+cuenta, desde la DB — para el panel de integraciones (/api/status, /link).
export function channelAccountLast() {
  return channelAccountActivity()
}

// ts del mensaje más nuevo (para el health check / monitoreo de ingesta por tenant)
export function lastMessageTs() { try { return maxMessageTs(0) } catch { return 0 } }
