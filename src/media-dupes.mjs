// CASI-DUPLICADOS: la misma foto/video que entró por dos canales distintos.
//
// El CAS dedupea por sha256 → bytes idénticos = un archivo (ya te ahorró varios GB). Lo que NO ve: la misma imagen
// reenviada por WhatsApp y por mail, que llega RE-CODIFICADA (bytes distintos, misma foto). Para eso se calcula una
// huella perceptual (dhash, ver lib/phash.mjs) y se agrupan las que coinciden.
//
// Uso:
//   node src/media-dupes.mjs --scan [--limit N]   # calcula huellas que falten (resumible)
//   node src/media-dupes.mjs --report             # cuánto espacio hay en casi-duplicados
//
// SOLO REPORTA. No borra nada: decidir cuál copia se queda es del dueño, y un blob puede estar referenciado por
// varios mensajes de gente distinta.
import { execFile } from "child_process"
import { promisify } from "util"
import { existsSync } from "fs"
import { casPendingPhash, casSetPhash, casPathOf, casPhashGroups } from "./lib/cas.mjs"
import { dhashFromGray9x8, ffmpegPhashArgs, PHASH_EXTS, isDegenerateHash } from "./lib/phash.mjs"

const pexec = promisify(execFile)
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const mb = (n) => (n / 1048576).toFixed(1) + " MB"

if (process.argv.includes("--report")) {
  // el filtro de degeneradas también acá: si quedaron huellas planas de una corrida anterior, no deben agrupar
  const g = casPhashGroups({ min: 2 }).filter((r) => !isDegenerateHash(r.phash))
  const waste = g.reduce((a, r) => a + (r.bytes - r.keep), 0)
  console.log(`[dupes] ${g.length} grupos de casi-duplicados · ${mb(waste)} en copias redundantes`)
  for (const r of g.slice(0, 15)) console.log(`  ${r.n} copias · ${mb(r.bytes)} (sobran ${mb(r.bytes - r.keep)}) · huella ${r.phash}`)
  if (g.length > 15) console.log(`  … y ${g.length - 15} grupos más`)
  console.log("[dupes] solo informativo — no se borró nada")
  process.exit(0)
}

const LIMIT = Number(arg("--limit", 300))
const MIN = Number(arg("--min-kb", 40)) * 1024
const rows = casPendingPhash(PHASH_EXTS, { limit: LIMIT, minSize: MIN })
console.log(`[dupes] calculando huella de ${rows.length} archivos (los más pesados primero)`)
if (!rows.length) { console.log("[dupes] no queda nada por huellar — corré --report"); process.exit(0) }

let ok = 0, fail = 0
for (const b of rows) {
  const p = casPathOf(b.hash, b.ext)
  if (!existsSync(p)) { casSetPhash(b.hash, ""); fail++; continue } // "" = intentado, no reintentar
  try {
    // ffmpeg escupe el raw 9x8 en gris por stdout; encoding buffer para no romper los bytes
    const { stdout } = await pexec("ffmpeg", ["-loglevel", "error", ...ffmpegPhashArgs(p, b.ext)], { encoding: "buffer", maxBuffer: 1 << 22 })
    const h = dhashFromGray9x8(stdout)
    // "" = intentado y sin huella útil (ilegible o imagen plana) → no se reintenta ni agrupa
    const usable = h && !isDegenerateHash(h)
    casSetPhash(b.hash, usable ? h : "")
    usable ? ok++ : fail++
  } catch { casSetPhash(b.hash, ""); fail++ }
}
console.log(`[dupes] ${ok} huellas nuevas · ${fail} no se pudieron leer`)
console.log("[dupes] volvé a correr --scan para el siguiente lote; después --report")
process.exit(0)
