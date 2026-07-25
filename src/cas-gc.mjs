// GC del CAS con papelera. Manda a la PAPELERA los blobs huérfanos (ningún mensaje los referencia: sobras de dedup/borrados) y
// PURGA los que llevan > 30 días en papelera (lo único que libera disco → hay 30 días de ventana para deshacer). Corre a diario.
// Uso: node src/cas-gc.mjs
import { loadEnv } from "./lib/env.mjs"
import { casGC, casPurge, casStats } from "./lib/cas.mjs"
import { liveMediaPaths } from "./lib/db.mjs"

loadEnv()

const live = liveMediaPaths()             // rutas /cas/ referenciadas por algún mensaje vivo (una sola lectura)
const gc = casGC(live)                     // huérfanos → papelera; y RESCATA lo que volvió a estar vivo
const purge = casPurge(live)               // > 30 días en papelera → borrado real, PERO re-verifica vivo primero (no borra media re-referenciada)
const s = casStats()
console.log(`[cas-gc] huérfanos→papelera: ${gc.trashed} · rescatados: ${gc.rescued + purge.rescued} · purgados(>30d): ${purge.purged} (${(purge.freed / 1e6).toFixed(1)}MB liberados) · CAS: ${s.unique} blobs, papelera ${s.trashed} (${(s.trashedBytes / 1e6).toFixed(1)}MB recuperables)`)
