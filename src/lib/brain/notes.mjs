// brain/notes — el segundo cerebro: digest de notas propias (self), chat sobre ellas, y clips. Leaf (sin cross-refs a brain).
import { getMeta, setMeta, selfNotesSince, clipsForNotes, pinnedNotesClips } from "../db.mjs"
import { ownerFirst } from "../hub.mjs"
import { llm } from "../llm.mjs"

// digest pre-generado (cron notes-ai.mjs): resumen + ideas/pendientes + reflexión + temas de tus notas propias.
export function notesDigest() { const raw = getMeta("notes_digest"); if (raw) { try { return JSON.parse(raw) } catch {} } return { generatedAt: 0 } }
// contexto: tus notas (self) de las últimas semanas — texto directo o el resumen si fue nota de voz.
function notesContext(days = 60, cap = 120) {
  const rows = selfNotesSince(Date.now() - days * 86400000, { limit: 200 })
  const out = []
  for (const r of rows) {
    const t = (r.summary && r.summary.trim() && !/^\(/.test(r.summary)) ? r.summary.trim()
      : ((r.text && !/^(🎤 Audio|🖼 Imagen|📹 Video|📄|🌟|📎|📍|👤)/.test((r.text || "").trim())) ? r.text.trim() : "")
    if (t.length < 3) continue
    out.push(`[${new Date(r.ts).toISOString().slice(0, 10)}] ${t.replace(/\s+/g, " ").slice(0, 300)}`)
    if (out.length >= cap) break
  }
  return out.reverse().join("\n").slice(0, 9000)
}
// CHAT: conversar con la IA sobre tus notas. Usa las notas como contexto + memoria corta de la charla (NO inventa).
export async function notesChat(question, history = []) {
  const ctx = notesContext()
  const hist = (history || []).slice(-6).map((h) => `${h.role === "user" ? ownerFirst() : "IA"}: ${h.text}`).join("\n")
  const prompt = `Sos el segundo cerebro de ${ownerFirst()}. Abajo están SUS NOTAS personales de las últimas semanas (cada línea con su fecha). Él las escribe/dicta a diario como volcado de ideas, pendientes y cosas de sus proyectos.
Respondé su mensaje usando SOLO esas notas + el hilo de la charla. Útil, concreto y directo, en español rioplatense. Si te pide resumir/revisar/opinar/conectar, hacelo con lo que hay en las notas. Si algo no está, decilo — NO inventes.

NOTAS:
${ctx || "(sin notas)"}
${hist ? `\nCHARLA PREVIA:\n${hist}\n` : ""}
${ownerFirst()}: ${question}
IA:`
  const answer = await llm(prompt, { chain: process.env.LLM_CHAIN_ASK || "openai", temperature: 0.4, task: "notes-chat", bypassCap: true }).then((s) => (s || "").trim()).catch(() => "")
  return { answer: answer || "No pude procesar eso ahora." }
}
export async function notesChatSend(question) {
  let hist = []; try { hist = JSON.parse(getMeta("notes_chat") || "[]") } catch {}
  const { answer } = await notesChat(question, hist)
  hist.push({ role: "user", text: question, ts: Date.now() }, { role: "ai", text: answer, ts: Date.now() })
  hist = hist.slice(-40)
  setMeta("notes_chat", JSON.stringify(hist))
  return { answer, history: hist }
}
export function notesChatHistory() { try { return JSON.parse(getMeta("notes_chat") || "[]") } catch { return [] } }
// CLIPS: los mensajes que te mandás a vos mismo (thread='self') como notas/ideas/links. Se muestran al instante;
// título+"para qué sirve" los llena el cron clips.mjs (LEFT JOIN). Filtrable por tipo, paginable.
export function notesClips({ kind = "all", before = 0, limit = 40 } = {}) {
  const urlRe = /(https?:\/\/[^\s)]+)/i
  const mapRow = (r) => {
    const url = r.url || (r.text || "").match(urlRe)?.[0] || null
    const kd = r.ckind || (r.mediaType === "audio" ? "audio" : (r.mediaType === "image" || r.mediaType === "sticker") ? "photo" : r.mediaType === "video" ? "video" : (r.mediaType === "document" || r.mediaType === "file") ? "doc" : url ? "link" : "text")
    const rawTitle = r.title || (r.summary && !/^\(/.test(r.summary) ? r.summary : "") || (r.text || "").replace(/\s+/g, " ").trim().slice(0, 120)
    return { id: r.id, ts: r.ts, kind: kd, url, media: r.media || null, mediaType: r.mediaType || null, title: rawTitle, para: r.para || "", text: (r.text || "").slice(0, 300), done: !!r.done, pinned: !!r.pinned, archived: !!r.archived, enriched: !!r.ckind }
  }
  const rows = clipsForNotes({ kind, before, limit: limit + 1 })
  const hasMore = rows.length > limit
  let items = rows.slice(0, limit).map(mapRow)
  // PINEADOS arriba (solo en la 1ra página de "Todo") → lo que querés recordar queda en el top
  if (!before && kind === "all") {
    const pins = pinnedNotesClips().map(mapRow)
    const ids = new Set(pins.map((p) => p.id))
    items = [...pins, ...items.filter((x) => !ids.has(x.id))]
  }
  return { items, hasMore, oldest: items.length ? items[items.length - 1].ts : 0 }
}
