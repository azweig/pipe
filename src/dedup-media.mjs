// Deduplicación por CONTENIDO (content-addressed storage). Cada archivo se guarda UNA vez por su hash SHA-256.
// El mismo video/meme/doc que mandan N personas → 1 copia física en data/cas/, referenciada N veces.
// Uso: node src/dedup-media.mjs <carpeta-fuente>   (mueve los únicos a data/cas/, borra duplicados exactos)
// Idempotente: re-correrlo no rompe nada. Índice en data/cas-index.json.
import { readdirSync, statSync, existsSync, mkdirSync, renameSync, unlinkSync, createReadStream } from "fs"
import { join, extname } from "path"
import { createHash } from "crypto"
import { casUrlByHash, casRegister, casStats } from "./lib/cas.mjs"

const SRC = process.argv[2]
if (!SRC || !existsSync(SRC)) { console.error("Uso: node src/dedup-media.mjs <carpeta>"); process.exit(1) }
const CAS = "./data/cas"
mkdirSync(CAS, { recursive: true })
// el índice ahora vive en cas.db (SQLite): casRegister/casUrlByHash lo manejan (antes era cas-index.json, JSON O(N)).

const sha256 = (path) => new Promise((res, rej) => { const h = createHash("sha256"); const s = createReadStream(path); s.on("data", (c) => h.update(c)); s.on("end", () => res(h.digest("hex"))); s.on("error", rej) })
const casPath = (hash, ext) => join(CAS, hash.slice(0, 2), hash + ext) // shard por prefijo

function* walk(dir) { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) yield* walk(p); else if (f.isFile()) yield p } }

let seen = 0, unique = 0, dups = 0, saved = 0, err = 0
for (const path of walk(SRC)) {
  try {
    const st = statSync(path)
    if (st.size === 0) { unlinkSync(path); continue }
    seen++
    const hash = await sha256(path)
    const ext = extname(path).toLowerCase()
    const dest = casPath(hash, ext)
    if (casUrlByHash(hash)) {
      // ya existe ese contenido → duplicado exacto: bump refcount y borrar el archivo fuente
      casRegister(hash, ext, st.size)
      unlinkSync(path); dups++; saved += st.size
    } else {
      mkdirSync(join(CAS, hash.slice(0, 2)), { recursive: true })
      if (!existsSync(dest)) renameSync(path, dest); else unlinkSync(path)
      casRegister(hash, ext, st.size)
      unique++
    }
    if (seen % 500 === 0) console.log(`  … ${seen} vistos · ${unique} únicos · ${dups} dups · ${(saved / 1e9).toFixed(1)}GB ahorrados`)
  } catch (e) { err++ }
}
const totalUnique = casStats().unique
console.log(`\n✅ Dedup completo:`)
console.log(`   ${seen} archivos procesados · ${unique} nuevos únicos · ${dups} duplicados eliminados`)
console.log(`   ${(saved / 1e9).toFixed(2)}GB ahorrados en esta pasada · ${totalUnique} archivos únicos totales en CAS`)
if (err) console.log(`   ⚠️ ${err} errores`)
