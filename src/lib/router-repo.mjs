// router-repo — router por facetas (búsqueda barata pre-computada) + grafo ponderado v2.
// Cuerpos movidos verbatim desde db.mjs; `db` = alias de handle() de db-core.
import { handle as db, withRetry } from "./db-core.mjs"

// ══════════ ROUTER POR FACETAS (búsqueda barata pre-computada) ══════════
const _stopFacet = new Set(["que", "con", "por", "para", "los", "las", "una", "del", "como", "sobre", "cual", "the", "and", "mas", "todo", "este", "esta", "hola", "buenas", "gracias", "saludos"])
const normFacet = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 60)
// hilos que necesitan (re)enriquecerse: nuevos, o con mensajes más nuevos que el último enriquecimiento. Los más activos primero.
export function staleConversations(limit = 30) {
  return db().prepare(`SELECT s.thread, s.last_ts, s.count, s.channels FROM thread_stats s
    LEFT JOIN conversations c ON c.thread=s.thread
    WHERE s.thread!='' AND s.thread!='self' AND s.thread!='spam:status' AND (c.thread IS NULL OR s.last_ts > c.enriched_last_ts)
    ORDER BY s.last_ts DESC LIMIT ?`).all(limit)
}
// guarda el enriquecimiento de una conversación + reconstruye sus facetas (entidad/tag/keyword, expandiendo palabras).
export function saveConversation(thread, d = {}) {
  const D = db()
  const convUpsert = D.prepare(`INSERT INTO conversations(thread,name,channels,summary,entities,tags,keywords,n_msgs,first_ts,last_ts,enriched_last_ts,enriched_at)
    VALUES(@thread,@name,@channels,@summary,@entities,@tags,@keywords,@n_msgs,@first_ts,@last_ts,@last_ts,@now)
    ON CONFLICT(thread) DO UPDATE SET name=@name,channels=@channels,summary=@summary,entities=@entities,tags=@tags,keywords=@keywords,n_msgs=@n_msgs,first_ts=@first_ts,last_ts=@last_ts,enriched_last_ts=@last_ts,enriched_at=@now`)
  const del = D.prepare("DELETE FROM conv_facets WHERE thread=?")
  const ins = D.prepare("INSERT INTO conv_facets(thread,kind,facet) VALUES(?,?,?)")
  // TODO en UNA tx (+withRetry): antes el upsert de conversations (que avanza enriched_last_ts) era autocommit ANTES de reescribir
  // conv_facets; si la 2ª parte fallaba, el hilo quedaba marcado enriquecido con facetas VIEJAS y staleConversations no lo re-encolaba.
  const tx = D.transaction(() => {
    del.run(thread) // DELETE primero → el BEGIN es de ESCRITURA (write-lock ya) → busy_timeout/withRetry aplican
    convUpsert.run({ thread, name: d.name || "", channels: d.channels || "", summary: d.summary || "",
      entities: JSON.stringify(d.entities || []), tags: JSON.stringify(d.tags || []), keywords: JSON.stringify(d.keywords || []),
      n_msgs: d.n_msgs || 0, first_ts: d.first_ts || 0, last_ts: d.last_ts || 0, now: Date.now() })
    const seen = new Set()
    const put = (kind, f) => { const v = normFacet(f); if (!v || v.length < 3 || _stopFacet.has(v) || seen.has(kind + ":" + v)) return; seen.add(kind + ":" + v); ins.run(thread, kind, v) }
    const add = (kind, arr) => {
      for (const f of arr || []) {
        const v = normFacet(f); if (!v) continue; put(kind, v)
        if (kind === "entity" || kind === "keyword") for (const w of v.split(" ")) if (w.length >= 3) put(kind, w) // "juan pérez" → +juan +pérez
      }
    }
    add("entity", d.entities); add("tag", d.tags); add("keyword", d.keywords)
  }).immediate
  withRetry(() => tx())
}
// devuelve las filas {thread,kind,facet} que matchean EXACTO alguna de las facetas candidatas (indexado).
export function facetThreads(cands = []) {
  if (!cands.length) return []
  const ph = cands.map(() => "?").join(",")
  return db().prepare(`SELECT thread, kind, facet FROM conv_facets WHERE facet IN (${ph})`).all(...cands)
}
export function conversationsByThreads(threads = []) {
  if (!threads.length) return []
  const ph = threads.map(() => "?").join(",")
  return db().prepare(`SELECT * FROM conversations WHERE thread IN (${ph})`).all(...threads)
}
export function convStats() { return { enriched: db().prepare("SELECT COUNT(*) c FROM conversations").get().c, total: db().prepare("SELECT COUNT(*) c FROM thread_stats").get().c, facets: db().prepare("SELECT COUNT(*) c FROM conv_facets").get().c } }

// PODA de conversaciones HUÉRFANAS: filas de conversations/conv_facets cuyo thread ya no tiene mensajes (quedaron tras un re-key
// que movió los mensajes a otro hilo). thread_stats se reconstruye entero en rebuildStats, pero conversations no → el contacto
// fantasma sobrevivía. Devuelve cuántas filas borró.
export function pruneOrphanConversations() {
  const D = db()
  const noMsgs = "thread NOT IN (SELECT DISTINCT thread FROM messages WHERE thread IS NOT NULL AND thread != '')"
  const dc = D.prepare(`DELETE FROM conversations WHERE ${noMsgs}`).run().changes
  let df = 0; try { df = D.prepare(`DELETE FROM conv_facets WHERE ${noMsgs}`).run().changes } catch {}
  return { conversations: dc, facets: df }
}

// ── GRAFO PONDERADO v2 (tags con puntajes por grafo + activación por difusión) ──
export function graphVocabulary() { return db().prepare("SELECT DISTINCT kind, facet FROM conv_facets").all() } // qué nodos existen (descubiertos por el enrichment)
export function replaceGraphEdges(rows) { // swap atómico (como rebuildStats): morir a mitad no deja el grafo a medias
  const D = db(); const ins = D.prepare("INSERT OR REPLACE INTO graph_edges(node,thread,kind,weight) VALUES(?,?,?,?)")
  const run = D.transaction((rs) => { D.exec("DELETE FROM graph_edges"); for (const r of rs) ins.run(r.node, r.thread, r.kind, r.weight) })
  for (let a = 0; a < 6; a++) { // reintento ante SQLITE_BUSY: la ingesta cada 15s puede tener el lock justo en el swap
    try { run(rows); return rows.length }
    catch (e) { if ((e.code === "SQLITE_BUSY" || /locked/.test(e.message || "")) && a < 5) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700 * (a + 1)); continue } throw e }
  }
  return rows.length
}
export function graphEdgesFor(nodes = []) { if (!nodes.length) return []; const ph = nodes.map(() => "?").join(","); return db().prepare(`SELECT node, thread, kind, weight FROM graph_edges WHERE node IN (${ph})`).all(...nodes) }
// 2º salto: nodos que CO-OCURREN con las semillas (Juan ↔ deuda) → energía se propaga a más contenido
export function graphCoNodes(seeds = [], { limit = 6 } = {}) {
  if (!seeds.length) return []; const ph = seeds.map(() => "?").join(",")
  return db().prepare(`SELECT b.node AS node, b.kind AS kind, SUM(a.weight*b.weight) AS s
    FROM graph_edges a JOIN graph_edges b ON a.thread=b.thread
    WHERE a.node IN (${ph}) AND b.node NOT IN (${ph}) GROUP BY b.node ORDER BY s DESC LIMIT ?`).all(...seeds, ...seeds, limit)
}
export function graphStats() { return { edges: db().prepare("SELECT COUNT(*) c FROM graph_edges").get().c, nodes: db().prepare("SELECT COUNT(DISTINCT node) c FROM graph_edges").get().c } }
