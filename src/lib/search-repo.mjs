// search-repo — full-text (asunto vía messages_fts, cuerpo de emails vía email_fts) + superficie RAG.
// Cuerpos movidos verbatim desde db.mjs; `db` = alias de handle() de db-core.
import { handle as db } from "./db-core.mjs"
import { secretThreadKeys, isSecretRow } from "./secret.mjs"

const STOP = new Set(["que", "con", "por", "para", "los", "las", "una", "del", "como", "hable", "hablé", "sobre", "cual", "cuando", "donde", "quien", "hay", "the", "and", "que", "mas", "muy"])
const _ftsQ = (terms) => { const w = String(terms).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []; return w.length ? w.map((x) => `"${x}"`).join(" AND ") : null } // todas las palabras presentes (precisión)

// mensajes con media/adjunto dentro de un set de hilos (para intents "buscar memes / documentos").
export function mediaInThreads(threads = [], { docs = false, limit = 40 } = {}) {
  if (!threads.length) return []
  const ph = threads.map(() => "?").join(",")
  const cond = docs ? "filename IS NOT NULL AND filename!=''" : "media IS NOT NULL AND media!=''"
  return db().prepare(`SELECT id,thread,name,text,ts,channel,media,mediaType,filename FROM messages WHERE thread IN (${ph}) AND ${cond} ORDER BY ts DESC LIMIT ?`).all(...threads, limit)
}

export function ftsDocFreq(terms) { const q = _ftsQ(terms); if (!q) return { q: null, total: 0 }; try { return { q, total: db().prepare("SELECT COUNT(*) c FROM messages_fts WHERE messages_fts MATCH ?").get(q).c } } catch { return { q: null, total: 0 } } }
export function ftsThreadCounts(q, { cap = 6000 } = {}) { // hilos que matchean q en TODO el histórico, con conteo (peso de la arista) — full-thread, no tail
  try { return db().prepare(`SELECT m.thread AS thread, COUNT(*) AS c FROM (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ? LIMIT ?) f JOIN messages m ON m.rowid=f.rowid WHERE m.thread!='' AND m.thread!='spam:status' GROUP BY m.thread`).all(q, cap) } catch { return [] }
}
// (re)construye el índice FTS de cuerpos de email. Se corre tras un backfill (que actualiza bodies de filas existentes → el trigger de INSERT no los cubre).
export function rebuildEmailFts() {
  const D = db()
  // ATÓMICO (DELETE+INSERT en UNA transacción): si el proceso muere en el medio → rollback. Sin esto, morir entre el DELETE y el
  // INSERT de 1.96M filas dejaba email_fts VACÍA y searchBody devolviendo [] en silencio (misma lección que rebuildStats).
  D.transaction(() => {
    D.exec("DELETE FROM email_fts")
    D.exec("INSERT INTO email_fts(rowid, body) SELECT rowid, body FROM messages WHERE body IS NOT NULL AND body != ''")
  })()
  return D.prepare("SELECT COUNT(*) c FROM email_fts").get().c
}
// busca en el CUERPO de los emails (donde viven montos/fechas). Devuelve mensajes con un snippet del match.
export function searchBody(query, { limit = 8 } = {}) {
  const words = ((query || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w))
  if (!words.length) return []
  const q = words.map((w) => `"${w}"*`).join(" OR ")
  // 🔒 ídem: trae account/jid para poder decidir, y filtra acá (el snippet del cuerpo va derecho al contexto de la IA)
  try { return db().prepare(`SELECT m.thread, m.name, m.ts, m.channel, m.account, m.jid, snippet(email_fts, 0, '', '', ' … ', 24) AS snip FROM email_fts f JOIN messages m ON m.rowid=f.rowid WHERE email_fts MATCH ? ORDER BY rank LIMIT ?`).all(q, limit * 3 + 10).filter((r) => !isSecretRow(r)).slice(0, limit) } catch { return [] }
}
// cuerpos de email (donde viven montos/fechas, fuera del FTS) en los hilos ruteados que contengan alguno de los términos.
// terms se expanden con la co-ocurrencia del grafo (juan→deuda) para saltar la brecha léxica.
export function bodyMatchInThreads(threads = [], terms = [], { limit = 4 } = {}) {
  if (!threads.length || !terms.length) return []
  const tph = threads.map(() => "?").join(",")
  const uniq = [...new Set(terms.map((t) => String(t).trim()).filter((t) => t.length >= 3))].slice(0, 8)
  if (!uniq.length) return []
  const clauses = uniq.map(() => "body LIKE ?").join(" OR ")
  // 🔒 filtra acá, no en el llamador: los cuerpos de correo alimentan el contexto de ask(). Sin traer channel/account/jid
  // el chequeo por-mensaje devolvía false siempre (isSecretAccount("email", undefined)) y el cuerpo secreto se colaba.
  return db().prepare(`SELECT thread,name,ts,body,channel,account,jid FROM messages WHERE thread IN (${tph}) AND body IS NOT NULL AND body!='' AND (${clauses}) ORDER BY ts DESC LIMIT ?`)
    .all(...threads, ...uniq.map((t) => "%" + t + "%"), limit * 3 + 10).filter((r) => !isSecretRow(r)).slice(0, limit)
}
// archivos/media que están en los hilos ruteados O cuyo nombre/texto contiene alguno de los términos (para "docs de globex" en toda la DB).
export function filesByTerms(terms = [], threads = [], { docs = true, limit = 40 } = {}) {
  const cond = docs ? "filename IS NOT NULL AND filename!=''" : "media IS NOT NULL AND media!=''"
  const clauses = [], args = []
  if (threads.length) { clauses.push(`thread IN (${threads.map(() => "?").join(",")})`); args.push(...threads) }
  for (const t of terms) { const v = "%" + String(t).toLowerCase() + "%"; clauses.push("(lower(filename) LIKE ? OR lower(text) LIKE ?)"); args.push(v, v) }
  if (!clauses.length) return []
  return db().prepare(`SELECT id,thread,name,text,ts,channel,media,mediaType,filename FROM messages WHERE ${cond} AND (${clauses.join(" OR ")}) ORDER BY ts DESC LIMIT ?`).all(...args, limit)
}

// OJO: filtra lo secreto. Era el ÚNICO lector de corpus sin filtro (threads-repo y meta-repo sí lo hacen), y el conector
// MCP lo usa para search_inbox: un cliente MCP preguntando cualquier cosa recibía verbatim los mensajes de las cuentas
// marcadas como secretas, sin 2º PIN en ningún punto del camino.
// El filtro va DESPUÉS del LIMIT del SQL a propósito: pedimos de más y recortamos, para no reescribir la consulta FTS.
// `desde` (ms): recorta a los mensajes posteriores a esa fecha. Hace falta porque preguntar "¿hay alguna urgencia
// HOY?" traía mensajes de 2020 rankeados por relevancia: la respuesta era coherente y completamente inútil.
export function search(query, { limit = 80, byRank = false, desde = 0 } = {}) {
  const words = ((query || "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w))
  if (!words.length) return []
  const ftsq = words.map((w) => `"${w}"*`).join(" OR ")
  const order = byRank ? "rank" : "m.ts DESC" // rank = relevancia (bm25); ts = cronológico
  // OJO: sin copiarlo. Cuando el gate falla cerrado, el set devuelve `true` a cualquier clave pero está VACÍO al recorrerlo
  // — copiarlo a un Set nuevo tira ese "sí a todo" a la basura y el filtro se vuelve fail-open.
  const hide = secretThreadKeys()
  const visible = (rows) => rows.filter((r) => !hide.has(r.thread) && !isSecretRow(r)).slice(0, limit)
  const over = limit * 3 + 30 // margen para que el filtrado no deje la búsqueda corta
  try {
    const corte = desde ? " AND m.ts >= ?" : ""
    const args = desde ? [ftsq, desde, over] : [ftsq, over]
    return visible(db().prepare(`SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid=f.rowid
      WHERE messages_fts MATCH ?${corte} ORDER BY ${order} LIMIT ?`).all(...args))
  } catch {
    const corte = desde ? " AND ts >= ?" : ""
    const args = desde ? ["%" + words[0] + "%", desde, over] : ["%" + words[0] + "%", over]
    return visible(db().prepare(`SELECT * FROM messages WHERE text LIKE ?${corte} ORDER BY ts DESC LIMIT ?`).all(...args))
  }
}
// corpus completo para reindexar. 🔒 Filtra los canales secretos en el ORIGEN: lo que entre acá termina vectorizado y
// saliendo en respuestas de IA, donde ya no hay forma de distinguirlo. Necesita account/jid para decidir por-mensaje.
export function allForRag({ since = 0 } = {}) {
  return db().prepare("SELECT id, channel, thread, name, text, ts, grp, account, jid FROM messages WHERE ts>? AND text!='' ORDER BY ts ASC").all(since)
    .filter((r) => !isSecretRow(r))
}

// reconstruye el índice FTS de asuntos/nombres (external-content: el trigger solo cubre INSERT, no UPDATE). (era meetings.updateMeeting) Wave 3.
export function rebuildMessagesFts() {
  db().exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
}
