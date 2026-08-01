// Apify BYOK MULTI-CUENTA para enriquecer contactos (perfiles públicos LinkedIn/IG/FB/X) de forma ANÓNIMA: la infra de Apify
// scrapea con SUS proxies, NO tus cookies → sos invisible para el target. El usuario carga N cuentas Apify (aprovechando el
// free tier de $5/mes de cada una); el cliente hace ROUND-ROBIN, trackea el consumo, y si una llega a su límite reintenta con
// la siguiente. Tokens CIFRADOS en reposo (auth/apify.json gitignoreado). Los actor IDs + su input son editables (cada actor
// tiene su propio schema; {{url}} se reemplaza por el link pegado).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { encSecret, decSecret } from "./secrets.mjs"

const FILE = () => process.env.APIFY_STORE || "auth/apify.json"
const month = () => new Date().toISOString().slice(0, 7) // YYYY-MM — el free tier de Apify se resetea por mes

// actors por plataforma (defaults PROBADOS que devuelven datos REALES en el free tier — pay-per-result, NO de alquiler que dan demo;
// editables por el usuario). En la API de Apify el "/" del id va como "~". Casi todos toman el USERNAME (handle), por eso {{username}}
// = el handle extraído de la URL que pegás (instagram.com/leomessi → leomessi). {{url}} sigue disponible para actors que quieran la URL.
const DEFAULT_ACTORS = {
  linkedin:  { id: "apimaestro~linkedin-profile-detail", input: { username: "{{username}}" } },      // basic_info + experience + education (funciona sin cookies)
  instagram: { id: "apify~instagram-profile-scraper",     input: { usernames: ["{{username}}"], includeAboutSection: false } },
  facebook:  { id: "lazyscraper~facebook-profile-scraper", input: { user_name: "{{username}}" } },
  x:         { id: "dead00~twitter-profile-scraper-no-cookies", input: { usernames: ["{{username}}"] } },
}
// handle/username desde una URL de perfil: instagram.com/leomessi → leomessi · x.com/@elon → elon · linkedin.com/in/xxx → xxx
function handleFromUrl(u) {
  try { const seg = new URL(String(u)).pathname.replace(/\/+$/, "").split("/").filter(Boolean); return (seg.pop() || "").replace(/^@/, "") } catch { return String(u || "").trim().replace(/^@/, "") }
}

function load() { try { if (existsSync(FILE())) return JSON.parse(readFileSync(FILE(), "utf8")) } catch {} return { accounts: [], rr: 0, actors: {} } }
function save(o) { try { mkdirSync("auth", { recursive: true }) } catch {} writeFileSync(FILE(), JSON.stringify(o, null, 2)) }
const actorsCfg = (s) => ({ ...DEFAULT_ACTORS, ...(s.actors || {}) })

// ── cuentas (tokens CIFRADOS en reposo; la UI nunca ve el token en claro, solo los últimos 4) ──
export function apifyAccounts() {
  const s = load(), m = month()
  return {
    accounts: (s.accounts || []).map((a) => ({ id: a.id, name: a.name, runs: a.runs || 0, usd: Math.round((a.usd || 0) * 1000) / 1000, exhausted: a.exhaustedMonth === m, hint: "••••" + String(decSecret(a.token || "")).slice(-4) })),
    rr: s.rr || 0, actors: actorsCfg(s), month: m,
  }
}
export function addApifyAccount({ name, token } = {}) {
  if (!token || !String(token).trim()) throw new Error("falta el token de Apify")
  const s = load(); s.accounts = s.accounts || []
  s.accounts.push({ id: "ap" + Date.now().toString(36), name: (name || `Cuenta ${s.accounts.length + 1}`).trim(), token: encSecret(String(token).trim()), runs: 0, usd: 0, exhaustedMonth: null })
  save(s); return apifyAccounts()
}
export function removeApifyAccount(id) { const s = load(); s.accounts = (s.accounts || []).filter((a) => a.id !== id); save(s); return apifyAccounts() }
export function setApifyActors(actors) { const s = load(); s.actors = actors || {}; save(s); return apifyAccounts() }
export function hasApify() { return (load().accounts || []).length > 0 }

// ── correr UN actor con un token (run-sync → devuelve los items del dataset directo). 402 = free tier agotado. ──
async function runOne(token, actorId, input) {
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(150000) })
  if (res.status === 402 || res.status === 403 || res.status === 429) { const t = await res.text(); const e = new Error("apify-quota"); e.quota = res.status === 402 || res.status === 429 || /limit|usage|exceed|quota|monthly|insufficient/i.test(t); if (!e.quota) e.message = `apify ${res.status}: ${t.slice(0, 120)}`; throw e }
  if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 150)}`)
  return await res.json()
}
// ROUND-ROBIN + failover: salta cuentas agotadas este mes; si una da error de cuota la marca y sigue con la siguiente.
export async function runActor(platform, urlStr) {
  const s = load(), m = month()
  const cfg = actorsCfg(s)[platform]; if (!cfg || !cfg.id) throw new Error(`sin actor configurado para ${platform}`)
  const cleanUrl = String(urlStr).replace(/"/g, "")
  const input = JSON.parse(JSON.stringify(cfg.input).replace(/\{\{url\}\}/g, cleanUrl).replace(/\{\{username\}\}/g, handleFromUrl(cleanUrl).replace(/"/g, "")))
  const avail = (s.accounts || []).filter((a) => a.exhaustedMonth !== m)
  if (!avail.length) throw new Error((s.accounts || []).length ? "todas tus cuentas Apify llegaron a su límite mensual" : "no hay cuentas Apify configuradas")
  const start = (s.rr || 0) % avail.length
  let lastErr = null
  for (let i = 0; i < avail.length; i++) {
    const a = avail[(start + i) % avail.length]
    try {
      const items = await runOne(decSecret(a.token), cfg.id, input)
      const acc = s.accounts.find((x) => x.id === a.id); if (acc) acc.runs = (acc.runs || 0) + 1
      s.rr = ((s.rr || 0) + 1); save(s)                                  // avanzar el round-robin para la próxima
      return { items: Array.isArray(items) ? items : [], account: a.name }
    } catch (e) {
      lastErr = e
      if (e.quota) { const acc = s.accounts.find((x) => x.id === a.id); if (acc) { acc.exhaustedMonth = m; save(s) }; continue } // agotada → siguiente cuenta
      throw e // error real (actor/input mal, red) → no seguir rotando
    }
  }
  throw lastErr || new Error("todas las cuentas Apify fallaron")
}

// ── enriquecer: corre los actors de los links que el usuario pegó; devuelve la data cruda por plataforma (+ errores) ──
export async function investigateProfiles({ linkedin, instagram, facebook, x } = {}) {
  const out = { raw: {}, errors: {}, accounts: {} }
  const jobs = [["linkedin", linkedin], ["instagram", instagram], ["facebook", facebook], ["x", x]].filter(([, u]) => u && /^https?:\/\//.test(String(u)))
  for (const [plat, u] of jobs) {
    try { const r = await runActor(plat, u); out.raw[plat] = r.items; out.accounts[plat] = r.account } catch (e) { out.errors[plat] = e.message }
  }
  return out
}
