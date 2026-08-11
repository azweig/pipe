// OPTIMIZADOR DE MEDIA del CAS. Recomprime lo que ya está guardado y deja registrado el antes y el después.
//
// La clave del diseño: la DIRECCIÓN del blob (`hash` = sha256 del archivo ORIGINAL) NO cambia, aunque el archivo en
// disco pase a ser el optimizado. Eso da tres cosas gratis:
//   · la URL /cas/… sigue viva → no hay referencias que reescribir ni cachés de clientes que se rompan,
//   · el dedup sigue siendo perfecto → si el MISMO original vuelve a entrar por otro canal, matchea y no se re-procesa,
//   · queda el "antes y después" auditable: hash+orig_size (antes) vs opt_hash+size (después).
//
// Uso:
//   node src/media-optimize.mjs --kind img   [--limit N] [--dry]   # SIN pérdida (jpegtran/optipng/gifsicle)
//   node src/media-optimize.mjs --kind video [--limit N] [--dry]   # H.265 — CON pérdida, verifica duración
//   node src/media-optimize.mjs --stats
// Resumible e idempotente: cada blob queda marcado (opt='jpegtran'|'h265'|'none'|'skip') y no se vuelve a tocar.
import { execFile } from "child_process"
import { promisify } from "util"
import { statSync, existsSync, renameSync, rmSync, readFileSync } from "fs"
import { createHash } from "crypto"
import { casPendingOptimize, casMarkOptimized, casPathOf, casOptimizeStats } from "./lib/cas.mjs"
import { optimizerFor, acceptResult, IMG_LOSSLESS, VIDEO_EXTS, pct, mb } from "./lib/media-optimize.mjs"

const pexec = promisify(execFile)
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const KIND = arg("--kind", "img")
const LIMIT = Number(arg("--limit", 100))
const CRF = Number(arg("--crf", 28))
// preset fast por defecto: medido sobre videos reales del CAS da 48% de ahorro a ~1.3x tiempo real. `medium` apenas mejora
// la compresión y tarda 3-4x más — con 29 GB de video encima, eso es la diferencia entre un par de días y varias semanas.
const PRESET = arg("--preset", "fast")
const MIN = Number(arg("--min-kb", KIND === "video" ? 1024 : 40)) * 1024 // por debajo de esto no paga el CPU
const DRY = process.argv.includes("--dry")

if (process.argv.includes("--stats")) {
  const rows = casOptimizeStats()
  if (!rows.length) console.log("[media-opt] todavía no se optimizó nada")
  for (const r of rows) console.log(`  ${String(r.opt).padEnd(9)} ${String(r.n).padStart(6)} blobs · ${mb(r.antes)} → ${mb(r.despues)} (${pct(r.antes, r.despues).toFixed(1)}%)`)
  const tot = rows.reduce((a, r) => ({ antes: a.antes + r.antes, despues: a.despues + r.despues }), { antes: 0, despues: 0 })
  if (rows.length) console.log(`  TOTAL recuperado: ${mb(tot.antes - tot.despues)}`)
  process.exit(0)
}

const exts = KIND === "video" ? VIDEO_EXTS : Object.keys(IMG_LOSSLESS)
const have = async (bin) => { try { await pexec("which", [bin]); return true } catch { return false } }
const durationOf = async (p) => {
  try { const { stdout } = await pexec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]); const d = parseFloat(stdout.trim()); return Number.isFinite(d) ? d : null } catch { return null }
}

const rows = casPendingOptimize(exts, { limit: LIMIT, minSize: MIN })
console.log(`[media-opt] ${rows.length} blobs pendientes (${KIND}, ≥${Math.round(MIN / 1024)}KB, los más pesados primero)${DRY ? " · DRY-RUN" : ""}`)
if (!rows.length) { console.log("[media-opt] nada pendiente"); process.exit(0) }

const missing = new Set()
let antes = 0, despues = 0, hechos = 0, saltados = 0

for (const b of rows) {
  const src = casPathOf(b.hash, b.ext)
  if (!existsSync(src)) { if (!DRY) casMarkOptimized(b.hash, { opt: "skip" }); saltados++; continue } // en el índice pero no en disco
  // el temporal va AL LADO del destino, no en /tmp: mismo filesystem → el rename es atómico y no falla con EXDEV
  // (en muchas instalaciones /tmp es tmpfs = RAM, y un video de 300 MB ahí es un problema aparte).
  // ⚠️ la extensión REAL va al final: ffmpeg deduce el contenedor del nombre y con un ".tmp" tira
  //    "Unable to find a suitable output format".
  const out = `${src}.opt.${process.pid}${b.ext}`
  const o = optimizerFor(b.ext, src, out, { crf: CRF, preset: PRESET })
  if (!o) { if (!DRY) casMarkOptimized(b.hash, { opt: "skip" }); saltados++; continue }
  if (missing.has(o.bin) || !(await have(o.bin))) { missing.add(o.bin); saltados++; continue } // sin la herramienta: NO marcar (se reintenta cuando esté)
  try {
    await pexec(o.bin, o.args, { maxBuffer: 1 << 26 })
    const newSize = existsSync(out) ? statSync(out).size : 0
    const verdict = acceptResult({
      origSize: b.size, newSize, lossy: o.lossy,
      origDur: o.lossy ? await durationOf(src) : null,
      newDur: o.lossy && newSize ? await durationOf(out) : null,
    })
    if (!verdict.ok) {
      if (!DRY) casMarkOptimized(b.hash, { opt: "none" }) // intentado y descartado → no volver a gastar CPU acá
      saltados++
      rmSync(out, { force: true })
      continue
    }
    antes += b.size; despues += newSize; hechos++
    console.log(`  ✓ ${b.ext} ${mb(b.size)} → ${mb(newSize)} (${verdict.gain.toFixed(0)}%) ${o.tool}`)
    if (DRY) { rmSync(out, { force: true }); continue }
    const optHash = createHash("sha256").update(readFileSync(out)).digest("hex")
    renameSync(out, src) // MISMA ruta = misma URL: nada que reescribir aguas arriba
    casMarkOptimized(b.hash, { opt: o.tool, size: newSize, optHash, origSize: b.size })
  } catch (e) {
    rmSync(out, { force: true })
    if (!DRY) casMarkOptimized(b.hash, { opt: "none" })
    saltados++
    console.log(`  ✗ ${b.hash.slice(0, 10)}… ${String(e.message).slice(0, 60)}`)
  }
}

for (const m of missing) console.log(`[media-opt] ⚠️  falta la herramienta "${m}" — esos quedan pendientes (instalala y volvé a correr)`)
console.log(`[media-opt] ${hechos} optimizados · ${saltados} sin cambio · ${mb(antes)} → ${mb(despues)} = ${mb(antes - despues)} recuperados${DRY ? " (DRY)" : ""}`)
console.log("[media-opt] volvé a correrlo para el siguiente lote (termina cuando diga 'nada pendiente')")
process.exit(0)
