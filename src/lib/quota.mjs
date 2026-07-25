// Quota de almacenamiento por hub, atada al PLAN (managed). Límite = hub-config.storageGB (o env STORAGE_LIMIT_GB); 0 = ilimitado (self-host).
// Uso = CAS (la media, lo que pesa) + messages.db. Al 80% se avisa (heartbeat); al 100% se deja de guardar media PESADA nueva
// (el audio siempre entra) → el hub sigue recibiendo texto/voz/mensajes, solo frena fotos/videos/docs. Upsell natural: "subí de plan".
import { statSync, existsSync, readdirSync } from "fs"
import { casStats } from "./cas.mjs"
import { hubConfig } from "./hub.mjs"

const GB = 1073741824
const DB_PATH = process.env.MESSAGES_DB || "./data/messages.db"
const JSONL = "./data/messages.jsonl"
const dirBytes = (d) => { try { return readdirSync(d).reduce((a, f) => { try { return a + statSync(d + "/" + f).size } catch { return a } }, 0) } catch { return 0 } }

function limitBytes() {
  const gb = +process.env.STORAGE_LIMIT_GB || +(hubConfig().storageGB || 0)
  return gb > 0 ? gb * GB : 0 // 0 = sin límite (self-host); managed setea el GB del plan (Starter 25 / Plus 100 / Pro 500)
}

let _cache = null, _at = 0
// estado cacheado 60s: casStats parsea el índice del CAS → no leerlo en cada mensaje entrante.
export function storageStatus() {
  const now = Date.now()
  if (_cache && now - _at < 60000) return _cache
  const limit = limitBytes()
  // best-effort para billing/aviso: media (CAS) + DB + el log crudo jsonl (puede ser decenas de GB) + los bundles de backup locales.
  // NO es el límite DURO — la protección real de la FS compartida es quota XFS/ZFS por tenant (a nivel kernel).
  let used = 0
  try { used += casStats().bytes || 0 } catch {}
  try { if (existsSync(DB_PATH)) used += statSync(DB_PATH).size } catch {}
  try { if (existsSync(JSONL)) used += statSync(JSONL).size } catch {}
  used += dirBytes("./data/backups")
  const pct = limit ? Math.round((used / limit) * 100) : 0
  _cache = { used, limit, pct, unlimited: !limit, warn: !!limit && pct >= 80, over: !!limit && used >= limit }
  _at = now
  return _cache
}
// ¿pasó el límite del plan? → el gate de media deja de guardar lo pesado nuevo (soft-enforce, tolerancia de ~60s por el cache).
export function storageOverQuota() { return storageStatus().over }
