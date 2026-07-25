// Router por facetas: decide barato (SQL, 0 tokens) a qué conversación(es) apunta una consulta,
// antes de gastar en el LLM. La síntesis/fallback vive en brain.routerSearch.
import { facetThreads, graphEdgesFor, graphCoNodes } from "./db.mjs"

const STOP = new Set(["que", "con", "por", "para", "los", "las", "una", "del", "como", "sobre", "cual", "cuando", "donde", "quien", "the", "and", "mas", "muy", "hay", "dame", "busca", "buscame", "buscar", "necesito", "quiero", "ver", "mostrar", "mostrame", "todos", "todas", "sus", "mis", "esto", "eso", "esa", "ese"])

// tokens (3+) + bigramas de la consulta → candidatos a faceta (para pescar "via cargo", "juan pérez", etc.)
export function queryFacets(q) {
  const toks = ((q || "").toLowerCase().normalize("NFC").match(/[\p{L}\p{N}]{3,}/gu) || []).filter((w) => !STOP.has(w))
  const set = new Set(toks)
  for (let i = 0; i < toks.length - 1; i++) set.add(toks[i] + " " + toks[i + 1])
  return [...set]
}

const MEDIA = /\b(memes?|fotos?|imagen|im[aá]genes|videos?|gifs?|stickers?|audios?|nota de voz)\b/i
const DOC = /\b(document[oa]s?|documentaci[oó]n|archivos?|adjuntos?|pdf|excel|planillas?|contratos?|facturas?|comprobantes?)\b/i

// tipo de intención: BUSCAR (traer media/docs, sin LLM) vs PREGUNTA (sintetizar respuesta).
export function parseIntent(q) {
  const s = (q || "").toLowerCase()
  if (MEDIA.test(s)) return { type: "find", want: "media" }
  if (DOC.test(s)) return { type: "find", want: "doc" }
  return { type: "ask" }
}

const W = { entity: 3, tag: 2, keyword: 1 }
// enruta: puntúa conversaciones por facetas matcheadas (poda: se queda con las mejores). Confiado solo si hay entidad/tag claros.
export function route(q) {
  const intent = parseIntent(q)
  const cands = queryFacets(q)
  const rows = cands.length ? facetThreads(cands) : []
  const byThread = new Map()
  const matched = new Set()
  for (const r of rows) {
    matched.add(r.facet)
    const e = byThread.get(r.thread) || { thread: r.thread, score: 0, entity: 0, tag: 0, keyword: 0, facets: new Set() }
    if (e.facets.has(r.kind + ":" + r.facet)) continue // no contar la misma faceta 2 veces por hilo
    e.facets.add(r.kind + ":" + r.facet)
    e.score += W[r.kind] || 1
    e[r.kind] = (e[r.kind] || 0) + 1
    byThread.set(r.thread, e)
  }
  const ranked = [...byThread.values()].sort((a, b) => b.score - a.score || b.entity - a.entity)
  const top = ranked[0]
  // confiado: la mejor conversación tiene al menos una ENTIDAD o TAG (no solo un keyword suelto) y score suficiente.
  const confident = !!top && (top.entity >= 1 || top.tag >= 1) && top.score >= 3
  return { confident, intent, matched: [...matched], ranked: ranked.slice(0, 8).map((r) => ({ thread: r.thread, score: r.score, entity: r.entity, tag: r.tag, keyword: r.keyword })) }
}

// v2 · ACTIVACIÓN POR DIFUSIÓN sobre el grafo ponderado (tags con puntajes).
// Puntúa CONTENIDO por energía acumulada de los nodos que matchean + sus co-ocurrentes (2 saltos). Trae el "camino" (por qué).
const SEED_E = { entity: 1.0, topic: 0.7, keyword: 0.45 }
export function activate(q) {
  const intent = parseIntent(q)
  const cands = queryFacets(q)
  if (!cands.length) return { confident: false, intent, matched: [], ranked: [], engine: "graph" }
  // un candidato puede ser entidad, tema o keyword: probamos las 3 formas; graphEdgesFor sólo devuelve las que existen
  const guesses = []
  for (const c of cands) for (const k of ["entity", "topic", "keyword"]) guesses.push(k + ":" + c)
  const seedEdges = graphEdgesFor(guesses)
  if (!seedEdges.length) return { confident: false, intent, matched: [], ranked: [], engine: "graph" }
  const seeds = [...new Set(seedEdges.map((e) => e.node))]
  const energy = {}; for (const n of seeds) energy[n] = SEED_E[n.split(":")[0]] || 0.4
  const threadE = {}, contrib = {}
  const spread = (e, factor) => {
    const inc = (energy[e.node] || 0) * e.weight * factor; if (inc <= 0) return
    threadE[e.thread] = (threadE[e.thread] || 0) + inc
    const c = (contrib[e.thread] = contrib[e.thread] || {}); c[e.node] = (c[e.node] || 0) + inc
  }
  for (const e of seedEdges) spread(e, 1) // 1er salto: nodos semilla → contenido
  const co = graphCoNodes(seeds, { limit: 6 }) // 2do salto: co-ocurrentes (Juan ↔ deuda) con energía decaída
  const expand = co.map((c) => c.node.replace(/^(entity|topic|keyword):/, "")) // términos semánticamente relacionados (para saltar la brecha léxica al leer bodies)
  if (co.length) {
    const maxS = co[0].s || 1
    for (const cn of co) energy[cn.node] = (energy[cn.node] || 0) + 0.45 * (cn.s / maxS)
    for (const e of graphEdgesFor(co.map((c) => c.node))) spread(e, 0.45)
  }
  const ranked = Object.entries(threadE).map(([thread, score]) => ({
    thread, score, path: Object.entries(contrib[thread] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n.replace(/^(entity|topic|keyword):/, "")),
  })).sort((a, b) => b.score - a.score).slice(0, 8)
  const top = ranked[0]
  const hasStrong = seeds.some((s) => s.startsWith("entity:") || s.startsWith("topic:"))
  const confident = !!top && top.score > 0 && hasStrong
  return { confident, intent, matched: seeds.map((s) => s.replace(/^(entity|topic|keyword):/, "")), expand, ranked, engine: "graph" }
}
