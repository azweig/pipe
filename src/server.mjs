// Servidor web + API de pipe. Sirve la SPA (public/) y expone /api/* en JSON. La app mobile reusará esta misma API.
import { createServer } from "http"
import { createHash, randomBytes, timingSafeEqual } from "crypto"
import { readFileSync, existsSync, openSync, unlinkSync, statSync, writeFileSync, createReadStream } from "fs"
import { claimSend, finishSend, releaseSend, pruneSends } from "./lib/outbox-repo.mjs"
import { loadEnv } from "./lib/env.mjs"
import { spawn } from "child_process"
import { extname, join, normalize } from "path"
import * as brain from "./lib/brain.mjs"
import * as apify from "./lib/apify.mjs"
import * as briefing from "./lib/briefing.mjs"
import * as ws from "./lib/workspace.mjs"
import * as accounts from "./lib/accounts.mjs"
import * as integrations from "./lib/integrations.mjs"
import * as groups from "./lib/groups.mjs"
import * as goauth from "./lib/google.mjs"
import * as tglogin from "./lib/telegram-login.mjs"
import { loggedOutNumbers } from "./matrix.mjs"
import { llmConfigMasked, setLlmConfig, smartChain, testKey } from "./lib/llm.mjs"
import * as hub from "./lib/hub.mjs"
import * as sig from "./lib/signature.mjs"
import * as meetings from "./lib/meetings.mjs"
import * as auth from "./lib/auth.mjs"
import * as secret from "./lib/secret.mjs"
import { localFlags, clientIpFrom, csrfReason, hostAllowed } from "./lib/http-gate.mjs"
import * as maintenance from "./lib/maintenance.mjs"
import * as mailArchive from "./lib/mail-archive.mjs"
import { ocrCas, ocrEnabled, ocrUrlActual } from "./lib/ocr.mjs"
import { destinoConfiable } from "./lib/media-trust.mjs" // 🔒 el OCR configurado puede ser un host en internet
import { casSecreto, searchThreadKeys } from "./lib/db.mjs" // 🔒 gateo de archivos del CAS por ruta (OCR, papelera, /cas/)
import { calcularOnboarding } from "./lib/onboarding.mjs" // checklist de primer arranque (una sola fuente de verdad para las 3 apps)
import { cuarentenaVault, restaurarVault, purgarRagDeNotas } from "./lib/secret-vault.mjs" // 🔒 notas del vault ya escritas
import { clipFlag, getMeta, delMeta, delMetaLike, rebuildStats, freeThreadMedia, restoreMedia, listNotes, noteCategories, noteJunkCount, noteAction, totalUnread } from "./lib/db.mjs"
import { channelCatalog, bridgeNets, tokenNets, sendableDirectChannels, channelLabel } from "./lib/channels.mjs" // registro de canales (única fuente de verdad de qué canales hay + cómo se vinculan)
import { getMediaPolicy, setMediaDefault, setThreadMediaPolicy } from "./lib/media-policy.mjs"
import { casStats, casTrashList } from "./lib/cas.mjs"
import { storageStatus } from "./lib/quota.mjs"
import * as push from "./lib/push.mjs"
import { appendMessage } from "./lib/lock.mjs"
import { notifyNewSubscription } from "./lib/kofi.mjs"
import { usageStats } from "./lib/llm.mjs"
import { setNotSpam } from "./lib/spam.mjs"

// cookie de sesión: token aleatorio (NO el PIN), HttpOnly (no accesible por JS → mitiga XSS-robo), SameSite=Lax, Secure solo bajo HTTPS (Caddy)
// SameSite=Strict: la cookie NO viaja en requests iniciados desde otros sitios → mata la superficie CSRF
// (endpoints GET que gastan LLM o mutan, abusables por navegación). La PWA abre su propio origen → sin fricción.
function setSid(res, token, ttl, secure) { res.setHeader("Set-Cookie", `sid=${token}; Path=/; Max-Age=${Math.floor(ttl / 1000)}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`) }
// Comparación CONSTANT-TIME de tokens de webhook/ingest (Ko-fi, SMS, gpu-health). `===` corta en el primer byte distinto → filtra
// el token byte a byte por timing. timingSafeEqual no lo hace; exige mismo largo (comparamos largo primero, sin ramificar por contenido).
function tokEq(given, expected) { const a = Buffer.from(String(given || "")), b = Buffer.from(String(expected || "")); return a.length === b.length && timingSafeEqual(a, b) }
// 🔒 al marcar/desmarcar una cuenta secreta: purga los artefactos DERIVADOS horneados por cron (pueden ser PREVIOS a la marca → contienen
// lo secreto). Se regeneran filtrados en el próximo cron; mientras, los fallbacks EN VIVO (home/coach/notas/cards) ya excluyen lo secreto.
// 🔒 ¿este NOMBRE (o clave) de contacto corresponde a algo secreto? El gate por-hilo compara contra claves de hilo, así que
// una ruta que recibe "Laura Fields" en el cuerpo de un POST se le escapa. Acá se resuelve el nombre a su hilo primero.
// Se usa en las rutas que redactan/preparan con un LLM: escribirle un borrador a un contacto secreto es leer su historial.
function secretoPorNombre(nombreOClave) {
  const v = String(nombreOClave || "").trim()
  if (!v) return false
  try {
    const g = secret.secretGate()
    if (g.blockAll) return true
    if (g.hide.has(v) || g.preview.has(v)) return true
    const norm = (s) => String(s || "").trim().toLowerCase()
    for (const k of g.hide) if (norm(k) === norm(v)) return true
    // El nombre no es una clave del hilo: hay que resolverlo. Se usa el buscador de claves (índice FTS sobre el nombre +
    // LIKE sobre thread_stats) y NO listThreads: ésa arma 600 hilos y su cache guarda una sola entrada por límite, así
    // que llamarla acá recomputaba todo en cada request Y desalojaba el cache de la bandeja.
    return searchThreadKeys(v, { limit: 40 }).some((k) => g.hide.has(k) || g.preview.has(k))
  } catch { return true } // si no se puede decidir, no se redacta
}
function purgeSecretDerived() {
  try { for (const k of ["home_brief", "notes_digest"]) delMeta(k) } catch {}          // snapshots de texto libre (LLM)
  try { for (const p of ["personcard:", "mtgcard:", "espcard:"]) delMetaLike(p) } catch {} // tarjetas pre-generadas por contacto/reunión/espacio
  // Todo lo DESTILADO de tus salientes: perfil de estilo (singular y el plural por categoría), la persona y el perfil de
  // voz del piloto. Los cuatro se armaron con texto de la línea que acabás de marcar y vuelven a entrar al LLM en cada
  // borrador. Se borran para que se reconstruyan limpios (las consultas que los reconstruyen ya filtran).
  try { for (const f of ["./data/style-profile.json", "./data/style-profiles.json", "./data/persona.json", "./data/voice-profile.json"]) if (existsSync(f)) unlinkSync(f) } catch {}
  try { brain.invalidateThreads() } catch {}
  try { brain.invalidateCoach() } catch {}
  // 🔒 el vault ya escrito. Filtrar la entrada evita que se escriba MÁS, pero las notas que graphify/learn ya generaron
  // siguen ahí — y se sincronizan a otro server por rsync. No se borran (serían notas tuyas): se mueven a data/secret-vault
  // y vuelven solas si desmarcás la cuenta. Se hace en los dos sentidos porque esta misma función corre al marcar Y al desmarcar.
  try {
    const vueltas = restaurarVault()
    const movidas = cuarentenaVault({ incluirBrain: true }) // al MARCAR sí: el self-model se regenera limpio
    if (movidas.length) purgarRagDeNotas(movidas) // y sus vectores salen del índice semántico
    if (movidas.length || vueltas.length) console.log(`[secret] vault: ${movidas.length} notas a cuarentena, ${vueltas.length} devueltas`)
  } catch (e) { console.error("[secret] no pude mover las notas del vault:", e?.message || e) }
}
function loginPage(pinSet, canSetup) {
  const setup = !pinSet
  return `<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>pipe.one</title>
<style>body{font-family:system-ui;background:#0f0f16;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.box{background:#1a1a24;padding:32px 28px;border-radius:18px;width:300px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.4)}
input{width:100%;box-sizing:border-box;padding:14px;font-size:22px;letter-spacing:6px;text-align:center;border-radius:12px;border:1px solid #333;background:#0f0f16;color:#fff;margin:14px 0;outline:none}
button{width:100%;padding:13px;font-size:16px;border:0;border-radius:12px;background:#6c63ff;color:#fff;font-weight:700;cursor:pointer}
.err{color:#ff6b6b;font-size:13px;min-height:18px;margin-top:8px}.sub{color:#888;font-size:13px;margin-top:6px}</style>
<div class=box><div style="font-size:34px">🧠</div><h2 style="margin:6px 0 0">pipe.one</h2>
${(pinSet || canSetup) ? `<div class=sub>${setup ? "Creá tu PIN (6-12 dígitos)" : "Ingresá tu PIN"}</div>
<input id=pin type=password inputmode=numeric autocomplete=off maxlength=12 placeholder="••••" autofocus onkeydown="if(event.key==='Enter')go()">
<button onclick=go()>${setup ? "Crear PIN" : "Entrar"}</button><div class=err id=err></div>`
    : `<div class=sub style="margin-top:16px">El PIN todavía no está configurado. Entrá una vez por el túnel local (localhost:3000) para crearlo.</div>`}
<script>async function go(){const p=document.getElementById('pin').value,e=document.getElementById('err');e.textContent='';
const r=await fetch('${setup ? "/api/auth/setup" : "/api/auth"}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:p})}).then(x=>x.json()).catch(()=>({error:'error de red'}));
if(r.ok)location.href='/';else e.textContent=r.error||'error';}</script></div></html>`
}
import { tts, stt, VOICES } from "./lib/voice.mjs"
import { importWhatsApp, importWhatsAppZip } from "./lib/wa-import.mjs"
import { runSelfTest, lastSelfTest } from "./send-selftest.mjs"

// cargar .env
loadEnv()

const PORT = process.env.PORT || 3000
// canales con bridge REALMENTE instalado en este hub. En un tenant, provision setea BRIDGES_ENABLED (ej "whatsapp") → /link no muestra
// canales sin bridge (que colgarían para siempre). Sin la var (instancia sin bridges declarados) = null = mostrar todos.
const enabledChannels = () => { const v = (process.env.BRIDGES_ENABLED || "").trim(); return v ? v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : null }
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".mov": "video/quicktime", ".3gp": "video/3gpp", ".opus": "audio/ogg", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".zip": "application/zip", ".webm": "video/webm", ".apk": "application/vnd.android.package-archive" }

// sin CORS wildcard: la app es same-origin (sirve SPA + API del mismo host). Un "*" con auth por cookie es un mal default.
const json = (res, code, data) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)) }
// respuesta JSON con ETag → si el cliente ya tiene esta versión (If-None-Match), 304 sin cuerpo. Ahorra re-transferir payloads
// grandes que no cambiaron (ej: la bandeja de 600 hilos que el auto-refresh pide cada 25s).
const jsonCached = (req, res, data) => {
  const body = JSON.stringify(data)
  const etag = '"' + createHash("sha1").update(body).digest("base64").slice(0, 22) + '"'
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" }); return res.end() }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ETag: etag, "Cache-Control": "no-cache" }); res.end(body)
}
// límites de tamaño (anti-DoS por memoria): JSON chico, audio de reuniones hasta 300MB.
function body(req, max = 5 * 1024 * 1024) { return new Promise((r) => { let d = "", n = 0; req.on("data", (c) => { n += c.length; if (n > max) { req.destroy() } else d += c }); req.on("end", () => { try { r(JSON.parse(d || "{}")) } catch { r({}) } }); req.on("error", () => r({})) }) }
function rawBody(req, max = 128 * 1024 * 1024) { return new Promise((r) => { const ch = []; let n = 0, over = false; req.on("data", (c) => { n += c.length; if (n > max) { over = true; req.destroy() } else ch.push(c) }); req.on("end", () => r(over ? null : Buffer.concat(ch))); req.on("error", () => r(null)) }) }
// transcodifica el audio grabado (webm/ogg/m4a) a OGG/OPUS mono — el formato que WhatsApp/Telegram esperan para notas de voz
function toOggOpus(buf, inMime = "audio/webm") {
  return new Promise((resolve, reject) => {
    const ext = /ogg/.test(inMime) ? "ogg" : /mp4|m4a|aac/.test(inMime) ? "m4a" : "webm"
    const inF = `/tmp/va_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`, outF = inF + ".ogg"
    try { writeFileSync(inF, buf) } catch (e) { return reject(e) }
    const done = (err, out) => { for (const f of [inF, outF]) { try { if (existsSync(f)) unlinkSync(f) } catch {} } err ? reject(err) : resolve(out) }
    const ff = spawn("ffmpeg", ["-y", "-i", inF, "-c:a", "libopus", "-b:a", "32k", "-ac", "1", "-application", "voip", outF])
    ff.on("error", (e) => done(e))
    ff.on("close", (code) => { if (code === 0 && existsSync(outF)) { try { done(null, readFileSync(outF)) } catch (e) { done(e) } } else done(new Error("ffmpeg code " + code)) })
  })
}

// STICKER: WhatsApp exige webp 512×512. Convierte cualquier imagen a webp cuadrado (padding transparente, mantiene proporción).
function toWebpSticker(buf, inMime = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const ext = /png/.test(inMime) ? "png" : /webp/.test(inMime) ? "webp" : /gif/.test(inMime) ? "gif" : "jpg"
    const inF = `/tmp/st_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`, outF = inF + ".webp"
    try { writeFileSync(inF, buf) } catch (e) { return reject(e) }
    const done = (err, out) => { for (const f of [inF, outF]) { try { if (existsSync(f)) unlinkSync(f) } catch {} } err ? reject(err) : resolve(out) }
    const ff = spawn("ffmpeg", ["-y", "-i", inF, "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000", "-c:v", "libwebp", "-q:v", "80", outF])
    ff.on("error", (e) => done(e))
    ff.on("close", (code) => { if (code === 0 && existsSync(outF)) { try { done(null, readFileSync(outF)) } catch (e) { done(e) } } else done(new Error("ffmpeg code " + code)) })
  })
}

// WAVEFORM de la nota de voz: WhatsApp/Matrix esperan msc1767.audio.waveform (64 amplitudes) para renderizar la nota de
// voz reproducible. Sin él, algunos clientes la muestran como archivo que no suena. Decodifica el ogg a PCM mono y saca 64 RMS.
function oggWaveform(buf, buckets = 64) {
  return new Promise((resolve) => {
    const inF = `/tmp/wf_${Date.now()}_${Math.random().toString(36).slice(2)}.ogg`
    try { writeFileSync(inF, buf) } catch { return resolve(null) }
    const chunks = []
    const ff = spawn("ffmpeg", ["-v", "quiet", "-i", inF, "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"])
    ff.stdout.on("data", (d) => chunks.push(d))
    ff.on("error", () => { try { unlinkSync(inF) } catch {}; resolve(null) })
    ff.on("close", () => {
      try { unlinkSync(inF) } catch {}
      try {
        const pcm = Buffer.concat(chunks); const n = pcm.length >> 1
        if (n < buckets) return resolve(null)
        const per = Math.floor(n / buckets), wf = []
        let peak = 1
        for (let b = 0; b < buckets; b++) {
          let sum = 0
          for (let i = 0; i < per; i++) { const s = pcm.readInt16LE(((b * per) + i) << 1); sum += s * s }
          const rms = Math.sqrt(sum / per); wf.push(rms); if (rms > peak) peak = rms
        }
        resolve(wf.map((v) => Math.round((v / peak) * 1024))) // normalizado 0..1024 (rango que usan Element/mautrix)
      } catch { resolve(null) }
    })
  })
}

// estado unificado de TODAS las integraciones (para /link y dashboards)
function integrationsStatus() {
  const NOW = Date.now(), D = 86400000
  // última actividad por canal/cuenta desde la DB (antes leía el messages.jsonl de >1GB → ERR_STRING_TOO_LONG
  // caía al catch → last={} → TODAS las integraciones aparecían caídas. Silencioso y falso).
  const last = {}, lastCh = {}
  try {
    for (const r of brain.channelAccountLast()) {
      const k = `${r.channel}/${r.account || ""}`
      if ((r.last || 0) > (last[k] || 0)) last[k] = r.last
      if ((r.last || 0) > (lastCh[r.channel] || 0)) lastCh[r.channel] = r.last
    }
  } catch {}
  // para calendar/drive/sharepoint usamos la fecha de modificación del archivo = última sincronización real (no la fecha de los eventos, que pueden ser futuros)
  const fileLast = (f) => { try { return statSync(f).mtimeMs } catch { return 0 } }
  const ok = (ts) => ts > 0 && NOW - ts < 3 * D
  const baileys = []
  for (const acc of ["wa2", "wa3"]) if (existsSync(`/tmp/wa_ok_${acc}`)) { let num = ""; try { const c = JSON.parse(readFileSync(`auth/${acc}/creds.json`, "utf8")); num = (c.me?.id || "").split(":")[0].split("@")[0] } catch {} baileys.push({ acc, num }) }
  let bridge = []; try { bridge = JSON.parse(readFileSync("/tmp/matrix_logins_whatsapp.json", "utf8")) } catch {}
  return {
    whatsapp: { bridge, baileys },
    // cuentas de correo REALES del tenant (no hardcodeadas) → un hub nuevo no ve las de nadie más
    email: (() => { try { return accounts.listAccounts().email.map((a) => ({ name: a.user, key: "email", ok: ok(a.last), last: a.last || 0 })) } catch { return [] } })(),
    otros: [
      { name: "Teams", key: "teams", guide: "teams", ok: ok(lastCh["teams"]), last: lastCh["teams"] || 0 },
      { name: "Telegram", key: "telegram", guide: "telegram", rm: true, ok: existsSync("auth/telegram.session"), last: lastCh["telegram"] || 0 },
      { name: "Notion", key: "notion", guide: "notion", ok: ok(lastCh["notion"]), last: lastCh["notion"] || 0 },
      { name: "Calendar Google", key: "gcal", guide: "google", ok: existsSync("auth/google-token-ventas.json"), last: fileLast("data/calendar-google.jsonl") },
      { name: "Drive Google", key: "gdrive", guide: "google", ok: existsSync("auth/google-token-ventas.json"), last: fileLast("data/drive.jsonl") },
      { name: "SharePoint / OneDrive", key: "sharepoint", guide: "teams", ok: existsSync("auth/teams.state.json"), last: fileLast("data/files-ms.jsonl") },
    ],
  }
}

// sirve un archivo con Content-Length + soporte de Range (necesario para reproducir/saltar audio y video)
function serveFile(req, res, full, mime, cc = "max-age=604800") {
  const size = statSync(full).size
  const range = req.headers.range
  const base = { "Content-Type": mime, "Cache-Control": cc, "Accept-Ranges": "bytes" }
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || []
    let start = parseInt(m[1]) || 0, end = m[2] ? parseInt(m[2]) : size - 1
    if (start >= size || end >= size) end = size - 1
    if (start > end) start = 0
    res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 })
    return createReadStream(full, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...base, "Content-Length": size })
  createReadStream(full).pipe(res)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname
  // headers de seguridad en TODA respuesta (setHeader persiste a través de los writeHead posteriores).
  // CSP: connect-src 'self' (sin exfiltración a hosts externos), frame-ancestors 'none' (anti-clickjacking sobre las acciones de envío).
  // script-src EXPLÍCITO 'self' 'unsafe-inline': el UI usa handlers inline (onclick=) → 'unsafe-inline' es necesario, PERO al declararlo
  // aparte quitamos data:/blob: como orígenes de SCRIPT (un <script src="data:…"> o blob-URL inyectado queda bloqueado; siguen valiendo
  // para img/media vía default-src). Nota: mientras haya onclick inline no se puede sacar 'unsafe-inline' sin migrar todo a addEventListener;
  // los escapes (esc/escj/enck en app.js) son la barrera XSS principal. Si algo del UI se rompe, se relaja.
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Content-Security-Policy", "default-src 'self' data: blob: 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'")
  try {
    // Assets PÚBLICOS para instalar la app (PWA/TWA→APK): manifest, iconos, service worker, assetlinks. NO son sensibles → sin PIN.
    if (/^\/(manifest\.json|sw\.js|favicon\.ico|icon-\d+\.png|pipe[\w.-]*\.apk)$/.test(path) || path.startsWith("/.well-known/")) {
      const full = normalize(join("public", path.replace(/^\//, "")))
      if (full.startsWith("public") && existsSync(full)) return serveFile(req, res, full, MIME[extname(full)] || "application/octet-stream", path === "/sw.js" ? "no-cache" : "public, max-age=86400")
    }
    // Decodificador del modo encubierto ("El Santo"): PÚBLICO, sin PIN — el que recibe tu mensaje NO tiene acceso al hub. Es 100%
    // client-side (la clave nunca sale del navegador; no toca el server), así que no revela nada. Cada hub sirve SU propio decoder.
    if (path === "/decrypt" || path === "/decodificar") {
      const f = join(process.cwd(), "public", "decrypt.html")
      if (existsSync(f)) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" }); return res.end(readFileSync(f)) }
    }
    // ── AUTH: PIN gate para exponer en internet (hub.example.com). ──
    // Local (túnel SSH: conexión directa a 127.0.0.1 SIN X-Forwarded-For) = confiable (ya gateado por SSH) → sin PIN.
    // Remoto (vía Caddy: llega como 127.0.0.1 PERO con X-Forwarded-For) = requiere PIN. OJO: detrás de proxy remoteAddress SIEMPRE es local.
    // gate local/proxy/DNS-rebinding extraído a http-gate.mjs (testeable) — MISMAS expresiones exactas.
    const { viaProxy, localHost, isLocal } = localFlags({ host: req.headers.host, xff: req.headers["x-forwarded-for"], remoteAddress: req.socket.remoteAddress })
    const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((x) => x[0]))
    // rate-limit key = IP REAL. Caddy ANEXA el IP verdadero al final del XFF; el cliente solo puede spoofear los del principio → último valor.
    const clientIp = clientIpFrom({ xff: req.headers["x-forwarded-for"], remoteAddress: req.socket.remoteAddress })
    const httpsProto = (req.headers["x-forwarded-proto"] || "").includes("https")
    const authed = isLocal || auth.validSession(cookies.sid)
    // CSRF / drive-by: aplica a TODO /api (mutaciones Y lecturas con efecto), NO solo a POST — isLocal es autoridad ambiental SIN
    // cookie (SameSite no protege) y hay GETs con efecto (matrix-link spawnea un proceso, ask/tts queman tokens). Un drive-by cross-site
    // (<img src=.../api/…> o fetch) manda Sec-Fetch-Site≠same-origin o un Origin≠Host → 403. Excepción: status/health (lectura pura).
    // Same-origin real: el navegador NO manda Origin en GET same-origin y sí Sec-Fetch-Site:same-origin → pasa. curl/no-browser (sin
    // ninguno de los dos) también pasa: sin browser no hay CSRF.
    const csrf = csrfReason({ path, secFetchSite: req.headers["sec-fetch-site"], origin: req.headers.origin, host: req.headers.host })
    if (csrf) return json(res, 403, { error: csrf })
    // Host allowlist (anti DNS-rebinding). Solo si TRUSTED_HOSTS seteado (managed lo setea; self-host opt-in). El check de Origin ya cubre mutaciones.
    if (!hostAllowed({ host: req.headers.host, trustedHosts: process.env.TRUSTED_HOSTS })) return json(res, 403, { error: "host no permitido" })
    // pre-gate (anónimo): NO exponer el conteo de dispositivos (oráculo de fingerprinting). sessions solo si ya estás autenticado.
    if (path === "/api/auth/status") return json(res, 200, { pinSet: auth.pinIsSet(), authed, canSetup: isLocal, ...(authed ? { sessions: auth.sessionCount() } : {}) })
    if (path === "/api/auth/setup" && req.method === "POST") {
      if (!isLocal) return json(res, 403, { error: "El PIN solo se configura desde localhost (túnel SSH)." }) // bootstrap privilegiado: NUNCA desde remoto, aunque no haya PIN aún
      if (auth.pinIsSet()) return json(res, 403, { error: "El PIN ya está configurado." })
      const b = await body(req); const r = auth.setPin(b.pin); if (r.error) return json(res, 400, r)
      const s = auth.login(b.pin, clientIp); setSid(res, s.token, s.ttl, httpsProto); return json(res, 200, { ok: true, sid: s.token }) // sid en el body: la app nativa lo manda como header (el player nativo no comparte el cookie jar)
    }
    if (path === "/api/auth" && req.method === "POST") {
      const b = await body(req); const r = auth.login(b.pin, clientIp); if (r.error) return json(res, 401, r)
      setSid(res, r.token, r.ttl, httpsProto); return json(res, 200, { ok: true, sid: r.token }) // sid en el body para clientes nativos (media con header Cookie)
    }
    if (path === "/api/auth/logout" && req.method === "POST") { auth.logout(cookies.sid); res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0; HttpOnly"); return json(res, 200, { ok: true }) }
    // REVOCAR TODO: cierra sesión en todos los dispositivos (perdiste/robaron un celu). Requiere estar autenticado.
    if (path === "/api/auth/revoke-all" && req.method === "POST") { if (!authed) return json(res, 401, { error: "no autorizado" }); auth.logoutAll(); res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0; HttpOnly"); return json(res, 200, { ok: true }) }
    // CAMBIAR PIN (self-service): requiere estar autenticado + el PIN actual. Así el cliente es autónomo (no depende de que le pasen/cambien el PIN por SSH).
    if (path === "/api/auth/change-pin" && req.method === "POST") { if (!authed) return json(res, 401, { error: "no autorizado" }); const b = await body(req); const r = auth.changePin(b.oldPin, b.newPin, clientIp, cookies.sid); if (r.error) return json(res, 400, r); return json(res, 200, { ok: true }) }
    // LANDING pública (marketing) — accesible SIN PIN, antes del gate de auth
    if (path === "/landing" || path === "/landing/") { if (existsSync("web/index.html")) return serveFile(req, res, "web/index.html", "text/html; charset=utf-8", "no-cache"); res.writeHead(404); return res.end() }
    if (path === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("User-agent: *\nAllow: /landing\nDisallow: /\n") }
    // HEALTH público (monitoreo por tenant): 200 + lag de ingesta. Sin datos sensibles.
    if (path === "/api/health") { let lagMin = null; try { const t = brain.lastMessageTs(); if (t) lagMin = Math.round((Date.now() - t) / 60000) } catch {} return json(res, 200, { ok: true, ts: Date.now(), version: process.env.BUILD_VERSION || "dev", uptimeMin: Math.round(process.uptime() / 60), ingestLagMin: lagMin }) }
    // KO-FI: webhook PÚBLICO (verifica el verification_token de Ko-fi, no el PIN — Ko-fi no puede hacer PIN). Un apoyo cae en la bandeja + push. Token en KOFI_TOKEN.
    if (path === "/api/webhook/kofi" && req.method === "POST") {
      const raw = await rawBody(req, 256 * 1024)
      let d = null; try { d = JSON.parse(new URLSearchParams((raw || Buffer.alloc(0)).toString("utf8")).get("data") || "{}") } catch {}
      const tok = (process.env.KOFI_TOKEN || "").trim()
      if (tok && d && tokEq(d.verification_token, tok)) { // procesa SOLO con token válido (constant-time); si no, 200 silencioso (sin efecto, sin reintentos infinitos)
        const who = String(d.from_name || "Alguien").slice(0, 60)
        const amount = d.amount ? `${d.amount} ${d.currency || ""}`.trim() : ""
        const kind = { Subscription: "se suscribió 💜", Commission: "encargó una comisión 🎨", "Shop Order": "compró en la tienda 🛍️" }[d.type] || "te invitó un café ☕"
        const note = d.message ? `: "${String(d.message).slice(0, 400)}"` : ""
        const text = `${who} ${kind}${amount ? ` (${amount})` : ""}${note}`
        try { appendMessage({ id: `kofi-${d.message_id || d.kofi_transaction_id || Date.now()}`, channel: "kofi", account: "kofi", jid: "kofi:" + who.toLowerCase().replace(/\s+/g, "-"), name: who, text, ts: Date.now(), dir: "in" }) } catch {}
        try { void push.sendPush({ title: "Nuevo apoyo en Ko-fi 🙏", body: text, tag: "kofi", url: "/#mensajes" }) } catch {}
        // PRIMER pago de una suscripción → avisos automáticos (operador "armá el server" + cliente "en preparación, máx 72h" en su idioma). Fire-and-forget.
        if (d.type === "Subscription" && d.is_first_subscription_payment) void Promise.resolve().then(() => notifyNewSubscription({ email: d.email, name: d.from_name, tier: d.tier_name, amount })).catch(() => {})
      }
      return json(res, 200, { ok: true }) // Ko-fi espera 200 para confirmar recepción
    }
    // INGESTA DE SMS (desde el teléfono con un forwarder, o el reader de Mac de chat.db). Público con TOKEN (SMS_TOKEN) — el forwarder no tiene PIN.
    // Se VINCULA POR NÚMERO al hilo de WhatsApp del mismo contacto (computeThread rama 'sms'): SMS + WhatsApp = una sola conversación.
    // Body: {from,text,ts?,dir?,name?,id?} o batch {messages:[…]}.
    if (path === "/api/ingest/sms" && req.method === "POST") {
      const tok = (process.env.SMS_TOKEN || "").trim()
      const given = String(req.headers["x-token"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "")).trim()
      if (!tok || !tokEq(given, tok)) return json(res, 401, { error: "token inválido" })
      const b = await body(req)
      const items = Array.isArray(b.messages) ? b.messages : [b]
      let n = 0
      for (const m of items) {
        const from = String(m.from || m.number || "").trim()
        const text = String(m.text || m.body || "").trim()
        if (!from || !text) continue
        const num = from.replace(/[^\d]/g, "")
        const ts = +m.ts || Date.now()
        const dir = m.dir === "out" ? "out" : "in"
        const name = String(m.name || "").trim() || undefined
        const id = String(m.id || `sms-${num || "x"}-${ts}`)
        try { appendMessage({ id, channel: "sms", account: "sms", jid: num, name, text, ts, dir }); n++ } catch {}
      }
      return json(res, 200, { ok: true, ingested: n })
    }
    // Salud del GPU box: el monitor gpu-health.sh (en el GPU box) postea su estado cada 5 min Y justo ANTES de auto-sanarse
    // (restart ollama / reboot). Guardamos el último snapshot y pusheamos SOLO cuando el box ACTÚA o se recupera — nunca en los
    // checks sanos (evita ruido). Así pipe.one "vigila" la GPU sin depender de que el box dependa del hub para sanarse.
    if (path === "/api/gpu-health" && req.method === "POST") {
      const tok = (process.env.GPU_HEALTH_TOKEN || "").trim()
      const given = String(req.headers["x-token"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "")).trim()
      if (!tok || !tokEq(given, tok)) return json(res, 401, { error: "token inválido" })
      const b = await body(req)
      try { (await import("fs")).writeFileSync("data/gpu-health.json", JSON.stringify({ ...b, at: Date.now() })) } catch {}
      const act = String(b.action || "none")
      if (act !== "none") {
        const LBL = { reboot: "🔁 Reinicié el GPU box", "restart-ollama": "♻️ Reinicié ollama (GPU box)", "needs-reboot-cooldown": "⏳ GPU box necesita reboot (en cooldown)", recovered: "✅ GPU box se recuperó" }
        const title = LBL[act] || "⚠️ GPU box: " + act
        const detail = `${b.reason || ""} · gen ${b.genOk ? "ok" : "COLGADA"} · nvidia ${b.nvidiaOk ? "ok" : "FALLA"} · VRAM ${b.vramUsed || "?"}/${b.vramTotal || "?"}MB · ${b.temp || "?"}°C`.trim()
        try { const { sendPush } = await import("./lib/push.mjs"); await sendPush({ title, body: detail, url: "/", tag: "gpu-health" }) } catch {}
      }
      return json(res, 200, { ok: true })
    }
    // ── VUELTA DE GOOGLE (OAuth): VA ANTES DEL GATE, a propósito ────────────────────────────────────────────
    // La cookie de sesión es SameSite=Strict, así que en la redirección de vuelta desde accounts.google.com el
    // navegador NO la manda: el gate veía "no autenticado", respondía la pantalla del PIN, y el código de Google
    // se perdía en silencio (ni log, ni token, ni error visible — el usuario solo veía que le pedían el PIN).
    // Que esté antes del gate NO lo deja abierto: exige un `state` que coincida con una cookie que solo emite
    // /oauth/*/start, y ESE sí está detrás del gate. O sea, el flujo únicamente lo puede iniciar alguien con sesión.
    if (path === "/oauth/google/callback") {
      const back = (msg, ok) => { res.writeHead(302, { "Set-Cookie": "goauth=; Path=/; Max-Age=0", Location: `/?gmail=${ok ? "ok" : "err"}&m=${encodeURIComponent(String(msg).slice(0, 120))}#cuenta` }); res.end() }
      try {
        const code = url.searchParams.get("code"), state = url.searchParams.get("state")
        if (url.searchParams.get("error")) return back(url.searchParams.get("error"), false)
        if (!code || !state || state !== cookies.goauth) return back("estado inválido (reintentá)", false)
        const redirectUri = `https://${req.headers.host}/oauth/google/callback`
        const { tokens, email } = await goauth.exchangeGmailCode(code, redirectUri)
        if (!tokens.refresh_token) return back("Google no devolvió refresh token — revocá el acceso previo de pipe en tu cuenta de Google y reintentá", false)
        const r = accounts.saveGmailOAuth(email, tokens.refresh_token)
        return back(r.error || `${email} conectado`, !r.error)
      } catch (e) { return back(e.message || "error", false) }
    }
    if (path === "/oauth/backup/callback") {
      // el resultado se logueaba SOLO en la URL de vuelta: si el usuario no la miraba, un fallo era invisible.
      const back = (msg, ok) => { console.log(`[oauth-backup] ${ok ? "OK" : "FALLÓ"}: ${msg}`); res.writeHead(302, { "Set-Cookie": "boauth=; Path=/; Max-Age=0", Location: `/?backup=${ok ? "ok" : "err"}&m=${encodeURIComponent(String(msg).slice(0, 120))}` }); res.end() }
      try {
        const code = url.searchParams.get("code"), state = url.searchParams.get("state")
        if (url.searchParams.get("error")) return back(url.searchParams.get("error"), false)
        if (!code || !state || state !== cookies.boauth) return back("estado inválido (reintentá)", false)
        const redirectUri = `https://${req.headers.host}/oauth/backup/callback`
        const { tokens, email } = await goauth.exchangeBackupCode(code, redirectUri)
        // En la pantalla de Google el permiso de Drive es una CASILLA APARTE. Si no se tilda, Google devuelve un
        // token perfectamente válido… que solo sirve para leer tu correo. Sin este chequeo quedaba "conectado" y
        // recién fallaba de noche, al intentar subir. Mejor decirlo acá, con la instrucción exacta.
        if (!String(tokens.scope || "").includes("drive.file"))
          return back("faltó tildar el permiso de Drive en la pantalla de Google (la casilla de 'crear y editar sus propios archivos'). Reintentá y marcala.", false)
        if (!tokens.refresh_token) return back("Google no devolvió refresh token — revocá el acceso previo de pipe y reintentá", false)
        goauth.saveBackupToken(tokens, email)
        return back(`backup conectado a ${email}`, true)
      } catch (e) { return back(e.message || "error", false) }
    }

    if (!authed) { // no autenticado y remoto → 401 para API, página de PIN para HTML
      if (path.startsWith("/api/")) return json(res, 401, { error: "no autorizado" })
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(loginPage(auth.pinIsSet(), isLocal))
    }
    // ── 🔒 CUENTAS SECRETAS: 2º PIN. secretOn = hay una sesión secreta válida (token corto por dispositivo) → se ven las cuentas secretas.
    // El token viaja en el header x-secret-token (app nativa) o cookie 'secret' (web). Sliding 5 min; el cliente lo borra al perder foco.
    const secretTok = String(req.headers["x-secret-token"] || cookies.secret || "").trim()
    const secretOn = secret.validSecretSession(secretTok)
    // guard para endpoints por-hilo: un hilo de cuenta secreta NO existe si no está desbloqueado (como si el key no fuera válido)
    // 🔒 ¿esta clave de hilo está tapada? Cubre el hilo 100%-secreto Y el parcial (que se muestra filtrado por-mensaje):
    // para las rutas que MANDAN el hilo a un tercero, un parcial es tan sensible como uno entero.
    // Existía hace rato y no se usaba en ningún lado; las rutas que llevan la clave en el CUERPO del POST se salteaban
    // el gate de arriba, que solo mira el query string.
    const secretBlocked = (key) => { if (secretOn || !key) return false; const g = secret.secretGate(); return g.blockAll || g.hide.has(key) || g.preview.has(key) }
    if (path === "/api/secret/status") return json(res, 200, { pinSet: secret.secretPinSet(), unlocked: secretOn })
    // crear/cambiar el 2º PIN: SOLO con la sesión principal (ya estás authed). Debe ser distinto del PIN de entrada (lo valida setSecretPin).
    if (path === "/api/secret/setup" && req.method === "POST") { const b = await body(req); const r = secret.setSecretPin(b.pin, b.oldPin, clientIp); return json(res, r.error ? 400 : 200, r) }
    // desbloquear: verifica el 2º PIN → token de sesión secreta (también en cookie para la web)
    if (path === "/api/secret/unlock" && req.method === "POST") {
      const b = await body(req); const r = secret.unlockSecret(b.pin, clientIp); if (r.error) return json(res, 401, r)
      res.setHeader("Set-Cookie", `secret=${r.token}; Path=/; Max-Age=${Math.floor(r.ttl / 1000)}; HttpOnly; SameSite=Strict${httpsProto ? "; Secure" : ""}`)
      return json(res, 200, { ok: true, token: r.token })
    }
    if (path === "/api/secret/lock" && req.method === "POST") { secret.lockSecret(secretTok); res.setHeader("Set-Cookie", "secret=; Path=/; Max-Age=0; HttpOnly"); return json(res, 200, { ok: true }) }
    // listar cuentas con su flag secreta (SOLO desbloqueado) + togglear. Sin sesión secreta no se puede ni ver ni tocar la marca.
    if (path === "/api/secret/accounts") { if (!secretOn) return json(res, 403, { error: "bloqueado" }); return json(res, 200, { accounts: secret.listSecretAccounts() }) }
    if (path === "/api/secret/account" && req.method === "POST") { if (!secretOn) return json(res, 403, { error: "bloqueado" }); const b = await body(req); const r = secret.setSecretAccount(b.channel, b.account, !!b.secret); purgeSecretDerived(); return json(res, 200, r) }
    // marcar/desmarcar un NÚMERO de WhatsApp como CUENTA SECRETA → oculta TODA su actividad automáticamente. SOLO desbloqueado.
    if (path === "/api/secret/wa" && req.method === "POST") { if (!secretOn) return json(res, 403, { error: "bloqueado" }); const b = await body(req); const r = secret.setSecretNumber(b.number, !!b.secret); purgeSecretDerived(); return json(res, 200, r) }
    // estado de las cuentas secretas (correo + números WA) para los checkboxes de config. Requiere desbloqueado.
    if (path === "/api/secret/state") { if (!secretOn) return json(res, 403, { error: "bloqueado" }); return json(res, 200, { accounts: secret.listSecretAccounts(), numbers: secret.listSecretNumbers() }) }
    // ── OAuth Gmail: flujo web "Conectar Gmail → Permitir" (nada de app-passwords). Solo autenticados llegan acá. ──
    if (path === "/oauth/google/start") {
      try {
        const redirectUri = `https://${req.headers.host}/oauth/google/callback`
        const state = randomBytes(16).toString("hex") // CSRF token OAuth: aleatorio criptográfico (no Math.random, que es predecible)
        const authUrl = goauth.gmailAuthUrl(redirectUri, state, url.searchParams.get("email") || "")
        res.writeHead(302, { "Set-Cookie": `goauth=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`, Location: authUrl })
        return res.end()
      } catch (e) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(`<p>No se pudo iniciar la conexión con Google (¿falta configurar la app OAuth?). Volvé a la app.</p>`) }
    }
    // ── OAuth BACKUP EN DRIVE: mismo flujo "Conectar → Permitir", pero con scope drive.file (pipe solo ve lo que
    //    él sube). Así el backup offsite se configura desde la Consola y NO por SSH con un CLI interactivo. ──
    if (path === "/oauth/backup/start") {
      try {
        const redirectUri = `https://${req.headers.host}/oauth/backup/callback`
        const state = randomBytes(16).toString("hex")
        res.writeHead(302, { "Set-Cookie": `boauth=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure`, Location: goauth.backupAuthUrl(redirectUri, state) })
        return res.end()
      } catch (e) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(`<p>No se pudo iniciar: ${esc(e.message)}</p>`) }
    }
    // ── API ──
    if (path.startsWith("/api/")) {
      const q = Object.fromEntries(url.searchParams)
      // 🔒 gateo por-hilo. /api/thread SE AUTO-FILTRA por-mensaje (contacto fusionado → ves lo no-secreto); los demás endpoints por-hilo
      // (media/targets/delta/sync/catchup/suggest/person) NO filtran → se bloquean si el hilo tiene ALGO secreto. 100% secreto → todo vacío.
      // Se miran las DOS: el gate usaba `q.key || q.name` pero los handlers resuelven `q.name || q.key`, así que mandando
      // las dos con una clave inocente en `key` se saltaba el gate y el handler igual atendía el `name` secreto.
      if (!secretOn) { const g = secret.secretGate(); const claves = [q.key, q.name].filter(Boolean)
        const sk = claves.find((k) => g.hide.has(k) || g.preview.has(k)) || claves[0]
        if (sk && g.any) {
          const hasAny = claves.some((k) => g.hide.has(k) || g.preview.has(k))
          if (hasAny && (path.startsWith("/api/thread/") || path === "/api/person" || path === "/api/person/full" || path === "/api/contact/profile" || path === "/api/contact/social")) return json(res, 200, { items: [], secret: true })
          if (claves.some((k) => g.hide.has(k)) && path === "/api/thread") return json(res, 200, { items: [], secret: true })
        }
      }
      if (path === "/api/oauth/google/configured") return json(res, 200, { configured: goauth.googleConfigured() })
      if (path === "/api/wa/status") { const lo = await loggedOutNumbers(); return json(res, 200, { loggedOut: secretOn ? lo : lo.filter((n) => !secret.isSecretNumber(n)) }) } // 🔒 el banner de re-vinculación mostraba el número secreto // números WhatsApp caídos → banner de re-link
      if (path === "/api/summary") return json(res, 200, brain.summary())
      if (path === "/api/threads") { let t = brain.listThreads({ limit: +q.limit || 100, q: (q.q || "").slice(0, 80) }); if (!secretOn) { const g = secret.secretGate(); if (g.any) t = t.filter((x) => !g.hide.has(x.key)).map((x) => { const p = g.preview.get(x.key); return p ? { ...x, lastText: ((p.text || "").replace(/\s+/g, " ").slice(0, 120)) || "…", ts: p.ts, lastChannel: p.channel || x.lastChannel } : x }) } return jsonCached(req, res, t) } // 🔒 oculta hilos 100% secretos + parchea el preview de los parciales al último mensaje NO-secreto
      // OCR local (opcional): extrae texto de una imagen/PDF del CAS (facturas, documentos) sin nube. Requiere OCR_URL.
      if (path === "/api/ocr" && req.method === "POST") { const b = await body(req); if (!ocrEnabled()) return json(res, 200, { text: "", disabled: true }); if (casSecreto(b.media)) { if (!destinoConfiable(ocrUrlActual())) return json(res, 200, { text: "" }) } else if (casSecreto(b.media, { secretOn })) return json(res, 200, { text: "" }); const text = await ocrCas(b.media || "").catch(() => ""); return json(res, 200, { text }) }
      // contador barato de entrantes (thread_stats.unread es monotónico por ingesta) → el cliente detecta "llegó algo nuevo" y suena. Sin recomputar la bandeja.
      if (path === "/api/unread") { let n = totalUnread(); if (!secretOn) n -= secret.secretUnread(); return json(res, 200, { n: Math.max(0, n) }) } // 🔒 no contar no-leídos secretos si está bloqueado
      if (path === "/api/person") return json(res, 200, await brain.personCard(q.name || q.key || "", { force: q.force === "1" }))
      if (path === "/api/person/full") return json(res, 200, brain.personView(q.name || q.key || "")) // timeline completo (on-demand)
      if (path === "/api/coach") return json(res, 200, brain.coachData())
      if (path === "/api/coach/action" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.coachAction(b.key, b.action)) }
      if (path === "/api/spam/unmark" && req.method === "POST") { const b = await body(req); if (b.key) setNotSpam(b.key); return json(res, 200, { ok: true }) } // #31: corregir falso positivo del clasificador
      if (path === "/api/compose/correct" && req.method === "POST") { const b = await body(req); const localOnly = secretoPorNombre(b.key) || secretoPorNombre(b.name); return json(res, 200, await brain.composeCorrect(b.text, { channel: b.channel, localOnly })) } // 3 opciones antes de enviar
      if (path === "/api/coach/weekly") return json(res, 200, await brain.weeklyReview())
      if (path === "/api/coach/social") return json(res, 200, await brain.socialDigest({ days: +q.days || 3, force: q.force === "1" })) // resumen IG/FB/LinkedIn (cacheado 2h)
      if (path === "/api/coach/linkedin") return json(res, 200, await brain.linkedinDrafts({ force: q.force === "1" })) // borradores LinkedIn (cacheados)
      if (path === "/api/llm-usage") return json(res, 200, usageStats()) // medidor nube vs local
      if (path === "/api/channels") return json(res, 200, { ...brain.channelHealth(), ingest: brain.ingestLag() }) // heartbeat por canal (para el aviso "reconectá") + lag de ingesta
      if (path === "/api/sync-status") return json(res, 200, brain.syncStatus()) // canales bajando su carga inicial → sync bar
      // ── Push (notificaciones al celular, Web Push nativo del browser) ──
      if (path === "/api/push/vapid") return json(res, 200, { publicKey: push.vapidPublic(), count: push.subCount() })
      // ── preferencias de notificación: horas de silencio (DND) + hilos muteados ──
      if (path === "/api/notif-prefs") {
        if (req.method === "POST") { const b = await body(req); const cur = existsSync("data/notif-prefs.json") ? JSON.parse(readFileSync("data/notif-prefs.json", "utf8")) : {}; const next = { ...cur, ...b }; writeFileSync("data/notif-prefs.json", JSON.stringify(next)); return json(res, 200, next) }
        return json(res, 200, existsSync("data/notif-prefs.json") ? JSON.parse(readFileSync("data/notif-prefs.json", "utf8")) : { quietStart: null, quietEnd: null, mutedThreads: [] })
      }
      if (path === "/api/notif-prefs/mute" && req.method === "POST") {
        const b = await body(req), p = existsSync("data/notif-prefs.json") ? JSON.parse(readFileSync("data/notif-prefs.json", "utf8")) : {}
        const set = new Set(p.mutedThreads || []); if (b.on === false) set.delete(b.thread); else set.add(b.thread)
        p.mutedThreads = [...set]; writeFileSync("data/notif-prefs.json", JSON.stringify(p)); return json(res, 200, { muted: set.has(b.thread) })
      }
      if (path === "/api/push/subscribe" && req.method === "POST") return json(res, 200, push.subscribe(await body(req)))
      if (path === "/api/push/unsubscribe" && req.method === "POST") { const b = await body(req); return json(res, 200, push.unsubscribe(b.endpoint)) }
      if (path === "/api/push/test" && req.method === "POST") return json(res, 200, await push.sendPush({ title: "pipe.one ✅", body: "Notificaciones activadas — te avisaré de lo importante.", url: "/" }))
      if (path === "/api/agenda") return json(res, 200, brain.agenda())
      if (path === "/api/calendar") return json(res, 200, brain.calendarData(q.view || "dia", q.date || ""))
      // cuánto falta para la próxima reunión — lo consultan las tres apps para mostrarlo sin abrir la agenda
      if (path === "/api/next-meeting") return json(res, 200, brain.proximaReunion() || { none: true })
      if (path === "/api/calendar/regen" && req.method === "POST") { spawn(process.execPath, ["src/calendar-prep.mjs"], { detached: true, stdio: "ignore" }).unref(); return json(res, 200, { ok: true }) }
      if (path === "/api/directory") return json(res, 200, brain.directory())
      if (path === "/api/search") { const b = await body(req); return json(res, 200, brain.searchMessages(b.q || q.q || "")) }
      if (path === "/api/ask") { const b = await body(req); return json(res, 200, await brain.ask(b.q || q.q || "")) }
      if (path === "/api/router-search") { const b = await body(req); return json(res, 200, await brain.routerSearch(b.q || q.q || "")) } // robotito: facetas (0 tokens) → fallback RAG
      // 🔒 estos dos toman el contacto del CUERPO del POST (b.name), y el gate por-hilo de arriba solo mira el query
      // string → se lo salteaban enteros. Redactarle un borrador a alguien es leerle el historial, así que se chequea acá.
      // La respuesta es la MISMA que para un nombre que no existe: un "secret:true" sería un oráculo (preguntás un nombre
      // y la propia respuesta te confirma que esa persona existe y está oculta).
      if (path === "/api/reply") { const b = await body(req); const oculto = secretoPorNombre(b.name) || secretoPorNombre(b.key); if (!secretOn && oculto) return json(res, 200, { error: "El último mensaje ya es tuyo — nada pendiente." }); return json(res, 200, await brain.draftReply(b.name || "", b.instruction || "", { localOnly: oculto })) }
      if (path === "/api/meeting-prep") { if (!secretOn && secretoPorNombre(q.q)) return json(res, 200, { error: "No hay reunión." }); return json(res, 200, await brain.meetingPrep(q.q || "", { localOnly: secretoPorNombre(q.q) })) }
      // ── voz + briefing ──
      if (path === "/api/briefing") { const override = q.lat ? { lat: +q.lat, lon: +q.lon, name: q.name, city: q.city, tz: q.tz } : null; return json(res, 200, await briefing.buildBriefing({ override })) }
      if (path === "/api/daily-plan") return json(res, 200, await briefing.dailyPlan())
      if (path === "/api/config") { if (req.method === "POST") { return json(res, 200, briefing.setConfig(await body(req))) } return json(res, 200, briefing.getConfig()) }
      // política de almacenamiento de media (no guardar fotos/videos/docs — cuenta + por chat; el audio siempre se guarda)
      if (path === "/api/media-policy") {
        if (req.method === "POST") { const b = await body(req); if (b.def) setMediaDefault(b.def); if (b.key) setThreadMediaPolicy(b.key, b.mode); return json(res, 200, { ok: true, policy: getMediaPolicy() }) }
        return json(res, 200, { policy: getMediaPolicy(), storage: casStats(), quota: storageStatus() })
      }
      if (path === "/api/media/free" && req.method === "POST") { const b = await body(req); return json(res, 200, freeThreadMedia(b.key || null)) } // → papelera (30 días para deshacer)
      if (path === "/api/media/trash") return json(res, 200, { items: casTrashList().filter((it) => !casSecreto(it.pub || it.path || "", { secretOn })), storage: casStats() }) // 🔒 la papelera listaba las rutas del CAS: con la ruta se baja el archivo // papelera: media borrada, recuperable hasta el purge
      if (path === "/api/media/restore" && req.method === "POST") { const b = await body(req); return json(res, 200, restoreMedia(b.pub || "")) } // DESHACER un borrado
      if (path === "/api/voices" && req.method === "POST") { const b = await body(req); const c = briefing.setConfig({ voice: b.voice }); return json(res, 200, { ok: true, voice: c.voice }) } // elegir voz TTS
      if (path === "/api/voices") return json(res, 200, { voices: VOICES, current: briefing.getConfig().voice })
      if (path === "/api/tts") {
        const b = await body(req); const audio = await tts(b.text || "", { voice: b.voice || briefing.getConfig().voice })
        res.writeHead(200, { "Content-Type": "audio/mpeg" }); return res.end(audio) // sin ACAO:* — mismo origen, no hace falta (fix P3)
      }
      if (path === "/api/stt") {
        const buf = await rawBody(req); const text = await stt(buf, req.headers["content-type"] || "audio/webm")
        return json(res, 200, { text })
      }
      // ── vincular WhatsApp: QR en vivo ──
      if (path === "/api/wa-qr") {
        const acc = (q.acc || "wa2").replace(/[^a-z0-9]/gi, ""); const f = `/tmp/wa_qr_${acc}.png`
        if (existsSync(f)) { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }); return res.end(readFileSync(f)) }
        res.writeHead(404); return res.end()
      }
      if (path === "/api/wa-status") {
        const acc = (q.acc || "wa2").replace(/[^a-z0-9]/gi, "")
        let code = ""
        try { code = readFileSync(`/tmp/wa_code_${acc}`, "utf8").trim() } catch {}
        return json(res, 200, { connected: existsSync(`/tmp/wa_ok_${acc}`), code })
      }
      // ── vincular una red vía el bridge Matrix del server (whatsapp/instagram/facebook/telegram/linkedin) ──
      if (path === "/api/matrix-link" && req.method === "POST") { // POST: spawnea un proceso → NO debe ser alcanzable por un GET drive-by (<img src=…>)
        const net = (q.net || "whatsapp").replace(/[^a-z]/gi, "")
        if (!bridgeNets().includes(net)) return json(res, 400, { error: "red no soportada" }) // solo redes del registro con connect matrix-bridge
        const flow = q.phone ? "phone" : "qr"
        const phone = (q.phone || "").replace(/[^0-9+]/g, "")
        try { unlinkSync(`/tmp/matrix_code_${net}`) } catch {}
        try { unlinkSync(`/tmp/matrix_ok_${net}`) } catch {}
        try { unlinkSync(`/tmp/matrix_qr_${net}.png`) } catch {}
        const args = ["src/matrix.mjs", "link", net, flow]; if (flow === "phone") args.push(phone)
        const fd = openSync(`data/logs/matrix-link.log`, "a")
        spawn(process.execPath, args, { env: process.env, stdio: ["ignore", fd, fd], detached: true }).unref()
        return json(res, 200, { started: true, net, flow })
      }
      if (path === "/api/matrix-link-token" && req.method === "POST") { // vincular por token/cookie (Discord=token)
        const net = (q.net || "").replace(/[^a-z]/gi, ""); const b = await body(req)
        if (!tokenNets().includes(net)) return json(res, 400, { error: "red no soportada" }) // solo redes del registro con connect matrix-token
        try { unlinkSync(`/tmp/matrix_ok_${net}`) } catch {}
        const fd = openSync(`data/logs/matrix-link.log`, "a")
        spawn(process.execPath, ["src/matrix.mjs", "link-token", net], { env: { ...process.env, LINK_CRED: b.token || "" }, stdio: ["ignore", fd, fd], detached: true }).unref()
        return json(res, 200, { started: true })
      }
      // ── Telegram self-service: teléfono → código → 2FA opcional → sesión (GramJS) ──
      if (path === "/api/telegram/status") return json(res, 200, tglogin.telegramLoginStatus())
      if (path === "/api/telegram/start" && req.method === "POST") { const b = await body(req); const r = await tglogin.telegramStartLogin(b); return json(res, r.error ? 400 : 200, r) }
      if (path === "/api/telegram/code" && req.method === "POST") { const b = await body(req); return json(res, 200, tglogin.telegramSubmitCode(b.code)) }
      if (path === "/api/telegram/password" && req.method === "POST") { const b = await body(req); return json(res, 200, tglogin.telegramSubmitPassword(b.password)) }
      if (path === "/api/telegram/connected" && req.method === "POST") { // login OK → arrancar el reader ya (sin esperar el backoff del daemon)
        if (tglogin.telegramConnected()) { const fd = openSync(`data/logs/telegram.log`, "a"); spawn(process.execPath, ["src/telegram.mjs"], { env: process.env, stdio: ["ignore", fd, fd], detached: true }).unref() }
        return json(res, 200, { ok: true })
      }
      if (path === "/api/matrix-status") {
        const net = (q.net || "whatsapp").replace(/[^a-z]/gi, "")
        let code = ""
        try { code = readFileSync(`/tmp/matrix_code_${net}`, "utf8").trim() } catch {}
        return json(res, 200, { connected: existsSync(`/tmp/matrix_ok_${net}`), code, qr: existsSync(`/tmp/matrix_qr_${net}.png`) })
      }
      if (path === "/api/matrix-qr") {
        const net = (q.net || "whatsapp").replace(/[^a-z]/gi, ""); const f = `/tmp/matrix_qr_${net}.png`
        if (existsSync(f)) { res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }); return res.end(readFileSync(f)) }
        res.writeHead(404); return res.end()
      }
      if (path === "/api/channels/catalog") return json(res, 200, { channels: channelCatalog() }) // catálogo (labels/marca/flujo de conexión) desde el registro — los clientes derivan la UI de acá
      if (path === "/api/backup/status") {
        const st = goauth.backupStatus()
        let ultimo = null
        try { const fs2 = await import("fs"); const b = fs2.readdirSync("./data/backups").filter((f) => /\.tar\.zst\.enc$/.test(f)).sort(); ultimo = b[b.length - 1] || null } catch {}
        return json(res, 200, { ...st, ultimo })
      }
      if (path === "/api/status") { const st = integrationsStatus(); if (!secretOn && st.whatsapp) { // 🔒 números/cuentas secretos NO aparecen en config si está bloqueado (igual que /api/accounts)
        st.whatsapp.bridge = (st.whatsapp.bridge || []).filter((n) => !secret.isSecretNumber(n))
        st.whatsapp.baileys = (st.whatsapp.baileys || []).filter((b) => !secret.isSecretNumber(b.num)) } return json(res, 200, st) }
      // ── rediseño: objetivos, empresas, espacios, contactos, home ──
      if (path === "/api/home") return json(res, 200, await brain.homeSnapshot(ws))
      if (path === "/api/home/audio") { const f = "data/home-brief.mp3"; if (!existsSync(f)) { res.writeHead(404); return res.end() } return serveFile(req, res, f, "audio/mpeg") }
      if (path === "/api/home/regen" && req.method === "POST") { spawn(process.execPath, ["src/home-brief.mjs"], { detached: true, stdio: "ignore" }).unref(); return json(res, 200, { ok: true }) }
      if (path === "/api/action/done" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.actionDone(b.kind, b.id)) } // marca to-do/promesa hecho
      // NOTAS con IA: digest (resumen/ideas/reflexión) + chat conversacional sobre tus notas
      if (path === "/api/notes/digest") return json(res, 200, brain.notesDigest())
      if (path === "/api/notes/chat" && req.method === "POST") { const b = await body(req); return json(res, 200, await brain.notesChatSend(b.q || "")) }
      if (path === "/api/notes/chat") return json(res, 200, { history: brain.notesChatHistory() })
      if (path === "/api/notes/regen" && req.method === "POST") { spawn(process.execPath, ["src/notes-ai.mjs"], { detached: true, stdio: "ignore" }).unref(); return json(res, 200, { ok: true }) }
      if (path === "/api/notes/clips") return json(res, 200, brain.notesClips({ kind: q.kind || "all", before: +q.before || 0, limit: +q.limit || 40 }))
      // notas categorizadas por IA (self-notes + note_meta): lista por categoría/estado, taxonomía, junk
      if (path === "/api/notes/list") return json(res, 200, { items: listNotes({ category: q.cat, status: q.status || "active", limit: +q.limit || 80 }), categories: noteCategories(), junk: noteJunkCount() })
      if (path === "/api/notes/categorize" && req.method === "POST") { spawn(process.execPath, ["src/notes-categorize.mjs"], { detached: true, stdio: "ignore" }).unref(); return json(res, 200, { ok: true }) }
      if (path === "/api/notes/action" && req.method === "POST") { const b = await body(req); return json(res, 200, noteAction(b.id, b.action, b.category)) }
      if (path === "/api/clip/pin" && req.method === "POST") { const b = await body(req); return json(res, 200, clipFlag(b.id, "pinned", b.on !== false)) }
      if (path === "/api/clip/archive" && req.method === "POST") { const b = await body(req); return json(res, 200, clipFlag(b.id, "archived", b.on !== false)) }
      // CUENTA / CONFIGURACIÓN: cuentas conectadas + agregar/quitar correo
      if (path === "/api/accounts") { const a = accounts.listAccounts(); if (!secretOn) { a.email = (a.email || []).filter((e) => !secret.isSecretAccount("email", e.label)); a.messaging = (a.messaging || []).map((m) => ({ ...m, numbers: (m.numbers || []).filter((n) => !secret.isSecretNumber(n)) })) } return json(res, 200, a) } // 🔒 cuentas/números secretos no aparecen en config si está bloqueado
      if (path === "/api/accounts/email" && req.method === "POST") { const b = await body(req); const r = await accounts.addEmailAccount(b); if (r.ok) { try { spawn("pkill", ["-f", "mail-imap.mjs"]) } catch {} } return json(res, r && r.error ? 400 : 200, r) } // reconecta el reader
      if (path === "/api/accounts/email/remove" && req.method === "POST") { const b = await body(req); const r = accounts.removeEmailAccount(b.label); if (r.ok) { try { spawn("pkill", ["-f", "mail-imap.mjs"]) } catch {} } return json(res, r && r.error ? 400 : 200, r) }
      // Integraciones conectables desde la Consola (Slack/Signal): token/URL cifrados; al guardar, pkill al reader → el daemon lo respawnea con la config nueva.
      if (path === "/api/integrations") return json(res, 200, integrations.getIntegrations())
      if (path === "/api/integrations/slack" && req.method === "POST") { const r = await integrations.setSlack(await body(req)); if (r.ok) { try { spawn("pkill", ["-f", "src/slack.mjs"]) } catch {} } return json(res, r && r.error ? 400 : 200, r) }
      if (path === "/api/integrations/slack/remove" && req.method === "POST") { const r = integrations.removeSlack(); try { spawn("pkill", ["-f", "src/slack.mjs"]) } catch {} return json(res, 200, r) }
      if (path === "/api/integrations/signal" && req.method === "POST") { const r = integrations.setSignal(await body(req)); if (r.ok) { try { spawn("pkill", ["-f", "src/signal.mjs"]) } catch {} } return json(res, r && r.error ? 400 : 200, r) }
      if (path === "/api/integrations/signal/remove" && req.method === "POST") { const r = integrations.removeSignal(); try { spawn("pkill", ["-f", "src/signal.mjs"]) } catch {} return json(res, 200, r) }
      // BACKFILL de archivados: trae correos viejos (fuera del INBOX) por término. Corre en background; la UI polea el status.
      if (path === "/api/mail/backfill" && req.method === "POST") { const b = await body(req); const q = (b.q || "").trim(); if (!q) return json(res, 400, { error: "Escribí un nombre, dominio o palabra." }); try { spawn(process.execPath, ["src/mail-backfill.mjs"], { env: { ...process.env, BACKFILL_QUERY: q, LLM_TASK: "backfill" }, detached: true, stdio: "ignore" }).unref() } catch (e) { return json(res, 500, { error: e.message }) } return json(res, 200, { ok: true, started: true, q }) }
      if (path === "/api/mail/backfill/status") { const v = getMeta("backfill_status"); return json(res, 200, v ? JSON.parse(v) : { state: "idle" }) }
      // RESINCRONIZACIÓN: reconstruir bandeja / búsqueda / identidades / re-conectar readers.
      if (path === "/api/resync" && req.method === "POST") { const b = await body(req); const what = b.what || "stats"
        try {
          if (what === "stats") return json(res, 200, { ok: true, what, threads: rebuildStats() }) // bandeja desincronizada → recomputa thread_stats
          if (what === "search") { for (const s of ["src/enrich-convos.mjs", "src/build-graph.mjs"]) spawn(process.execPath, [s], { env: { ...process.env, LLM_CHAIN: smartChain({ sensitive: true }), LLM_TASK: "resync" }, detached: true, stdio: "ignore" }).unref(); return json(res, 200, { ok: true, what, started: true }) } // MISMA política que el cron (era `|| "ollama,gemini"` → resync más permisivo que el cron)
          if (what === "identities") { spawn(process.execPath, ["src/resolve-identities.mjs"], { detached: true, stdio: "ignore" }).unref(); return json(res, 200, { ok: true, what, started: true }) }
          if (what === "channels") { for (const r of ["mail-imap.mjs", "mail-outlook.mjs"]) { try { spawn("pkill", ["-f", r]) } catch {} } return json(res, 200, { ok: true, what, restarted: true }) } // el daemon los relevanta
          return json(res, 400, { error: "acción desconocida" })
        } catch (e) { return json(res, 500, { error: e.message }) } }
      // desconectar una integración que se removía por archivo (Telegram). El resto se desconecta desde la guía.
      if (path === "/api/integration/remove" && req.method === "POST") { const b = await body(req); const map = { telegram: ["auth/telegram.session", "/tmp/tg_code", "/tmp/tg_pass"] }; const files = map[b.key]; if (!files) return json(res, 400, { error: "Esta integración se desconecta desde la guía." }); let n = 0; for (const f of files) { try { unlinkSync(f); n++ } catch {} } try { spawn("pkill", ["-f", b.key + ".mjs"]) } catch {}; return json(res, 200, { ok: true, removed: n }) }
      // MOTOR DE IA (BYOK): elegir proveedor(es) + pegar tus tokens. Las keys nunca se devuelven (solo hint enmascarado).
      // ONBOARDING: el checklist de primer arranque. La lógica vivía SÓLO en el cliente web (4 llamadas y las reglas de
      // "está conectado" repetidas ahí), así que el escritorio y el móvil no tenían forma de mostrarlo sin recalcular todo
      // por su cuenta y quedar desincronizados. Acá hay una sola fuente de verdad para las tres.
      if (path === "/api/onboarding") {
        const st = integrationsStatus(), acc = accounts.listAccounts(), llm = llmConfigMasked()
        const chans = (brain.channelHealth() || {}).channels || []
        return json(res, 200, calcularOnboarding({ backupOK: !!(goauth.backupStatus().connected || (process.env.BACKUP_RCLONE_REMOTE || "").trim()), st, acc, llm, chans, secretOn, esNumeroSecreto: secret.isSecretNumber, esCuentaSecreta: secret.isSecretAccount, numerosSecretos: secret.listSecretNumbers() }))
      }
      if (path === "/api/llm-config") return json(res, 200, llmConfigMasked())
      if (path === "/api/llm-config/save" && req.method === "POST") { const b = await body(req); return json(res, 200, setLlmConfig(b)) }
      if (path === "/api/llm-config/test" && req.method === "POST") { const b = await body(req); return json(res, 200, await testKey(b)) } // probar una key (ping mínimo): {keyId} o {provider,token}
      // CONFIG POR-HUB (base multi-cliente): dueño, empresa, números/mails propios, timezone
      if (path === "/api/hub-config") return json(res, 200, hub.hubConfig())
      // 🤖 ASISTENTE en tu propio chat: te contesta si le PREGUNTÁS algo (las notas no se tocan). Apagado por defecto.
      if (path === "/api/assistant" && req.method !== "POST") return json(res, 200, { ...brain.getAssistant(), state: brain.assistantState() }) // ⚠️ el !== POST es necesario: sin él, esta línea atrapa también el guardado
      if (path === "/api/assistant" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.setAssistant(b)) }
      if (path === "/api/assistant/try" && req.method === "POST") { const b = await body(req); const r = await brain.answerQuestion(String(b.q || "").slice(0, 500), { web: brain.getAssistant().web }); return json(res, 200, r) } // probarlo sin mandar nada por WhatsApp
      // ✍️ FIRMAS de correo, por cuenta ("*" = la de por defecto). Un email se responde con firma; un WhatsApp no.
      if (path === "/api/signatures") return json(res, 200, { signatures: sig.listSignatures(), fallback: sig.defaultSignature() })
      if (path === "/api/signature" && req.method === "POST") { const b = await body(req); return json(res, 200, { signatures: sig.setSignature(b.account || "*", { text: b.text, html: b.html }) }) }
      if (path === "/api/hub-config/save" && req.method === "POST") { const b = await body(req)
        // 🔒 myNumbers es lo que el gate usa para saber qué línea es secreta: editarlo APAGA la función entera sin tocar el
        // 2º PIN. Era un bypass total con solo la sesión principal, un POST y sin rastro. Con marcas activas, exige el 2º PIN.
        if (!secretOn && secret.listSecretNumbers().length && b && "myNumbers" in b) return json(res, 403, { error: "Tenés cuentas ocultas: para cambiar tus números propios hay que desbloquear con el 2º PIN." })
        return json(res, 200, hub.setHubConfig(b)) }
      if (path === "/api/objetivos") return json(res, 200, ws.objetivos())
      if (path === "/api/objetivo" && req.method === "POST") return json(res, 200, ws.saveObjetivo(await body(req)))
      if (path === "/api/objetivo/delete" && req.method === "POST") { ws.deleteObjetivo((await body(req)).id); return json(res, 200, { ok: true }) }
      if (path === "/api/objetivos/suggest") return json(res, 200, await brain.suggestObjetivos(ws))
      if (path === "/api/companies") return json(res, 200, ws.companies())
      if (path === "/api/company" && req.method === "POST") return json(res, 200, ws.saveCompany(await body(req)))
      if (path === "/api/company/delete" && req.method === "POST") { ws.deleteCompany((await body(req)).id); return json(res, 200, { ok: true }) }
      if (path === "/api/contact/pin" && req.method === "POST") { const b = await body(req); const r = ws.setPin(b.key, b.pinned !== false && b.pinned !== "false"); brain.invalidateThreads(); return json(res, 200, { pins: r }) }
      if (path === "/api/contact/archive" && req.method === "POST") { const b = await body(req); const on = b.on !== false; const r = ws.archive(b.key, on); brain.invalidateThreads(); void Promise.resolve().then(() => mailArchive.archiveThreadOnServer(b.key, on)).catch(() => {}); return json(res, 200, { ok: true, archived: r }) } // propaga al buzón real (Gmail/Outlook/IMAP), fire-and-forget
      if (path === "/api/contact/spam" && req.method === "POST") { const b = await body(req); ws.addSpamSender(b.addr); if (b.key) ws.archive(b.key, true); brain.invalidateThreads(); return json(res, 200, { ok: true }) }
      if (path === "/api/contact/silence" && req.method === "POST") { const b = await body(req); const r = ws.silence(b.key, b.on !== false); brain.invalidateThreads(); return json(res, 200, { ok: true, silenced: r.includes(b.key) }) } // ruido que no es spam → pestaña Silenciados
      if (path === "/api/email/body") return json(res, 200, { body: brain.emailBody(q.id || "", { secretOn }) }) // 🔒 el id saltea el filtro por hilo
      if (path === "/api/thread/media") return json(res, 200, brain.threadMedia(q.key || ""))
      if (path === "/api/contact/profile") return json(res, 200, brain.contactProfile(q.key || ""))
      if (path === "/api/thread/targets") return json(res, 200, brain.threadTargets(q.key || ""))
      // EMPEZAR UNA CONVERSACIÓN NUEVA: resuelve lo que el usuario escribió (teléfono / correo / usuario) a la clave de
      // hilo de siempre. NO manda nada ni crea nada: la app abre esa conversación y el envío sigue el camino habitual.
      // qué canales se pueden estrenar desde la app. La rama de canal explícito de resolverDestino existía pero era código
      // muerto: sin esta lista, ninguna de las tres apps sabía qué ofrecer, y el mensaje de error hablaba de "elegí el
      // canal" sin que ese control existiera en ningún lado.
      if (path === "/api/conversation/channels") {
        // "conectado" = ese canal tuvo tráfico real. listAccounts().messaging no sirve acá: usa `network` (no `channel`)
        // y además está fijo en WhatsApp, así que nunca habría ofrecido Telegram ni Slack.
        const activos = new Set(((brain.channelHealth() || {}).channels || [])
          .filter((c) => (c.n30 || 0) > 0 || (c.n7 || 0) > 0).map((c) => String(c.channel || "").toLowerCase()))
        const simples = sendableDirectChannels().filter((c) => activos.has(c))
        return json(res, 200, { channels: [
          { id: "", label: "Teléfono o correo", hint: "+51 999 111 222 · alguien@empresa.com" },
          ...simples.map((c) => ({ id: c, label: channelLabel(c), hint: `Usuario o id de ${channelLabel(c)}` })),
        ] })
      }
      if (path === "/api/conversation/new" && req.method === "POST") {
        const b = await body(req)
        const r = brain.resolverDestino(b.destino, b.channel)
        if (r.error) return json(res, 400, r)
        // si ya existe conversación con ese destino, se devuelve tal cual (nombre real incluido) en vez de una "nueva"
        // MISMO LÍMITE QUE ROMPIÓ OTRAS COSAS: buscar solo entre los 400 recientes hacía que, con miles de hilos, un
        // chat viejo no se "encontrara" y se abriera una conversación NUEVA en paralelo a la que ya existía.
        // Preguntamos por la clave exacta a la base y usamos la ventana solo para enriquecer el nombre.
        const previo = brain.listThreads({ limit: 400 }).find((t) => t.key === r.key) || brain.hiloPorClave(r.key)
        // Un hilo secreto tiene que responder IGUAL que uno que no existe. La versión anterior omitía `existe`, y esa
        // diferencia bastaba para enumerar los contactos ocultos escribiendo números en la hoja, con el 1er PIN nomás.
        if (!secretOn && secretoPorNombre(r.key)) return json(res, 200, { ...r, existe: false })
        return json(res, 200, { ...r, name: previo?.name || r.name, existe: !!previo })
      }
      // ENVÍO IDEMPOTENTE: el cliente manda un `msgId` propio y lo repite en cada reintento de su cola. Un 502 no
      // significa "no se envió" (puede cortarse DESPUÉS de que el mensaje salió), así que sin esto reintentar
      // duplicaría mensajes. Ver src/lib/outbox-repo.mjs.
      if (path === "/api/send" && req.method === "POST") {
        const b = await body(req)
        const reserva = claimSend(b.msgId)
        if (reserva.estado === "hecho") return json(res, 200, { ...(reserva.resultado || {}), dedup: true }) // ya salió: devolvemos lo de antes
        if (reserva.estado === "en-curso") return json(res, 202, { pending: true })                          // otro reintento lo está mandando
        let text = b.text
        if (b.covert) { try { text = brain.encodeCovertFor(b.key, b.text) } catch (e) { releaseSend(b.msgId); return json(res, 400, { error: e.message }) } }
        let r
        try { r = await brain.sendReply(b.key, text, { channel: b.channel, target: b.target, historiaDe: b.historiaDe || "" }) }
        catch (e) { releaseSend(b.msgId); throw e } // falló de verdad → soltamos la reserva o el reintento esperaría eternamente
        if (r && r.error) { releaseSend(b.msgId); return json(res, 400, r) }
        finishSend(b.msgId, r)
        try { if (b.key) setNotSpam(b.key) } catch {} // le respondiste: no hay señal más clara de que no es spam
        brain.invalidateThreads() // la bandeja refleja tu envío YA (antes tardaba hasta el TTL del cache)
        return json(res, 200, b.covert ? { ...r, cover: text } : r) // covert: devolvemos el texto tapadera para "ver original"
      } // covert: cifra→texto tapadera antes de mandar; devuelve el poema para "ver original". invalidateThreads → la bandeja refleja tu envío YA (antes tardaba hasta el TTL del cache)
      // ── modo encubierto ("El Santo"): config por-contacto + preview en vivo ──
      if (path === "/api/covert/config" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.setCovert(b.key, b.pass, b.style)) }
      if (path === "/api/covert/config") return json(res, 200, brain.getCovert(q.key || ""))
      if (path === "/api/covert/preview" && req.method === "POST") { const b = await body(req); try { return json(res, 200, { cover: brain.previewCovert(b.text, b.pass, b.style) }) } catch (e) { return json(res, 400, { error: e.message }) } }
      // PILOTO AUTOMÁTICO ("modo vacaciones"): config por-contacto, preview (dry-run, NO envía) y audit log
      if (path === "/api/autopilot/config" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.setAutopilot(b.key, !!b.enabled, { maxPerDay: b.maxPerDay })) }
      if (path === "/api/autopilot/config") return json(res, 200, brain.getAutopilot(q.key || ""))
      if (path === "/api/autopilot/preview" && req.method === "POST") { const b = await body(req); if (secretBlocked(b.key)) return json(res, 200, { action: "skip", reason: "sin mensajes" }); try { return json(res, 200, await brain.considerReply(b.key, { dryRun: true, force: true })) } catch (e) { return json(res, 400, { error: e.message }) } }
      if (path === "/api/autopilot/log") return json(res, 200, { log: brain.autopilotLog(60) })
      if (path === "/api/autopilot/feedback" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.autopilotFeedback(b.key, { good: b.good, correction: b.correction, original: b.original })) }
      if (path === "/api/autopilot/train-card") return json(res, 200, await brain.trainCard()) // 🎓 Entrená tu IA: trae un mensaje real + el borrador de la IA para aprobar/corregir
      // 🎭 PERSONA del owner (para que el piloto responda en personaje). GET = ver; POST {text} = editar; POST {rebuild:true} = regenerar de tus datos
      if (path === "/api/autopilot/persona" && req.method === "POST") { const b = await body(req); if (b.rebuild) return json(res, 200, { text: await brain.buildPersona() }); return json(res, 200, brain.setPersona(b.text || "")) }
      if (path === "/api/autopilot/persona") return json(res, 200, { text: brain.getPersona() })
      if (path === "/api/autopilot/voice" && req.method === "POST") return json(res, 200, (await brain.buildVoiceProfile()) || { error: "no pude armar el perfil (¿pocos mensajes?)" }) // 🗣️ re-detectar tu voz
      if (path === "/api/autopilot/voice") return json(res, 200, brain.getVoiceProfile() || {}) // perfil de voz auto-detectado (idiomas/dialecto/tono)
      // política de escalado: QUÉ tópicos escala el piloto (elegidos por el usuario, no hardcodeado). presets_available = catálogo para la UI.
      if (path === "/api/autopilot/policy" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.setEscalatePolicy({ presets: b.presets, custom: b.custom })) }
      if (path === "/api/autopilot/policy") return json(res, 200, { ...brain.getEscalatePolicy(), presets_available: brain.ESCALATE_PRESETS.map((p) => p.key) })
      if (path === "/api/autopilot/council" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.setCouncil({ enabled: b.enabled, members: b.members, chairman: b.chairman })) } // council: varios modelos locales draftean + chairman elige
      if (path === "/api/autopilot/council") return json(res, 200, { ...brain.getCouncil(), available: await brain.councilModels() })
      // #5: transcribir + resumir un video/audio/imagen on-demand (long-press/hover)
      if (path === "/api/media/summarize" && req.method === "POST") { const b = await body(req); try { const r = await brain.summarizeMedia(b.id, { secretOn }); return json(res, r && r.error ? 400 : 200, r) } catch (e) { return json(res, 500, { error: e.message }) } }
      // ── IMPORT de historial de WhatsApp (self-service desde la app: "Exportar chat" → subir el .txt) ──
      if (path === "/api/import/whatsapp" && req.method === "POST") {
        const buf = await rawBody(req, 64 * 1024 * 1024) // el export de un chat, hasta 64MB
        if (!buf || !buf.length) return json(res, 400, { error: "archivo vacío o demasiado grande" })
        let r; try { r = importWhatsApp(buf.toString("utf8"), { chatName: q.name || "", isGroup: q.group === "1", dateOrder: q.order || "auto", tzOffsetMin: +q.tz || 0 }) } catch (e) { return json(res, 500, { error: e.message }) }
        if (r && r.error) return json(res, 400, r)
        if (r.inserted > 0) spawn(process.execPath, ["src/resolve-identities.mjs"], { detached: true, stdio: "ignore" }).unref() // re-key el hilo importado a la identidad real
        return json(res, 200, r)
      }
      if (path === "/api/import/whatsapp-zip" && req.method === "POST") { // export CON multimedia (.zip): trae texto + fotos/audios/videos
        const buf = await rawBody(req, 512 * 1024 * 1024) // los .zip con media pueden ser grandes (hasta 512MB)
        if (!buf || !buf.length) return json(res, 400, { error: "archivo vacío o demasiado grande (máx 512MB)" })
        let r; try { r = importWhatsAppZip(buf, { chatName: q.name || "", isGroup: q.group === "1", dateOrder: q.order || "auto", tzOffsetMin: +q.tz || 0 }) } catch (e) { return json(res, 500, { error: e.message }) }
        if (r && r.error) return json(res, 400, r)
        if (r.inserted > 0) spawn(process.execPath, ["src/resolve-identities.mjs"], { detached: true, stdio: "ignore" }).unref()
        return json(res, 200, r)
      }
      // REENVIAR mensajes preservando el media (audio/imagen/archivo), no solo el texto
      // ⚠️ EXCEPCIÓN DECLARADA al principio "desbloquear es mostrármelo a mí, no mandárselo a un tercero": reenviar es,
      // por definición, sacar el mensaje del hub. Con el 2º PIN puesto SÍ se permite, porque es una acción explícita y
      // deliberada del usuario sobre un mensaje que está mirando. Sin el 2º PIN se niega (messageById no lo entrega).
      // Fijado por test para que no cambie sin querer. (La respuesta NO distingue si el mensaje era secreto: si algún
      // día la app quiere avisar antes de mandarlo, hay que agregar esa marca acá.)
      if (path === "/api/forward" && req.method === "POST") { const b = await body(req); const r = await brain.forwardMessages(b.ids, b.key, { secretOn }); return json(res, r && r.error ? 400 : 200, r) }
      // AUTO-TEST DE ENVÍO: último resultado (GET) o correr ahora (POST). El cron lo corre cada ~12h; verifica que el envío funciona de verdad.
      if (path === "/api/selftest" && req.method === "GET") return json(res, 200, lastSelfTest() || { ts: 0, results: [] })
      if (path === "/api/selftest" && req.method === "POST") return json(res, 200, await runSelfTest())
      // NOTA DE VOZ: recibe el audio grabado (binario) + params en la query, lo pasa a ogg/opus y lo manda por el bridge
      if (path === "/api/send-audio" && req.method === "POST") {
        const inMime = (req.headers["content-type"] || "audio/webm").split(";")[0].trim()
        const raw = await rawBody(req, 25 * 1024 * 1024)
        if (!raw || !raw.length) return json(res, 400, { error: "audio vacío o demasiado grande" })
        if (!q.key) return json(res, 400, { error: "falta key" })
        const durationMs = Math.max(0, parseInt(q.dur || "0", 10)) * 1000
        const ogg = await toOggOpus(raw, inMime).catch(() => null) // si ffmpeg falla, mandamos el original
        const waveform = ogg ? await oggWaveform(ogg).catch(() => null) : null // 64 amplitudes → PTT reproducible en WhatsApp
        const r = await brain.sendReplyAudio(q.key, ogg || raw, { channel: q.channel, target: q.target, mime: ogg ? "audio/ogg" : inMime, durationMs, waveform })
        if (r && !r.error) brain.invalidateThreads()
        return json(res, r && r.error ? 400 : 200, r)
      }
      // IMAGEN / VIDEO / ARCHIVO: recibe el binario + params en la query y lo manda por el bridge (adjunto)
      if (path === "/api/send-media" && req.method === "POST") {
        const mime = (req.headers["content-type"] || "application/octet-stream").split(";")[0].trim()
        const raw = await rawBody(req, 64 * 1024 * 1024) // hasta 64MB (videos)
        if (!raw || !raw.length) return json(res, 400, { error: "archivo vacío o demasiado grande (máx 64MB)" })
        if (!q.key) return json(res, 400, { error: "falta key" })
        const r = await brain.sendReplyMedia(q.key, raw, { channel: q.channel, target: q.target, mime, filename: q.filename ? decodeURIComponent(q.filename) : "archivo" })
        if (r && !r.error) brain.invalidateThreads()
        return json(res, r && r.error ? 400 : 200, r)
      }
      // ENVIAR UN CONTACTO: se manda el NOMBRE de alguien que el hub ya conoce y el server arma la vCard con sus
      // datos reales (nunca los escribe el cliente: así no se puede usar para exfiltrar datos de un hilo secreto).
      if (path === "/api/send-contact" && req.method === "POST") {
        const b = await body(req)
        if (!b.key || !b.contacto) return json(res, 400, { error: "falta key o contacto" })
        if (secret.secretThreadKeys().has(String(b.contacto))) return json(res, 403, { error: "ese contacto está en una línea oculta" })
        const ficha = await brain.personCard(b.contacto)
        const c = (ficha && ficha.contacts) || {}
        const r = await brain.sendReplyContact(b.key, { name: ficha?.name || b.contacto, phones: c.phones || [], emails: c.emails || [], org: ficha?.orgs || "" }, { channel: b.channel, target: b.target })
        if (r && !r.error) brain.invalidateThreads()
        return json(res, r && r.error ? 400 : 200, r)
      }
      if (path === "/api/send-sticker" && req.method === "POST") {
        const inMime = (req.headers["content-type"] || "image/jpeg").split(";")[0].trim()
        const raw = await rawBody(req, 16 * 1024 * 1024)
        if (!raw || !raw.length) return json(res, 400, { error: "imagen vacía o muy grande (máx 16MB)" })
        if (!q.key) return json(res, 400, { error: "falta key" })
        const webp = await toWebpSticker(raw, inMime).catch(() => null) // imagen → webp 512×512; si ffmpeg falla, mando el original
        const r = await brain.sendReplySticker(q.key, webp || raw, { channel: q.channel, target: q.target, mime: webp ? "image/webp" : inMime })
        if (r && !r.error) brain.invalidateThreads()
        return json(res, r && r.error ? 400 : 200, r)
      }
      // ── Grupos de la bandeja (auto editables + custom) ──
      // ficha de un grupo de WhatsApp: quién habla más, de qué se habla y cuánto participás. 🔒 nunca de un hilo oculto.
      if (path === "/api/group") { const k = q.key || ""; if (!k || (!secretOn && secret.secretThreadKeys().has(k))) return json(res, 200, { error: "no encuentro ese grupo" }); return json(res, 200, brain.grupoCard(k)) }
      if (path === "/api/groups") return json(res, 200, { groups: groups.listGroups(), contactGroups: groups.contactGroupsMap() })
      if (path === "/api/groups/save" && req.method === "POST") return json(res, 200, groups.saveGroup(await body(req)))
      if (path === "/api/groups/delete" && req.method === "POST") return json(res, 200, groups.deleteGroup((await body(req)).id))
      if (path === "/api/groups/auto" && req.method === "POST") { const b = await body(req); return json(res, 200, groups.setAutoGroup(b.id, b)) }
      if (path === "/api/groups/assign" && req.method === "POST") { const b = await body(req); return json(res, 200, groups.assignContact(b.key, b.groupId, b.on)) }
      if (path === "/api/espacios") return json(res, 200, ws.espacios())
      if (path === "/api/espacio" && req.method === "POST") return json(res, 200, ws.saveEspacio(await body(req)))
      if (path === "/api/espacio/delete" && req.method === "POST") { ws.deleteEspacio((await body(req)).id); return json(res, 200, { ok: true }) }
      if (path === "/api/espacio/rule" && req.method === "POST") { const b = await body(req); return json(res, 200, ws.espacioAddRule(b.id, { type: b.type, value: b.value })) }
      if (path === "/api/espacio/rule/delete" && req.method === "POST") { const b = await body(req); return json(res, 200, ws.espacioRemoveRule(b.id, b.idx)) }
      if (path === "/api/espacio/exception" && req.method === "POST") { const b = await body(req); return json(res, 200, ws.espacioAddException(b.id, { type: b.type, value: b.value })) }
      if (path === "/api/espacio/exception/delete" && req.method === "POST") { const b = await body(req); return json(res, 200, ws.espacioRemoveException(b.id, b.idx)) }
      if (path === "/api/espacio/view") return json(res, 200, await brain.espacioView(ws, q.id || ""))
      if (path === "/api/contact/merge" && req.method === "POST") { const b = await body(req); const r = brain.mergeContactsInto(b.target || b.key, b.keys || b.channelIds || [], { canonical: b.canonical || "", aliases: b.aliases || [] }); brain.invalidateThreads(); return json(res, 200, r) } // fusiona hilos (mueve msgs) + registra alias de los duplicados sin hilo (vault/agenda) → el directorio los colapsa
      // ── ENRIQUECIMIENTO SOCIAL: cuentas Apify (multi-cuenta, round-robin, cuota) + investigar un contacto por los links que pegaste ──
      if (path === "/api/apify/accounts" && req.method === "POST") { const b = await body(req); if (b.remove) return json(res, 200, apify.removeApifyAccount(b.remove)); if (b.actors) return json(res, 200, apify.setApifyActors(b.actors)); return json(res, 200, apify.addApifyAccount({ name: b.name, token: b.token })) }
      if (path === "/api/apify/accounts") return json(res, 200, apify.apifyAccounts())
      if (path === "/api/contact/social") return json(res, 200, brain.getContactSocial(q.key || "") || { links: {}, profiles: null })
      if (path === "/api/contact/links" && req.method === "POST") { const b = await body(req); return json(res, 200, brain.setContactLinks(b.key, b.links || {})) }
      if (path === "/api/contact/investigate" && req.method === "POST") { const b = await body(req); if (secretBlocked(b.key)) return json(res, 200, { links: {}, profiles: {}, sources: [], errors: {}, updatedAt: Date.now() }); try { return json(res, 200, await brain.investigateContact(b.key, b.links)) } catch (e) { return json(res, 400, { error: e.message }) } }
      if (path === "/api/contact/unmerge" && req.method === "POST") { ws.unmergeContact((await body(req)).channelId); return json(res, 200, { ok: true }) }
      if (path === "/api/contact/photo" && req.method === "POST") { const b = await body(req); ws.setContactPhoto(b.key, b.url); return json(res, 200, { ok: true }) }
      if (path === "/api/contact/category" && req.method === "POST") { const b = await body(req); ws.setContactCategory(b.key, b.category); return json(res, 200, { ok: true }) }
      if (path === "/api/contact/info") return json(res, 200, { category: (ws.contactCategories()[q.key] || "auto"), pinned: ws.pins().includes(q.key), silenced: ws.silenced().includes(q.key) })
      if (path === "/api/contact/suggestions") return json(res, 200, await brain.mergeSuggestions(ws, q.key || ""))
      if (path === "/api/thread") return json(res, 200, await brain.unifiedThread(q.key || "", ws, { before: +q.before || 0, limit: +q.limit || 100, secretOn }))
      if (path === "/api/thread/catchup") return json(res, 200, await brain.catchup(q.key || "", ws, +q.since || 0))
      // SYNC edit-aware: solo los mensajes NUEVOS o editados (rev > sinceRev) → el cliente cachea el resto y no lo re-baja
      if (path === "/api/thread/delta") return json(res, 200, brain.threadDeltaItems(q.key || "", +q.sinceRev || 0))
      if (path === "/api/thread/sync") return json(res, 200, brain.threadSyncPage(q.key || "", +q.before || 0, { limit: Math.min(1500, +q.limit || 800) })) // backfill de texto completo hacia atrás
      if (path === "/api/thread/suggest-reply") return json(res, 200, await brain.suggestReply(q.key || "", { localOnly: secretoPorNombre(q.key) })) // borrador IA para el input (no envía)
      if (path === "/api/thread/summarize") return json(res, 200, await brain.summarizeChat(q.key || "", q.range || "all", ws)) // resumen guardado como nota IA
      // ABRIR un hilo es la señal más honesta de que NO es spam: te tomaste el trabajo de leerlo. Un correo real
      // que el clasificador mandó a spam (pasó con una invitación de verdad mezclada con el marketing del mismo
      // dominio) se rescata solo la primera vez que lo abrís, sin que tengas que buscar ningún botón.
      if (path === "/api/thread/seen" && req.method === "POST") { const b = await body(req); if (b.key) { try { setNotSpam(b.key) } catch {} } return json(res, 200, { lastSeen: ws.markSeen(b.key, b.ts) }) }
      if (path === "/api/thread/schedule") return json(res, 200, await brain.scheduleIntent(q.key || "")) // calendarizador por chat: ¿hay intención de agendar?
      if (path === "/api/schedule/create" && req.method === "POST") { const b = await body(req); const r = await brain.createSchedule(b); return json(res, r?.error ? 400 : 200, r) }
      if (path === "/api/schedule/delete" && req.method === "POST") { const b = await body(req); const r = await brain.cancelSchedule(b); return json(res, r?.error ? 400 : 200, r) }
      if (path === "/api/schedule/move" && req.method === "POST") { const b = await body(req); const r = await brain.rescheduleSchedule(b); return json(res, r?.error ? 400 : 200, r) }
      if (path === "/api/thread/meetings") return json(res, 200, await brain.threadMeetings(q.key || "")) // tarjeta de reuniones con este contacto
      if (path === "/api/social/ingest" && req.method === "POST") { const b = await body(req, 20 * 1024 * 1024); const r = await brain.ingestSocial(b.network, b.images || [], { sessionExpired: b.sessionExpired, links: b.links || [] }); return json(res, r?.error ? 400 : 200, r) } // capturas de feed → vision → bandeja
      if (path === "/api/social/mystyle" && req.method === "POST") { const b = await body(req, 20 * 1024 * 1024); const r = await brain.ingestMyStyle(b.network, b.images || []); return json(res, r?.error ? 400 : 200, r) } // tus posts propios → calibrar estilo
      if (path === "/api/coach/social-highlights") return json(res, 200, brain.socialHighlights({ days: +q.days || 2 })) // oportunidades/notable de redes (barato, sin LLM)
      // notetaker: el agente del Mac/Android sube la grabación de una call (audio crudo en el body; metadata en la query)
      if (path === "/api/meeting/ingest" && req.method === "POST") {
        const buf = await rawBody(req)
        if (!buf) return json(res, 413, { error: "grabación demasiado grande (máx 300MB)" })
        const ctExt = { "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/aac": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm", "audio/flac": "flac" }[(req.headers["content-type"] || "").split(";")[0].trim()]
        const r = await meetings.ingestRecording({
          audioBuffer: buf, ext: q.ext || ctExt, title: q.title || "", ts: +q.ts || Date.now(),
          attendees: q.attendees ? String(q.attendees).split(",").map((s) => s.trim()).filter(Boolean) : [],
          source: q.source || "mac", lang: q.lang || "es",
          sensitive: q.sensitive === "1" || q.sensitive === "true" ? true : (q.sensitive === "0" || q.sensitive === "false" ? false : null),
          durationSec: +q.duration || 0,
        })
        return json(res, r && r.error ? 400 : 200, r)
      }
      if (path === "/api/meeting/reprocess" && req.method === "POST") { const b = await body(req); return json(res, 200, await meetings.reprocessMeeting(b.id)) }
      if (path === "/api/meeting") return json(res, 200, await brain.meetingCard(q.id || "", ws))
      if (path === "/api/add-email" && req.method === "POST") {
        const b = await body(req)
        const email = (b.email || "").trim().toLowerCase()
        const pass = (b.pass || "").replace(/\s/g, "") // app-passwords se pegan con espacios
        const host = (b.host || "imap.gmail.com").trim()
        if (!/.+@.+\..+/.test(email) || pass.length < 12) return json(res, 400, { error: "email o app-password inválido (la app-password son 16 letras)" })
        let accts = []; try { accts = JSON.parse(readFileSync("auth/imap-accounts.json", "utf8")) } catch {}
        if (accts.some((a) => a.user === email)) return json(res, 200, { ok: true, msg: "ya estaba conectado" })
        const base = (host.includes("gmail") ? "gmail-" : "mail-") + email.split("@")[0].replace(/[^a-z0-9]/gi, "")
        let label = base, i = 2; while (accts.some((a) => a.label === label)) label = `${base}-${i++}`
        accts.push({ label, host, port: 993, user: email, pass })
        writeFileSync("auth/imap-accounts.json", JSON.stringify(accts, null, 1), { mode: 0o600 }) // 600: app-passwords en texto plano no legibles por otros usuarios del box
        spawn("pkill", ["-f", "src/mail-imap.mjs"], { stdio: "ignore" }) // el daemon lo reinicia con la cuenta nueva
        return json(res, 200, { ok: true, label })
      }
      if (path === "/api/matrix-logins") {
        const net = (q.net || "whatsapp").replace(/[^a-z]/gi, "")
        if (q.refresh) { const fd = openSync(`data/logs/matrix-link.log`, "a"); spawn(process.execPath, ["src/matrix.mjs", "logins", net], { env: process.env, stdio: ["ignore", fd, fd], detached: true }).unref() }
        let list = []
        try { list = JSON.parse(readFileSync(`/tmp/matrix_logins_${net}.json`, "utf8")) } catch {}
        if (!secretOn) list = list.filter((n) => !secret.isSecretNumber(n)) // 🔒 no listar cuentas secretas del bridge sin 2º PIN
        return json(res, 200, { net, accounts: list })
      }
      return json(res, 404, { error: "endpoint no encontrado" })
    }
    // ── panel de las 3 cuentas de WhatsApp (estado + QR en vivo, todo en una página) ──
    if (path === "/whatsapp") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      return res.end(`<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>WhatsApp — pipe.one</title><body style="font-family:-apple-system,sans-serif;background:#f5f6f8;color:#1a1a2e;margin:0;padding:20px;text-align:center">
<h2 style="margin:6px 0">Tus WhatsApp</h2><p style="color:#7a7a8c;font-size:13px;margin:0 0 18px">Verde = conectado. Si alguno pide QR, escanealo desde ese teléfono.</p>
<div id="accts" style="display:flex;flex-direction:column;gap:16px;max-width:380px;margin:0 auto"></div>
<script>
const ACC=[["wa1","WhatsApp 1"],["wa2","WhatsApp 2"],["wa3","WhatsApp 3"]];
const box=document.getElementById('accts');
box.innerHTML=ACC.map(([a,n])=>\`<div style="background:#fff;border-radius:16px;padding:16px;box-shadow:0 1px 3px #0001">
  <div style="display:flex;justify-content:space-between;align-items:center"><b>\${n}</b><span id="st-\${a}" style="font-size:13px;color:#7a7a8c">…</span></div>
  <div id="code-\${a}" style="display:none;margin-top:12px"><div style="font-size:12px;color:#7a7a8c">Vincular con número → ingresá este código:</div><div id="codev-\${a}" style="font-size:30px;font-weight:800;letter-spacing:5px;color:#6366f1;margin-top:4px"></div></div>
  <img id="qr-\${a}" style="width:250px;height:250px;background:#fff;border-radius:12px;margin-top:10px;display:none" src="/api/wa-qr?acc=\${a}">
  </div>\`).join('');
async function tick(){for(const [a] of ACC){try{const {connected,code}=await (await fetch('/api/wa-status?acc='+a)).json();
  const st=document.getElementById('st-'+a),qr=document.getElementById('qr-'+a),cd=document.getElementById('code-'+a);
  if(connected){st.innerHTML='🟢 Conectado';st.style.color='#16a34a';qr.style.display='none';cd.style.display='none';}
  else{st.innerHTML='📷 QR o 📲 código';st.style.color='#ea580c';qr.style.display='inline-block';qr.src='/api/wa-qr?acc='+a+'&t='+Date.now();
    if(code){cd.style.display='block';document.getElementById('codev-'+a).textContent=code;}else{cd.style.display='none';}}
}catch(e){}}}
tick();setInterval(tick,3000);
</script></body></html>`)
    }
    // /link y /guia quedaron UNIFICADOS en la SPA (picker "Agregar conexión" con tabs + FAQ in-app). Redirigimos por si
    // quedó un bookmark o deep-link viejo → una sola experiencia. (Los dos handlers de abajo son dead-code tras esto.)
    if (path === "/link") { res.writeHead(302, { Location: "/#agregar/telefonia" }); return res.end() }
    if (path === "/guia") { res.writeHead(302, { Location: "/#ayuda" }); return res.end() }
    // ── linker unificado multi-cuenta vía bridges Matrix (server always-on) ──
    if (path === "/guia") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      const G = (id, title, badge, steps, note) => `<div class="g" id="${id}"><div class="g-h"><b>${title}</b><span class="badge ${badge.cls}">${badge.txt}</span></div><ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>${note ? `<div class="note">${note}</div>` : ""}</div>`
      return res.end(`<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Guía de integraciones — pipe.one</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--ink:#15151f;--muted:#8a8a97;--muted2:#a9a9b6;--line:#ececf0;--accent:#6366f1;--ok:#16a34a;--warn:#e0662f}
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:22px 16px 60px;-webkit-font-smoothing:antialiased;line-height:1.5}
.wrap{max-width:560px;margin:0 auto}
.kick{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:var(--accent)}
h1{font-size:26px;font-weight:800;letter-spacing:-.5px;margin:6px 0 4px}.sub{color:var(--muted);font-size:13.5px;margin:0 0 18px}
a{color:var(--accent)}
.g{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:13px;box-shadow:0 1px 3px rgba(20,20,50,.05);scroll-margin-top:16px}
.g-h{display:flex;align-items:center;gap:10px;margin-bottom:6px}.g-h b{font-size:16px;font-weight:700;flex:1}
.badge{font-size:10.5px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.03em}
.badge.one{background:rgba(22,163,74,.12);color:var(--ok)}.badge.srv{background:rgba(99,102,241,.12);color:var(--accent)}
ol{margin:8px 0 0;padding-left:20px;font-size:14px}li{margin:5px 0}
code{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace}
.note{margin-top:10px;font-size:12.5px;color:var(--muted);background:var(--bg);border-radius:10px;padding:9px 12px}
.back{display:inline-block;margin-bottom:14px;font-size:13px;font-weight:600}
</style><body><div class="wrap">
<a class="back" href="/link">← Conexiones</a>
<div class="kick">Guía</div><h1>Conectar integraciones</h1>
<p class="sub">Paso a paso para cada fuente. Las marcadas <span class="badge one">1 clic</span> se hacen desde la app; las <span class="badge srv">server</span> necesitan una acción en el servidor del hub.</p>
${G("email", "Correo — Gmail (1 clic)", { cls: "one", txt: "1 clic" }, ["Andá a <b>Ajustes → Cuentas de correo</b>.", "Tocá <b>Conectar Gmail — Permitir acceso</b> y aceptá en la pantalla de Google.", "Listo: empieza a traer correos en segundos."], "Requiere que el hub tenga configurado su Client ID/Secret de Google. Si no aparece, usá IMAP (abajo).")}
${G("email-imap", "Correo — IMAP (Gmail u otro con contraseña de aplicación)", { cls: "one", txt: "1 clic" }, ["En Google: <b>Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones</b> y generá una (16 letras).", "En <b>Ajustes → Cuentas de correo → Otra cuenta (IMAP)</b>, pegá tu correo + esa contraseña.", "El servidor IMAP se completa solo para Gmail/Outlook/Zoho."])}
${G("whatsapp", "WhatsApp · Instagram · Messenger · Discord", { cls: "one", txt: "1 clic" }, ["Abrí <b><a href='/link'>Conexiones</a></b> y elegí la red.", "Tocá <b>+ Agregar cuenta</b> y pegá el número (o pedí QR).", "Desde el teléfono de esa cuenta: <b>Dispositivos vinculados → Vincular</b>, y escaneá el QR o poné el código.", "Podés agregar varias cuentas por red."], "Corre sobre bridges Matrix en el server (always-on): una vez vinculado, no hay que re-escanear.")}
${G("teams", "Microsoft 365 — Outlook · Teams · SharePoint/OneDrive", { cls: "srv", txt: "server" }, ["En el server del hub, corré <code>node src/teams.mjs</code> (o <code>node src/mail-outlook.mjs</code>).", "Aparece un <b>código</b>. Abrí <a href='https://microsoft.com/devicelogin' target='_blank'>microsoft.com/devicelogin</a> y pegalo.", "Iniciá sesión con tu cuenta Microsoft y aceptá los permisos.", "Un solo login cubre Outlook + Teams + SharePoint/OneDrive (comparten sesión)."], "En la versión gestionada de pipe.one esto es un botón OAuth; en el self-host es este device-code una sola vez.")}
${G("google", "Google — Calendar y Drive", { cls: "srv", txt: "server" }, ["En el server, corré <code>node src/google-auth.mjs ventas tu@gmail.com</code>.", "Se imprime un <b>link de autorización</b>: abrilo, elegí esa cuenta y aceptá.", "Queda guardado el token (Calendar + Drive) y empieza a sincronizar."], "Gmail (correo) se conecta aparte con el botón de 1 clic de arriba.")}
${G("telegram", "Telegram", { cls: "srv", txt: "server" }, ["Sacá <b>TG_API_ID</b> y <b>TG_API_HASH</b> en <a href='https://my.telegram.org' target='_blank'>my.telegram.org → API development tools</a> y ponelos (con <code>TG_PHONE</code>) en el <code>.env</code> del hub.", "Corré <code>node src/telegram.mjs</code>.", "Telegram te manda un código: escribilo en <code>/tmp/tg_code</code> (y si tenés 2FA, la clave en <code>/tmp/tg_pass</code>).", "Queda la sesión en <code>auth/telegram.session</code>. Es <b>solo lectura</b> de tus chats."], "Para desconectar: botón ✕ en Conexiones (borra la sesión).")}
${G("notion", "Notion", { cls: "srv", txt: "server" }, ["Creá una integración interna en <a href='https://notion.so/my-integrations' target='_blank'>notion.so/my-integrations</a> y copiá el <b>Internal Integration Secret</b>.", "Poné <code>NOTION_TOKEN=...</code> en el <code>.env</code> del hub.", "En Notion, <b>compartí</b> las páginas/bases que querés leer <b>con la integración</b> (botón Compartir → tu integración).", "El token interno no expira."], "Para desconectar: quitá el <code>NOTION_TOKEN</code> del <code>.env</code> y quitá el acceso desde Notion.")}
</div></body></html>`)
    }
    if (path === "/link") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }) // nunca cachear: el estado de vinculación cambia
      return res.end(`<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Conectar mensajería — pipe.one</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--ink:#15151f;--muted:#8a8a97;--muted2:#a9a9b6;--line:#ececf0;--accent:#6366f1;--ok:#16a34a;--warn:#e0662f}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:22px 16px 44px;-webkit-font-smoothing:antialiased}
.wrap{max-width:480px;margin:0 auto}
.kick{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:var(--accent)}
h1{font-size:26px;font-weight:800;letter-spacing:-.5px;margin:6px 0 4px}
.sub{color:var(--muted);font-size:13.5px;margin:0 0 18px;line-height:1.5}
.net{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 15px;margin-bottom:11px;box-shadow:0 1px 3px rgba(20,20,50,.05)}
.net-h{display:flex;align-items:center;gap:12px}
.net-ic{width:38px;height:38px;flex:none;display:grid;place-items:center;border-radius:11px;background:rgba(99,102,241,.1);color:var(--accent)}
.net-ic svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.net-h b{font-size:15.5px;font-weight:650;flex:1}
.net-cnt{font-size:12px;color:var(--ok);font-weight:600;display:flex;align-items:center;gap:5px}
.net-cnt .d{width:7px;height:7px;border-radius:50%;background:var(--ok)}
.accts{margin-top:11px;display:flex;flex-direction:column;gap:6px}
.acct{background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.2);border-radius:10px;padding:8px 11px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
.acct .d{width:7px;height:7px;border-radius:50%;background:var(--ok);flex:none}
.acct small{color:var(--muted);font-weight:500}
details{margin-top:11px}
summary{cursor:pointer;color:var(--accent);font-weight:600;font-size:14px;list-style:none;display:inline-flex;align-items:center;gap:6px}
summary::-webkit-details-marker{display:none}
.inp{width:100%;box-sizing:border-box;padding:11px 13px;border-radius:11px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:14.5px;margin-top:8px;outline:none}
.inp:focus{border-color:var(--accent)}
.btn{padding:11px;border:0;border-radius:11px;background:linear-gradient(135deg,var(--accent),#8b5cf6);color:#fff;font-weight:700;font-size:14px;cursor:pointer}
.btn.g{background:var(--bg);color:var(--ink);border:1px solid var(--line)}
.soon{color:var(--muted2);font-size:12.5px;margin-top:9px}
.sect{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:20px 2px 9px}
.row{display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:10px 13px;font-size:14px;margin-bottom:6px}
.row .rn{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .rr{display:inline-flex;align-items:center;gap:10px;flex:none}
.row .st{font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px}
.row .st .d{width:7px;height:7px;border-radius:50%}
.glink{font-size:12.5px;font-weight:600;color:var(--accent);text-decoration:none;white-space:nowrap}
.rmx{border:0;background:var(--bg);color:var(--muted2);width:24px;height:24px;border-radius:50%;font-size:12px;cursor:pointer;flex:none}
.rmx:hover{color:var(--warn)}
.sect-a{float:right;font-size:12px;font-weight:600;color:var(--accent);text-decoration:none;text-transform:none;letter-spacing:0}
.code{font-size:30px;font-weight:800;letter-spacing:5px;color:var(--accent);margin:8px 0;text-align:center}
.hint{font-size:12px;color:var(--muted);text-align:center}
</style>
<body><div class="wrap">
<div class="kick">Conectar</div><h1>Mensajería</h1>
<p class="sub">Bridges Matrix en el server (always-on). Podés agregar varias cuentas por red — seguí el código o QR desde el teléfono de esa cuenta.</p>
<div id="nets"></div>
<div id="status"></div>
</div>
<script>
const ENABLED=${JSON.stringify(enabledChannels())};
const IC={
 whatsapp:'<svg viewBox="0 0 24 24"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1.5-4.5A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1-1.2 1.7.8M9 9.5l-.8-.2-.7.6c-.2 1 .3 2 .3 2"/></svg>',
 instagram:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.5"/><path d="M17 7h.01"/></svg>',
 facebook:'<svg viewBox="0 0 24 24"><path d="M12 3.5a8.2 7.7 0 1 0 3.3 14.8L20 20l-1.2-3.7A7.7 7.7 0 0 0 12 3.5Z"/><path d="m7.5 13 3-3 2.3 1.8L16 9"/></svg>',
 telegram:'<svg viewBox="0 0 24 24"><path d="M21 4 3 11l5 2 1.5 5.5 3-3.5 4.5 3.5L21 4Z"/><path d="m8 13 8-5"/></svg>',
 linkedin:'<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 10.5v6M8 7.5v.01M11.5 16.5v-3.5a2 2 0 0 1 4 0v3.5"/></svg>',
 discord:'<svg viewBox="0 0 24 24"><path d="M8 6.5h8a3 3 0 0 1 3 3v5l-3-2H8a3 3 0 0 1-3-3v-0a3 3 0 0 1 3-3Z"/><path d="M10 12h.01M14 12h.01"/></svg>'
};
const NETS=[["whatsapp","WhatsApp",true],["instagram","Instagram",true],["facebook","Messenger",true],["telegram","Telegram",false],["linkedin","LinkedIn",false],["discord","Discord",true]].filter(([n])=>!ENABLED||ENABLED.includes(n));
const box=document.getElementById('nets');
box.innerHTML=NETS.map(([n,label,ready])=>\`<div class="net">
  <div class="net-h"><span class="net-ic">\${IC[n]||''}</span><b>\${label}</b><span class="net-cnt" id="cnt-\${n}"></span></div>
  <div class="accts" id="accts-\${n}"></div>
  \${ready?\`<details><summary>+ Agregar cuenta</summary>
    <div>
      <input id="ph-\${n}" class="inp" placeholder="+51 999 000 000 (con código de país)">
      <div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="link('\${n}',true)" class="btn" style="flex:1">Código por número</button>
        <button onclick="link('\${n}',false)" class="btn g" style="flex:1">QR</button>
      </div>\${n==='discord'?'<div style="margin-top:9px"><div class="soon" style="margin-bottom:5px">El QR de Discord suele fallar. Método confiable: pegá tu <b>token</b> (discord.com web → F12 → Network → cualquier request → header <b>authorization</b>).</div><textarea id="tok-discord" rows="2" placeholder="Pegá tu token de Discord acá" class="inp" style="resize:none;margin-top:0"></textarea><button onclick="linkToken()" class="btn" style="width:100%;margin-top:7px">Vincular con token</button></div>':''}<div id="out-\${n}" style="margin-top:12px;text-align:center"></div>
    </div></details>\`:'<div class="soon">Próximamente (bridge pendiente en el server)</div>'}</div>\`).join('');
function acctRow(a,extra){return '<div class="acct"><span class="d"></span>+'+a+(extra?' <small>'+extra+'</small>':'')+'</div>';}
async function refresh(n){
  const {accounts}=await (await fetch('/api/matrix-logins?net='+n+'&refresh=1')).json();
  const b=document.getElementById('accts-'+n),cnt=document.getElementById('cnt-'+n);
  cnt.innerHTML=accounts.length?('<span class="d"></span>'+accounts.length+(accounts.length>1?' cuentas':' cuenta')):'';
  b.innerHTML=accounts.map(a=>acctRow(a)).join('');
  setTimeout(async()=>{const r=await(await fetch('/api/matrix-logins?net='+n)).json();if(r.accounts.length!==accounts.length)refresh(n);},3000);
}
async function link(n,phone){
  const v=phone?document.getElementById('ph-'+n).value:'';
  const url='/api/matrix-link?net='+n+(phone?'&phone='+encodeURIComponent(v):'');
  document.getElementById('out-'+n).innerHTML='<span class="hint">Generando…</span>';
  await fetch(url,{method:'POST'}); poll(n);
}
async function linkToken(){
  const t=document.getElementById('tok-discord').value.trim();
  if(!t){document.getElementById('out-discord').innerHTML='<span class="hint">Pegá el token primero</span>';return;}
  document.getElementById('out-discord').innerHTML='<span class="hint">Vinculando…</span>';
  await fetch('/api/matrix-link-token?net=discord',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})});
  poll('discord');
}
async function poll(n){
  const {connected,code,qr}=await (await fetch('/api/matrix-status?net='+n)).json();
  const o=document.getElementById('out-'+n);
  if(connected){o.innerHTML='<b style="color:var(--ok)">✓ ¡Conectada!</b>';refresh(n);return;}
  let h='';
  if(code)h+='<div class="hint">App → Dispositivos vinculados → Vincular con número:</div><div class="code">'+code+'</div>';
  if(qr)h+='<img src="/api/matrix-qr?net='+n+'&t='+Date.now()+'" style="width:220px;height:220px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px">';
  if(!code&&!qr)h+='<span class="hint">Generando el QR… puede tardar ~30s, no cierres esto.</span>';
  o.innerHTML=h; setTimeout(()=>poll(n),3000);
}
async function loadStatus(){
  const s=await (await fetch('/api/status')).json();
  if(s.whatsapp&&s.whatsapp.baileys&&s.whatsapp.baileys.length){
    const b=document.getElementById('accts-whatsapp');
    if(b)b.innerHTML+=s.whatsapp.baileys.map(x=>acctRow(x.num||x.acc,'Baileys (Mac)')).join('');
    const cnt=document.getElementById('cnt-whatsapp');const total=(s.whatsapp.bridge?s.whatsapp.bridge.length:0)+s.whatsapp.baileys.length;if(cnt)cnt.innerHTML='<span class="d"></span>'+total+' cuentas';
  }
  const esc=(s)=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const row=(e,otro)=>{const ago=e.last?Math.round((Date.now()-e.last)/3600000):0;const when=!e.last?'':(ago<48?ago+'h':Math.round(ago/24)+'d');const col=e.ok?'var(--ok)':'var(--warn)';
    const acts=otro?('<a class="glink" href="/guia#'+esc(e.guide||'')+'">Guía</a>'+(e.rm?'<button class="rmx" title="Desconectar" onclick="rmInt(\\''+esc(e.key)+'\\')">✕</button>':'')):'';
    return '<div class="row"><span class="rn">'+esc(e.name)+'</span><span class="rr"><span class="st" style="color:'+col+'"><span class="d" style="background:'+col+'"></span>'+(when||(e.ok?'ok':'—'))+'</span>'+acts+'</span></div>';};
  const addForm='<details><summary>+ Agregar Gmail</summary>'+
    '<div class="soon" style="margin-top:8px">Generá una <b>app-password</b> en Google → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones.</div>'+
    '<input id="em-user" class="inp" placeholder="correo@gmail.com">'+
    '<input id="em-pass" class="inp" placeholder="app-password (16 letras)">'+
    '<button onclick="addEmail()" class="btn" style="width:100%;margin-top:9px">Conectar correo</button>'+
    '<div id="em-out" style="margin-top:8px;font-size:13px;text-align:center"></div></details>';
  document.getElementById('status').innerHTML=
    '<div class="sect">Correos</div>'+s.email.map(e=>row(e)).join('')+'<div class="net" style="padding:12px 15px">'+addForm+'</div>'+
    '<div class="sect">Otras conexiones<a class="sect-a" href="/guia">Ver guías →</a></div>'+s.otros.map(e=>row(e,true)).join('');
}
async function rmInt(key){ if(!confirm('¿Desconectar '+key+'? Podés reconectarlo desde la guía.'))return; try{await fetch('/api/integration/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});}catch(e){} loadStatus(); }
async function addEmail(){
  const email=document.getElementById('em-user').value,pass=document.getElementById('em-pass').value;
  const out=document.getElementById('em-out');out.innerHTML='<span class="hint">Conectando…</span>';
  try{const r=await (await fetch('/api/add-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,pass})})).json();
    out.innerHTML=r.ok?'<b style="color:var(--ok)">✓ '+(r.msg||'agregado')+'</b> — bajando correos en unos segundos':'<span style="color:var(--warn)">'+(r.error||'error')+'</span>';
    if(r.ok&&!r.msg)setTimeout(loadStatus,5000);
  }catch(e){out.innerHTML='<span style="color:var(--warn)">'+e.message+'</span>';}
}
NETS.filter(x=>x[2]).forEach(([n])=>refresh(n));
loadStatus();setInterval(loadStatus,15000);
</script></body></html>`)
    }
    // ── página de vinculación de un WhatsApp (QR en vivo) ──
    if (path === "/wa") {
      const acc = ((url.searchParams.get("acc") || "wa2").replace(/[^a-z0-9]/gi, ""))
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      return res.end(`<!doctype html><html lang=es><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Vincular WhatsApp</title><body style="font-family:-apple-system,sans-serif;text-align:center;background:#f5f6f8;color:#1a1a2e;padding:24px;margin:0">
<h2 style="margin:8px 0">Vincular WhatsApp <small style="color:#6366f1">(${acc})</small></h2>
<p style="color:#7a7a8c;font-size:14px;margin:4px 0 16px">WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo</p>
<img id=q style="width:300px;height:300px;background:#fff;border-radius:16px;box-shadow:0 2px 12px #0001;padding:10px" src="/api/wa-qr?acc=${acc}">
<p id=s style="color:#7a7a8c;margin-top:16px;font-size:15px">🔄 el código se actualiza solo — escanealo</p>
<script>setInterval(()=>{document.getElementById('q').src='/api/wa-qr?acc=${acc}&t='+Date.now();
fetch('/api/wa-status?acc=${acc}').then(r=>r.json()).then(d=>{if(d.connected){document.getElementById('s').innerHTML='✅ <b>¡Conectado!</b> Ya podés cerrar esta página.';document.getElementById('q').style.opacity=.15}})},3000)</script></body></html>`)
    }
    // ── fotos de perfil (avatares) sincronizadas del bridge ──
    if (path.startsWith("/avatars/")) {
      const full = normalize(join(process.cwd(), "data", path))
      if (full.startsWith(join(process.cwd(), "data", "avatars")) && existsSync(full)) { res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "max-age=86400" }); return res.end(readFileSync(full)) }
      res.writeHead(404); return res.end()
    }
    // ── CAS: archivos dedupeados por contenido (una copia física, N referencias) → content-addressed = INMUTABLE ──
    if (path.startsWith("/cas/") || path.startsWith("/media/")) {
      const full = normalize(join(process.cwd(), "data", path))
      const okBase = full.startsWith(join(process.cwd(), "data", "cas")) || full.startsWith(join(process.cwd(), "data", "media"))
      if (!okBase || !existsSync(full)) { res.writeHead(404); return res.end() }
      // 🔒 el archivo se pide por RUTA, que no pasa por el gate por-hilo. Mismo 404 que si no existiera: un 403 confirmaría que sí.
      if (casSecreto(path, { secretOn })) { res.writeHead(404); return res.end() }
      return serveFile(req, res, full, MIME[extname(full)] || "application/octet-stream", "public, max-age=31536000, immutable")
    }
    // ── estáticos ──
    let file = path === "/" ? "/index.html" : path
    const full = normalize(join(process.cwd(), "public", file))
    if (!full.startsWith(join(process.cwd(), "public"))) { res.writeHead(403); return res.end("forbidden") }
    if (existsSync(full)) {
      const ext = extname(full)
      const st = statSync(full), etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`
      // shell (js/html/css) revalida con ETag → 304 si no cambió (no re-descarga); el resto se cachea 1 día
      const cc = /\.(html|js|css)$/.test(ext) ? "no-cache" : "public, max-age=86400"
      if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag, "Cache-Control": cc }); return res.end() }
      res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain", "Cache-Control": cc, ETag: etag })
      return res.end(readFileSync(full))
    }
    // SPA fallback
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" }); res.end(readFileSync(join(process.cwd(), "public", "index.html")))
  } catch (e) {
    // LOGUEAR, no solo responder. Antes esto devolvía el 500 en silencio: el usuario veía "database is locked" al
    // enviar y en los logs no quedaba NADA, así que era indiagnosticable. La ruta y el mensaje alcanzan.
    console.error(`[api] ${req.method} ${(req.url || "").split("?")[0]} → 500: ${e && e.message}`)
    json(res, 500, { error: e.message })
  }
})
// bind a localhost por defecto (host: el público entra por Caddy TLS+PIN, NO exponer :3000 crudo). En CONTAINER, HOST=0.0.0.0
// (necesario para el port-publish de Docker) — seguro porque el publish es a 127.0.0.1:<port> del host y Caddy sigue metiendo el XFF → gate de PIN.
// un reject/throw suelto NO debe tumbar el server HTTP (proceso de larga vida): logueamos y seguimos sirviendo (igual que el daemon).
process.on("unhandledRejection", (e) => console.error("💥 unhandledRejection:", e?.stack || e))
process.on("uncaughtException", (e) => console.error("💥 uncaughtException:", e?.stack || e))

// Si el puerto no se puede abrir, DECIRLO Y SALIR. Antes el error caía en el uncaughtException de arriba: el proceso seguía
// vivo, sin escuchar en ningún lado y sin más pista que una línea de stack — imposible de diagnosticar para quien recién instala.
server.on("error", (e) => {
  const host = process.env.HOST || "127.0.0.1"
  if (e.code === "EADDRINUSE") console.error(`\n❌ El puerto ${PORT} ya está ocupado. Cerrá el otro proceso o cambiá PORT en .env.\n`)
  else if (e.code === "EACCES") console.error(`\n❌ Sin permiso para abrir el puerto ${PORT}. Usá uno mayor a 1024 o dale permisos.\n`)
  else if (e.code === "ENOTFOUND" || e.code === "EADDRNOTAVAIL") console.error(`\n❌ HOST inválido: ${JSON.stringify(host)}\n   Revisá esa línea en .env (¿quedó un comentario pegado al valor?). Debería ser 127.0.0.1 o 0.0.0.0.\n`)
  else console.error(`\n❌ No pude abrir ${host}:${PORT} → ${e.code || e.message}\n`)
  process.exit(1)
})

// KEEP-ALIVE — la causa de los 502 esporádicos. Node cierra las conexiones inactivas a los 5s (su default) pero
// Caddy las reutiliza hasta 2 min: cuando Caddy manda un pedido por una conexión que Node acaba de cerrar, el
// proxy devuelve 502. Por eso aparecían en CUALQUIER endpoint, sin dejar rastro del lado del server (el pedido
// nunca llegaba a la app) y con el proceso perfectamente vivo. La regla es que el de arriba aguante MÁS que el
// de abajo: 185s > los 2 min de Caddy, y headersTimeout por encima de keepAliveTimeout.
server.keepAliveTimeout = Number(process.env.KEEPALIVE_MS || 185000)
server.headersTimeout = server.keepAliveTimeout + 5000

server.listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`\n🧠 pipe web → http://localhost:${PORT}\n`)
  try { maintenance.ensureStats(); maintenance.repararHistorias(); brain.listThreads({ limit: 600 }); setTimeout(() => { try { brain.coachData() } catch {} }, 2000) } catch (e) { console.error("warm:", e.message) } // auto-sanar stats + calentar bandeja + coach (para que Coach/IA abran instantáneo)
})
// mantenimiento periódico (ensureStats + fixGroupLeaks) MOVIDO al cron maintain.mjs del daemon → ya NO bloquea el event loop del
// HTTP (~3s cada 30 min). Acá queda solo el ensureStats del warm-up de arriba (una vez al boot, sin usuarios todavía = sin freeze).
setInterval(() => { try { brain.listThreads({ limit: 600 }); brain.coachData() } catch {} }, 4 * 60000) // mantener calientes bandeja + coach
// poda de los ids de envío ya usados (idempotencia): al arrancar y una vez por día. La tabla es chica, pero sin
// esto crece para siempre.
const podarEnvios = () => { try { const n = pruneSends(); if (n) console.log(`[outbox] ${n} ids de envío viejos podados`) } catch (e) { console.error("[outbox] poda:", e.message) } }
setTimeout(podarEnvios, 30000)
setInterval(podarEnvios, 24 * 3600000)
