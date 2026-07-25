// identity-repo — re-keying / merge / dedup / unificación de hilos. Todo transaccional/atómico.
// Cuerpos movidos verbatim desde db.mjs; `db` = alias de handle() de db-core.
import { handle as db, withRetry } from "./db-core.mjs"
import { rebuildStats } from "./ingest-repo.mjs"
import { phoneOf, isContainerJid, MY_NUMBERS } from "./thread.mjs"

// nombre de agenda de un número SOLO si es ÚNICO (no homónimo): si el mismo nombre está en 2+ números, keyear por nombre fusionaría
// personas DISTINTAS en un hilo → responderías al equivocado. Compartido por las 3 funciones de re-key (antes solo rekeyContacts lo tenía).
function safeName(contactsMap, num) {
  const nm = contactsMap[num]; if (!nm) return null
  let c = 0; for (const v of Object.values(contactsMap)) if (v === nm && ++c > 1) return null
  return nm
}

// re-etiqueta hilos WhatsApp 1:1 (número) → nombre del contacto, para unificar con bridge/email. Devuelve #hilos migrados.
export function rekeyContacts(contactsMap) {
  const rows = db().prepare("SELECT DISTINCT thread FROM messages WHERE channel='whatsapp' AND thread LIKE 'whatsapp:%@s.whatsapp.net'").all()
  const upd = db().prepare("UPDATE messages SET thread=? WHERE thread=?")
  const tx = db().transaction((list) => {
    let n = 0
    for (const { thread } of list) {
      const num = thread.replace(/^whatsapp:/, "").replace(/@.*/, "")
      const name = safeName(contactsMap, num) // homónimo → null → queda keyed por número (jid), no fusionado
      if (name) { upd.run(name, thread); n++ }
    }
    return n
  })
  const migrated = tx(rows)
  rebuildStats()
  return migrated
}

// re-etiqueta TODOS los emails por la dirección del contraparte (email:<addr>), salvo los cubiertos por reglas manuales.
// Arregla los merges erróneos del grafo (emails de gente distinta agrupados bajo un mismo nombre).
export function rekeyEmails(manual = {}) {
  const manualEmails = new Set(Object.keys(manual).filter((k) => k.includes("@")).map((k) => k.toLowerCase()))
  const rows = db().prepare("SELECT DISTINCT jid FROM messages WHERE channel='email' AND jid!=''").all()
  const upd = db().prepare("UPDATE messages SET thread=? WHERE channel='email' AND LOWER(jid)=? AND thread!=?")
  let n = 0
  const tx = db().transaction(() => {
    for (const { jid } of rows) {
      const addr = jid.toLowerCase().trim()
      if (manualEmails.has(addr)) continue // lo cubre la regla manual (ej: ana@ → Ana García)
      n += upd.run("email:" + addr, addr, "email:" + addr).changes
    }
  })
  tx(); rebuildStats(); return n
}

// re-etiqueta mensajes del BRIDGE (matrix) 1:1 por el número del sender (@whatsapp_<num>) → nombre de contacto. NO toca grupos.
export function rekeyBridge(contactsMap) {
  // Resuelve hilos del bridge Matrix (WhatsApp) keyed por sala "!room" o por número → nombre/número canónico.
  // Detección DM vs grupo ROBUSTA: cuenta números REALES distintos (phoneOf resuelve LID→número) entre los remitentes entrantes.
  // Exactamente 1 número = 1:1 (aunque tenga LID + número + mi saliente = varios "sender" crudos). >1 = grupo real → no se toca.
  const D = db()
  // NUNCA relabelear un GRUPO como 1:1. El filtro excluía @g.us pero NO los portales !room del bridge:
  // un grupo donde en la ventana capturada escribió UN solo miembro (nums.size===1) se colapsaba al contacto de ese miembro
  // (mensajes de grupo apareciendo como chat personal). Excluir todo thread que tenga mensajes con grp (marca de grupo) lo evita.
  const threads = D.prepare(`SELECT DISTINCT thread FROM messages
    WHERE account='matrix' AND channel='whatsapp' AND thread NOT LIKE '%@g.us'
    AND thread NOT IN (SELECT thread FROM messages WHERE grp IS NOT NULL AND grp != '')`).all()
  const inSenders = D.prepare(`SELECT DISTINCT sender FROM messages
    WHERE thread=? AND dir='in' AND sender LIKE '@whatsapp\\_%' ESCAPE '\\'`)
  const upd = D.prepare("UPDATE messages SET thread=? WHERE thread=?")
  // .immediate: BEGIN IMMEDIATE toma el write-lock YA → busy_timeout/withRetry aplican. Sin él, la tx DIFERIDA lee (inSenders.all)
  // antes de escribir → SQLITE_BUSY_SNAPSHOT que busy_timeout NO reintenta → resolve-identities moría y unifyByNumber/etc no corrían.
  const tx = D.transaction(() => {
    let n = 0
    for (const t of threads) {
      const nums = new Set()
      for (const r of inSenders.all(t.thread)) { const p = phoneOf(r.sender); if (p && !MY_NUMBERS.has(p)) nums.add(p) } // excluir mis cuentas
      if (nums.size !== 1) continue // 0 = no resoluble; >1 = grupo real → dejar
      const num = [...nums][0]
      const target = safeName(contactsMap, num) || `whatsapp:${num}@s.whatsapp.net` // homónimo → hilo por número (no fusionar personas distintas)
      if (target !== t.thread) n += upd.run(target, t.thread).changes
    }
    return n
  }).immediate
  const n = withRetry(() => tx()); if (n > 0) rebuildStats(); return n // solo reconstruir stats si movimos algo
}

// DEDUP: el mismo mensaje capturado por varias fuentes (2+ teléfonos, bridge viejo) → aparece repetido.
// Mismo (thread, ts, dir, contenido) = mismo mensaje. Se queda con el mejor (con media, sender resuelto). Reconstruye FTS.
export function dedupMessages() {
  const before = db().prepare("SELECT COUNT(*) c FROM messages").get().c
  db().exec(`
    DELETE FROM messages WHERE rowid NOT IN (
      SELECT rowid FROM (
        SELECT rowid, ROW_NUMBER() OVER (
          PARTITION BY thread, ts, dir, COALESCE(mediaType, text)
          ORDER BY (media IS NOT NULL) DESC, (sender NOT LIKE '%@lid') DESC, LENGTH(name) ASC, rowid ASC
        ) rn FROM messages WHERE thread!=''
      ) WHERE rn=1
    ) AND thread!=''`)
  // reconstruir FTS (external-content; solo tenía trigger de insert) + stats
  try { db().exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')") } catch {}
  rebuildStats()
  const after = db().prepare("SELECT COUNT(*) c FROM messages").get().c
  return { antes: before, despues: after, eliminados: before - after }
}

// CORRIDA: unifica TODOS los hilos 1:1 de WhatsApp que compartan el mismo número real (jid, sender del bridge, o LID→número).
// Devuelve {grupos, hilosFusionados, mensajesMovidos}. NO toca grupos.
export function unifyByNumber(contactsMap = {}) {
  const D = db()
  // hilos 1:1 (NO contenedores). Ojo: NO filtrar por nsenders — un 1:1 fusionado tiene varios nombres de remitente y es válido.
  const threads = D.prepare("SELECT thread, count FROM thread_stats").all()
    .filter((t) => t.thread !== "self" && !isContainerJid(t.thread.replace(/^whatsapp:/, "")) && !/@g\.us/.test(t.thread)) // NUNCA tocar "self" (Mis Notas)
  const sampleJid = D.prepare("SELECT jid, sender FROM messages WHERE thread=? AND channel='whatsapp' AND (jid LIKE '%@s.whatsapp.net' OR jid LIKE '%@lid' OR sender LIKE '@whatsapp\\_%' ESCAPE '\\') LIMIT 20")
  const byNum = {}
  for (const t of threads) {
    const rows = sampleJid.all(t.thread)
    if (!rows.length) continue
    // número dominante del hilo — EXCLUIR mis números (si no, mis mensajes salientes agrupan hilos ajenos bajo mi número)
    const counts = {}
    for (const r of rows) { const n = phoneOf(r.jid) || phoneOf(r.sender); if (n && !MY_NUMBERS.has(n)) counts[n] = (counts[n] || 0) + 1 }
    const num = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!num) continue
    ;(byNum[num] = byNum[num] || []).push({ thread: t.thread, count: t.count })
  }
  const upd = D.prepare("UPDATE messages SET thread=? WHERE thread=?")
  let grupos = 0, fusionados = 0, movidos = 0
  const tx = D.transaction(() => {
    for (const [num, ts] of Object.entries(byNum)) {
      if (ts.length < 2) continue
      grupos++
      // target: el nombre de agenda si existe; si no, el hilo con más mensajes
      const target = safeName(contactsMap, num) || ts.sort((a, b) => b.count - a.count)[0].thread // homónimo → hilo con más mensajes (no fusionar)
      for (const t of ts) { if (t.thread !== target) { movidos += upd.run(target, t.thread).changes; fusionados++ } }
    }
  })
  tx(); rebuildStats()
  return { grupos, fusionados, movidos }
}

// fusiona hilos: mueve todos los mensajes de <sources[]> al hilo <target>. Para "es la misma persona".
export function mergeThreads(target, sources) {
  const upd = db().prepare("UPDATE messages SET thread=? WHERE thread=?")
  let n = 0
  const tx = db().transaction(() => { for (const s of sources) { if (s !== target) n += upd.run(target, s).changes } })
  tx(); rebuildStats(); return n
}

// re-etiqueta hilos 1:1 según identidades manuales. NUNCA toca grupos (matchea por JID de la conversación, no por sender).
export function rekeyManual(manual) {
  // primero: devolver a su grupo cualquier mensaje de grupo que haya quedado mal asignado a un hilo de persona
  db().exec("UPDATE messages SET thread = channel||':'||jid WHERE (jid LIKE '%@g.us' OR jid LIKE '%@thread.v2' OR jid LIKE '%@broadcast' OR jid LIKE '%@newsletter') AND thread != channel||':'||jid")
  const updExact = db().prepare("UPDATE messages SET thread=? WHERE LOWER(jid)=? AND thread!=?") // email o jid exacto (chat 1:1)
  const updNum = db().prepare("UPDATE messages SET thread=? WHERE jid LIKE ? AND jid NOT LIKE '%@g.us' AND jid NOT LIKE '%@thread.v2' AND thread!=?") // número → SU chat 1:1
  let n = 0
  const tx = db().transaction(() => {
    for (const [id, name] of Object.entries(manual)) {
      const low = id.toLowerCase()
      if (/^\d{8,}$/.test(low)) n += updNum.run(name, low + "@%", name).changes
      else n += updExact.run(name, low, name).changes
    }
  })
  tx(); rebuildStats(); return n
}
