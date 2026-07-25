// PRE-GENERA las tarjetas de personas (bio "quién es", stats, canales, grafo). Corre en cron tras graphify/learn.
// Evolucionan con el tiempo pero YA están calculadas → la vista de persona carga instantánea, sin esperar el LLM on-click.
import { setBusyTimeout } from "./lib/db.mjs"
import { genPersonCards } from "./lib/brain.mjs"

try { setBusyTimeout(30000) } catch {} // subir: el índice de membresía es un blob grande y compite con el server
const n = await genPersonCards({ topN: 150 })
console.log(`[person-cards] ${n} tarjetas de persona pre-generadas/actualizadas`)
process.exit(0)
