// Lectura SEGURA de JSONL gigantes. messages.jsonl (>1GB) rompe readFileSync(...,"utf8") con
// ERR_STRING_TOO_LONG (máx string de Node ≈ 512MB). Estos dos helpers lo evitan.
import { statSync, openSync, readSync, closeSync, existsSync, createReadStream } from "fs"
import { createInterface } from "readline"

// TAIL: parsea solo los últimos maxBytes → objetos. Para "actividad reciente". La 1ª línea puede venir
// cortada (empieza a mitad de línea) → JSON.parse falla y se descarta, sin problema.
export function tailJsonl(path, maxBytes = 12 * 1024 * 1024) {
  if (!existsSync(path)) return []
  const size = statSync(path).size, start = Math.max(0, size - maxBytes)
  const fd = openSync(path, "r"); const buf = Buffer.alloc(size - start)
  try { readSync(fd, buf, 0, buf.length, start) } finally { closeSync(fd) }
  const out = []
  for (const l of buf.toString("utf8").split("\n")) { if (!l) continue; try { out.push(JSON.parse(l)) } catch {} }
  return out
}

// STREAM: recorre TODO el archivo línea por línea sin cargarlo entero. Para reindexado incremental.
export async function streamJsonl(path, onRec) {
  if (!existsSync(path)) return 0
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity })
  let n = 0
  for await (const l of rl) { if (!l) continue; let r; try { r = JSON.parse(l) } catch { continue } await onRec(r); n++ }
  return n
}
