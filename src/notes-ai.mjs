// COMPAÑERO DE IA PARA TUS NOTAS. El owner escribe/manda notas todos los días (thread='self': texto + notas de voz).
// Este cron las lee, las RESUME en cosas útiles, saca IDEAS/PENDIENTES y una REFLEXIÓN. Snapshot en meta['notes_digest'].
// La UI (viewNotas) lo lee al instante + permite CONVERSAR sobre las notas (brain.notesChat). Uso: node src/notes-ai.mjs
import { selfNotesSince, setMeta } from "./lib/db.mjs"
import { llm } from "./lib/llm.mjs"

const DAY = 86400000

// stream de notas reales de los últimos 30 días: texto directo, o el resumen si fue nota de voz. Se saltean medias sin texto.
export function recentNotes(days = 30, limit = 120) {
  const since = Date.now() - days * DAY
  const rows = selfNotesSince(since, { limit })
  const out = []
  for (const r of rows) {
    let t = (r.summary && r.summary.trim() && !/^\(/.test(r.summary)) ? r.summary.trim()
      : (r.text && !/^(🎤 Audio|🖼 Imagen|📹 Video|📄|🌟|📎|📍|👤)/.test(r.text.trim()) ? r.text.trim() : "")
    if (t.length < 3) continue
    out.push({ ts: r.ts, text: t.replace(/\s+/g, " ").slice(0, 400) })
  }
  return out.reverse() // cronológico
}

export async function generateNotesDigest() {
  const notes = recentNotes(30, 120)
  if (!notes.length) { setMeta("notes_digest", JSON.stringify({ generatedAt: Date.now(), empty: true })); return { empty: true } }
  const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10)
  const corpus = notes.map((n) => `[${dayOf(n.ts)}] ${n.text}`).join("\n").slice(0, 9000)

  const prompt = `Estas son las NOTAS personales del owner del sistema de los últimos 30 días (cada línea es una nota, con su fecha). Las manda todos los días como volcado de ideas, pendientes, aprendizajes y cosas de sus proyectos.

${corpus}

Actuá como su segundo cerebro. Analizá SOLO lo que está escrito y devolvé JSON:
{
 "resumen": "2 a 4 frases en español rioplatense: en qué viene pensando/trabajando según las notas. Síntesis, no lista.",
 "ideas": ["cada idea/pendiente en UNA frase corta y accionable (máx 12 palabras), REFORMULADA — NO copies la nota textual", "..."],
 "reflexion": "UNA observación útil y honesta como un mentor: un patrón que se repite, algo que viene postergando, algo que conecta con sus metas, o una pregunta que debería hacerse. Directa, no genérica.",
 "temas": ["tema o proyecto recurrente", "..."]
}
Reglas: 'ideas' máximo 6, 'temas' máximo 5, todo sale TEXTUAL de las notas — NO inventes ni supongas nada que no esté escrito.`

  let r
  try { r = await llm(prompt, { json: true, area: "summarize", temperature: 0.3, task: "notes-digest" }) } catch (e) { console.error("[notes-ai]", e.message); return { error: e.message } }
  const snap = {
    generatedAt: Date.now(),
    count: notes.length,
    resumen: (r?.resumen || "").trim(),
    ideas: (r?.ideas || []).filter((x) => x && x.trim()).slice(0, 6),
    reflexion: (r?.reflexion || "").trim(),
    temas: (r?.temas || []).filter((x) => x && x.trim()).slice(0, 5),
  }
  setMeta("notes_digest", JSON.stringify(snap))
  console.log(`[notes-ai] digest de ${notes.length} notas · ${snap.ideas.length} ideas · ${snap.temas.length} temas`)
  return snap
}

if (process.argv[1] && process.argv[1].endsWith("notes-ai.mjs")) {
  generateNotesDigest().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
}
