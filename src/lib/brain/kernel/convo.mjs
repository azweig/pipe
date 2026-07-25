// brain/kernel/convo — helpers de conversación: clave de hilo idéntica a la bandeja, cola de mensajes, limpieza de texto.
import { threadMessagesTail as dbThreadMsgs } from "../../db.mjs"
import { isSelfThread, isGroupJid, counterpartOf } from "./keys.mjs"

// clave de hilo IDÉNTICA a listThreads (así la conversación muestra EXACTAMENTE lo de la bandeja)
export function threadKeyOf(e, im, n2c) {
  if (isSelfThread(e)) return "self"
  if (isGroupJid(e.jid)) return `${e.channel}:${e.jid}`
  return counterpartOf(e, im, n2c) || `${e.channel}:${e.jid || e.account}`
}
// de SQLite por clave de hilo (índice) — la cola reciente del chat, incluye histórico
export function messagesFor(key, limit = 200) { return dbThreadMsgs(key, { limit }) }
// limpia basura del bridge, markdown crudo y normaliza placeholders de media
export function cleanMsg(t) {
  if (!t) return ""
  if (/Decrypting message from WhatsApp failed|waiting for sender to re-send/i.test(t)) return ""
  t = t.replace(/\s*\(\[learn more\]\([^)]*\)\)/gi, "").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1").trim()
  const media = { "[video]": "📹 Video", "[imagen]": "🖼 Imagen", "[audio]": "🎤 Audio", "[sticker]": "🌟 Sticker", "[otro]": "📎 Adjunto", "[adjunto/otro]": "📎 Adjunto", "[documento]": "📄 Documento", "[ubicación]": "📍 Ubicación", "[contacto]": "👤 Contacto" }
  return media[t] || t
}
