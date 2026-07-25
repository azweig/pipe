// Lock de archivo advisory (entre procesos) + append atómico. Varios lectores appendean a messages.jsonl a la vez
// y appendFileSync NO es atómico para líneas grandes (HTML de emails) → interleave → línea corrupta → mensaje perdido.
// También lo usan cas-index y el cache MSAL (read-modify-write que se pisan entre procesos).
import { appendFileSync, openSync, closeSync, writeSync, readFileSync, statSync, unlinkSync } from "fs"

const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { const t = Date.now() + ms; while (Date.now() < t) {} } }
const STALE_MS = 10000 // un lock más viejo que esto = proceso muerto → se rompe

let SEQ = 0
const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" } } // EPERM = vivo (sin permiso); ESRCH = muerto
// toma un lock EXCLUSIVO (lockfile O_EXCL con token pid:seq:ts). Devuelve el token si lo tomó; null si no pudo tras ~3s.
function acquire(lockPath) {
  const token = `${process.pid}:${++SEQ}:${Date.now()}`
  for (let i = 0; i < 300; i++) {
    try { const fd = openSync(lockPath, "wx"); writeSync(fd, token); closeSync(fd); return token }
    catch (e) {
      if (e.code !== "EEXIST") throw e
      // romper si el dueño MURIÓ (recuperación INMEDIATA) O si está stale hace >STALE_MS. El stale NO se puede gatear a "sin pid": un
      // lockfile huérfano cuyo pid fue REUSADO por otro proceso vivo daría isAlive=true para siempre = lock inmortal (outage sin autocura).
      // El stale cubre ese caso (auto-cura en 10s). Trade-off aceptado: romperle a un vivo-stalleado >10s es posible, pero las secciones
      // críticas son cortas (el índice CAS ya no usa este lock) y un interleave del jsonl lo cuenta ingest y lo recupera el batchOk de matrix.
      try {
        const pid = +String(readFileSync(lockPath, "utf8")).split(":")[0]
        const stale = Date.now() - statSync(lockPath).mtimeMs > STALE_MS
        if ((pid > 0 && !isAlive(pid)) || stale) unlinkSync(lockPath)
      } catch {}
      sleepSync(10)
    }
  }
  return null
}

// corre fn() con el lock EXCLUSIVO tomado. Si NO se pudo tomar tras ~3s → FALLA-CERRADO (throw).
// El modo de falla correcto para un read-modify-write compartido (cas-index, append) es reintentar arriba,
// NO correr sin lock: eso interleava/pisa escrituras → mensajes perdidos o índice desincronizado.
export function withLock(path, fn) {
  const lock = path + ".lock"
  const token = acquire(lock)
  if (!token) { const e = new Error(`withLock: no pude tomar ${lock} tras ~3s (contención sostenida)`); e.code = "ELOCK"; throw e } // code → el caller distingue "lock ocupado" (reprocesable) de "mensaje malo"
  try { return fn() }
  finally {
    // soltar SOLO si el lock sigue siendo el NUESTRO: si otro proceso nos lo rompió por stale y tomó el suyo,
    // borrarlo dejaría dos escritores (el bug que este lock existe para evitar).
    try { if (readFileSync(lock, "utf8") === token) unlinkSync(lock) } catch {}
  }
}

const STORE = "./data/messages.jsonl"
// append SERIALIZADO a messages.jsonl → sin interleave entre lectores. Reintenta ante contención (el append es rápido,
// resuelve en ms); tras agotar, tira con log VISIBLE en vez de corromper/perder en silencio.
export function appendMessage(rec) {
  const line = (typeof rec === "string" ? rec : JSON.stringify(rec)) + "\n"
  for (let i = 0; ; i++) {
    try { return withLock(STORE, () => appendFileSync(STORE, line)) }
    catch (e) {
      if (i >= 2) { console.error("[append] MENSAJE NO GUARDADO tras 3 intentos:", e.message); throw e } // 3 (no 5): con el auto-cure del lock, un lock stale se rompe en el 1er spin; menos reintentos = menos freeze síncrono del event loop
      sleepSync(50 * (i + 1))
    }
  }
}
