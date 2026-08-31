// Motor LLM MULTI-PROVEEDOR con fallback automático. Usa lo que tenga capacidad: Gemini(gratis) → OpenAI($) → Ollama(local).
// Si un proveedor da 429/cuota/error, cae al siguiente solo. Orden configurable: LLM_CHAIN="gemini,openai,ollama".
// Keys en .env: GEMINI_API_KEY, OPENAI_API_KEY (opcional ANTHROPIC_API_KEY). Ollama en OLLAMA_HOST (default localhost:11434).
import { readFileSync, existsSync, writeFileSync, statSync, renameSync } from "fs"
import { lookup } from "dns/promises"
import { withLock } from "./lock.mjs"
import { encSecret, decSecret } from "./secrets.mjs"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── BYOK (bring-your-own-key): motor configurable por-hub en data/llm-config.json. El usuario elige proveedores + pega SUS
// tokens desde la app; si no hay config, cae al .env. Así cada cliente decide A DÓNDE van sus datos (OpenAI/Claude/Gemini/self-hosted). ──
const LLM_CFG = "./data/llm-config.json"
let _lc = null, _lcM = -1
function llmConfig() {
  try { const m = existsSync(LLM_CFG) ? statSync(LLM_CFG).mtimeMs : 0; if (!_lc || m !== _lcM) { _lc = existsSync(LLM_CFG) ? JSON.parse(readFileSync(LLM_CFG, "utf8")) : {}; _lcM = m } } catch { _lc = {} }
  return _lc || {}
}
const ENV_KEY = { gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" }
function keyFor(prov) { const k = keysList().find((x) => x.provider === prov); const t = k ? decSecret(k.token || "") : ""; return t || process.env[ENV_KEY[prov]] || "" } // 1ª key del proveedor (multi-key) → env como fallback
// ── MULTI-KEY: varias keys con nombre, incluso 2 del mismo proveedor. Formato nuevo keysList=[{id,provider,name,token(enc)}].
// Migra lazy el viejo keys:{prov:token}. keyFor(prov) sigue andando (1ª del proveedor) → todo el código actual intacto.
const PROV_SHORT = { gemini: "Gemini", openai: "OpenAI", anthropic: "Claude", ollama: "Ollama", gestionado: "Gestionado" }
// Proveedores que corren EN TU MÁQUINA. Todo lo que no esté acá sale de tu red, incluido "gestionado" (es nuestro servidor).
// Lo usa el fail-closed: una tarea local-only jamás puede rutearse a algo que no esté en esta lista.
const LOCAL_PROVIDERS = new Set(["ollama"])
// "gestionado" = inferencia gestionada de pipe.one (GPU box vía gateway). Ollama-compatible + bearer del tenant. TLS del gateway: NODE_EXTRA_CA_CERTS.
function gatewayUrl() { return llmConfig().gatewayUrl || process.env.PIPE_GATEWAY_URL || "" }
function keysList() {
  const c = llmConfig()
  if (Array.isArray(c.keysList)) return c.keysList
  return Object.entries(c.keys || {}).map(([provider, token], i) => ({ id: `${provider}`, provider, name: PROV_SHORT[provider] || provider, token }))
}
function keyById(id) { const k = keysList().find((x) => x.id === id); return k ? { provider: k.provider, token: k.provider === "ollama" ? "ollama" : decSecret(k.token || "") } : null }
// ── ÁREAS de uso (una IA puntual por tipo de tarea). Ruteo ADITIVO: sin config → null → cae al comportamiento actual (seguro/fail-closed).
const AREAS = [
  { key: "think", label: "🧠 Pensar / proactivo", features: ["coach"] },
  { key: "draft", label: "💬 Redactar respuestas", features: ["reply"] },
  { key: "correct", label: "✍️ Correcciones ortográficas", features: ["correct"] },
  { key: "summarize", label: "📝 Resúmenes", features: ["email", "meetings"] },
  { key: "ask", label: "🔍 Preguntarle al cerebro", features: ["ask"] },
  { key: "private", label: "🔒 Grafo de conocimiento / privado", features: ["graphify", "learn", "enrich", "extract"] },
]
const FEATURE_AREA = {}; for (const a of AREAS) for (const f of a.features) FEATURE_AREA[f] = a.key
const AREA_KEYS = new Set(AREAS.map((a) => a.key))
function routingMap() { const c = llmConfig(); return (c && c.routing) || {} }
function resolveArea(area) { // {provider, token, model} SOLO si el usuario configuró esa área; si no, null.
  if (!area) return null
  const r = routingMap()[area]; if (!r || !r.keyId) return null
  const k = keyById(r.keyId); if (!k) return null
  if (k.provider !== "ollama" && !k.token) return null
  return { provider: k.provider, token: k.token, model: r.model || modelsFor(k.provider)[0] }
}
const DEF_MODELS = { gemini: ["gemini-2.5-flash", "gemini-2.5-flash-lite"], openai: ["gpt-4o-mini"], anthropic: ["claude-3-5-haiku-latest"], ollama: ["qwen2.5:7b"], gestionado: ["qwen2.5:7b"] }
function modelsFor(prov) {
  const c = llmConfig(); if (c.models && c.models[prov]) return [c.models[prov]]
  const env = { gemini: process.env.GEMINI_MODEL, openai: process.env.OPENAI_MODEL, anthropic: process.env.ANTHROPIC_MODEL, ollama: process.env.OLLAMA_MODEL }[prov]
  if (env) return prov === "gemini" ? [env, ...DEF_MODELS.gemini] : [env]
  return DEF_MODELS[prov]
}
function chainDefault() { const c = llmConfig(); if (Array.isArray(c.chain) && c.chain.length) return c.chain; return (process.env.LLM_CHAIN || "gemini,openai,anthropic,ollama").split(",").map((s) => s.trim()).filter(Boolean) }
function ollamaHost() { return llmConfig().ollamaHost || process.env.OLLAMA_HOST || "http://localhost:11434" }
// TIMEOUT para los proveedores NUBE: sin esto, un fetch colgado (socket muerto) no rechaza nunca → la cadena
// no cae al siguiente proveedor y todo el sistema se cuelga. AbortSignal.timeout aborta el fetch y deja seguir la cadena.
const CLOUD_TIMEOUT = +process.env.LLM_TIMEOUT_MS || 60000
const CLOUD_UPLOAD_TIMEOUT = +process.env.LLM_UPLOAD_TIMEOUT_MS || 180000 // multimodal/upload procesa audio/video → más margen
const MAX_OUT = +process.env.LLM_MAX_OUTPUT_TOKENS || 4096 // techo de salida → sin respuestas desbocadas (costo/latencia)
function parseJson(t) { try { return JSON.parse(t) } catch { return JSON.parse(String(t).replace(/```json|```/g, "").trim()) } }

// ── proveedores ──
async function gemini(prompt, { json, system, temperature, _key } = {}, model) {
  const KEY = _key || keyFor("gemini")
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: MAX_OUT, ...(json ? { responseMimeType: "application/json" } : {}) }, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) }
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(CLOUD_TIMEOUT) })
  if (!res.ok) { const e = new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 120)}`); e.status = res.status; throw e }
  const d = await res.json()
  return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || ""
}
async function openai(prompt, { json, system, temperature, numPredict, _key } = {}, model) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${_key || keyFor("openai")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature, max_tokens: numPredict || MAX_OUT, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }], ...(json ? { response_format: { type: "json_object" } } : {}) }),
    signal: AbortSignal.timeout(CLOUD_TIMEOUT),
  })
  if (!res.ok) { const e = new Error(`openai ${res.status}: ${(await res.text()).slice(0, 120)}`); e.status = res.status; throw e }
  const d = await res.json()
  return d.choices?.[0]?.message?.content || ""
}
async function anthropic(prompt, { json, system, temperature, _key } = {}, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": _key || keyFor("anthropic"), "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: MAX_OUT, temperature, system: (system || "") + (json ? " Respondé SOLO JSON válido." : ""), messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(CLOUD_TIMEOUT),
  })
  if (!res.ok) { const e = new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 120)}`); e.status = res.status; throw e }
  const d = await res.json()
  return d.content?.map((c) => c.text).join("") || ""
}
async function ollamaRaw(prompt, { json, system, temperature, numPredict, numCtx }, model) {
  let host = ollamaHost()
  if (process.env.LLM_BLOCK_PRIVATE_HOSTS) host = await resolveSafeHost(host) // managed: resuelve+valida+FIJA la IP → cierra el rebinding dinámico (TOCTOU)
  const res = await fetch(host + "/api/generate", { method: "POST", body: JSON.stringify({ model, prompt: (system ? system + "\n\n" : "") + prompt, stream: false, ...(json ? { format: "json" } : {}), keep_alive: process.env.OLLAMA_KEEP_ALIVE || "30m", // num_ctx: el default de ollama son 4096 tokens. Un lote de trabajo ya gasta ~2570 solo de ENTRADA, así que
    // el que trae mensajes largos se pasa del contexto y la conexión se corta en el medio ("fetch failed"). Los
    // trabajos de fondo piden el contexto que necesitan; lo interactivo sigue con el default.
    options: { temperature, ...(numPredict ? { num_predict: numPredict } : {}), ...(numCtx ? { num_ctx: numCtx } : {}) } }) })
  if (!res.ok) { const e = new Error(`ollama ${res.status}`); e.status = res.status; throw e }
  const d = await res.json()
  return d.response || ""
}
// COLA + TIMEOUT para ollama: en este box (CPU sin GPU) ollama SERIALIZA y CUELGA si le mandás varias a la vez o prompts grandes.
// Semáforo de 1 (encola) + timeout → nunca cuelga el sistema; si tarda demasiado tira error y la cadena de llm() cae a gemini.
let _ollamaChain = Promise.resolve()
const OLLAMA_TIMEOUT = +process.env.OLLAMA_TIMEOUT_MS || 90000
function ollama(prompt, opts, model) {
  // El timeout no puede ser uno solo para todo: en un box sin GPU, CARGAR el modelo ya se come 150-250s, así que
  // los 90s pensados para una llamada interactiva mataban a los trabajos de fondo antes de que empezaran a escribir.
  // Los interactivos siguen con 90s (más que eso el usuario no espera); los de fondo piden su propio margen.
  const lim = +opts?.timeoutMs || OLLAMA_TIMEOUT
  const run = () => { let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("ollama timeout")), lim) }); return Promise.race([ollamaRaw(prompt, opts, model), to]).finally(() => clearTimeout(t)) } // clearTimeout: sin esto el timer de 90s quedaba colgando cuando ollama respondía/fallaba antes
  const p = _ollamaChain.then(run, run) // se encola detrás de la anterior (haya salido bien o mal)
  _ollamaChain = p.catch(() => {}) // la cadena nunca se rompe por un error individual
  return p
}

// GESTIONADO: inferencia del GPU box de pipe.one vía gateway. Mismo protocolo Ollama + Authorization Bearer (token del tenant).
// El gateway aplica quota/rate-limit/allowlist y mide. TLS self-signed del gateway → confiar vía NODE_EXTRA_CA_CERTS=/app/gw.crt.
async function gestionado(prompt, { json, system, temperature, numPredict, _key } = {}, model) {
  const url = gatewayUrl(); if (!url) { const e = new Error("gestionado: sin gatewayUrl"); e.status = 0; throw e }
  const token = _key || keyFor("gestionado"); if (!token) { const e = new Error("gestionado: sin token"); e.status = 401; throw e }
  const res = await fetch(url + "/api/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: (system ? system + "\n\n" : "") + prompt, stream: false, ...(json ? { format: "json" } : {}), keep_alive: "30m", options: { temperature, ...(numPredict ? { num_predict: numPredict } : {}) } }),
    signal: AbortSignal.timeout(CLOUD_TIMEOUT),
  })
  if (!res.ok) { const e = new Error(`gestionado ${res.status}`); e.status = res.status; throw e } // 429 = cupo/rate → la cadena cae al siguiente
  const d = await res.json()
  return d.response || ""
}
// modelos disponibles en el motor gestionado (GPU box, /api/tags de ollama vía gateway) → para armar el council desde la app
export async function gestionadoModels() {
  const url = gatewayUrl(); const token = keyFor("gestionado"); if (!url || !token) return []
  try {
    const res = await fetch(url + "/api/tags", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const d = await res.json()
    return (d.models || []).map((m) => m.name || m.model).filter(Boolean)
  } catch { return [] }
}

// VISIÓN: lee/entiende imágenes (para emails que son pura imagen). Gemini 2.5 Flash → OpenAI gpt-4o-mini.
// Hook Mistral OCR: si algún día hay MISTRAL_API_KEY, se puede anteponer /v1/ocr para digitalización de docs de alta precisión.
export async function visionLLM(prompt, images = [], { temperature = 0.2 } = {}) {
  const imgs = (images || []).filter((i) => i && i.data).slice(0, 4)
  if (!imgs.length) throw new Error("sin imágenes")
  if (cloudOverCap()) throw new Error("HARD_CAP de nube alcanzado — no llamo visión a la nube") // #6: este path saltea llm(), así que el tope duro no lo cubría
  if (keyFor("gemini")) {
    try {
      const model = process.env.VISION_MODEL || "gemini-2.5-flash"
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keyFor("gemini")}`
      const parts = [{ text: prompt }, ...imgs.map((i) => ({ inline_data: { mime_type: i.mime || "image/png", data: i.data } }))]
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature } }), signal: AbortSignal.timeout(CLOUD_UPLOAD_TIMEOUT) })
      if (res.ok) { const d = await res.json(); const t = d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || ""; if (t.trim()) return t }
    } catch { /* cae a OpenAI */ }
  }
  if (keyFor("openai")) {
    const model = process.env.VISION_MODEL_OPENAI || "gpt-4o-mini"
    const content = [{ type: "text", text: prompt }, ...imgs.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime || "image/png"};base64,${i.data}` } }))]
    const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${keyFor("openai")}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature, messages: [{ role: "user", content }] }), signal: AbortSignal.timeout(CLOUD_UPLOAD_TIMEOUT) })
    if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content || "" }
  }
  throw new Error("sin proveedor de visión configurado (Gemini u OpenAI)")
}

const PROVIDERS = { gemini: { fn: gemini }, openai: { fn: openai }, anthropic: { fn: anthropic }, ollama: { fn: ollama }, gestionado: { fn: gestionado } } // modelos/keys ahora salen de la config (BYOK)

// ── CONFIG BYOK expuesta a la app (Configuración → Motor de IA) ──
export function llmConfigMasked() {
  const c = llmConfig(), LABEL = { gemini: "Google Gemini", openai: "OpenAI (GPT)", anthropic: "Anthropic (Claude)", ollama: "Self-hosted (Ollama)" }
  const providers = ["gemini", "openai", "anthropic", "ollama"].map((id) => {
    const k = decSecret((c.keys && c.keys[id]) || ""), src = k ? "config" : (process.env[ENV_KEY[id]] ? "env" : "none")
    return { id, label: LABEL[id], needsKey: id !== "ollama", hasKey: id === "ollama" ? true : !!keyFor(id), keySource: src, keyHint: k ? "••••" + k.slice(-4) : "", model: modelsFor(id)[0] }
  })
  const pol = (c && c.sensitivePolicy) || {}
  const sensitiveFeatures = SENSITIVE_FEATURES.map((f) => ({ ...f, mode: pol[f.key] === "cloud" ? "cloud" : "local" })) // default local
  const kl = keysList().map((k) => { const t = k.provider === "ollama" ? "" : decSecret(k.token || ""); return { id: k.id, provider: k.provider, name: k.name || PROV_SHORT[k.provider] || k.provider, hint: t ? "••••" + t.slice(-4) : "", hasToken: k.provider === "ollama" || !!t } })
  return { chain: chainDefault(), providers, ollamaHost: ollamaHost(), stt: c.stt || "openai", sensitiveFeatures, keysList: kl, areas: AREAS.map((a) => ({ key: a.key, label: a.label })), routing: routingMap() }
}
// PROBAR una key puntual: ping mínimo → si responde, anda. Incluye ollama (usa el host).
export async function testKey({ keyId, provider, token } = {}) {
  const k = keyId ? keyById(keyId) : (provider ? { provider, token: provider === "ollama" ? "ollama" : String(token || "").trim() } : null)
  if (!k) return { ok: false, error: "falta keyId o provider+token" }
  const prov = PROVIDERS[k.provider]; if (!prov) return { ok: false, error: "proveedor desconocido" }
  if (k.provider !== "ollama" && !k.token) return { ok: false, error: "sin token" }
  try {
    const model = modelsFor(k.provider)[0]
    const out = await prov.fn('Respondé exactamente con: OK', { json: false, system: "", temperature: 0, _key: k.token }, model)
    return { ok: true, model, provider: k.provider, sample: String(out || "").trim().slice(0, 60) }
  } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 140) } }
}
export function providerKey(prov) { return keyFor(prov) } // para voice.mjs / módulos que hacen su propio fetch con la key del hub
// Transcripción de audio: "local" (whisper en tu máquina) por DEFECTO. Antes era "openai", así que en un hub con key de
// OpenAI CADA nota de voz recibida se subía a la nube automáticamente — sin que apareciera en el interruptor de features
// sensibles de la UI, que mientras tanto decía "todo local". Era la reincidencia literal del incidente de julio.
// Si el hub no tiene whisper, stt() ya cae solo a la nube; ahora eso es una degradación explícita, no el default.
export function sttMode() { return llmConfig().stt || "local" } // transcripción de audio: "openai" (nube) | "local" (whisper self-hosted)
// sanea ollamaHost (lo pega el usuario → server-side fetch = SSRF). http(s), NO metadata de nube, NO el puerto de la app (pivot a isLocal).
const APP_PORT = String(process.env.PORT || "3000")
const _META = /^(169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200)$/i
// ::ffff:a.b.c.d o ::ffff:HHHH:HHHH → IPv4 dotted, para que el check no se saltee con [::ffff:169.254.169.254]
function normHost(hn) {
  const h = String(hn).replace(/^\[|\]$/g, "").toLowerCase()
  const m = h.match(/^::ffff:(.+)$/)
  if (m) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(m[1])) return m[1]
    const hx = m[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hx) { const a = parseInt(hx[1], 16), b = parseInt(hx[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}` }
  }
  return h
}
const isPrivateIp = (h) => /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|::1$|::$|fe80:)/i.test(h) || /^(fc|fd)[0-9a-f]{0,2}:/i.test(h) // ULA fc00::/7 (con ':' para no matchear dominios "fd…")
  || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h) // 172.16/12 + CGNAT/Tailscale 100.64/10
const isLoopbackHost = (h) => /^127\./.test(h) || h === "::1" || h === "::" || h === "localhost" || h === "0.0.0.0" // grafías de loopback (localhost derrotaba el pivot guard: no es una IP)
function safeOllamaHost(h) {
  const s = String(h || "").trim(); if (!s) return ""
  try {
    const u = new URL(s)
    if (!/^https?:$/.test(u.protocol)) return null
    const hn = normHost(u.hostname)
    if (_META.test(hn) || _META.test(u.hostname)) return null                                   // metadata de nube (incl. IPv6-mapped)
    if (isLoopbackHost(hn) && String(u.port || APP_PORT) === APP_PORT) return null                // pivot al propio puerto de la app (incl. localhost/::/ 0.0.0.0) → fetch loopback → isLocal=true
    if (process.env.LLM_BLOCK_PRIVATE_HOSTS && isPrivateIp(hn)) return null                       // modo MANAGED multi-tenant: prohibir toda IP privada/loopback/link-local (anti-pivot a la red del host)
    return s
  } catch { return null }
}
// resolve-at-fetch: resuelve el hostname a IP UNA vez, valida, y devuelve una URL con la IP FIJA → el fetch NO re-resuelve.
// Cierra el rebinding dinámico (TTL 0 + doble A record: público al chequear, privado al fetchear) — el TOCTOU que quedaba con lookup+fetch.
// Solo en managed (LLM_BLOCK_PRIVATE_HOSTS); en self-host el dueño apunta a su localhost/LAN a propósito.
async function resolveSafeHost(url) {
  const u = new URL(url)
  let addr
  try { addr = (await lookup(u.hostname)).address } catch { return url } // no resuelve → lo maneja el fetch normal
  const ip = normHost(addr)
  if (isPrivateIp(ip)) throw new Error("ollama host resuelve a IP privada/loopback (bloqueado en managed)")
  u.hostname = ip.includes(":") ? `[${ip}]` : ip // FIJAR la IP resuelta → el fetch usa exactamente esta, sin re-resolver
  return u.origin
}
export function setLlmConfig(input = {}) {
  const c = llmConfig()
  let oh = c.ollamaHost
  if (input.ollamaHost !== undefined) { oh = safeOllamaHost(input.ollamaHost); if (oh === null) return { error: "ollamaHost inválido (usá http(s):// y no un IP de metadata)" } }
  const next = { chain: Array.isArray(input.chain) ? input.chain.map((s) => String(s).trim()).filter(Boolean) : c.chain, keys: { ...(c.keys || {}) }, models: { ...(c.models || {}) }, ollamaHost: oh, stt: input.stt !== undefined ? input.stt : c.stt, sensitivePolicy: { ...(c.sensitivePolicy || {}) }, keysList: Array.isArray(c.keysList) ? c.keysList : keysList(), routing: { ...(c.routing || {}) } }
  // MULTI-KEY: la UI manda la lista completa deseada. Token enmascarado (•) = conservar el cifrado previo; nuevo = cifrar; faltante = borrado.
  if (Array.isArray(input.keysList)) {
    const prev = {}; for (const k of keysList()) prev[k.id] = k
    next.keysList = input.keysList.filter((k) => k && k.provider && k.id).map((k) => {
      const raw = String(k.token || "").trim()
      const token = (!raw || /^•/.test(raw)) ? (prev[k.id] ? prev[k.id].token : "") : (k.provider === "ollama" ? "" : encSecret(raw))
      return { id: String(k.id).slice(0, 40), provider: String(k.provider), name: String(k.name || "").slice(0, 40) || (k.provider), token }
    })
    delete next.keys // el hub ya usa keysList; el objeto viejo queda deprecado
  }
  // RUTEO POR ÁREA: {area: {keyId, model}} — solo áreas conocidas, con keyId válido.
  if (input.routing && typeof input.routing === "object") {
    next.routing = {}
    for (const [area, r] of Object.entries(input.routing)) {
      if (!AREA_KEYS.has(area) || !r || !r.keyId) continue
      next.routing[area] = { keyId: String(r.keyId).slice(0, 40), model: r.model ? String(r.model).slice(0, 60) : "" }
    }
  }
  // política por-feature (UI): solo "local"|"cloud", solo features conocidas → no se cuela basura en el archivo
  if (input.sensitivePolicy && typeof input.sensitivePolicy === "object") {
    for (const [k, v] of Object.entries(input.sensitivePolicy)) {
      if (!SENSITIVE_KEYS.has(k)) continue
      if (v === "cloud") next.sensitivePolicy[k] = "cloud"; else delete next.sensitivePolicy[k] // "local" = default = ausente
    }
  }
  if (input.models) for (const [k, v] of Object.entries(input.models)) { if (v && String(v).trim()) next.models[k] = String(v).trim(); else delete next.models[k] }
  // keys: solo actualizar las que llegan NO vacías y NO enmascaradas (no borrar al no reenviar)
  if (input.keys) for (const [k, v] of Object.entries(input.keys)) { const s = String(v || "").trim(); if (s && !/^•/.test(s)) next.keys[k] = encSecret(s) } // CIFRADO en reposo
  if (Array.isArray(input.clearKeys)) for (const k of input.clearKeys) delete next.keys[k]
  withLock(LLM_CFG, () => { const tmp = LLM_CFG + "." + process.pid + ".tmp"; writeFileSync(tmp, JSON.stringify(next, null, 2)); renameSync(tmp, LLM_CFG) })
  _lc = null; _lcM = -1
  return { ok: true }
}

// ── MEDIDOR de uso (token savings #10): cuánto trabajo va a la NUBE vs LOCAL. tokens ≈ chars/4. En memoria (desde el arranque). ──
const _usage = { since: Date.now(), by: {} }
function meter(provider, task, inChars, outChars) {
  const u = (_usage.by[provider] = _usage.by[provider] || { calls: 0, inTok: 0, outTok: 0, cloud: provider !== "ollama" })
  const t = task || process.env.LLM_TASK // fallback: el proceso-cron define LLM_TASK (spawnLogged) → toda llamada suya queda atribuida
  u.calls++; u.inTok += Math.round((inChars || 0) / 4); u.outTok += Math.round((outChars || 0) / 4)
  if (t) { u.tasks = u.tasks || {}; u.tasks[t] = (u.tasks[t] || 0) + 1 }
  trackDaily(provider, Math.round(((inChars || 0) + (outChars || 0)) / 4), t)
}
// PRESUPUESTO DIARIO de tokens NUBE, persistido entre procesos (cada job es su propio proceso → memoria no alcanza).
// Avisa 1 vez al superar el tope, para no agotar el free-tier de Gemini de golpe (ya pasó una vez con el clasificador de spam).
const DAY_FILE = "./data/llm-usage-day.json"
const DAILY_BUDGET = +process.env.LLM_DAILY_CLOUD_TOKEN_BUDGET || 3_000_000
const HARD_CAP = +process.env.LLM_DAILY_CLOUD_HARDCAP || DAILY_BUDGET * 3 // tope DURO: pasado esto, se CORTA la nube (protege el managed key de un tenant descontrolado)
let _capChk = { at: 0, over: false }
let _trackFails = 0 // fallos consecutivos de trackDaily (lock/escritura): si persisten, no podemos medir el gasto de nube
export function cloudOverCap() { // cacheado 30s: no leer el archivo en cada iteración del router
  if (_trackFails >= 3) return true // el medidor está ROTO (3 fallos seguidos) → asumir OVER el cap: fail-closed protege el key managed (el cap existe por el incidente de cloud-leak)
  if (Date.now() - _capChk.at < 30000) return _capChk.over
  let over = false
  try { const d = existsSync(DAY_FILE) ? JSON.parse(readFileSync(DAY_FILE, "utf8")) : {}; over = d.date === new Date().toISOString().slice(0, 10) && (d.cloudTok || 0) >= HARD_CAP } catch {}
  _capChk = { at: Date.now(), over }
  return over
}
export function trackDaily(provider, tok, task) {
  if (provider === "ollama" || !tok) return
  const today = new Date().toISOString().slice(0, 10)
  try {
    withLock(DAY_FILE, () => {
      let d = {}; try { d = existsSync(DAY_FILE) ? JSON.parse(readFileSync(DAY_FILE, "utf8")) : {} } catch {}
      if (d.date !== today) d = { date: today, cloudTok: 0, warned: false, byTask: {} }
      d.cloudTok += tok
      d.byTask = d.byTask || {}; d.byTask[task || "?"] = (d.byTask[task || "?"] || 0) + tok // desglose de tokens NUBE por tarea → visibilidad de costo
      if (!d.warned && d.cloudTok > DAILY_BUDGET) { d.warned = true; console.warn(`[llm] ⚠️ presupuesto diario de tokens NUBE superado: ${d.cloudTok} > ${DAILY_BUDGET} (${today}) — conviene bajar crons o pasar a local`) }
      writeFileSync(DAY_FILE, JSON.stringify(d))
    })
    _trackFails = 0
  } catch (e) { _trackFails++; console.error("[llm] ⚠️ no pude registrar el gasto de nube (HARD_CAP en riesgo):", e.message) }
}
export function usageStats() {
  const t = { cloudTok: 0, localTok: 0, cloudCalls: 0, localCalls: 0 }
  for (const u of Object.values(_usage.by)) { const tok = u.inTok + u.outTok; if (u.cloud) { t.cloudTok += tok; t.cloudCalls += u.calls } else { t.localTok += tok; t.localCalls += u.calls } }
  let daily = null; try { daily = existsSync(DAY_FILE) ? JSON.parse(readFileSync(DAY_FILE, "utf8")) : null } catch {}
  return { since: _usage.since, by: _usage.by, ...t, daily, dailyBudget: DAILY_BUDGET }
}

// ── ROUTER ("la tercera vía"): elige la cadena según la DIFICULTAD/PRIVACIDAD de la tarea. Local para lo simple/privado, nube para lo pesado.
// En este box ollama es CPU (lento) → simple va a la nube (rápido, free-tier). Cuando llegue el A6000: LLM_LOCAL_FIRST=1 → lo simple/privado va LOCAL (gratis + privado). ──
// TAREAS SENSIBLES: las que procesan tu corpus. El hub elige local/nube POR FEATURE en Configuración → Motor de IA. DEFAULT = local.
export const SENSITIVE_FEATURES = [
  { key: "graphify", label: "Grafo de conocimiento" },
  { key: "home-brief", label: "Resumen del día (Home)" },
  { key: "coach", label: "Radar / Coach proactivo" },
  { key: "email", label: "Resumen de emails" },
  { key: "extract", label: "Extraer tareas y promesas" },
  { key: "enrich", label: "Enriquecer conversaciones" },
  { key: "meetings", label: "Resumen de reuniones" },
  { key: "learn", label: "Auto-modelo (aprendizaje)" },
  { key: "autopilot", label: "Piloto automático (redactar respuestas)" },
  { key: "audio-summary", label: "Resumen de notas de voz" }, // la transcripción de un audio tuyo: tan privado como el resto
]
const SENSITIVE_KEYS = new Set(SENSITIVE_FEATURES.map((f) => f.key))
function sensitivePolicyMap() { const c = llmConfig(); return (c && c.sensitivePolicy) || {} } // { extract: "cloud", graphify: "local", … }
// ¿esta feature va a la nube? DEFAULT local (privacidad). Con feature: manda la config del hub (UI). Sin feature (legacy/headless):
// el switch global SENSITIVE_ALLOW_CLOUD. Nunca fail-open: ausencia de config = local.
export function featureWantsCloud(feature) {
  if (feature) return sensitivePolicyMap()[feature] === "cloud"
  return process.env.SENSITIVE_ALLOW_CLOUD === "1"
}
export function smartChain({ sensitive = false, complex = false, vision = false, feature = "", secreto = false } = {}) {
  // `secreto`: el contenido viene de una cuenta/número marcado SECRETO. Eso NO es conmutable desde la UI: aunque el hub
  // haya elegido nube para esa función, este contenido no sale. Sin esto la protección quedaba por omisión — funcionaba
  // porque la clave no figuraba en la lista de funciones conmutables, y se caía sola el día que alguien la agregara.
  // (Caso real: el prep de una reunión secreta pasaba `feature:"meetings"`, que SÍ es conmutable.)
  if (secreto) return "ollama"
  // FAIL-CLOSED PRIMERO: contenido privado va LOCAL por defecto — ni siquiera nube por complejo/visión. Gana sobre vision/complex a
  // propósito: si el local no puede, la tarea falla (no degrada a nube). El hub OPTA a nube por feature (UI) — decisión consciente,
  // NUNCA un default. Con nube elegida, usa la cadena BYOK del hub (su proveedor/token). LLM_CHAIN_SENSITIVE la pisa (env, a medida).
  if (sensitive) {
    if (!featureWantsCloud(feature)) return "ollama"
    return process.env.LLM_CHAIN_SENSITIVE || chainDefault().join(",")
  }
  if (vision || complex) return "gemini,openai,anthropic"      // pesado/multimodal (no-sensible) → nube capaz (ollama no lo hace bien)
  return process.env.LLM_LOCAL_FIRST === "1" ? "ollama,gemini" : "gemini,ollama" // simple: local-first con GPU, si no nube-primero
}

// ANTI-ALUCINACIÓN — se inyecta en ABSOLUTAMENTE TODOS los prompts (prosa Y json Y raw). La IA NUNCA inventa.
const NO_INVENT = `REGLA ABSOLUTA E INNEGOCIABLE: NUNCA inventes, alucines, estimes ni supongas datos. Usá EXCLUSIVAMENTE la información que se te da de forma explícita. Números, fechas, cantidades, nombres, "días sin contacto", relaciones (cliente/proveedor/socio), montos: TODOS deben salir textualmente de los datos provistos. Si un dato NO está en lo que se te dio, NO lo generes — dejalo vacío/null u omitilo, y nunca lo rellenes con una suposición. Prohibido redondear a números plausibles, prohibido inferir fechas, prohibido asignar roles o vínculos que no estén escritos. Ante la duda, menos es más: no afirmes lo que no podés respaldar con los datos.`
// VOZ HUMANA — se inyecta en TODA generación de prosa (no en JSON). La IA nunca debe sonar a IA.
const HUMAN_VOICE = `Escribís como una persona real, directa y concreta. NUNCA sones a IA. Prohibido: frases de relleno ("es importante notar", "en resumen", "cabe destacar", "en el mundo de hoy"), disclaimers ("como IA/modelo de lenguaje", "no tengo acceso"), entusiasmo genérico y adulador, moralejas, guiones largos decorativos (—), y listas cuando una frase alcanza. Andá al grano con la info real, tono natural y humano. Si no sabés algo, decilo sin vueltas. No expliques que sos un asistente.`

export async function llm(prompt, opts = {}) {
  const { json = false, system = "", temperature = 0.2, chain, model: modelOverride, models: modelByProv, numPredict, numCtx, raw = false, bypassCap = false } = opts
  // inyectar SIEMPRE la regla anti-invención; y la voz humana solo en prosa (no json/raw)
  const base = json || raw ? system : (system ? `${HUMAN_VOICE}\n\n${system}` : HUMAN_VOICE)
  const sys = base ? `${NO_INVENT}\n\n${base}` : NO_INVENT
  // cadena pedida por la llamada (hint) + la configurada por el hub como fallback (dedup) → BYOK manda aunque el hint
  // nombre un proveedor sin key. Sin hint, va directo a la config del usuario.
  const req = chain ? (Array.isArray(chain) ? chain : String(chain).split(",").map((s) => s.trim()).filter(Boolean)) : []
  // FAIL-CLOSED: si el llamado pide EXPLÍCITAMENTE solo local (ollama) — tareas sensibles como graphify, que procesan
  // TODOS tus mensajes — NUNCA se appendea la nube. Si el local falla, la tarea falla y reintenta luego; el dato privado
  // no sale y no se quema el managed key. (Antes se appendeaba chainDefault siempre → ollama-timeout caía a OpenAI: fuga + costo.)
  const localOnly = req.length > 0 && req.every((p) => p === "ollama")
  // RUTEO POR ÁREA: si el hub asignó una key puntual a esta área/feature → usar ESE proveedor+key+modelo (override del chain).
  // ADITIVO: sin config, routed=null → comportamiento idéntico al actual (los sensibles siguen fail-closed vía smartChain).
  const routedRaw = resolveArea(opts.area || FEATURE_AREA[opts.feature || ""])
  // …PERO el ruteo NUNCA puede romper el fail-closed. El área llamada "privado" agrupa graphify/learn/enrich/extract, y la UI
  // deja asignarle cualquier key: si ahí ponías una de nube, `routed` ganaba sobre `localOnly` y el corpus ENTERO de mensajes
  // salía a la nube, con SENSITIVE_ALLOW_CLOUD sin setear y el comentario de arriba prometiendo lo contrario. El candado manda.
  const routed = routedRaw && localOnly && !LOCAL_PROVIDERS.has(routedRaw.provider) ? null : routedRaw
  if (routedRaw && !routed) console.warn(`[llm] ruteo por área ignorado: ${opts.feature || opts.area} es local-only y "${routedRaw.provider}" es de nube`)
  const providers = routed ? [routed.provider] : (localOnly ? ["ollama"] : [...new Set([...req, ...chainDefault()])])
  // el hard cap protege contra crons/bulk descontrolados; las llamadas INTERACTIVAS (corrector, chat, borrador) son chicas
  // y disparadas por el usuario → NUNCA se capan (si no, caen a ollama-CPU y quedan lentísimas). bypassCap las exime.
  const overCap = bypassCap ? false : cloudOverCap()
  let lastErr
  for (const pname of providers) {
    const prov = PROVIDERS[pname]
    if (!prov) continue
    if (pname !== "ollama" && overCap) continue // tope de nube alcanzado hoy → cae a local
    if (pname !== "ollama" && !keyFor(pname)) continue // sin token configurado → saltar proveedor
    // modelo por proveedor: modelOverride global > models[proveedor] (cadena mixta) > el configurado/default
    const modelList = routed && pname === routed.provider ? [routed.model] : (modelOverride ? [modelOverride] : (modelByProv && modelByProv[pname] ? [modelByProv[pname]] : modelsFor(pname)))
    for (const model of modelList) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const out = await prov.fn(prompt, { json, system: sys, temperature, numPredict, numCtx: opts.numCtx, timeoutMs: opts.timeoutMs, _key: routed && pname === routed.provider ? routed.token : undefined }, model)
          meter(pname, opts.task, (sys + prompt).length, typeof out === "string" ? out.length : 0) // medir uso nube/local
          if (process.env.LLM_DEBUG) console.error(`[llm] ${pname}/${model} OK`)
          if (json) { const p = parseJson(out); if (!p || typeof p !== "object") throw new Error("respuesta JSON inválida (no es objeto)"); return p } // #27: no escribir estado con basura → falla y cae al fallback
          return out
        } catch (e) {
          lastErr = e
          if (e.status === 429 || e.status === 503 || e.status === 500) { await sleep(1000 * 2 ** attempt); continue } // reintento
          break // otro error (404/401/etc) → siguiente modelo/proveedor
        }
      }
    }
  }
  throw lastErr || new Error("sin proveedor LLM disponible")
}

// ── MULTIMODAL (Gemini nativo): ve imágenes, LEE documentos/PDF, ESCUCHA audios y procesa VIDEO CON AUDIO ──
// Sube un archivo local a la Files API de Gemini y espera a que esté ACTIVE (video/audio grande se procesan unos segundos).
export async function geminiUploadFile(path, mime) {
  const KEY = process.env.GEMINI_API_KEY
  if (!KEY) throw new Error("sin GEMINI_API_KEY")
  if (cloudOverCap()) throw new Error("HARD_CAP de nube alcanzado — no subo archivo a la nube") // #6: la subida es el 1er paso del multimodal; sin esto el tope no la cubría
  const buf = readFileSync(path)
  const res = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${KEY}`, {
    method: "POST",
    headers: { "X-Goog-Upload-Protocol": "raw", "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": mime },
    body: buf,
    signal: AbortSignal.timeout(CLOUD_UPLOAD_TIMEOUT),
  })
  if (!res.ok) throw new Error(`files upload ${res.status}: ${(await res.text()).slice(0, 120)}`)
  let file = (await res.json()).file
  for (let i = 0; i < 30 && file.state === "PROCESSING"; i++) { // video: esperar a que termine de procesar
    await sleep(2000)
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${KEY}`)
    file = await r.json()
  }
  if (file.state !== "ACTIVE") throw new Error(`file no quedó ACTIVE (${file.state})`)
  return { uri: file.uri, mime }
}

// Genera texto a partir de prompt + partes multimodales. `media` = array de { text } | { mime, data(base64) } | { mime, uri }.
// SOLO Gemini (es el único con audio+video nativo por API y sin GPU). Lanza si falla → el caller cae a texto.
export async function geminiMultimodal(prompt, media = [], { temperature = 0.3, system = "" } = {}) {
  const KEY = process.env.GEMINI_API_KEY
  if (!KEY) throw new Error("sin GEMINI_API_KEY")
  if (cloudOverCap()) throw new Error("HARD_CAP de nube alcanzado — no llamo multimodal a la nube") // #6: este path saltea llm(), el tope duro no lo cubría
  const model = process.env.MULTIMODAL_MODEL || process.env.VISION_MODEL || "gemini-2.5-flash"
  const parts = [{ text: prompt }]
  for (const m of media || []) {
    if (m.text != null) { parts.push({ text: m.text }); continue }
    parts.push(m.uri ? { file_data: { mime_type: m.mime, file_uri: m.uri } } : { inline_data: { mime_type: m.mime, data: m.data } })
  }
  const body = { contents: [{ role: "user", parts }], generationConfig: { temperature }, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(CLOUD_UPLOAD_TIMEOUT),
  })
  if (!res.ok) throw new Error(`gemini mm ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const d = await res.json()
  const out = d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || ""
  const inTok = (d.usageMetadata?.promptTokenCount || 0) * 4 || prompt.length + media.length * 1000 // tokens reales si vienen; si no, estimo (media pesa)
  meter("gemini", "multimodal", inTok, out.length)
  return out
}
