// FUENTES DE ACTUALIDAD para el asistente: noticias de varios países, Reddit y los RSS que vos elijas.
//
// Por qué existe: el asistente solo usaba la búsqueda web genérica. A "¿qué pasó esta semana con el papá de Messi?"
// contestaba "no hay información en los datos proporcionados" — porque una pregunta de ACTUALIDAD no se responde con
// el índice general de Google, se responde con prensa, y encima con prensa del país que corresponde (esa noticia vive
// en medios argentinos, no en los peruanos que teníamos por defecto).
//
// Tres fuentes, ninguna con dependencias nuevas:
//   · NOTICIAS  — Serper /news, consultado en VARIOS países y unificado.
//   · REDDIT    — API pública JSON (sin key). Sirve para lo que la prensa no cubre: discusión, reportes de usuarios.
//   · RSS       — los feeds que configures en data/feeds.json. Tus fuentes, sin intermediario.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { newsSearch } from "./research.mjs"

// ── ¿la pregunta es de ACTUALIDAD? ────────────────────────────────────────────────────────────────
// Pura y testeable. Decide si hay que salir a buscar prensa o alcanza con el conocimiento del modelo.
const FRESH = /(hoy|ayer|anoche|esta semana|esta mañana|este mes|ahora|reci[eé]n|[uú]ltim[oa]s?|actual(idad|mente)?|novedad|noticias?|qu[eé] pas[oó]|qu[eé] hay de|se sabe algo|en vivo|acaba de|pas[oó] algo)/iu
export const isCurrentAffairs = (t) => FRESH.test(String(t || ""))

// ── PAÍSES ────────────────────────────────────────────────────────────────────────────────────────
// Serper sesga por país (gl) e idioma (hl). Una sola consulta a Perú se pierde noticias de Argentina o España,
// que es justo lo que pasó con Messi. Se consulta un abanico y se unifica.
export const DEFAULT_LOCALES = [
  { gl: "pe", hl: "es" }, { gl: "ar", hl: "es" }, { gl: "es", hl: "es" },
  { gl: "mx", hl: "es" }, { gl: "us", hl: "en" },
]

const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim()
/** unifica resultados de varias fuentes por título parecido (la misma nota sale en 5 medios) */
export function dedupeByTitle(items) {
  const seen = new Set(), out = []
  for (const it of items) {
    const k = norm(it.title).split(" ").slice(0, 8).join(" ")
    if (!k || seen.has(k)) continue
    seen.add(k); out.push(it)
  }
  return out
}

/** NOTICIAS en varios países a la vez. Falla suave: si un país no responde, seguimos con los demás. */
export async function newsMulti(q, { locales = DEFAULT_LOCALES, perLocale = 4 } = {}) {
  const all = await Promise.all(locales.map((l) =>
    newsSearch(q, { num: perLocale, gl: l.gl, hl: l.hl })
      .then((r) => (r || []).map((x) => ({ ...x, country: l.gl })))
      .catch(() => [])))
  return dedupeByTitle(all.flat()).slice(0, 12)
}

// ── REDDIT (API pública, sin credenciales) ────────────────────────────────────────────────────────
// Aporta lo que la prensa no: hilos de gente contando lo que pasa. `t` acota la ventana temporal.
export async function redditSearch(q, { limit = 5, t = "week" } = {}) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=${t}&limit=${limit}`
  const res = await fetch(url, { headers: { "User-Agent": "pipe-assistant/1.0 (personal use)" } })
  if (!res.ok) throw new Error(`reddit ${res.status}`)
  const d = await res.json()
  return (d?.data?.children || []).map((c) => c.data).filter(Boolean).map((p) => ({
    title: p.title,
    snippet: String(p.selftext || "").replace(/\s+/g, " ").slice(0, 220),
    link: "https://reddit.com" + p.permalink,
    source: "r/" + p.subreddit,
    ups: p.ups || 0,
  }))
}

// ── RSS (tus fuentes) ─────────────────────────────────────────────────────────────────────────────
const FEEDS_FILE = "./data/feeds.json"
// Arranque razonable si no configuraste nada: agencias e internacionales en español e inglés.
export const DEFAULT_FEEDS = [
  { name: "BBC Mundo", url: "https://feeds.bbci.co.uk/mundo/rss.xml" },
  { name: "El País", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada" },
  { name: "Reuters World", url: "https://www.reutersagency.com/feed/?best-topics=world&post_type=best" },
  { name: "AP Top News", url: "https://rsshub.app/apnews/topics/apf-topnews" },
  { name: "Infobae", url: "https://www.infobae.com/feeds/rss/" },
  { name: "El Comercio (PE)", url: "https://elcomercio.pe/arcio/rss/" },
]
export function listFeeds() {
  try { if (existsSync(FEEDS_FILE)) { const f = JSON.parse(readFileSync(FEEDS_FILE, "utf8")); if (Array.isArray(f) && f.length) return f } } catch {}
  return DEFAULT_FEEDS
}
export function saveFeeds(feeds) {
  const clean = (Array.isArray(feeds) ? feeds : []).filter((f) => f && /^https?:\/\//.test(f.url)).slice(0, 40)
    .map((f) => ({ name: String(f.name || f.url).slice(0, 60), url: String(f.url).slice(0, 400) }))
  mkdirSync("./data", { recursive: true })
  writeFileSync(FEEDS_FILE, JSON.stringify(clean, null, 2))
  return clean
}

const strip = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim()
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i")); return m ? strip(m[1]) : "" }
/** parser mínimo de RSS/Atom. PURO (sin red) para poder testearlo. Sin dependencias: no vale sumar una por esto. */
export function parseFeed(xml, feedName = "") {
  const out = []
  const blocks = String(xml || "").split(/<item[\s>]|<entry[\s>]/i).slice(1)
  for (const b of blocks.slice(0, 25)) {
    const title = tag(b, "title")
    if (!title) continue
    let link = tag(b, "link")
    if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : "" } // Atom pone el link en un atributo
    out.push({ title, link, snippet: (tag(b, "description") || tag(b, "summary")).slice(0, 220), date: tag(b, "pubDate") || tag(b, "updated"), source: feedName })
  }
  return out
}

/** ¿el ítem habla de lo que preguntamos? Match por palabras significativas (≥4 letras) del query. */
export function feedMatches(item, q) {
  const words = norm(q).split(/\s+/).filter((w) => w.length >= 4)
  if (!words.length) return false
  const hay = norm(item.title + " " + item.snippet)
  return words.some((w) => hay.includes(w))
}

/** Busca en TUS feeds. Falla suave por feed: uno caído no rompe el resto. */
export async function rssSearch(q, { feeds = listFeeds(), limit = 6, timeoutMs = 6000 } = {}) {
  const one = async (f) => {
    try {
      const ctl = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
      const res = await fetch(f.url, { signal: ctl, headers: { "User-Agent": "pipe-assistant/1.0" } })
      if (!res.ok) return []
      return parseFeed(await res.text(), f.name).filter((it) => feedMatches(it, q))
    } catch { return [] }
  }
  const all = await Promise.all(feeds.slice(0, 12).map(one))
  return dedupeByTitle(all.flat()).slice(0, limit)
}

/**
 * Junta TODO lo de actualidad para una pregunta y lo devuelve como bloque de contexto + fuentes.
 * Cada fuente falla por separado: si Reddit se cae, seguís teniendo prensa y RSS.
 */
export async function gatherCurrent(q, { news = true, reddit = true, rss = true, locales } = {}) {
  const [n, r, f] = await Promise.all([
    news ? newsMulti(q, locales ? { locales } : {}).catch(() => []) : [],
    reddit ? redditSearch(q).catch(() => []) : [],
    rss ? rssSearch(q).catch(() => []) : [],
  ])
  const lines = []
  for (const x of n) lines.push(`- [prensa${x.country ? "/" + x.country : ""}] ${x.title}${x.date ? ` (${x.date})` : ""} — ${x.source} ${x.link}`)
  for (const x of f) lines.push(`- [rss/${x.source}] ${x.title}${x.snippet ? `: ${x.snippet}` : ""} ${x.link}`)
  for (const x of r) lines.push(`- [${x.source}] ${x.title}${x.snippet ? `: ${x.snippet}` : ""} ${x.link}`)
  return { text: lines.join("\n"), counts: { news: n.length, rss: f.length, reddit: r.length } }
}
