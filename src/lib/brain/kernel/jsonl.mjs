// brain/kernel/jsonl — lector de JSONL de ./data. Para archivos ENORMES (messages.jsonl >1GB) lee SOLO la cola
// (~80MB de eventos recientes) → evita ERR_STRING_TOO_LONG (>512MB de Node). Compartido por people/schedule/meetings.
import { existsSync, statSync, openSync, readSync, closeSync, readFileSync } from "fs"

export const j = (f) => {
  const p = `./data/${f}`
  if (!existsSync(p)) return []
  let content
  const size = statSync(p).size
  if (size > 200 * 1024 * 1024) {
    const len = 80 * 1024 * 1024, fd = openSync(p, "r"), buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, size - len); closeSync(fd)
    content = buf.toString("utf8"); content = content.slice(content.indexOf("\n") + 1) // descartar la 1ª línea parcial
  } else content = readFileSync(p, "utf8")
  return content.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
