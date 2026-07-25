// Mantenimiento periódico que corre DENTRO del proceso del server (misma conexión DB → sin SQLITE_BUSY).
// Lo llama server.mjs en un setInterval. Idempotente y barato.
import { rebuildStats } from "./db.mjs"
// Acceso DIRECTO al handle (excepción marcada al seam): SQL de mantenimiento/reparación admin, in-process (misma conexión del server).
// No se fuerza a named queries por ser reparación puntual; el handle no sale de la capa de datos.
import { handle } from "./db-core.mjs"

// AUTO-SANADO: si thread_stats quedó vacío (race/interrupción de un rebuild) pero hay mensajes → reconstruir.
// Evita que la bandeja aparezca vacía. Corre al arrancar y en el mantenimiento periódico.
export function ensureStats() {
  const d = handle() // acceso admin marcado (ver import)
  const stats = d.prepare("SELECT count(*) c FROM thread_stats").get().c
  if (stats > 0) return false
  const msgs = d.prepare("SELECT count(*) c FROM messages").get().c
  if (msgs < 50) return false
  console.log("[maintenance] thread_stats vacío con", msgs, "mensajes → reconstruyendo…")
  rebuildStats()
  return true
}

// Corrector de HILOS-FANTASMA: mensajes de grupo (grp seteado) que quedaron en un hilo que NO es del grupo
// (DM falso por número, o hilo de persona) → moverlos al hilo real del grupo (@g.us / !room). Recomputa solo lo afectado.
export function fixGroupLeaks() {
  const d = handle() // acceso admin marcado (ver import)
  // 1) limpiar etiquetas grp ESPURIAS: en DMs el reader a veces puso grp = el push-name del contacto ("Alberto (WA)") o "WhatsApp Status Broadcast".
  //    Eso NO es un grupo (los grupos reales no terminan en "(WA)"). Se limpia para que no se confundan con leaks.
  try { d.prepare("UPDATE messages SET grp=NULL WHERE grp IS NOT NULL AND (grp LIKE '%(WA)' OR grp='WhatsApp Status Broadcast' OR grp GLOB '+*(WA)*')").run() } catch {}
  // 2) leaks REALES: mensajes de grupo (grp = nombre de grupo real) en un hilo que no es del grupo → mover al grupo
  const leaks = d.prepare("SELECT DISTINCT thread, grp FROM messages WHERE grp IS NOT NULL AND grp!='' AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE '%@newsletter' AND thread NOT LIKE '%@broadcast' AND thread NOT LIKE '%@thread.v2' AND thread!='self'").all()
  if (!leaks.length) return { moved: 0, threads: 0 }
  const gthreadFor = d.prepare("SELECT thread FROM messages WHERE grp=? AND (thread LIKE '%@g.us' OR thread LIKE 'whatsapp:!%') GROUP BY thread ORDER BY count(*) DESC LIMIT 1")
  const upd = d.prepare("UPDATE messages SET thread=? WHERE thread=? AND grp=?")
  const affected = new Set(); let moved = 0
  for (const { thread, grp } of leaks) {
    const g = gthreadFor.get(grp)?.thread
    if (!g || g === thread) continue
    const r = upd.run(g, thread, grp)
    if (r.changes) { moved += r.changes; affected.add(thread); affected.add(g) }
  }
  const del = d.prepare("DELETE FROM thread_stats WHERE thread=?")
  const rec = d.prepare("INSERT INTO thread_stats(thread,last_ts,count,unread,channels,nsenders) SELECT thread,MAX(ts),COUNT(*),COALESCE(SUM(unread),0),(SELECT GROUP_CONCAT(DISTINCT channel) FROM messages y WHERE y.thread=?),COUNT(DISTINCT CASE WHEN dir='in' THEN name END) FROM messages WHERE thread=? GROUP BY thread")
  for (const t of affected) { del.run(t); rec.run(t, t) }
  if (moved) console.log(`[maintenance] ${moved} mensajes de grupo reubicados (${affected.size} hilos-fantasma limpiados)`)
  return { moved, threads: affected.size }
}
