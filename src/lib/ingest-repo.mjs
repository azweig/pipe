// ingest-repo — camino de escritura: insertar mensajes, upsert de thread_stats, rebuilds.
// El handle llega como `db` (alias de handle() de db-core) → los cuerpos se mueven verbatim desde db.mjs.
import { handle as db, withRetry } from "./db-core.mjs"
import { owner } from "./hub.mjs"
import { normalizarHiloPropio } from "./thread.mjs"
import { casTrash, casRestore } from "./cas.mjs"

// ── ingest ──
const insertStmt = () => db().prepare(`INSERT OR IGNORE INTO messages
  (id, channel, account, thread, jid, sender, name, text, ts, dir, grp, media, mediaType, filename, unread, body, attachments, tag)
  VALUES (@id, @channel, @account, @thread, @jid, @sender, @name, @text, @ts, @dir, @grp, @media, @mediaType, @filename, @unread, @body, @attachments, @tag)`)

const getStat = () => db().prepare("SELECT channels FROM thread_stats WHERE thread=?")
const upsertStat = () => db().prepare(`INSERT INTO thread_stats(thread,last_ts,count,unread,channels) VALUES(@thread,@ts,1,@unread,@channels)
  ON CONFLICT(thread) DO UPDATE SET count=count+1, unread=unread+@unread, last_ts=MAX(last_ts,@ts), channels=@channels`)
export function insertMany(records) {
  const stmt = insertStmt(), stat = upsertStat(), gs = getStat()
  const bodyUpd = db().prepare("UPDATE messages SET body=? WHERE id=? AND (body IS NULL OR body='')") // backfill body en emails ya existentes
  const tx = db().transaction((rows) => {
    let n = 0
    for (const r of rows) {
      const rec = normalizeRec(r); const info = stmt.run(rec)
      if (info.changes) { n++
        if (rec.thread && rec.thread !== "spam:status") {
          const cur = gs.get(rec.thread)?.channels || ""
          const set = new Set(cur ? cur.split(",") : []); set.add(rec.channel)
          stat.run({ thread: rec.thread, ts: rec.ts, unread: rec.unread, channels: [...set].join(",") })
        }
      } else if (rec.body) bodyUpd.run(rec.body, rec.id) // fila existente sin body → rellenar (re-ingesta de emails viejos con cuerpo)
    }
    return n
  })
  // withRetry: el ingest es el writer MÁS caliente y no estaba cubierto (la promesa de "un solo lugar para todas las writes" era parcial:
  // solo meta-repo lo usaba). Un SQLITE_BUSY acá tiraba el batch ENTERO → mensajes perdidos. Ahora reintenta con backoff.
  return withRetry(() => tx(records))
}
// inserta un mensaje ENVIADO por mí (dir:out) directo en el hilo dado (sin pasar por computeThread). Para el compositor.
export function insertSent(thread, channel, text, extra = {}) {
  // escribirte a vos mismo es una NOTA, no una conversación: si la clave apunta a una línea tuya, va a "Mis Notas"
  thread = normalizarHiloPropio(thread)
  const ts = Date.now(), id = `sent:${channel}:${ts}:${Math.random().toString(36).slice(2, 8)}`
  // withRetry + tx ATÓMICA: el mensaje YA salió por el cable; un SQLITE_BUSY acá lo dejaba entregado pero AUSENTE en la DB → reenvío = duplicado del lado del contacto.
  // .immediate: sin esto la transacción arranca DIFERIDA y al subir a escritura SQLite devuelve SQLITE_BUSY_SNAPSHOT,
  // que NO se resuelve esperando (el busy_timeout no aplica) → el reintento de arriba pagaba de más y a veces perdía.
  return withRetry(() => db().transaction(() => {
    insertStmt().run(normalizeRec({ id, channel, account: "sent", thread, jid: "", sender: "me", name: owner(), text, ts, dir: "out", unread: 0, media: extra.media || null, mediaType: extra.mediaType || null, filename: extra.filename || null, tag: extra.tag || null }))
    db().prepare("UPDATE thread_stats SET count=count+1, last_ts=MAX(last_ts,?) WHERE thread=?").run(ts, thread)
    return { id, ts, media: extra.media || null, mediaType: extra.mediaType || null }
  }).immediate())
}
// reconstruye thread_stats desde cero (después de un import masivo).
// ATÓMICO: DELETE+INSERT en UNA transacción. Si el proceso muere en el medio → rollback → conserva los datos
// viejos (antes eran 2 exec sueltos: morir entre el DELETE y el INSERT dejaba la bandeja VACÍA — incidente recurrente).
export function rebuildStats() {
  const D = db()
  D.transaction(() => {
    D.exec("DELETE FROM thread_stats")
    D.exec(`INSERT INTO thread_stats(thread,last_ts,count,unread,channels,nsenders)
      SELECT thread, MAX(ts), COUNT(*), COALESCE(SUM(unread),0),
        GROUP_CONCAT(DISTINCT channel),
        COUNT(DISTINCT CASE WHEN dir='in' THEN name END)
      FROM messages WHERE thread!='' AND thread!='spam:status' GROUP BY thread`)
    // el GROUP_CONCAT va en el MISMO GROUP BY: antes era una subconsulta correlacionada que re-escaneaba messages
    // una vez por hilo (3517 hilos × 1.9M filas). Mismo resultado exacto, verificado fila por fila, 30% más rápido
    // — y son 30% menos de write-lock, que es lo que estaba tirando abajo a los demás jobs.
  })()
  return D.prepare("SELECT COUNT(*) c FROM thread_stats").get().c
}
function normalizeRec(r) {
  return {
    id: r.id || `${r.channel}:${r.ts}:${(r.name || "").slice(0, 12)}`,
    channel: r.channel || "", account: r.account || "", thread: r.thread || "", jid: r.jid || "",
    sender: r.sender || "", name: r.name || "", text: r.text || "", ts: r.ts || 0, dir: r.dir || "in",
    grp: r.grp || r.group || null, media: r.media || null, mediaType: r.mediaType || null, filename: r.filename || null, unread: r.unread ? 1 : 0,
    body: r.body || null, // cuerpo completo del email (HTML) para el visor
    attachments: r.attachments || null, // JSON [{name,cas,mime,size}] de adjuntos de email
    tag: r.tag || null, // clase del mensaje cuando no es una conversación normal (hoy: "historia")
  }
}

// ── escrituras de enriquecimiento absorbidas en Wave 3 (UPDATE de contenido de un mensaje) ──
// linkea el video descargado a un mensaje, SOLO si aún no tenía media. Devuelve el info (.changes). (era video-fetch)
export function setVideoMedia(id, media) {
  return db().prepare("UPDATE messages SET media = ?, mediaType = 'video' WHERE id = ? AND media IS NULL").run(media, id)
}
// guarda el resumen (STT) de un audio. (era audio-summarize)
export function setMessageSummary(id, summary) {
  return db().prepare("UPDATE messages SET summary=? WHERE id=?").run(summary, id)
}
// actualiza texto/cuerpo/resumen de un mensaje (transcripción de reunión). Faltantes → null (como el original). (era meetings.updateMeeting)
export function updateMessageContent(id, { text, body, summary } = {}) {
  return db().prepare("UPDATE messages SET text=?, body=?, summary=? WHERE id=?").run(text, body || null, summary || null, id)
}
// backfill: vincula media a mensajes que aún no la tienen, en UNA transacción. Devuelve #cambios. (era relink-media)
export function linkMediaBatch(pairs = []) {
  const D = db(); const upd = D.prepare("UPDATE messages SET media=? WHERE id=? AND media IS NULL")
  let n = 0; const tx = D.transaction(() => { for (const [id, url] of pairs) n += upd.run(url, id).changes })
  tx(); return n
}
// inserta el digest de un feed social (mensaje entrante + upsert de thread_stats) ATÓMICO. (era brain.ingestSocial)
export function insertSocialDigest({ id, network, thread, name, digest, ts }) {
  const D = db()
  const tx = D.transaction(() => {
    D.prepare("INSERT OR IGNORE INTO messages (id, channel, account, thread, jid, sender, name, text, ts, dir, unread) VALUES (?,?,?,?,?,?,?,?,?,?,1)")
      .run(id, network, "feed", thread, "", network, name, digest, ts, "in")
    D.prepare("INSERT INTO thread_stats(thread,last_ts,count,unread,channels) VALUES(?,?,1,1,?) ON CONFLICT(thread) DO UPDATE SET count=count+1, last_ts=excluded.last_ts, unread=unread+1")
      .run(thread, ts, network)
  })
  tx()
}

// LIBERAR ESPACIO: borra la media PESADA (no audio) ya guardada de un chat (threadKey), o de TODA la cuenta (threadKey=null).
// Deja el mensaje con placeholder "(borrada)". El blob del CAS se borra SOLO si ningún mensaje lo sigue referenciando (dedup-safe).
export function freeThreadMedia(threadKey = null) {
  const where = threadKey ? "thread = @t AND " : ""
  const rows = db().prepare(`SELECT id, media FROM messages WHERE ${where}media IS NOT NULL AND media LIKE '/cas/%' AND (mediaType IS NULL OR mediaType != 'audio')`).all(threadKey ? { t: threadKey } : {})
  if (!rows.length) return { count: 0, trashed: 0 }
  const upd = db().prepare("UPDATE messages SET media=NULL, text=CASE WHEN (text LIKE '🖼%' OR text LIKE '📹%' OR text LIKE '📄%') AND text NOT LIKE '%(borrada)%' THEN text || ' · (borrada)' ELSE text END WHERE id=?")
  const byPath = new Map() // ruta → mensajes que la usaban, para poder DESHACER (re-vincular media)
  db().transaction(() => { for (const r of rows) { upd.run(r.id); if (!byPath.has(r.media)) byPath.set(r.media, []); byPath.get(r.media).push({ id: r.id, path: r.media }) } })()
  let trashed = 0
  const stillRef = db().prepare("SELECT 1 FROM messages WHERE media = ? LIMIT 1")
  for (const [p, msgs] of byPath) { if (!stillRef.get(p)) { casTrash(p, msgs); trashed++ } } // → PAPELERA (30 días para deshacer), NO borrado inmediato
  return { count: rows.length, trashed }
}
// DESHACER un borrado de media: restaura el blob de la papelera y re-vincula los mensajes afectados.
export function restoreMedia(pub) {
  const { msgs } = casRestore(pub)
  if (!msgs.length) return { restored: 0 }
  const upd = db().prepare("UPDATE messages SET media=@path, text=REPLACE(text, ' · (borrada)', '') WHERE id=@id")
  db().transaction(() => { for (const m of msgs) upd.run({ id: m.id, path: m.path }) })()
  return { restored: msgs.length }
}
// rutas /cas/ referenciadas por algún mensaje vivo → para que el GC sepa qué blobs son huérfanos.
export function liveMediaPaths() {
  return new Set(db().prepare("SELECT DISTINCT media FROM messages WHERE media LIKE '/cas/%'").all().map((r) => r.media))
}
