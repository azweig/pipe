// Cliente de la API de Unipile para ENVIAR (el reader src/unipile.mjs se encarga de recibir). Usado por sendReply cuando el
// contacto está en un número gestionado por Unipile (el bridge de ese número está deslogueado a propósito).
const KEY = process.env.UNIPILE_API_KEY || ""
const DSN = (process.env.UNIPILE_DSN || "").replace(/\/+$/, "")

export function unipileConfigured() { return !!(KEY && DSN) }

async function uni(path, opts = {}) {
  return fetch(`${DSN}/api/v1${path}`, { ...opts, headers: { "X-API-KEY": KEY, accept: "application/json", ...(opts.headers || {}) } })
}

// chat_id de Unipile para un contacto, a partir de su jid de WhatsApp (X@s.whatsapp.net o X@lid).
// OJO: el límite de /chats es ~250; pasar más devuelve 0. Paginamos de a 100 con cursor.
async function chatIdFor(jid) {
  const num = String(jid || "").split(/[@:]/)[0]
  // grupo legacy = <número_del_creador>-<ts>@g.us → startsWith(num) matcheaba un grupo CREADO por el contacto → DM al grupo.
  const grp = (s) => /@g\.us$/.test(s || ""), numOf = (s) => grp(s) ? "" : String(s || "").split(/[@:]/)[0]
  let cursor = null
  for (let page = 0; page < 8; page++) {
    const r = await (await uni(`/chats?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json()
    const items = r.items || []
    const hit = items.find((c) => c.provider_id === jid || (c.attendee_public_identifier || "") === jid ||   // match EXACTO (incluye grupos)
      (num && !grp(c.provider_id) && (numOf(c.provider_id) === num || numOf(c.attendee_public_identifier) === num)))   // DM: número COMPLETO, nunca prefijo de un @g.us
    if (hit) return hit.id
    cursor = r.cursor
    if (!cursor || !items.length) break
  }
  return null
}

// envía texto a un contacto/grupo gestionado por Unipile. jid = provider_id del chat (contacto o @g.us).
export async function unipileSend(jid, text) {
  if (!unipileConfigured()) return { error: "Unipile no configurado" }
  try {
    const chatId = await chatIdFor(jid)
    if (!chatId) return { error: "no encuentro ese chat en Unipile" }
    const fd = new FormData()
    fd.append("text", String(text || ""))
    const r = await uni(`/chats/${chatId}/messages`, { method: "POST", body: fd })
    if (!r.ok) return { error: `Unipile envío ${r.status}: ${(await r.text()).slice(0, 140)}` }
    return { ok: true }
  } catch (e) { return { error: "Unipile: " + (e.message || e) } }
}
