// One-off: reconstruye AMBOS índices FTS tras agregar los triggers _ad/_au (db-core.mjs).
// Los triggers arreglan el índice de acá en adelante; esto repara las filas HISTÓRICAS:
//   · messages_fts (external-content): rebuild → elimina filas fantasma de dedups pasados (cross-contamination por rowid reusado).
//   · email_fts: repoblado manual (NO es external-content) → indexa todos los cuerpos backfilleados por UPDATE que el _ai nunca vio.
// OPERACIÓN: toma el write-lock un rato (1.96M filas → ~min). Corré con el daemon quieto o asumí un hueco corto de ingesta.
// Uso: node src/fts-rebuild.mjs
import { loadEnv } from "./lib/env.mjs"
import { rebuildMessagesFts, rebuildEmailFts } from "./lib/search-repo.mjs"
import { handle } from "./lib/db-core.mjs"
import { getMeta, setMeta } from "./lib/db.mjs"

loadEnv()

const FORCE = process.argv.includes("--force")
const D = handle()
// idempotente: el daemon lo spawnea en cada arranque; tras el 1er rebuild exitoso se auto-saltea (salvo --force). Así queda CABLEADO al deploy.
if (!FORCE && getMeta("fts_rebuilt") === "2") { console.log("[fts-rebuild] índice ya reconstruido (fts_rebuilt=2) → skip. Usá --force para rehacer."); process.exit(0) }
const before = {
  mfts: D.prepare("SELECT COUNT(*) c FROM messages_fts").get().c,
  efts: D.prepare("SELECT COUNT(*) c FROM email_fts").get().c,
  bodies: D.prepare("SELECT COUNT(*) c FROM messages WHERE body IS NOT NULL AND body != ''").get().c,
}
console.log(`[fts-rebuild] antes: messages_fts=${before.mfts} email_fts=${before.efts} (bodies con contenido=${before.bodies})`)

console.time("[fts-rebuild] messages_fts")
rebuildMessagesFts()   // external-content 'rebuild' → re-deriva desde messages, borra fantasmas
console.timeEnd("[fts-rebuild] messages_fts")

console.time("[fts-rebuild] email_fts")
const eCount = rebuildEmailFts()   // DELETE + reinsert de todos los bodies
console.timeEnd("[fts-rebuild] email_fts")

const after = {
  mfts: D.prepare("SELECT COUNT(*) c FROM messages_fts").get().c,
  efts: D.prepare("SELECT COUNT(*) c FROM email_fts").get().c,
}
console.log(`[fts-rebuild] ✅ después: messages_fts=${after.mfts} email_fts=${after.efts} (indexados ${eCount} cuerpos)`)
// integridad: rank=1 compara el índice CONTRA la tabla de contenido (external-content). Sin el 1, solo valida la consistencia INTERNA del
// índice (no-op: pasa aunque esté desincronizado de messages). El 1 es justo lo que te dice si el rebuild sirvió. Solo marco el flag si PASA.
try { D.exec("INSERT INTO messages_fts(messages_fts, rank) VALUES('integrity-check', 1)"); console.log("[fts-rebuild] integrity messages_fts (vs contenido): PASS"); setMeta("fts_rebuilt", "2") }
catch (e) { console.error("[fts-rebuild] ⚠️ integrity FALLÓ (NO marco fts_rebuilt → se reintenta):", e.message); process.exitCode = 1 }
