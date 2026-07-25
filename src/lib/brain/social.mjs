// brain/social — ingesta de feeds sociales (visión) + digest ejecutivo + generador de posts LinkedIn.
// Único cross-ref a brain: invalidateThreads (para que el digest aparezca en la bandeja) → import DINÁMICO en runtime, nunca en eval-time.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs"
import { ownerFirst, company } from "../hub.mjs"
import { visionLLM, llm } from "../llm.mjs"
import { UNTRUSTED_NOTE, harden } from "../safety.mjs"
import { insertSocialDigest } from "../db.mjs"

const SOCIAL_ITEMS = "./data/social-items.jsonl"
const SELF_MODEL = "./vault/_Brain/self-model.md" // path compartido con brain (const puro, se copia para no importar de la fachada en eval-time)

function _parseJson(s) { // tolera ```json … ``` y texto alrededor
  if (!s) return null
  let t = String(s).replace(/```json|```/g, "").trim()
  const a = t.indexOf("{"), b = t.lastIndexOf("}")
  if (a < 0 || b < 0) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}
function _readSocialItems(days = 3) {
  if (!existsSync(SOCIAL_ITEMS)) return []
  const since = Date.now() - days * 86400e3, out = []
  for (const l of readFileSync(SOCIAL_ITEMS, "utf8").split("\n")) { if (!l.trim()) continue; try { const r = JSON.parse(l); if ((r.ts || 0) >= since) out.push(r) } catch {} }
  return out
}
const _socialKey = (it) => `${String(it.quien || "").toLowerCase().replace(/[^a-z0-9áéíóúñ]/gi, "").slice(0, 20)}:${String(it.que || "").toLowerCase().replace(/[^a-z0-9áéíóúñ]/gi, "").slice(0, 50)}`

export async function ingestSocial(network, images, { sessionExpired, links = [] } = {}) {
  if (!network) return { error: "sin network" }
  const nm = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn" }[network] || network
  if (sessionExpired) { // la sesión del browser se cayó → avisar para re-loguear
    try { const push = await import("../push.mjs"); await push.sendPush({ title: "🔑 Re-logueate", body: `Se cayó la sesión de ${nm}. Volvé a loguearte (setup-login ${network}).`, url: "/", tag: "social-relogin:" + network }) } catch {}
    return { ok: true, sessionExpired: true }
  }
  if (!Array.isArray(images) || !images.length) return { error: "faltan imágenes" }
  const prompt = `${UNTRUSTED_NOTE}\n\nSos el asistente de ${ownerFirst()} (fundador de ${company()}: marketplace de MCP, SaaS B2B para LATAM). Te paso capturas del FEED de ${nm}. Mirá los posts y devolvé SOLO JSON (nada más), en español, SOLO lo que se ve (no inventes):
{"resumen":"1-2 frases del panorama","dms":"nota SOLO si ves DMs/menciones/notificaciones sin leer (ej: '3 mensajes sin leer'), o null","items":[{"quien":"autor","que":"qué posteó en 1 línea","cat":"ia|evento|oportunidad|personal|industria|tendencia|ad|otro","imp":true|false,"video":true|false}]}
- cat: "ia"=IA/tech · "evento"=evento/conferencia/lanzamiento · "oportunidad"=colaboración/convocatoria/alguien busca algo · "personal"=amigos/familia (nacimiento, fallecimiento, logro, viaje, casamiento) · "industria"=startups/negocio/ecommerce/MCP relevante a ${company()} · "tendencia"=algo que MUCHA gente postea · "ad"=publicidad/promoción pagada · "otro"=resto.
- imp=true si es notable (fallecimiento, gran noticia, oportunidad fuerte, MUCHO engagement, algo que le sirve a ${ownerFirst()}). video=true si es reel/video.`
  // procesar hasta 8 capturas en tandas de 4 (visionLLM topea en 4), con RETRY ante fallo transitorio
  const chunks = []
  for (let i = 0; i < Math.min(images.length, 8); i += 4) chunks.push(images.slice(i, i + 4).map((data) => ({ mime: "image/jpeg", data })))
  let resumen = "", dms = "", allItems = []
  for (const imgs of chunks) {
    let p = null
    for (let a = 0; a < 2 && !p; a++) { try { p = _parseJson(await visionLLM(prompt, imgs, { temperature: 0.2 })) } catch { await new Promise((r) => setTimeout(r, 700)) } }
    if (!p) continue
    if (!resumen && p.resumen) resumen = p.resumen
    if (!dms && p.dms && p.dms !== "null") dms = p.dms
    if (Array.isArray(p.items)) allItems.push(...p.items)
  }
  if (!allItems.length && !resumen) return { error: "vision falló (sin datos)" }
  const ts0 = Date.now()
  // DEDUP vs historial reciente (3d) + filtrar PUBLICIDAD (cat=ad) → historial de señal limpia
  const seen = new Set(_readSocialItems(3).map(_socialKey))
  const fresh = []
  for (const it of allItems) { if (it.cat === "ad") continue; const k = _socialKey(it); if (seen.has(k)) continue; seen.add(k); fresh.push(it) }
  try {
    const lines = fresh.map((it) => JSON.stringify({ network, ts: ts0, quien: String(it.quien || "").slice(0, 80), que: String(it.que || "").slice(0, 240), cat: it.cat || "otro", imp: !!it.imp, video: !!it.video }))
    if (lines.length) appendFileSync(SOCIAL_ITEMS, lines.join("\n") + "\n")
    const all = existsSync(SOCIAL_ITEMS) ? readFileSync(SOCIAL_ITEMS, "utf8").split("\n").filter(Boolean) : []
    if (all.length > 1600) writeFileSync(SOCIAL_ITEMS, all.slice(-1500).join("\n") + "\n")
  } catch {}
  const items = allItems.filter((it) => it.cat !== "ad")
  const linkLine = (links || []).length ? `\n\n🔗 Ver posts: ${links.slice(0, 12).map((u, i) => `[${i + 1}](${u})`).join(" · ")}` : ""
  const digest = ((fresh.length ? `🆕 ${fresh.length} posts nuevos\n\n` : "") + (resumen ? resumen + "\n\n" : "") + (dms ? `🔔 ${dms}\n\n` : "") + items.map((it) => `${it.imp ? "⭐ " : "• "}${it.video ? "🎬 " : ""}${it.quien}: ${it.que}`).join("\n") + linkLine).trim() || (resumen || "").slice(0, 400)
  if (!digest) return { error: "sin resumen" }
  const ts = ts0, id = `social:${network}:${ts}`, thread = `social:${network}`
  let saved = false
  for (let i = 0; i < 4 && !saved; i++) { try { insertSocialDigest({ id, network, thread, name: `${nm} Feed`, digest, ts }); saved = true } catch (e) { if (!/locked|busy/i.test(e.message) || i === 3) return { error: e.message, digest }; await new Promise((r) => setTimeout(r, 800)) } }
  const { invalidateThreads } = await import("../brain.mjs"); invalidateThreads() // que aparezca en la bandeja ya (import dinámico en runtime → sin ciclo en eval)
  return { ok: true, items: allItems.length, nuevos: fresh.length, dms: dms || null, digest: digest.slice(0, 500) }
}

// CALIBRAR ESTILO: lee capturas de TUS propios posts de LinkedIn (modo --mine) → guarda ejemplos reales para el generador.
export async function ingestMyStyle(network, images) {
  if (!Array.isArray(images) || !images.length) return { error: "faltan imágenes" }
  const prompt = `${UNTRUSTED_NOTE}\n\nTe paso capturas de los PROPIOS posts de ${ownerFirst()} en LinkedIn (su actividad reciente). Extraé el TEXTO COMPLETO de los posts que escribió ÉL (no reposts, no comentarios de otros, no anuncios), tal cual. Devolvé SOLO JSON: {"posts":["texto del post 1","texto del post 2"]}.`
  let posts = []
  for (let i = 0; i < Math.min(images.length, 12); i += 4) { // procesa TODAS las capturas en tandas de 4
    const imgs = images.slice(i, i + 4).map((data) => ({ mime: "image/jpeg", data }))
    try { const p = _parseJson(await visionLLM(prompt, imgs, { temperature: 0.1 })); if (Array.isArray(p?.posts)) posts.push(...p.posts.filter((t) => t && t.length > 30)) } catch {}
  }
  posts = [...new Set(posts)]
  if (!posts.length) return { error: "no encontré posts propios (¿la actividad estaba vacía?)" }
  let prev = []
  try { prev = JSON.parse(readFileSync("./data/linkedin-mine.json", "utf8")).posts || [] } catch {}
  const merged = [...new Set([...posts, ...prev])].slice(0, 20)
  try { writeFileSync("./data/linkedin-mine.json", JSON.stringify({ ts: Date.now(), posts: merged })) } catch {}
  return { ok: true, captured: posts.length, total: merged.length }
}
// HIGHLIGHTS (sin LLM, barato): oportunidades + notable → para mostrar proactivo en la pestaña IA.
export function socialHighlights({ days = 2 } = {}) {
  return { highlights: _readSocialItems(days).filter((it) => it.cat === "oportunidad" || it.imp).slice(-14).reverse() }
}

// RESUMEN DE REDES on-demand para el coach: cruza lo que vieron IG/FB/LinkedIn → notable / tendencias / oportunidades / IA / tu gente.
const _STOP = new Set("para como este esta esto sobre entre porque cuando desde hasta muy mas más todo todos cada pero unos unas segun según sino solo puede hacer nuevo nueva gente posteo comparte publica publicacion publicación anuncia menciona video reel foto imagen".split(" "))
export async function socialDigest({ days = 3, force = false } = {}) {
  if (!force) { try { const c = JSON.parse(readFileSync("./data/social-digest-cache.json", "utf8")); if (c.digest && Date.now() - (c.ts || 0) < 2 * 3600e3) return { ...c, cached: true } } catch {} }
  const items = _readSocialItems(days)
  if (!items.length) return { digest: "Todavía no leí novedades de tus redes (o no hubo). Los feeds se leen 4×/día — probá más tarde.", count: 0, trends: [], highlights: [] }
  // TENDENCIAS: términos significativos que se repiten (señal de "mucha gente habla de X")
  const freq = {}
  for (const it of items) for (const w of (String(it.que || "").toLowerCase().match(/[a-záéíóúñ]{5,}/gi) || [])) { if (_STOP.has(w)) continue; freq[w] = (freq[w] || 0) + 1 }
  const trends = Object.entries(freq).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, n]) => `${w} (${n})`)
  const highlights = items.filter((it) => it.cat === "oportunidad" || it.imp).slice(-10) // para nudges del coach
  const ctx = items.slice(-160).map((it) => `[${it.network}/${it.cat}${it.imp ? "/★" : ""}] ${it.quien}: ${it.que}`).join("\n")
  const prompt = `Sos el asistente de ${ownerFirst()} (fundador de ${company()}). Te paso TODO lo que vi en sus feeds de Instagram/Facebook/LinkedIn en los últimos ${days} días (${items.length} posts). Armá un RESUMEN EJECUTIVO en español, directo y humano (no suenes a IA), con estas secciones — OMITÍ las que no tengan nada:
🔴 Notable — fallecimientos, nacimientos, grandes noticias, algo urgente
📈 De qué habla mucha gente — tendencias/temas que se repiten (fijate en lo que aparece muchas veces)
🤝 Oportunidades — colaboraciones, convocatorias, eventos que le sirven a ${company()}
🤖 IA / tech — novedades relevantes
👨‍👩‍👧 Tu gente — amigos y familia (y si hay algo para saludar/reaccionar, decilo)
💡 Para vos / ${company()} — 2-3 conclusiones ACCIONABLES: qué post de LinkedIn podrías hacer con esto, a quién convendría escribirle/conectar, qué oportunidad seguir. Esta sección es la más importante — dale análisis, no solo lista.
Viñetas cortas pero con criterio (no solo repetir lo que dice el post, decí por qué importa).${trends.length ? `\nTérminos que más se repiten (pista de tendencias): ${trends.join(", ")}` : ""}\n\nDATOS:\n${ctx}`
  const digest = await llm(prompt, { system: harden(`Sos el jefe de gabinete de ${ownerFirst()} resumiendo sus redes.`), chain: process.env.LLM_CHAIN_ASK || "gemini,openai,ollama", temperature: 0.3 }).then((s) => (s || "").trim()).catch(() => "")
  const out = { digest: digest || "No pude resumir ahora.", count: items.length, trends, highlights }
  if (digest) try { writeFileSync("./data/social-digest-cache.json", JSON.stringify({ ...out, ts: Date.now() })) } catch {}
  return out
}

// GENERADOR DE POSTS PARA LINKEDIN: 2-3 borradores en la voz de ${ownerFirst()}, aprovechando las novedades de los feeds + ${company()}.
export async function linkedinDrafts({ force = false } = {}) {
  if (!force) { try { const c = JSON.parse(readFileSync("./data/linkedin-drafts.json", "utf8")); if (c.drafts?.length && Date.now() - (c.ts || 0) < 8 * 3600e3) return { drafts: c.drafts, basedOn: c.basedOn || 0, cached: true } } catch {} }
  const items = _readSocialItems(5).filter((it) => ["ia", "industria", "tendencia", "evento", "oportunidad"].includes(it.cat))
  const ctx = items.slice(-45).map((it) => `- ${it.quien}: ${it.que}`).join("\n")
  let myPosts = ""
  try { const m = JSON.parse(readFileSync("./data/linkedin-mine.json", "utf8")).posts || []; myPosts = m.slice(0, 6).map((p) => `"${p.slice(0, 350)}"`).join("\n---\n") } catch {}
  let style = ""
  try { const p = JSON.parse(readFileSync("./data/style-profile.json", "utf8")); style = typeof p === "string" ? p : JSON.stringify(p).slice(0, 600) } catch {}
  let brain = ""
  try { brain = readFileSync(SELF_MODEL, "utf8").slice(0, 1200) } catch {}
  const prompt = `Sos ${ownerFirst()}, fundador de ${company()} (marketplace de MCP, SaaS B2B para LATAM; clientes retail). Escribí 3 borradores DISTINTOS de post para LinkedIn en español, EN TU VOZ (founder real, natural, nada corporativo ni con olor a IA), ~5-10 líneas c/u, máx 1-2 emojis.
REGLA CLAVE: cada post DEBE PARTIR DE UNA NOVEDAD/NOTICIA CONCRETA de la lista de abajo (nombrala explícitamente — ej. "vi que salió Gemini Omni…", "leí sobre SouthB2B…") y conectarla con tu experiencia construyendo ${company()} o tu opinión. NADA de posts genéricos tipo "la IA está transformando el retail" sin anclar a una noticia real. Si citás una tendencia, mencioná QUÉ viste.
Ángulos distintos entre los 3: (1) tu TOMA sobre una novedad de IA/tech puntual; (2) una LECCIÓN de ${company()} gatillada por algo que viste; (3) reaccionar a una oportunidad/evento concreto (ej. un programa, una convocatoria) e invitar a conectar.
${myPosts ? `EJEMPLOS DE TUS POSTS REALES DE LINKEDIN (imitá EXACTAMENTE este tono, largo, forma de arrancar y de cerrar):\n${myPosts}\n` : ""}${style ? `Tu estilo: ${style}\n` : ""}${brain ? `Contexto tuyo: ${brain}\n` : ""}
NOVEDADES REALES DE TUS FEEDS (usá estas, no inventes otras):\n${ctx || "(pocas esta vez — usá IA/MCP/founder pero sé concreto)"}\n
Devolvé SOLO JSON: {"drafts":[{"tema":"título corto","gancho":"qué noticia concreta usa","texto":"el post completo"}]}`
  const raw = await llm(prompt, { json: true, system: harden(`Escribís como ${ownerFirst()}, founder. Humano, directo, SIEMPRE anclado a una noticia real.`), chain: "gemini,openai", temperature: 0.75 }).catch(() => null)
  let drafts = []
  if (raw && Array.isArray(raw.drafts)) drafts = raw.drafts
  else { const p = _parseJson(typeof raw === "string" ? raw : JSON.stringify(raw)); if (p?.drafts) drafts = p.drafts }
  drafts = drafts.filter((d) => d && d.texto).slice(0, 3)
  try { writeFileSync("./data/linkedin-drafts.json", JSON.stringify({ ts: Date.now(), drafts, basedOn: items.length })) } catch {}
  return { drafts, basedOn: items.length }
}
