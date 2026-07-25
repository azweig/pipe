// Briefing matutino — saludo + ubicación (auto) + clima + noticias resumidas (config países/temas) + reuniones + plan del día.
import { readFileSync, existsSync, writeFileSync } from "fs"
import { ownerFirst } from "./hub.mjs"
import { llm } from "./llm.mjs"
import { agenda, coachData } from "./brain.mjs"

const CFG = "./data/config.json", STATE = "./data/briefing-state.json"
const CNAME = { PE: "Perú", AR: "Argentina", CO: "Colombia", BO: "Bolivia", US: "Estados Unidos", MX: "México", CL: "Chile", ES: "España" }

export function getConfig() {
  const def = {
    name: ownerFirst(), location: null, voice: "nova",
    news: {
      hours: 10,
      feeds: [ // política = local por país · tecnología = GLOBAL (TechCrunch/mundo)
        { label: "Política Perú", query: "política Perú gobierno congreso presidente economía", gl: "pe" },
        { label: "Política Argentina", query: "política Argentina gobierno Milei economía", gl: "ar" },
        { label: "Tecnología", query: "AI startups big tech funding launch", gl: "us", global: true },
      ],
    },
    routine: {
      wake: "05:30", leave_school: "07:00", back_home: "08:00", breakfast: "08:00",
      notes: "Me levanto 5:30-6am y preparo la lonchera de los chicos. Los llevo al colegio (salgo máximo 7am) y vuelvo máximo 8am. Lo primero que hago al volver es desayunar (y ahí escucho el resumen).",
    },
  }
  const c = existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : {}
  return { ...def, ...c, news: c.news?.feeds ? { ...def.news, ...c.news } : def.news, routine: { ...def.routine, ...(c.routine || {}) } }
}
export function setConfig(patch) { const c = { ...getConfig(), ...patch }; writeFileSync(CFG, JSON.stringify(c, null, 2)); return c }

// ubicación: detecta por IP (una vez), cacheada en config. Se puede sobreescribir (geo del browser).
export async function detectLocation(override) {
  const c = getConfig()
  if (override && override.lat) { const loc = { name: override.name || `${override.city || ""}`, ...override }; setConfig({ location: loc }); return loc }
  if (c.location) return c.location
  try {
    const r = await (await fetch("http://ip-api.com/json/?fields=city,regionName,country,countryCode,lat,lon,timezone")).json()
    const loc = { name: `${r.city}, ${r.country}`, city: r.city, country: r.country, code: r.countryCode, lat: r.lat, lon: r.lon, tz: r.timezone }
    setConfig({ location: loc }); return loc
  } catch { return { name: "Lima, Perú", city: "Lima", country: "Perú", code: "PE", lat: -12.05, lon: -77.04, tz: "America/Lima" } }
}

export async function weather(loc) {
  try {
    const u = `https://wttr.in/${loc.lat},${loc.lon}?format=j1&lang=es`
    const d = await (await fetch(u, { headers: { "User-Agent": "curl/8" }, signal: AbortSignal.timeout(9000) })).json()
    const c = d.current_condition[0], w = d.weather[0]
    const desc = (c.lang_es?.[0]?.value || c.weatherDesc?.[0]?.value || "").toLowerCase()
    return { max: +w.maxtempC, min: +w.mintempC, rain: +(w.hourly?.[4]?.chanceofrain || 0), desc, now: +c.temp_C }
  } catch { return null }
}

async function newsFeed(feed, key, hours) {
  const res = await fetch("https://google.serper.dev/news", { method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q: feed.query, gl: feed.gl || "us", num: 14, tbs: "qdr:d" }) })
  if (!res.ok) return null
  const items = ((await res.json()).news || []).slice(0, 14).map((n) => `- ${n.title} (${n.source}${n.date ? ", " + n.date : ""})`)
  if (!items.length) return null
  const scope = feed.global ? "de tecnología a nivel GLOBAL (lanzamientos, IA, big tech, funding — tipo TechCrunch/The Verge)" : `de ${feed.label} con relevancia NACIONAL real`
  const s = await llm(`De estos titulares, elegí SOLO las 2-3 noticias MÁS IMPORTANTES ${scope} de las últimas ~${hours} horas. DESCARTÁ sin piedad el relleno: eventos locales menores, graduaciones, notas de color, actos municipales, cosas irrelevantes para un ejecutivo. Escribí 2-3 frases cortas, humanas y directas (sin viñetas, sin "aquí tienes", sin asteriscos). Si de verdad no hay nada importante, respondé exactamente: sin novedades relevantes.\n\nTITULARES:\n${items.join("\n")}`).catch(() => "")
  const t = (s || "").trim()
  return t && !/sin novedades/i.test(t) ? { country: feed.label, summary: t } : null
}
export async function news(cfg) {
  const key = process.env.SERPER_API_KEY; if (!key) return []
  const results = await Promise.all((cfg.news.feeds || []).map((f) => newsFeed(f, key, cfg.news.hours).catch(() => null)))
  return results.filter(Boolean)
}

const todayStr = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Lima" }).format(new Date())

export async function buildBriefing({ override } = {}) {
  const cfg = getConfig()
  const loc = await detectLocation(override)
  const now = new Date()
  const hour = +new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: loc.tz }).format(now)
  const greetWord = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches"
  const dateStr = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: loc.tz }).format(now)
  const [w, nw] = await Promise.all([weather(loc), news(cfg)])
  const ag = agenda()

  // agenda según día/hora: domingo o lunes → toda la semana · después de las 18h → hoy y mañana · resto → hoy
  const dowName = new Intl.DateTimeFormat("en-US", { timeZone: loc.tz, weekday: "long" }).format(now)
  const dateAt = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: loc.tz }).format(new Date(now.getTime() + o * 86400000))
  const td = dateAt(0), tomorrow = dateAt(1)
  let agendaScope, agendaLabel, meetings
  if (dowName === "Sunday" || dowName === "Monday") { agendaScope = "week"; agendaLabel = "esta semana"; const end = dateAt(6); meetings = ag.meetings.filter((m) => { const d = (m.start || "").slice(0, 10); return d >= td && d <= end }) }
  else if (hour >= 18) { agendaScope = "today_tomorrow"; agendaLabel = "hoy y mañana"; meetings = ag.meetings.filter((m) => { const d = (m.start || "").slice(0, 10); return d === td || d === tomorrow }) }
  else { agendaScope = "today"; agendaLabel = "hoy"; meetings = ag.meetings.filter((m) => (m.start || "").slice(0, 10) === td) }
  const relDay = (s) => { const d = (s || "").slice(0, 10); return d === td ? "hoy" : d === tomorrow ? "mañana" : new Intl.DateTimeFormat("es", { timeZone: loc.tz, weekday: "long" }).format(new Date(s)) }

  // primera vez del día?
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {}
  const firstToday = state.lastDate !== td
  writeFileSync(STATE, JSON.stringify({ lastDate: td, at: now.toISOString() }))

  // texto hablado
  let spoken = `${greetWord}, ${cfg.name}. Hoy es ${dateStr} en ${loc.city || loc.name}. `
  if (w) spoken += `El día va a estar ${w.desc}, con máxima de ${w.max} grados y mínima de ${w.min}${w.rain >= 30 ? `, y ${w.rain}% de probabilidad de lluvia` : ""}. `
  for (const n of nw) spoken += `${n.country}: ${n.summary.replace(/[-•*]/g, "").replace(/\s+/g, " ").trim()} `
  const mLine = (m) => `${agendaScope === "today" ? "" : relDay(m.start) + " "}a las ${(m.start || "").slice(11, 16)}, ${(m.title || "").replace(/\(.*?\)/g, "").trim()}`
  if (meetings.length) spoken += `En la agenda de ${agendaLabel} tenés ${meetings.length === 1 ? "una reunión" : meetings.length + " reuniones"}: ${meetings.map(mLine).join("; ")}. `
  else spoken += `No tenés reuniones en la agenda de ${agendaLabel}. `
  spoken += `¿Querés que te sugiera cómo encarar el día?`

  return {
    firstToday, greeting: `${greetWord}, ${cfg.name}`, location: loc.name, date: dateStr,
    weather: w, news: nw, meetings: meetings.map((m) => ({ ...m, rel: relDay(m.start) })), agendaScope, agendaLabel, spoken,
  }
}

// resumen humano de la mañana + plan del día, alrededor de la rutina real de ${ownerFirst()}
export async function dailyPlan() {
  const cfg = getConfig(), ag = agenda(), coach = coachData(), loc = cfg.location || {}
  const td = todayStr(loc.tz)
  const meetings = ag.meetings.filter((m) => (m.start || "").slice(0, 10) === td)
  const pend = coach.nudges.slice(0, 6).map((n) => `- ${n.subject}: ${n.insight}`).join("\n")
  const r = cfg.routine || {}
  const plan = await llm(
    `Sos el jefe de gabinete y mano derecha de ${ownerFirst()}: cálido, humano, de mucha confianza, lo conocés bien. Es la mañana, ${ownerFirst()} acaba de volver de dejar a los chicos en el colegio y está desayunando. Contale cómo viene el día HABLÁNDOLE de verdad, tuteo rioplatense, tono de persona real (NADA robótico, NADA de listar nombres sueltos).

Hilá esto natural, como si le hablaras mientras desayuna (4-6 frases fluidas):
1. Un arranque humano y breve (ya madrugó, dejó a los chicos, ahora el mate/desayuno).
2. Lo importante de sus mensajes: contale QUÉ le escribió cada persona clave y POR QUÉ importa, con el contexto real. Ej: "German de TD SYNNEX te está esperando por la renovación de NCE hace unos días, ese lo cerraría hoy". Priorizá lo urgente, hablá de las personas como personas.
3. Cómo encarar el día alrededor de su agenda: cuándo arrancar el trabajo tras el desayuno, un café a media mañana, una pausa para moverse, y qué destrabar primero.
Que suene a alguien real que lo cuida, con esencia y criterio. Nada de bullet points ni "pendientes clave".

RUTINA DE ${ownerFirst()}: ${r.notes || "madruga, lleva a los chicos al colegio, vuelve y desayuna"}
REUNIONES DE HOY: ${meetings.map((m) => `${(m.start || "").slice(11, 16)} ${m.title}`).join(", ") || "no tiene reuniones hoy"}
QUÉ LE ESCRIBIERON / ESPERA RESPUESTA (con contexto real):\n${pend || "nada urgente pendiente"}`
  )
  return { plan: plan.trim() }
}
