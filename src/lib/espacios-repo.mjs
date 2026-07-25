// espacios-repo — matching de mensajes por reglas de espacio (email/dominio/teléfono/nombre).
// Cuerpo movido verbatim desde db.mjs; `db` = alias de handle() de db-core.
import { handle as db } from "./db-core.mjs"

// mensajes que matchean las reglas de un espacio: email exacto, dominio (@colegio.edu.pe), teléfono, o nombre.
// matchea mensajes por reglas (email/dominio/teléfono/nombre) DINÁMICAMENTE → retroactivo por diseño (toda la DB, pasado y futuro).
// `exclude`: reglas a RESTAR (para subcanales "Otros"/catch-all = el dominio del padre menos lo que ya reclaman los hermanos).
export function espacioMessages(rules = [], { limit = 20, exclude = [], sinceTs = 0 } = {}) {
  const build = (rs) => {
    const clauses = [], args = []
    for (const r of rs || []) {
      const v = String(r?.value || "").trim().toLowerCase(); if (!v) continue
      if (r.type === "email") { clauses.push("(channel='email' AND lower(jid)=?)"); args.push(v) }
      else if (r.type === "domain") { const d = v.replace(/^@/, ""); clauses.push("(channel='email' AND (lower(jid) LIKE ? OR lower(jid) LIKE ?))"); args.push("%@" + d, "%." + d) } // dominio + SUBdominios (edocs.banbif.com.pe entra por 'banbif.com.pe')
      else if (r.type === "phone") { const n = v.replace(/\D/g, ""); if (n.length < 6) continue; clauses.push("(replace(lower(thread),' ','') LIKE ? OR lower(jid) LIKE ? OR lower(sender) LIKE ?)"); args.push("%" + n + "%", "%" + n + "%", "%" + n + "%") }
      else if (r.type === "name") { clauses.push("(lower(name)=? OR lower(thread)=?)"); args.push(v, v) }
    }
    return { clauses, args }
  }
  const inc = build(rules)
  if (!inc.clauses.length) return { count: 0, recent: [] }
  const exc = build(exclude)
  let where = "(" + inc.clauses.join(" OR ") + ")"
  const args = [...inc.args]
  if (exc.clauses.length) { where += " AND NOT (" + exc.clauses.join(" OR ") + ")"; args.push(...exc.args) }
  const count = db().prepare(`SELECT COUNT(*) c FROM messages WHERE ${where}`).get(...args).c
  const recent = db().prepare(`SELECT channel,name,text,ts,dir,thread FROM messages WHERE ${where} ORDER BY ts DESC LIMIT ?`).all(...args, limit)
  // no leídos: entrantes más nuevos que la última vez que abrí el espacio
  const unread = sinceTs ? db().prepare(`SELECT COUNT(*) c FROM messages WHERE ${where} AND dir='in' AND ts>?`).get(...args, sinceTs).c : 0
  return { count, recent, unread }
}
