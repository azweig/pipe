// meta-repo — KV (meta) + listas de acción (clips; todos/promesas se absorben en waves siguientes).
// Cuerpos movidos verbatim desde db.mjs; `db` = alias de handle() de db-core.
// Los identificadores dinámicos de tabla se resuelven por allowlist (ver clipFlag: field ∈ {pinned, archived}).
import { handle as db, withRetry } from "./db-core.mjs"
import { secretSelfClause, secretThreadKeys, secretGate } from "./secret.mjs"

// 🔒 " AND NOT (<secret>)" para queries de 'self' (Notas): oculta clips de canal secreto sin 2º PIN.
function _selfSecretAnd(alias = "m") { const c = secretSelfClause(alias); return c.clause ? { sql: ` AND NOT (${c.clause})`, params: c.params } : { sql: "", params: [] } }

// pin/archivo de un clip (por id del mensaje self). Crea la fila de clip si no existía (aún sin enriquecer).
export function clipFlag(id, field, on) {
  if (!["pinned", "archived"].includes(field) || !id) return { error: "inválido" }
  const D = db()
  D.prepare("INSERT INTO clips(id, created) VALUES(?, ?) ON CONFLICT(id) DO NOTHING").run(id, Date.now())
  D.prepare(`UPDATE clips SET ${field}=? WHERE id=?`).run(on ? 1 : 0, id)
  return { ok: true, id, field, on: !!on }
}

export function getMeta(k) { const r = db().prepare("SELECT v FROM meta WHERE k=?").get(k); return r ? r.v : null }
export function delMeta(k) { return withRetry(() => db().prepare("DELETE FROM meta WHERE k=?").run(k)) }
// borra por PREFIJO (personcard:/mtgcard:/espcard:). El prefijo es literal (sin comodines del dominio) → no escapamos.
export function delMetaLike(prefix) { return withRetry(() => db().prepare("DELETE FROM meta WHERE k LIKE ?").run(String(prefix) + "%")) }
export function setMeta(k, v) { return withRetry(() => db().prepare("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").run(k, String(v), String(v))) }
export function count() { return db().prepare("SELECT COUNT(*) c FROM messages").get().c }

// ── clips absorbidos en Wave 3 ──
// mensajes de 'self' que aún no tienen fila en clips (candidatos a enriquecer). (era clips.run)
export function clipCandidates({ limit } = {}) {
  const s = _selfSecretAnd("m") // 🔒 no enriquecer (ni persistir) clips de notas secretas
  return db().prepare(`SELECT m.id, m.text, m.mediaType, m.media, m.filename, m.summary, m.ts FROM messages m
    LEFT JOIN clips c ON c.id = m.id
    WHERE m.thread='self' AND c.id IS NULL AND (m.text IS NOT NULL OR m.mediaType IS NOT NULL)${s.sql}
    ORDER BY m.ts DESC LIMIT ?`).all(...s.params, limit)
}
// inserta un clip enriquecido (idempotente por id, OR IGNORE). archived=1 oculta spam/sin-sentido. (era clips.run)
export function insertClip(id, ts, kind, url, title, para, archived, created) {
  return db().prepare("INSERT OR IGNORE INTO clips(id,ts,kind,url,title,para,done,archived,created) VALUES(?,?,?,?,?,?,0,?,?)").run(id, ts, kind, url, title, para, archived, created)
}

// ── listas de acción (todos/promesas) + métricas — absorbidas en Wave 4 ──
// tabla dinámica resuelta por ALLOWLIST (nunca se interpola input), como markDone/setBusyTimeout.
const _ACTION_TABLES = { todos: "todos", promesas: "promesas" }
// tarea nueva (lo que me pidieron / quedó de mi lado). Idempotente por id (OR IGNORE). (era extract-actions)
export function insertTodo(id, text, thread, name, due, ts, created, cita) {
  return withRetry(() => db().prepare("INSERT OR IGNORE INTO todos(id,text,thread,name,due,ts,done,created,cita) VALUES(?,?,?,?,?,?,0,?,?)").run(id, text, thread, name, due, ts, created, cita || null))
}
// promesa nueva (lo que YO me comprometí a hacer). Idempotente por id. (era extract-actions)
export function insertPromesa(id, text, thread, name, due, ts, created, cita) {
  return withRetry(() => db().prepare("INSERT OR IGNORE INTO promesas(id,text,thread,name,due,ts,done,created,cita) VALUES(?,?,?,?,?,?,0,?,?)").run(id, text, thread, name, due, ts, created, cita || null))
}
// listados de PENDIENTES (para el server MCP read-only). Solo lo no-hecho, con la cita textual que respalda cada ítem.
export function listTodos({ limit = 50 } = {}) {
  if (secretGate().blockAll) return [] // el gate no pudo calcularse → no exponemos nada (fail-closed)
  const sk = secretThreadKeys() // 🔒 el MCP read-only tampoco expone acciones de hilos secretos
  return db().prepare("SELECT id, text, thread, name, due, cita, ts, created FROM todos WHERE done=0 ORDER BY created DESC LIMIT ?").all(Math.min(+limit || 50, 100)).filter((r) => !sk.has(r.thread))
}
export function listPromesas({ limit = 50 } = {}) {
  if (secretGate().blockAll) return [] // el gate no pudo calcularse → no exponemos nada (fail-closed)
  const sk = secretThreadKeys() // 🔒
  return db().prepare("SELECT id, text, thread, name, due, cita, ts, created FROM promesas WHERE done=0 ORDER BY created DESC LIMIT ?").all(Math.min(+limit || 50, 100)).filter((r) => !sk.has(r.thread))
}
// ítems abiertos (done=0) de todos|promesas. kind por allowlist. Defensivo (nunca tira). (era home-brief.openActions)
export function openActionItems(kind, { limit = 6 } = {}) {
  const tbl = _ACTION_TABLES[kind]; if (!tbl) return []
  if (secretGate().blockAll) return []
  try { const sk = secretThreadKeys(); return db().prepare(`SELECT id,text,name,due,thread,ts FROM ${tbl} WHERE done=0 ORDER BY ts DESC LIMIT ?`).all(limit).filter((r) => !sk.has(r.thread)) } catch { return [] } // 🔒
}
// marca una tarea/promesa como hecha. kind: "prom"→promesas, cualquier otro→todos (fiel al original). Tabla por allowlist, nunca input crudo. (era brain.actionDone)
const _DONE_TABLES = { prom: "promesas", promesas: "promesas", todo: "todos", todos: "todos" }
export function markDone(kind, id) {
  const tbl = _DONE_TABLES[kind] || "todos"
  return withRetry(() => db().prepare(`UPDATE ${tbl} SET done=1 WHERE id=?`).run(id))
}
// upsert de una métrica diaria (historia de KPIs). (era home-brief.recordMetric)
export function upsertMetric(metric, day, value) {
  return withRetry(() => db().prepare("INSERT INTO metrics(metric,day,value) VALUES(?,?,?) ON CONFLICT(metric,day) DO UPDATE SET value=?").run(metric, day, value, value))
}
// historia reciente de una métrica (más nuevas primero). (era home-brief.deltaOf)
export function metricHistory(metric, { limit = 14 } = {}) {
  return db().prepare("SELECT day, value FROM metrics WHERE metric=? ORDER BY day DESC LIMIT ?").all(metric, limit)
}

// ── clips de Notas (self) — absorbidas en Wave 5 (el where-building sale de brain) ──
const _CLIP_SEL = `SELECT m.id, m.text, m.mediaType, m.media, m.filename, m.summary, m.ts, c.kind ckind, c.url, c.title, c.para, c.done, c.pinned, c.archived FROM messages m LEFT JOIN clips c ON c.id=m.id`
// clips de 'self' filtrados por tipo, paginados hacia atrás. (era brain.notesClips) El mapeo a la vista queda en brain.
export function clipsForNotes({ kind = "all", before = 0, limit = 40 } = {}) {
  const b = before || Number.MAX_SAFE_INTEGER
  let where = "m.thread='self' AND m.ts < ? AND (m.text IS NOT NULL AND m.text!='' OR m.media IS NOT NULL)"
  if (kind === "link") where += " AND m.text LIKE '%http%'"
  else if (kind === "media") where += " AND m.mediaType IN ('image','video','document','file','sticker')"
  else if (kind === "text") where += " AND (m.mediaType IS NULL OR m.mediaType='') AND m.text NOT LIKE '%http%'"
  else if (kind === "todo") where += " AND c.kind='todo'"
  else if (kind === "archived") where += " AND c.archived=1"
  if (kind !== "archived") where += " AND (c.archived IS NULL OR c.archived=0)" // los archivados NO estorban salvo que los pidas
  const s = _selfSecretAnd("m") // 🔒 el feed de Notas no muestra clips de canal secreto sin 2º PIN
  return db().prepare(`${_CLIP_SEL} WHERE ${where}${s.sql} ORDER BY m.ts DESC LIMIT ?`).all(b, ...s.params, limit)
}
// clips fijados (self, no archivados) para mostrar arriba. (era brain.notesClips)
export function pinnedNotesClips() {
  const s = _selfSecretAnd("m") // 🔒
  return db().prepare(`${_CLIP_SEL} WHERE m.thread='self' AND c.pinned=1 AND (c.archived IS NULL OR c.archived=0)${s.sql} ORDER BY m.ts DESC`).all(...s.params)
}
