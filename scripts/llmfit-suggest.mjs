#!/usr/bin/env node
// Integración llmfit → pipe: detecta el hardware (vía llmfit) y sugiere qué modelo local usar en cada ÁREA del router
// (correct/summarize/draft/ask/think/vision/embed), con los comandos `ollama pull` listos. NO muta la config viva:
// imprime la recomendación para que el onboarding OSS (o vos) la aplique. Idea del usuario: "gpt2 basta para ortografía;
// kimi/reasoning para lo complejo" → cada tarea su modelo por complejidad, dentro de lo que la máquina aguanta.
//
// Uso:  llmfit fit --json | node scripts/llmfit-suggest.mjs
//   o:  node scripts/llmfit-suggest.mjs /ruta/al/fit.json
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"

function loadFit() {
  const arg = process.argv[2]
  if (arg) return JSON.parse(readFileSync(arg, "utf8"))
  if (!process.stdin.isTTY) return JSON.parse(readFileSync(0, "utf8")) // desde el pipe
  // último recurso: correr llmfit
  return JSON.parse(execSync("llmfit fit --json", { maxBuffer: 64 * 1024 * 1024 }).toString())
}

// ÁREA del router de pipe → categoría llmfit + criterio de elección (por complejidad de la tarea)
const AREAS = [
  { area: "correct",   why: "ortografía/gramática — barato y rápido", cats: ["Chat", "General"], pick: "fastest", maxGb: 6 },
  { area: "summarize", why: "resúmenes — equilibrado",                cats: ["General", "Chat"], pick: "balanced", maxGb: 10 },
  { area: "draft",     why: "redactar respuestas en tu voz",           cats: ["General", "Chat"], pick: "balanced", maxGb: 12 },
  { area: "ask",       why: "preguntas sobre tus datos (Jarvis)",      cats: ["General", "Chat"], pick: "quality",  maxGb: 14 },
  { area: "think",     why: "razonamiento complejo",                   cats: ["Reasoning"],       pick: "quality",  maxGb: 16 },
  { area: "vision",    why: "leer imágenes/PDF (catchup multimodal)",  cats: ["Multimodal"],      pick: "balanced", maxGb: 12 },
  { area: "embed",     why: "búsqueda/RAG (facetas, notas)",           cats: ["Embedding"],       pick: "fastest",  maxGb: 4 },
]

const num = (x) => (typeof x === "number" ? x : 0)
// familias instruct/chat conocidas y confiables (evita modelos-juguete/clasificadores raros del catálogo crudo)
const REPUTABLE = /qwen|llama|mistral|mixtral|deepseek|gemma|phi-?\d|hermes|command-?r|granite|nemotron|smollm|dolphin|openhermes|yi-|internlm|glm-?4/i
const EMBED_FAM = /bge|gte|nomic|e5|embeddinggemma|qwen3-embedding|snowflake|arctic|mxbai/i
const MIN_CHAT_GB = 3 // piso de tamaño: un instruct real (~7B) pesa >3GB; corta clasificadores de <1GB
function choose(models, spec) {
  const emb = spec.area === "embed"
  const fam = emb ? EMBED_FAM : REPUTABLE
  const base = (m) => spec.cats.includes(m.category) && ["Perfect", "Good"].includes(m.fit_level) && (m.gguf_sources || []).length && fam.test(m.name)
  let pool = models.filter((m) => base(m) && num(m.memory_required_gb) <= spec.maxGb && (emb || num(m.memory_required_gb) >= MIN_CHAT_GB))
  if (!pool.length) pool = models.filter((m) => base(m)) // afloja el tope de RAM si hiciera falta
  if (!pool.length) pool = models.filter((m) => spec.cats.includes(m.category) && ["Perfect", "Good"].includes(m.fit_level) && (m.gguf_sources || []).length) // último recurso: pullable del rubro
  if (!pool.length) return null
  // preferir orgs OFICIALES (evita fine-tunes raros de la comunidad con nombres largos)
  const OFFICIAL = /^(Qwen|meta-llama|mistralai|deepseek-ai|google|microsoft|ibm-granite|nvidia|allenai|HuggingFaceTB)\//
  const official = pool.filter((m) => OFFICIAL.test(m.name))
  if (official.length) pool = official
  const byTps = (a, b) => num(b.estimated_tps) - num(a.estimated_tps)
  const byMem = (a, b) => num(b.memory_required_gb) - num(a.memory_required_gb) // proxy de "más capaz" = el más grande que entra
  if (spec.pick === "fastest") pool.sort(byTps)
  else if (spec.pick === "quality") pool.sort(byMem)
  else pool.sort((a, b) => (num(b.estimated_tps) * num(b.memory_required_gb)) - (num(a.estimated_tps) * num(a.memory_required_gb))) // balanced = tps × tamaño
  return pool[0]
}
const ollamaPull = (m) => {
  const g = (m.gguf_sources || [])[0]
  return g ? `ollama pull hf.co/${g.repo}:${m.best_quant || "Q8_0"}` : `# (sin fuente GGUF directa para ${m.name} — buscá el tag equivalente en Ollama)`
}

const fit = loadFit()
const models = fit.models || (Array.isArray(fit) ? fit : [])
const hw = fit.system || fit.hardware || null

console.log("# pipe · modelos locales recomendados por tu hardware (llmfit)\n")
if (hw) console.log(`Hardware: ${hw.gpu_name || "CPU"}${hw.gpu_vram_gb ? ` · ${Math.round(hw.gpu_vram_gb)}GB VRAM` : ""} · ${Math.round(hw.total_ram_gb || 0)}GB RAM\n`)
console.log("| área | para qué | modelo | quant | RAM | tps |")
console.log("|---|---|---|---|---|---|")
const pulls = new Set()
const cfg = {}
for (const spec of AREAS) {
  const m = choose(models, spec)
  if (!m) { console.log(`| ${spec.area} | ${spec.why} | — sin fit — | | | |`); continue }
  console.log(`| ${spec.area} | ${spec.why} | ${m.name} | ${m.best_quant || ""} | ${m.memory_required_gb}GB | ~${m.estimated_tps} |`)
  pulls.add(ollamaPull(m))
  cfg[spec.area] = { model: m.name, quant: m.best_quant, gguf: (m.gguf_sources || [])[0]?.repo || null }
}
console.log("\n## Descargar en Ollama (GPU box):\n```bash")
for (const p of pulls) console.log(p)
console.log("```")
console.log("\n## Mapa área→modelo (para el router / onboarding):\n```json")
console.log(JSON.stringify(cfg, null, 2))
console.log("```")
