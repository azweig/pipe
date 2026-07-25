// Embeddings locales (Ollama / nomic-embed-text) + similitud coseno. Base del RAG semántico.
const HOST = process.env.OLLAMA_HOST || "http://localhost:11434"
const MODEL = process.env.EMBED_MODEL || "nomic-embed-text"

export async function embed(text) {
  try {
    const r = await fetch(HOST + "/api/embeddings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, prompt: (text || "").slice(0, 2000) }) })
    const j = await r.json()
    return j.embedding || null
  } catch { return null }
}

export function cosine(a, b) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// top-K por similitud coseno contra un índice [{...,vec}]
export function topK(queryVec, index, k = 40) {
  const scored = []
  for (const it of index) { if (it.vec) scored.push({ it, s: cosine(queryVec, it.vec) }) }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, k)
}
