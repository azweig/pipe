// One-off: reconstruye AMBOS índices FTS tras agregar los triggers _ad/_au (db-core.mjs).
// Los triggers arreglan el índice de acá en adelante; esto repara las filas HISTÓRICAS:
//   · messages_fts (external-content): rebuild → elimina filas fantasma de dedups pasados (cross-contamination por rowid reusado).
//   · email_fts: repoblado manual (NO es external-content) → indexa todos los cuerpos backfilleados por UPDATE que el _ai nunca vio.
//   · doc_fts: el TEXTO DE LOS ADJUNTOS. doc_text venía llenándose desde antes de que existiera el índice, así que sin
//     repoblarlo los documentos ya extraídos seguirían siendo inbuscables por su contenido.
//
// doc_fts va en su PROPIA marca y ANTES del resto, a propósito: es una fila por documento extraído (decenas), mientras
// que lo de abajo son 2M de filas y minutos de write-lock. Colgarlo de la misma marca significaba re-reconstruir los
// 2M cada vez que se agrega un índice nuevo — y en una caja viva eso se pelea con el daemon por el lock ("database is
// locked", medido). Cada índice se repara por lo que cuesta él, no por lo que cuesta el más caro.
//
// OPERACIÓN: la parte pesada toma el write-lock un rato (1.96M filas → ~min). Corré con el daemon quieto o asumí un
// hueco corto de ingesta.
// Uso: node src/fts-rebuild.mjs
import { loadEnv } from "./lib/env.mjs"
import { rebuildMessagesFts, rebuildEmailFts, rebuildDocFts } from "./lib/search-repo.mjs"
import { handle } from "./lib/db-core.mjs"
import { getMeta, setMeta } from "./lib/db.mjs"

loadEnv()

const FORCE = process.argv.includes("--force")
const D = handle()

// ── BARATO: el texto de los adjuntos. Marca propia, así no arrastra la reconstrucción de 2M filas. ──
if (FORCE || getMeta("doc_fts_built") !== "1") {
  try {
    const n = rebuildDocFts()
    setMeta("doc_fts_built", "1")
    console.log(`[fts-rebuild] doc_fts: ${n} documentos indexados por CONTENIDO`)
  } catch (e) { console.error("[fts-rebuild] doc_fts falló (se reintenta en el próximo arranque):", e.message) }
}

// ── CARO: idempotente por marca. El daemon lo spawnea en cada arranque; tras el 1er rebuild exitoso se auto-saltea. ──
if (!FORCE && getMeta("fts_rebuilt") === "2") { console.log("[fts-rebuild] índices pesados ya reconstruidos (fts_rebuilt=2) → skip. Usá --force para rehacer."); process.exit(0) }
const before = {
  mfts: D.prepare("SELECT COUNT(*) c FROM messages_fts").get().c,
  efts: D.prepare("SELECT COUNT(*) c FROM email_fts").get().c,
  bodies: D.prepare("SELECT COUNT(*) c FROM messages WHERE body IS NOT NULL AND body != ''").get().c,
  dfts: (() => { try { return D.prepare("SELECT COUNT(*) c FROM doc_fts").get().c } catch { return 0 } })(),
  docs: (() => { try { return D.prepare("SELECT COUNT(*) c FROM doc_text WHERE texto IS NOT NULL AND texto != ''").get().c } catch { return 0 } })(),
}
console.log(`[fts-rebuild] antes: messages_fts=${before.mfts} email_fts=${before.efts} doc_fts=${before.dfts} (bodies=${before.bodies}, docs extraídos=${before.docs})`)

console.time("[fts-rebuild] messages_fts")
rebuildMessagesFts()   // external-content 'rebuild' → re-deriva desde messages, borra fantasmas
console.timeEnd("[fts-rebuild] messages_fts")

console.time("[fts-rebuild] email_fts")
const eCount = rebuildEmailFts()   // DELETE + reinsert de todos los bodies
console.timeEnd("[fts-rebuild] email_fts")

const after = {
  mfts: D.prepare("SELECT COUNT(*) c FROM messages_fts").get().c,
  efts: D.prepare("SELECT COUNT(*) c FROM email_fts").get().c,
  dfts: D.prepare("SELECT COUNT(*) c FROM doc_fts").get().c,
}
console.log(`[fts-rebuild] ✅ después: messages_fts=${after.mfts} email_fts=${after.efts} doc_fts=${after.dfts} (indexados ${eCount} cuerpos)`)
// integridad: rank=1 compara el índice CONTRA la tabla de contenido (external-content). Sin el 1, solo valida la consistencia INTERNA del
// índice (no-op: pasa aunque esté desincronizado de messages). El 1 es justo lo que te dice si el rebuild sirvió. Solo marco el flag si PASA.
try { D.exec("INSERT INTO messages_fts(messages_fts, rank) VALUES('integrity-check', 1)"); console.log("[fts-rebuild] integrity messages_fts (vs contenido): PASS"); setMeta("fts_rebuilt", "2") }
catch (e) { console.error("[fts-rebuild] ⚠️ integrity FALLÓ (NO marco fts_rebuilt → se reintenta):", e.message); process.exitCode = 1 }
