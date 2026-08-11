// Cómo se guarda UN mensaje de Telegram. Compartido entre el lector en vivo (src/telegram.mjs) y el importador de
// historial (src/telegram-backfill.mjs) para que las dos vías produzcan filas idénticas — misma forma de id, mismo
// nombre resuelto, mismo ts. Si divergieran, el historial y lo nuevo se verían como conversaciones distintas.
//
// El id es NATIVO (telegram:<chatId>:<msgId>) → volver a importar el mismo mensaje no duplica: la DB lo ignora.

/** Arma la fila a guardar. `ownerName` = tu nombre (así se muestran tus mensajes salientes). */
export async function tgRecord(msg, ownerName) {
  if (!msg) return null
  const mine = !!msg.out
  let name = mine ? ownerName : "?"
  if (!mine) {
    try { const s = await msg.getSender(); name = s?.firstName || s?.username || s?.title || String(msg.senderId || "?") } catch { /* sender borrado/inaccesible → queda "?" */ }
  }
  return {
    id: `telegram:${msg.chatId}:${msg.id}`,
    channel: "telegram",
    account: "tg",
    jid: String(msg.chatId),
    name,
    text: msg.message || "[media/otro]",
    ts: msg.date ? Number(msg.date) * 1000 : Date.now(),
    dir: mine ? "out" : "in",
  }
}

/** Nombre legible de un diálogo (para los logs del importador). */
export const tgDialogName = (d) => d?.title || d?.name || d?.entity?.title || d?.entity?.firstName || d?.entity?.username || String(d?.id || "?")
