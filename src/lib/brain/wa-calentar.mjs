// ABRIR LA CONVERSACIÓN ANTES DE QUE HAGA FALTA.
//
// Un hilo importado (el .txt de "Exportar chat") tiene historial pero NO tiene sala del puente: nunca existió una
// conversación viva con ese contacto desde el hub. Al responder, el código pide al bridge que la abra y espera ~12s
// a que aparezca. Si el bridge tarda más —y tarda, en una caja cargada—, el envío falla con "probá de nuevo".
//
// Para el usuario eso es indistinguible de "está roto": escribió, vio una advertencia, y no tiene por qué saber que
// alcanzaba con reintentar. Así que la sala se pide al ABRIR la conversación, no al enviar: mientras escribe, el
// bridge ya la está creando, y cuando toca enviar normalmente ya existe.
//
// Reglas duras:
//  · Sólo 1:1. Un grupo NO se puede "abrir" con start-chat, y peor: el id de un grupo de WhatsApp empieza con el
//    número de su creador, así que tratarlo como teléfono abre un chat con una persona ajena. Es la peor falla
//    posible de este sistema y ya está documentada en el proyecto.
//  · Nunca a un número propio.
//  · Fire-and-forget y con memoria de corto plazo: abrir una conversación no puede quedarse esperando al bridge, y
//    entrar diez veces al mismo hilo no puede disparar diez comandos.
import { lastWhatsappRoom, lastHistoricJid } from "../threads-repo.mjs"
import { phoneOf, isContainerJid, MY_NUMBERS } from "../thread.mjs"

const PEDIDOS = new Map() // key → ts del último intento
const REINTENTO_MS = +process.env.WA_CALENTAR_TTL_MS || 120000

// ¿A qué número habría que abrirle la conversación? null si no corresponde (ya hay sala, es grupo, es mío, no hay número).
export function numeroParaAbrir(key, { room, histJid } = {}) {
  const k = String(key || "")
  if (!k) return null
  if (room) return null                                   // ya hay sala viva: no hay nada que abrir
  const crudo = k.replace(/^whatsapp:/, "")
  // El número puede salir del historial o de la propia clave, pero SÓLO si la clave es un 1:1 de WhatsApp.
  const deClave = /^whatsapp:/.test(k) && !isContainerJid(crudo) ? phoneOf(crudo) : null
  const deHist = histJid && !isContainerJid(histJid) ? phoneOf(histJid) : null
  const num = deHist || deClave
  if (!num || num.length < 8) return null
  if (MY_NUMBERS.has(num)) return null                    // escribirte a vos mismo no abre nada útil
  return num
}

// Pide la sala en segundo plano. Devuelve el número si disparó, null si no hacía falta.
// `abrir` se inyecta para poder probar esto sin tocar el bridge.
export function calentarChat(key, abrir, { ahora = Date.now() } = {}) {
  let room = null, histJid = null
  try { room = lastWhatsappRoom(key)?.jid || null } catch {}
  try { histJid = lastHistoricJid(key)?.jid || null } catch {}
  const num = numeroParaAbrir(key, { room, histJid })
  if (!num) return null
  const previo = PEDIDOS.get(key) || 0
  if (ahora - previo < REINTENTO_MS) return null          // ya se pidió recién: entrar diez veces no dispara diez comandos
  PEDIDOS.set(key, ahora)
  // Fire-and-forget: abrir una conversación NO puede quedarse esperando al bridge (regla del proyecto para todo
  // lo que no es la respuesta al usuario).
  void Promise.resolve().then(() => abrir(num)).catch(() => {})
  return num
}

export function _resetCalentar() { PEDIDOS.clear() } // sólo para tests
