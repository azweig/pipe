// Lector unificado de eventos NUEVOS de messages.jsonl para graphify.
// STREAMING por offset de BYTES: antes hacía readFileSync del jsonl de >2GB → ERR_STRING_TOO_LONG → graphify crasheaba en
// CADA corrida (el grafo dejó de aprender). Ahora stremea por líneas desde el offset guardado, con un tope por corrida.
// TRANSACCIONAL: NO comitea el offset hasta que el caller llame commit() (tras procesar OK) → un fallo no pierde eventos.
import { readFileSync, existsSync, writeFileSync, statSync, createReadStream } from "fs"
import { createInterface } from "readline"

const OFFSETS = "./data/.graphify-offsets.json"
const JSONL = "./data/messages.jsonl"

export async function loadNewEvents({ limit = 800 } = {}) {
  const off = existsSync(OFFSETS) ? JSON.parse(readFileSync(OFFSETS, "utf8")) : {}
  const size = existsSync(JSONL) ? statSync(JSONL).size : 0
  let bytes = off["messages.jsonl"]
  // migración del formato viejo (offset por LÍNEA) / primera vez: arrancar desde el FINAL. No reprocesamos 2.4GB de backlog
  // por LLM (el grafo ya tiene lo histórico + la semilla). Cortamos el crash y aprendemos de acá en adelante.
  if (off._fmt !== "bytes" || typeof bytes !== "number" || bytes > size) bytes = size
  const events = []
  let endByte = bytes
  if (bytes < size) {
    const rl = createInterface({ input: createReadStream(JSONL, { start: bytes, end: size - 1, encoding: "utf8" }), crlfDelay: Infinity })
    let consumed = bytes
    for await (const line of rl) {
      consumed += Buffer.byteLength(line) + 1 // +1 por el \n (cada línea del jsonl termina en \n)
      if (line.trim()) { try { events.push(JSON.parse(line)) } catch {} }
      if (events.length >= limit) { endByte = consumed; break } // tope por corrida
    }
    if (events.length < limit) endByte = size // llegamos al EOF
  }
  events.sort((a, b) => (a.ts || 0) - (b.ts || 0))
  const commit = () => writeFileSync(OFFSETS, JSON.stringify({ "messages.jsonl": endByte, _fmt: "bytes" }))
  // `endByte` se expone para que el llamador pueda decir HASTA DÓNDE llegó esta tanda: sirve para saber si dos corridas
  // seguidas están atascadas en los mismos eventos, y para poder nombrar el rango que se descarta si hay que rendirse.
  return { events, commit, endByte }
}

// resetea offsets (reprocesar TODO desde el principio — caro por LLM, solo con --all)
export function resetOffsets() { writeFileSync(OFFSETS, JSON.stringify({ "messages.jsonl": 0, _fmt: "bytes" })) }

// snapshots (calendario/archivos/notion) — se leen enteros
export function loadSnapshot(file) {
  const path = `./data/${file}`
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
