// outbox-repo — idempotencia de los envíos. El cliente manda un `msgId` propio y lo REPITE en cada reintento.
//
// Por qué hace falta: un 502 NO significa "no se envió". El 2026-08-25 hubo dos, y de naturalezas opuestas: uno
// duró 0 ms (el server estaba reiniciando, el mensaje nunca salió) y otro duró 62 s (el server aceptó el pedido y
// se colgó — el mensaje pudo haber salido igual). Reintentar a ciegas el segundo caso manda el mensaje dos veces.
//
// El flujo es reservar-primero: `claim` inserta el id ANTES de mandar. Si dos reintentos entran a la vez, solo uno
// se queda con la reserva; el otro ve que está en curso y espera en vez de mandar de nuevo.
import { handle as db, withRetry } from "./db-core.mjs"

const MAX_EDAD_MS = 7 * 24 * 3600 * 1000 // una semana: de sobra para cualquier reintento, y no crece sin control
// Reserva abandonada: si el proceso murió a mitad del envío, el id queda reservado y sin terminar. Sin esto el
// reintento diría "en curso" para siempre y el mensaje NUNCA saldría. A los 2 min lo damos por abandonado y
// dejamos reintentar — el timeout de Matrix es de 25 s, así que un envío vivo nunca llega a ese punto.
const ABANDONADA_MS = Number(process.env.OUTBOX_STALE_MS || 120000)

// Intenta reservar el id. Devuelve:
//   { estado: "nuevo" }     → es tuyo, mandá
//   { estado: "en-curso" }  → otro lo está mandando ahora mismo; NO mandes, esperá
//   { estado: "hecho", resultado } → ya se mandó antes; devolvé eso mismo
export function claimSend(id) {
  if (!id) return { estado: "nuevo" } // sin id no hay idempotencia posible (cliente viejo) → comportamiento de siempre
  return withRetry(() => {
    const ins = db().prepare("INSERT OR IGNORE INTO sent_ids (id, ts, done, result) VALUES (?, ?, 0, NULL)").run(String(id), Date.now())
    if (ins.changes) return { estado: "nuevo" }
    const row = db().prepare("SELECT done, result, ts FROM sent_ids WHERE id=?").get(String(id))
    if (!row) return { estado: "nuevo" } // se borró entre medio (poda): tratamos como nuevo
    if (!row.done) {
      if (Date.now() - (row.ts || 0) < ABANDONADA_MS) return { estado: "en-curso" }
      db().prepare("UPDATE sent_ids SET ts=? WHERE id=? AND done=0").run(Date.now(), String(id)) // la tomamos nosotros
      return { estado: "nuevo", reintentoDeAbandonada: true }
    }
    let resultado = null
    try { resultado = JSON.parse(row.result || "null") } catch {}
    return { estado: "hecho", resultado }
  })
}

// Cierra la reserva con el resultado. Se llama SIEMPRE que el envío haya salido de verdad.
export function finishSend(id, resultado) {
  if (!id) return
  withRetry(() => db().prepare("UPDATE sent_ids SET done=1, result=?, ts=? WHERE id=?").run(JSON.stringify(resultado ?? null), Date.now(), String(id)))
}

// Suelta la reserva cuando el envío FALLÓ. Sin esto, un fallo dejaría el id reservado y el reintento quedaría
// esperando para siempre a un envío que nunca ocurrió — justo lo contrario de lo que queremos.
export function releaseSend(id) {
  if (!id) return
  withRetry(() => db().prepare("DELETE FROM sent_ids WHERE id=? AND done=0").run(String(id)))
}

export function pruneSends(maxEdadMs = MAX_EDAD_MS) {
  return withRetry(() => db().prepare("DELETE FROM sent_ids WHERE ts < ?").run(Date.now() - maxEdadMs)).changes
}
