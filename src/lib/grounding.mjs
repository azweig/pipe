// SOURCE GROUNDING compartido (anti-alucinación): verificar que lo extraído por el LLM esté REALMENTE en el texto fuente.
// Usado por extract-actions (todos/promesas → la "cita" debe estar en el transcript) y graphify (entidades → deben tener ancla).
// Funciones PURAS (sin DB ni red) → testeables en aislamiento (test/grounding.mjs).
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim()

// —— todos/promesas: normaliza sacando TODA la puntuación ——
export const stripP = (s) => norm(s).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
export const wordsOf = (s) => new Set(stripP(s).split(" ").filter((w) => w.length > 2))
// ¿la cita está REALMENTE en el texto? substring normalizado, o ≥70% de sus palabras presentes (tolera parafraseo mínimo del LLM).
export function grounded(cita, hayNorm, hayWords) {
  const c = stripP(cita); if (c.length < 6) return false // sin cita usable → no verificable → descartar
  if (hayNorm.includes(c)) return true
  const cw = [...wordsOf(cita)]; if (!cw.length) return false
  return cw.filter((w) => hayWords.has(w)).length / cw.length >= 0.7
}

// —— graphify: normaliza CONSERVANDO @._- (dominios de email / canales) ——
export const gstrip = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s@._-]/gu, " ").replace(/\s+/g, " ").trim()
// ¿la entidad tiene ANCLA textual? nombre completo, o alguna palabra significativa (apellido, dominio) presente en el lote.
export function anchored(name, hay) {
  const s = gstrip(name); if (!s) return false
  if (hay.includes(s)) return true
  return s.split(/[\s@._-]+/).filter((w) => w.length > 2).some((w) => hay.includes(w))
}
