// Clasificador de spam con LLM — CAPA 2 (segunda opinión para lo que el detector estructural de lib/spam.mjs no resuelve,
// ej. ventas en texto plano sin links). Corre en el daemon cada N min, en BACKGROUND (nunca en el path de un request).
// Clasifica UNA vez por hilo, cachea el veredicto en data/spam-cache.json → el inbox y el coach lo leen gratis.
// Uso: node src/spam-classify.mjs
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs"
import { loadEnv } from "./lib/env.mjs"
import { inboundUnansweredThreads } from "./lib/db.mjs"
import { llm } from "./lib/llm.mjs"
import { isSpam } from "./lib/spam.mjs"
import { harden, fence } from "./lib/safety.mjs"

loadEnv()

const CACHE = "./data/spam-cache.json"
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {}
const writeCache = () => { const tmp = `${CACHE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(cache)); renameSync(tmp, CACHE) } // atómico
const MAX = +process.env.SPAM_CLASSIFY_MAX || 25 // tope por corrida → costo acotado

// hilos ENTRANTES recientes (14d), un mensaje representativo (el último) por hilo. Excluir grupos, "self", y
// CRÍTICO: hilos donde YA RESPONDISTE (si le contestaste a alguien es un contacto real → nunca spam; evita falsos positivos).
const rows = inboundUnansweredThreads(Date.now() - 14 * 86400000)

const candidates = []
for (const r of rows) {
  if (cache[r.thread] !== undefined) continue // ya tiene veredicto
  if (isSpam(r.jid, r.name, r.text)) { cache[r.thread] = true; continue } // la capa 1 ya lo resuelve → cachear sin gastar LLM
  candidates.push(r)
  if (candidates.length >= MAX) break
}
if (!candidates.length) { writeCache(); console.log("[spam-classify] nada nuevo que clasificar"); process.exit(0) }

// un solo LLM call en LOTE para los N dudosos (barato). El contenido de terceros va fenceado (anti prompt-injection).
const list = candidates.map((r, i) => ({ id: i, de: (r.name || r.jid || "?").slice(0, 40), texto: (r.text || "").replace(/\s+/g, " ").slice(0, 300) }))
const system = harden(`Sos un clasificador de mensajes ENTRANTES. Para cada uno decidí si es SPAM/DIFUSIÓN MASIVA
(promoción, venta NO solicitada, publicidad, oferta, newsletter, difusión, notificación automática/no-reply, cadena)
o CORRESPONDENCIA REAL (una persona escribiéndote directo: trabajo, personal, un cliente, un conocido).
IMPORTANTE:
- Un mensaje que solo COMPARTE un link (TikTok, YouTube, Instagram, una noticia, un meme) es una persona compartiendo algo → NO es spam.
- Un saludo, una pregunta, una coordinación, algo personal o de trabajo → NO es spam.
- SÍ es spam: catálogos/ofertas, "te ofrezco mi servicio", promos de negocios, newsletters, difusiones automáticas.
Ante la DUDA, marcá false (NO spam).`)
const prompt = `Clasificá estos mensajes. Devolvé SOLO JSON {"items":[{"id":N,"spam":true|false}]}.\n${fence(JSON.stringify(list, null, 1), "MENSAJES")}`

// CLOUD-OK: clasificar spam necesita nube rápida/confiable (local no da) y ve solo remitente+asunto+snippet corto, no el hilo completo.
// Decisión DELIBERADA, no un default silencioso. SPAM_CHAIN: gemini primero (free-tier), FALLBACK a ollama local (gratis) → un 429 de
// gemini no tumba la clasificación y no compite con coach/graphify por la quota. Con el A6000: poné SPAM_CHAIN=ollama (todo local).
const res = await llm(prompt, { json: true, system, chain: process.env.SPAM_CHAIN || "gemini,ollama", temperature: 0, task: "spam" }).catch((e) => { console.error("[spam-classify] LLM err:", e.message); return null })
if (!res || !Array.isArray(res.items)) { console.error("[spam-classify] sin respuesta válida"); process.exit(1) }

let n = 0
for (const it of res.items) { const r = candidates[it.id]; if (r) { cache[r.thread] = !!it.spam; if (it.spam) n++ } }
writeCache()
console.log(`[spam-classify] ${candidates.length} clasificados · ${n} spam · cache: ${Object.keys(cache).length} hilos`)
