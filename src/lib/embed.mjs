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

// ── EMPAQUETADO del vector para el índice en disco ──────────────────────────────────────────────────────────
// Un embedding de 768 floats serializado como texto JSON pesa ~15KB. Con 1.8M mensajes elegibles eso son ~27GB
// de disco (y el índice se carga ENTERO en RAM). Cuantizado a int8 y guardado en base64 son ~1KB: ~14x menos.
// Se puede porque el coseno es INVARIANTE A ESCALA — solo importa la dirección del vector, no su magnitud — así
// que dividir por el máximo absoluto y redondear a [-127,127] no cambia el orden de los resultados.
export function packVec(v) {
  let max = 0
  for (let i = 0; i < v.length; i++) { const a = v[i] < 0 ? -v[i] : v[i]; if (a > max) max = a }
  const q = new Int8Array(v.length), k = max ? 127 / max : 0
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] * k)
  return Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString("base64")
}
// acepta el formato nuevo (base64) y el viejo (array de floats) → el índice existente sigue funcionando mientras migra
export function unpackVec(v) {
  if (typeof v !== "string") return v
  const b = Buffer.from(v, "base64")
  return new Int8Array(b.buffer, b.byteOffset, b.byteLength)
}
