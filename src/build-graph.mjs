// Construye el GRAFO PONDERADO del router v2 (tags con puntajes por grafo).
// El enrichment DESCUBRE el vocabulario (entidades/tags por conversación, con LLM local, tail).
// Este builder PESA cada faceta sobre TODO el histórico vía FTS (0 tokens): así "deuda" pesa en el hilo
// sobre-fusionado de Juan aunque el enrichment del tail no lo haya visto. weight = log(1+freq) × idf (raro = informativo).
import { graphVocabulary, ftsDocFreq, ftsThreadCounts, replaceGraphEdges, graphStats, convStats } from "./lib/db.mjs"

const MAXDF = Number(process.env.GRAPH_MAXDF || 6000) // faceta que matchea demasiados mensajes = poco discriminante → se salta
const N = Math.max(convStats().total, 100) // total de conversaciones (para el idf)
const vocab = graphVocabulary()
console.log(`[graph] vocabulario: ${vocab.length} facetas · N=${N}`)
const edges = []
let skipped = 0, empty = 0
for (const { kind, facet } of vocab) {
  const { q, total } = ftsDocFreq(facet)
  if (!q || total === 0) { empty++; continue }
  if (total > MAXDF) { skipped++; continue }
  const idf = Math.log(1 + N / (1 + total)) // discriminación: términos raros pesan más
  const node = kind + ":" + facet
  for (const r of ftsThreadCounts(q, { cap: MAXDF })) edges.push({ node, thread: r.thread, kind, weight: Math.log(1 + r.c) * idf })
}
const n = replaceGraphEdges(edges)
console.log(`[graph] ${n} aristas escritas · ${skipped} comunes saltadas · ${empty} sin match · ${JSON.stringify(graphStats())}`)
process.exit(0)
