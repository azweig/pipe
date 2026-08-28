// threads-repo — lecturas de conversación (resúmenes de bandeja, mensajes por hilo, paginado, no-leídos, media).
// Cuerpos movidos verbatim desde db.mjs; `db` = alias de handle() de db-core.
import { handle as db, withRetry } from "./db-core.mjs"
import { waGroups } from "./brain/kernel/contacts.mjs"
import { owner } from "./hub.mjs"
import { isSecretSelfNote, secretSelfClause, secretThreadKeys, isSecretRow , secretGate} from "./secret.mjs"

// helper: appende " AND NOT (<secret>)" a un WHERE de self-notes (thread='self') si hay cuentas secretas. Idempotente si no hay nada.
function _selfSecretAnd(alias = "m") { const c = secretSelfClause(alias); return c.clause ? { sql: ` AND NOT (${c.clause})`, params: c.params } : { sql: "", params: [] } }
// helper: excluye hilos 100%-secretos (gate.hide) de un agregado — " AND <col> NOT IN (...)". Para conteos/KPIs sin fila representativa.
function _hideAnd(col = "thread") {
  // blockAll = el gate no pudo calcularse y no hay uno bueno previo → no devolvemos NADA. Bandeja vacía y ruidosa
  // es preferible a filtrar lo que había que ocultar.
  if (secretGate().blockAll) return { sql: " AND 1=0", params: [] }
  const h = [...secretThreadKeys()]; return h.length ? { sql: ` AND ${col} NOT IN (${h.map(() => "?").join(",")})`, params: h } : { sql: "", params: [] }
}

const escLike = (s) => String(s).replace(/[\\%_]/g, "\\$&") // escapa comodines LIKE del DOMINIO (cliente_1 → cliente\_1); el '!%:' queda literal (ese % es intencional)
const mdomLike = (prefix = "") => prefix + "!%:%" // AGNÓSTICO del dominio Matrix: matchea salas portal !<id>:<dominio> de cualquier server (el server_name que sea) → no depende de MATRIX_DOMAIN

export function recentInThread(thread, { limit = 6 } = {}) {
  return db().prepare("SELECT name,text,ts,dir FROM messages WHERE thread=? AND text!='' ORDER BY ts DESC LIMIT ?").all(thread, limit).reverse()
}

// 🔒 LECTORES POR-ID: la bandeja y el visor ya filtran por hilo, pero pedir un id suelto los saltea — con el id de un correo
// de una cuenta secreta se leía el cuerpo entero sin 2º PIN. Sin `secretOn` una fila secreta directamente NO EXISTE.
// El id no es adivinable, pero sale en cualquier export/backup/captura vieja: no es un secreto, es un identificador.
export function getBody(id, { secretOn = false } = {}) { const r = db().prepare("SELECT body, channel, account, thread, jid, sender FROM messages WHERE id=?").get(id); if (!r || (!secretOn && isSecretRow(r))) return null; return r.body || null } // cuerpo HTML del email, on-demand
// 🔒 ¿este archivo del CAS es de fuente secreta? El CAS se sirve por RUTA (/cas/<sha>.jpg), que no pasa por el gate por-hilo:
// con la ruta en la mano se bajaba la foto o se la mandaba a OCR. La ruta no es adivinable (es el hash del contenido), pero
// sale en la papelera, en backups y en cualquier captura. Un mismo archivo puede estar en varios mensajes: si CUALQUIERA es
// secreto, se niega. Va por el índice idx_media, así que es una búsqueda puntual y no un barrido.
export function casSecreto(pub, { secretOn = false } = {}) {
  if (secretOn) return false
  const p = String(pub || "").trim(); if (!p) return false
  try {
    if (db().prepare("SELECT thread, channel, account, jid FROM messages WHERE media=? LIMIT 50").all(p).some((r) => isSecretRow(r))) return true
    // Los ADJUNTOS de correo no viven en `media`: van en la columna `attachments`, un JSON [{name,cas,mime,size}]. Mirar
    // solo `media` dejaba el PDF de una cuenta de correo secreta servido por HTTP sin 2º PIN — y el correo es justo el
    // canal que más adjuntos genera. El LIKE acota por el hash antes de parsear (el hash está dentro del JSON).
    const hash = p.replace(/^\/?(cas|media)\//, "")
    if (!hash) return false
    return db().prepare("SELECT thread, channel, account, jid, attachments FROM messages WHERE attachments IS NOT NULL AND attachments LIKE ? LIMIT 50")
      .all(`%${hash}%`).some((r) => {
        if (!isSecretRow(r)) return false
        try { return (JSON.parse(r.attachments) || []).some((a) => String(a?.cas || "").includes(hash)) } catch { return true }
      })
  } catch { return true } // si no se puede consultar, no se entrega
}
export function getAttachments(id) { const r = db().prepare("SELECT attachments FROM messages WHERE id=?").get(id); return r?.attachments || null } // JSON de adjuntos (incluye los inline cid:)
export function setAttachments(id, json) { db().prepare("UPDATE messages SET attachments=? WHERE id=?").run(json, id) } // el trigger de rev bumpea solo → los clientes re-sincronizan
// emails cuyo cuerpo referencia imágenes inline (cid:) pero que NO tienen esas imágenes guardadas → candidatos al backfill
export function emailsMissingInline({ limit = 50 } = {}) {
  return db().prepare(`SELECT id, account, ts, text FROM messages WHERE channel='email' AND body LIKE '%cid:%'
    AND (attachments IS NULL OR attachments NOT LIKE '%"inline":true%') ORDER BY ts DESC LIMIT ?`).all(limit)
}

// ── consultas ──
// resumen por hilo (para la bandeja) — agrega en SQL, no carga todo en memoria
// CLAVES DE HILO que matchean un texto — sobre TODOS los hilos, no solo los recientes.
// Por qué existe: la bandeja carga los N más recientes. Con 3400 hilos, un contacto con el que hablás seguido pero
// hace dos semanas queda fuera de la ventana y era INENCONTRABLE (el buscador de las apps filtraba solo lo cargado).
// Dos fuentes, las dos con índice:
//   · la CLAVE del hilo (thread_stats es chica; ahí caen emails, teléfonos y los chats importados que se llaman como la persona),
//   · el NOMBRE del remitente vía FTS5 (`name:<q>*`) → milisegundos aunque haya millones de mensajes.
export function searchThreadKeys(q, { limit = 60 } = {}) {
  const raw = String(q || "").trim()
  if (raw.length < 2) return []
  const d = db()
  const like = `%${raw.toLowerCase()}%`
  const keys = new Map() // key → last_ts
  for (const r of d.prepare("SELECT thread, last_ts FROM thread_stats WHERE lower(thread) LIKE ? ORDER BY last_ts DESC LIMIT ?").all(like, limit)) keys.set(r.thread, r.last_ts)
  // FTS5 tiene sintaxis propia (comillas, NEAR, *): se sanitiza a tokens alfanuméricos antes de armar el MATCH
  const tokens = raw.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2)
  if (tokens.length) {
    const match = tokens.map((t) => `name:${t}*`).join(" AND ")
    try {
      for (const r of d.prepare(`SELECT DISTINCT m.thread, ts.last_ts FROM messages_fts f JOIN messages m ON m.rowid=f.rowid
        LEFT JOIN thread_stats ts ON ts.thread=m.thread WHERE messages_fts MATCH ? ORDER BY ts.last_ts DESC LIMIT ?`).all(match, limit)) {
        if (!keys.has(r.thread)) keys.set(r.thread, r.last_ts || 0)
      }
    } catch { /* MATCH inválido → alcanza con lo que dio el LIKE */ }
  }
  // NOMBRE DEL GRUPO: hasta acá solo se miró la CLAVE del hilo y el nombre del REMITENTE. En un grupo de WhatsApp
  // la clave es `whatsapp:<creador>-<ts>@g.us` y los remitentes son números crudos: el título del grupo
  // no aparece en ninguno de los dos, así que buscarlo no devolvía nada y el grupo era ilocalizable si además
  // había quedado fuera de la ventana por recencia.
  try {
    const g = waGroups()
    for (const [jid, nombre] of Object.entries(g)) {
      if (!String(nombre || "").toLowerCase().includes(raw.toLowerCase())) continue
      const k = "whatsapp:" + jid
      if (keys.has(k)) continue
      const row = d.prepare("SELECT last_ts FROM thread_stats WHERE thread=?").get(k)
      if (row) keys.set(k, row.last_ts || 0)
    }
  } catch { /* sin mapa de grupos: la búsqueda sigue funcionando como antes */ }
  return [...keys.entries()].sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, limit).map(([k]) => k)
}

// Busca un hilo por su CLAVE exacta, directo en la base. Hace falta porque las vistas trabajan sobre los N hilos
// más recientes, y con miles de conversaciones casi todas quedan afuera de esa ventana: un chat de hace unos meses
// existía con cientos de mensajes y la app decía "no encontré chat con esa persona".
// En un DM la clave ES el nombre canónico, así que esto resuelve el caso normal.
// Con qué remitente (ghost de Matrix) escribe alguien en los grupos. Para quien NO tiene chat 1:1 es el único
// rastro de su identidad — y de ahí sale el LID que el bridge sabe traducir a teléfono.
// Marca un mensaje ya guardado como respuesta a una historia. Se hace DESPUÉS de enviar: el envío usa el camino
// normal (que ya sabe resolver salas, cifrar y registrar), y acá solo se le pone la etiqueta.
// FICHA DE GRUPO: quién habla más, cuánto participás vos y desde cuándo. Todo sale de los mensajes con SQL — sin
// IA y sin costo, que es lo que permite mostrarlo al abrir el grupo en vez de tener que pre-generarlo.
export function grupoStats(clave) {
  const k = String(clave || "")
  if (!k) return null
  const d = db()
  const tot = d.prepare("SELECT COUNT(*) n, MIN(ts) primero, MAX(ts) ultimo FROM messages WHERE thread=?").get(k)
  if (!tot || !tot.n) return null
  const mios = d.prepare("SELECT COUNT(*) n, MAX(ts) ultimo FROM messages WHERE thread=? AND dir='out'").get(k)
  // los que más hablan: por nombre, que es como los ve el usuario (un mismo número puede cambiar de nombre, y al
  // revés dos números de la misma persona deben sumar bajo su nombre)
  const top = d.prepare(`SELECT name, COUNT(*) n, MAX(ts) ultimo FROM messages
    WHERE thread=? AND dir='in' AND name IS NOT NULL AND name<>'' GROUP BY name ORDER BY n DESC LIMIT 10`).all(k)
  const personas = d.prepare("SELECT COUNT(DISTINCT name) n FROM messages WHERE thread=? AND dir='in' AND name IS NOT NULL AND name<>''").get(k)
  return { total: tot.n, primero: tot.primero, ultimo: tot.ultimo, mios: mios.n || 0, mioUltimo: mios.ultimo || 0, personas: personas.n || 0, top }
}

// temas ya extraídos por el enriquecedor (397 de 675 grupos los tienen). Si no están, la ficha los omite en vez de
// inventarlos: un tema equivocado es peor que ninguno.
export function grupoTemas(clave) {
  try {
    const r = db().prepare("SELECT keywords, tags, summary FROM conversations WHERE thread=?").get(String(clave || ""))
    if (!r) return { temas: [], resumen: "" }
    const j = (v) => { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a.filter(Boolean).map(String) : [] } catch { return [] } }
    return { temas: [...new Set([...j(r.tags), ...j(r.keywords)])].slice(0, 10), resumen: String(r.summary || "") }
  } catch { return { temas: [], resumen: "" } }
}

export function marcarComoHistoria(id) {
  if (!id) return 0
  return withRetry(() => db().prepare("UPDATE messages SET tag='historia' WHERE id=?").run(String(id))).changes
}

export function senderPorNombre(nombre) {
  const n = String(nombre || "").trim()
  if (!n) return null
  try {
    const r = db().prepare("SELECT sender, COUNT(*) c FROM messages WHERE name=? AND sender IS NOT NULL AND sender<>'' GROUP BY sender ORDER BY c DESC LIMIT 1").get(n)
    return (r && r.sender) || null
  } catch { return null }
}

export function threadPorClave(clave) {
  const k = String(clave || "").trim()
  if (!k) return null
  try { return db().prepare("SELECT thread, last_ts, count, unread, channels, nsenders FROM thread_stats WHERE thread=? OR thread=? LIMIT 1").get(k, "whatsapp:" + k) || null } catch { return null }
}

export function threadsSummary({ limit = 200, keys = null } = {}) {
  // top-N hilos desde thread_stats (índice, instantáneo). Sin subqueries pesados por hilo.
  // Con `keys` se piden hilos PUNTUALES (búsqueda) en vez de la ventana por recencia — el resto del armado es idéntico.
  const tops = keys
    ? (keys.length ? db().prepare(`SELECT thread, last_ts, count, unread, channels, nsenders FROM thread_stats WHERE thread IN (${keys.map(() => "?").join(",")}) ORDER BY last_ts DESC`).all(...keys) : [])
    : db().prepare("SELECT thread, last_ts, count, unread, channels, nsenders FROM thread_stats ORDER BY last_ts DESC LIMIT ?").all(limit)
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
  // 🔒 lector de RESUMEN/derivados (enrich-convos, meetings, scheduleIntent) — NO es el visor del hilo (ése usa threadPage con secretOn).
  // Filtramos mensajes de canal secreto para que ningún cron sin 2º PIN los meta en facetas/tarjetas/prep.
  const rows = db().prepare("SELECT * FROM messages WHERE thread=? ORDER BY ts DESC LIMIT ?").all(thread, limit).filter((m) => !isSecretRow(m))
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
// 🔒 por defecto filtra, igual que su gemela threadMessagesSinceAll. El único llamador de hoy (catchup) pide lo contrario
// a propósito: la ruta HTTP ya bloquea el hilo cuando NO hay 2º PIN, y con el PIN puesto el resumen se hace con modelo
// local. Cualquier llamador nuevo que no diga nada recibe la versión filtrada.
export function threadSince(thread, ts, { limit = 300, incluirSecretos = false } = {}) {
  const rows = db().prepare("SELECT * FROM messages WHERE thread=? AND ts > ? AND dir!='out' ORDER BY ts ASC LIMIT ?").all(thread, Number(ts) || 0, limit)
  return incluirSecretos ? rows : rows.filter((m) => !isSecretRow(m))
}
export function threadUnreadCount(thread, ts) {
  return db().prepare("SELECT COUNT(*) c FROM messages WHERE thread=? AND ts > ? AND dir!='out'").get(thread, Number(ts) || 0).c
}
// SYNC edit-aware: filas del hilo con rev > sinceRev (NUEVAS o editadas), en orden de revisión. El cliente hace upsert por id.
export function threadDelta(thread, sinceRev = 0, { limit = 500 } = {}) {
  return db().prepare("SELECT * FROM messages WHERE thread=? AND rev > ? ORDER BY rev ASC LIMIT ?").all(thread, Number(sinceRev) || 0, limit)
}
// rev máxima actual del hilo (para que el cliente sepa hasta dónde llegó, aunque el delta venga vacío/paginado)
export function threadMaxRev(thread) {
  return db().prepare("SELECT COALESCE(MAX(rev),0) r FROM messages WHERE thread=?").get(thread).r
}

// ── absorbidas en Wave 2 (antes SQL crudo en crons/libs) ──
// hilos ENTRANTES recientes SIN respuesta, un mensaje representativo (el último) por hilo: excluye grupos, 'self',
// y hilos donde ya respondí (dir='out'). Para el clasificador de spam capa 2. (era spam-classify.mjs)
export function inboundUnansweredThreads(sinceTs, { limit = 500 } = {}) {
  return db().prepare(`SELECT m.thread, m.name, m.jid, m.channel, m.account, m.text, MAX(m.ts) ts FROM messages m
    WHERE m.dir!='out' AND m.ts > ? AND m.thread!='self' AND m.grp IS NULL AND m.thread NOT LIKE '%@g.us' AND length(m.text) > 12
    AND m.thread NOT IN (SELECT DISTINCT thread FROM messages WHERE dir='out')
    GROUP BY m.thread ORDER BY ts DESC LIMIT ?`).all(sinceTs, limit).filter((r) => !isSecretRow(r)) // 🔒
}
// notas propias (thread='self') desde una marca, más nuevas primero — texto + resumen de nota de voz. (era notes-ai.recentNotes)
export function selfNotesSince(since, { limit = 120 } = {}) {
  const s = _selfSecretAnd("messages") // 🔒 excluye notas de canal secreto (sin 2º PIN el cron/chat no debe verlas)
  // jid = la SALA de origen. Con varios teléfonos, el asistente tiene que contestar DONDE preguntaste,
  // no en "la última sala del hilo" (que puede ser la de otro celular).
  return db().prepare(`SELECT text, summary, mediaType, media, filename, ts, jid FROM messages
    WHERE thread='self' AND ts > ?${s.sql} ORDER BY ts DESC LIMIT ?`).all(since, ...s.params, limit)
}
// Notas propias INCLUYENDO las de líneas secretas. Solo para el ASISTENTE y solo con su opt-in explícito.
// Por qué se permite acá y no en el resto: "secreto" significa OCULTO EN LA APP (que quien te mire la pantalla no
// lo vea), no "inexistente". El asistente contesta DENTRO de ese mismo chat de WhatsApp, donde el dueño ya ve todo:
// no expone nada a una superficie nueva. Distinto de coach/home/vault, que SÍ mostrarían ese contenido en otro lado.
export function selfNotesSinceAll(since, { limit = 120 } = {}) {
  return db().prepare(`SELECT text, summary, mediaType, media, filename, ts, jid FROM messages
    WHERE thread='self' AND ts > ? ORDER BY ts DESC LIMIT ?`).all(since, limit)
}
// ¿esta nota vino de una línea secreta? → para decidir si se responde con modelo LOCAL (no mandar eso a la nube)
export function isSecretSelfRow(row) {
  if (!row) return false
  // Cuando el gate no se puede calcular, la cláusula es "1=1" (todo es secreto) y viene SIN parámetros: el `includes`
  // sobre una lista vacía daba false, o sea que esta función fallaba ABIERTA justo en el escenario donde todo lo demás
  // falla cerrado — y el asistente trataba la nota como no-secreta (cadena nube + búsqueda web).
  if (secretGate().blockAll) return true
  const s = _selfSecretAnd("messages")
  if (!s.sql) return false
  const jid = String(row.jid || "")
  return (s.params || []).includes(jid)
}
// Cuántas notas propias quedaron OCULTAS por el 2º PIN en ese lapso. Es solo un CONTEO (nunca el contenido):
// sirve para que el asistente pueda decir "no vi nada porque está bajo el PIN" en vez de callarse y parecer roto.
export function selfNotesHiddenCount(since) {
  const s = _selfSecretAnd("messages")
  if (!s.sql) return 0
  const all = db().prepare("SELECT COUNT(*) c FROM messages WHERE thread='self' AND ts > ?").get(since).c
  const vis = db().prepare(`SELECT COUNT(*) c FROM messages WHERE thread='self' AND ts > ?${s.sql}`).get(since, ...s.params).c
  return Math.max(0, all - vis)
}
// ── NOTAS categorizadas: self-notes (thread='self') + note_meta (categoría/estado/pin) ──
// self-notes todavía SIN categorizar (para el cron notes-categorize)
export function uncategorizedSelfNotes({ limit = 30 } = {}) {
  const s = _selfSecretAnd("m") // 🔒 no categorizar (ni mandar al LLM) notas de canal secreto
  return db().prepare(`SELECT m.id, m.text, m.summary, m.mediaType, m.channel, m.ts FROM messages m
    LEFT JOIN note_meta n ON n.id = m.id
    WHERE m.thread='self' AND n.id IS NULL${s.sql} ORDER BY m.ts DESC LIMIT ?`).all(...s.params, limit)
}
// BACKFILL: notas YA activas pero sin el enriquecimiento nuevo (catkey/acciones/veredicto) — para poblar lo existente sin re-junkear.
export function activeNotesMissingEnrichment({ limit = 30 } = {}) {
  const s = _selfSecretAnd("m") // 🔒
  return db().prepare(`SELECT m.id, m.text, m.summary, m.mediaType, m.channel, m.ts FROM messages m
    JOIN note_meta n ON n.id = m.id
    WHERE n.status='active' AND n.catkey IS NULL${s.sql} ORDER BY m.ts DESC LIMIT ?`).all(...s.params, limit)
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
  // 🔒 traemos account/jid para descartar en JS las notas de canal secreto (no se puede mezclar params ? con los @named de acá).
  return db().prepare(`SELECT id, text, summary, mediaType, media, channel, account, jid, ts, category, title, clip_title, para, status, pinned, catkey, actions, verdict FROM (
      SELECT m.id, m.text, m.summary, m.mediaType, m.media, m.channel, m.account, m.jid, m.ts, n.category, n.title, cl.title AS clip_title, cl.para AS para, n.status, n.catkey, n.actions, n.verdict,
             MAX(n.pinned) OVER (PARTITION BY ${NKEY}) pinned,
             ROW_NUMBER() OVER (PARTITION BY ${NKEY} ORDER BY m.ts DESC, m.id DESC) rn
      FROM note_meta n JOIN messages m ON m.id = n.id
      LEFT JOIN clips cl ON cl.id = m.id
      WHERE ${parts.join(" AND ")})
    WHERE rn = 1 ORDER BY pinned DESC, ts DESC LIMIT @limit`).all(p).filter((r) => !isSecretSelfNote(r))
}
export function noteCategories() {
  const s = _selfSecretAnd("m") // 🔒 no contar categorías provenientes de notas secretas
  return db().prepare(`SELECT category, COUNT(*) n FROM (
    SELECT n.category FROM note_meta n JOIN messages m ON m.id = n.id
    WHERE n.status='active' AND n.category IS NOT NULL${s.sql} GROUP BY ${NKEY}) GROUP BY category ORDER BY n DESC`).all(...s.params)
}
export function noteJunkCount() {
  const s = _selfSecretAnd("m") // 🔒
  return db().prepare(`SELECT COUNT(*) c FROM (SELECT 1 FROM note_meta n JOIN messages m ON m.id = n.id WHERE n.status='junk'${s.sql} GROUP BY ${NKEY})`).get(...s.params).c
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
  // 🔒 de acá sale el perfil de estilo y los ejemplos few-shot que ve el LLM al redactar. Un saliente tuyo de la línea
  // secreta se usaba como ejemplo para escribirle a OTRO contacto: el texto se filtraba literal.
  return db().prepare("SELECT channel, account, name, thread, jid, text, ts, dir, grp FROM messages WHERE dir='out' AND text IS NOT NULL AND length(trim(text))>3 ORDER BY ts").all().filter((r) => !isSecretRow(r))
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
  // 🔒 con esto yt-dlp sale a buscar el link a Instagram/TikTok: tu IP pega a ese sitio con una URL que solo existe en un
  // chat secreto, y el archivo baja al CAS. Trae las columnas del filtro por-mensaje.
  return db().prepare(
    `SELECT id, text, thread, channel, account, jid FROM messages WHERE media IS NULL AND (
       text LIKE '%instagram.com%' OR text LIKE '%tiktok.com%' OR text LIKE '%facebook.com%'
       OR text LIKE '%fb.watch%' OR text LIKE '%youtu%' OR text LIKE '%twitter.com%' OR text LIKE '%//x.com/%')
     ORDER BY ts DESC LIMIT 5000`
  ).all().filter((r) => !isSecretRow(r))
}
// mensajes ENTRANTES nuevos de conversaciones 1:1 (excluye grupos/canales/spam) desde una marca. (era msg-push)
export function inbound1to1Since(since) {
  return db().prepare(`SELECT thread, name, text, ts, jid, channel, account FROM messages
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
  // 🔒 esto le manda el AUDIO CRUDO a un servicio de transcripción. Era el único selector de filas del archivo sin gate,
  // justo al lado de messageById, cuyo comentario dice que transcribir es leer. Trae thread/channel/account/jid para decidir.
  return db().prepare(`SELECT id, media, ts, thread, channel, account, jid FROM messages
    WHERE mediaType='audio' AND media IS NOT NULL AND media!='' AND (dir!='out' OR thread='self')
      AND (summary IS NULL OR summary='') AND ts >= ?
    ORDER BY ts DESC LIMIT ?`).all(from, limit * 3 + 10).filter((r) => !isSecretRow(r)).slice(0, limit)
}
// un mensaje por id (o undefined). (era meetings.reprocessMeeting)
// 🔒 mismo criterio que getBody: sin 2º PIN, un mensaje de fuente secreta no se entrega por id (reenviarlo, transcribirlo
// o resumirlo son formas de leerlo). Los llamadores derivados (crons, reuniones) no pasan secretOn a propósito.
export function messageById(id, { secretOn = false } = {}) {
  const r = db().prepare("SELECT * FROM messages WHERE id=?").get(id)
  if (!r || (!secretOn && isSecretRow(r))) return undefined
  return r
}

// ── absorbidas en Wave 4 (signals — señales para coach/home) ──
// mensajes salientes recientes (para detectar promesas cumplidas/pendientes). (era signals.promises)
export function recentOutbound(since) {
  return db().prepare("SELECT m.thread, m.jid, m.text, m.ts, m.channel, m.account, s.last_ts FROM messages m LEFT JOIN thread_stats s ON s.thread=m.thread WHERE m.dir='out' AND m.ts>? AND length(m.text)>6 ORDER BY m.ts DESC LIMIT 800").all(since).filter((r) => !isSecretRow(r)) // 🔒
}
// hilos cuyo ÚLTIMO mensaje es entrante y tiene "?" (preguntas sin responder, sin grupos). (era signals.unansweredQuestions)
export function lastInboundQuestions(since, { limit } = {}) {
  return db().prepare(`SELECT m.thread, m.name, m.text, m.ts, m.channel, m.account, m.jid FROM messages m JOIN thread_stats s ON s.thread=m.thread AND s.last_ts=m.ts
    WHERE m.dir!='out' AND m.ts>? AND m.text LIKE '%?%' AND length(m.text)>6 AND m.grp IS NULL AND m.thread NOT LIKE '%@g.us' ORDER BY m.ts DESC LIMIT ?`).all(since, limit).filter((r) => !isSecretRow(r)) // 🔒
}
// hilos cuyo ÚLTIMO mensaje es TUYO (saliente) — bola en su cancha. (era signals.waitingOnThem)
export function lastOutboundPerThread(since, { limit } = {}) {
  return db().prepare(`SELECT m.thread, m.text, m.ts, m.channel, m.account, m.jid FROM messages m JOIN thread_stats s ON s.thread=m.thread AND s.last_ts=m.ts
    WHERE m.dir='out' AND m.ts>? AND length(m.text)>10 AND m.thread NOT LIKE 'whatsapp:%@g.us' AND m.thread!='self' ORDER BY m.ts DESC LIMIT ?`).all(since, limit).filter((r) => !isSecretRow(r)) // 🔒
}
// hilos cuyo ÚLTIMO mensaje es entrante (pendientes de respuesta, sin grupos). (era signals.pendingReplies)
export function lastInboundPerThread(since, maxTs, { limit } = {}) {
  return db().prepare(`SELECT m.thread, m.name, m.text, m.ts, m.channel, m.account, m.jid FROM messages m JOIN thread_stats s ON s.thread=m.thread AND s.last_ts=m.ts
    WHERE m.dir!='out' AND m.ts>? AND m.ts<? AND length(m.text)>8 AND m.thread!='self' AND m.grp IS NULL AND m.thread NOT LIKE '%@g.us' ORDER BY m.ts DESC LIMIT ?`).all(since, maxTs, limit).filter((r) => !isSecretRow(r)) // 🔒
}
// texto de las notas propias (Mis Notas) recientes. (era signals.recentNotes)
export function selfNotesText({ limit } = {}) {
  const s = _selfSecretAnd("messages") // 🔒
  return db().prepare(`SELECT text, ts FROM messages WHERE thread='self' AND text!='' AND length(text)>4${s.sql} ORDER BY ts DESC LIMIT ?`).all(...s.params, limit)
}

// ── absorbidas en Wave 4 (extract-actions + home-brief) ──
// ts máximo en messages, con fallback si está vacío. (era extract-actions)
export function maxMessageTs(fallback = 0) {
  return db().prepare("SELECT COALESCE(MAX(ts),?) m FROM messages").get(fallback).m
}
// hilos 1:1 reales con actividad nueva desde una marca (excluye email/grupos/status/spam/self). (era extract-actions)
export function activeThreadsSince(since, { limit } = {}) {
  const h = _hideAnd("thread") // 🔒 excluye hilos 100%-secretos del extractor de acciones
  return db().prepare(`SELECT thread, MAX(ts) mx, MAX(name) name FROM messages
  WHERE ts > ? AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE 'email:%'
    AND thread NOT LIKE 'spam:%' AND thread NOT LIKE '%@newsletter%' AND thread NOT LIKE '%@broadcast%'
    AND thread!='self' AND thread!=''${h.sql}
  GROUP BY thread ORDER BY mx DESC LIMIT ?`).all(since, ...h.params, limit)
}
// cola de mensajes con texto de un hilo (para armar el transcript del extractor). (era extract-actions)
export function threadTextTail(thread, { limit = 22 } = {}) {
  // 🔒 transcript para el extractor de acciones — descarta mensajes de canal secreto (no generan todos/promesas sin 2º PIN)
  return db().prepare("SELECT dir,name,text,ts,channel,account,jid FROM messages WHERE thread=? AND text IS NOT NULL AND text!='' ORDER BY ts DESC LIMIT ?").all(thread, limit).filter((m) => !isSecretRow({ ...m, thread }))
}
// mensajes (thread/ts/dir) para calcular la tasa de respuesta <24h de la Home. (era home-brief.computeKpis)
export function messagesForResponseRate(since) {
  const h = _hideAnd("thread") // 🔒 no computar la tasa de respuesta con hilos 100%-secretos
  return db().prepare(`SELECT thread, ts, dir FROM messages WHERE ts > ? AND dir IN ('in','out')
      AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE 'email:%' AND thread!='self' AND thread!=''${h.sql} ORDER BY thread, ts`).all(since, ...h.params)
}
// nº de hilos 1:1 distintos a los que escribí desde una marca (contactos activos). (era home-brief)
export function activeOutboundThreads(since) {
  const h = _hideAnd("thread") // 🔒
  return db().prepare(`SELECT COUNT(DISTINCT thread) c FROM messages WHERE dir='out' AND ts>? AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread!='self'${h.sql}`).get(since, ...h.params).c || 0
}
// llamadas entrantes/perdidas recientes (mediaType='call'). (era home-brief.computeCalls)
export function recentCalls(since, { limit = 30 } = {}) {
  return db().prepare("SELECT thread, name, text, ts, jid, channel, account FROM messages WHERE mediaType='call' AND dir!='out' AND ts > ? ORDER BY ts DESC LIMIT ?").all(since, limit).filter((r) => !isSecretRow(r)) // 🔒
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
// 🔒 los tres agregados del review semanal (coach) excluyen lo secreto: no solo por el contenido — un contador que sube
// de más, o un contacto en el "top", ya delata que la conversación existe. Es lo que promete el modo: no existe en ningún lado.
export function sentCountSince(since) {
  const h = _hideAnd("thread"), s = _selfSecretAnd("messages")
  return db().prepare(`SELECT COUNT(*) c FROM messages WHERE dir='out' AND ts>?${h.sql}${s.sql}`).get(since, ...h.params, ...s.params).c
}
// conteo de recibidos reales (no self/spam/broadcast) desde una marca. (era brain.weeklyReview)
export function recvCountSince(since) {
  const h = _hideAnd("thread"), s = _selfSecretAnd("messages")
  return db().prepare(`SELECT COUNT(*) c FROM messages WHERE dir!='out' AND ts>? AND thread!='self' AND thread NOT LIKE '%status@broadcast%' AND thread NOT LIKE 'spam:%'${h.sql}${s.sql}`).get(since, ...h.params, ...s.params).c
}
// hilos con más ida y vuelta desde una marca (para el review semanal). (era brain.weeklyReview)
export function topThreadsSince(since, { limit = 12 } = {}) {
  const h = _hideAnd("thread"), s = _selfSecretAnd("messages") // 🔒 el "top de contactos" nombraba el hilo secreto y su nivel de actividad
  return db().prepare(`SELECT thread, COUNT(*) c FROM messages WHERE ts>? AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE '%@newsletter' AND thread NOT LIKE '%status@broadcast%' AND thread NOT LIKE 'spam:%' AND thread!='self'${h.sql}${s.sql} GROUP BY thread ORDER BY c DESC LIMIT ?`).all(since, ...h.params, ...s.params, limit)
}
// todos los mensajes de un hilo (cualquier dir) desde una marca. (era brain.summarizeChat)
export function threadMessagesSinceAll(key, since, { limit = 500 } = {}) {
  // 🔒 resumen "lo que me perdí" — sin mensajes de canal secreto (hilos parciales)
  return db().prepare("SELECT * FROM messages WHERE thread=? AND ts > ? ORDER BY ts ASC LIMIT ?").all(key, since, limit).filter((m) => !isSecretRow(m))
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
  // 🔒 el person-card no debe muestrear mensajes de canal secreto (contacto parcial con línea secreta + no-secreta)
  return db().prepare("SELECT rowid, channel, account, jid FROM messages WHERE thread=? AND text!='' AND text NOT LIKE 'http%' AND text NOT LIKE '%Nota de voz%' ORDER BY ts").all(key)
    .filter((r) => !isSecretRow({ ...r, thread: key })).map((r) => ({ rowid: r.rowid }))
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
// DESTINOS de los canales de mensajería DIRECTA (telegram/slack/signal/teams/…): un destino por (canal, jid) visto en el hilo.
// Sin esto threadTargets() solo sabía de WhatsApp y email, así que un hilo de Telegram no ofrecía ningún destino: el compositor
// mandaba sin canal y sendReply terminaba buscando una sala de WhatsApp inexistente. Resultado: 0 mensajes enviados en su historia.
export function directPeersOf(key, channels) {
  if (!channels || !channels.length) return []
  const qs = channels.map(() => "?").join(",")
  return db().prepare(
    `SELECT channel, jid, MAX(ts) last FROM messages WHERE thread=? AND channel IN (${qs}) AND jid!='' GROUP BY channel, jid ORDER BY last DESC`
  ).all(key, ...channels)
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
  return db().prepare("SELECT id, account, text FROM messages WHERE thread=? AND channel='email' AND dir!='out' ORDER BY ts DESC LIMIT 1").get(key) || db().prepare("SELECT id, account, text FROM messages WHERE thread=? AND channel='email' ORDER BY ts DESC LIMIT 1").get(key)
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
  // 🔒 los cuerpos van a un resumidor. Hoy solo los tapa smartChain({sensitive}); si el usuario elige "resumen de emails"
  // en la nube desde la Consola —opción legítima— salían enteros. El filtro va acá, no en la política del modelo.
  return db().prepare(`SELECT id, name, text, body, thread, channel, account, jid FROM messages
  WHERE channel='email' AND body IS NOT NULL AND (summary IS NULL OR summary='') ORDER BY ts DESC LIMIT ?`).all(limit * 3 + 10)
    .filter((r) => !isSecretRow(r)).slice(0, limit)
}
