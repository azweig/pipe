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
  // — GLOBAL / agencias —
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", tags: "global" },
  { name: "BBC Mundo", url: "https://feeds.bbci.co.uk/mundo/rss.xml", tags: "global,es" },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", tags: "global" },
  { name: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", tags: "global,us" },
  { name: "NYT Home", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", tags: "us" },
  { name: "Washington Post World", url: "https://feeds.washingtonpost.com/rss/world", tags: "us" },
  { name: "CNN World", url: "http://rss.cnn.com/rss/edition_world.rss", tags: "global,us" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", tags: "global,me" },
  { name: "Al Jazeera Español", url: "https://www.aljazeera.net/aljazeerarss/es/rss.xml", tags: "es,me" },
  { name: "Haaretz", url: "https://www.haaretz.com/cmlink/1.4605102", tags: "il,me" },
  { name: "France24 Español", url: "https://www.france24.com/es/rss", tags: "es,eu" },
  { name: "DW Español", url: "https://rss.dw.com/rdf/rss-sp-all", tags: "es,eu" },
  { name: "Euronews", url: "https://www.euronews.com/rss", tags: "eu" },
  { name: "Deutsche Welle", url: "https://rss.dw.com/rdf/rss-en-world", tags: "eu" },
  { name: "SCMP (Asia)", url: "https://www.scmp.com/rss/91/feed", tags: "asia" },
  { name: "The Japan Times", url: "https://www.japantimes.co.jp/feed/", tags: "asia" },
  { name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", tags: "asia" },
  { name: "AllAfrica", url: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", tags: "africa" },
  // — ESPAÑA —
  { name: "El País", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", tags: "es" },
  { name: "El Mundo", url: "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml", tags: "es" },
  { name: "RTVE", url: "https://api2.rtve.es/rss/temas_noticias.xml", tags: "es" },
  // — ARGENTINA —
  { name: "Clarín", url: "https://www.clarin.com/rss/lo-ultimo/", tags: "ar" },
  { name: "La Nación", url: "https://www.lanacion.com.ar/arc/outboundfeeds/rss/?outputType=xml", tags: "ar" },
  // — PERÚ —
  { name: "El Comercio (PE)", url: "https://elcomercio.pe/arcio/rss/", tags: "pe" },
  { name: "RPP", url: "https://rpp.pe/feed", tags: "pe" },
  { name: "Gestión", url: "https://gestion.pe/arcio/rss/", tags: "pe,economia" },
  // — RESTO DE LATAM —
  { name: "El Tiempo (CO)", url: "https://www.eltiempo.com/rss/colombia.xml", tags: "co" },
  { name: "La Tercera (CL)", url: "https://www.latercera.com/arcio/rss/", tags: "cl" },
  { name: "Folha (BR)", url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", tags: "br" },
  { name: "El Observador (UY)", url: "https://www.elobservador.com.uy/rss/pages/portada.xml", tags: "uy" },
  // — ECONOMÍA / NEGOCIOS —
  { name: "FT World", url: "https://www.ft.com/world?format=rss", tags: "economia" },
  { name: "Bloomberg Markets", url: "https://feeds.bloomberg.com/markets/news.rss", tags: "economia" },
  { name: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", tags: "economia" },
  // — TECNOLOGÍA —
  { name: "Hacker News", url: "https://hnrss.org/frontpage", tags: "tech" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", tags: "tech" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", tags: "tech" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", tags: "tech" },
  // — TENDENCIAS / REDES (RSS públicos, sin credenciales) —
  { name: "Google Trends (PE)", url: "https://trends.google.com/trending/rss?geo=PE", tags: "trends" },
  { name: "Google Trends (AR)", url: "https://trends.google.com/trending/rss?geo=AR", tags: "trends" },
  { name: "Google Trends (US)", url: "https://trends.google.com/trending/rss?geo=US", tags: "trends" },
  { name: "Google Trends (ES)", url: "https://trends.google.com/trending/rss?geo=ES", tags: "trends" },
  { name: "Reddit /r/worldnews", url: "https://www.reddit.com/r/worldnews/.rss", tags: "social" },
  { name: "Reddit /r/news", url: "https://www.reddit.com/r/news/.rss", tags: "social" },
  // — verificadas una por una con curl (las que daban 403/404 se sacaron, no se dejan "por las dudas") —
  { name: "WSJ World", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", tags: "global,us,economia" },
  { name: "Jerusalem Post", url: "https://www.jpost.com/rss/rssfeedsfrontpage.aspx", tags: "il,me" },
  { name: "Le Monde (EN)", url: "https://www.lemonde.fr/en/rss/une.xml", tags: "eu" },
  { name: "France24 (FR)", url: "https://www.france24.com/fr/rss", tags: "eu" },
  { name: "elDiario.es", url: "https://www.eldiario.es/rss/", tags: "es" },
  { name: "El País Internacional", url: "https://elpais.com/rss/internacional/portada.xml", tags: "es,global" },
  { name: "Perfil (AR)", url: "https://www.perfil.com/feed", tags: "ar" },
  { name: "Ámbito (AR)", url: "https://www.ambito.com/rss/pages/home.xml", tags: "ar,economia" },
  { name: "La República (PE)", url: "https://larepublica.pe/rss/politica/", tags: "pe" },
  { name: "G1 Mundo (BR)", url: "https://g1.globo.com/rss/g1/mundo/", tags: "br" },
  { name: "CBC World (CA)", url: "https://www.cbc.ca/webfeed/rss/rss-world", tags: "ca" },
  { name: "ABC News (AU)", url: "https://www.abc.net.au/news/feed/51120/rss.xml", tags: "au" },
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

// Palabras largas pero VACÍAS de contenido. Sin esta lista, "¿qué pasó con el papá de Messi?" matcheaba
// "Turquía da un nuevo PASO hacia la paz" — un titular que no tiene nada que ver. El ruido es peor que el silencio:
// una noticia irrelevante en el contexto puede hacer que el modelo conteste cualquier cosa.
const STOP = new Set(["paso", "pasó", "pasa", "esta", "este", "esto", "eso", "sobre", "para", "como", "cuando", "cuándo",
  "donde", "dónde", "hace", "todo", "toda", "mismo", "misma", "algo", "alguien", "tiene", "tienen", "hacer", "puede",
  "semana", "mes", "año", "años", "dia", "día", "dias", "días", "hoy", "ayer", "ahora", "mucho", "poco", "otra", "otro",
  "que", "the", "with", "from", "this", "that", "what", "when", "where", "about", "have", "has", "week", "today"])
/** ¿el ítem habla de lo que preguntamos? Match por palabras con CONTENIDO (≥4 letras y fuera de la lista vacía). */
export function feedMatches(item, q) {
  const words = norm(q).split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w))
  if (!words.length) return false
  const hay = norm(item.title + " " + item.snippet)
  return words.some((w) => hay.includes(w))
}

// ── ÍNDICE LOCAL DE TITULARES ─────────────────────────────────────────────────────────────────────
// Con ~50 fuentes, bajarlas en cada pregunta sería lentísimo (y una descortesía con los medios). Un job de fondo
// las refresca cada 20 min a un índice local, y la pregunta se responde contra ese índice: instantáneo y sin red.
const CACHE_FILE = "./data/feed-cache.json"
const CACHE_MAX = 4000

export function feedCache() {
  try { const c = JSON.parse(readFileSync(CACHE_FILE, "utf8")); return Array.isArray(c.items) ? c : { items: [], at: 0 } } catch { return { items: [], at: 0 } }
}

/** Baja TODOS los feeds y refresca el índice. Cada feed falla por su cuenta: uno caído no arruina la corrida. */
export async function refreshFeeds({ feeds = listFeeds(), timeoutMs = 9000, concurrency = 8 } = {}) {
  const fetched = []
  const errors = []
  const one = async (f) => {
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "pipe-assistant/1.0 (+personal)" } })
      if (!res.ok) { errors.push(`${f.name}: HTTP ${res.status}`); return }
      const items = parseFeed(await res.text(), f.name)
      if (!items.length) { errors.push(`${f.name}: sin ítems`); return }
      for (const it of items) fetched.push({ ...it, tags: f.tags || "", seen: Date.now() })
    } catch (e) { errors.push(`${f.name}: ${String(e.message).slice(0, 40)}`) }
  }
  for (let i = 0; i < feeds.length; i += concurrency) await Promise.all(feeds.slice(i, i + concurrency).map(one))
  // se conserva lo viejo para no perder contexto entre corridas; el dedupe deja la copia más reciente arriba
  const prev = feedCache().items || []
  const merged = dedupeByTitle([...fetched, ...prev]).slice(0, CACHE_MAX)
  mkdirSync("./data", { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), items: merged }))
  return { ok: fetched.length, feeds: feeds.length, fallaron: errors.length, errors: errors.slice(0, 8), total: merged.length }
}

/** Busca en el ÍNDICE (instantáneo). Si todavía está vacío, cae a bajar unos pocos feeds en vivo para no dejarte sin nada. */
export async function rssSearch(q, { limit = 8 } = {}) {
  const c = feedCache()
  if (c.items?.length) return dedupeByTitle(c.items.filter((it) => feedMatches(it, q))).slice(0, limit)
  const live = await Promise.all(listFeeds().slice(0, 6).map(async (f) => {
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "pipe-assistant/1.0" } })
      return res.ok ? parseFeed(await res.text(), f.name).filter((it) => feedMatches(it, q)) : []
    } catch { return [] }
  }))
  return dedupeByTitle(live.flat()).slice(0, limit)
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
