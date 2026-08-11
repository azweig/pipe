// Content-Addressed Storage compartido. Un archivo por hash → dedup global. El BLOB vive en data/cas/xx/<hash><ext>;
// el ÍNDICE vive en SQLite (data/cas.db), NO en un JSON. Antes era cas-index.json: read-modify-write O(N) (~430ms a 256k) bajo un
// file-lock casero → la contención hacía que casPutBuffer tirara (perdiendo/duplicando media) y se peleaba con cas-gc. SQLite da
// operaciones O(1) con locking atómico nativo (WAL+busy_timeout) → esa clase de bug desaparece. Migra el JSON viejo automáticamente.
import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync, rmSync, statSync, chmodSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"
import Database from "better-sqlite3"

const CAS = "./data/cas"
const DBFILE = process.env.CAS_DB || "./data/cas.db"
const _ctd = process.env.CAS_TRASH_DAYS
const TRASH_TTL = (_ctd != null && _ctd !== "" && Number.isFinite(+_ctd) ? +_ctd : 30) * 86400000 // días en papelera antes del purge (0 válido)

const pubOf = (hash, ext) => `/cas/${hash.slice(0, 2)}/${hash}${ext || ""}`
const hashOf = (pub) => String(pub || "").split("/").pop().split(".")[0]
const normExt = (ext) => (ext && !ext.startsWith(".") ? "." + ext : ext) || ""

let _db = null
function db() {
  if (_db) return _db
  mkdirSync("./data", { recursive: true })
  _db = new Database(DBFILE)
  try { chmodSync(DBFILE, 0o600) } catch {} // 0600: el índice no debe ser legible por otros usuarios del box (consistente con auth-pin.json)
  _db.pragma("busy_timeout = " + (+process.env.CAS_BUSY_TIMEOUT_MS || 20000)) // ANTES de WAL: la conversión rollback→WAL toma lock EXCLUSIVO; sin timeout previo, N readers en cold-start tiraban "database is locked". 20s (no 2s): la migración del índice real tarda ~1.5-2s.
  try { _db.pragma("journal_mode = WAL") } catch {} // en try/catch: si otro proceso lo está convirtiendo, no morir
  _db.pragma("synchronous = NORMAL")
  _db.exec(`CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, ext TEXT, size INTEGER, refcount INTEGER DEFAULT 1, trashed_at INTEGER, trash_msgs TEXT);
            CREATE INDEX IF NOT EXISTS idx_blobs_trashed ON blobs(trashed_at);`)
  // OPTIMIZACIÓN DE MEDIA (ver src/media-optimize.mjs). `hash` sigue siendo la DIRECCIÓN = sha256 del archivo ORIGINAL,
  // aunque el archivo en disco pase a ser el optimizado. Eso es a propósito: la URL /cas/… no cambia (nada que reescribir,
  // ningún cliente con caché se rompe) y el dedup sigue siendo perfecto — si el MISMO original vuelve a entrar, su hash
  // matchea, sumamos refcount y no se re-optimiza nada. Es el "antes y después": `hash`+`orig_size` = antes, `opt_hash`+`size` = después.
  for (const [col, ddl] of [
    ["orig_size", "ALTER TABLE blobs ADD COLUMN orig_size INTEGER"], // tamaño ANTES de optimizar (null = intacto)
    ["opt", "ALTER TABLE blobs ADD COLUMN opt TEXT"],                // qué se aplicó: jpegtran|optipng|h265|none|skip
    ["opt_hash", "ALTER TABLE blobs ADD COLUMN opt_hash TEXT"],      // sha256 del contenido optimizado → la integridad sigue siendo verificable
    ["phash", "ALTER TABLE blobs ADD COLUMN phash TEXT"],            // huella perceptual (dhash 64 bits hex) → casi-duplicados entre canales
  ]) {
    if (!_db.prepare("PRAGMA table_info(blobs)").all().some((c) => c.name === col)) { try { _db.exec(ddl) } catch {} }
  }
  try { _db.exec("CREATE INDEX IF NOT EXISTS idx_blobs_phash ON blobs(phash) WHERE phash IS NOT NULL") } catch {}
  migrateFromJson(_db)
  return _db
}
// ruta en disco de un blob (por hash) — para que los optimizadores trabajen sobre el archivo sin pasar por Buffers gigantes
export function casPathOf(hash, ext) { return join(CAS, String(hash).slice(0, 2), hash + (ext || "")) }
// blobs todavía SIN pasar por el optimizador, del tipo pedido y por encima de un mínimo de tamaño (los chiquitos no pagan el CPU)
export function casPendingOptimize(exts, { limit = 50, minSize = 0 } = {}) {
  const q = exts.map(() => "?").join(",")
  return db().prepare(`SELECT hash, ext, size FROM blobs WHERE opt IS NULL AND trashed_at IS NULL AND ext IN (${q}) AND size >= ?
                       ORDER BY size DESC LIMIT ?`).all(...exts, minSize, limit)
}
// registra el resultado. `opt`='none'/'skip' marca "ya lo intenté, no re-procesar" (así el runner converge y no gira en falso).
export function casMarkOptimized(hash, { opt, size = null, optHash = null, origSize = null } = {}) {
  db().prepare("UPDATE blobs SET opt=?, size=COALESCE(?,size), opt_hash=?, orig_size=COALESCE(?,orig_size) WHERE hash=?")
    .run(opt, size, optHash, origSize, hash)
}
// blobs sin huella perceptual todavía (para el detector de casi-duplicados)
export function casPendingPhash(exts, { limit = 200, minSize = 0 } = {}) {
  const q = exts.map(() => "?").join(",")
  return db().prepare(`SELECT hash, ext, size FROM blobs WHERE phash IS NULL AND trashed_at IS NULL AND ext IN (${q}) AND size >= ?
                       ORDER BY size DESC LIMIT ?`).all(...exts, minSize, limit)
}
export function casSetPhash(hash, phash) { db().prepare("UPDATE blobs SET phash=? WHERE hash=?").run(phash, hash) }
// grupos de blobs que comparten huella perceptual EXACTA = misma imagen re-codificada por otro canal (el dedup por contenido no los ve)
export function casPhashGroups({ min = 2 } = {}) {
  return db().prepare(`SELECT phash, count(*) n, sum(size) bytes, min(size) keep FROM blobs
    WHERE phash IS NOT NULL AND phash != '' AND trashed_at IS NULL GROUP BY phash HAVING n >= ? ORDER BY (bytes - keep) DESC`).all(min)
}
// resumen de lo que el optimizador ya recuperó
export function casOptimizeStats() {
  return db().prepare(`SELECT opt, count(*) n, sum(COALESCE(orig_size,size)) antes, sum(size) despues FROM blobs
    WHERE opt IS NOT NULL AND trashed_at IS NULL GROUP BY opt`).all()
}
// migración one-time: si la tabla está vacía y existe el cas-index.json viejo, lo importa. Idempotente (no re-importa si ya hay filas).
function migrateFromJson(d) {
  const IDX = "./data/cas-index.json"
  if (!existsSync(IDX) || d.prepare("SELECT COUNT(*) c FROM blobs").get().c > 0) return
  try {
    const idx = JSON.parse(readFileSync(IDX, "utf8"))
    const ins = d.prepare("INSERT OR IGNORE INTO blobs(hash,ext,size,refcount,trashed_at,trash_msgs) VALUES(@hash,@ext,@size,@refcount,@trashed_at,@trash_msgs)")
    const entries = Object.entries(idx.byHash || {})
    d.transaction(() => {
      for (const [hash, e] of entries) ins.run({ hash, ext: e.ext || "", size: e.size || 0, refcount: Array.isArray(e.refs) ? e.refs.length : (e.refcount || 1), trashed_at: e.trashedAt || null, trash_msgs: e.trashMsgs ? JSON.stringify(e.trashMsgs) : null })
    })()
    console.log(`[cas] migrado cas-index.json → cas.db (${entries.length} blobs)`)
  } catch (e) { console.error("[cas] migración cas-index.json falló:", e.message) }
}

// guarda un Buffer y devuelve la ruta pública /cas/xx/<hash><ext>. Dedup por contenido; el ext es CANÓNICO (el del primer put)
// para que N callers con ext distinto referencien el MISMO archivo (antes divergían: <hash>.bin y <hash>.opus quedaban sin trackear).
export function casPutBuffer(buf, ext = "", ref = "") {
  mkdirSync(CAS, { recursive: true })
  const hash = createHash("sha256").update(buf).digest("hex")
  const d = db()
  const info = d.prepare("INSERT OR IGNORE INTO blobs(hash,ext,size,refcount) VALUES(?,?,?,1)").run(hash, normExt(ext), buf.length)
  if (!info.changes) {
    d.prepare("UPDATE blobs SET refcount=refcount+1, trashed_at=NULL, trash_msgs=NULL WHERE hash=?").run(hash) // re-store → rescata de papelera
    // PROMOVER ext: si el canónico es genérico (.bin/vacío) y ahora llega uno específico (ej. .ogg), adoptarlo → el player reproduce
    // (el server deriva el mime de la EXTENSIÓN; .bin=octet-stream = audio mudo). Cierra el hueco del mimetype ausente en unipile.
    const ne = normExt(ext), cur = d.prepare("SELECT ext FROM blobs WHERE hash=?").get(hash).ext || ""
    if (ne && ne !== ".bin" && (!cur || cur === ".bin")) {
      try { const from = join(CAS, hash.slice(0, 2), hash + cur), to = join(CAS, hash.slice(0, 2), hash + ne); if (existsSync(from) && !existsSync(to)) renameSync(from, to) } catch {}
      d.prepare("UPDATE blobs SET ext=? WHERE hash=?").run(ne, hash)
    }
  }
  const canonExt = d.prepare("SELECT ext FROM blobs WHERE hash=?").get(hash).ext || normExt(ext)
  const dir = join(CAS, hash.slice(0, 2)), dest = join(dir, hash + canonExt)
  // idempotente + tmp con pid (sin pid dejaba .tmp huérfanos al crashear a mitad de escritura)
  if (!existsSync(dest)) { mkdirSync(dir, { recursive: true }); const tmp = `${dest}.${process.pid}.tmp`; writeFileSync(tmp, buf); renameSync(tmp, dest) }
  return pubOf(hash, canonExt)
}
// registra en el índice un archivo YA colocado en el CAS (tools que mueven archivos directo, ej. dedup-media). Devuelve el pub canónico.
export function casRegister(hash, ext = "", size = 0) {
  if (!/^[a-f0-9]{64}$/.test(String(hash))) return null
  const d = db()
  const info = d.prepare("INSERT OR IGNORE INTO blobs(hash,ext,size,refcount) VALUES(?,?,?,1)").run(hash, normExt(ext), size)
  if (!info.changes) d.prepare("UPDATE blobs SET refcount=refcount+1 WHERE hash=?").run(hash)
  return pubOf(hash, d.prepare("SELECT ext FROM blobs WHERE hash=?").get(hash).ext || normExt(ext))
}
// ruta pública de un hash (para tools de import que mapean file_hash → URL del CAS).
export function casUrlByHash(hash) {
  if (!/^[a-f0-9]{64}$/.test(String(hash))) return null
  const row = db().prepare("SELECT ext FROM blobs WHERE hash=?").get(hash)
  return row ? pubOf(hash, row.ext) : null
}

// lee un blob por su ruta pública (/cas/xx/<hash><ext>) → Buffer, o null si no está. Para inlinear imágenes de email como data: URI.
export function casReadBuffer(pub) {
  const hash = hashOf(pub)
  if (!/^[a-f0-9]{64}$/.test(hash)) return null
  const row = db().prepare("SELECT ext FROM blobs WHERE hash=?").get(hash)
  const ext = row?.ext ?? ("." + (String(pub).split(".").pop() || "bin"))
  const dest = join(CAS, hash.slice(0, 2), hash + ext)
  try { return existsSync(dest) ? readFileSync(dest) : null } catch { return null }
}

// borra un blob por su ruta pública → libera disco. El caller decide la seguridad (que nadie lo referencie). Devuelve bytes liberados.
export function casDelete(pub) {
  const hash = hashOf(pub)
  if (!/^[a-f0-9]{64}$/.test(hash)) return 0
  const d = db()
  const row = d.prepare("SELECT ext, size FROM blobs WHERE hash=?").get(hash)
  const ext = row?.ext || ("." + (String(pub).split(".").pop() || "bin"))
  const dest = join(CAS, hash.slice(0, 2), hash + ext)
  let bytes = 0
  if (existsSync(dest)) { bytes = row?.size || (() => { try { return statSync(dest).size } catch { return 0 } })(); rmSync(dest, { force: true }) }
  d.prepare("DELETE FROM blobs WHERE hash=?").run(hash)
  return bytes
}

// ── PAPELERA (soft-delete con 30 días de "deshacer") ─────────────────────────────────────────────
// SOFT-DELETE → papelera. NO libera disco (el blob queda para deshacer). Guarda cómo restaurar los mensajes afectados.
export function casTrash(pub, msgs = []) {
  const hash = hashOf(pub)
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false }
  db().prepare("UPDATE blobs SET trashed_at=?, trash_msgs=? WHERE hash=? AND trashed_at IS NULL").run(Date.now(), msgs.length ? JSON.stringify(msgs) : null, hash)
  return { ok: true }
}
// DESHACER: saca el blob de la papelera y devuelve los mensajes a re-vincular.
export function casRestore(pub) {
  const hash = hashOf(pub)
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false, msgs: [] }
  const d = db()
  const row = d.prepare("SELECT trash_msgs FROM blobs WHERE hash=? AND trashed_at IS NOT NULL").get(hash)
  let msgs = []
  if (row) { try { msgs = row.trash_msgs ? JSON.parse(row.trash_msgs) : [] } catch {} d.prepare("UPDATE blobs SET trashed_at=NULL, trash_msgs=NULL WHERE hash=?").run(hash) }
  return { ok: true, msgs }
}
// contenido de la papelera para la UI (más reciente primero) + cuándo se purga cada uno.
export function casTrashList() {
  return db().prepare("SELECT hash, ext, size, trashed_at, trash_msgs FROM blobs WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC").all()
    .map((r) => ({ pub: pubOf(r.hash, r.ext), size: r.size || 0, trashedAt: r.trashed_at, purgeAt: r.trashed_at + TRASH_TTL, msgs: (() => { try { return JSON.parse(r.trash_msgs || "[]").length } catch { return 0 } })() }))
}
// GC: manda a papelera los blobs que NINGÚN mensaje vivo referencia, y RESCATA los que volvieron a estar vivos. livePubs = set de rutas vivas.
export function casGC(livePubs) {
  const d = db()
  const rows = d.prepare("SELECT hash, ext, trashed_at FROM blobs").all()
  const now = Date.now()
  const trashStmt = d.prepare("UPDATE blobs SET trashed_at=? WHERE hash=?")
  const rescueStmt = d.prepare("UPDATE blobs SET trashed_at=NULL, trash_msgs=NULL WHERE hash=?")
  let trashed = 0, rescued = 0
  d.transaction(() => {
    for (const r of rows) {
      const live = livePubs.has(pubOf(r.hash, r.ext))
      if (live && r.trashed_at) { rescueStmt.run(r.hash); rescued++ }            // volvió a estar referenciado (ventana jsonl→DB de 15s) → RESCATAR
      else if (!live && !r.trashed_at) { trashStmt.run(now, r.hash); trashed++ } // huérfano de verdad → a la papelera
    }
  })()
  return { trashed, rescued }
}
// PURGE: borra de verdad (libera disco) lo que lleva > TRASH_TTL en papelera, PERO re-verifica vivo primero (no borra media re-referenciada).
export function casPurge(livePubs = null) {
  const d = db()
  const cutoff = Date.now() - TRASH_TTL
  const rows = d.prepare("SELECT hash, ext, size, trashed_at FROM blobs WHERE trashed_at IS NOT NULL").all()
  const del = d.prepare("DELETE FROM blobs WHERE hash=? AND trashed_at IS NOT NULL AND trashed_at <= ?") // re-check ATÓMICO en el borrado
  const stillThere = d.prepare("SELECT 1 FROM blobs WHERE hash=?")
  const rescueStmt = d.prepare("UPDATE blobs SET trashed_at=NULL, trash_msgs=NULL WHERE hash=?")
  let purged = 0, freed = 0, rescued = 0
  for (const r of rows) { // snapshot de filas; el borrado real re-valida contra el estado actual (casPutBuffer pudo re-guardar el blob entremedio)
    if (livePubs && livePubs.has(pubOf(r.hash, r.ext))) { rescueStmt.run(r.hash); rescued++; continue } // VIVO al momento del purge → NO borrar
    if (r.trashed_at > cutoff) continue
    if (!del.run(r.hash, cutoff).changes) continue // se des-trasheó entremedio (re-store) → la fila ya no cumple → NO tocar el archivo
    if (stillThere.get(r.hash)) continue           // se RE-insertó en la ventana → el archivo es válido, no borrar
    const dest = join(CAS, r.hash.slice(0, 2), r.hash + (r.ext || ""))
    if (existsSync(dest)) { freed += r.size || (() => { try { return statSync(dest).size } catch { return 0 } })(); rmSync(dest, { force: true }) }
    purged++
  }
  return { purged, freed, rescued }
}

export function casStats() {
  const r = db().prepare(`SELECT COUNT(*) uniq, COALESCE(SUM(size),0) bytes, COALESCE(SUM(refcount),0) refs,
    COALESCE(SUM(CASE WHEN trashed_at IS NOT NULL THEN 1 ELSE 0 END),0) trashed,
    COALESCE(SUM(CASE WHEN trashed_at IS NOT NULL THEN size ELSE 0 END),0) trashedBytes FROM blobs`).get()
  return { unique: r.uniq, refs: r.refs, bytes: r.bytes, trashed: r.trashed, trashedBytes: r.trashedBytes } // trashed* = en papelera, recuperable hasta el purge
}
