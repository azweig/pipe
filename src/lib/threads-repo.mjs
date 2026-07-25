// threads-repo — lecturas de conversación (resúmenes de bandeja, mensajes por hilo, paginado, no-leídos, media).
// Cuerpos movidos verbatim desde db.mjs; `db` = alias de handle() de db-core.
import { handle as db } from "./db-core.mjs"
import { owner } from "./hub.mjs"

const escLike = (s) => String(s).replace(/[\\%_]/g, "\\$&") // escapa comodines LIKE del DOMINIO (cliente_1 → cliente\_1); el '!%:' queda literal (ese % es intencional)
const mdomLike = (prefix = "") => prefix + "!%:%" // AGNÓSTICO del dominio Matrix: matchea salas portal !<id>:<dominio> de cualquier server (el server_name que sea) → no depende de MATRIX_DOMAIN

export function recentInThread(thread, { limit = 6 } = {}) {
  return db().prepare("SELECT name,text,ts,dir FROM messages WHERE thread=? AND text!='' ORDER BY ts DESC LIMIT ?").all(thread, limit).reverse()
}

export function getBody(id) { const r = db().prepare("SELECT body FROM messages WHERE id=?").get(id); return r?.body || null } // cuerpo HTML del email, on-demand

// ── consultas ──
// resumen por hilo (para la bandeja) — agrega en SQL, no carga todo en memoria
export function threadsSummary({ limit = 200 } = {}) {
  // top-N hilos desde thread_stats (índice, instantáneo). Sin subqueries pesados por hilo.
  const tops = db().prepare("SELECT thread, last_ts, count, unread, channels, nsenders FROM thread_stats ORDER BY last_ts DESC LIMIT ?").all(limit)
  const lastMsg = db().prepare("SELECT channel AS lastChannel, text AS lastText, dir AS lastDir, grp, media, mediaType, account FROM messages WHERE thread=? AND ts=? LIMIT 1")
  const emailAcct = db().prepare("SELECT account FROM messages WHERE thread=? AND channel='email' AND account!='' ORDER BY ts DESC LIMIT 1") // a qué cuenta MÍA llegó
  // NOMBRE del contacto = último mensaje ENTRANTE (nunca el mío saliente); si solo escribí yo, queda null y listThreads resuelve por número/agenda.
  const contactNm = db().prepare("SELECT name, sender, jid FROM messages WHERE thread=? AND dir!='out' AND name!='' AND name NOT IN (?,'Az','Az (WA)') ORDER BY ts DESC LIMIT 1") // excluye el nombre del dueño (config por-hub); sender/jid → identificador buscable (tel/email)
  const grpNm = db().prepare("SELECT grp FROM messages WHERE thread=? AND grp IS NOT NULL AND grp!='' ORDER BY ts DESC LIMIT 1") // nombre del grupo (cualquier msg, no solo el último)
  // PERF: grpNm sólo tiene sentido en HILOS DE GRUPO (clave con @g.us / sala !room / newsletter / broadcast). En un 1:1 grande
  // (ej. 7.000 msgs) esta query recorría el hilo entero buscando un grp que nunca existe → era el grueso del 1.5s de la bandeja.
  const isGroupKey = (k) => /@g\.us|@newsletter|@broadcast|@thread\.v2|:!/.test(k)
  return tops.map((t) => {
    const lm = lastMsg.get(t.thread, t.last_ts) || {}
    const cn = contactNm.get(t.thread, owner()) || {}
    return { key: t.thread, ts: t.last_ts, count: t.count, unread: t.unread || 0,
      name: cn.name || null, ident: [cn.jid, cn.sender].filter(Boolean).join(" ").toLowerCase() || null, lastChannel: lm.lastChannel, lastText: lm.lastText, lastDir: lm.lastDir, grp: lm.grp || (isGroupKey(t.thread) ? grpNm.get(t.thread)?.grp || null : null), media: lm.media, mediaType: lm.mediaType,
      account: (lm.lastChannel === "email" ? (emailAcct.get(t.thread)?.account || lm.account) : lm.account) || null,
      channels: (t.channels || "").split(",").filter(Boolean), nsenders: t.nsenders || 0 }
  })
}
export function channelsOf(thread) {
  return db().prepare("SELECT DISTINCT channel FROM messages WHERE thread=?").all(thread).map((r) => r.channel)
}
export function threadMessages(thread, { limit = 200 } = {}) {
  return db().prepare("SELECT * FROM messages WHERE thread=? ORDER BY ts ASC LIMIT ?").all(thread, limit)
}
export function threadMessagesTail(thread, { limit = 60 } = {}) {
  const rows = db().prepare("SELECT * FROM messages WHERE thread=? ORDER BY ts DESC LIMIT ?").all(thread, limit)
  return rows.reverse()
}
// página de historial: los `limit` mensajes anteriores a `before` (0 = los más recientes). Para paginar hacia atrás.
export function threadPage(thread, { before = 0, limit = 80 } = {}) {
  const b = before || Number.MAX_SAFE_INTEGER
  const rows = db().prepare("SELECT * FROM messages WHERE thread=? AND ts < ? ORDER BY ts DESC LIMIT ?").all(thread, b, limit)
  return rows.reverse()
}
export function threadCount(thread) { return db().prepare("SELECT COUNT(*) c FROM messages WHERE thread=?").get(thread).c }
// mensajes ENTRANTES (no míos) posteriores a una marca de "visto" — para el resumen de "lo que me perdí"
export function threadSince(thread, ts, { limit = 300 } = {}) {
  return db().prepare("SELECT * FROM messages WHERE thread=? AND ts > ? AND dir!='out' ORDER BY ts ASC LIMIT ?").all(thread, Number(ts) || 0, limit)
}
export function threadUnreadCount(thread, ts) {
  return db().prepare("SELECT COUNT(*) c FROM messages WHERE thread=? AND ts > ? AND dir!='out'").get(thread, Number(ts) || 0).c
}

// ── absorbidas en Wave 2 (antes SQL crudo en crons/libs) ──
// hilos ENTRANTES recientes SIN respuesta, un mensaje representativo (el último) por hilo: excluye grupos, 'self',
// y hilos donde ya respondí (dir='out'). Para el clasificador de spam capa 2. (era spam-classify.mjs)
export function inboundUnansweredThreads(sinceTs, { limit = 500 } = {}) {
  return db().prepare(`SELECT m.thread, m.name, m.jid, m.text, MAX(m.ts) ts FROM messages m
    WHERE m.dir!='out' AND m.ts > ? AND m.thread!='self' AND m.grp IS NULL AND m.thread NOT LIKE '%@g.us' AND length(m.text) > 12
    AND m.thread NOT IN (SELECT DISTINCT thread FROM messages WHERE dir='out')
    GROUP BY m.thread ORDER BY ts DESC LIMIT ?`).all(sinceTs, limit)
}
// notas propias (thread='self') desde una marca, más nuevas primero — texto + resumen de nota de voz. (era notes-ai.recentNotes)
export function selfNotesSince(since, { limit = 120 } = {}) {
  return db().prepare(`SELECT text, summary, mediaType, ts FROM messages
    WHERE thread='self' AND ts > ? ORDER BY ts DESC LIMIT ?`).all(since, limit)
}
// ── NOTAS categorizadas: self-notes (thread='self') + note_meta (categoría/estado/pin) ──
// self-notes todavía SIN categorizar (para el cron notes-categorize)
export function uncategorizedSelfNotes({ limit = 30 } = {}) {
  return db().prepare(`SELECT m.id, m.text, m.summary, m.mediaType, m.channel, m.ts FROM messages m
    LEFT JOIN note_meta n ON n.id = m.id
    WHERE m.thread='self' AND n.id IS NULL ORDER BY m.ts DESC LIMIT ?`).all(limit)
}
// BACKFILL: notas YA activas pero sin el enriquecimiento nuevo (catkey/acciones/veredicto) — para poblar lo existente sin re-junkear.
export function activeNotesMissingEnrichment({ limit = 30 } = {}) {
  return db().prepare(`SELECT m.id, m.text, m.summary, m.mediaType, m.channel, m.ts FROM messages m
    JOIN note_meta n ON n.id = m.id
    WHERE n.status='active' AND n.catkey IS NULL ORDER BY m.ts DESC LIMIT ?`).all(limit)
}
export function setNoteMeta(id, { category = null, title = null, status = "active", ts = null, catkey = null, actions = null, verdict = null } = {}) {
  // catkey/actions/verdict son opcionales: si vienen null NO pisan lo ya guardado (COALESCE), así re-aprobar desde junk no borra el enriquecimiento.
  const acts = actions == null ? null : (typeof actions === "string" ? actions : JSON.stringify(actions))
  const verd = verdict == null ? null : (typeof verdict === "string" ? verdict : JSON.stringify(verdict))
  return db().prepare(`INSERT INTO note_meta (id, category, title, status, ts, catkey, actions, verdict) VALUES (@id,@category,@title,@status,@ts,@catkey,@actions,@verdict)
    ON CONFLICT(id) DO UPDATE SET category=@category, title=@title, status=@status, catkey=COALESCE(@catkey,catkey), actions=COALESCE(@actions,actions), verdict=COALESCE(@verdict,verdict)`)
    .run({ id, category, title, status, ts: ts || Date.now(), catkey, actions: acts, verdict: verd })
}
// clave de DEDUP: SOLO notas TOTALMENTE idénticas colapsan. Clave = media + texto COMPLETO (char(31)=separador). Sin truncar:
// truncar a 120 colapsaba notas DISTINTAS con el mismo encabezado → noteAction propagaba la acción a notas ajenas (destrucción de datos).
// Vacío (sin media ni texto) → m.id → grupo propio (antes NKEY NULL nunca matcheaba en IN → el grupo reaparecía).
const NKEY = "coalesce(nullif(coalesce(m.media,'') || char(31) || lower(trim(coalesce(nullif(m.summary,''), m.text, ''))), char(31)), m.id)"
// notas para la UI: por categoría + estado, DEDUPEADAS por contenido, pineadas primero. Se muestra la MÁS RECIENTE de cada grupo.
// ROW_NUMBER (un solo criterio, ts DESC) elige representante determinístico; con dos MAX() SQLite no garantizaba de qué fila venían id/media/title.
export function listNotes({ category = null, status = "active", limit = 80 } = {}) {
  const parts = ["n.status = @status"], p = { status, limit }
  if (category && category !== "all") { parts.push("n.category = @category"); p.category = category }
  // LEFT JOIN clips: el enriquecimiento de links/videos (título descriptivo + "para qué sirve") vive en `clips`, keyeado por m.id.
  return db().prepare(`SELECT id, text, summary, mediaType, media, channel, ts, category, title, clip_title, para, status, pinned, catkey, actions, verdict FROM (
      SELECT m.id, m.text, m.summary, m.mediaType, m.media, m.channel, m.ts, n.category, n.title, cl.title AS clip_title, cl.para AS para, n.status, n.catkey, n.actions, n.verdict,
             MAX(n.pinned) OVER (PARTITION BY ${NKEY}) pinned,
             ROW_NUMBER() OVER (PARTITION BY ${NKEY} ORDER BY m.ts DESC, m.id DESC) rn
      FROM note_meta n JOIN messages m ON m.id = n.id
      LEFT JOIN clips cl ON cl.id = m.id
      WHERE ${parts.join(" AND ")})
    WHERE rn = 1 ORDER BY pinned DESC, ts DESC LIMIT @limit`).all(p)
}
export function noteCategories() {
  return db().prepare(`SELECT category, COUNT(*) n FROM (
    SELECT n.category FROM note_meta n JOIN messages m ON m.id = n.id
    WHERE n.status='active' AND n.category IS NOT NULL GROUP BY ${NKEY}) GROUP BY category ORDER BY n DESC`).all()
}
export function noteJunkCount() {
  return db().prepare(`SELECT COUNT(*) c FROM (SELECT 1 FROM note_meta n JOIN messages m ON m.id = n.id WHERE n.status='junk' GROUP BY ${NKEY})`).get().c
}
export function noteAction(id, action, category = null) {
  const D = db()
  // toggle de una ACCIÓN detectada (checklist): action = "check:<idx>" | "uncheck:<idx>" → marca done en el JSON de esa nota
  const mCheck = /^(un)?check:(\d+)$/.exec(action || "")
  if (mCheck) {
    const done = !mCheck[1], idx = +mCheck[2]
    const row = D.prepare("SELECT actions FROM note_meta WHERE id = ?").get(id)
    let arr = []; try { arr = JSON.parse(row?.actions || "[]") } catch {}
    if (Array.isArray(arr) && arr[idx]) { arr[idx].done = done; D.prepare("UPDATE note_meta SET actions = ? WHERE id = ?").run(JSON.stringify(arr), id) }
    return { ok: true, actions: arr }
  }
  let clause
  if (action === "pin") clause = "pinned=1"
  else if (action === "unpin") clause = "pinned=0"
  else if (action === "archive") clause = "status='archived', pinned=0"
  else if (action === "discard") clause = "status='discarded', pinned=0"
  else if (action === "approve") clause = "status='active', category=COALESCE(@cat,category)" // re-aprobar desde junk
  else return { error: "acción inválida" }
  // el listado deduplica por NKEY y muestra UN representante; actuar sobre un solo id deja los duplicados vivos → el grupo reaparece
  // al refrescar (y unpin/archive quedaban a medias). Resolvemos el grupo NKEY del id y aplicamos a TODAS las notas del grupo.
  const ids = D.prepare(`SELECT n.id FROM note_meta n JOIN messages m ON m.id = n.id WHERE ${NKEY} IN (
      SELECT ${NKEY} FROM note_meta n2 JOIN messages m ON m.id = n2.id WHERE n2.id = ?)`).all(id).map((r) => r.id)
  const list = ids.length ? ids : [id]
  const upd = D.prepare(`UPDATE note_meta SET ${clause} WHERE id = @id`)
  D.transaction(() => { for (const rid of list) upd.run(action === "approve" ? { id: rid, cat: category } : { id: rid }) })()
  return { ok: true, affected: list.length }
}
// last_ts por hilo desde thread_stats (recencia real, para el coach). (era coach.mjs)
export function allThreadLastTs() {
  return db().prepare("SELECT thread, last_ts FROM thread_stats").all()
}
// todos mis mensajes SALIENTES con texto real (para perfilar el estilo). (era style.outboundMessages)
export function sentMessages() {
  return db().prepare("SELECT channel, name, thread, jid, text, ts, dir, grp FROM messages WHERE dir='out' AND text IS NOT NULL AND length(trim(text))>3 ORDER BY ts").all()
}
// emails RECIBIDOS de un hilo (id + cuenta), para archivar en el buzón real. (era mail-archive.emailMsgsOf)
export function emailMessagesInThread(thread) {
  return db().prepare("SELECT id, account FROM messages WHERE thread=? AND channel='email' AND dir='in' AND id LIKE 'email:%'").all(thread)
}
// conteo + última actividad de una cuenta (para el estado de integraciones). (era accounts.listAccounts) Devuelve {n, last}.
export function accountMessageStats(account) {
  return db().prepare("SELECT COUNT(*) n, MAX(ts) last FROM messages WHERE account=?").get(account)
}

// ── absorbidas en Wave 3 (reads) ──
// mensajes con link de video y sin media todavía (candidatos del fetcher). (era video-fetch.candidates)
export function videoCandidates() {
  return db().prepare(
    `SELECT id, text, thread FROM messages WHERE media IS NULL AND (
       text LIKE '%instagram.com%' OR text LIKE '%tiktok.com%' OR text LIKE '%facebook.com%'
       OR text LIKE '%fb.watch%' OR text LIKE '%youtu%' OR text LIKE '%twitter.com%' OR text LIKE '%//x.com/%')
     ORDER BY ts DESC LIMIT 5000`
  ).all()
}
// mensajes ENTRANTES nuevos de conversaciones 1:1 (excluye grupos/canales/spam) desde una marca. (era msg-push)
export function inbound1to1Since(since) {
  return db().prepare(`SELECT thread, name, text, ts, jid FROM messages
  WHERE dir='in' AND ts > ? AND (grp IS NULL OR grp='')
    AND thread NOT LIKE '%@g.us%' AND thread NOT LIKE '%!%' AND thread NOT LIKE 'spam:%'
    AND thread NOT LIKE '%@newsletter%' AND thread NOT LIKE '%@broadcast%'
  ORDER BY ts ASC`).all(since)
}
// total de no-leídos (para el badge del ícono). (era msg-push)
export function totalUnread() {
  return db().prepare("SELECT COALESCE(SUM(unread),0) u FROM thread_stats WHERE unread>0").get()?.u || 0
}
// audios nuevos sin resumen (recibidos + notas de voz propias) desde una marca. (era audio-summarize)
export function audioToSummarize(from, { limit } = {}) {
  return db().prepare(`SELECT id, media, ts FROM messages
    WHERE mediaType='audio' AND media IS NOT NULL AND media!='' AND (dir!='out' OR thread='self')
      AND (summary IS NULL OR summary='') AND ts >= ?
    ORDER BY ts DESC LIMIT ?`).all(from, limit)
}
// un mensaje por id (o undefined). (era meetings.reprocessMeeting)
export function messageById(id) {
  return db().prepare("SELECT * FROM messages WHERE id=?").get(id)
}

// ── absorbidas en Wave 4 (signals — señales para coach/home) ──
// mensajes salientes recientes (para detectar promesas cumplidas/pendientes). (era signals.promises)
export function recentOutbound(since) {
  return db().prepare("SELECT m.thread, m.text, m.ts, m.channel, s.last_ts FROM messages m LEFT JOIN thread_stats s ON s.thread=m.thread WHERE m.dir='out' AND m.ts>? AND length(m.text)>6 ORDER BY m.ts DESC LIMIT 800").all(since)
}
// hilos cuyo ÚLTIMO mensaje es entrante y tiene "?" (preguntas sin responder, sin grupos). (era signals.unansweredQuestions)
export function lastInboundQuestions(since, { limit } = {}) {
  return db().prepare(`SELECT m.thread, m.name, m.text, m.ts, m.channel, m.jid FROM messages m JOIN thread_stats s ON s.thread=m.thread AND s.last_ts=m.ts
    WHERE m.dir!='out' AND m.ts>? AND m.text LIKE '%?%' AND length(m.text)>6 AND m.grp IS NULL AND m.thread NOT LIKE '%@g.us' ORDER BY m.ts DESC LIMIT ?`).all(since, limit)
}
// hilos cuyo ÚLTIMO mensaje es TUYO (saliente) — bola en su cancha. (era signals.waitingOnThem)
export function lastOutboundPerThread(since, { limit } = {}) {
  return db().prepare(`SELECT m.thread, m.text, m.ts, m.channel FROM messages m JOIN thread_stats s ON s.thread=m.thread AND s.last_ts=m.ts
    WHERE m.dir='out' AND m.ts>? AND length(m.text)>10 AND m.thread NOT LIKE 'whatsapp:%@g.us' AND m.thread!='self' ORDER BY m.ts DESC LIMIT ?`).all(since, limit)
}
// hilos cuyo ÚLTIMO mensaje es entrante (pendientes de respuesta, sin grupos). (era signals.pendingReplies)
export function lastInboundPerThread(since, maxTs, { limit } = {}) {
  return db().prepare(`SELECT m.thread, m.name, m.text, m.ts, m.channel, m.jid FROM messages m JOIN thread_stats s ON s.thread=m.thread AND s.last_ts=m.ts
    WHERE m.dir!='out' AND m.ts>? AND m.ts<? AND length(m.text)>8 AND m.thread!='self' AND m.grp IS NULL AND m.thread NOT LIKE '%@g.us' ORDER BY m.ts DESC LIMIT ?`).all(since, maxTs, limit)
}
// texto de las notas propias (Mis Notas) recientes. (era signals.recentNotes)
export function selfNotesText({ limit } = {}) {
  return db().prepare("SELECT text, ts FROM messages WHERE thread='self' AND text!='' AND length(text)>4 ORDER BY ts DESC LIMIT ?").all(limit)
}

// ── absorbidas en Wave 4 (extract-actions + home-brief) ──
// ts máximo en messages, con fallback si está vacío. (era extract-actions)
export function maxMessageTs(fallback = 0) {
  return db().prepare("SELECT COALESCE(MAX(ts),?) m FROM messages").get(fallback).m
}
// hilos 1:1 reales con actividad nueva desde una marca (excluye email/grupos/status/spam/self). (era extract-actions)
export function activeThreadsSince(since, { limit } = {}) {
  return db().prepare(`SELECT thread, MAX(ts) mx, MAX(name) name FROM messages
  WHERE ts > ? AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE 'email:%'
    AND thread NOT LIKE 'spam:%' AND thread NOT LIKE '%@newsletter%' AND thread NOT LIKE '%@broadcast%'
    AND thread!='self' AND thread!=''
  GROUP BY thread ORDER BY mx DESC LIMIT ?`).all(since, limit)
}
// cola de mensajes con texto de un hilo (para armar el transcript del extractor). (era extract-actions)
export function threadTextTail(thread, { limit = 22 } = {}) {
  return db().prepare("SELECT dir,name,text,ts FROM messages WHERE thread=? AND text IS NOT NULL AND text!='' ORDER BY ts DESC LIMIT ?").all(thread, limit)
}
// mensajes (thread/ts/dir) para calcular la tasa de respuesta <24h de la Home. (era home-brief.computeKpis)
export function messagesForResponseRate(since) {
  return db().prepare(`SELECT thread, ts, dir FROM messages WHERE ts > ? AND dir IN ('in','out')
      AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE 'email:%' AND thread!='self' AND thread!='' ORDER BY thread, ts`).all(since)
}
// nº de hilos 1:1 distintos a los que escribí desde una marca (contactos activos). (era home-brief)
export function activeOutboundThreads(since) {
  return db().prepare("SELECT COUNT(DISTINCT thread) c FROM messages WHERE dir='out' AND ts>? AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread!='self'").get(since).c || 0
}
// llamadas entrantes/perdidas recientes (mediaType='call'). (era home-brief.computeCalls)
export function recentCalls(since, { limit = 30 } = {}) {
  return db().prepare("SELECT thread, name, text, ts FROM messages WHERE mediaType='call' AND dir!='out' AND ts > ? ORDER BY ts DESC LIMIT ?").all(since, limit)
}

// ── absorbidas en Wave 5 (brain.mjs — reads) ──
// stats de un hilo: total/enviados/primer-ts/último-ts. (era brain.contactProfile)
export function threadStats(key) {
  return db().prepare("SELECT COUNT(*) total, SUM(CASE WHEN dir='out' THEN 1 ELSE 0 END) sent, MIN(ts) first, MAX(ts) last FROM messages WHERE thread=?").get(key) || {}
}
// nº de adjuntos reales (no stickers) de un hilo. (era brain.contactProfile)
export function threadMediaCount(key) {
  return db().prepare("SELECT COUNT(*) c FROM messages WHERE thread=? AND media IS NOT NULL AND media!='' AND mediaType!='sticker'").get(key)?.c || 0
}
// conteo por canal de un hilo. (era brain.contactProfile)
export function threadChannelCounts(key) {
  return db().prepare("SELECT channel, COUNT(*) n FROM messages WHERE thread=? GROUP BY channel ORDER BY n DESC").all(key)
}
// galería: todos los adjuntos de un hilo, más nuevos primero. (era brain.threadMedia)
export function threadMediaGallery(key) {
  return db().prepare("SELECT media, mediaType, filename, ts, name, dir FROM messages WHERE thread=? AND media IS NOT NULL AND media!='' AND mediaType!='sticker' ORDER BY ts DESC LIMIT 400").all(key)
}
// actividad entrante por canal (last + conteos 30d/7d) para el health check. (era brain.channelHealth)
export function channelActivityStats(d30, d7) {
  return db().prepare("SELECT channel, MAX(ts) last, SUM(CASE WHEN ts>? THEN 1 ELSE 0 END) n30, SUM(CASE WHEN ts>? THEN 1 ELSE 0 END) n7 FROM messages WHERE dir='in' AND channel IS NOT NULL GROUP BY channel").all(d30, d7)
}
// mensajes ingeridos por canal desde `since` (para el sync bar: una ráfaga reciente = backfill/primera sync en curso).
export function recentIngestByChannel(since) {
  return db().prepare("SELECT channel, COUNT(*) n, MAX(ts) last FROM messages WHERE ts > ? AND channel IS NOT NULL GROUP BY channel").all(since)
}
// total de mensajes de canales puntuales (para mostrar el número que sube en el sync bar). Solo se llama con pocos canales activos.
export function channelTotals(channels) {
  if (!channels || !channels.length) return []
  const ph = channels.map(() => "?").join(",")
  return db().prepare(`SELECT channel, COUNT(*) n FROM messages WHERE channel IN (${ph}) GROUP BY channel`).all(...channels)
}
// último nombre ENTRANTE de un hilo (para prefill de contacto). (era brain.schedulePrefill)
export function lastInboundName(key) {
  return db().prepare("SELECT name FROM messages WHERE thread=? AND dir='in' AND name!='' ORDER BY ts DESC LIMIT 1").get(key)
}
// última actividad (ts) por canal+cuenta, para el panel de integraciones. (era brain.channelAccountLast)
export function channelAccountActivity() {
  return db().prepare("SELECT channel, account, MAX(ts) last FROM messages WHERE channel IS NOT NULL GROUP BY channel, account").all()
}
// nombres entrantes más frecuentes de un hilo (fallback de avatar). (era brain._photoFor)
export function topInboundNames(thread, ownerName, { limit = 3 } = {}) {
  return db().prepare("SELECT name FROM messages WHERE thread=? AND dir!='out' AND name!='' AND name NOT IN (?,'Az','Az (WA)') GROUP BY name ORDER BY COUNT(*) DESC LIMIT ?").all(thread, ownerName, limit)
}
// hilos donde YA respondí (correspondencia real) — ALIMENTA listThreads (la bandeja). (era brain.listThreads)
export function repliedThreads() {
  return db().prepare("SELECT DISTINCT thread FROM messages WHERE dir='out'").all()
}
// hilo más reciente que matchea un patrón LIKE (resolver número→hilo). (era brain.coachData)
export function latestThreadLike(pattern) {
  return db().prepare("SELECT thread FROM messages WHERE thread LIKE ? ORDER BY ts DESC LIMIT 1").get(pattern)
}
// conteo de enviados desde una marca. (era brain.weeklyReview)
export function sentCountSince(since) {
  return db().prepare("SELECT COUNT(*) c FROM messages WHERE dir='out' AND ts>?").get(since).c
}
// conteo de recibidos reales (no self/spam/broadcast) desde una marca. (era brain.weeklyReview)
export function recvCountSince(since) {
  return db().prepare("SELECT COUNT(*) c FROM messages WHERE dir!='out' AND ts>? AND thread!='self' AND thread NOT LIKE '%status@broadcast%' AND thread NOT LIKE 'spam:%'").get(since).c
}
// hilos con más ida y vuelta desde una marca (para el review semanal). (era brain.weeklyReview)
export function topThreadsSince(since, { limit = 12 } = {}) {
  return db().prepare("SELECT thread, COUNT(*) c FROM messages WHERE ts>? AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE '%@newsletter' AND thread NOT LIKE '%status@broadcast%' AND thread NOT LIKE 'spam:%' AND thread!='self' GROUP BY thread ORDER BY c DESC LIMIT ?").all(since, limit)
}
// todos los mensajes de un hilo (cualquier dir) desde una marca. (era brain.summarizeChat)
export function threadMessagesSinceAll(key, since, { limit = 500 } = {}) {
  return db().prepare("SELECT * FROM messages WHERE thread=? AND ts > ? ORDER BY ts ASC LIMIT ?").all(key, since, limit)
}
// filas para el índice de membresía de grupos (remitentes por grupo). (era brain.buildMembershipIndex)
export function groupMembershipRows() {
  return db().prepare(`SELECT thread, MAX(grp) grp, sender, MAX(name) name, COUNT(*) n FROM messages
    WHERE (thread LIKE '%@g.us' OR thread LIKE ? ESCAPE '\\') AND dir='in' AND (sender!='' OR name!='') AND name NOT LIKE '%bot%'
    GROUP BY thread, sender`).all(mdomLike("whatsapp:"))
}
// stats simples de un hilo (conteo + primer/último ts). (era brain.buildPersonCard)
export function threadCountFirstLast(key) {
  return db().prepare("SELECT COUNT(*) c, MIN(ts) first, MAX(ts) last FROM messages WHERE thread=?").get(key) || {}
}
// actividad por canal de un hilo (last + n). (era brain.buildPersonCard)
export function threadChannelActivity(key) {
  return db().prepare("SELECT channel, MAX(ts) last, COUNT(*) n FROM messages WHERE thread=? GROUP BY channel ORDER BY n DESC").all(key)
}
// timeline (ts, dir) de un hilo para calcular tiempos de respuesta. (era brain.buildPersonCard)
export function threadDirTimeline(key, { limit = 3000 } = {}) {
  return db().prepare("SELECT ts, dir FROM messages WHERE thread=? ORDER BY ts LIMIT ?").all(key, limit)
}
// remitentes entrantes distintos de un hilo (para resolver el número real). (era brain.buildPersonCard)
export function threadInboundSenders(key, { limit = 30 } = {}) {
  return db().prepare("SELECT DISTINCT sender FROM messages WHERE thread=? AND dir='in' AND sender!='' LIMIT ?").all(key, limit)
}
// rowids de mensajes con texto útil de un hilo (para muestrear la relación). (era brain.buildPersonCard)
export function threadTextRowids(key) {
  return db().prepare("SELECT rowid FROM messages WHERE thread=? AND text!='' AND text NOT LIKE 'http%' AND text NOT LIKE '%Nota de voz%' ORDER BY ts").all(key)
}
// mensajes (dir,text) por un set de rowids, en orden cronológico. (era brain.buildPersonCard)
export function messagesByRowids(rowids = []) {
  if (!rowids.length) return []
  const ph = rowids.map(() => "?").join(",")
  return db().prepare(`SELECT dir, text FROM messages WHERE rowid IN (${ph}) ORDER BY ts`).all(...rowids)
}

// ── send-path: resolución de destino de un hilo (Wave 5c) ──
// salas portal de WhatsApp (bridge) de un hilo, por jid, la más reciente primero. (era brain.threadTargets)
export function whatsappRoomsOf(key) {
  return db().prepare(`SELECT jid, MAX(ts) last FROM messages WHERE thread=? AND jid LIKE ? ESCAPE '\\' GROUP BY jid ORDER BY last DESC`).all(key, mdomLike())
}
// remitentes entrantes de una sala portal concreta. (era brain.threadTargets)
export function roomInboundSenders(key, jid) {
  return db().prepare("SELECT DISTINCT sender FROM messages WHERE thread=? AND jid=? AND dir='in' AND sender LIKE '@whatsapp\\_%' ESCAPE '\\'").all(key, jid)
}
// direcciones de email de un hilo, la más reciente primero. (era brain.threadTargets)
export function emailAddressesOf(key) {
  return db().prepare("SELECT jid, MAX(ts) last FROM messages WHERE thread=? AND channel='email' AND jid!='' GROUP BY jid ORDER BY last DESC").all(key)
}
// jid del último mensaje ENTRANTE de un hilo (destino default). (era brain.threadTargets)
export function lastInboundJid(key) {
  return db().prepare("SELECT jid FROM messages WHERE thread=? AND dir='in' ORDER BY ts DESC LIMIT 1").get(key)
}
// último email (cuenta+texto) por dirección exacta. (era brain.sendReply)
export function lastEmailByAddress(address) {
  return db().prepare("SELECT account, text FROM messages WHERE channel='email' AND jid=? ORDER BY ts DESC LIMIT 1").get(address)
}
// último email (cuenta+texto) de un hilo. (era brain.sendReply)
export function lastEmailInThread(key) {
  return db().prepare("SELECT account, text FROM messages WHERE thread=? AND channel='email' ORDER BY ts DESC LIMIT 1").get(key)
}
// último jid gestionado por Unipile de un hilo (WhatsApp híbrido). (era brain.sendReply)
export function lastUnipileJid(key) {
  return db().prepare("SELECT jid FROM messages WHERE thread=? AND account='unipile' AND channel='whatsapp' AND jid!='' ORDER BY ts DESC LIMIT 1").get(key)
}
// última sala portal de WhatsApp (bridge) de un hilo — destino de envío. (era brain.sendReply*)
export function lastWhatsappRoom(key) {
  return db().prepare(`SELECT jid FROM messages WHERE thread=? AND jid LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT 1`).get(key, mdomLike())
}
// último jid histórico crudo (<num>@s.whatsapp.net, sin sala del bridge). (era brain.sendReply*)
export function lastHistoricJid(key) {
  return db().prepare("SELECT jid FROM messages WHERE thread=? AND jid LIKE '%@s.whatsapp.net' ORDER BY ts DESC LIMIT 1").get(key)
}

// ── absorbidas en Wave 6 (últimos handle-importers) ──
// mensajes con tipo de media pero sin archivo vinculado (para el backfill de CAS). (era relink-media)
export function mediaWithoutFile() {
  return db().prepare("SELECT id FROM messages WHERE mediaType IS NOT NULL AND media IS NULL").all()
}
// emails con cuerpo y sin resumen (para el cron de pitch/resumen). (era email-summarize)
export function emailsToSummarize({ limit = 12 } = {}) {
  return db().prepare(`SELECT id, name, text, body FROM messages
  WHERE channel='email' AND body IS NOT NULL AND (summary IS NULL OR summary='') ORDER BY ts DESC LIMIT ?`).all(limit)
}
