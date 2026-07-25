// brain/kernel/objetivos — matching PURO evento↔objetivo (taggea agenda/reuniones con los objetivos del usuario). Sin I/O.
// Compartido por coach (_testMatchObjetivo), meetings (genMeetingCards) y schedule (calendarData) → kernel, no se re-exporta por la fachada.
const _OBJ_STOP = new Set("llegar abrir operacion operación sanear ordenar tiempo calidad con para del los las una uno personales familiares nuevos nueva mantener crear aumentar incrementar cumplir".split(" "))
export function matchObjetivo(m, objetivos) {
  const hay = ` ${`${m.title || ""} ${(m.location || "")} ${(m.attendees || []).map((a) => (a && (a.name || a.email)) || a).join(" ")}`.toLowerCase()} `
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  for (const o of objetivos || []) {
    // palabras SIGNIFICATIVAS del objetivo (sin stopwords) — el evento debe mencionar alguna para considerarlo relacionado
    const stems = norm(String(o.title || "").toLowerCase()).split(/\s+/).filter((w) => w.length >= 3 && !_OBJ_STOP.has(w)).map((w) => w.replace(/(es|s)$/, "")).filter((w) => w.length >= 3)
    if (stems.some((st) => new RegExp("\\b" + st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(norm(hay)))) {
      return { title: o.title, scope: o.scope, unit: o.unit || "", current: o.current || 0, target: o.target || 0, pct: Math.min(100, Math.round(100 * (o.current || 0) / (o.target || 1))) }
    }
  }
  return null
}
