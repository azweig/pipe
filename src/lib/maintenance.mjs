// Mantenimiento periódico que corre DENTRO del proceso del server (misma conexión DB → sin SQLITE_BUSY).
// Lo llama server.mjs en un setInterval. Idempotente y barato.
import { rebuildStats } from "./db.mjs"
// Acceso DIRECTO al handle (excepción marcada al seam): SQL de mantenimiento/reparación admin, in-process (misma conexión del server).
// No se fuerza a named queries por ser reparación puntual; el handle no sale de la capa de datos.
import { handle, withRetry } from "./db-core.mjs"

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
// HISTORIAS QUE SE VOLVIERON "CONVERSACIONES". Si una historia se archiva mal (la base del bridge estaba trabada
// y no se pudo confirmar que la sala era la de estados), queda un hilo falso con el nombre de quien publicó: en la
// bandeja parece una conversación y adentro tiene una historia en vez de los mensajes de esa persona.
//
// La firma es inequívoca y no depende de ningún nombre: un mensaje cuyo `jid` es una sala de estados pero cuyo hilo
// NO es el de historias. Se corrige solo, en cada arranque, sin listas de contactos ni casos particulares.
// OJO: hay una sala de estados POR NÚMERO vinculado — recorrerlas todas, mirar solo la primera no encuentra nada.
export function repararHistorias() {
  const d = handle()
  let movidos = 0
  try {
    const salas = d.prepare("SELECT DISTINCT jid FROM messages WHERE thread='whatsapp:status@broadcast' AND jid LIKE '!%'").all().map((r) => r.jid)
    for (const jid of salas) {
      const sueltos = d.prepare("SELECT DISTINCT thread FROM messages WHERE jid=? AND thread<>'whatsapp:status@broadcast'").all(jid).map((r) => r.thread)
      if (!sueltos.length) continue
      withRetry(() => d.transaction(() => {
        for (const t of sueltos) {
          movidos += d.prepare("UPDATE messages SET thread='whatsapp:status@broadcast' WHERE jid=? AND thread=?").run(jid, t).changes
          d.prepare("DELETE FROM thread_stats WHERE thread=?").run(t) // el hilo falso desaparece de la bandeja
        }
      }).immediate())
    }
    if (movidos) console.log(`🧹 historias: ${movidos} mensajes devueltos a "Historias de WhatsApp" (estaban como conversaciones falsas)`)
  } catch (e) { console.error("[maintenance] repararHistorias:", e.message) }
  return movidos
}

// LOS MENSAJES DEL AUTO-TEST NO SON CORRESPONDENCIA. El test de envío se manda a vos mismo cada 12 h para detectar
// que un canal dejó de enviar; una vez comprobado, su resultado vive en meta['selftest'] y el mensaje en sí no
// aporta nada — pero se quedaba en la bandeja como si fuera un correo de verdad. Había 391 acumulados.
//
// Se borran los que ya pasaron su ventana de verificación (10 min): tiempo de sobra para que el lector los vea y
// confirme la entrega, y suficiente para que no te los cruces en la bandeja.
// Sin el nombre del producto adentro: los mensajes viejos decían "comms-hub self-test" y los nuevos "pipe
// self-test". Atarse al nombre dejó 108 sin borrar en la primera pasada.
const FIRMAS = ["🔧 % self-test %", "Auto-test de envío de %", "Re: % self-test —%", "%- self-test — Auto-test%"]
export function purgeSelfTest(ventanaMs = 10 * 60000) {
  const d = handle()
  const corte = Date.now() - ventanaMs
  let n = 0
  try {
    withRetry(() => d.transaction(() => {
      for (const f of FIRMAS) {
        n += d.prepare("DELETE FROM messages WHERE ts < ? AND (text LIKE ? OR body LIKE ?)").run(corte, f, f).changes
      }
    }).immediate())
    if (n) {
      console.log(`🧹 auto-test: ${n} mensajes de prueba borrados de la bandeja`)
      try { rebuildStats() } catch (e) { console.error("[maintenance] stats tras purgar selftest:", e.message) } // si no, el hilo sigue mostrando la prueba como último mensaje
    }
  } catch (e) { console.error("[maintenance] purgeSelfTest:", e.message) }
  return n
}

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
