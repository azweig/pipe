// LA MISMA PERSONA, DOS FICHAS.
//
// Pasa solo: el mismo contacto escribe desde el celular viejo y del nuevo, o desde el correo del trabajo y el
// personal, y el hub arma dos fichas que nunca se miran entre sí. El síntoma que se ve es el peor: la mitad de la
// conversación falta y nada avisa.
//
// Se detecta por IDENTIFICADOR COMPARTIDO —un teléfono o un correo que aparece en dos hilos—, nunca por nombre: dos
// personas se llaman igual (hay un test entero del proyecto sobre eso), un número no se repite.
//
// Uso:  node scripts/personas-duplicadas.mjs [--fusionar]
import { handle as db } from "../src/lib/db-core.mjs"
import { mergeThreads } from "../src/lib/identity-repo.mjs"
import { writeFileSync } from "fs"

const tel = (s) => { const d = String(s || "").replace(/@.*/, "").replace(/\D/g, ""); return d.length >= 8 && d.length <= 15 ? d : null }
const correo = (s) => { const m = String(s || "").match(/[^\s<>@]+@[^\s<>@.]+\.[^\s<>@]+/); return m ? m[0].toLowerCase() : null }

// Identificadores "duros" de un mensaje. Las salas del puente (!algo:dominio) se ignoran a propósito: identifican una
// conversación, no a una persona, y un grupo las comparte con todos sus miembros.
export function identificadores(m) {
  const out = new Set()
  // La CLAVE del hilo también identifica: un hilo llamado «whatsapp:<número>@s.whatsapp.net» es ese número, aunque
  // sus mensajes no lo lleven en el jid. Así quedaba invisible una ficha suelta de 4 mensajes salientes: el contacto
  // tenía nombre en un hilo y número pelado en el otro, y sólo el nombre del hilo los conectaba.
  const clave = String(m.thread || "")
  if (/^whatsapp:\d{8,15}@s\.whatsapp\.net$/.test(clave)) out.add("tel:" + clave.replace(/\D/g, "").replace(/^0+/, ""))
  if (String(m.jid || "").startsWith("!")) return out
  // Sólo un jid de teléfono cuenta como teléfono. Un LID (el identificador de privacidad de WhatsApp) es una
  // cadena de 13-15 dígitos que PARECE un número y no lo es: tomarlo por tal inventa tres personas duplicadas que
  // no existen. Resolverlo es trabajo de scripts/reparar-lid.mjs, que sí tiene el mapa del puente.
  if (m.channel === "whatsapp" && /@s\.whatsapp\.net$/.test(String(m.jid || ""))) {
    const t = tel(m.jid); if (t) out.add("tel:" + t)
  }
  if (m.channel === "email" || m.channel === "outlook") { const c = correo(m.sender) || correo(m.jid); if (c) out.add("mail:" + c) }
  return out
}

// Agrupa hilos que comparten al menos un identificador. Devuelve los grupos de 2 o más.
export function gruposDuplicados(filas) {
  const porId = new Map()
  for (const f of filas) for (const id of identificadores(f)) {
    if (!porId.has(id)) porId.set(id, new Map())
    const h = porId.get(id); h.set(f.thread, (h.get(f.thread) || 0) + (f.n || 1))
  }
  const out = []
  for (const [id, hilos] of porId) {
    if (hilos.size < 2) continue
    // El hilo con más mensajes manda: es la ficha que el usuario reconoce.
    const orden = [...hilos.entries()].sort((a, b) => b[1] - a[1])
    out.push({ id, principal: orden[0][0], sueltos: orden.slice(1).map(([t, n]) => ({ thread: t, n })) })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function detectar() {
  return gruposDuplicados(db().prepare(
    `SELECT thread, channel, jid, sender, COUNT(*) n FROM messages
     WHERE thread IS NOT NULL AND thread <> '' GROUP BY thread, channel, jid, sender`).all())
}

// Fusionar deja registro. Mover mensajes no borra nada, pero sin saber DE DÓNDE salió cada uno no hay vuelta atrás,
// y esto corre solo por cron: el día que una fusión esté mal, el archivo es la única forma de deshacerla.
export function fusionar(grupos, registro = "./data/personas-duplicadas-registro.json") {
  const hecho = []
  for (const g of grupos) {
    const n = mergeThreads(g.principal, g.sueltos.map((s) => s.thread))
    hecho.push({ id: g.id, principal: g.principal, sueltos: g.sueltos, movidos: n })
  }
  if (hecho.length) try { writeFileSync(registro, JSON.stringify({ ts: Date.now(), hecho }, null, 1)) } catch {}
  return hecho
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const grupos = detectar()
  console.log(grupos.length ? `personas con ficha partida: ${grupos.length}` : "sin personas duplicadas ✓")
  for (const g of grupos) console.log(`  ${g.id}  →  «${g.principal}»  +  ${g.sueltos.map((s) => `«${s.thread}» (${s.n})`).join(", ")}`)
  if (process.argv.includes("--fusionar")) for (const h of fusionar(grupos)) console.log(`     «${h.principal}» ← ${h.movidos} msgs`)
}
