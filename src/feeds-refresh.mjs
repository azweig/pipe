// Refresca el índice local de titulares (~50 fuentes de todo el mundo). Lo lanza el daemon cada 20 min.
// Uso manual: node src/feeds-refresh.mjs
import { loadEnv } from "./lib/env.mjs"
loadEnv()
const { refreshFeeds, listFeeds } = await import("./lib/sources.mjs")
const r = await refreshFeeds()
console.log(`[feeds] ${r.ok} titulares de ${r.feeds} fuentes · ${r.fallaron} fallaron · índice: ${r.total}`)
if (r.errors.length) console.log("[feeds] fallaron:", r.errors.join(" | "))
process.exit(0)
