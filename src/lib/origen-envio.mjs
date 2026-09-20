// DESDE CUÁL DE TUS NÚMEROS SALE EL MENSAJE.
//
// WhatsApp separa las conversaciones POR NÚMERO. Si le escribís a alguien desde otra de tus líneas, a esa persona le
// llega un chat nuevo de un desconocido; si contesta ahí, la conversación se muda sola a esa línea. Nada de eso da
// error: la única señal para el usuario es que "no le contestan".
//
// La regla vive acá, y no en cada interfaz, porque son tres apps: cualquier diferencia entre ellas es un lugar donde
// el usuario ve una cosa y pasa otra. El servidor decide y las apps sólo dibujan.
const soloDigitos = (x) => String(x || "").replace(/\D/g, "")

// Formatea un número propio para mostrarlo. No "embellece" de más a propósito: el usuario tiene que poder reconocer
// SU línea de un vistazo, y un formato inventado por país es justo lo que la vuelve irreconocible.
export function etiquetaCuenta(id, label = "") {
  const l = String(label || "").trim()
  if (l && !/^\+?\d+$/.test(l)) return l          // el puente ya da un nombre legible: ese manda
  const n = soloDigitos(id)
  return n ? "+" + n : l || ""
}

// Qué cuentas ofrecerle al usuario y cuál está en uso.
//  · sólo las de SESIÓN VIVA: ofrecer una caída manda el mensaje a un pozo (el puente acepta y no entrega),
//  · `usada` es la que de verdad se usaría hoy, no la primera de la lista: si fuera decorativa no serviría para
//    detectar que está saliendo por la línea equivocada, que es todo el punto,
//  · con UNA sola cuenta no hay nada que elegir → `elegible:false` y las apps no dibujan la barra.
export function cuentasParaElegir(cuentas = [], usada = "") {
  const vivas = (cuentas || []).filter((c) => c && c.viva).map((c) => ({
    id: soloDigitos(c.id),
    label: etiquetaCuenta(c.id, c.label),
    agenda: !!c.agenda,                            // ¿esa persona te tiene agendado en ESTA línea?
    usada: soloDigitos(c.id) === soloDigitos(usada),
  })).filter((c) => c.id)
  // Orden estable y con sentido: primero la que se usa, después las que te tienen agendado.
  vivas.sort((a, b) => (b.usada - a.usada) || (b.agenda - a.agenda) || a.id.localeCompare(b.id))
  return { cuentas: vivas, elegible: vivas.length > 1 }
}

// Lo que la interfaz necesita para pintar la barra: cuál mostrar y si el usuario la cambió respecto de la automática.
export function origenVisible(cuentas = [], elegido = "") {
  if (!cuentas || cuentas.length < 2) return { mostrar: false, actual: null, cambiado: false }
  const e = soloDigitos(elegido)
  const actual = cuentas.find((c) => c.id === e) || cuentas.find((c) => c.usada) || cuentas[0]
  return { mostrar: !!actual, actual: actual || null, cambiado: !!(actual && e && !actual.usada) }
}

// LA ELECCIÓN TIENE QUE QUEDARSE.
//
// Si el origen se olvidara al cerrar el chat, el siguiente mensaje volvería solo a la línea anterior — y el usuario
// no tiene cómo notarlo, que es el problema entero que esto vino a resolver. Se guarda por conversación, no global:
// a una persona le escribís desde el trabajo y a otra desde el personal, y eso no es una preferencia, es un hecho.
import { readFileSync, writeFileSync, renameSync } from "fs"

const ARCHIVO = () => process.env.ORIGEN_WA_FILE || "./data/origen-wa.json"

export function leerOrigenes(archivo = ARCHIVO()) {
  try { const o = JSON.parse(readFileSync(archivo, "utf8")); return o && typeof o === "object" ? o : {} } catch { return {} }
}

export function origenGuardado(key, archivo = ARCHIVO()) {
  return soloDigitos(leerOrigenes(archivo)[String(key || "")] || "") || null
}

// Guardar "" borra la elección y vuelve a lo automático: tiene que haber forma de deshacer sin adivinar un número.
export function guardarOrigen(key, id, archivo = ARCHIVO()) {
  const k = String(key || ""); if (!k) return null
  const n = soloDigitos(id)
  const todo = leerOrigenes(archivo)
  if (n) todo[k] = n; else delete todo[k]
  // Escritura atómica: este archivo lo lee el compositor en cada envío, y leerlo a medio escribir sería mandar el
  // mensaje por la línea equivocada — justo la falla que esto evita.
  try {
    const tmp = archivo + ".tmp"
    writeFileSync(tmp, JSON.stringify(todo, null, 1))
    renameSync(tmp, archivo)
  } catch { return null }
  return n || null
}
