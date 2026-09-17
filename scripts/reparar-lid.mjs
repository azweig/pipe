// MENSAJES ARCHIVADOS EN LA FICHA EQUIVOCADA.
//
// Distinto de un hilo duplicado: acá el mensaje entró con un LID sin resolver y quedó DENTRO de la conversación de
// otra persona. La fusión por hilos no lo ve, porque no hay un hilo aparte que fusionar. Caso medido: 167 mensajes
// de un contacto vivían dentro del hilo de otro, así que su ficha mostraba 526 mensajes en vez de 693 y la del otro
// arrastraba una conversación que no era suya.
//
// LA TRAMPA, y es cara: el jid dice QUIÉN HABLA, no CON QUIÉN. Si el LID resuelve a un número PROPIO, el mensaje es
// tuyo dentro de la conversación ajena y está exactamente donde tiene que estar. La primera versión de esto no hacía
// esa distinción y quería mudar 251 mensajes tuyos —de dos conversaciones reales— a un hilo con vos mismo.
//
// Uso:  node scripts/reparar-lid.mjs [--aplicar]   (sin --aplicar sólo simula)
import { handle as db, withRetry } from "../src/lib/db-core.mjs"
import { MY_NUMBERS } from "../src/lib/thread.mjs"
import { rebuildStats } from "../src/lib/ingest-repo.mjs"

const soloDigitos = (x) => String(x || "").replace(/\D/g, "")

// El mapa LID→teléfono lo publica el puente; sin puente no hay nada que reparar y eso no es un error.
export function mapaLid(rutaBridge) {
  try {
    const Database = require("better-sqlite3")
    const m = new Database(rutaBridge, { readonly: true })
    const out = new Map()
    for (const r of m.prepare("SELECT lid, pn FROM whatsmeow_lid_map").all()) out.set(soloDigitos(r.lid), soloDigitos(r.pn))
    m.close()
    return out
  } catch { return new Map() }
}

// Hilo "dueño" de un teléfono: aquel donde ese número aparece como jid normal más veces. Se elige por peso y no por
// nombre a propósito: dos personas pueden llamarse igual, un número no.
export function duenioPorTelefono(filas) {
  const out = new Map()
  for (const r of filas) {
    const num = soloDigitos(String(r.jid).replace(/@.*/, ""))
    const prev = out.get(num)
    if (!prev || prev.n < r.n) out.set(num, { thread: r.thread, n: r.n })
  }
  return out
}

// Devuelve los movimientos a hacer. Pura: se la puede probar sin base de datos.
export function movimientos(mensajes, lidAPn, duenio, mios = MY_NUMBERS) {
  const out = []
  for (const m of mensajes) {
    const pn = lidAPn.get(soloDigitos(String(m.jid).replace(/@.*/, "")))
    if (!pn) continue                        // LID desconocido: no se adivina
    if (mios.has(pn)) continue               // es tu propio LID: habla de vos, no de la conversación
    const d = duenio.get(pn)
    if (!d || d.thread === m.thread) continue
    out.push({ id: m.id, de: m.thread, a: d.thread, num: pn })
  }
  return out
}

export function repararLid({ rutaBridge = process.env.WA_BRIDGE_DB || "/opt/matrix/bridges/whatsapp/mautrix-whatsapp.db", aplicar = false } = {}) {
  const lidAPn = mapaLid(rutaBridge)
  if (!lidAPn.size) return { mover: [], motivo: "sin mapa LID del puente" }
  const duenio = duenioPorTelefono(db().prepare(
    `SELECT thread, jid, COUNT(*) n FROM messages WHERE channel='whatsapp' AND jid LIKE '%@s.whatsapp.net'
     GROUP BY thread, jid`).all())
  const mover = movimientos(db().prepare(
    "SELECT id, thread, jid FROM messages WHERE channel='whatsapp' AND jid LIKE '%@lid'").all(), lidAPn, duenio)
  if (aplicar && mover.length) {
    const upd = db().prepare("UPDATE messages SET thread=? WHERE id=?")
    const tx = db().transaction((rows) => { for (const r of rows) upd.run(r.a, r.id) })
    withRetry(() => tx(mover))               // corre con lectores encima: sin reintento se pierde en silencio
    rebuildStats()
  }
  return { mover }
}

import { createRequire } from "module"
const require = createRequire(import.meta.url)

if (import.meta.url === `file://${process.argv[1]}`) {
  const aplicar = process.argv.includes("--aplicar")
  const { mover, motivo } = repararLid({ aplicar })
  if (motivo) { console.log(motivo); process.exit(0) }
  const porPar = new Map()
  for (const x of mover) { const k = `${x.de} → ${x.a}`; porPar.set(k, (porPar.get(k) || 0) + 1) }
  console.log(aplicar ? "aplicado" : "simulación (no se tocó nada)", "· mensajes mal archivados:", mover.length)
  for (const [k, n] of [...porPar.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`)
}
