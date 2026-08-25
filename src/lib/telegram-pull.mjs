// PULL DE RESPALDO del lector de Telegram. Vive aparte del reader para poder probarlo con un cliente falso
// (telegram.mjs abre sesión MTProto al importarse, así que no se puede testear directamente).
//
// Baja lo posterior a `since` mirando primero el último mensaje de cada diálogo — getDialogs ya lo trae, así que
// cuando no hay nada nuevo cuesta UNA sola llamada. Comparamos siempre contra el `since` recibido y nunca contra
// un contador que se mueva al guardar: si no, un chat con actividad reciente taparía lo no visto de los demás.
//
// Devuelve { n, masViejo }: cuántos recuperó y la antigüedad del más viejo. Esa antigüedad distingue una carrera
// (mensaje de hace segundos que el stream estaba por entregar) de un stream de updates realmente sordo.
export async function pullDesde({ client, store, since, chats = 25, porChat = 30, ahora = () => Date.now() }) {
  let n = 0, masViejo = 0
  for (const d of await client.getDialogs({ limit: chats })) {
    const topTs = d?.message?.date ? Number(d.message.date) * 1000 : 0
    if (topTs <= since) continue // este chat no tiene nada nuevo
    try {
      for (const m of await client.getMessages(d.entity, { limit: porChat })) {
        const ts = m?.date ? Number(m.date) * 1000 : 0
        if (ts <= since) continue
        await store(m, { live: false }); n++
        masViejo = Math.max(masViejo, ahora() - ts)
      }
    } catch {}
  }
  return { n, masViejo }
}
