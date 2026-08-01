// pipe — SPA mobile-first. Rediseño estilo iOS/Jarvis. Router por hash + vistas + orb (voz/texto).
const app = document.getElementById("app")
let _reauthChecking = false
const api = async (p, opts) => {
  try {
    const r = await fetch(p, opts)
    if (r.status === 401) {
      // NO recargar a ciegas: un 401 transitorio (refresh de fondo, red inestable) tiraba la PWA al start_url "/" = Home,
      // perdiendo el #hash. Solo forzamos re-login si la sesión está REALMENTE muerta.
      if (!_reauthChecking) { _reauthChecking = true; try { const s = await fetch("/api/auth/status").then((x) => x.json()).catch(() => null); if (s && s.authed === false) { location.reload(); return null } } finally { _reauthChecking = false } }
      return null
    }
    return await r.json()
  } catch { return null }
}
const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
// corrección ortográfica del navegador en el composer — OFF por defecto (no todos la quieren; con las líneas rojas se tipea más lento). Toggle con el botón "Aa".
let _spell = localStorage.getItem("spellcheck") === "1"
let _aiSearch = false // robotito: búsqueda con IA (Jarvis) en la bandeja — opt-in, no obligatorio
window.toggleSpell = () => {
  _spell = !_spell; try { localStorage.setItem("spellcheck", _spell ? "1" : "0") } catch {}
  const inp = document.getElementById("msgInput")
  if (inp) { inp.spellcheck = _spell; const s = inp.selectionStart; inp.blur(); inp.focus(); try { inp.setSelectionRange(s, s) } catch {} } // re-focus: el navegador aplica el cambio al re-enfocar
  const b = document.getElementById("spellBtn"); if (b) { b.style.background = _spell ? "var(--accent)" : "var(--bg2)"; b.style.color = _spell ? "#fff" : "" }
}
// ── cache-first (SWR): última respuesta por URL en localStorage → apertura instantánea, revalida en bg ──
const _lsGet = (k) => { try { return JSON.parse(localStorage.getItem("c:" + k) || "null") } catch { return null } }
const _lsSet = (k, v) => { try { localStorage.setItem("c:" + k, JSON.stringify(v)) } catch {} }
// ── CACHE PERSISTENTE (IndexedDB): guarda la HISTORIA COMPLETA de cada chat en el disco del navegador. De la red baja solo el
// DELTA (mensajes con rev > el que ya tengo). Así los mensajes viejos NO se re-descargan nunca — abrir es instantáneo y offline. ──
let _idbP
function _idb() {
  if (_idbP) return _idbP
  _idbP = new Promise((res, rej) => {
    let r; try { r = indexedDB.open("pipe", 1) } catch (e) { return rej(e) }
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains("msgs")) db.createObjectStore("msgs", { keyPath: ["t", "id"] }).createIndex("t", "t"); if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "t" }) }
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  return _idbP
}
const _idbReq = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
const _txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error) })
async function idbLoad(key) { // → { items:[ordenados por ts], meta }
  try {
    const db = await _idb()
    const items = (await _idbReq(db.transaction("msgs").objectStore("msgs").index("t").getAll(IDBKeyRange.only(key)))) || []
    const meta = await _idbReq(db.transaction("meta").objectStore("meta").get(key))
    items.sort((a, b) => (a.ts || 0) - (b.ts || 0))
    return { items, meta: meta || null }
  } catch { return { items: [], meta: null } }
}
async function idbSave(key, items, metaPatch) { // upsert de items (por id) + patch de la metadata del hilo
  try {
    const db = await _idb()
    const real = (items || []).filter((it) => it && it.id && !String(it.id).startsWith("opt-")) // los optimistas no se persisten
    if (real.length) { const tx = db.transaction("msgs", "readwrite"); const st = tx.objectStore("msgs"); for (const it of real) st.put({ ...it, t: key }); await _txDone(tx) }
    if (metaPatch) { const cur = (await _idbReq(db.transaction("meta").objectStore("meta").get(key))) || { t: key }; const tx = db.transaction("meta", "readwrite"); tx.objectStore("meta").put({ ...cur, ...metaPatch, t: key }); await _txDone(tx) }
  } catch {}
}
// identidad del hub (config por-hub) — cache local + default GENÉRICO (nunca la identidad de otro hub);
// se refresca al arrancar desde /api/hub-config. El default usa el dominio actual → un hub nuevo no ve datos ajenos.
window.__hub = _lsGet("hub") || { ownerName: "", ownerFirst: "", company: "", domain: location.host }
const hubName = () => (window.__hub && window.__hub.ownerName) || "tu hub"
const hubFirst = () => (window.__hub && window.__hub.ownerFirst) || "vos"
// apiSWR(url, paint): pinta la cache al toque (si hay) y re-pinta con la red. Usa el prefetch del <head> si existe (1ra vez).
async function apiSWR(url, paint) {
  const startHash = location.hash // si el usuario navega a otra pantalla mientras esto carga, NO pintar (tiraba a Home en cold-load: /api/home resolvía tarde y pisaba el chat abierto)
  const cached = _lsGet(url); let painted = false
  if (cached != null) { try { paint(cached); painted = true } catch {} }
  const boot = window.__boot && window.__boot[url]; if (boot) delete window.__boot[url]
  const fresh = await (boot || api(url)).catch(() => null)
  if (fresh != null) _lsSet(url, fresh) // siempre cacheá lo fresco para la próxima
  if (location.hash !== startHash) return // navegaste a otra pantalla → no pises lo que estás viendo
  if (fresh != null) { try { paint(fresh) } catch {} }
  else if (!painted) { try { paint(null) } catch {} }
}
// badge de no-leídos en el ícono de la app (PWA/TWA)
function setAppBadge(n) { try { if ("setAppBadge" in navigator) { n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge() } } catch {} }
// escapa TAMBIÉN comilla simple y backtick: la UI usa handlers inline onclick='...' → un nombre de contacto con ' rompía el atributo e inyectaba JS (XSS almacenado).
const esc = (s) => (s || "").replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c]))
// enck: encodeURIComponent + escapa ! ' ( ) * ~ (que encodeURIComponent NO escapa) → seguro dentro de onclick="fn('...')" . Los consumidores hacen decodeURIComponent → transparente. (fix XSS P1)
const enck = (x) => encodeURIComponent(String(x == null ? "" : x)).replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
// escj: valor SEGURO dentro de onclick="..." o onclick='...'. JSON.stringify pone las comillas de la string JS; esc escapa & → ninguna
// entidad HTML (&quot;, &#34;…) puede decodificarse a un delimitador y salirse de la string. Es el idioma correcto para JS-en-atributo
// (esc() SOLO es un no-op contra XSS ahí: la decodificación de entidades corre ANTES que el parser JS y deshace el escape).
const escj = (x) => esc(JSON.stringify(x == null ? "" : x))
const $ = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild }
const PAL = ["#c98d7f", "#c9a06a", "#7d7da6", "#8bb0a2", "#a98bb0", "#7fa9c4", "#c4a07f", "#9db07f"]
const color = (n) => PAL[[...(n || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % PAL.length]
const initials = (n) => (n || "?").replace(/[·].*/, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase()
const CH = { whatsapp: "WhatsApp", email: "Email", teams: "Teams", telegram: "Telegram", notion: "Notion", calendar: "Calendar", discord: "Discord", instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok" }
function ago(ts) { if (!ts) return ""; const d = new Date(ts), n = new Date(); const day = 864e5
  if (d.toDateString() === n.toDateString()) return d.toTimeString().slice(0, 5)
  if (n - d < 2 * day) return "Ayer"; if (n - d < 7 * day) return ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][d.getDay()]
  return d.toLocaleDateString("es", { day: "numeric", month: "short" }) }
// avatar con foto LAZY: muestra iniciales al toque y la foto entra cuando carga (loading=lazy → no baja las de fuera de pantalla)
function avatar(name, photo, cls = "") {
  if (photo) return `<div class="av ${cls}" style="background:${color(name)}">${esc(initials(name))}<img src="${photo}" loading="lazy" decoding="async" alt="" onload="this.style.opacity=1" onerror="this.remove()"></div>`
  return `<div class="av ${cls}" style="background:${color(name)}">${esc(initials(name))}</div>` }
const ORB = `<div class="dot"></div>`
const ORB2 = (t) => `<div class="row" style="justify-content:center;gap:8px">${ORB}<span class="sb">${t}</span></div>`
const SVG = { chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 16 0Z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  coach: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m15 9-3.5 1.5L10 14l3.5-1.5Z"/></svg>',
  target: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="4"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h4"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M4 6h11M18 6h2M4 12h2M9 12h11M4 18h11M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' }
// iconografía de canales (color de marca + glifo blanco) — se muestran al lado del nombre en la bandeja
const CHAN_ICON = {
  whatsapp: ["#25d366", '<path d="M12 3.4a8.6 8.6 0 0 0-7.4 13l-1.1 4 4.1-1.1A8.6 8.6 0 1 0 12 3.4Zm4.7 11.7c-.2.6-1.1 1.1-1.6 1.1-.4 0-.9.1-2.8-.7-2.3-1-3.8-3.5-3.9-3.6-.1-.1-.9-1.2-.9-2.3s.6-1.7.8-1.9c.2-.2.4-.3.6-.3h.5c.2 0 .3 0 .5.4l.7 1.7c0 .1.1.3 0 .4l-.4.5c-.1.2-.3.3-.1.6.1.2.6 1 1.3 1.7.9.8 1.6 1 1.8 1.1.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.5.8c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z"/>'],
  telegram: ["#37aee2", '<path d="M21.5 4.3 2.8 11.5c-.8.3-.7 1.3.1 1.5l4.6 1.4 1.7 5.6c.2.6 1 .7 1.4.2l2.5-2.6 4.8 3.5c.5.4 1.2.1 1.4-.5l3-14.7c.1-.7-.6-1.3-1.3-1.1ZM10 14.3l-.2 3.3-1.3-4.2 9.2-5.8L10 14.3Z"/>'],
  email: ["#ef4444", '<path d="M4 4.5h16c.6 0 1 .4 1 1V18c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V5.5c0-.6.4-1 1-1Zm.4 2.1L12 12l7.6-5.4v-.1H4.4v.1Z"/>'],
  instagram: ["#e1306c", '<path d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm4 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 1.8a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Zm4.7-2.9a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/>'],
  facebook: ["#1877f2", '<path d="M13.4 21v-7h2.2l.4-2.7h-2.6V9.4c0-.8.2-1.3 1.3-1.3h1.4V5.7c-.3 0-1.1-.1-2-.1-2 0-3.3 1.2-3.3 3.4v1.9H8.3V14h2.4v7h2.7Z"/>'],
  teams: ["#5b5fc7", '<path d="M9 4.5a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8ZM4 10.5h7.2v5.7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5.7Zm12-1.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-3.3 1.3H20v4.2a2.5 2.5 0 0 1-2.5 2.5h-.8c.1-.4.1-.8.1-1.3v-5.4Z"/>'],
  linkedin: ["#0a66c2", '<path d="M6.5 8.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM5 10h3v9.5H5V10Zm5 0h2.9v1.3c.4-.7 1.4-1.6 3-1.6 3.1 0 3.6 2 3.6 4.6v5.2h-3v-4.6c0-1.1 0-2.5-1.5-2.5s-1.7 1.2-1.7 2.4v4.7h-3V10Z"/>'],
  notion: ["#111827", '<path d="M5 4h9.5L19 8.5V20H5V4Zm8.5 1.2v3.8h3.8L13.5 5.2ZM7.5 11h9v1.3h-9V11Zm0 3h9v1.3h-9V14Z"/>'],
  meeting: ["#7c3aed", '<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0h1.8a7.8 7.8 0 0 1-6.8 7.7V21h-2v-2.3A7.8 7.8 0 0 1 4.2 11H6Z"/>'],
  calendar: ["#6366f1", '<path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 5h16M8 3v4M16 3v4"/>'],
}
const chanIcon = (ch) => { const m = CHAN_ICON[ch]; return m ? `<span class="ci" style="background:${m[0]}"><svg viewBox="0 0 24 24" width="11" height="11">${m[1]}</svg></span>` : "" }
const espIcon = (ic) => (String(ic || "").trim().split(/\s+/)[0] || "🗂") // el usuario a veces mete texto en el campo icono → solo el 1er emoji
const chanLabel = { whatsapp: "WhatsApp", email: "Email", telegram: "Telegram", instagram: "Instagram", facebook: "Facebook", teams: "Teams", linkedin: "LinkedIn", notion: "Notion", meeting: "Reuniones", calendar: "Calendar" }

let ST = { tab: "home", filter: "todo" }
// App NATIVA (Capacitor): detecta el contenedor nativo (o ?native=1). Hoy la app nativa tiene TODAS las pestañas, igual que la web.
const NATIVE = (() => { try { return !!(window.Capacitor && (typeof window.Capacitor.isNativePlatform === "function" ? window.Capacitor.isNativePlatform() : true)) || /[?&]native=1/.test(location.search) } catch { return false } })()
function nav() {
  // <a href> real (routing es hash-based → Enter/teclado funciona nativo) + aria-current en el activo. onclick=go se queda para "click en tab activo = refrescar".
  const item = (tab, icon, label, hash) => `<a class="${ST.tab === tab ? "on" : ""}" href="${hash}"${ST.tab === tab ? ' aria-current="page"' : ""} onclick="go('${hash}')">${icon}<span>${label}</span></a>`
  return `<nav class="nav" aria-label="Principal">
    ${item("mensajes", SVG.chat, "Mensajes", "#mensajes")}
    ${item("calendario", SVG.cal, "Calendario", "#calendario")}
    <a class="center${ST.tab === "home" ? " on" : ""}" href="#home"${ST.tab === "home" ? ' aria-current="page"' : ""} onclick="go('#home')" aria-label="Inicio"><div class="orb">${SVG.home}</div></a>
    ${item("proactivo", SVG.spark, "Radar", "#proactivo")}
    ${item("notas", SVG.notes, "Notas", "#notas")}
  </nav>`
}
// A11Y: hace operables por TECLADO todos los [onclick] no-nativos (divs/spans clickeables) sin cambiar su layout — tabindex+role=button.
// Layout-safe (no convierte a <button>, que cambiaría display/estilos en ~59 sitios). Se corre tras cada render y en cada sheet.
function a11yUpgrade(root) {
  if (!root) return
  root.querySelectorAll("[onclick]").forEach((el) => {
    if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL)$/.test(el.tagName)) return
    if (el.querySelector("a,button,input,select,textarea,[onclick]")) return // interactivos anidados → no lo hago button (evita ARIA inválido)
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0")
    if (!el.getAttribute("role")) el.setAttribute("role", "button")
  })
}
function render(html, tab) { document.getElementById("schedChip")?.remove(); clearInterval(window._convPoll); ST.tab = tab || ST.tab; app.innerHTML = html + nav(); a11yUpgrade(app) }
// gesto de swipe HORIZONTAL (para cambiar de tab/fecha). Ignora el scroll vertical (exige dx dominante).
function onSwipe(el, onLeft, onRight) {
  if (!el) return
  let x0 = 0, y0 = 0, t0 = 0
  el.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now() }, { passive: true })
  el.addEventListener("touchend", (e) => { const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0
    if (Date.now() - t0 < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) (dx < 0 ? onLeft : onRight)?.() }, { passive: true })
}
window.growComposer = (el) => { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px" }
const skel = (n = 4) => `<div class="screen">${'<div class="skel"></div>'.repeat(n)}</div>`
window.go = (h) => { if (location.hash === h) route(); else location.hash = h } // click en el tab actual = refrescar (traer lo nuevo)

// ══════════ HOME (reimaginada, todo dinámico desde el snapshot del cron) ══════════
async function viewHome() { render(skel(6), "home"); apiSWR("/api/home", (r) => paintHome(r || {})) }
function paintHome(d) {
  const hr = new Date().getHours(), saludo = hr < 12 ? "Buenos días" : hr < 19 ? "Buenas tardes" : "Buenas noches"
  const fecha = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()
  window.__home = d
  const b = d.brief || {}, kpis = d.kpis || [], news = d.news || [], ag = d.agenda || [], coach = d.coach
  const _wd = _lsGet("waitDone") || {}
  const wdKeys = _wd.gen === d.generatedAt ? new Set(_wd.keys || []) : new Set() // descartados de ESTE snapshot (se resetean al regenerar)
  const waiting = (d.waiting || []).filter((w) => !wdKeys.has(w.key)); d.waiting = waiting // reasignar → los índices de _wait() coinciden con lo pintado
  const calls = d.calls || [], todos = d.todos || [], promesas = d.promesas || [], objetivos = d.objetivos || []
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s

  const briefCard = b.text ? `<div class="hb-brief"><div class="hb-brief-glow"></div>
      <div class="hb-eyebrow"><span>✦</span>Tu día en breve</div>
      <div class="hb-brief-txt">${esc(b.text)}</div>
      ${b.audioSec ? `<div class="hb-brief-row"><button class="hb-listen" onclick="playHomeAudio(this)">▶ Escuchar · ${mmss(b.audioSec)}</button><div class="hb-wave">${"<i></i>".repeat(7)}</div></div>` : ""}
    </div>` : ""

  // barra Jarvis (IA REACTIVA: vos preguntás). Se diferencia del Radar (IA PROACTIVA: ella te avisa).
  const askBar = `<div style="font-weight:700;font-size:13px;margin:0 0 5px;display:flex;align-items:center;gap:6px">🧠 Jarvis <span style="font-weight:400;color:var(--muted);font-size:12px">— preguntale lo que sea sobre tus datos</span></div>
    <div class="hb-ask"><input id="askq" placeholder="ej: ¿quién me debe? · resumime a Juan · ¿qué quedó con X?" onkeydown="if(event.key==='Enter')askBrain()"><button onclick="askBrain()" aria-label="Preguntar">⌕</button></div>
    <div id="askOut"></div>`

  // NECESITAN RESPUESTA (reemplaza el foco único): pila accionable de todos los que te escribieron y no respondiste
  const waitCard = waiting.length ? `<div class="hb-card"><div class="hb-card-head"><div class="hb-card-title">↩️ Necesitan respuesta <span class="hb-badge">${waiting.length}</span></div></div>
      ${waiting.map((w, i) => `<div class="hb-wait" id="wait-${i}">
        <div class="hb-wait-top">${avatar(w.name, w.photo)}<div style="flex:1;min-width:0"><div class="hb-wait-name">${esc(w.name)}${w.work ? '<span class="hb-tag">trabajo</span>' : ""}<span class="hb-wait-when">· ${esc(w.reason)}</span></div><div class="hb-wait-prev">${esc(w.preview || "")}</div></div></div>
        <div class="hb-wait-acts"><button onclick="waitReply(${i})">✍️ Responder</button><button onclick="draftFor(${i})">✨ Borrador IA</button><button onclick="waitDone(${i})">✓ Listo</button></div>
      </div>`).join("")}</div>` : ""

  // LLAMADAS de WhatsApp (24h)
  const callsCard = calls.length ? `<div class="hb-card"><div class="hb-card-head"><div class="hb-card-title">📞 Llamadas <span class="hb-badge">${calls.length}</span></div></div>
      ${calls.map((c) => `<div class="hb-band-row" onclick="go('#conv/${enck(c.key)}')">${avatar(c.name, null)}<div style="flex:1;min-width:0"><div class="hb-band-name">${esc(c.name)}</div><div class="hb-band-prev">${c.missed ? "Llamada perdida" : "Te llamó"}${c.n > 1 ? ` · ${c.n}×` : ""} · ${ago(c.ts)}</div></div><span class="hb-callret">Devolver</span></div>`).join("")}</div>` : ""

  // POR HACER (to-dos extraídos de tus conversaciones)
  const actRow = (kind, a) => `<div class="hb-act" id="act-${kind}-${a.id}"><button class="hb-act-chk" onclick="actDone('${kind}','${a.id}')" aria-label="Hecho"></button><div style="flex:1;min-width:0"><div class="hb-act-txt">${esc(a.text)}</div><div class="hb-act-sub">${esc(a.name || "")}${a.due ? ` · ${esc(a.due)}` : ""}</div></div>${a.thread ? `<span class="hb-link" onclick="go('#conv/${enck(a.thread)}')">ver</span>` : ""}</div>`
  const todosCard = todos.length ? `<div class="hb-card"><div class="hb-card-head"><div class="hb-card-title">✅ Por hacer <span class="hb-badge">${todos.length}</span></div></div>${todos.map((t) => actRow("todo", t)).join("")}</div>` : ""
  const promCard = promesas.length ? `<div class="hb-card"><div class="hb-card-head"><div class="hb-card-title">🤝 Prometiste <span class="hb-badge">${promesas.length}</span></div></div>${promesas.map((p) => actRow("prom", p)).join("")}</div>` : ""

  // TUS OBJETIVOS (ata la Home a tus metas)
  const HZ = { corto: "Corto", mediano: "Mediano", largo: "Largo", familiar: "Familia" }
  const objCard = objetivos.length ? `<div class="hb-card"><div class="spread hb-card-head"><div class="hb-card-title">🎯 Tus objetivos</div><span class="hb-link" onclick="go('#objetivos')">Ver</span></div>
      ${objetivos.map((o) => { const pc = (o.progress != null && o.target) ? Math.min(100, Math.round(o.progress / o.target * 100)) : null
        return `<div class="hb-obj" onclick="go('#objetivos')"><div style="flex:1;min-width:0"><div class="hb-obj-title">${esc(o.title || "")}</div>${o.next ? `<div class="hb-obj-next">→ ${esc(o.next)}</div>` : ""}</div>${o.horizon ? `<span class="hb-obj-hz">${HZ[o.horizon] || o.horizon}</span>` : ""}${pc != null ? `<span class="hb-obj-pc">${pc}%</span>` : ""}</div>` }).join("")}</div>` : ""

  const agCard = `<div class="hb-card"><div class="spread hb-card-head"><div class="hb-card-title">📅 Agenda de hoy</div><span class="hb-link" onclick="go('#calendario')">Ver semana</span></div>
      ${ag.length ? ag.map((e) => `<div class="hb-ag-row"><div class="hb-ag-time"><b>${e.time}</b>${e.dur ? `<span>${e.dur}</span>` : ""}</div><div style="flex:1"><div class="hb-ag-title">${esc(e.title)}</div>${e.sub ? `<div class="hb-ag-sub">${esc(e.sub)}</div>` : ""}</div></div>`).join("") : `<div class="hb-empty">Sin eventos hoy 🎉</div>`}</div>`

  const kpiCard = (k) => { const up = k.delta > 0, good = k.delta == null ? true : (up === k.goodUp)
    const arrow = k.delta == null ? "" : `<span class="hb-kpi-delta ${good ? "good" : "bad"}">${up ? "▲" : "▼"} ${Math.abs(k.delta)}%</span>`
    return `<div class="hb-kpi"><div class="hb-kpi-cat">${k.cat}</div><div class="hb-kpi-label">${esc(k.label)}</div><div class="hb-kpi-val">${esc(k.value)} ${arrow}</div><div class="hb-kpi-bar"><i style="width:${k.pct || 0}%;background:${good ? "var(--accent)" : "#e0553e"}"></i></div></div>` }
  const kpisBlock = kpis.length ? `<div class="hb-section-title" style="cursor:pointer" onclick="go('#objetivos')">📊 Tus KPIs<span class="hb-link" style="margin-left:auto;font-weight:700">Configurar ›</span></div><div class="hb-kpis" onclick="go('#objetivos')" style="cursor:pointer">${kpis.map(kpiCard).join("")}</div>` : ""

  const newsCard = news.length ? `<div class="hb-card"><div class="spread hb-card-head"><div class="hb-card-title">📰 Para vos</div><span class="hb-link" onclick="go('#proactivo')">Más</span></div>
      ${news.map((n) => `<div class="hb-news" onclick="window.open(${escj(n.url)},'_blank')"><div class="hb-news-txt"><div class="hb-news-tag">${esc(n.tag)}</div><div class="hb-news-title">${esc(n.title)}</div><div class="hb-news-src">${esc(n.source || "")}${n.ago ? ` · ${esc(n.ago)}` : ""}</div></div><div class="hb-news-img" style="${n.img ? `background-image:url(${esc(n.img)})` : ""}"></div></div>`).join("")}</div>` : ""

  const coachCard = coach ? `<div class="hb-coach"><div class="hb-eyebrow light"><span>◎</span>Coach · sugerencia</div><div class="hb-coach-txt">${esc(coach.text)}</div><button class="hb-coach-btn" onclick="${coach.convKey ? `go('#conv/${enck(coach.convKey)}')` : "go('#proactivo')"}">Ver sugerencia</button></div>` : ""

  const stale = d.generatedAt ? "" : `<div class="hb-empty" style="text-align:center;margin:10px 0">Generando tu resumen del día…</div>`
  const pushBanner = window.__pushOn === false ? `<div class="push-banner" onclick="enablePush()"><div style="flex:1"><b>🔔 Activá las notificaciones</b><div class="tiny" style="opacity:.9;margin-top:2px">No te estás enterando de los mensajes nuevos. Suenan y vibran.</div></div><span class="push-banner-btn">Activar</span></div>` : ""
  // aviso de canal desconectado (bridge caído) → reconectar. Crítico: los bridges se caen y hay que avisar.
  const CHLB = { whatsapp: "WhatsApp", email: "el correo", telegram: "Telegram", instagram: "Instagram", facebook: "Messenger", discord: "Discord", notion: "Notion" }
  const staleBanner = (window.__chanStale && window.__chanStale.length) ? `<div class="push-banner" style="background:linear-gradient(135deg,#e0662f,#dc4c3e);box-shadow:0 4px 14px rgba(220,76,62,.28)" onclick="addConnectionSheet('telefonia')"><div style="flex:1"><b>⚠️ ${window.__chanStale.map((c) => CHLB[c.channel] || c.channel).join(", ")} sin señal</b><div class="tiny" style="opacity:.92;margin-top:2px">Puede que se haya desconectado — reconectá para no perder mensajes.</div></div><span class="push-banner-btn">Reconectar</span></div>` : ""
  render(`<div class="screen home">
      <div class="hb-head"><div><div class="hb-date">${fecha}</div><h1 class="hb-greet">${saludo},<br>${esc(hubFirst())}</h1></div><div class="hb-avatar" onclick="go('#cuenta')" title="Cuenta y configuración">${esc((hubFirst().trim()[0] || "·").toUpperCase())}</div></div>
      <div id="onboard"></div>
      ${staleBanner}${pushBanner}${askBar}${stale}${briefCard}${waitCard}${callsCard}${todosCard}${promCard}${agCard}${objCard}${kpisBlock}${newsCard}${coachCard}
    </div>`, "home")
  renderOnboarding()
}
// Checklist de primer arranque: aparece hasta que el hub tiene WhatsApp + correo + IA. Desaparece solo cuando está todo (no molesta a un hub ya configurado).
async function renderOnboarding() {
  const el = document.getElementById("onboard"); if (!el) return
  const [acc, st, llm, ch] = await Promise.all([api("/api/accounts").catch(() => null), api("/api/status").catch(() => null), api("/api/llm-config").catch(() => null), api("/api/channels").catch(() => null)])
  if (!acc && !st && !llm) return // sin datos (offline) → no pintar nada
  // WhatsApp conectado = hay un login en el bridge, O ya entraron mensajes de WhatsApp (el listado de logins del bridge a veces
  // devuelve vacío aunque esté logueado; los mensajes son la señal a prueba de balas de que anda).
  const waMsgs = !!(ch && (ch.channels || []).some((c) => c.channel === "whatsapp" && ((c.n30 || 0) > 0 || (c.n7 || 0) > 0)))
  const waOK = !!(st && st.whatsapp && (((st.whatsapp.bridge || []).length) || ((st.whatsapp.baileys || []).length))) || waMsgs
  const mailOK = !!(acc && (acc.email || []).length)
  // IA "lista" = hay una key de NUBE (openai/anthropic/gemini), o el usuario eligió ollama como primario (self-host local deliberado).
  // Ollama-en-la-cadena-por-default NO cuenta: en un tenant no hay ollama corriendo → la IA no funcionaría y hay que pedir la key.
  const aiOK = !!(llm && ((llm.providers || []).some((p) => p.hasKey && p.id !== "ollama") || (Array.isArray(llm.chain) && llm.chain[0] === "ollama")))
  const steps = [
    { ok: waOK, ic: "📱", t: "Conectá WhatsApp", s: "Escaneá un QR desde tu teléfono", cta: "addConnectionSheet('telefonia')", btn: "Conectar" },
    { ok: mailOK, ic: "📧", t: "Agregá tu correo", s: "Gmail/Outlook con contraseña de aplicación", cta: "addConnectionSheet('correo')", btn: "Agregar" },
    { ok: aiOK, ic: "🤖", t: "Elegí tu IA", s: "Tu motor y token (o usá el nuestro)", cta: "aiEngineSheet()", btn: "Elegir" },
  ]
  const done = steps.filter((s) => s.ok).length
  if (done === steps.length) { el.innerHTML = ""; return } // todo conectado → fuera
  el.innerHTML = `<div class="onb">
    <div class="onb-head"><b>Configurá tu hub</b><span>${done}/${steps.length}</span></div>
    ${steps.map((s) => `<div class="onb-row${s.ok ? " done" : ""}">
      <span class="onb-ic">${s.ok ? "✓" : s.ic}</span>
      <div class="onb-main"><div class="onb-t">${s.t}</div><div class="onb-s">${s.s}</div></div>
      ${s.ok ? '<span class="onb-ok">Listo</span>' : `<button class="onb-btn" onclick="${s.cta}">${s.btn}</button>`}
    </div>`).join("")}
  </div>`
}
window.playHomeAudio = (btn) => {
  if (window._homeAudio) { window._homeAudio.pause(); window._homeAudio = null; btn.textContent = "▶ Escuchar de nuevo"; return }
  const a = new Audio("/api/home/audio"); window._homeAudio = a; const orig = btn.textContent
  btn.textContent = "⏸ Pausar"; a.play().catch(() => { btn.textContent = orig })
  a.onended = () => { window._homeAudio = null; btn.textContent = "▶ Escuchar de nuevo" }
}
// ── acciones de la Home ──
window.askBrain = async () => {
  const inp = document.getElementById("askq"), out = document.getElementById("askOut"); if (!inp || !out) return
  const q = inp.value.trim(); if (!q) return
  out.innerHTML = `<div class="hb-ask-out"><div class="row" style="gap:8px;padding:0;background:none;box-shadow:none;margin:0">${ORB}<b>Pensando…</b></div></div>`
  const r = await post("/api/ask", { q }).catch(() => null)
  const ans = (r && (r.answer || r.text || r.reply)) || "No pude responder eso ahora."
  window.__lastAsk = { q, ans }
  out.innerHTML = `<div class="hb-ask-out">${fmtText(ans)}<div style="margin-top:8px"><span class="hb-link" onclick="askToJarvis()">Seguir conversando en Jarvis →</span></div></div>`
  const inp2 = document.getElementById("askq"); if (inp2) inp2.value = ""
}
window.askToJarvis = () => { const a = window.__lastAsk; if (a) jarvisMsgs.push({ role: "me", text: a.q }, { role: "ai", text: a.ans }); go("#jarvis") }
const _wait = (i) => (window.__home?.waiting || [])[i]
window.waitReply = (i) => { const w = _wait(i); if (w) go("#conv/" + enck(w.key)) }
window.waitDone = async (i) => { const w = _wait(i); if (!w) return
  const cur = _lsGet("waitDone") || {}; const keys = cur.gen === window.__home?.generatedAt ? (cur.keys || []) : []
  if (!keys.includes(w.key)) keys.push(w.key); _lsSet("waitDone", { gen: window.__home?.generatedAt, keys }) // persistir para que NO reaparezca al revalidar
  const el = document.getElementById("wait-" + i); if (el) { el.style.transition = "opacity .3s,transform .3s"; el.style.opacity = "0"; el.style.transform = "translateX(24px)"; setTimeout(() => el.remove(), 300) }
  await post("/api/thread/seen", { key: w.key, ts: Date.now() }).catch(() => {}) } // + marcar visto → cae también en la próxima regeneración
window.draftFor = async (i) => { const w = _wait(i); if (!w) return
  go("#conv/" + enck(w.key))
  const r = await post("/api/reply", { name: w.name, key: w.key }).catch(() => null)
  const draft = r && (r.draft || r.text || r.reply)
  setTimeout(() => { const inp = document.getElementById("msgInput"); if (inp && draft) { inp.value = draft; inp.focus() } }, 600)
}
window.actDone = async (kind, id) => { const el = document.getElementById(`act-${kind}-${id}`); if (el) el.classList.add("done"); await post("/api/action/done", { kind, id }).catch(() => {}) ; setTimeout(() => el && el.remove(), 350) }

// ══════════ CUENTA / CONFIGURACIÓN ══════════
async function viewSettings() {
  render(skel(4), "cuenta")
  const [acc, auth, llm, wa] = await Promise.all([api("/api/accounts").catch(() => ({})), api("/api/auth/status").catch(() => ({})), api("/api/llm-config").catch(() => ({})), api("/api/wa/status").catch(() => ({}))])
  window.__llm = llm || {}
  paintSettings(acc || {}, auth || {}, llm || {}, wa || {})
}
// ── Consola: iconos de línea (cero emoji) ──
const IC_ID = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M5.5 16c.4-1.3 1.9-2 3.5-2s3.1.7 3.5 2M14.5 10h4M14.5 13.5h4"/></svg>'
const IC_SHIELD = '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/></svg>'
const IC_CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>'
const IC_SEND = '<svg viewBox="0 0 24 24"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>'
const IC_CHEV = '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>'
const IC_BACK = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>'
const IC_INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'
const IC_ALERT = '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>'
const IC_BELL = '<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 20a2 2 0 0 0 4 0"/></svg>'
const IC_LOCK = '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
const IC_LOGOUT = '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>'
const IC_CHIP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>'
const IC_MAIL = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>'
const IC_PHONE = '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>'
const IC_ROBOT = '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4.5M12 4.5h-2.2M8.5 13h.2M15.3 13h.2M9.5 16h5M3 12v3M21 12v3"/></svg>'
const IC_SYNC = '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 13.5-5.8L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.5 5.8L4 16M4 20v-4h4"/></svg>'
const IC_DISK = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>'
// iconos de línea del rediseño (Notas / Almacenamiento / Media) — cero emoji en el chrome, estilo Consola
const IC_PIN = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 15v5"/></svg>'
const IC_ARCHIVE = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>'
const IC_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'
const IC_UNDO = '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/></svg>'
const IC_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6"/></svg>'
const IC_FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>'
const IC_CLIP = '<svg viewBox="0 0 24 24"><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5"/></svg>'
const IC_IMG = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>'
const IC_VIDEO = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></svg>'
const IC_DOC = '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>'
const IC_AUDIO = '<svg viewBox="0 0 24 24"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/></svg>'
const CFG_SECS = [
  { id: "hub", icon: IC_ID, name: "Este hub", kick: "Tu identidad", title: "¿Quién sos?", desc: "Con esto la IA sabe quién sos y desde dónde escribís — para atribuir bien tus mensajes." },
  { id: "engine", icon: SVG.spark, name: "Motor de IA", kick: "Inteligencia", title: "Keys y áreas", desc: "Cargá tus keys y elegí qué IA usa cada tarea. Todo queda cifrado en tu servidor." },
  { id: "enrich", icon: SVG.globe, name: "Enriquecimiento (Apify)", kick: "Perfiles sociales", title: "Enriquecimiento (Apify)", desc: "Perfiles sociales anónimos (no usa tus cookies). Cargá una o varias cuentas Apify — la app rota entre ellas y si una llega al límite mensual pasa a la siguiente." },
  { id: "mail", icon: IC_MAIL, name: "Cuentas de correo", kick: "Correo", title: "Tus bandejas", desc: "Gmail, Outlook o cualquier IMAP — todo en un solo lugar." },
  { id: "msg", icon: SVG.chat, name: "Mensajería", kick: "Chat", title: "WhatsApp, Telegram y más", desc: "Sumá tus chats a la bandeja unificada." },
  { id: "send", icon: IC_SEND, name: "Estado de envío", kick: "Diagnóstico", title: "¿Tus mensajes salen?", desc: "El hub se autoprueba mandándote un mensaje y te avisa si algo no sale." },
  { id: "autopilot", icon: IC_ROBOT, name: "Piloto automático", kick: "Automatización", title: "Qué escala el piloto", desc: "Elegí qué temas el piloto NO responde solo — esos te los deja a vos." },
  { id: "sync", icon: IC_SYNC, name: "Sincronización", kick: "Mantenimiento", title: "Reconstruir / resincronizar", desc: "Si algo se desincronizó, reconstruilo desde acá. No borra nada." },
  { id: "storage", icon: IC_DISK, name: "Almacenamiento", kick: "Espacio", title: "Fotos, videos y archivos", desc: "Elegí qué media guardar en el servidor (toda la cuenta, o por chat desde el 📎). El audio siempre se guarda." },
  { id: "prefs", icon: SVG.sliders, name: "Preferencias", kick: "Ajustes", title: "Notificaciones, Jarvis y PIN", desc: "Avisos, tu cerebro Jarvis y el PIN de acceso." },
]
function cfgStatus(id) {
  const c = window.__cfg || {}, a = c.acc || {}, auth = c.auth || {}, llm = c.llm || {}, wa = c.wa || {}, h = window.__hub || {}
  if (id === "hub") return { cls: "ok", text: h.company ? `${h.ownerFirst || h.ownerName || "—"} · ${h.company}` : (h.ownerName || "Sin nombre") }
  if (id === "engine") { const act = (llm.providers || []).filter((p) => p.hasKey); return act.length ? { cls: "ok", text: `${act[0].label || act[0].id} conectado${act.length > 1 ? ` +${act.length - 1}` : ""}` } : { cls: "warn", text: "sin motor — pegá un token" } }
  if (id === "mail") { const n = (a.email || []).length; return n ? { cls: "ok", text: `${n} ${n === 1 ? "conectada" : "conectadas"}` } : { cls: "warn", text: "sin cuentas" } }
  if (id === "msg") { if ((wa.loggedOut || []).length) return { cls: "err", text: "revincular WhatsApp" }; const nums = (a.messaging && a.messaging[0] && a.messaging[0].numbers) || []; return nums.length ? { cls: "ok", text: `${nums.length} ${nums.length === 1 ? "número" : "números"}` } : { cls: "warn", text: "sin canales" } }
  if (id === "send") { const s = window.__selftest; if (!s) return { cls: "", text: "sin probar" }; const bad = s.filter((x) => !x.ok).length; return bad ? { cls: "err", text: `${bad} ${bad === 1 ? "falla" : "fallas"}` } : { cls: "ok", text: "todo ok" } }
  if (id === "prefs") return { cls: auth.pinSet ? "ok" : "warn", text: auth.pinSet ? "PIN activo" : "sin PIN" }
  if (id === "enrich") return { cls: "", text: "gestionar" }
  if (id === "autopilot") return { cls: "", text: "qué escala" }
  if (id === "sync") return { cls: "", text: "reconstruir" }
  if (id === "storage") return { cls: "", text: "gestionar" }
  return { cls: "", text: "" }
}
const cfgRow = (icon, label, sub, val) => `<div class="cfg-r"><div class="ric">${icon}</div><div class="rm"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>${val != null ? `<div class="rv">${esc(val)}</div>` : ""}</div>`
function paintSettings(a, auth, llm, wa) {
  window.__cfg = { acc: a || {}, auth: auth || {}, llm: llm || {}, wa: wa || {} }
  window.__llm = llm || {}
  const items = CFG_SECS.map((s) => {
    const st = cfgStatus(s.id)
    return `<button class="cfg-item" onclick="cfgOpen('${s.id}')"><span class="ic">${s.icon}</span><span class="tx"><b>${esc(s.name)}</b><span class="st" id="cfg-st-${s.id}"><i class="cfg-dot ${st.cls}"></i>${esc(st.text)}</span></span><span class="chev">${IC_CHEV}</span></button>`
  }).join("")
  const initial = (hubName()[0] || "P").toUpperCase()
  render(`<div class="screen">
    <div class="cfg-head"><div class="cfg-kick">Configuración</div><h1>Ajustes</h1></div>
    <div class="cfg-id"><div class="av">${esc(initial)}</div><div><b>${esc(hubName())}</b><span>${esc((window.__hub && window.__hub.company) || (window.__hub && window.__hub.domain) || "pipe.one")}</span></div>
      <div style="margin-left:auto;display:flex;gap:4px;align-items:center;font-size:13px">🌐
        <button type="button" onclick="setLang('es')" style="background:none;border:0;cursor:pointer;font-weight:${window.PIPE_LANG === "en" ? 400 : 800};color:${window.PIPE_LANG === "en" ? "var(--muted)" : "var(--accent)"};padding:2px 4px">ES</button>
        <span style="color:var(--line)">·</span>
        <button type="button" onclick="setLang('en')" style="background:none;border:0;cursor:pointer;font-weight:${window.PIPE_LANG === "en" ? 800 : 400};color:${window.PIPE_LANG === "en" ? "var(--accent)" : "var(--muted)"};padding:2px 4px">EN</button>
      </div></div>
    <div class="cfg-list">${items}</div>
  </div>`, "cuenta")
  loadSelfTest()
}
window.cfgOpen = (id) => { renderCfgSection(id); try { window.scrollTo(0, 0) } catch (e) {} }
window.cfgBack = () => { const c = window.__cfg || {}; paintSettings(c.acc || {}, c.auth || {}, c.llm || {}, c.wa || {}) }
// ── backfill de correos archivados ──
window.runBackfill = async () => {
  const inp = document.getElementById("bf-q"), st = document.getElementById("bf-status"); const q = (inp && inp.value || "").trim()
  if (!q) { if (st) st.textContent = "Escribí un nombre, dominio o palabra."; return }
  if (st) st.textContent = "Buscando en el archivo… (puede tardar)"
  const r = await post("/api/mail/backfill", { q }).catch(() => null)
  if (!r || !r.ok) { if (st) st.textContent = (r && r.error) || "No se pudo iniciar."; return }
  setTimeout(pollBackfill, 1500)
}
window.pollBackfill = async () => {
  const st = document.getElementById("bf-status"); if (!st) return
  const s = await api("/api/mail/backfill/status").catch(() => null); if (!s) return
  if (s.state === "running") { st.textContent = `Trayendo… ${s.found || 0} correos`; setTimeout(pollBackfill, 2500); return }
  if (s.state === "done") { st.innerHTML = `✅ ${s.found || 0} correos traídos${s.q ? ` para “${esc(s.q)}”` : ""}. Aparecen en la bandeja en unos segundos.` }
}
// ── resincronización ──
window.resync = async (what) => {
  const rv = document.getElementById("rs-" + what); if (rv) rv.textContent = "…"
  const r = await post("/api/resync", { what }).catch(() => null)
  if (rv) { rv.textContent = (r && r.ok) ? "✓" : "✗"; setTimeout(() => { rv.innerHTML = IC_CHEV }, 3000) }
  if (r && r.ok && what === "stats" && r.threads != null) { const rm = rv && rv.closest(".cfg-r")?.querySelector(".rm span"); if (rm) rm.textContent = `${r.threads} hilos · reconstruida` }
}
function renderCfgSection(id) {
  const c = window.__cfg || {}, a = c.acc || {}, auth = c.auth || {}, llm = c.llm || {}, wa = c.wa || {}, h = window.__hub || {}
  const sec = CFG_SECS.find((s) => s.id === id) || {}
  let body = ""
  if (id === "hub") {
    const nn = (h.myNumbers || []).length, ne = (h.myEmails || []).length
    body = `<div class="cfg-card">
      ${cfgRow(IC_ID, "Nombre", "Cómo firmás y te ve la IA", h.ownerName || "—")}
      ${cfgRow(IC_SHIELD, "Empresa", "Contexto para redacción", h.company || "—")}
      ${cfgRow(IC_PHONE, "Tus números de WhatsApp", "Para reconocerte en grupos", `${nn} ${nn === 1 ? "número" : "números"}`)}
      ${cfgRow(IC_MAIL, "Tus correos", "Se enlazan a tu identidad", `${ne} ${ne === 1 ? "correo" : "correos"}`)}
      ${cfgRow(IC_CLOCK, "Zona horaria", "Resúmenes y horarios", h.timezone || "—")}
    </div>
    <button class="btn" onclick="editHubSheet()">Editar identidad</button>`
  } else if (id === "engine") {
    const provs = llm.providers || []
    const chain = (llm.chain || []).filter((cid) => provs.some((p) => p.id === cid))
    const chainCard = chain.length ? `<div class="cfg-card"><div class="cfg-r"><div class="ric">${SVG.spark}</div><div class="rm"><b>Orden de preferencia</b><span>Si uno falla, cae al siguiente</span></div></div><div class="cfg-chips">${chain.map((cid) => `<span class="cfg-chip">${esc((provs.find((p) => p.id === cid) || {}).label || cid)}</span>`).join("")}</div></div>` : ""
    const provRows = provs.map((p) => {
      const badge = p.id === "ollama" ? (p.hasKey ? "local activo" : "local") : (p.hasKey ? (p.keySource === "env" ? "activo (.env)" : "activo") : "sin token")
      return `<div class="cfg-r"><div class="ric">${IC_CHIP}</div><div class="rm"><b>${esc(p.label || p.id)}</b>${p.model ? `<span>${esc(p.model)}</span>` : ""}</div><span class="cfg-badge ${p.hasKey ? "ok" : "off"}">${esc(badge)}</span></div>`
    }).join("")
    body = `${chainCard}<div class="cfg-card">${provRows}</div>
    <button class="btn" onclick="aiEngineSheet()">Elegir motor y tokens</button>
    <div class="cfg-note">${IC_INFO}<div>Tus datos van al motor que elijas. Tus tokens quedan en tu servidor, nunca se muestran.</div></div>`
  } else if (id === "mail") {
    const rows = (a.email || []).map((e) => `<div class="cfg-r"><div class="ric">${IC_MAIL}</div><div class="rm"><b>${esc(e.name || e.user)}</b><span>${e.name ? esc(e.user) + " · " : ""}${esc(e.host || "")}${e.count ? ` · ${e.count} correos` : ""}${e.last ? ` · ${ago(e.last)}` : ""}</span></div>${e.kind === "imap" ? `<button class="rx" onclick="removeEmail('${esc(e.label)}')" title="Quitar">✕</button>` : ""}</div>`).join("")
    body = ((a.email || []).length ? `<div class="cfg-card">${rows}</div>` : `<div class="cfg-empty"><b>Todavía no conectaste ningún correo</b><p>Tocá “Agregar cuenta de correo” para sumar tu primera bandeja.</p></div>`)
      + `<button class="btn" onclick="addConnectionSheet('correo')">➕ Agregar cuenta de correo</button>
      <div class="cfg-note">${IC_INFO}<div>El hub trae solo lo reciente. ¿Falta un correo viejo (un cliente, una deuda)? Traelo del archivo por nombre, dominio o palabra.</div></div>
      <div class="cfg-card" style="padding:13px 15px"><div style="display:flex;gap:8px;align-items:center"><input id="bf-q" class="inp" placeholder="ej: soltrak, @viacorreo.com.ar" style="flex:1;margin:0" onkeydown="if(event.key==='Enter')runBackfill()"><button class="btn" style="width:auto;flex:none;padding:11px 18px" onclick="runBackfill()">Traer</button></div><div id="bf-status" class="tiny muted" style="margin-top:9px;line-height:1.4"></div></div>`
  } else if (id === "msg") {
    const nums = (a.messaging && a.messaging[0] && a.messaging[0].numbers) || []
    const card = nums.length ? `<div class="cfg-card"><div class="cfg-chips">${nums.map((n) => `<span class="cfg-chip">${IC_PHONE} +${esc(n)}</span>`).join("")}</div></div>` : `<div class="cfg-empty"><b>Sin canales de mensajería</b><p>Tocá “Agregar canal” para vincular tu primer chat.</p></div>`
    const warn = (wa.loggedOut || []).length ? `<div class="cfg-note warn">${IC_ALERT}<div>WhatsApp se desconectó. Volvé a vincularlo para seguir recibiendo y enviando.</div></div>` : ""
    body = card + warn + `<button class="btn" onclick="addConnectionSheet('telefonia')">➕ Agregar canal de mensajería</button>
      <button class="btn ghost" onclick="waImportSheet()"><span class="ei">📤</span>Importar historial de WhatsApp</button>
      <div class="cfg-note">${IC_INFO}<div>¿Tenés chats viejos de WhatsApp? Exportalos desde la app (“Exportar chat”) y traelos acá — se suman sin duplicar.</div></div>`
  } else if (id === "send") {
    body = `<div class="cfg-card"><div class="cfg-r"><div class="rm" style="width:100%"><div id="selftest-box" style="font-size:13.5px;line-height:1.6;color:var(--muted)">Cargando…</div></div></div></div>
    <div class="cfg-note">${IC_INFO}<div>Cada 12h pipe.one se manda una prueba a tu propio número y correo, y verifica que salió de verdad.</div></div>
    <button class="btn ghost" onclick="runSelfTestNow(this)">Probar envío ahora</button>`
  } else if (id === "sync") {
    body = `<div class="cfg-card">
      <div class="cfg-r tap" onclick="resync('stats')"><div class="ric">${SVG.chat}</div><div class="rm"><b>Bandeja</b><span>Recomputar contadores y últimos mensajes</span></div><div class="rv" id="rs-stats">${IC_CHEV}</div></div>
      <div class="cfg-r tap" onclick="resync('search')"><div class="ric">${SVG.search}</div><div class="rm"><b>Búsqueda IA</b><span>Reconstruir tags y grafo del robotito</span></div><div class="rv" id="rs-search">${IC_CHEV}</div></div>
      <div class="cfg-r tap" onclick="resync('identities')"><div class="ric">${IC_ID}</div><div class="rm"><b>Identidades</b><span>Reagrupar contactos (arregla hilos mezclados)</span></div><div class="rv" id="rs-identities">${IC_CHEV}</div></div>
      <div class="cfg-r tap" onclick="resync('channels')"><div class="ric">${IC_MAIL}</div><div class="rm"><b>Correos</b><span>Reconectar los lectores de email</span></div><div class="rv" id="rs-channels">${IC_CHEV}</div></div>
    </div>
    <div class="cfg-note">${IC_INFO}<div>Todo corre en el server sin borrar nada. Reconstruir búsqueda e identidades puede tardar unos minutos.</div></div>`
  } else if (id === "prefs") {
    body = `<div class="cfg-card">
      <div class="cfg-r tap" onclick="faqSheet()"><div class="ric">${IC_INFO}</div><div class="rm"><b>Cómo conectar</b><span>Guía paso a paso de cada fuente</span></div><div class="rv">${IC_CHEV}</div></div>
      <div class="cfg-r tap" onclick="notifMenu()"><div class="ric">${IC_BELL}</div><div class="rm"><b>Notificaciones</b><span>Avisos y horas de silencio</span></div><div class="rv">${IC_CHEV}</div></div>
      <div class="cfg-r tap" onclick="go('#jarvis')"><div class="ric">${SVG.spark}</div><div class="rm"><b>Jarvis</b><span>Preguntá a tu cerebro</span></div><div class="rv">${IC_CHEV}</div></div>
      <div class="cfg-r tap" onclick="pinSheet()"><div class="ric">${IC_LOCK}</div><div class="rm"><b>PIN de acceso</b><span>${auth.pinSet ? "Cambiar tu PIN" : "Crear un PIN"}</span></div><div class="rv">${IC_CHEV}</div></div>
    </div>
    <button class="btn ghost btn-danger" onclick="doLogout()"><span class="ei">${IC_LOGOUT}</span>Cerrar sesión</button>
    <div class="cfg-note">${IC_INFO}<div>Cierra la sesión en este dispositivo y vuelve a pedir el PIN. Tus datos siguen en el servidor.</div></div>`
  }
  if (id === "storage") body = `<div id="storageCfg" class="cfg-card">Cargando…</div>`
  if (id === "autopilot") body = `<div id="apPolicyCfg" class="cfg-card">Cargando…</div>`
  if (id === "enrich") body = `<div id="apifyCfg">Cargando…</div>`
  render(`<div class="screen">
    <button class="cfg-back" onclick="cfgBack()">${IC_BACK}Ajustes</button>
    <div class="cfg-sec-h"><div class="cfg-kick">${esc(sec.kick || "Configuración")}</div><h1>${esc(sec.title || sec.name || "")}</h1>${sec.desc ? `<p>${esc(sec.desc)}</p>` : ""}</div>
    ${body}
  </div>`, "cuenta")
  if (id === "send") loadSelfTest()
  if (id === "storage") loadStorageCfg()
  if (id === "autopilot") loadAutopilotPolicy()
  if (id === "enrich") loadApifyCfg()
}
// ── Enriquecimiento (Apify): cuentas anónimas que la app rota para traer perfiles sociales ──
window.loadApifyCfg = async () => {
  const box = document.getElementById("apifyCfg"); if (!box) return
  const r = await api("/api/apify/accounts").catch(() => null)
  if (!r) { box.textContent = "No se pudo cargar."; return }
  const accs = r.accounts || []
  window.__apifyN = accs.length
  const rows = accs.map((a) => `<div class="cfg-r">
      <div class="ric">${SVG.search}</div>
      <div class="rm"><b>${esc(a.name || "Cuenta Apify")}</b><span>${a.runs || 0} corrida${(a.runs || 0) === 1 ? "" : "s"} · ~$${Number(a.usd || 0).toFixed(2)}${a.hint ? ` · ••••${esc(a.hint)}` : ""}</span></div>
      ${a.exhausted ? `<span class="cfg-badge" style="background:rgba(224,102,47,.12);color:var(--warn)">AGOTADA este mes</span>` : ""}
      <button class="rx" onclick="apifyRemove('${esc(a.id)}')" title="Quitar">✕</button></div>`).join("")
  const list = accs.length ? `<div class="cfg-card">${rows}</div>` : `<div class="cfg-empty"><b>Sin cuentas Apify</b><p>Cargá una para activar el enriquecimiento social de tus contactos. Con el plan gratis alcanza para arrancar.</p></div>`
  box.innerHTML = `${list}
    <button class="btn" onclick="apifyAddSheet()">➕ Agregar cuenta Apify</button>
    <div class="cfg-note">${IC_INFO}<div>La app usa estas cuentas de forma anónima (no tus cookies). Rota entre ellas y salta a la siguiente si una llega al límite mensual gratuito.${r.month ? ` Mes actual: ${esc(r.month)}.` : ""}</div></div>
    <details style="margin-top:12px"><summary style="cursor:pointer;color:var(--accent);font-weight:600;font-size:13px;list-style:none">⚙️ Avanzado · IDs de actores por plataforma</summary>
      <textarea id="apify-actors" class="inp" spellcheck="false" style="margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px;min-height:120px;box-sizing:border-box">${esc(JSON.stringify(r.actors || {}, null, 2))}</textarea>
      <button class="btn ghost" style="margin-top:8px" onclick="apifySaveActors()">Guardar actores</button></details>`
}
window.apifyAddSheet = () => {
  openSheet(`<h2 style="margin:0 0 10px">➕ Cuenta Apify</h2>
    <div class="sub" style="margin:0 0 12px">Creá una cuenta gratis en apify.com y pegá tu API token (Settings → Integrations). El nombre es opcional.</div>
    <input class="inp" id="apify-name" placeholder="Nombre (opcional, ej: Apify #1)" style="box-sizing:border-box;margin-bottom:10px">
    <div style="position:relative;margin-bottom:6px"><input class="inp" id="apify-token" type="password" placeholder="Pegá tu API token (apify_api_…)" style="box-sizing:border-box;padding-right:44px"><button type="button" onclick="togglePw('apify-token',this)" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;font-size:17px;padding:5px;color:var(--muted)">👁</button></div>
    <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener" class="chip" style="text-decoration:none">Obtener token ↗</a>
    <button class="btn" style="width:100%;margin-top:16px" onclick="apifyAdd()">Agregar</button>
    <div id="apify-out" class="tiny" style="text-align:center;margin-top:10px;min-height:16px"></div>`)
}
window.apifyAdd = async () => {
  const name = (document.getElementById("apify-name")?.value || "").trim()
  const token = (document.getElementById("apify-token")?.value || "").trim()
  const out = document.getElementById("apify-out")
  if (!token) { if (out) out.innerHTML = '<span style="color:#e0663a">Falta el token.</span>'; return }
  if (out) out.textContent = "Agregando…"
  const r = await post("/api/apify/accounts", { name, token }).catch(() => null)
  if (r && (r.accounts || r.ok)) { closeSheet(); loadApifyCfg() }
  else if (out) out.innerHTML = `<span style="color:#e0663a">${esc((r && r.error) || "No se pudo agregar.")}</span>`
}
window.apifyRemove = async (id) => {
  if (!confirm("¿Quitar esta cuenta Apify?")) return
  await post("/api/apify/accounts", { remove: id }).catch(() => null)
  loadApifyCfg()
}
window.apifySaveActors = async () => {
  let actors; try { actors = JSON.parse(document.getElementById("apify-actors").value || "{}") } catch { return alert("El JSON de actores no es válido.") }
  const r = await post("/api/apify/accounts", { actors }).catch(() => null)
  alert(r && (r.accounts || r.ok) ? "✅ Actores guardados." : "No se pudo guardar.")
  loadApifyCfg()
}
// ── Piloto automático: política GLOBAL de qué temas escala (te los deja a vos) en vez de responder ──
const AP_PRESET_LABELS = {
  money: "Plata / pagos",
  resign: "Renuncias",
  hire: "Contrataciones",
  meeting: "Reuniones o llamadas con hora",
  appointment: "Citas / turnos",
  legal: "Temas legales / contratos",
  emotional: "Temas personales serios",
  health: "Salud",
}
window.loadAutopilotPolicy = async () => {
  const box = document.getElementById("apPolicyCfg"); if (!box) return
  const r = await api("/api/autopilot/policy").catch(() => null)
  if (!r) { box.textContent = "No se pudo cargar."; return }
  const on = new Set(r.presets || [])
  const avail = (r.presets_available && r.presets_available.length) ? r.presets_available : Object.keys(AP_PRESET_LABELS)
  const checks = avail.map((k) => `<label style="display:flex;align-items:center;gap:9px;margin:2px 0;padding:7px 0;font-size:14.5px;cursor:pointer">
      <input type="checkbox" class="ap-preset" value="${esc(k)}" ${on.has(k) ? "checked" : ""} style="width:18px;height:18px;flex:none">
      ${esc(AP_PRESET_LABELS[k] || k)}</label>`).join("")
  box.innerHTML = `
    <div class="cfg-note">${IC_INFO}<div>El piloto responde todo, MENOS estos temas — esos te los deja a vos.</div></div>
    <div style="margin:6px 2px 10px">${checks}</div>
    <label class="tiny muted" style="display:block;margin:2px 2px 5px">Otros temas propios (separados por coma)</label>
    <input id="apCustom" class="inp" placeholder="ej: temas de la obra, cosas del auto" style="margin-bottom:12px" value="${esc((r.custom || []).join(", "))}">
    <button class="btn" style="width:100%" onclick="saveAutopilotPolicy()">Guardar</button>
    <div id="apPolMsg" class="tiny" style="text-align:center;margin-top:9px;min-height:16px;color:var(--accent)"></div>`
}
window.saveAutopilotPolicy = async () => {
  const presets = [...document.querySelectorAll(".ap-preset:checked")].map((el) => el.value)
  const custom = (document.getElementById("apCustom")?.value || "").split(",").map((s) => s.trim()).filter(Boolean)
  const msg = document.getElementById("apPolMsg"); if (msg) msg.textContent = "Guardando…"
  const r = await post("/api/autopilot/policy", { presets, custom }).catch(() => null)
  if (msg) msg.textContent = r ? "✓ Guardado" : "No se pudo guardar."
  if (r && msg) setTimeout(() => { if (msg) msg.textContent = "" }, 3000)
}
window.loadStorageCfg = async () => {
  const box = document.getElementById("storageCfg"); if (!box) return
  const r = await api("/api/media-policy").catch(() => null)
  if (!r) { box.textContent = "No se pudo cargar."; return }
  const store = (r.policy.def || "store") === "store"
  const bytes = r.storage?.bytes || 0, gb = bytes / 1073741824
  const n = gb < 0.1 ? String(Math.round(bytes / 1048576)) : gb.toFixed(2), unit = gb < 0.1 ? "MB" : "GB"
  const uniq = r.storage?.unique || 0, refs = r.storage?.refs || 0
  const saved = refs > uniq && refs ? Math.round((1 - uniq / refs) * 100) : 0 // % ahorrado por dedup SHA-256 (archivos repetidos = 1 sola copia)
  box.innerHTML = `
    <div class="cfg-card"><div class="cfg-r"><div class="ric">${IC_DISK}</div><div class="rm"><b>Guardar fotos, videos y documentos</b><span>En el servidor, toda la cuenta. El audio (notas de voz) siempre se guarda.</span></div>
      <button class="switch${store ? " on" : ""}" role="switch" aria-checked="${store}" aria-label="Guardar fotos, videos y documentos" onclick="toggleGlobalMedia(${!store})"></button></div></div>
    <div class="stor">
      <div class="stor-top"><div><div class="stor-size">${n}<span class="stor-unit">${unit}</span></div><div class="stor-cap">${uniq.toLocaleString("es")} archivo${uniq === 1 ? "" : "s"} guardado${uniq === 1 ? "" : "s"}${refs > uniq ? ` · ${refs.toLocaleString("es")} usos` : ""}</div></div>
        <span class="cfg-badge ${store ? "ok" : "off"}">${store ? "Guardando" : "En pausa"}</span></div>
      ${saved ? `<div class="stor-bar"><i style="width:${saved}%"></i></div><div class="stor-cap" style="margin-top:8px">${saved}% ahorrado por deduplicación — los archivos repetidos se guardan una sola vez.</div>` : ""}
    </div>
    <button class="btn ghost btn-danger" onclick="freeAllMedia()"><span class="ei">${IC_TRASH}</span>Liberar espacio</button>`
}
window.toggleGlobalMedia = async (store) => { await post("/api/media-policy", { def: store ? "store" : "skip" }).catch(() => {}); loadStorageCfg() }
window.freeAllMedia = async () => {
  if (!confirm("¿Mandar a la papelera TODAS las fotos, videos y documentos ya guardados? El audio se mantiene y NO se borran los mensajes. Tenés 30 días para recuperarlos antes de que se liberen del disco.")) return
  const r = await post("/api/media/free", {}).catch(() => null)
  alert(r ? `✅ ${r.count} adjuntos a la papelera · recuperables 30 días, después se libera el espacio` : "No se pudo.")
  loadStorageCfg()
}
window.loadSelfTest = async () => {
  const r = await api("/api/selftest").catch(() => null)
  window.__selftest = (r && r.results && r.results.length) ? r.results : null
  const box = document.getElementById("selftest-box")
  if (box) {
    box.innerHTML = window.__selftest
      ? window.__selftest.map((x) => `<div style="display:flex;gap:9px;align-items:center;padding:3px 0"><i class="cfg-dot ${x.ok ? "ok" : "err"}"></i><b style="text-transform:capitalize;font-weight:600">${esc(x.channel)}</b> <span class="muted" style="font-size:12.5px">${esc(x.detail || "")}</span></div>`).join("") + (r && r.ts ? `<div class="tiny muted" style="margin-top:7px">Última prueba: ${esc(ago(r.ts))}</div>` : "")
      : "Aún no se ejecutó ninguna prueba. Corre solo cada 12h — o probala ahora."
  }
  const dot = document.getElementById("cfg-st-send")
  if (dot) { const st = cfgStatus("send"); dot.innerHTML = `<i class="cfg-dot ${st.cls}"></i>${esc(st.text)}` }
}
window.runSelfTestNow = async (btn) => {
  if (btn) { btn.disabled = true; btn.textContent = "Enviando prueba a vos mismo…" }
  const box = document.getElementById("selftest-box"); if (box) box.innerHTML = "Enviando prueba por cada canal…"
  await post("/api/selftest", {}).catch(() => null)
  if (btn) { btn.disabled = false; btn.textContent = "Probar envío ahora" }
  loadSelfTest()
}
window.connectGmail = async () => {
  const r = await api("/api/oauth/google/configured").catch(() => null)
  if (r && r.configured) { location.href = "/oauth/google/start" } // → pantalla de Google "¿Permitir?" → vuelve solo
  else { alert("La conexión con Google (Permitir acceso) todavía no está activada en este hub. Por ahora conectá con una contraseña de aplicación."); connOpen("gmail") }
}
// ══ AGREGAR CONEXIÓN — picker unificado por categorías (nuestro diseño) ══
const CINP = "width:100%;box-sizing:border-box;margin-bottom:8px;padding:12px;border-radius:12px;border:1px solid var(--line);font-size:15px"
const GOOGLE_G = '<svg width="17" height="17" viewBox="0 0 48 48" style="flex:none"><path fill="#4285F4" d="M45 24c0-1.6-.1-3.1-.4-4.6H24v9h11.8c-.5 2.7-2 5-4.3 6.6v5.5h7C42.6 36.7 45 30.9 45 24z"/><path fill="#34A853" d="M24 46c5.8 0 10.6-1.9 14.2-5.2l-7-5.5c-1.9 1.3-4.4 2.1-7.2 2.1-5.5 0-10.2-3.7-11.9-8.7H5v5.7C8.6 41.5 15.7 46 24 46z"/><path fill="#FBBC05" d="M12.1 28.7c-.4-1.3-.7-2.7-.7-4.7s.3-3.4.7-4.7v-5.7H5C3.7 16.5 3 20.1 3 24s.7 7.5 2 10.4l7.1-5.7z"/><path fill="#EA4335" d="M24 9.5c3.1 0 5.9 1.1 8.1 3.2l6-6C34.6 3.3 29.8 1 24 1 15.7 1 8.6 5.5 5 12.3l7.1 5.7C13.8 13.2 18.5 9.5 24 9.5z"/></svg>'
const CONN_TABS = [["todos", "Todos"], ["correo", "Correo"], ["telefonia", "Telefonía"], ["redes", "Redes"], ["trabajo", "Trabajo"]]
// status: "ready" = alta 1-clic in-app · "server" = se configura en el servidor del hub (muestra guía) · "soon" = próximamente
const CONN_PROV = [
  { id: "gmail", name: "Gmail", cat: "correo", chan: "email", sub: "Google · IMAP", status: "ready" },
  { id: "outlook", name: "Outlook", cat: "correo", chan: "email", sub: "IMAP · app password", status: "ready" },
  { id: "imap", name: "Otro correo", cat: "correo", chan: "email", sub: "Cualquier IMAP", status: "ready" },
  { id: "whatsapp", name: "WhatsApp", cat: "telefonia", chan: "whatsapp", sub: "QR o código", status: "ready" },
  { id: "wa-import", name: "Importar chat de WhatsApp", cat: "telefonia", emoji: "📤", sub: "Traé tu historial (.txt/.zip)", status: "ready" },
  { id: "telegram", name: "Telegram", cat: "telefonia", chan: "telegram", sub: "Teléfono + código", status: "ready" },
  { id: "sms", name: "SMS", cat: "telefonia", chan: null, emoji: "💬", sub: "Próximamente", status: "soon" },
  { id: "signal", name: "Signal", cat: "telefonia", chan: null, emoji: "🔒", sub: "signal-cli en tu server", status: "ready" },
  { id: "discord", name: "Discord", cat: "redes", chan: "discord", emoji: "🎮", sub: "Con token", status: "ready" },
  { id: "slack", name: "Slack", cat: "trabajo", chan: null, emoji: "💬", sub: "Con token (xoxp/xoxb)", status: "ready" },
  { id: "instagram", name: "Instagram", cat: "redes", chan: "instagram", sub: "En el servidor", status: "server" },
  { id: "facebook", name: "Messenger", cat: "redes", chan: "facebook", sub: "En el servidor", status: "server" },
  { id: "linkedin", name: "LinkedIn", cat: "redes", chan: "linkedin", sub: "Próximamente", status: "soon" },
  { id: "teams", name: "Microsoft 365", cat: "trabajo", chan: "teams", sub: "Outlook · Teams · SharePoint", status: "server" },
  { id: "notion", name: "Notion", cat: "trabajo", chan: "notion", sub: "Con token", status: "server" },
  { id: "gcal", name: "Google Calendar", cat: "trabajo", chan: "calendar", sub: "En el servidor", status: "server" },
  { id: "gdrive", name: "Google Drive", cat: "trabajo", chan: null, emoji: "📁", sub: "En el servidor", status: "server" },
]
let _connCat = "todos"
// ── Ayuda paso a paso (FAQ) — simple, con link directo a donde se genera ──
const HELP = {
  gmail: { title: "Contraseña de aplicación de Gmail", url: "https://myaccount.google.com/apppasswords", urlLabel: "Abrir Contraseñas de aplicación de Google", steps: [
    "Tu cuenta necesita la <b>Verificación en 2 pasos</b> activada (si no la tenés, activala primero en Seguridad de Google).",
    "Abrí <b>Contraseñas de aplicación</b> con el botón de abajo.",
    "Escribí un nombre cualquiera (ej: <b>pipe</b>) y tocá <b>Crear</b>.",
    "Google te muestra una clave de <b>16 letras</b> (ej: <code>abcd efgh ijkl mnop</code>). Copiala.",
    "Volvé acá y pegala en el campo de contraseña, <b>sin espacios</b>.",
  ] },
  outlook: { title: "Contraseña de aplicación de Outlook", url: "https://account.microsoft.com/security", urlLabel: "Abrir Seguridad de Microsoft", steps: [
    "Entrá a <b>Seguridad</b> de tu cuenta Microsoft con el botón de abajo.",
    "Activá la <b>Verificación en dos pasos</b> si no la tenés.",
    "Buscá <b>Contraseñas de aplicación</b> → <b>Crear una nueva</b>.",
    "Copiá la clave que te da y pegala acá en el campo de contraseña.",
  ] },
  imap: { title: "Conectar otro correo por IMAP", url: "", urlLabel: "", steps: [
    "En la configuración de tu correo, activá el <b>acceso IMAP</b>.",
    "Si tu proveedor pide una <b>contraseña de aplicación</b>, generala en su panel de seguridad.",
    "Pegá acá tu correo + esa contraseña. El <b>servidor</b> se completa solo para los proveedores conocidos.",
  ] },
  whatsapp: { title: "Conectar WhatsApp", url: "", urlLabel: "", steps: [
    "Escribí tu número <b>con código de país</b> (ej: +51 999…) y tocá <b>Código</b>, o tocá <b>QR</b>.",
    "En tu teléfono: WhatsApp → <b>Ajustes → Dispositivos vinculados → Vincular un dispositivo</b>.",
    "Escaneá el <b>QR</b> que aparece acá, o elegí “Vincular con número” y poné el <b>código</b>.",
    "Listo — no hay que volver a escanear, queda vinculado en el servidor.",
  ] },
}
// bloque de ayuda plegable, INLINE (no saca al usuario del formulario)
const helpBlock = (topic) => { const h = HELP[topic]; if (!h) return ""; return `<details style="margin:2px 0 12px"><summary style="cursor:pointer;color:var(--accent);font-weight:600;font-size:13.5px;list-style:none">🔑 ¿Cómo consigo la contraseña de aplicación?</summary><ol style="padding-left:20px;font-size:13.5px;line-height:1.6;margin:9px 0 0">${h.steps.map((s) => `<li style="margin:5px 0">${s}</li>`).join("")}</ol>${h.url ? `<a href="${h.url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:9px;font-weight:600;font-size:13.5px">${esc(h.urlLabel)} ↗</a><br>` : ""}<a onclick="faqSheet()" style="display:inline-block;margin-top:9px;font-weight:600;font-size:13.5px;color:var(--accent);cursor:pointer">📖 Ver guía completa →</a></details>` }
// FAQ completo in-app (accesible desde Configuración)
window.faqSheet = () => {
  const card = (topic) => { const h = HELP[topic]; return `<div class="cfg-card" style="margin-bottom:11px"><b style="display:block;margin-bottom:6px">${esc(h.title)}</b><ol style="padding-left:20px;font-size:13.5px;line-height:1.6;margin:0">${h.steps.map((s) => `<li style="margin:5px 0">${s}</li>`).join("")}</ol>${h.url ? `<a href="${h.url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:9px;font-weight:600;font-size:13.5px">${esc(h.urlLabel)} ↗</a>` : ""}</div>` }
  openSheet(`<h2 style="margin:0 0 4px">❓ Cómo conectar</h2>
    <div class="sub" style="margin:0 0 14px">Guías paso a paso, simples, para conectar cada fuente.</div>
    <div style="font-weight:700;font-size:13px;color:var(--muted);margin:4px 2px 8px">CORREO</div>
    ${card("gmail")}${card("outlook")}${card("imap")}
    <div style="font-weight:700;font-size:13px;color:var(--muted);margin:12px 2px 8px">MENSAJERÍA</div>
    ${card("whatsapp")}`)
}
window.addConnectionSheet = (cat) => { _connCat = cat || "todos"; _renderConnPicker() }
window.connTab = (id) => { _connCat = id; _renderConnPicker() }
function _renderConnPicker() {
  const tabs = CONN_TABS.map(([id, l]) => `<button class="tchip${_connCat === id ? " on" : ""}" onclick="connTab('${id}')" style="flex:none">${l}</button>`).join("")
  const tiles = CONN_PROV.filter((p) => _connCat === "todos" || p.cat === _connCat).map((p) => {
    const ic = (p.chan && chanIcon(p.chan)) || (p.emoji ? `<span style="font-size:20px">${p.emoji}</span>` : IC_PHONE)
    const on = p.status !== "soon"
    const act = p.status === "server" ? `serverGuide('${p.id}')` : `connOpen('${p.id}')`
    const badge = p.status === "server" ? `<span style="font-size:9.5px;font-weight:800;letter-spacing:.04em;color:var(--accent);background:rgba(99,102,241,.1);padding:2px 6px;border-radius:6px;flex:none">SERVIDOR</span>` : p.status === "soon" ? `<span style="font-size:9.5px;font-weight:700;color:var(--muted2);flex:none">PRONTO</span>` : ""
    return `<button ${on ? `onclick="${act}"` : "disabled"} style="display:flex;align-items:center;gap:11px;padding:13px;border-radius:14px;border:1px solid var(--line);background:${on ? "var(--card,#fff)" : "transparent"};text-align:left;cursor:${on ? "pointer" : "default"};opacity:${on ? "1" : ".5"}">
      <span style="width:30px;height:30px;flex:none;display:grid;place-items:center">${ic}</span>
      <span style="min-width:0;flex:1"><b style="display:block;font-size:14.5px">${esc(p.name)}</b><span class="tiny muted">${esc(p.sub)}</span></span>${badge}</button>`
  }).join("")
  openSheet(`<h2 style="margin:0 0 4px">➕ Agregar conexión</h2>
    <div class="sub" style="margin:0 0 12px">Elegí de dónde traer tus mensajes.</div>
    <div style="display:flex;gap:7px;overflow-x:auto;margin:0 0 14px;padding-bottom:2px">${tabs}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">${tiles}</div>
    <button onclick="faqSheet()" style="display:block;width:100%;margin-top:16px;background:none;border:0;color:var(--accent);font-weight:600;font-size:13.5px;cursor:pointer;text-align:center">❓ Cómo conectar cada cosa — guía paso a paso</button>`)
}
window.connOpen = (id) => {
  if (id === "gmail") return emailForm({ name: "Gmail", host: "imap.gmail.com", oauth: true, help: "gmail", ph: "tu@gmail.com", hint: "Usá una <b>contraseña de aplicación</b> de Google (con verificación en 2 pasos), o entrá con Google directamente." })
  if (id === "outlook") return emailForm({ name: "Outlook", host: "outlook.office365.com", help: "outlook", ph: "tu@outlook.com", hint: "Usá una <b>contraseña de aplicación</b> de Microsoft (no la de tu cuenta)." })
  if (id === "imap") return emailForm({ name: "Otro correo (IMAP)", host: "", help: "imap", ph: "tu@correo.com", hint: "Cualquier proveedor con IMAP + contraseña de aplicación." })
  if (id === "whatsapp") return waSheet()
  if (id === "wa-import") return waImportSheet()
  if (id === "discord") return discordSheet()
  if (id === "telegram") return tgSheet()
  if (id === "slack") return slackSheet()
  if (id === "signal") return signalSheet()
}
// Guías de fuentes que se configuran en el servidor del hub (Teams/Notion/Google/Telegram/IG/FB)
const GUIDES = {
  telegram: { title: "Telegram", url: "https://my.telegram.org", urlLabel: "Abrir my.telegram.org", steps: ["Sacá <b>TG_API_ID</b> y <b>TG_API_HASH</b> en <b>my.telegram.org</b> → API development tools.", "Ponelos (con <code>TG_PHONE</code>) en el <code>.env</code> del hub.", "Corré <code>node src/telegram.mjs</code>; Telegram te manda un código para confirmar.", "Es solo lectura de tus chats."] },
  teams: { title: "Microsoft 365 — Outlook · Teams · SharePoint", url: "https://microsoft.com/devicelogin", urlLabel: "Abrir microsoft.com/devicelogin", steps: ["En el servidor del hub, corré <code>node src/teams.mjs</code>.", "Aparece un <b>código</b>: abrí microsoft.com/devicelogin y pegalo.", "Iniciá sesión con tu cuenta Microsoft y aceptá los permisos.", "Un solo login cubre Outlook + Teams + SharePoint/OneDrive."] },
  notion: { title: "Notion", url: "https://notion.so/my-integrations", urlLabel: "Abrir Notion — Integraciones", steps: ["Creá una integración interna en <b>notion.so/my-integrations</b> y copiá el <b>Internal Integration Secret</b>.", "Poné <code>NOTION_TOKEN=…</code> en el <code>.env</code> del hub y reiniciá.", "En Notion, <b>compartí</b> las páginas/bases con tu integración (botón Compartir → tu integración).", "El token interno no expira."] },
  gcal: { title: "Google Calendar", url: "", urlLabel: "", steps: ["En el servidor del hub, corré <code>node src/google-auth.mjs &lt;etiqueta&gt; tu@gmail.com</code>.", "Abrí el link de autorización que imprime, elegí esa cuenta y aceptá.", "Queda el token (Calendar + Drive) y empieza a sincronizar."] },
  gdrive: { title: "Google Drive", url: "", urlLabel: "", steps: ["Se conecta junto con Google Calendar (mismo login).", "En el servidor: <code>node src/google-auth.mjs &lt;etiqueta&gt; tu@gmail.com</code> → aceptá.", "Sincroniza tus archivos de Drive para buscarlos desde el hub."] },
  instagram: { title: "Instagram", url: "", urlLabel: "", steps: ["Corre sobre un bridge Matrix (mautrix-meta) en el servidor del hub.", "El login es por <b>cookies</b> del navegador de esa cuenta.", "Se configura una vez desde el servidor."] },
  facebook: { title: "Messenger (Facebook)", url: "", urlLabel: "", steps: ["Corre sobre un bridge Matrix (mautrix-meta) en el servidor del hub.", "El login es por <b>cookies</b> del navegador.", "Se configura una vez desde el servidor."] },
}
window.serverGuide = (id) => {
  const g = GUIDES[id]; if (!g) return
  const back = (CONN_PROV.find((p) => p.id === id) || {}).cat || "todos"
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('${back}')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">${esc(g.title)}</h2>
  <div class="cfg-note" style="margin:0 0 14px">${IC_INFO}<div>Esta fuente se conecta <b>desde el servidor</b> de tu hub. En la versión gestionada la activa tu proveedor; en self-host, seguí estos pasos.</div></div>
  <ol style="padding-left:20px;font-size:14px;line-height:1.7;margin:0">${g.steps.map((s) => `<li style="margin:6px 0">${s}</li>`).join("")}</ol>
  ${g.url ? `<a href="${g.url}" target="_blank" rel="noopener" class="btn" style="display:block;text-align:center;text-decoration:none;margin-top:16px">${esc(g.urlLabel)} ↗</a>` : ""}`)
}
// Discord: token (el QR suele fallar) → /api/matrix-link-token
window.discordSheet = () => {
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('redes')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">Discord</h2>
  <div class="sub" style="margin:0 0 12px">El QR de Discord suele fallar. Lo confiable es tu <b>token</b>.</div>
  <details style="margin:0 0 12px"><summary style="cursor:pointer;color:var(--accent);font-weight:600;font-size:13.5px;list-style:none">🔑 ¿Cómo saco mi token?</summary><ol style="padding-left:20px;font-size:13.5px;line-height:1.6;margin:9px 0 0"><li>Abrí <b>discord.com</b> en el navegador (logueado).</li><li>Apretá <b>F12</b> → pestaña <b>Network</b>.</li><li>Hacé cualquier acción; abrí un request y buscá el header <b>authorization</b>.</li><li>Copiá ese valor y pegalo abajo.</li></ol></details>
  <textarea id="dcTok" rows="2" placeholder="Pegá tu token de Discord acá" style="${CINP};resize:none"></textarea>
  <button class="btn" style="width:100%" onclick="discordLink()">Vincular con token</button>
  <div id="dcOut" style="margin-top:12px;text-align:center;min-height:30px"></div>`)
}
window.discordLink = async () => {
  const t = (document.getElementById("dcTok").value || "").trim(), o = document.getElementById("dcOut")
  if (!t) { o.innerHTML = '<span class="tiny muted">Pegá el token primero.</span>'; return }
  o.innerHTML = '<span class="tiny muted">Vinculando…</span>'
  await post("/api/matrix-link-token?net=discord", { token: t }).catch(() => {})
  netPoll("discord", "dcOut")
}
// Slack: token de una app (xoxp/xoxb) → se valida con auth.test y se guarda cifrado → /api/integrations/slack
window.slackSheet = () => {
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('trabajo')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">Slack</h2>
  <div class="sub" style="margin:0 0 12px">Trae tus DMs y canales a la bandeja. Necesitás un <b>token de app</b> de Slack.</div>
  <details style="margin:0 0 12px"><summary style="cursor:pointer;color:var(--accent);font-weight:600;font-size:13.5px;list-style:none">🔑 ¿Cómo saco el token?</summary><ol style="padding-left:20px;font-size:13.5px;line-height:1.6;margin:9px 0 0"><li>Entrá a <b>api.slack.com/apps</b> → <b>Create New App</b> (From scratch).</li><li>En <b>OAuth &amp; Permissions</b> agregá scopes: <code>channels:history</code>, <code>groups:history</code>, <code>im:history</code>, <code>mpim:history</code>, <code>channels:read</code>, <code>users:read</code> (y <code>chat:write</code> para responder).</li><li><b>Install to Workspace</b> y copiá el <b>User OAuth Token</b> (<code>xoxp-…</code>).</li></ol><a href="https://api.slack.com/apps" target="_blank" rel="noopener" style="display:inline-block;margin-top:9px;font-weight:600;font-size:13.5px">Abrir api.slack.com/apps ↗</a></details>
  <textarea id="slkTok" rows="2" placeholder="Pegá tu token de Slack (xoxp-… o xoxb-…)" style="${CINP};resize:none"></textarea>
  <button class="btn" style="width:100%" onclick="slackSave()">Conectar Slack</button>
  <div id="slkOut" style="margin-top:12px;text-align:center;min-height:24px;font-size:13.5px"></div>`)
}
window.slackSave = async () => {
  const t = (document.getElementById("slkTok").value || "").trim(), o = document.getElementById("slkOut")
  if (!t) { o.innerHTML = '<span class="tiny muted">Pegá el token primero.</span>'; return }
  o.innerHTML = '<span class="muted">Verificando con Slack…</span>'
  const r = await post("/api/integrations/slack", { token: t }).catch(() => null)
  if (!r || r.error) { o.innerHTML = `<span style="color:#e0663a">${esc((r && r.error) || "No se pudo conectar.")}</span>`; return }
  o.innerHTML = `<b style="color:var(--ok,#16a34a)">✓ ¡Slack conectado!${r.team ? " (" + esc(r.team) + ")" : ""}</b>`
  setTimeout(() => { closeSheet(); viewSettings() }, 1600)
}
// Signal: signal-cli-rest-api corre en tu server → URL + número (se vincula por número al hilo de WhatsApp/SMS) → /api/integrations/signal
window.signalSheet = () => {
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('telefonia')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">Signal</h2>
  <div class="sub" style="margin:0 0 12px">Se une al <b>mismo hilo</b> que WhatsApp/SMS de cada contacto. Necesitás <b>signal-cli-rest-api</b> corriendo en tu servidor.</div>
  <details style="margin:0 0 12px"><summary style="cursor:pointer;color:var(--accent);font-weight:600;font-size:13.5px;list-style:none">🔧 ¿Cómo lo levanto? (una vez)</summary><ol style="padding-left:20px;font-size:13.5px;line-height:1.6;margin:9px 0 0"><li>En tu server: <code>docker run -d -p 8080:8080 -v signal:/home/.local/share/signal-cli bbernhard/signal-cli-rest-api</code></li><li>Vinculá tu número como dispositivo (ver el README del proyecto).</li><li>Poné acá la URL (ej <code>http://localhost:8080</code>) y tu número.</li></ol></details>
  <input class="inp" id="sgUrl" placeholder="http://localhost:8080" style="${CINP}">
  <input class="inp" id="sgNum" inputmode="tel" placeholder="+51 999 000 000" style="${CINP}">
  <button class="btn" style="width:100%" onclick="signalSave()">Conectar Signal</button>
  <div id="sgOut" style="margin-top:12px;text-align:center;min-height:24px;font-size:13.5px"></div>`)
}
window.signalSave = async () => {
  const url = (document.getElementById("sgUrl").value || "").trim(), number = (document.getElementById("sgNum").value || "").trim(), o = document.getElementById("sgOut")
  if (!url || !number) { o.innerHTML = '<span class="tiny muted">Completá la URL y tu número.</span>'; return }
  o.innerHTML = '<span class="muted">Guardando…</span>'
  const r = await post("/api/integrations/signal", { url, number }).catch(() => null)
  if (!r || r.error) { o.innerHTML = `<span style="color:#e0663a">${esc((r && r.error) || "No se pudo guardar.")}</span>`; return }
  o.innerHTML = '<b style="color:var(--ok,#16a34a)">✓ ¡Signal conectado!</b>'
  setTimeout(() => { closeSheet(); viewSettings() }, 1600)
}
// ── Telegram self-service: teléfono → código → 2FA opcional (GramJS vía el server) ──
window.tgSheet = async () => {
  const st = (await api("/api/telegram/status").catch(() => null)) || {}
  if (st.connected) { openSheet(`<button class="cfg-back" onclick="addConnectionSheet('telefonia')">${IC_BACK}Conexiones</button><h2 style="margin:6px 0 4px">Telegram</h2><div class="cfg-note">${IC_INFO}<div>Ya está conectado ✓ — leyendo tus chats (solo lectura).</div></div>`); return }
  const needApi = !st.configured
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('telefonia')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">Telegram</h2>
  <div class="sub" style="margin:0 0 12px">Poné tu teléfono; Telegram te manda un código a tu app para confirmar.</div>
  ${needApi ? `<details style="margin:0 0 12px"><summary style="cursor:pointer;color:var(--accent);font-weight:600;font-size:13.5px;list-style:none">🔑 ¿De dónde saco el API ID / Hash? (una vez)</summary><ol style="padding-left:20px;font-size:13.5px;line-height:1.6;margin:9px 0 0"><li>Entrá a <b>my.telegram.org</b> con tu número.</li><li><b>API development tools</b> → creá una app (título cualquiera).</li><li>Copiá el <b>api_id</b> (número) y el <b>api_hash</b>.</li></ol><a href="https://my.telegram.org" target="_blank" rel="noopener" style="display:inline-block;margin-top:9px;font-weight:600;font-size:13.5px">Abrir my.telegram.org ↗</a></details>
    <input class="inp" id="tgApiId" inputmode="numeric" placeholder="API ID (número)" style="${CINP}">
    <input class="inp" id="tgApiHash" placeholder="API Hash" style="${CINP}">` : ""}
  <input class="inp" id="tgPhone" inputmode="tel" placeholder="+51 999 000 000 (con código de país)" style="${CINP}">
  <button class="btn" style="width:100%" onclick="tgStart()">Enviar código</button>
  <div id="tgOut" style="margin-top:12px;text-align:center;font-size:13.5px"></div>`)
}
window.tgStart = async () => {
  const o = document.getElementById("tgOut")
  const phone = (document.getElementById("tgPhone").value || "").trim()
  const apiId = (document.getElementById("tgApiId")?.value || "").trim(), apiHash = (document.getElementById("tgApiHash")?.value || "").trim()
  if (!phone) { o.innerHTML = '<span class="muted">Poné tu teléfono con código de país.</span>'; return }
  o.innerHTML = '<span class="muted">Enviando código a tu Telegram…</span>'
  const r = await post("/api/telegram/start", { phone, apiId, apiHash }).catch(() => null)
  if (!r || r.error) { o.innerHTML = `<span style="color:#e0663a">${esc((r && r.error) || "No se pudo iniciar.")}</span>`; return }
  tgCodeStage()
}
window.tgCodeStage = () => {
  openSheet(`<button class="cfg-back" onclick="tgSheet()">${IC_BACK}Telegram</button>
  <h2 style="margin:6px 0 4px">Código de Telegram</h2>
  <div class="sub" style="margin:0 0 12px">Telegram te mandó un código a tu <b>app</b> (no por SMS). Escribilo acá.</div>
  <input class="inp" id="tgCode" inputmode="numeric" placeholder="1 2 3 4 5" style="${CINP};text-align:center;font-size:22px;letter-spacing:6px">
  <button class="btn" style="width:100%" onclick="tgCode()">Confirmar</button>
  <div id="tgOut" style="margin-top:12px;text-align:center;font-size:13.5px"></div>`)
}
window.tgCode = async () => {
  const o = document.getElementById("tgOut"), code = (document.getElementById("tgCode").value || "").trim()
  if (!code) { o.innerHTML = '<span class="muted">Escribí el código.</span>'; return }
  o.innerHTML = '<span class="muted">Verificando…</span>'
  await post("/api/telegram/code", { code }).catch(() => {})
  tgPoll()
}
window.tgPwStage = () => {
  openSheet(`<button class="cfg-back" onclick="tgSheet()">${IC_BACK}Telegram</button>
  <h2 style="margin:6px 0 4px">Verificación en 2 pasos</h2>
  <div class="sub" style="margin:0 0 12px">Tenés 2FA en Telegram. Poné tu contraseña de 2 pasos.</div>
  <div style="position:relative;margin-bottom:8px"><input class="inp" id="tgPw2" type="password" placeholder="Contraseña de 2 pasos" style="${CINP};margin-bottom:0;padding-right:46px"><button type="button" onclick="togglePw('tgPw2',this)" aria-label="Mostrar" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;font-size:18px;padding:6px;color:var(--muted)">👁</button></div>
  <button class="btn" style="width:100%" onclick="tgPw()">Confirmar</button>
  <div id="tgOut" style="margin-top:12px;text-align:center;font-size:13.5px"></div>`)
}
window.tgPw = async () => {
  const o = document.getElementById("tgOut")
  o.innerHTML = '<span class="muted">Verificando…</span>'
  await post("/api/telegram/password", { password: document.getElementById("tgPw2").value }).catch(() => {})
  tgPoll()
}
window.tgPoll = async () => {
  if (!document.getElementById("tgOut")) return // sheet cerrado
  const st = (await api("/api/telegram/status").catch(() => null)) || {}
  const o = document.getElementById("tgOut"); if (!o) return
  if (st.connected) { o.innerHTML = '<b style="color:var(--ok,#16a34a)">✓ ¡Telegram conectado!</b>'; await post("/api/telegram/connected").catch(() => {}); setTimeout(() => { closeSheet(); viewSettings() }, 1600); return }
  if (st.stage === "password") { tgPwStage(); return }
  if (st.stage === "error") { o.innerHTML = `<span style="color:#e0663a">${esc(st.error || "Error en el login. Reintentá.")}</span>`; return }
  setTimeout(tgPoll, 1500)
}
// formulario de correo: nombre identificador + OAuth opcional (Gmail) + IMAP con ojo y auto-host
let _curEmailHelp = null
window.emailForm = (p) => {
  _curEmailHelp = p.help || null
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('correo')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">${esc(p.name)}</h2>
  <div class="sub" style="margin:0 0 14px">${p.hint || ""}</div>
  <input class="inp" id="cNom" placeholder="Nombre para identificarla (ej: ${esc(p.name)} personal)" style="${CINP}">
  ${p.oauth ? `<button class="btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:9px;background:#fff;color:#1f1f1f;border:1px solid var(--line);margin-bottom:10px" onclick="connectGmail()">${GOOGLE_G} Ingresar con Google</button>
  <div style="display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;margin:2px 0 10px"><span style="flex:1;height:1px;background:var(--line)"></span>o con contraseña de aplicación<span style="flex:1;height:1px;background:var(--line)"></span></div>` : ""}
  <input class="inp" id="acEmail" type="email" inputmode="email" placeholder="${esc(p.ph || "tu@correo.com")}" style="${CINP}" oninput="acHost(this.value)">
  <div style="position:relative;margin-bottom:8px">
    <input class="inp" id="acPass" type="password" placeholder="Contraseña de aplicación (16 letras)" style="${CINP};margin-bottom:0;padding-right:46px">
    <button type="button" onclick="togglePw('acPass',this)" aria-label="Mostrar contraseña" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;font-size:18px;line-height:1;padding:6px;color:var(--muted)">👁</button>
  </div>
  ${helpBlock(p.help)}
  <input class="inp" id="acHostF" placeholder="Servidor IMAP (automático)" oninput="this.dataset.touched='1'" value="${esc(p.host || "")}"${p.host ? ' data-touched="1"' : ""} style="${CINP};margin-bottom:12px">
  <button class="btn" style="width:100%" onclick="saveEmail()">Conectar</button>
  <div id="acErr" style="color:#e0663a;font-size:13px;margin-top:8px"></div>`)
}
window.addEmailSheet = () => connOpen("imap") // compat
// ── WhatsApp: vincular por QR o código, in-app (bridge Matrix del server) ──
window.waSheet = () => {
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('telefonia')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">WhatsApp</h2>
  <div class="sub" style="margin:0 0 14px">Vinculá desde el teléfono de esa cuenta. Podés agregar varios números.</div>
  <input class="inp" id="waPhone" inputmode="tel" placeholder="+51 999 000 000 (con código de país)" style="${CINP}">
  <div style="display:flex;gap:8px">
    <button class="btn" style="flex:1" onclick="waLink(true)">Código por número</button>
    <button class="btn ghost" style="flex:1" onclick="waLink(false)">QR</button>
  </div>
  <div id="waOut" style="margin-top:16px;text-align:center;min-height:44px"></div>`)
}
window.waLink = async (byPhone) => {
  const out = document.getElementById("waOut")
  const v = byPhone ? (document.getElementById("waPhone").value || "").trim() : ""
  if (byPhone && !v) { out.innerHTML = '<span class="tiny muted">Poné el número primero, con código de país.</span>'; return }
  out.innerHTML = '<span class="tiny muted">Generando…</span>'
  await post("/api/matrix-link?net=whatsapp" + (byPhone ? "&phone=" + encodeURIComponent(v) : "")).catch(() => {})
  waPoll()
}
// polling genérico de estado de un bridge (whatsapp/discord/…) hasta conectar
window.netPoll = async (net, outSel) => {
  if (!document.getElementById(outSel)) return // sheet cerrado → parar el polling
  const r = await api("/api/matrix-status?net=" + net).catch(() => null)
  const o = document.getElementById(outSel); if (!o) return
  if (r && r.connected) { o.innerHTML = '<b style="color:var(--ok,#16a34a)">✓ ¡Conectado!</b>'; setTimeout(() => { closeSheet(); viewSettings() }, 1600); return }
  let h = ""
  if (r && r.code) h += `<div class="tiny muted">En la app → Dispositivos vinculados → Vincular con número:</div><div style="font-size:30px;font-weight:800;letter-spacing:5px;color:var(--accent);margin:10px 0">${esc(r.code)}</div>`
  if (r && r.qr) h += `<img alt="QR" src="/api/matrix-qr?net=${net}&t=${Date.now()}" style="width:220px;height:220px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px">`
  if (!(r && (r.code || r.qr))) h += '<span class="tiny muted">Generando… puede tardar ~30s. No cierres esto.</span>'
  o.innerHTML = h
  setTimeout(() => netPoll(net, outSel), 3000)
}
window.waPoll = () => netPoll("whatsapp", "waOut")
// ── Importar historial de WhatsApp (.txt / .zip) — self-service, sin PC ni root ──
// El usuario exporta un chat en WhatsApp ("Exportar chat"), lo elige acá, y el server lo parsea y mergea al hilo sin duplicar.
// .txt = solo texto → POST /api/import/whatsapp · .zip = con fotos/audios → POST /api/import/whatsapp-zip
let _waImpFile = null
// deriva el nombre del chat del filename del export ("Chat de WhatsApp con Ana.txt" / "WhatsApp Chat with Ana.txt" → "Ana")
const waChatName = (fn = "") => String(fn).replace(/\.(txt|zip)$/i, "").replace(/^_?chat( de whatsapp con| de whatsapp)?\s*/i, "").replace(/^whatsapp chat( -| with)?\s*/i, "").replace(/^chat -\s*/i, "").trim()
// detecta si el teléfono usa día/mes (DMY) o mes/día (MDY) para parsear bien las fechas del export
const waDateOrder = () => { try { const p = new Intl.DateTimeFormat().formatToParts(new Date(2000, 0, 2)).filter((x) => x.type === "day" || x.type === "month").map((x) => x.type); return p[0] === "month" ? "MDY" : "DMY" } catch { return "auto" } }
window.waImportSheet = () => {
  _waImpFile = null
  const steps = [
    "Abrí en WhatsApp el chat o grupo que querés traer.",
    "Tocá el menú <b>⋮</b> (arriba a la derecha) → <b>Más → Exportar chat</b>.",
    "Elegí <b>«Con multimedia»</b> (trae fotos y audios, archivo .zip) o <b>«Sin multimedia»</b> (solo texto, .txt, llega a más historial).",
    "Guardalo o compartilo a este dispositivo y elegilo abajo.",
  ]
  openSheet(`<button class="cfg-back" onclick="addConnectionSheet('telefonia')">${IC_BACK}Conexiones</button>
  <h2 style="margin:6px 0 4px">📤 Importar historial de WhatsApp</h2>
  <div class="sub" style="margin:0 0 14px">WhatsApp guarda tus chats cifrados y no deja que otra app los lea. Traelos vos con <b>«Exportar chat»</b> — se agrega a tu bandeja sin duplicar lo que ya tenés.</div>
  <ol style="padding-left:20px;font-size:13.5px;line-height:1.7;margin:0 0 14px">${steps.map((s) => `<li style="margin:6px 0">${s}</li>`).join("")}</ol>
  <input type="file" id="waImpFile" accept=".txt,.zip,text/plain,application/zip" style="display:none" onchange="waImpPick(this)">
  <button class="btn ghost" style="width:100%" onclick="document.getElementById('waImpFile').click()">Elegir archivo (.txt o .zip)</button>
  <div id="waImpForm" style="display:none;margin-top:14px">
    <div class="b small" style="margin:0 0 4px">Nombre del chat o contacto</div>
    <input class="inp" id="waImpName" placeholder="ej: Ana Pérez / Equipo Ventas" style="${CINP}">
    <label style="display:flex;align-items:center;gap:9px;margin:2px 0 12px;font-size:14px;cursor:pointer"><input type="checkbox" id="waImpGroup" style="width:18px;height:18px;flex:none"> Es un grupo (varias personas)</label>
    <button class="btn" style="width:100%" onclick="waImpRun()">Importar</button>
  </div>
  <div id="waImpOut" style="margin-top:14px;text-align:center;min-height:22px;font-size:13.5px"></div>
  <div class="cfg-note" style="margin:14px 0 0">${IC_INFO}<div>«Con multimedia» trae fotos/audios (hasta ~10.000 mensajes). «Sin multimedia» es solo texto pero llega a ~40.000. Podés traer todos los chats que quieras; no se duplica lo que ya tenés.</div></div>`)
}
// al elegir archivo: precargá el nombre desde el filename y mostrá el formulario de confirmación
window.waImpPick = (inp) => {
  const f = inp.files && inp.files[0]; if (!f) return
  _waImpFile = f
  const form = document.getElementById("waImpForm"); if (form) form.style.display = "block"
  const nm = document.getElementById("waImpName"); if (nm && !nm.value) nm.value = waChatName(f.name)
  const out = document.getElementById("waImpOut"); if (out) out.innerHTML = `<span class="tiny muted">${esc(f.name)} · ${(f.size / 1048576).toFixed(1)} MB</span>`
}
window.waImpRun = async () => {
  const f = _waImpFile, out = document.getElementById("waImpOut")
  if (!f) { if (out) out.innerHTML = '<span class="tiny muted">Elegí primero el archivo exportado.</span>'; return }
  if (f.size > 64 * 1024 * 1024) { if (out) out.innerHTML = '<span style="color:#e0663a">El archivo es muy grande (máx 64 MB). Probá exportar «Sin multimedia».</span>'; return }
  const name = (document.getElementById("waImpName").value || "").trim() || waChatName(f.name)
  const group = document.getElementById("waImpGroup").checked ? 1 : 0
  const isZip = /\.zip$/i.test(f.name || "") // .zip = export con multimedia; cualquier otra cosa la tratamos como .txt
  if (out) out.innerHTML = '<span class="muted">Importando… no cierres esto.</span>'
  const qs = new URLSearchParams({ name, group: String(group), order: waDateOrder(), tz: String(-new Date().getTimezoneOffset()) })
  const url = (isZip ? "/api/import/whatsapp-zip" : "/api/import/whatsapp") + "?" + qs.toString()
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": isZip ? "application/zip" : "text/plain" }, body: f }).then((x) => x.json()).catch(() => null)
  if (!r || r.error) { if (out) out.innerHTML = `<span style="color:#e0663a">${esc((r && r.error) || "No se pudo importar. Revisá que sea un export de WhatsApp (.txt o .zip).")}</span>`; return }
  const added = r.inserted ?? r.imported ?? 0
  const media = r.media ? ` · ${r.media} con foto/audio` : ""
  const dup = r.skipped ? ` (${r.skipped} ya estaban)` : ""
  if (out) out.innerHTML = `<b style="color:var(--ok,#16a34a)">✓ ${added} mensajes agregados${media}${dup}</b>`
  setTimeout(() => { closeSheet(); go("#mensajes") }, 1800) // refrescá la bandeja para ver el hilo importado
}
window.imapHostFor = (email) => { const d = ((email || "").split("@")[1] || "").toLowerCase(); return /gmail|googlemail/.test(d) ? "imap.gmail.com" : /outlook|hotmail|live|office365/.test(d) ? "outlook.office365.com" : /zoho/.test(d) ? "imap.zoho.com" : /yahoo/.test(d) ? "imap.mail.yahoo.com" : /icloud|me\.com/.test(d) ? "imap.mail.me.com" : d ? "imap." + d : "" }
// autofill el servidor mientras se escribe el correo, SALVO que el usuario lo haya editado a mano (dataset.touched)
window.acHost = (email) => { const h = document.getElementById("acHostF"); if (!h || h.dataset.touched) return; h.value = imapHostFor(email) }
// ojo mostrar/ocultar para cualquier input password
window.togglePw = (id, btn) => { const i = document.getElementById(id); if (!i) return; const show = i.type === "password"; i.type = show ? "text" : "password"; if (btn) { btn.textContent = show ? "🙈" : "👁"; btn.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña") } }
window.saveEmail = async () => {
  const user = (document.getElementById("acEmail").value || "").trim(), pass = document.getElementById("acPass").value
  let host = (document.getElementById("acHostF").value || "").trim()
  if (!host || !/\.[a-z]{2,}$/i.test(host)) host = imapHostFor(user) // servidor vacío o incompleto (ej "imap.g") → derivar del dominio del correo
  const name = (document.getElementById("cNom")?.value || "").trim()
  const err = document.getElementById("acErr"); if (!user || !pass) { err.textContent = "Completá correo y contraseña."; return }
  err.textContent = "Conectando y verificando…"
  const r = await post("/api/accounts/email", { user, pass, host, name }).catch(() => null)
  if (r && r.ok) { closeSheet(); alert("✅ Correo conectado. Empieza a traer mensajes en unos segundos."); viewSettings() }
  else { const h = _curEmailHelp && HELP[_curEmailHelp]; err.innerHTML = esc((r && r.error) || "No se pudo conectar.") + (h && h.url ? ` <a href="${h.url}" target="_blank" rel="noopener" style="font-weight:700;white-space:nowrap">Generar contraseña ↗</a>` : "") }
}
window.removeEmail = async (label) => { if (!confirm("¿Quitar esta cuenta de correo? (no borra los correos ya traídos)")) return; await post("/api/accounts/email/remove", { label }).catch(() => {}); viewSettings() }
// ── IDENTIDAD DEL HUB (config por-hub / base multi-cliente) ──
const _inp = "width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--line);margin-bottom:10px"
window.editHubSheet = () => {
  const h = window.__hub || {}
  openSheet(`<h2 style="margin:0 0 4px">🏢 Identidad del hub</h2>
    <div class="sub" style="margin:0 0 14px">Quién sos y tus canales propios. Nombre y empresa aplican al toque; los números/mails propios aplican al reiniciar el servicio.</div>
    <div class="b small" style="margin:0 0 4px">Tu nombre completo</div><input class="inp" id="hb-name" value="${esc(h.ownerName || "")}" style="${_inp}">
    <div class="b small" style="margin:0 0 4px">Nombre de pila (para el saludo)</div><input class="inp" id="hb-first" value="${esc(h.ownerFirst || "")}" style="${_inp}">
    <div class="b small" style="margin:0 0 4px">Empresa (contexto de la IA)</div><input class="inp" id="hb-company" value="${esc(h.company || "")}" style="${_inp}">
    <div class="b small" style="margin:0 0 4px">Tus números de WhatsApp (separados por coma)</div><input class="inp" id="hb-numbers" value="${esc((h.myNumbers || []).join(", "))}" style="${_inp}">
    <div class="b small" style="margin:0 0 4px">Tus correos propios (separados por coma)</div><input class="inp" id="hb-emails" value="${esc((h.myEmails || []).join(", "))}" style="${_inp}">
    <div class="b small" style="margin:0 0 4px">Zona horaria</div><input class="inp" id="hb-tz" value="${esc(h.timezone || "")}" placeholder="America/Lima" style="${_inp}">
    <button class="btn" style="width:100%" onclick="saveHub()">Guardar</button>
    <div id="hubErr" style="color:#e0663a;font-size:13px;margin-top:8px"></div>`)
}
window.saveHub = async () => {
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : "" }
  const body = { ownerName: v("hb-name"), ownerFirst: v("hb-first"), company: v("hb-company"), myNumbers: v("hb-numbers"), myEmails: v("hb-emails"), timezone: v("hb-tz") }
  const err = document.getElementById("hubErr"); err.textContent = "Guardando…"
  const r = await post("/api/hub-config/save", body).catch(() => null)
  if (r && r.ok) { window.__hub = r.config; _lsSet("hub", r.config); closeSheet(); alert("✅ Identidad actualizada. Los números/correos propios se aplican al reiniciar el servicio."); viewSettings() }
  else err.textContent = "No se pudo guardar."
}
// ── MOTOR DE IA (BYOK): elegir proveedor + pegar token + MODELO específico (config avanzada), por-hub ──
const MODEL_CATALOG = {
  openai: [["gpt-4o-mini", "GPT-4o mini — rápido y barato"], ["gpt-4o", "GPT-4o — más capaz"], ["gpt-4.1-mini", "GPT-4.1 mini"], ["gpt-4.1", "GPT-4.1"], ["o1-mini", "o1-mini — razonamiento"], ["o1", "o1 — razonamiento profundo"]],
  anthropic: [["claude-haiku-4-5-20251001", "Claude Haiku 4.5 — rápido/barato"], ["claude-sonnet-5", "Claude Sonnet 5 — equilibrado"], ["claude-opus-4-8", "Claude Opus 4.8 — máxima capacidad"], ["claude-3-5-haiku-latest", "Claude 3.5 Haiku"], ["claude-3-5-sonnet-latest", "Claude 3.5 Sonnet"]],
  gemini: [["gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite — el más rápido"], ["gemini-2.5-flash", "Gemini 2.5 Flash — equilibrado"], ["gemini-2.5-pro", "Gemini 2.5 Pro — más capaz"]],
  ollama: [["qwen2.5:7b", "Qwen 2.5 7B"], ["qwen2.5:32b", "Qwen 2.5 32B"], ["llama3.1:8b", "Llama 3.1 8B"], ["gemma2:9b", "Gemma 2 9B"], ["deepseek-r1:8b", "DeepSeek R1 8B"]],
}
const modelDatalist = (id) => `<datalist id="ml-${id}">${(MODEL_CATALOG[id] || []).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</datalist>`
const modelField = (p, extra = "") => `<input class="inp" id="llm-m-${p.id}" list="ml-${p.id}" placeholder="Modelo: ${esc(p.model || "por defecto")}" value="" style="${extra}box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid var(--line)">${modelDatalist(p.id)}`
// ── MOTOR DE IA v2 · PASO 1 tus keys (multi, con nombre + test) · PASO 2 áreas (una IA por tarea) ──
let _aiDraft = null
const AI_PROV = [["openai", "OpenAI (GPT)"], ["anthropic", "Anthropic (Claude)"], ["gemini", "Google Gemini"]]
const AI_PLABEL = { openai: "OpenAI", anthropic: "Claude", gemini: "Gemini", ollama: "Ollama local" }
window.aiEngineSheet = async () => {
  const cfg = (await api("/api/llm-config").catch(() => null)) || {}
  window.__llm = cfg
  const kl = JSON.parse(JSON.stringify(cfg.keysList || []))
  if (!kl.some((k) => k.provider === "ollama")) kl.push({ id: "ollama", provider: "ollama", name: "Ollama (local)", hasToken: true })
  _aiDraft = { keysList: kl, routing: JSON.parse(JSON.stringify(cfg.routing || {})), stt: cfg.stt || "openai", ollamaHost: cfg.ollamaHost || "", areas: cfg.areas || [] }
  _aiRender()
}
function _aiRender() {
  const d = _aiDraft
  const keyRow = (k) => `<div class="cfg-r" style="align-items:center;flex-wrap:wrap">
    <div class="ric">${k.provider === "ollama" ? "🖥️" : "🔑"}</div>
    <div class="rm" style="flex:1;min-width:80px"><b>${esc(k.name || k.provider)}</b><span>${esc(AI_PLABEL[k.provider] || k.provider)}${k.hint ? " · " + esc(k.hint) : (k._new ? " · nueva (sin guardar)" : "")}</span></div>
    <button class="chip" onclick="aiTest('${esc(k.id)}')" style="cursor:pointer">Probar</button>
    ${k.provider === "ollama" ? "" : `<button class="rx" onclick="aiDel('${esc(k.id)}')" title="Quitar">✕</button>`}
    <div id="aitest-${esc(k.id)}" class="tiny" style="flex-basis:100%;margin-top:3px;text-align:right"></div></div>`
  const keyOpt = (sel) => `<option value="">— automático —</option>` + d.keysList.filter((k) => k.provider === "ollama" || k.hasToken || k._new).map((k) => `<option value="${esc(k.id)}"${sel === k.id ? " selected" : ""}>${esc(k.name || k.provider)}</option>`).join("")
  const provOfKey = (id) => (d.keysList.find((k) => k.id === id) || {}).provider
  const areaRow = (a) => { const r = d.routing[a.key] || {}, prov = provOfKey(r.keyId)
    return `<div class="cfg-card" style="margin-bottom:8px;padding:10px 12px">
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">${esc(a.label)}</div>
      <div class="row" style="gap:6px;padding:0;background:none;box-shadow:none">
        <select class="inp" onchange="aiRoute('${a.key}','keyId',this.value)" style="flex:1;min-width:0;padding:8px;border-radius:9px;border:1px solid var(--line)">${keyOpt(r.keyId)}</select>
        <input class="inp" ${prov ? `list="ml-${prov}"` : ""} onchange="aiRoute('${a.key}','model',this.value)" value="${esc(r.model || "")}" placeholder="modelo (opc.)" style="flex:1;min-width:0;padding:8px;border-radius:9px;border:1px solid var(--line)">
      </div>${prov ? modelDatalist(prov) : ""}</div>`
  }
  openSheet(`<h2 style="margin:0 0 10px">🤖 Motor de IA</h2>
    <div class="b small" style="margin:0 0 6px;color:var(--accent)">PASO 1 · TUS KEYS</div>
    <div class="sub" style="margin:0 0 8px">Agregá solo las que tengas. Podés poner varias (incluso 2 del mismo proveedor). El token queda cifrado en tu servidor.</div>
    ${d.keysList.map(keyRow).join("")}
    <button class="btn ghost" style="width:100%;margin-top:6px" onclick="aiAddKey()">➕ Agregar key</button>
    <div class="b small" style="margin:20px 0 6px;color:var(--accent)">PASO 2 · ÁREAS DE USO</div>
    <div class="sub" style="margin:0 0 8px">Elegí qué IA usa cada tipo de tarea (barato para lo trivial, potente para lo que importa). Vacío = automático (local para lo privado).</div>
    ${(d.areas || []).map(areaRow).join("")}
    <div class="cfg-card" style="margin-bottom:8px;padding:10px 12px"><div style="font-weight:600;font-size:14px;margin-bottom:6px">🎙️ Voz (transcripción)</div>
      <select class="inp" id="ai-stt" style="width:100%;padding:8px;border-radius:9px;border:1px solid var(--line)"><option value="openai"${d.stt === "openai" ? " selected" : ""}>OpenAI Whisper (nube)</option><option value="local"${d.stt === "local" ? " selected" : ""}>Local (whisper.cpp) — nunca sale</option></select></div>
    <details style="margin:8px 0"><summary style="cursor:pointer;color:var(--accent);font-weight:600;font-size:13px;list-style:none">⚙️ Ollama host (self-host local)</summary><input class="inp" id="ai-host" value="${esc(d.ollamaHost || "")}" placeholder="http://localhost:11434" style="width:100%;box-sizing:border-box;margin-top:6px;padding:9px;border-radius:9px;border:1px solid var(--line)"></details>
    <button class="btn" style="width:100%;margin-top:10px" onclick="saveLlm()">Guardar</button>
    <div id="llmErr" style="color:#e0663a;font-size:13px;margin-top:8px"></div>`)
}
window.aiAddKey = () => {
  openSheet(`<button class="cfg-back" onclick="_aiRender()">${IC_BACK}Motor de IA</button>
    <h2 style="margin:6px 0 12px">Agregar key</h2>
    <div class="b small" style="margin:0 0 6px">Proveedor</div>
    <select class="inp" id="ak-prov" onchange="var u={openai:'platform.openai.com/api-keys',anthropic:'console.anthropic.com',gemini:'aistudio.google.com/apikey'}[this.value];document.getElementById('ak-doc').href='https://'+u" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px;border-radius:10px;border:1px solid var(--line)">${AI_PROV.map(([id, l]) => `<option value="${id}">${l}</option>`).join("")}</select>
    <input class="inp" id="ak-name" placeholder="Nombre (ej: OpenAI trabajo)" style="width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px;border-radius:10px;border:1px solid var(--line)">
    <div style="position:relative;margin-bottom:6px"><input class="inp" id="ak-token" type="password" placeholder="Pegá tu API key" style="width:100%;box-sizing:border-box;padding:10px;padding-right:44px;border-radius:10px;border:1px solid var(--line)"><button type="button" onclick="togglePw('ak-token',this)" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;cursor:pointer;font-size:17px;padding:5px;color:var(--muted)">👁</button></div>
    <a id="ak-doc" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="chip" style="text-decoration:none">Obtener key ↗</a>
    <div style="display:flex;gap:8px;margin-top:16px"><button class="btn ghost" style="flex:1" onclick="aiTestNew()">Probar</button><button class="btn" style="flex:1" onclick="aiSaveKey()">Agregar</button></div>
    <div id="ak-out" class="tiny" style="text-align:center;margin-top:10px;min-height:16px"></div>`)
}
window.aiTestNew = async () => {
  const o = document.getElementById("ak-out"), provider = document.getElementById("ak-prov").value, token = document.getElementById("ak-token").value.trim()
  if (!token) { o.innerHTML = '<span class="muted">Pegá la key primero.</span>'; return }
  o.innerHTML = '<span class="muted">Probando…</span>'
  const r = await post("/api/llm-config/test", { provider, token }).catch(() => null)
  o.innerHTML = r && r.ok ? `<b style="color:var(--ok,#16a34a)">✓ Anda (${esc(r.model)})</b>` : `<span style="color:#e0663a">✗ ${esc((r && r.error) || "no responde")}</span>`
}
window.aiSaveKey = () => {
  const provider = document.getElementById("ak-prov").value, name = document.getElementById("ak-name").value.trim(), token = document.getElementById("ak-token").value.trim()
  if (!token) { document.getElementById("ak-out").innerHTML = '<span style="color:#e0663a">Falta la key.</span>'; return }
  _aiDraft.keysList.push({ id: provider + "-" + Date.now().toString(36), provider, name: name || AI_PLABEL[provider], token, hasToken: true, _new: true })
  _aiRender()
}
window.aiDel = (id) => { _aiDraft.keysList = _aiDraft.keysList.filter((k) => k.id !== id); for (const a of Object.keys(_aiDraft.routing)) if (_aiDraft.routing[a].keyId === id) delete _aiDraft.routing[a]; _aiRender() }
window.aiRoute = (area, field, val) => { _aiDraft.routing[area] = _aiDraft.routing[area] || {}; if (val) _aiDraft.routing[area][field] = val; else { delete _aiDraft.routing[area][field] }; if (!_aiDraft.routing[area].keyId) delete _aiDraft.routing[area]; if (field === "keyId") _aiRender() }
window.aiTest = async (id) => {
  const o = document.getElementById("aitest-" + id); if (!o) return
  o.textContent = "Probando…"
  const k = _aiDraft.keysList.find((x) => x.id === id)
  const req = (k && k._new) ? { provider: k.provider, token: k.token } : { keyId: id }
  const r = await post("/api/llm-config/test", req).catch(() => null)
  o.innerHTML = r && r.ok ? `<span style="color:var(--ok,#16a34a)">✓ anda (${esc(r.model)})</span>` : `<span style="color:#e0663a">✗ ${esc((r && r.error) || "no responde")}</span>`
}
window.saveLlm = async () => {
  const err = document.getElementById("llmErr"); if (err) err.textContent = "Guardando…"
  const keysList = _aiDraft.keysList.map((k) => k.provider === "ollama" ? { id: k.id, provider: "ollama", name: k.name || "Ollama" } : { id: k.id, provider: k.provider, name: k.name, token: k._new ? k.token : "" })
  const body = { keysList, routing: _aiDraft.routing, stt: (document.getElementById("ai-stt") || {}).value || _aiDraft.stt, ollamaHost: (document.getElementById("ai-host") || {}).value || _aiDraft.ollamaHost }
  const r = await post("/api/llm-config/save", body).catch(() => null)
  if (r && r.ok) { closeSheet(); alert("✅ Motor de IA actualizado."); viewSettings() }
  else if (err) err.textContent = (r && r.error) || "No se pudo guardar."
}
window.pinSheet = async () => {
  const s = await api("/api/auth/status").catch(() => null)
  const has = s && s.pinSet
  const inp = (id, ph) => `<input id="${id}" type="password" inputmode="numeric" maxlength="12" placeholder="${ph}" style="width:100%;box-sizing:border-box;padding:12px;font-size:18px;letter-spacing:4px;text-align:center;border-radius:12px;border:1px solid var(--line);margin-bottom:10px" onkeydown="if(event.key==='Enter')${has ? 'changePin()' : 'savePin()'}">`
  openSheet(`<h2 style="margin:0 0 4px">🔒 ${has ? "Cambiar" : "Crear"} PIN de acceso</h2><div class="sub" style="margin:0 0 12px">Es el PIN para entrar desde internet. ${has ? "Necesitás el actual para cambiarlo." : "Acá en tu equipo no te lo pide."}</div>
    ${has ? inp("oldpin", "PIN actual") : ""}
    ${inp("newpin", has ? "PIN nuevo (6 a 12 dígitos)" : "PIN de 6 a 12 dígitos")}
    <button class="btn" style="width:100%" onclick="${has ? 'changePin()' : 'savePin()'}">${has ? "Cambiar PIN" : "Guardar PIN"}</button>
    <div id="pinerr" style="color:#e0663a;font-size:13px;margin-top:8px"></div>`)
}
window.changePin = async () => {
  const oldPin = (document.getElementById("oldpin") || {}).value || "", newPin = (document.getElementById("newpin") || {}).value || ""
  const e = document.getElementById("pinerr"); if (e) e.textContent = ""
  const r = await post("/api/auth/change-pin", { oldPin, newPin }).catch(() => null)
  if (r && r.ok) { closeSheet(); alert("✅ PIN cambiado.") }
  else if (e) e.textContent = (r && r.error) || "No se pudo cambiar el PIN."
}
// Cerrar sesión en este dispositivo: borra la cookie en el server + limpia cachés locales de esta sesión y vuelve al login (PIN).
window.doLogout = async () => {
  if (!confirm("¿Cerrar sesión en este dispositivo?")) return
  try { await post("/api/auth/logout", {}) } catch {}
  // limpiar estado/cachés locales para no dejar datos de la sesión en el equipo
  try { Object.keys(localStorage).forEach((k) => { if (k.startsWith("c:")) localStorage.removeItem(k) }) } catch {}
  try { indexedDB.deleteDatabase("pipe") } catch {}
  try { if ("caches" in window) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))) } } catch {}
  // el server ya no reconoce la cookie → al ir a "/" sirve la página de login (PIN)
  location.replace("/")
}

// ══════════ NOTAS con IA (segundo cerebro) ══════════
let notesHist = [], notesDig = {}, clipKind = "all", clipItems = [], clipMore = false
let notesCat = "all", notesStatus = "active", notesList = [], notesCats = [], notesJunk = 0
async function viewNotas() {
  render(skel(5), "notas")
  const [dig, ch, nl] = await Promise.all([
    api("/api/notes/digest").catch(() => ({})),
    api("/api/notes/chat").catch(() => ({})),
    api("/api/notes/list?status=active&limit=120").catch(() => ({})),
  ])
  notesDig = dig || {}; notesHist = (ch && ch.history) || []
  notesCat = "all"; notesStatus = "active"
  notesList = (nl && nl.items) || []; notesCats = (nl && nl.categories) || []; notesJunk = (nl && nl.junk) || 0
  paintNotas()
}
// tarjeta de una nota categorizada (título + badge de categoría + canal + acciones)
function noteCard(n) {
  const title = n.clip_title || n.title || (n.text || "").replace(/\s+/g, " ").slice(0, 100) || "(sin título)" // clip_title = título descriptivo del link/video; n.title suele ser la URL cruda
  const chLabel = (CHAN_META[n.channel] && CHAN_META[n.channel][0]) || (n.channel || "")
  const ch = chanIcon(n.channel) // badge de canal (línea + color de marca); "" si el canal no está mapeado
  const s = "event.stopPropagation();"
  const url = ((n.text || "") + " " + (n.title || "")).match(/https?:\/\/\S+/) // link → abre; si no, abre el detalle
  const open = url ? `window.open(${escj(url[0])},'_blank')` : `noteOpen(${escj(n.id)})`
  const acts = n.status === "junk"
    ? `<button class="undo" onclick="${s}noteAct(${escj(n.id)},'approve')" title="Recuperar de junk" aria-label="Recuperar de junk">${IC_UNDO}</button>`
    : `<button class="pin${n.pinned ? " on" : ""}" onclick="${s}noteAct(${escj(n.id)},'${n.pinned ? "unpin" : "pin"}')" title="${n.pinned ? "Quitar de arriba" : "Fijar arriba"}" aria-label="Fijar arriba">${IC_PIN}</button>
       <button onclick="${s}noteAct(${escj(n.id)},'archive')" title="Archivar" aria-label="Archivar">${IC_ARCHIVE}</button>
       <button class="danger" onclick="${s}noteAct(${escj(n.id)},'discard')" title="Descartar" aria-label="Descartar">${IC_X}</button>`
  return `<div class="note tap${n.pinned ? " pinned" : ""}" onclick="${open}">
    <div class="note-main"><div class="note-title">${esc(title)}</div>${n.para ? `<div class="tiny muted" style="margin-top:3px;line-height:1.4">${esc(n.para)}</div>` : ""}
      <div class="note-meta">${n.category ? `<span class="nt-tema">${esc(n.category)}</span>` : ""}${ch || (chLabel ? `<span class="note-chan">${esc(chLabel)}</span>` : "")}<span class="note-time">${ago(n.ts)}</span></div></div>
    <div class="note-acts">${acts}</div></div>`
}
window.noteOpen = (id) => {
  const n = notesList.find((x) => x.id === id); if (!n) return
  const media = n.mediaType === "audio" && n.media ? `<div style="margin-bottom:10px">${spdAudio(`<audio controls preload="metadata" src="${n.media}" style="flex:1;min-width:0"></audio>`)}</div>`
    : (n.media ? `<img src="${n.media}" alt="Imagen de la nota" style="max-width:100%;border-radius:10px;margin-bottom:10px">` : "")
  openSheet(`<h2 style="margin:0 0 6px">${esc(n.title || "Nota")}</h2><div class="tiny muted" style="margin-bottom:12px">${esc(n.category || "")}${n.channel ? " · " + esc(n.channel) : ""} · ${ago(n.ts)}</div>${media}<div style="white-space:pre-wrap;line-height:1.6;font-size:15px">${fmtText(n.text || n.summary || "")}</div>`)
}
window.loadNotes = async (cat, status) => {
  notesCat = cat; notesStatus = status
  const nl = await api(`/api/notes/list?cat=${encodeURIComponent(cat)}&status=${status}&limit=120`).catch(() => ({}))
  notesList = (nl && nl.items) || []; if (nl && nl.categories) notesCats = nl.categories; if (nl && nl.junk != null) notesJunk = nl.junk
  paintNotas()
}
window.noteAct = async (id, action) => {
  if (action === "archive" || action === "discard" || action === "approve") { notesList = notesList.filter((n) => n.id !== id); paintNotas() } // optimista
  await post("/api/notes/action", { id, action }).catch(() => {})
  loadNotes(notesCat, notesStatus) // refresca lista + contadores
}
const CLIP_ICON = { link: "🔗", text: "💡", todo: "✅", photo: "🖼", video: "🎥", doc: "📄", audio: "🎤" }
const CLIP_TABS = [["all", "Todo"], ["link", "🔗 Links"], ["text", "💡 Notas"], ["todo", "✅ Pendientes"], ["media", "📸 Media"], ["archived", "🗄 Archivados"]]
function clipCard(c) {
  const icon = CLIP_ICON[c.kind] || "📌"
  const open = c.url ? `window.open(${escj(c.url)},'_blank')` : (c.media ? `window.open(${escj(c.media)},'_blank')` : "")
  const thumb = c.kind === "photo" && c.media ? `<div class="clip-thumb" style="background-image:url(${c.media})"></div>` : ""
  const dom = c.url ? `<span class="clip-dom">${esc(((c.url.match(/https?:\/\/([^/]+)/) || [])[1] || "link").replace(/^www\./, ""))}</span>` : ""
  const s = "event.stopPropagation();"
  const acts = `<div class="clip-acts">
    <button onclick="${s}clipPin(${escj(c.id)},${c.pinned ? "false" : "true"})" title="${c.pinned ? "Quitar de arriba" : "Fijar arriba"}">${c.pinned ? "📌" : "📍"}</button>
    <button onclick="${s}clipArchive(${escj(c.id)},${c.archived ? "false" : "true"})" title="${c.archived ? "Desarchivar" : "Archivar"}">${c.archived ? "↩️" : "🗄"}</button>
  </div>`
  return `<div class="clip${open ? " tap" : ""}${c.pinned ? " pinned" : ""}" ${open ? `onclick="${open}"` : ""}>
    <div class="clip-ic">${c.pinned ? "📌" : icon}</div>
    <div style="flex:1;min-width:0"><div class="clip-title">${esc(c.title || c.text || "Clip")}</div>
      ${c.para ? `<div class="clip-para">${esc(c.para)}</div>` : (c.enriched ? "" : `<div class="clip-para dim">analizando…</div>`)}
      <div class="clip-meta">${dom}<span>${ago(c.ts)}</span></div></div>${thumb}${acts}</div>`
}
window.clipPin = async (id, on) => { await post("/api/clip/pin", { id, on }).catch(() => {}); loadClips(clipKind) }
window.clipArchive = async (id, on) => { await post("/api/clip/archive", { id, on }).catch(() => {}); loadClips(clipKind) }
function paintNotas() {
  const d = notesDig, has = d && d.generatedAt && !d.empty
  const digestCard = has ? `
    ${d.resumen ? `<div class="hb-brief"><div class="hb-brief-glow"></div><div class="hb-eyebrow"><span class="ei">${SVG.spark}</span>Resumen de tus notas</div><div class="hb-brief-txt">${esc(d.resumen)}</div><div class="tiny muted" style="margin-top:8px;font-variant-numeric:tabular-nums">${d.count || 0} notas · últimos 30 días</div></div>` : ""}
    ${d.reflexion ? `<div class="nt-reflex"><div class="hb-eyebrow accent"><span class="ei">${IC_ROBOT}</span>La IA piensa</div><div class="nt-reflex-txt">${esc(d.reflexion)}</div>${(d.temas && d.temas.length) ? `<div class="nt-temas">${d.temas.map((t) => `<span class="nt-tema">${esc(t)}</span>`).join("")}</div>` : ""}</div>` : ""}
  ` : `<div class="hb-empty" style="text-align:center;margin:12px 0">${d && d.empty ? "Todavía no tengo notas para resumir." : "Generando el resumen…"}</div>`

  const catChips = `<div class="nt-quick">
    <button class="chip${notesStatus === "active" && notesCat === "all" ? " on" : ""}" onclick="loadNotes('all','active')">Todo</button>
    ${notesCats.map((c) => `<button class="chip${notesStatus === "active" && notesCat === c.category ? " on" : ""}" onclick="loadNotes(${escj(c.category)},'active')">${esc(c.category)}<span class="n">${c.n}</span></button>`).join("")}
    <button class="chip junk${notesStatus === "junk" ? " on" : ""}" onclick="loadNotes('all','junk')"><span class="ei">${IC_TRASH}</span>Junk${notesJunk ? `<span class="n">${notesJunk}</span>` : ""}</button>
  </div>`
  const notesHtml = notesList.length ? notesList.map(noteCard).join("") : `<div class="nt-none">${notesStatus === "junk" ? "Nada en la papelera." : "No hay notas en esta categoría."}</div>`

  const quick = ["Resumí mis notas de esta semana", "¿Qué estoy postergando?", "¿Qué links guardé para leer?"]
  const chatBubbles = notesHist.map((m) => `<div class="nt-msg ${m.role}">${m.role === "ai" ? fmtText(m.text) : esc(m.text)}</div>`).join("")
  render(`<div class="screen">
    <div class="spread" style="align-items:center;margin-bottom:12px"><h2 class="nt-h"><span class="ei">${SVG.notes}</span>Notas</h2><div class="row" style="gap:8px;padding:0;background:none;box-shadow:none;margin:0"><button class="chip" onclick="notesRegen(this)" title="Regenerar resumen" aria-label="Regenerar resumen"><span class="ei">${IC_SYNC}</span></button><button class="chip" onclick="go('#notas-raw')">Chat crudo</button></div></div>
    ${digestCard}
    <div class="hb-card-title nt-sec"><span class="ei">${IC_FOLDER}</span>Tus notas</div>
    ${catChips}
    <div id="noteList">${notesHtml}</div>
    <div class="hb-card-title nt-sec"><span class="ei">${SVG.chat}</span>Hablá con tu cerebro</div>
    <div class="nt-quick">${quick.map((q) => `<button class="chip" onclick="notesQuick(${escj(q)})">${esc(q)}</button>`).join("")}</div>
    <div id="ntChat" class="nt-chat">${chatBubbles || '<div class="tiny muted" style="text-align:center;padding:14px">Preguntame sobre tus notas: resumime, buscá un link, decime qué dejé pasar…</div>'}</div>
    <div class="nt-inbar"><input id="ntInput" placeholder="Escribí a tu segundo cerebro…" onkeydown="if(event.key==='Enter')notesAsk()"><button onclick="notesAsk()" aria-label="Enviar">${IC_SEND}</button></div>
  </div>`, "notas")
  const c = document.getElementById("ntChat"); if (c) c.scrollTop = c.scrollHeight
}
window.loadClips = async (kind) => { clipKind = kind; const cl = await api(`/api/notes/clips?kind=${kind}&limit=30`).catch(() => ({})); clipItems = (cl && cl.items) || []; clipMore = !!(cl && cl.hasMore); paintNotas() }
window.moreClips = async () => { const last = clipItems[clipItems.length - 1]; const cl = await api(`/api/notes/clips?kind=${clipKind}&before=${(last && last.ts) || 0}&limit=30`).catch(() => ({})); clipItems = [...clipItems, ...((cl && cl.items) || [])]; clipMore = !!(cl && cl.hasMore); paintNotas() }
window.notesQuick = (q) => { const inp = document.getElementById("ntInput"); if (inp) { inp.value = q; notesAsk() } }
window.notesAsk = async () => {
  const inp = document.getElementById("ntInput"); if (!inp) return
  const q = inp.value.trim(); if (!q) return
  inp.value = ""
  notesHist.push({ role: "user", text: q, ts: Date.now() })
  const c = document.getElementById("ntChat")
  if (c) { c.innerHTML = notesHist.map((m) => `<div class="nt-msg ${m.role}">${m.role === "ai" ? fmtText(m.text) : esc(m.text)}</div>`).join("") + `<div class="nt-msg ai pending">${ORB} pensando…</div>`; c.scrollTop = c.scrollHeight }
  const r = await post("/api/notes/chat", { q }).catch(() => null)
  notesHist = (r && r.history) || [...notesHist, { role: "ai", text: (r && r.answer) || "No pude responder ahora.", ts: Date.now() }]
  if (c) { c.innerHTML = notesHist.map((m) => `<div class="nt-msg ${m.role}">${m.role === "ai" ? fmtText(m.text) : esc(m.text)}</div>`).join(""); c.scrollTop = c.scrollHeight }
}
window.notesRegen = async (btn) => { if (btn) { btn.textContent = "↻ …"; btn.disabled = true }; await post("/api/notes/regen", {}).catch(() => {}); setTimeout(() => viewNotas(), 6000) }

// ══════════ MENSAJES / BANDEJA ══════════
// map del bucket del backend → sección de la app
const bucketCat = (t) => t.espacio ? "todo" : t.bucket === "spam" ? "spam" : t.group ? "grupos" : t.bucket === "family" ? "familia" : t.bucket === "amigos" ? "amigos" : "trabajo"
let inboxRows = [] // hilos cargados (para filtrar en vivo sin refetch)
// firma barata del estado de la bandeja → el auto-refresh no repinta el DOM si nada cambió (evita churn/flicker cada 25s)
const threadsSig = (rows) => (rows || []).length + ":" + ((rows || [])[0]?.ts || 0) + ":" + ((rows || [])[0]?.key || "") + ":" + (rows || []).reduce((a, t) => a + (t.unseen ? 1 : 0), 0)
let _threadsSig = ""
async function viewMensajes() {
  render(skel(6), "mensajes")
  const g = await api("/api/groups").catch(() => null); ST.groups = (g && g.groups) || ST.groups || []; ST.contactGroups = (g && g.contactGroups) || ST.contactGroups || {}
  apiSWR("/api/threads?limit=600", (r) => paintMensajes(r || []))
}
// ── MODO UNIR CONTACTOS (multi-selección de hilos → fusionar duplicados) — mismo patrón que fwdSel de los mensajes ──
let mergeSel = null // Set de KEYS seleccionadas (modo "unir"); null = fuera de modo. El 1º seleccionado es el que se conserva.
const threadItem = (t) => {
  const chs = [...new Set([t.lastChannel, ...(t.channels || [])])].filter((c) => CHAN_ICON[c]).slice(0, 3)
  const prev = (t.lastDir === "out" ? "→ " : "") + (t.lastText || "")
  const isEsp = t.espacio
  if (mergeSel) { // en modo "unir": checkbox por fila; espacios y filas sin clave no se pueden fusionar → se ocultan
    if (isEsp || !t.key) return ""
    const on = mergeSel.has(t.key)
    return `<div class="thread${on ? " pinned" : ""}" style="cursor:pointer${on ? ";background:color-mix(in srgb, var(--accent) 14%, transparent)" : ""}" onclick="toggleMergeSel('${enck(t.key)}')">
      <span style="font-size:20px;flex-shrink:0;align-self:center;margin-right:2px" aria-hidden="true">${on ? "☑️" : "⬜"}</span>
      ${avatar(t.name, t.photo)}
      <div class="th-main"><div class="th-top"><span class="th-name">${esc(t.name)}</span><span class="th-icons">${chs.map(chanIcon).join("")}</span></div><div class="th-prev">${esc(prev) || "…"}</div></div>
    </div>`
  }
  const nav = isEsp ? `go('#espacio/${t.espId}')` : `go('#conv/${enck(t.key)}')`
  const av = isEsp ? `<div class="av esp-av">${espIcon(t.icon)}</div>` : avatar(t.name, t.photo)
  const pinBtn = isEsp ? "" : `<button class="th-pin${t.pinned ? " on" : ""}" onclick="event.stopPropagation();togglePinThread('${enck(t.key)}',${t.pinned ? "false" : "true"})" title="${t.pinned ? "Quitar de arriba" : "Fijar arriba"}" aria-label="Fijar arriba" style="background:none;border:0;cursor:pointer;font-size:15px;padding:2px 4px;opacity:${t.pinned ? "1" : ".28"}">📌</button>`
  return `<div class="thread${t.unseen ? " unread" : ""}${isEsp ? " isesp" : ""}${t.pinned ? " pinned" : ""}${t.escalated ? " escalated" : ""}" onclick="${nav}">
    ${av}
    <div class="th-main">
      <div class="th-top"><span class="th-name">${esc(t.name)}</span>${t.escalated ? '<span title="' + esc(t.escalatedReason || "El piloto te lo pasó — revisá vos") + '" style="font-size:12.5px;flex-shrink:0">🏖️⚠️</span>' : (t.autopilot ? '<span title="Piloto automático activo" style="font-size:12.5px;flex-shrink:0">🤖</span>' : "")}${isEsp ? '<span class="esp-badge">Espacio</span>' : ""}<span class="th-icons">${chs.map(chanIcon).join("")}</span></div>
      ${t.escalated ? `<div class="th-esc">🏖️ El piloto te lo pasó${t.escalatedReason ? " · " + esc(t.escalatedReason) : ""}</div>` : ""}
      <div class="th-prev">${esc(prev) || "…"}</div>
    </div>
    <div class="th-side" style="align-items:center">${pinBtn}<span class="th-time">${ago(t.ts)}</span>${t.unseen ? '<span class="th-dot"></span>' : ""}</div>
  </div>`
}
// filtro de búsqueda por IDENTIDAD (nombre, teléfono, email) — no busca en el cuerpo de los mensajes (eso es "por conversación", va después)
function matchQuery(t, nq, ndig) {
  if (!nq) return true
  const hay = `${t.name || ""} ${t.key || ""} ${t.email || ""} ${t.grp || ""} ${t.ident || ""}`.toLowerCase()
  if (hay.includes(nq)) return true
  if (ndig.length >= 3 && hay.replace(/\D/g, "").includes(ndig)) return true // por número, ignorando formato
  return false
}
function paintMensajes(rows) {
  inboxRows = rows; _threadsSig = threadsSig(rows)
  setAppBadge(rows.filter((t) => t.unseen && !t.espacio && !t.silenced).length) // badge: nº de conversaciones con algo nuevo (los silenciados no cuentan)
  ST.availChans = [...new Set(rows.flatMap((t) => t.channels || []).concat(rows.map((t) => t.lastChannel)))].filter((c) => c && chanLabel[c])
  const cats = ST.cats || [], chans = ST.chans || [], statuses = ST.statuses || []
  // tabs = Todo + tus grupos (auto editables + custom). Una sola fila para organizar por relevancia.
  const silN = rows.filter((t) => t.silenced).length // hilos silenciados: la pestaña solo aparece si hay alguno
  const TABS = [["todo", "Todo"], ...(ST.groups || []).map((g) => [g.id, (g.icon ? g.icon + " " : "") + g.name]), ...(silN ? [["_sil", `🔕 Silenciados (${silN})`]] : [])]
  ST.customGroups = new Set((ST.groups || []).filter((g) => g.kind === "custom").map((g) => g.id))
  const curCat = cats[0] || "todo"
  const tabs = TABS.map(([id, l]) => `<button class="ctab${curCat === id ? " on" : ""}" onclick="setCat('${id}')">${l}</button>`).join("")
  // fila de filtros: pill "Filtros N" + chips removibles (canal + estado)
  const STATUS_L = { sinleer: "Sin leer", sinresponder: "Sin responder", leidos: "Leídos", sugeridos: "Sugeridos" }
  const active = [...chans.map((c) => ["chan", c, chanLabel[c] || c]), ...statuses.map((s) => ["status", s, STATUS_L[s] || s])]
  const chips = active.map(([k, id, l]) => `<button class="gchip" onclick="rmFilter('${k}','${id}')">${esc(l)} <span>×</span></button>`).join("")
  const filterBar = `<div class="frow"><button class="filt-pill${active.length ? " on" : ""}" onclick="openFilters()">${SVG.sliders}<span>Filtros</span>${active.length ? `<b>${active.length}</b>` : ""}</button>${chips}</div>`
  const q = ST.q || ""
  // barra fija (modo "unir"): mostrar qué contacto se conserva + acción 🔗 Unir (N). Reusa el look del fwdBar de mensajes.
  const mergeTgt = mergeSel && mergeSel.size ? (inboxRows.find((x) => x.key === [...mergeSel][0]) || {}).name : ""
  const mergeBar = mergeSel ? `<div id="mergebar" style="position:fixed;bottom:82px;left:50%;transform:translateX(-50%);width:100%;max-width:480px;padding:10px 12px;background:var(--bg);border-top:1px solid var(--line);display:flex;gap:8px;z-index:26;box-sizing:border-box;align-items:center">
    <button class="pill" onclick="exitMergeMode()" style="flex-shrink:0">Cancelar</button>
    <div style="flex:1;text-align:center;font-weight:700;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mergeSel.size < 2 ? "Elegí 2 o más para unir" : `Se conserva <b>${esc(mergeTgt)}</b>`}</div>
    <button class="pill on" style="flex-shrink:0;padding:9px 16px${mergeSel.size >= 2 ? "" : ";opacity:.5"}" ${mergeSel.size >= 2 ? 'onclick="doMergeSelected()"' : "disabled"}>🔗 Unir (${mergeSel.size})</button></div>` : ""
  render(`<div class="screen inbox"${mergeSel ? ' style="padding-bottom:96px"' : ""}>
    <div class="ibx-head"><h1>Bandeja</h1><div class="row" style="gap:6px;padding:0;background:none;box-shadow:none"><button class="esp-btn" onclick="mergeMode()" title="Unir contactos duplicados (la misma persona en varios hilos)">${mergeSel ? "✕ Unir" : "🔗 Unir"}</button><button class="esp-btn" onclick="groupsSheet()">🗂 Grupos</button></div></div>
    <div class="ibx-search${q ? " has-q" : ""}${_aiSearch ? " ai" : ""}">
      <span class="ibx-si">${SVG.search}</span>
      <input id="ibxq" value="${esc(q)}" placeholder="${_aiSearch ? "Preguntá con IA: “¿qué acordé con Juan?”" : "Buscar por nombre, teléfono o email…"}" autocomplete="off" autocapitalize="off" spellcheck="false" oninput="onInboxSearch(this.value)" onkeydown="onSearchKey(event)">
      <button class="ibx-clr" onclick="clearInboxSearch()" aria-label="Limpiar">${SVG.close || "✕"}</button>
      <button id="ibxAiBtn" class="ibx-ai${_aiSearch ? " on" : ""}" onclick="toggleAiSearch()" title="Buscar con IA" aria-pressed="${_aiSearch}">${IC_ROBOT}</button>
    </div>
    <div id="ibxai"></div>
    <div class="ctabs">${tabs}</div>
    ${filterBar}
    <div class="ibx-meta" id="ibxmeta"></div>
    <div class="threadlist" id="threadlist"></div>
    <div id="thmore" style="height:1px"></div>
  </div>${mergeBar}`, "mensajes")
  renderInboxList()
  // swipe horizontal entre tabs de categoría (izq = siguiente, der = anterior)
  const tabIds = TABS.map((t) => t[0]), ci = tabIds.indexOf(curCat)
  onSwipe(document.querySelector(".inbox"), () => { if (ci < tabIds.length - 1) setCat(tabIds[ci + 1]) }, () => { if (ci > 0) setCat(tabIds[ci - 1]) })
}
// pinta SOLO la lista (para el filtro en vivo: no re-crea el input → no pierde foco)
function renderInboxList() {
  const list = document.getElementById("threadlist"); if (!list) return
  const cats = ST.cats || [], chans = ST.chans || [], statuses = ST.statuses || []
  const q = (ST.q || "").trim().toLowerCase(), ndig = q.replace(/\D/g, "")
  const chanOf = (t) => t.lastChannel || (t.channels || [])[0]
  const statusPred = (s, t) => s === "sinleer" ? t.unseen : s === "sinresponder" ? t.lastDir === "in" : s === "leidos" ? !t.unseen : s === "sugeridos" ? t.suggested : true
  // con búsqueda activa: buscar en TODO (ignora tab/filtros) — "buscar en el general". Sin búsqueda: respeta tab + filtros.
  // pertenece al grupo: "todo" = todos · custom = está asignado (contactGroups) · auto = su bucket relacional
  const inGroup = (t, gid) => gid === "todo" ? true : (ST.customGroups && ST.customGroups.has(gid)) ? ((ST.contactGroups && ST.contactGroups[t.key]) || []).includes(gid) : bucketCat(t) === gid
  const inSil = (cats || [])[0] === "_sil" // pestaña Silenciados activa
  const matchAll = (t) => {
    if (bucketCat(t) === "spam") return false
    if (q) return matchQuery(t, q, ndig) // buscar ignora pestañas (incluye silenciados, para poder encontrarlos)
    if (inSil) return !!t.silenced // pestaña Silenciados: SOLO los silenciados
    if (t.silenced) return false // en el resto de pestañas: nunca mostrar los silenciados
    return (!cats.length || cats.some((gid) => inGroup(t, gid))) && (!chans.length || chans.includes(chanOf(t))) && (!statuses.length || statuses.some((s) => statusPred(s, t)))
  }
  const shown = inboxRows.filter(matchAll)
  if (!q) shown.sort((a, b) => (b.escalated ? 1 : 0) - (a.escalated ? 1 : 0) || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) // escalados por el piloto arriba de todo, luego fijados (sort estable mantiene recencia); en búsqueda no reordena
  const meta = document.getElementById("ibxmeta")
  if (meta) meta.innerHTML = q ? `<span>${shown.length} ${shown.length === 1 ? "resultado" : "resultados"} para “${esc(ST.q.trim())}”</span>` : ""
  const FIRST = 50
  list.innerHTML = shown.slice(0, FIRST).map(threadItem).join("")
    || `<div class="ibx-empty">${q ? `Nada coincide con “${esc(ST.q.trim())}”.<div class="sub" style="margin-top:4px">Probá con el nombre, el número o el correo.</div>` : "Sin mensajes en esta vista."}</div>`
  const sentinel = document.getElementById("thmore")
  if (sentinel) { sentinel.replaceWith(sentinel.cloneNode(false)) } // corta cualquier IO anterior
  if (shown.length > FIRST) { // scroll infinito: siguiente lote al llegar al final
    let i = FIRST; const s2 = document.getElementById("thmore")
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { list.insertAdjacentHTML("beforeend", shown.slice(i, i + FIRST).map(threadItem).join("")); i += FIRST; if (i >= shown.length) io.disconnect() } }, { rootMargin: "400px" })
    if (s2) io.observe(s2)
  }
}
window.togglePinThread = async (keyEnc, pin) => {
  const key = decodeURIComponent(keyEnc); const t = (inboxRows || []).find((x) => x.key === key); if (t) t.pinned = !!pin // optimista → sube al toque
  renderInboxList()
  await post("/api/contact/pin", { key, pinned: !!pin }).catch(() => {})
}
// ── UNIR CONTACTOS desde la bandeja: seleccionar 2+ hilos duplicados → /api/contact/merge (el 1º seleccionado es el target) ──
window.mergeMode = () => { if (mergeSel) return exitMergeMode(); mergeSel = new Set(); paintMensajes(inboxRows) } // toggle del modo (el 🔗 del header)
window.exitMergeMode = () => { mergeSel = null; paintMensajes(inboxRows) }
window.toggleMergeSel = (keyEnc) => { if (!mergeSel) return; const key = decodeURIComponent(keyEnc); mergeSel.has(key) ? mergeSel.delete(key) : mergeSel.add(key); paintMensajes(inboxRows) }
window.doMergeSelected = async () => {
  if (!mergeSel || mergeSel.size < 2) return
  const keys = [...mergeSel]; const target = keys[0]; const rest = keys.slice(1); const n = keys.length // target = 1º seleccionado (se conserva); el resto se absorbe
  const r = await post("/api/contact/merge", { target, keys: rest }).catch(() => null)
  if (r && !r.error) { mergeSel = null; await viewMensajes(); alert(`✅ ${n} contactos unidos`) } // refresca la bandeja ya fusionada
  else { paintMensajes(inboxRows); alert((r && r.error) || "No se pudo unir — probá de nuevo") } // deja el modo activo para reintentar
}
// ── GRUPOS: gestor (auto editables + custom) accesible desde la Bandeja ──
window.groupsSheet = async () => {
  const g = await api("/api/groups").catch(() => null); const groups = (g && g.groups) || []
  if (g) { ST.groups = groups; ST.contactGroups = g.contactGroups || {} }
  const row = (gr) => `<div class="cfg-r" style="align-items:center;gap:8px">
    <div class="ric" style="font-size:18px">${gr.icon || "🏷️"}</div>
    <input class="inp" value="${esc(gr.name)}" onchange="grpRename('${gr.id}','${gr.kind}',this.value)" style="flex:1;min-width:0;padding:8px;border-radius:9px;border:1px solid var(--line)">
    ${gr.kind === "custom"
      ? `<button class="chip" onclick="grpMembers('${gr.id}')">Contactos${gr.count ? " · " + gr.count : ""}</button><button class="rx" onclick="grpDel('${gr.id}')" title="Borrar grupo">✕</button>`
      : `<button class="rx" onclick="grpHide('${gr.id}')" title="Ocultar" style="font-size:14px">🙈</button>`}</div>`
  openSheet(`<h2 style="margin:0 0 4px">🗂 Tus grupos</h2>
    <div class="sub" style="margin:0 0 12px">Organizá la bandeja por relevancia — cada grupo es una pestaña. Los <b>automáticos</b> los arma la IA por relación (renombralos u ocultalos); creá los <b>tuyos</b> y asignales contactos.</div>
    ${groups.map(row).join("")}
    <div class="row" style="gap:8px;margin-top:12px;padding:0;background:none;box-shadow:none"><input class="inp" id="grp-new" placeholder="Nombre de un grupo nuevo (ej: Clientes)" style="flex:1;min-width:0;padding:10px;border-radius:10px;border:1px solid var(--line)"><button class="btn" style="width:auto;flex:none;padding:11px 16px" onclick="grpNew()">Crear</button></div>`)
}
window.grpRename = async (id, kind, name) => { await post(kind === "auto" ? "/api/groups/auto" : "/api/groups/save", { id, name }).catch(() => {}); ST.groups = null }
window.grpHide = async (id) => { await post("/api/groups/auto", { id, hidden: true }).catch(() => {}); ST.groups = null; groupsSheet() }
window.grpDel = async (id) => { if (!confirm("¿Borrar este grupo? No borra los contactos, solo el grupo.")) return; await post("/api/groups/delete", { id }).catch(() => {}); ST.groups = null; groupsSheet() }
window.grpNew = async () => { const name = (document.getElementById("grp-new").value || "").trim(); if (!name) return; await post("/api/groups/save", { name }).catch(() => {}); ST.groups = null; groupsSheet() }
window.grpMembers = async (id) => {
  const cg = ST.contactGroups || {}
  const rows = (inboxRows || []).filter((t) => !t.espacio).slice(0, 100).map((t) => `<div class="cfg-r" style="align-items:center;cursor:pointer" onclick="grpToggle('${id}','${enck(t.key)}',this)"><div class="ric">${avatar(t.name, t.photo, "sm")}</div><div class="rm" style="flex:1;min-width:0"><b>${esc(t.name)}</b></div><span class="grp-chk" style="font-size:18px">${(cg[t.key] || []).includes(id) ? "☑️" : "⬜"}</span></div>`).join("")
  openSheet(`<button class="cfg-back" onclick="groupsSheet()">${IC_BACK}Grupos</button><h2 style="margin:6px 0 4px">Contactos del grupo</h2><div class="sub" style="margin:0 0 10px">Tocá para agregar o quitar del grupo.</div>${rows || '<div class="sub">Sin contactos en la bandeja.</div>'}`)
}
window.grpToggle = async (id, keyEnc, el) => {
  const key = decodeURIComponent(keyEnc); const cg = ST.contactGroups = ST.contactGroups || {}; const arr = cg[key] = cg[key] || []
  const on = arr.includes(id); cg[key] = on ? arr.filter((x) => x !== id) : [...arr, id]
  const chk = el.querySelector(".grp-chk"); if (chk) chk.textContent = on ? "⬜" : "☑️"
  await post("/api/groups/assign", { key, groupId: id, on: !on }).catch(() => {})
}
window.onInboxSearch = (v) => {
  ST.q = v; const w = document.querySelector(".ibx-search"); if (w) w.classList.toggle("has-q", !!v)
  if (_aiSearch) { const box = document.getElementById("ibxai"); if (box) box.innerHTML = v.trim() ? `<div class="ibx-aihint">${IC_ROBOT}<span>Enter para preguntarle a la IA</span></div>` : ""; return } // en modo IA no filtramos por letra (la IA cuesta) → se dispara con Enter
  renderInboxList()
}
window.clearInboxSearch = () => { ST.q = ""; const inp = document.getElementById("ibxq"); if (inp) { inp.value = ""; inp.focus() } const w = document.querySelector(".ibx-search"); if (w) w.classList.remove("has-q"); const box = document.getElementById("ibxai"); if (box) box.innerHTML = ""; renderInboxList() }
// ── robotito: buscar con IA (Jarvis) desde la bandeja ──
window.toggleAiSearch = () => {
  _aiSearch = !_aiSearch
  const w = document.querySelector(".ibx-search"); if (w) w.classList.toggle("ai", _aiSearch)
  const btn = document.getElementById("ibxAiBtn"); if (btn) { btn.classList.toggle("on", _aiSearch); btn.setAttribute("aria-pressed", _aiSearch) }
  const inp = document.getElementById("ibxq"); if (inp) { inp.placeholder = _aiSearch ? "Preguntá con IA: “¿qué acordé con Juan?”" : "Buscar por nombre, teléfono o email…"; inp.focus() }
  const box = document.getElementById("ibxai"); if (box) box.innerHTML = ""
  if (_aiSearch) onInboxSearch(inp ? inp.value : "")
  else renderInboxList() // volvés a la búsqueda literal instantánea
}
window.onSearchKey = (e) => { if (e.key === "Enter" && _aiSearch) { e.preventDefault(); aiSearchRun() } }
window.aiSearchRun = async () => {
  const q = (ST.q || "").trim(); const box = document.getElementById("ibxai"); if (!box) return
  if (!q) { box.innerHTML = ""; return }
  box.innerHTML = `<div class="ibx-aians"><div class="ai-row">${ORB}<b>Buscando…</b></div></div>`
  const r = await post("/api/router-search", { q }).catch(() => null)
  if (!r) { box.innerHTML = `<div class="ibx-aians"><div class="ai-body">No pude buscar eso ahora — probá de nuevo.</div></div>`; return }
  const chip = r.mode === "facets" ? `<span class="ai-mode fast">⚡ ${esc(r.engine || "facetas")} · 0 tokens</span>` : `<span class="ai-mode">🧠 IA · RAG</span>`
  const srcChips = (r.threads || []).slice(0, 5).map((t) => `<span class="ai-src" onclick="go('#conv/${enck(t.key)}')" title="${esc(t.summary || "")}">${esc(t.name || t.key)}${t.path && t.path.length ? ` <i>· ${esc(t.path.join(" → "))}</i>` : ""}</span>`).join("")
  if (r.type === "find") { // "memes de messi", "documentación de globex" → resultados directos, sin síntesis
    const rows = (r.results || []).map((m) => {
      const label = m.filename || m.text || m.mediaType || "archivo"
      const thumb = /image/i.test(m.mediaType || "") && m.media ? `<div class="ai-thumb" style="background-image:url('${m.media}')"></div>` : `<div class="ai-thumb ai-file">${m.filename ? "📄" : "🖼"}</div>`
      return `<div class="ai-res" onclick="go('#conv/${enck(m.key)}')">${thumb}<div class="ai-res-tx"><b>${esc(String(label).slice(0, 80))}</b><span>${esc(m.name || "")} · ${ago(m.ts)}</span></div></div>`
    }).join("")
    const n = (r.results || []).length
    box.innerHTML = `<div class="ibx-aians"><div class="ai-head">${IC_ROBOT}<span>${n} resultado${n === 1 ? "" : "s"}</span>${chip}</div>${rows || '<div class="ai-body">No encontré media/archivos en esas conversaciones.</div>'}${srcChips ? `<div class="ai-srcs">En: ${srcChips}</div>` : ""}</div>`
    return
  }
  const ans = r.answer || "No pude responder eso — probá reformular."
  window.__lastAsk = { q, ans }
  const meta = r.matches != null ? `<div class="ai-meta">${r.matches} fragmento${r.matches === 1 ? "" : "s"}${r.ragMode ? ` · ${esc(r.ragMode)}` : ""}${r.degraded ? " · RAG degradado" : ""}</div>` : ""
  box.innerHTML = `<div class="ibx-aians"><div class="ai-head">${IC_ROBOT}<span>Respuesta de tu cerebro</span>${chip}</div><div class="ai-body">${fmtText(ans)}</div>${srcChips ? `<div class="ai-srcs">Fuentes: ${srcChips}</div>` : ""}${meta}<div class="ai-foot"><span class="hb-link" onclick="askToJarvis()">Seguir en Jarvis →</span></div></div>`
}
window.setCat = (id) => { ST.q = ""; ST.cats = id === "todo" ? [] : [id]; viewMensajes() }
window.rmFilter = (k, id) => { if (k === "chan") ST.chans = (ST.chans || []).filter((x) => x !== id); else ST.statuses = (ST.statuses || []).filter((x) => x !== id); viewMensajes() }
window.openFilters = () => {
  const chans = ST.chans || [], statuses = ST.statuses || []
  const cchip = (id, l) => `<button class="tchip${chans.includes(id) ? " on" : ""}" onclick="stChan('${id}')">${chanIcon(id)}${l}</button>`
  const schip = (id, l) => `<button class="tchip${statuses.includes(id) ? " on" : ""}" onclick="stStatus('${id}')">${l}</button>`
  openSheet(`<h2 style="margin:0 0 2px">Filtros</h2><div class="sub" style="margin:0 0 12px">Combiná canal y estado</div>
    <div class="section-title" style="margin:2px 0 7px">Canal</div><div class="chipwrap">${(ST.availChans || []).map((c) => cchip(c, chanLabel[c] || c)).join("") || '<span class="sub">—</span>'}</div>
    <div class="section-title" style="margin:14px 0 7px">Estado</div><div class="chipwrap">${schip("sinleer", "Sin leer")}${schip("sinresponder", "Sin responder")}${schip("leidos", "Leídos")}${schip("sugeridos", "✨ Sugeridos")}</div>
    <button class="btn" style="width:100%;margin-top:16px" onclick="closeSheet();viewMensajes()">Listo</button>
    <button class="btn ghost" style="width:100%;margin-top:6px" onclick="ST.chans=[];ST.statuses=[];closeSheet();viewMensajes()">Limpiar filtros</button>`)
}
window.stChan = (id) => { ST.chans = toggleIn(ST.chans, id); openFilters() }
window.stStatus = (id) => { ST.statuses = toggleIn(ST.statuses, id); openFilters() }
// filtros multi-selección: toggle dentro de cada fila; "__all" limpia esa fila
function toggleIn(arr, id) { arr = arr || []; if (id === "__all") return []; return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] }
window.toggleCat = (id) => { ST.cats = toggleIn(ST.cats, id); viewMensajes() }
window.toggleChan = (id) => { ST.chans = toggleIn(ST.chans, id); viewMensajes() }
window.toggleStatus = (id) => { ST.statuses = toggleIn(ST.statuses, id); viewMensajes() }
window.archiveThread = async (keyEnc) => { await post("/api/contact/archive", { key: decodeURIComponent(keyEnc), on: true }); viewMensajes() }
window.spamSender = async (keyEnc) => { const key = decodeURIComponent(keyEnc); await post("/api/contact/spam", { key, addr: key.replace(/^email:/, "") }); viewMensajes() }

// ══════════ CONVERSACIÓN UNIFICADA ══════════
let convState = null
const fmtText = (t) => esc(t).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:var(--accent);word-break:break-all">$1</a>')
// pill de velocidad estilo WhatsApp: cicla 1x → 1.25 → 1.5 → 2x sobre el <audio>/<video> del mismo contenedor
window.cycleSpeed = (btn) => { const m = btn.parentElement.querySelector("audio,video"); if (!m) return; const r = [1, 1.25, 1.5, 2]; const n = r[(r.indexOf(m.playbackRate) + 1) % r.length] || 1; m.playbackRate = n; btn.textContent = n + "x" }
const spdVideo = (media) => `<div style="position:relative;display:inline-block;line-height:0">${media}<button onclick="cycleSpeed(this)" title="Velocidad" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;border:0;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;line-height:1.35;cursor:pointer">1x</button></div>`
const spdAudio = (media) => `<div style="display:flex;align-items:center;gap:8px">${media}<button onclick="cycleSpeed(this)" title="Velocidad" style="background:var(--bg,#eef);color:var(--accent);border:1px solid var(--line);border-radius:999px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer;flex:none">1x</button></div>`
function mediaHtml(it) { if (!it.media) return ""
  if (it.mediaType === "image") return `<img src="${it.media}" alt="Imagen del mensaje" loading="lazy" style="max-width:230px;border-radius:12px;display:block;cursor:pointer" onclick="window.open('${it.media}')" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'small muted',textContent:'🖼 imagen no disponible'}))">`
  if (it.mediaType === "video") return spdVideo(`<video src="${it.media}" controls preload="none" style="max-width:250px;border-radius:12px;display:block"></video>`)
  if (it.mediaType === "audio") return spdAudio(`<audio src="${it.media}" controls preload="metadata" style="max-width:200px;display:block"></audio>`)
  return `<a href="${it.media}" target="_blank" class="row" style="padding:9px 11px;background:#fff;border-radius:10px;text-decoration:none;color:inherit;gap:9px;min-width:180px"><span style="font-size:22px">📄</span><div style="min-width:0"><div class="sb small" style="word-break:break-word">${esc(it.filename || it.text || "Documento")}</div><div class="tiny" style="color:var(--accent)">Abrir / descargar</div></div></a>` }
const audioSum = (it) => it.audioSummary && it.summary ? `<div class="aud-sum">${esc(it.summary)}</div>` : ""
const convContent = (it) => it.covert // modo encubierto: mostrás el texto DESCIFRADO + badge para ver el poema original (lo que ve WhatsApp)
  ? `${fmtText(it.covert.text)}<div class="tiny" style="opacity:.7;margin-top:3px;cursor:pointer;color:var(--accent)" onclick='event.stopPropagation();covertReveal(${escj(it.id)})'>🕊️ descifrado · ver original</div>`
  : it.mediaType === "call"
  ? `<div class="call-chip">${esc(it.text || "📞 Llamada")}<div class="tiny" style="opacity:.7;margin-top:2px">Contestá desde WhatsApp</div></div>`
  : (it.media ? mediaHtml(it) + audioSum(it) + (it.text && !/^(🖼|📹|🎤|📄|🌟|📎|📍|👤)/.test(it.text) ? `<div style="margin-top:5px">${fmtText(it.text)}</div>` : "") : fmtText(it.text))
const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") }
const dayKey = (ts) => new Date(ts).toDateString()
function dayLabel(ts) {
  const d = new Date(ts), n = new Date(), day = 864e5
  const diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / day)
  if (diff === 0) return "Hoy"; if (diff === 1) return "Ayer"
  if (diff > 1 && diff < 7) return d.toLocaleDateString("es", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase())
  return d.toLocaleDateString("es", { day: "numeric", month: "long", ...(d.getFullYear() !== n.getFullYear() ? { year: "numeric" } : {}) })
}
const dateSep = (ts) => `<div class="daysep" data-label="${dayLabel(ts)}" style="text-align:center;margin:16px 0 10px"><span style="background:#e6eaf0;color:var(--muted);padding:4px 13px;border-radius:9px;font-size:12px;font-weight:600;text-transform:capitalize">${dayLabel(ts)}</span></div>`
const timeEl = (it) => `<span style="font-size:10px;color:${it.dir === "out" ? "#6b9a80" : "var(--muted2)"};margin-left:8px;white-space:nowrap;float:right;position:relative;top:5px">${hhmm(it.ts)}${it.dir === "out" ? " ✓✓" : ""}</span>`
function convBubble(it) {
  if (it.channel === "ai-summary" || it.dir === "ai") {
    const rl = { day: "último día", week: "última semana", month: "último mes", all: "toda la historia" }[it.aiRange] || ""
    return `<div class="card" style="margin:10px 0;padding:14px;border:1.5px solid var(--accent);background:var(--bg2)">
    <div class="row spread" style="gap:8px;margin-bottom:6px"><span class="tag" style="background:#ece9ff;color:var(--accent)">✨ Resumen IA${rl ? ` · ${rl}` : ""}</span><span class="tiny muted">${hhmm(it.ts)}</span></div>
    <div class="small" style="white-space:pre-wrap;line-height:1.5">${fmtText(it.text || "")}</div>
    <div class="tiny muted" style="margin-top:8px">🔒 Solo para vos — no se envió</div></div>`
  }
  if (it.channel === "meeting") {
    const proc = /^⏳/.test(it.text || "")
    return `<div class="card" style="margin:8px 0;padding:14px;border-left:3px solid var(--accent)">
    <div class="row spread" style="gap:8px;margin-bottom:6px"><span class="tag" style="background:#ece9ff;color:var(--accent)">🎙 Reunión</span><span class="tiny muted">${hhmm(it.ts)}</span></div>
    ${it.summary ? `<div class="small" style="margin-bottom:6px"><span style="color:var(--accent)">💡</span> ${fmtText(it.summary)}</div>` : ""}
    <div class="small" style="white-space:pre-wrap${proc ? ";color:var(--muted)" : ""}">${fmtText(it.text || "")}</div>
    ${it.hasBody ? `<div class="small" style="color:var(--accent);margin-top:8px;cursor:pointer" onclick='showEmailFull(${escj(it.id)})'>📄 Ver transcripción completa →</div>` : ""}</div>`
  }
  if (it.channel === "email") {
    const subject = (it.text || "").split(" — ")[0] || "(sin asunto)"
    const preview = (it.text || "").slice(subject.length + 3).trim()
    const gist = it.summary
      ? `<div class="small" style="margin-bottom:4px"><span style="color:var(--accent)">💡</span> ${fmtText(it.summary)}</div>`
      : `<div class="small muted" style="max-height:60px;overflow:hidden">${fmtText(preview) || (it.hasBody ? "📄 Contenido en imágenes/HTML — abrilo para verlo" : "")}</div>`
    return `<div class="card" style="margin:8px 0;padding:14px">
    <div class="row spread" style="gap:8px;margin-bottom:6px"><span class="tag email">✉️ ${it.dir === "out" ? "Enviado a" : "Email de"} ${esc(it.name || "")}</span><span class="tiny muted">${hhmm(it.ts)}</span></div>
    <div class="b small" style="margin-bottom:3px">${esc(subject)}</div>
    ${gist}
    <div class="small" style="color:var(--accent);margin-top:8px;cursor:pointer" onclick='showEmailFull(${escj(it.id)})'>${it.hasBody ? "📖 Abrir email completo →" : "Ver email completo →"}</div></div>`
  }
  // 🤖 respondido por el piloto automático → badge clickeable para calificar (como el "ver original" de la paloma)
  const autoBadge = it.auto ? `<div class="tiny" style="opacity:.75;margin-top:3px;cursor:pointer;color:var(--accent)" onclick='event.stopPropagation();autopilotFeedbackSheet(${escj(it.id)}, ${escj(it.text || "")})'>🤖 lo respondió el piloto · calificar</div>` : ""
  const bubble = it.dir === "out"
    ? `<div class="bubble out">${convContent(it)}${autoBadge}${timeEl(it)}</div>`
    : `<div class="row" style="align-items:flex-end;gap:8px;margin:5px 0">${avatar(it.name, it.photo, "sm")}<div style="min-width:0"><div class="tiny sb" style="color:${color(it.name)};margin:0 4px 2px">${esc(it.name || "")}</div><div class="bubble in" style="margin:0">${convContent(it)}${timeEl(it)}</div></div></div>`
  if (!fwdSel) { // fuera de modo selección: burbuja + botón ⋯ (Responder / Reenviar / Copiar), como WhatsApp
    const menuBtn = `<button onclick='msgMenu(${escj(it.id)})' aria-label="Opciones del mensaje" title="Responder · Reenviar · Copiar" style="border:0;background:transparent;color:var(--muted2);font-size:19px;line-height:1;padding:2px 5px;cursor:pointer;opacity:.5;flex-shrink:0;align-self:center">⋯</button>`
    return it.dir === "out"
      ? `<div style="display:flex;justify-content:flex-end;align-items:center;gap:1px">${menuBtn}${bubble}</div>`
      : `<div style="display:flex;align-items:center;gap:1px">${bubble}${menuBtn}</div>`
  }
  const on = fwdSel.has(it.id) // en modo selección: checkbox + toca para (de)seleccionar
  return `<div class="row" style="gap:8px;align-items:center;margin:2px 0;cursor:pointer;border-radius:12px;${on ? "background:color-mix(in srgb, var(--accent) 12%, transparent)" : ""}" onclick='toggleSel(${escj(it.id)})'><span style="font-size:19px;flex-shrink:0">${on ? "☑️" : "⬜"}</span><div style="flex:1;min-width:0;pointer-events:none">${bubble}</div></div>`
}
function renderConv() {
  const d = convState
  const remaining = (d.total || 0) - d.items.length
  const moreBtn = d.hasMore ? `<div class="card itemtap" style="text-align:center;color:var(--accent);margin-bottom:10px;padding:10px" onclick="loadOlder()">▲ Cargar mensajes anteriores${remaining > 0 ? ` (${remaining} más)` : ""}</div>` : ""
  // cuerpo con LÍNEAS SEPARADORAS de fecha (como WhatsApp)
  // marca de "no leído": si me perdí ≥3 mensajes desde la última visita, línea divisoria + botón de resumen IA
  const unreadMark = (d.unread >= 3 && d.lastSeen) ? d.lastSeen : 0
  let lastDay = null, body = "", divInserted = false
  for (const it of d.items) {
    if (unreadMark && !divInserted && (it.dir !== "out") && (it.ts || 0) > unreadMark) {
      body += `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin:16px 0 6px">
        <div style="display:flex;align-items:center;gap:8px;width:100%"><div style="flex:1;height:1px;background:var(--accent);opacity:.35"></div><span class="tiny b" style="color:var(--accent)">🔔 ${d.unread} mensajes nuevos</span><div style="flex:1;height:1px;background:var(--accent);opacity:.35"></div></div>
        <button class="pill on" style="padding:7px 16px" onclick="catchupSummary()">✨ Ver resumen de lo que me perdí</button></div>`
      divInserted = true
    }
    const dk = dayKey(it.ts); if (dk !== lastDay) { body += dateSep(it.ts); lastDay = dk } body += convBubble(it)
  }
  const canSend = d.key !== "self" // notas propias no se responden
  if (window._covertKey !== d.key) { window._covertKey = d.key; window._covertOn = false } // reset modo encubierto al cambiar de chat
  window._covertStyle = d.covert || "poema" // el hilo informa el estilo si el contacto tiene modo encubierto configurado (si no, null)
  // el toggle 🕊️ (modo encubierto) ahora vive en el HEADER (como en la app), solo si este contacto ya tiene la config en su perfil
  const tg = d.target || {}
  const multi = (d.targets || []).length > 1
  const chanIcon = tg.channel === "email" ? "✉️" : "📱"
  const chanBtn = `<button id="chanBtn" ${multi ? 'onclick="pickTarget()"' : "disabled"} title="${esc(tg.label || "")}" style="min-width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:${multi ? "var(--bg2)" : "#fff"};font-size:17px;cursor:${multi ? "pointer" : "default"};position:relative;flex-shrink:0">${chanIcon}${multi ? '<span style="position:absolute;bottom:-2px;right:-2px;background:var(--accent);color:#fff;border-radius:50%;width:17px;height:17px;font-size:11px;line-height:17px;text-align:center">▾</span>' : ""}</button>`
  const fwdBar = `<div id="composer" style="position:fixed;bottom:82px;left:50%;transform:translateX(-50%);width:100%;max-width:480px;padding:10px 12px;background:var(--bg);border-top:1px solid var(--line);display:flex;gap:8px;z-index:26;box-sizing:border-box;align-items:center">
    <button class="pill" onclick="exitSel()" style="flex-shrink:0">Cancelar</button>
    <div style="flex:1;text-align:center;font-weight:700;font-size:14px">${fwdSel ? fwdSel.size : 0} sel.</div>
    ${(fwdSel && fwdSel.size === 1) ? `<button class="pill" onclick="replySel()" style="flex-shrink:0;padding:9px 14px">↩️ Responder</button>` : ""}
    <button class="pill on" style="flex-shrink:0;padding:9px 16px${(fwdSel && fwdSel.size) ? "" : ";opacity:.5"}" ${(fwdSel && fwdSel.size) ? "onclick=\"fwdPick()\"" : "disabled"}>↪ Reenviar</button></div>`
  // barra de CITA (responder tipo WhatsApp): muestra a qué mensaje estás respondiendo, arriba del input, con ✕ para cancelar
  const replyBar = replyTo ? `<div style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 11px;margin-bottom:6px;background:var(--bg2);border-left:3px solid var(--accent);border-radius:8px;box-sizing:border-box">
    <div style="flex:1;min-width:0"><div class="tiny b" style="color:var(--accent)">↩️ ${esc(replyTo.name)}</div><div class="tiny muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(replyTo.text) || "mensaje"}</div></div>
    <button onclick="cancelReply()" aria-label="Cancelar respuesta" style="border:0;background:transparent;color:var(--muted);font-size:18px;cursor:pointer;flex-shrink:0;padding:2px 6px">✕</button></div>` : ""
  // Composer LIMPIO (mismo patrón que la app): Ai · [canal solo si hay varios] · input grande · 📎 · 🎤 · 🎤IA · ➤.
  // La corrección (Aa) se movió al menú Ai; el modo encubierto (🕊️) al header — antes amontonaban la fila y aplastaban el input.
  const inputRow = `<div style="display:flex;gap:6px;align-items:flex-end;width:100%">
    <button id="aiBtn" onclick="aiMenu()" title="IA: sugerir respuesta / resumir chat / corrección" style="min-width:38px;height:38px;border-radius:50%;border:1.5px solid var(--accent);background:var(--bg2);font-size:15px;font-weight:800;color:var(--accent);cursor:pointer;flex-shrink:0">Ai</button>
    ${multi ? chanBtn : ""}<textarea id="msgInput" rows="1" aria-label="Escribí tu mensaje" placeholder="${tg.channel === "email" ? "Email…" : (window._covertOn ? "🕊️ Mensaje encubierto…" : "Mensaje…")}" autocomplete="off" spellcheck="${_spell}" oninput="growComposer(this)" onpaste="handlePaste(event)" style="flex:1;min-width:0;padding:9px 14px;border-radius:20px;border:1px solid var(--line);background:#fff;font-size:15px;resize:none;max-height:120px;overflow-y:auto;font-family:inherit;line-height:1.3;box-sizing:border-box" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsg()}"></textarea>
    <button id="correctBtn" onclick="toggleCorrect()" title="${window._correctOn ? "Corregir con IA al enviar (tocá para enviar tal cual)" : "Enviar TAL CUAL, sin corregir (tocá para corregir)"}" style="min-width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:${window._correctOn ? "var(--accent)" : "var(--bg2)"};color:${window._correctOn ? "#fff" : "var(--muted)"};font-size:16px;cursor:pointer;flex-shrink:0">✨</button>
    ${tg.channel !== "email" ? `<input type="file" id="mediaInput" accept="image/*,video/*" multiple style="display:none" onchange="onMediaPick(this)"><input type="file" id="stickerInput" accept="image/*" style="display:none" onchange="onStickerPick(this)"><button id="attachBtn" onclick="pickMedia()" title="Enviar fotos o videos (podés elegir varios)" style="min-width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--bg2);font-size:18px;cursor:pointer;flex-shrink:0">📎</button><button id="stickerBtn" onclick="pickSticker()" title="Mandar una imagen como sticker" style="min-width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--bg2);font-size:17px;cursor:pointer;flex-shrink:0">🩷</button><button id="micBtn" onclick="recVoice()" title="Nota de voz (manda el audio)" style="min-width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--bg2);font-size:19px;cursor:pointer;flex-shrink:0">🎤</button><button id="micAiBtn" onclick="recVoice(true)" title="Dictar con IA: hablás y te lo paso a texto (tal cual · corregido · mejorado)" style="min-width:44px;height:38px;border-radius:19px;border:1.5px solid var(--accent);background:var(--bg2);color:var(--accent);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:1px;font-weight:800"><span style="font-size:16px">🎤</span><span style="font-size:10px">IA</span></button>` : ""}
    <button id="sendBtn" onclick="sendMsg()" aria-label="Enviar mensaje" style="min-width:38px;height:38px;border-radius:50%;border:0;background:var(--accent);color:#fff;font-size:17px;cursor:pointer;flex-shrink:0">➤</button></div>`
  const composer = fwdSel ? fwdBar : (canSend ? `<div id="composer" style="position:fixed;bottom:82px;left:50%;transform:translateX(-50%);width:100%;max-width:480px;padding:8px 8px;background:var(--bg);border-top:1px solid var(--line);display:flex;flex-direction:column;align-items:stretch;z-index:26;box-sizing:border-box">${replyBar}${inputRow}</div>` : "")
  render(`<div class="screen" style="padding-top:6px;padding-bottom:${canSend || fwdSel ? "150px" : "20px"}">
    <div id="floatDate" style="position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:30;background:rgba(30,30,42,.82);color:#fff;padding:4px 14px;border-radius:12px;font-size:12px;font-weight:600;opacity:0;transition:opacity .3s;pointer-events:none;text-transform:capitalize;backdrop-filter:blur(4px)"></div>
    <div id="convHeader" style="position:sticky;top:0;z-index:24;background:var(--bg);margin:0 -16px 10px;padding:6px 16px 10px;border-bottom:1px solid var(--line)">
      <button class="back" onclick="go('#mensajes')" style="margin-bottom:4px">‹ Bandeja</button>
      <div class="row"><div class="row itemtap" style="flex:1;min-width:0;gap:10px" onclick="viewPerson('${enck(d.key)}')">${avatar(d.name, d.photo)}<div style="min-width:0"><div class="b" style="font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)} <span class="tiny muted">›</span></div>${d.email ? `<div class="tiny" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="muted">${esc(d.email)}</span>${d.account ? ` <span style="color:var(--accent)">→ ${esc(d.account)}</span>` : ""}</div>` : ""}<div class="sub">${(d.channels || []).map((c) => CH[c] || c).join(" · ") || ""} ${(d.channels || []).length > 1 ? "· unificados" : ""} · ${d.total} msgs</div></div></div>
        ${(canSend && d.covert) ? `<button id="covertBtn" onclick="covertToggle()" class="pill" title="Modo encubierto ON/OFF · la clave se configura en el perfil del contacto" style="flex-shrink:0;background:${window._covertOn ? "var(--accent)" : ""};color:${window._covertOn ? "#fff" : ""}">🕊️</button>` : ""}
        ${(canSend && !d.group) ? `<button onclick="autopilotSheet()" class="pill" title="Piloto automático — responder solo por este contacto" style="flex-shrink:0;background:${d.autopilot ? "var(--accent)" : ""};color:${d.autopilot ? "#fff" : ""}">🤖</button>` : ""}
        <button class="pill" onclick="selMode()" style="flex-shrink:0" title="Seleccionar mensajes para reenviar" aria-label="Seleccionar mensajes">↪</button>
        <button class="pill" onclick="viewMedia('${enck(d.key)}')" style="flex-shrink:0" title="Adjuntos">📎</button>
        <button class="pill" onclick="openContactSettings('${enck(d.key)}')" style="flex-shrink:0" title="Ajustes del contacto" aria-label="Ajustes del contacto">⚙︎</button></div>
    </div>
    ${moreBtn}${body || '<div class="sub" style="text-align:center;margin-top:30px">Sin mensajes.</div>'}
  </div>${composer}`)
  window.onscroll = onConvScroll // globito flotante de fecha al scrollear
  if (convState.key && convState.key !== "self") { armConvPoll(convState.key); loadThreadMeetings(convState.key) } // auto-refresh + tarjeta de reuniones
}
// ── SELECCIONAR + REENVIAR mensajes (multi-selección → elegir destino → /api/send auto-resuelve el canal) ──
let fwdSel = null // Set de ids seleccionados (modo selección múltiple); null = fuera de modo selección
let _fwdIds = null // ids a reenviar desde el menú de UN mensaje (sin entrar en modo selección visual)
let replyTo = null // { id, name, text } — mensaje al que estás respondiendo (barra de cita sobre el composer)
const curFwd = () => (fwdSel && fwdSel.size) ? fwdSel : _fwdIds // set de ids activo para reenviar
window.selMode = () => { fwdSel = new Set(); renderConv() }
window.exitSel = () => { fwdSel = null; renderConv() }
window.toggleSel = (id) => { if (!fwdSel) return; fwdSel.has(id) ? fwdSel.delete(id) : fwdSel.add(id); renderConv() }
window.fwdPick = async () => {
  const sel = curFwd(); if (!sel || !sel.size) return
  const list = (await api("/api/threads?limit=400")) || []; const arr = Array.isArray(list) ? list : (list.threads || [])
  window._fwdOpts = arr.filter((t) => t.key && t.key !== "self" && t.key !== convState.key)
  window._fwdRow = (t) => `<div class="card itemtap" style="padding:10px;margin-bottom:6px;display:flex;gap:10px;align-items:center" onclick='doForward(${escj(t.key)})'>${avatar(t.name, t.photo, "sm")}<div style="flex:1;min-width:0"><div class="b small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div><div class="tiny muted">${(t.channels || [t.channel]).map((c) => CH[c] || c).filter(Boolean).join(" · ")}</div></div></div>`
  openSheet(`<h2>Reenviar a…</h2><div class="sub" style="margin-bottom:8px">${sel.size} mensaje${sel.size === 1 ? "" : "s"}</div><input class="inp" id="fwdSearch" placeholder="Buscar contacto…" oninput="fwdFilter(this.value)" style="margin-bottom:10px"><div id="fwdList" style="max-height:50vh;overflow-y:auto">${window._fwdOpts.slice(0, 60).map(window._fwdRow).join("") || '<div class="sub">Sin contactos.</div>'}</div>`)
}
window.fwdFilter = (q) => { const o = (window._fwdOpts || []).filter((t) => (t.name || "").toLowerCase().includes((q || "").toLowerCase())); const el = document.getElementById("fwdList"); if (el) el.innerHTML = o.slice(0, 60).map(window._fwdRow).join("") || '<div class="sub">Nada.</div>' }
window.doForward = async (destKey) => {
  const sel = curFwd(); if (!sel || !sel.size) return
  // el server reenvía preservando el MEDIA (audio/imagen/archivo); antes se mandaba solo el texto (un audio salía como "audio")
  const ids = [...sel]
  const r = await post("/api/forward", { ids, key: destKey })
  if (r && r.ok) { closeSheet(); fwdSel = null; _fwdIds = null; renderConv(); alert("✓ Reenviado") }
  else alert((r && r.error) || "No se pudo reenviar") // deja el picker abierto → probá otro contacto
}
// ── MENÚ de un mensaje (⋯): Responder (cita) / Reenviar / Copiar — como el menú de WhatsApp ──
const _msgPreview = (it) => (it.text || (it.mediaType ? ({ image: "🖼 Imagen", video: "📹 Video", audio: "🎤 Audio", document: "📄 Documento" }[it.mediaType] || "📎 Adjunto") : "")).replace(/\s+/g, " ").trim()
window.msgMenu = (id) => {
  const it = (convState.items || []).find((m) => m.id === id); if (!it) return
  const who = it.dir === "out" ? "Vos" : (it.name || "")
  openSheet(`<div class="tiny muted" style="margin:0 0 12px"><b>${esc(who)}</b> · ${esc(_msgPreview(it).slice(0, 90)) || "mensaje"}</div>
    <button class="btn" style="width:100%;margin-bottom:8px;display:flex;gap:10px;align-items:center;justify-content:flex-start" onclick='startReply(${escj(id)})'>↩️ Responder</button>
    <button class="btn ghost" style="width:100%;margin-bottom:8px;display:flex;gap:10px;align-items:center;justify-content:flex-start" onclick='fwdOne(${escj(id)})'>↪ Reenviar</button>
    ${(it.media && /^(video|audio|image)$/.test(it.mediaType || "")) ? `<button class="btn ghost" style="width:100%;margin-bottom:8px;display:flex;gap:10px;align-items:center;justify-content:flex-start" onclick='mediaSummarize(${escj(id)})'>🌐 Transcribir y resumir</button>` : ""}
    ${it.text ? `<button class="btn ghost" style="width:100%;display:flex;gap:10px;align-items:center;justify-content:flex-start" onclick='copyMsg(${escj(id)})'>📋 Copiar texto</button>` : ""}`)
}
// #5: transcribe + resume un video/audio/imagen (traducido al español si está en otro idioma). Lo dispara el usuario desde el menú ⋯.
window.mediaSummarize = async (id) => {
  openSheet(`<h2>🌐 Transcribiendo…</h2><div class="sub" style="margin-top:6px">Transcribo y resumo — puede tardar unos segundos.</div><div style="text-align:center;padding:26px;font-size:26px">⏳</div>`)
  const r = await post("/api/media/summarize", { id }).catch(() => null)
  if (!r || r.error) return openSheet(`<h2>No se pudo</h2><div class="sub" style="margin-top:6px">${esc((r && r.error) || "Error al procesar el archivo.")}</div>`)
  const langLbl = r.lang && r.lang !== "es" ? ` <span class="tiny muted">· ${esc(r.lang)}→es</span>` : ""
  openSheet(`<h2 style="margin:0 0 10px">🌐 Resumen${langLbl}</h2>
    <div style="white-space:pre-wrap;line-height:1.6;font-size:15px">${fmtText(r.summary || "(sin resumen)")}</div>
    ${r.transcript ? `<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--accent);font-size:13px">Ver transcripción completa</summary><div style="white-space:pre-wrap;font-size:13.5px;color:var(--muted);margin-top:8px;max-height:42vh;overflow:auto">${esc(r.transcript)}</div></details>` : ""}`)
}
// Responder con CITA: fija la barra sobre el composer (mostrando a qué respondés) y enfoca el input. El texto propio se escribe aparte.
window.startReply = (id) => {
  const it = (convState.items || []).find((m) => m.id === id); if (!it) return
  replyTo = { id, name: it.dir === "out" ? "Vos" : (it.name || "Mensaje"), text: _msgPreview(it).slice(0, 160) }
  closeSheet(); renderConv()
  setTimeout(() => { const inp = document.getElementById("msgInput"); if (inp) inp.focus() }, 60)
}
window.cancelReply = () => { replyTo = null; renderConv(); setTimeout(() => document.getElementById("msgInput")?.focus(), 40) }
window.fwdOne = (id) => { closeSheet(); _fwdIds = new Set([id]); fwdPick() } // reenviar un solo mensaje desde su menú (sin modo selección)
window.copyMsg = (id) => { const it = (convState.items || []).find((m) => m.id === id); if (!it) return; try { navigator.clipboard?.writeText(it.text || "") } catch {} ; closeSheet() }
// compat: el botón "Responder" del modo selección múltiple ahora también usa la barra de cita
window.replySel = () => { const id = fwdSel && fwdSel.size === 1 ? [...fwdSel][0] : null; if (!id) return; fwdSel = null; startReply(id) }
// ESC cancela el modo selección o la respuesta con cita (una sola vez)
if (!window._escSelBound) { window._escSelBound = true; document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (fwdSel || replyTo)) { fwdSel = null; replyTo = null; renderConv() } }) }
// TARJETA de reuniones próximas con este contacto (ver/reprogramar/cancelar) — como Google Calendar
async function loadThreadMeetings(key) {
  document.getElementById("meetCard")?.remove()
  const r = await api("/api/thread/meetings?key=" + enck(key))
  if (!r?.meetings?.length || convState.key !== key) return
  const hdr = document.getElementById("convHeader"); if (!hdr) return
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
  const cards = r.meetings.slice(0, 3).map((m, i) => {
    const dt = new Date(m.start), when = `${dias[dt.getDay()]} ${dt.getDate()}/${dt.getMonth() + 1} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2, "0")}`
    const rsvp = m.guests?.length ? (m.guests.every((g) => g.status === "accepted") ? "✓ confirmada" : m.guests.some((g) => g.status === "declined") ? "✗ rechazada" : "⏳ sin confirmar") : ""
    const join = m.link ? `<button class="pill" style="padding:5px 11px;font-size:12px" onclick="window.open(${escj(m.link)},'_blank')">▶ Unirse</button>` : ""
    const manage = m.canManage ? `<button class="pill" style="padding:5px 11px;font-size:12px" onclick='rescheduleMeeting(${escj(m.id)},${escj(m.title)})'>🔁 Reprogramar</button><button class="pill" style="padding:5px 11px;font-size:12px;color:var(--urgent)" onclick="cancelMeeting(${escj(m.id)})">🗑️</button>` : ""
    return `<div style="padding:${i ? "8px 0 4px;border-top:1px solid var(--line)" : "2px 0 4px"}"><div class="small b">📅 ${esc(m.title)}</div><div class="tiny muted" style="margin:2px 0 6px">${when} · ${rsvp}</div><div class="row" style="gap:6px;flex-wrap:wrap">${join}${manage}</div></div>`
  }).join("")
  hdr.insertAdjacentHTML("afterend", `<div id="meetCard" class="card" style="margin:0 0 10px;padding:9px 12px;background:var(--bg2);border:1px solid var(--line)">${cards}</div>`)
}
window.cancelMeeting = async (id) => {
  if (!confirm("¿Cancelar esta reunión? Se les avisa a los invitados.")) return
  await post("/api/schedule/delete", { platform: "meet", label: "personal", id })
  loadThreadMeetings(convState.key)
}
window.rescheduleMeeting = (id, title) => {
  openSheet(`<h2 style="margin:0 0 4px">🔁 Reprogramar</h2><div class="sub" style="margin-bottom:12px">${esc(title || "")}</div>
    <label class="tiny b">Nueva fecha y hora</label>
    <input class="inp" id="rs-when" type="datetime-local" style="margin:4px 0 12px">
    <label class="tiny b">Duración</label>
    <select class="inp" id="rs-dur" style="margin:4px 0 14px"><option value="30">30 min</option><option value="60">1 hora</option><option value="15">15 min</option><option value="45">45 min</option></select>
    <button class="btn" onclick="doReschedule('${id}')" style="width:100%">Mover la reunión</button>
    <div id="rs-err" style="color:var(--urgent);font-size:13px;margin-top:8px;text-align:center"></div>`)
}
window.doReschedule = async (id) => {
  const wh = document.getElementById("rs-when").value; if (!wh) { const e = document.getElementById("rs-err"); if (e) e.textContent = "Elegí la nueva fecha"; return }
  const [dp, tp] = wh.split("T"), [year, month, day] = dp.split("-").map(Number), [hour, minute] = tp.split(":").map(Number)
  const r = await post("/api/schedule/move", { id, label: "personal", date: { year, month, day, hour, minute }, durationMin: +document.getElementById("rs-dur").value })
  if (!r || r.error) { const e = document.getElementById("rs-err"); if (e) e.textContent = r?.error || "No se pudo mover"; return }
  closeSheet(); loadThreadMeetings(convState.key)
  document.body.insertAdjacentHTML("beforeend", `<div id="schedToast" style="position:fixed;bottom:150px;left:50%;transform:translateX(-50%);z-index:40;background:var(--ok);color:#fff;padding:11px 16px;border-radius:12px;font-size:13.5px;text-align:center">🔁 Reprogramada ${esc(r.when || "")}</div>`)
  setTimeout(() => document.getElementById("schedToast")?.remove(), 4000)
}
// poll estilo AJAX: mensajes nuevos + re-chequeo del calendarizador. Se limpia en render() al navegar.
function armConvPoll(key) {
  checkScheduleIntent(key)
  clearInterval(window._convPoll)
  window._convPoll = setInterval(() => { if (!document.hidden && convState.key === key && document.getElementById("composer")) { refreshConv(key); checkScheduleIntent(key) } }, 5000)
}
let floatTimer = null
window.onConvScroll = () => {
  const seps = [...document.querySelectorAll(".daysep")]; if (!seps.length) return
  let cur = seps[0]
  for (const s of seps) { if (s.getBoundingClientRect().top <= 64) cur = s; else break }
  const fd = document.getElementById("floatDate"); if (!fd) return
  fd.textContent = cur.getAttribute("data-label") || ""
  fd.style.opacity = "1"; clearTimeout(floatTimer); floatTimer = setTimeout(() => { fd.style.opacity = "0" }, 2800)
}
window.aiMenu = () => {
  openSheet(`<h2 style="margin:0 0 4px">✨ IA</h2><div class="sub" style="margin:0 0 14px">Nada de esto se envía — es solo para vos.</div>
    <button class="btn" style="width:100%;text-align:left;margin-bottom:10px;display:flex;gap:10px;align-items:center" onclick="aiSuggest()">💬 <div><div class="b">Sugerir respuesta</div><div class="tiny muted">Un borrador en tu voz según la conversación</div></div></button>
    <button class="btn ghost" style="width:100%;text-align:left;display:flex;gap:10px;align-items:center;margin-bottom:10px" onclick="aiSummarizeMenu()">📝 <div><div class="b">Resumir chat</div><div class="tiny muted">Resumen guardado acá — no se envía</div></div></button>
    <button class="btn ghost" style="width:100%;text-align:left;display:flex;gap:10px;align-items:center" onclick="toggleSpell();closeSheet()"><span style="font-style:italic;font-weight:800">Aa</span> <div><div class="b">Corrección ortográfica <span style="color:var(--accent)">${_spell ? "ON" : "OFF"}</span></div><div class="tiny muted">Las líneas rojas del teclado mientras escribís</div></div></button>`)
}
window.aiSuggest = async () => {
  const d = convState; if (!d) return
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Redactando una respuesta…</b></div>`)
  const r = await api(`/api/thread/suggest-reply?key=${enck(d.key)}`) || {}
  closeSheet()
  const inp = document.getElementById("msgInput")
  if (r.draft && inp) { inp.value = r.draft; growComposer(inp); inp.focus() } else alert("No pude generar una respuesta ahora.")
}
window.aiSummarizeMenu = () => {
  openSheet(`<h2 style="margin:0 0 4px">📝 Resumir chat</h2><div class="sub" style="margin:0 0 14px">¿Desde cuándo?</div>
    ${[["day", "Último día"], ["week", "Última semana"], ["month", "Último mes"], ["all", "Desde el principio de los tiempos"]].map(([r, l]) => `<button class="btn ghost" style="width:100%;text-align:left;margin-bottom:8px" onclick="aiSummarize('${r}')">${l}</button>`).join("")}`)
}
window.aiSummarize = async (range) => {
  const d = convState; if (!d) return
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Resumiendo el chat…</b></div><div class="sub" style="margin-top:8px">Leyendo mensajes y adjuntos. Puede tardar unos segundos.</div>`)
  const r = await api(`/api/thread/summarize?key=${enck(d.key)}&range=${range}`) || {}
  if (!r.summary) return openSheet(`<h2>Resumen</h2><div class="sub">No hay mensajes en ese período o no pude generarlo.</div>`)
  const html = esc(r.summary).replace(/^[-•]\s?/gm, "· ").replace(/\n/g, "<br>")
  openSheet(`<h2 style="margin:0 0 4px">📝 Resumen del chat</h2><div class="sub" style="margin:0 0 12px">${r.count} mensajes${r.media ? ` · 👁 ${r.media} adjuntos` : ""} · guardado en el chat 🔒</div><div style="font-size:15px;line-height:1.6">${html}</div>`)
  viewConv(d.key) // recarga la conversación para que aparezca la nota guardada
}
window.pickTarget = () => {
  const opt = (t, i) => `<button class="btn ${t === convState.target ? "" : "ghost"}" style="text-align:left;margin-bottom:8px;display:flex;align-items:center;gap:8px" onclick="setTarget(${i})">${t.channel === "email" ? "✉️" : "📱"} <span style="flex:1">${esc(t.label)}</span>${t.isDefault ? '<span class="tiny muted">último</span>' : ""}</button>`
  openSheet(`<h2>Responder por…</h2><div class="sub" style="margin:6px 0 12px">Elegí a dónde mandar el mensaje.</div>${(convState.targets || []).map(opt).join("")}`)
}
window.setTarget = (i) => { convState.target = (convState.targets || [])[i]; closeSheet(); renderConv(); document.getElementById("msgInput")?.focus() }
// envío REAL (bubble optimista + POST). Lo llama pickSend con el texto elegido.
window.doSend = async (text) => {
  text = (text || "").trim(); if (!text || !convState) return
  if (replyTo) { const q = (replyTo.text || "").replace(/\s+/g, " ").slice(0, 160); text = `> ${replyTo.name}: ${q}\n${text}`; replyTo = null } // cita (texto) al mensaje respondido; se limpia la barra al enviar
  const t = convState.target || {}
  const ch = t.channel || ((convState.key || "").startsWith("email:") ? "email" : "whatsapp")
  const optId = "opt-" + Date.now()
  const covert = !!window._covertOn // modo encubierto: mando el flag; el server cifra→tapadera antes de enviar. La burbuja muestra tu texto real + badge.
  convState.items = [...(convState.items || []), { id: optId, channel: ch, dir: "out", name: hubName(), ts: Date.now(), text, ...(covert ? { covert: { text, style: window._covertStyle || "poema" } } : {}) }]
  convState.total = (convState.total || 0) + 1
  renderConv(); document.getElementById("msgInput")?.focus(); window.scrollTo(0, document.body.scrollHeight)
  const r = await post("/api/send", { key: convState.key, text, channel: t.channel, target: t.target, covert })
  if (r && r.error) { convState.items = convState.items.filter((x) => x.id !== optId); convState.total = Math.max(0, (convState.total || 1) - 1); renderConv(); alert("No se pudo enviar: " + r.error) }
  else if (covert && r && r.cover) { const it = (convState.items || []).find((x) => x.id === optId); if (it) it.text = r.cover } // guardá el poema real para "ver original"
}
window.pickSend = (enc) => { const inp = document.getElementById("msgInput"); if (inp) inp.value = ""; doSend(decodeURIComponent(enc)) }
// tocar un hueco libre del calendario: agrega "a las HH:MM" al mensaje (no envía), para que el owner revise y mande
window.insertSlot = (label) => { const inp = document.getElementById("msgInput"); if (!inp) return; const cur = inp.value.trim(); inp.value = (cur ? cur + " " : "") + "a las " + label; closeSheet(); growComposer(inp); inp.focus() }

// ── MODO ENCUBIERTO ("El Santo"): cifra tu mensaje como un poema/cuento/etc.; la otra persona con Pipe + la misma clave lo revierte ──
// La CONFIG (clave + estilo) vive en el perfil del contacto. El toggle del composer solo aparece si ya está configurado.
window.covertToggle = () => {
  window._covertOn = !window._covertOn
  const b = document.getElementById("covertBtn"); if (b) { b.style.background = window._covertOn ? "var(--accent)" : "var(--bg2)"; b.style.color = window._covertOn ? "#fff" : "" }
  const inp = document.getElementById("msgInput"); if (inp) inp.placeholder = window._covertOn ? "🕊️ Mensaje encubierto…" : "Mensaje…"
}
// se abre desde el perfil de la persona (o desde el composer): keyEnc = thread key encodeado, name = nombre para el texto
window.covertConfigSheet = async (keyEnc, name) => {
  const key = keyEnc ? decodeURIComponent(keyEnc) : (convState && convState.key)
  if (!key) return
  window._covertSheetKey = key
  const cfg = await fetch(`/api/covert/config?key=${encodeURIComponent(key)}`).then((r) => r.json()).catch(() => ({ styles: [], style: "poema", enabled: false }))
  window._covertStyle = cfg.style || "poema"
  const who = name || (convState && convState.name) || "la otra persona"
  const chips = (cfg.styles || []).map((s) => `<button class="chip" data-cs="${s.id}" onclick="covertPickStyle('${s.id}')" style="border:1.5px solid ${s.id === window._covertStyle ? "var(--accent)" : "var(--line)"};background:${s.id === window._covertStyle ? "var(--accent)" : "var(--bg2)"};color:${s.id === window._covertStyle ? "#fff" : ""}">${s.label}</button>`).join("")
  openSheet(`<h2 style="margin:0 0 4px">🕊️ Modo encubierto</h2>
    <p class="sub" style="margin:0 0 12px">Tus mensajes a <b>${esc(who)}</b> pueden ir <b>cifrados</b>, disfrazados de texto normal. Quien los vea por WhatsApp lee un poema; ${esc(who)}, con Pipe y la misma clave, los ve descifrados. Acordá la clave por un canal seguro (en persona, llamada…).</p>
    <p class="sub" style="margin:-4px 0 12px;font-size:12.5px">¿La otra persona no tiene Pipe? Puede descifrar con la clave en <a href="${location.origin}/decrypt" target="_blank" rel="noopener" style="color:var(--accent)">${location.host}/decrypt</a> 🕊️ (tu propio hub)</p>
    <input id="covPass" type="text" autocomplete="off" spellcheck="false" placeholder="Clave compartida (ej. nuestro café 2019)" oninput="covertPreview()" style="width:100%;box-sizing:border-box;padding:11px 13px;border-radius:12px;border:1px solid var(--line);font-size:15px;margin-bottom:10px">
    <div id="covChips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>
    <div class="tiny muted" style="margin-bottom:4px">Vista previa (así se verá el mensaje):</div>
    <div id="covPrev" style="white-space:pre-wrap;background:var(--bg2);border-radius:12px;padding:11px 13px;font-size:13.5px;line-height:1.5;min-height:44px;max-height:180px;overflow:auto">Escribí una clave arriba…</div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button onclick="covertSave()" class="btn" style="flex:1">${cfg.enabled ? "Guardar cambios" : "Activar modo encubierto"}</button>
      ${cfg.enabled ? `<button onclick="covertDisable()" class="pill" style="flex-shrink:0">Desactivar</button>` : ""}
    </div>`)
}
// ── PILOTO AUTOMÁTICO ("modo vacaciones"): activá/ajustá por contacto + probá qué respondería SIN enviar ──
window.autopilotSheet = async (keyEnc, name) => {
  const key = keyEnc ? decodeURIComponent(keyEnc) : (convState && convState.key)
  if (!key) return
  window._apKey = key
  const cfg = await fetch(`/api/autopilot/config?key=${encodeURIComponent(key)}`).then((r) => r.json()).catch(() => ({ enabled: false, maxPerDay: 5 }))
  const who = name || (convState && convState.name) || "esta persona"
  openSheet(`<h2 style="margin:0 0 4px">🏖️ Piloto automático · ${esc(who)}</h2>
    <p class="sub" style="margin:0 0 12px">La IA responde <b>en tu voz</b> las <b>preguntas simples</b> de ${esc(who)}. Antes de mandar revisa que <b>no suene a IA</b>, que <b>no dé datos que vos no diste</b> y que <b>no acepte reuniones, llamadas, verse, plata ni mandar fotos</b>. Cualquier otra cosa te la <b>escala a vos</b>. Ante la duda, no envía.</p>
    <label class="tiny muted">Límite de respuestas por día — dejalo vacío para <b>sin límite</b> (son conversaciones)</label>
    <input id="apMax" type="number" min="1" max="500" placeholder="sin límite" value="${cfg.maxPerDay > 0 ? cfg.maxPerDay : ""}" style="width:100%;box-sizing:border-box;padding:11px 13px;border-radius:12px;border:1px solid var(--line);font-size:15px;margin:4px 0 12px">
    <button onclick="autopilotPreview()" class="btn ghost" style="width:100%;margin-bottom:8px">👀 Ver qué respondería ahora (sin enviar)</button>
    <div id="apPrev" class="tiny" style="display:none;background:var(--bg2);border-radius:12px;padding:11px 13px;line-height:1.55;margin-bottom:12px"></div>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button onclick="autopilotSave()" class="btn" style="flex:1">${cfg.enabled ? "Guardar cambios" : "Activar piloto automático"}</button>
      ${cfg.enabled ? `<button onclick="autopilotDisable()" class="pill" style="flex-shrink:0">Desactivar</button>` : ""}
    </div>`)
}
window.autopilotPreview = async () => {
  const box = document.getElementById("apPrev"); if (!box) return
  box.style.display = "block"; box.innerHTML = "Pensando qué respondería…"
  const r = (await post("/api/autopilot/preview", { key: window._apKey }).catch(() => null)) || {}
  if (r.action === "would-send") box.innerHTML = `<b style="color:var(--accent)">✓ Respondería:</b><div style="margin-top:6px;white-space:pre-wrap">${esc(r.text || "")}</div>`
  else if (r.action === "escalate") box.innerHTML = `<b>⤴ Te escalaría a vos</b> (no responde solo): ${esc(r.reason || "")}`
  else if (r.action === "skip") box.innerHTML = `Ahora mismo no haría nada: ${esc(r.reason || "")}`
  else box.innerHTML = esc(r.reason || JSON.stringify(r))
}
window.autopilotSave = async () => {
  const raw = (document.getElementById("apMax")?.value || "").trim()
  const max = raw ? Math.max(1, Math.min(500, parseInt(raw, 10) || 0)) : 0 // vacío = 0 = sin límite
  await post("/api/autopilot/config", { key: window._apKey, enabled: true, maxPerDay: max })
  closeSheet(); if (convState && convState.key === window._apKey) viewConv(window._apKey); else if (window._personKey) viewPerson(window._personKey)
}
window.autopilotDisable = async () => {
  await post("/api/autopilot/config", { key: window._apKey, enabled: false })
  closeSheet(); if (convState && convState.key === window._apKey) viewConv(window._apKey); else if (window._personKey) viewPerson(window._personKey)
}
// feedback de un mensaje que respondió el piloto: 👍 bien, o 👎 mal + "qué hubieras dicho" → retroalimenta al respondedor
window.autopilotFeedbackSheet = (id, original) => {
  window._apFbKey = convState && convState.key; window._apFbOrig = decodeURIComponent(original || "")
  openSheet(`<h2 style="margin:0 0 4px">🤖 ¿Cómo respondió el piloto?</h2>
    <div class="sub" style="margin:0 0 12px">"${esc(window._apFbOrig).slice(0, 140)}"</div>
    <div id="apFbBtns" style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn" style="flex:1" onclick="autopilotFbSend(true)">👍 Estuvo bien</button>
      <button class="pill" style="flex:1" onclick="document.getElementById('apFbBtns').style.display='none';document.getElementById('apFbBad').style.display='block'">👎 Estuvo mal</button>
    </div>
    <div id="apFbBad" style="display:none">
      <div class="tiny muted" style="margin-bottom:6px">¿Qué hubieras dicho vos? (así aprende a responder como vos)</div>
      <textarea id="apFbText" rows="3" style="width:100%;box-sizing:border-box;padding:11px 13px;border-radius:12px;border:1px solid var(--line);font-size:14px;font-family:inherit" placeholder="Lo que vos habrías respondido…"></textarea>
      <button class="btn" style="width:100%;margin-top:10px" onclick="autopilotFbSend(false)">Guardar corrección</button>
    </div>`)
}
window.autopilotFbSend = async (good) => {
  const correction = good ? "" : (document.getElementById("apFbText")?.value || "").trim()
  await post("/api/autopilot/feedback", { key: window._apFbKey, good, correction, original: window._apFbOrig }).catch(() => {})
  closeSheet()
}
window.covertPickStyle = (id) => {
  window._covertStyle = id
  document.querySelectorAll("#covChips [data-cs]").forEach((el) => { const on = el.getAttribute("data-cs") === id; el.style.borderColor = on ? "var(--accent)" : "var(--line)"; el.style.background = on ? "var(--accent)" : "var(--bg2)"; el.style.color = on ? "#fff" : "" })
  covertPreview()
}
let _covPrevT
window.covertPreview = () => {
  clearTimeout(_covPrevT)
  _covPrevT = setTimeout(async () => {
    const pass = document.getElementById("covPass")?.value || ""
    const prev = document.getElementById("covPrev"); if (!prev) return
    if (!pass) { prev.textContent = "Escribí una clave arriba…"; return }
    const r = await post("/api/covert/preview", { text: "nos vemos mañana, avisá cuando salgas", pass, style: window._covertStyle }).catch(() => null)
    prev.textContent = r && r.cover ? r.cover : "…"
  }, 250)
}
window.covertSave = async () => {
  const key = window._covertSheetKey; if (!key) return
  const pass = (document.getElementById("covPass")?.value || "").trim()
  if (pass.length < 4) return alert("Poné una clave de al menos 4 caracteres (tiene que ser la MISMA que la de la otra persona).")
  const r = await post("/api/covert/config", { key, pass, style: window._covertStyle || "poema" }).catch(() => null)
  if (!r || !r.enabled) return alert("No se pudo guardar.")
  closeSheet(); covertAfterSave(key)
}
window.covertDisable = async () => {
  const key = window._covertSheetKey; if (!key) return
  await post("/api/covert/config", { key, pass: "", style: "poema" }).catch(() => null)
  window._covertOn = false
  closeSheet(); covertAfterSave(key)
}
// tras guardar/desactivar: refrescá lo que esté a la vista (el perfil de la persona, o el chat) para que el estado/toggle se actualice
function covertAfterSave(key) {
  if (window._personKey != null && location.hash.includes("#person/")) viewPersonScreen(window._personKey)
  else if (convState && convState.key === key) viewConv(key) // re-fetch → trae d.covert → aparece el toggle en el composer
}
window.covertReveal = (id) => {
  const it = (convState.items || []).find((x) => x.id === id); if (!it) return
  openSheet(`<h2 style="margin:0 0 8px">🕊️ Texto original</h2><p class="sub" style="margin:0 0 10px">Esto es lo que ve cualquiera que NO tenga la clave (ej. por WhatsApp):</p><div style="white-space:pre-wrap;background:var(--bg2);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.55">${esc(it.text || "")}</div>`)
}

// ── IMÁGENES / VIDEOS: adjuntar desde el dispositivo o PEGAR del portapapeles → enviar por el bridge ──
window.pickMedia = () => document.getElementById("mediaInput")?.click()
window.onMediaPick = (input) => { const files = [...(input.files || [])]; input.value = ""; if (files.length) sendMediaFiles(files) }
window.pickSticker = () => document.getElementById("stickerInput")?.click()
window.onStickerPick = (input) => { const f = (input.files || [])[0]; input.value = ""; if (f) sendSticker(f) }
async function sendSticker(file) { // 🩷 mandar una imagen como sticker (el server la convierte a webp 512×512)
  if (!convState || convState.key === "self") return
  const t = convState.target || {}
  if (t.channel === "email") return alert("Los stickers van por WhatsApp/Telegram/etc., no por email.")
  const optId = "opt-" + Date.now(), localUrl = URL.createObjectURL(file)
  convState.items = [...(convState.items || []), { id: optId, channel: t.channel || "whatsapp", dir: "out", name: hubName(), ts: Date.now(), text: "🖼 Sticker", media: localUrl, mediaType: "image" }]
  renderConv(); window.scrollTo(0, document.body.scrollHeight)
  const qs = new URLSearchParams({ key: convState.key }); if (t.channel) qs.set("channel", t.channel); if (t.target) qs.set("target", t.target)
  const r = await fetch("/api/send-sticker?" + qs.toString(), { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file }).then((x) => x.json()).catch(() => null)
  if (!r || r.error) { convState.items = (convState.items || []).filter((x) => x.id !== optId); renderConv(); alert("No se pudo enviar el sticker: " + ((r && r.error) || "error")) }
  else if (r.media) { const it = (convState.items || []).find((x) => x.id === optId); if (it) { it.media = r.media; renderConv() } }
}
// varios archivos de una: los mando en orden, uno tras otro (secuencial → no satura el bridge ni desordena las burbujas)
async function sendMediaFiles(files) { for (const f of files) { await sendMediaFile(f) } }
window.handlePaste = (e) => { // pegar una imagen del portapapeles (Cmd/Ctrl+V) → enviarla
  const items = (e.clipboardData && e.clipboardData.items) || []
  for (const it of items) { if (it.type && (it.type.startsWith("image/") || it.type.startsWith("video/"))) { const f = it.getAsFile(); if (f) { e.preventDefault(); sendMediaFile(f); return } } }
}
async function sendMediaFile(file) {
  if (!convState || convState.key === "self") return
  const t = convState.target || {}
  if (t.channel === "email") return alert("Por ahora las fotos/videos van por WhatsApp/Telegram/etc., no por email.")
  if (file.size > 64 * 1024 * 1024) return alert("El archivo es muy grande (máx 64 MB).")
  const kind = (file.type || "").startsWith("image/") ? "image" : (file.type || "").startsWith("video/") ? "video" : "file"
  const optId = "opt-" + Date.now(), localUrl = URL.createObjectURL(file)
  convState.items = [...(convState.items || []), { id: optId, channel: t.channel || "whatsapp", dir: "out", name: hubName(), ts: Date.now(), text: kind === "image" ? "🖼 Imagen" : kind === "video" ? "📹 Video" : "📄 " + file.name, media: localUrl, mediaType: kind }]
  convState.total = (convState.total || 0) + 1
  renderConv(); window.scrollTo(0, document.body.scrollHeight)
  const qs = new URLSearchParams({ key: convState.key, filename: file.name || "archivo" })
  if (t.channel) qs.set("channel", t.channel)
  if (t.target) qs.set("target", t.target)
  const r = await fetch("/api/send-media?" + qs.toString(), { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }).then((x) => x.json()).catch(() => null)
  if (!r || r.error) { convState.items = (convState.items || []).filter((x) => x.id !== optId); convState.total = Math.max(0, (convState.total || 1) - 1); renderConv(); alert("No se pudo enviar: " + ((r && r.error) || "error")) }
  else if (r.media) { const it = (convState.items || []).find((x) => x.id === optId); if (it) { it.media = r.media; renderConv() } } // reemplaza el blob local por el del server (persistente)
}

// ── NOTAS DE VOZ: grabar y ENVIAR audio real (no transcribir) por WhatsApp/Telegram/Discord/etc. vía el bridge ──
let _rec = null, _recStart = 0, _recTimer = null
const _durTxt = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
window.recVoice = async (ai = false) => {
  if (_rec || !convState) return
  const tg = convState.target || {}
  if (tg.channel === "email" && !ai) return alert("Las notas de voz no aplican a email.")
  let stream
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { return alert("Necesito permiso de micrófono.") }
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "audio/webm")
  const rec = new MediaRecorder(stream, { mimeType: mime }); const chunks = []
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); clearInterval(_recTimer)
    const st = _rec; _rec = null
    const dur = Math.round((Date.now() - _recStart) / 1000)
    renderConv() // restaura el composer normal
    if (st.cancelled || !chunks.length || dur < 1) return
    const blob = new Blob(chunks, { type: mime })
    // MIC IA: en vez de mandar el audio, lo transcribo (whisper local) y te ofrezco las 3 opciones de texto (tal cual / corregido / mejorado).
    if (st.ai) {
      openSheet(`<div class="row" style="gap:8px;padding:0;background:none;box-shadow:none;margin:0">${ORB}<b>Transcribiendo lo que dijiste…</b></div>`)
      const r = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": mime }, body: blob }).then((x) => x.json()).catch(() => null)
      const txt = (r && r.text || "").trim()
      if (!txt) { closeSheet(); return alert("No pude entender el audio. Probá de nuevo hablando un poco más claro.") }
      const ch = (convState.target || {}).channel || ((convState.key || "").startsWith("email:") ? "email" : "whatsapp")
      return showSendOptions(txt, ch)
    }
    const optId = "opt-" + Date.now()
    convState.items = [...(convState.items || []), { id: optId, channel: st.channel || "whatsapp", dir: "out", name: hubName(), ts: Date.now(), text: `🎤 Nota de voz · ${_durTxt(dur)}`, mediaType: "audio" }]
    renderConv(); window.scrollTo(0, document.body.scrollHeight)
    const qs = new URLSearchParams({ key: st.key, dur: String(dur) })
    if (st.channel) qs.set("channel", st.channel)
    if (st.target) qs.set("target", st.target)
    const r = await fetch("/api/send-audio?" + qs.toString(), { method: "POST", headers: { "Content-Type": mime }, body: blob }).then((x) => x.json()).catch(() => null)
    if (!r || r.error) { convState.items = (convState.items || []).filter((x) => x.id !== optId); renderConv(); alert("No se pudo enviar el audio: " + ((r && r.error) || "error")) }
    else if (r.media) { const it = (convState.items || []).find((x) => x.id === optId); if (it) { it.media = r.media; renderConv() } } // ya tenemos copia local → reproducible en la app
  }
  _rec = { rec, cancelled: false, key: convState.key, target: tg.target, channel: tg.channel, ai }
  _recStart = Date.now(); rec.start()
  const c = document.getElementById("composer")
  if (c) c.innerHTML = `<div style="flex:1;display:flex;align-items:center;gap:11px;padding:0 8px"><span style="width:11px;height:11px;border-radius:50%;background:${ai ? "var(--accent)" : "var(--urgent)"};animation:pulse 1s infinite;flex-shrink:0"></span><span id="recTime" style="font-weight:700;font-size:16px;font-variant-numeric:tabular-nums">0:00</span><span class="muted" style="font-size:13px">${ai ? "Decí tu mensaje… la IA lo pasa a texto" : "Grabando nota de voz…"}</span></div>
    <button onclick="cancelRec()" title="Cancelar" style="min-width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--bg2);font-size:16px;cursor:pointer;flex-shrink:0">✕</button>
    <button onclick="stopSendRec()" title="Enviar" style="min-width:38px;height:38px;border-radius:50%;border:0;background:var(--accent);color:#fff;font-size:17px;cursor:pointer;flex-shrink:0">➤</button>`
  _recTimer = setInterval(() => { const el = document.getElementById("recTime"); if (el) el.textContent = _durTxt(Math.round((Date.now() - _recStart) / 1000)) }, 250)
}
window.cancelRec = () => { if (!_rec) return; _rec.cancelled = true; try { _rec.rec.stop() } catch {} }
window.stopSendRec = () => { if (!_rec) return; try { _rec.rec.stop() } catch {} }
// #2: corrección IA al enviar ON por defecto, pero se puede apagar (botón ✨ del composer). Se recuerda entre sesiones.
window._correctOn = (localStorage.getItem("pipe_correct") !== "0")
window.toggleCorrect = () => {
  window._correctOn = !window._correctOn
  localStorage.setItem("pipe_correct", window._correctOn ? "1" : "0")
  const b = document.getElementById("correctBtn"); if (b) { b.style.background = window._correctOn ? "var(--accent)" : "var(--bg2)"; b.style.color = window._correctOn ? "#fff" : "var(--muted)"; b.title = window._correctOn ? "Corregir con IA al enviar (tocá para enviar tal cual)" : "Enviar TAL CUAL, sin corregir (tocá para corregir)" }
}
// al tocar enviar: si la corrección está ON, muestra las 3 opciones; si está OFF, manda TAL CUAL directo.
window.sendMsg = async () => {
  const inp = document.getElementById("msgInput"); if (!inp) return
  const text = inp.value.trim(); if (!text || !convState) return
  const t = convState.target || {}
  const ch = t.channel || ((convState.key || "").startsWith("email:") ? "email" : "whatsapp")
  if (!window._correctOn) { inp.value = ""; growComposer(inp); return doSend(text) } // enviar tal cual
  showSendOptions(text, ch)
}
// muestra las 3 opciones (corregido / tal cual / otra forma) para un texto — lo usa el composer Y el dictado por voz (mic IA).
async function showSendOptions(text, ch) {
  if (!text || !text.trim() || !convState) return
  openSheet(`<div class="row" style="gap:8px;padding:0;background:none;box-shadow:none;margin:0">${ORB}<b>Revisando tu texto…</b></div>`)
  const c = await post("/api/compose/correct", { text, channel: ch }) || { original: text, corrected: text, alternative: "" }
  const opt = (val, tag, hi) => (val && val.trim()) ? `<button class="sendopt${hi ? " hi" : ""}" onclick="closeSheet();pickSend('${enck(val)}')"><div class="so-tag">${tag}</div><div class="so-txt">${esc(val)}</div></button>` : ""
  const corr = (c.corrected || "").trim(), orig = (c.original || text).trim(), alt = (c.alternative || "").trim()
  const corrChanged = corr && corr !== orig
  // sin dobles idénticos: si la corrección cambió algo → Corregido (destacado) + Original; si FALLÓ (timeout/sin motor) → aviso claro
  // en vez del engañoso "sin errores"; si no → el texto una sola vez.
  const opts = c.failed
    ? opt(orig, "⚠️ No pude revisar ahora · enviar igual", true)
    : corrChanged
      ? opt(corr, "✓ Corregido", true) + opt(orig, "✍️ Tal cual lo escribiste", false)
      : opt(orig, "✓ Tu texto (sin errores)", true)
  const altOpt = (alt && alt !== corr && alt !== orig) ? opt(alt, "✨ Otra forma de decirlo", false) : ""
  // si el mensaje habla de agendar, mostrar huecos LIBRES del calendario ARRIBA de las opciones de texto (tocar = insertar la hora)
  const slots = c.slots || []
  const slotBlock = slots.length ? `<div style="margin:0 0 14px">
      <div class="so-tag" style="margin:0 0 8px">📅 Tenés libre ${esc(c.slotDay || "ese día")} · tocá para agregar la hora</div>
      <div class="frow" style="margin:0">${slots.map((s) => `<button class="gchip" onclick="insertSlot('${s.label}')">${s.label}</button>`).join("")}</div>
    </div>` : ""
  openSheet(`<h2 style="margin:0 0 2px">Elegí qué enviar</h2><div class="sub" style="margin:0 0 12px">Por ${CH[ch] || ch} · tocá una opción</div>
    ${slotBlock}
    ${opts}
    ${altOpt}
    <button class="btn ghost" style="width:100%;margin-top:6px" onclick="closeSheet()">Cancelar</button>`)
}
async function viewConv(key) {
  const startHash = location.hash
  // 1) pintar la HISTORIA COMPLETA cacheada en IndexedDB al instante (no solo 40 msgs; funciona offline)
  const local = await idbLoad(key)
  const lm = local.meta || {}, haveLocal = local.items.length > 0
  if (haveLocal) { convState = { key, items: local.items, name: lm.name, photo: lm.photo, email: lm.email, account: lm.account, channels: lm.channels || [], total: lm.total, hasMore: lm.hasMore, oldestTs: lm.oldestTs, targets: lm.targets || [], target: (lm.targets || [])[0] || null, maxRev: lm.maxRev || 0, covert: lm.covert || null }; renderConv(); window.scrollTo(0, document.body.scrollHeight) } else render(skel(5))
  // 2) de la red: si ya tengo cache → solo el DELTA (rev > maxRev); si es la 1ra vez → carga completa (últimos 60)
  const [d, tg] = await Promise.all([
    (haveLocal ? api("/api/thread/delta?key=" + enck(key) + "&sinceRev=" + (lm.maxRev || 0)) : api("/api/thread?key=" + enck(key) + "&limit=60")).then((x) => x || { items: [] }),
    api("/api/thread/targets?key=" + enck(key)).then((x) => x || { targets: [] }),
  ])
  if (location.hash !== startHash) return // navegaste a otra pantalla mientras cargaba → no pisar
  const targets = tg.targets || [], target = targets[tg.default || 0] || null
  if (haveLocal) {
    // DELTA: upsert por id sobre lo local + reuso la metadata del hilo cacheada (nombre/foto no cambian seguido)
    const byId = new Map(local.items.map((i) => [i.id, i])); for (const it of (d.items || [])) byId.set(it.id, it)
    const items = [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0))
    const maxRev = d.maxRev != null ? d.maxRev : (lm.maxRev || 0)
    convState = { key, items, name: lm.name, photo: lm.photo, email: lm.email, account: lm.account, channels: lm.channels || [], total: lm.total, hasMore: lm.hasMore, oldestTs: lm.oldestTs, targets, target, maxRev, covert: lm.covert || null }
    idbSave(key, d.items || [], { maxRev, targets })
  } else {
    // FULL (primer open): guardo items + metadata del hilo para las próximas veces
    convState = { key, items: d.items || [], name: d.name, photo: d.photo, email: d.email, account: d.account, channels: d.channels || [], total: d.total || (d.items || []).length, hasMore: d.hasMore, oldestTs: d.oldestTs, targets, target, unread: d.unread || 0, lastSeen: d.lastSeen || 0, maxRev: d.maxRev || 0, covert: d.covert || null }
    idbSave(key, d.items || [], { maxRev: d.maxRev || 0, name: d.name, photo: d.photo, email: d.email, account: d.account, channels: d.channels || [], total: d.total, hasMore: d.hasMore, oldestTs: d.oldestTs, targets, covert: d.covert || null })
  }
  renderConv()
  const jb = app.querySelector(".screen"); if (jb) window.scrollTo(0, document.body.scrollHeight)
  // marcar visto hasta el último mensaje (para el resumen "lo que me perdí" la próxima vez)
  const lastTs = (convState.items || []).reduce((m, x) => Math.max(m, x.ts || 0), 0)
  if (lastTs && key !== "self") post("/api/thread/seen", { key, ts: lastTs }).catch(() => {})
  if (pendingDraft) { const inp = document.getElementById("msgInput"); if (inp) { inp.value = pendingDraft; growComposer(inp); inp.focus() } pendingDraft = null } // borrador de la IA proactiva
}
// poll incremental: pide SOLO el DELTA (rev > maxRev) → payload chico. Appendea sin re-render (no molesta el scroll ni lo que escribís)
async function refreshConv(key) {
  const scr = app.querySelector(".screen"); if (!scr || convState.key !== key) return
  const d = await api("/api/thread/delta?key=" + enck(key) + "&sinceRev=" + (convState.maxRev || 0))
  if (!d || convState.key !== key || !Array.isArray(d.items)) return
  if (d.maxRev != null) convState.maxRev = d.maxRev
  if (!d.items.length) return // nada nuevo ni editado → no toca nada
  idbSave(key, d.items, { maxRev: convState.maxRev })
  const byId = new Map((convState.items || []).map((i) => [i.id, i]))
  const curNewest = (convState.items || []).filter((x) => !String(x.id).startsWith("opt-")).reduce((m, x) => Math.max(m, x.ts || 0), 0)
  let needRender = false; const appended = []
  for (const it of d.items) {
    if (byId.has(it.id)) needRender = true       // una fila que ya tenía cambió (media backfilleada, resumen…) → re-render
    else if ((it.ts || 0) <= curNewest) needRender = true // llegó una vieja fuera de orden → re-render para insertarla bien
    else appended.push(it)                        // mensaje nuevo al final → se puede appendear sin re-render
    byId.set(it.id, it)
    // DEDUP optimista: el eco del server reemplaza la burbuja "opt-…" (mismo texto out, ~mismo momento)
    if (it.dir === "out") for (const [id, o] of [...byId]) if (String(id).startsWith("opt-") && (o.text || "") === (it.text || "") && Math.abs((o.ts || 0) - (it.ts || 0)) < 120000) { byId.delete(id); needRender = true }
  }
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 280
  convState.items = [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0))
  if (needRender) renderConv()
  else { let html = ""; for (const it of appended) html += convBubble(it); scr.insertAdjacentHTML("beforeend", html) }
  if (nearBottom) window.scrollTo(0, document.body.scrollHeight)
  const lastTs = d.items.reduce((m, x) => Math.max(m, x.ts || 0), 0)
  if (lastTs && key !== "self") post("/api/thread/seen", { key, ts: lastTs }).catch(() => {}) // marcar visto los nuevos
}
// ── Calendarizador por chat: chip flotante + modal ──
let schedIntent = null
const _schedDismissed = new Set() // intents que el usuario descartó con ✕ (por thread+ts) → no re-aparecen
const _p2 = (n) => String(n).padStart(2, "0")
async function checkScheduleIntent(key) {
  if (!key || key === "self") { document.getElementById("schedChip")?.remove(); schedIntent = null; return }
  const r = await api("/api/thread/schedule?key=" + enck(key))
  if (convState.key !== key) return // el usuario navegó a otro hilo mientras tanto
  if (!r || !r.found || _schedDismissed.has(key + ":" + r.ts)) { document.getElementById("schedChip")?.remove(); schedIntent = null; return }
  // ya está mostrado el mismo intent → no re-pintar (evita flicker en el poll)
  if (schedIntent && schedIntent.ts === r.ts && document.getElementById("schedChip")) return
  schedIntent = r
  const d = r.date, dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], dt = new Date(d.year, d.month - 1, d.day)
  const when = `${dias[dt.getDay()]} ${d.day}/${d.month}${r.hasTime ? ` ${d.hour}:${_p2(d.minute)}` : (r.suggestions?.length ? " · elegí hora" : "")}`
  document.getElementById("schedChip")?.remove()
  document.body.insertAdjacentHTML("beforeend", `<div id="schedChip" onclick="openScheduleModal()" style="position:fixed;bottom:150px;left:50%;transform:translateX(-50%);width:calc(100% - 20px);max-width:460px;z-index:27;background:var(--accent);color:#fff;padding:11px 14px;border-radius:14px;box-shadow:0 6px 20px rgba(99,102,241,.45);display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;animation:fade .3s;overflow:hidden;box-sizing:border-box">
    <span style="font-size:19px">📅</span>
    <div style="flex:1;min-width:0"><div style="font-weight:700">Agendar reunión — ${when}</div><div style="opacity:.9;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">de "${(r.matched || "").slice(0, 40)}"</div></div>
    <span style="background:rgba(255,255,255,.25);padding:6px 12px;border-radius:10px;font-weight:700;white-space:nowrap">Agendar ›</span>
    <span onclick="event.stopPropagation();dismissSched()" style="padding:4px 6px;opacity:.85">✕</span></div>`)
}
window.dismissSched = () => { if (schedIntent) _schedDismissed.add(convState.key + ":" + schedIntent.ts); document.getElementById("schedChip")?.remove(); schedIntent = null }
window.pickSlot = (h, m) => { const el = document.getElementById("sc-when"); if (el) el.value = el.value.split("T")[0] + `T${_p2(h)}:${_p2(m)}`; document.querySelectorAll(".slotBtn").forEach((b) => b.classList.remove("on")); event.target.classList.add("on") }
window.openScheduleModal = () => {
  const r = schedIntent; if (!r) return
  const d = r.date
  // hora por defecto: la parseada si la hay; si no, la primera sugerencia libre; si no, 15:00
  const defT = r.hasTime ? { h: d.hour, m: d.minute } : (r.suggestions?.[0] ? { h: r.suggestions[0].hour, m: r.suggestions[0].minute } : { h: 15, m: 0 })
  const dtLocal = `${d.year}-${_p2(d.month)}-${_p2(d.day)}T${_p2(defT.h)}:${_p2(defT.m)}`
  const email = (r.emails || [])[0] || "", plat = r.platformDefault || "meet"
  const title = `Reunión con ${r.contactName || (convState.name || "").split(" ")[0] || ""}`.trim()
  window._plat = plat
  const slotsHtml = (!r.hasTime && r.suggestions?.length) ? `<div class="sub" style="margin:2px 0 6px">🗓️ Tus horarios libres ese día:</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">${r.suggestions.map((s, i) => `<button type="button" class="pill slotBtn${i === 0 ? " on" : ""}" onclick="pickSlot(${s.hour},${s.minute})" style="padding:8px 14px">${s.label}</button>`).join("")}</div>` : ""
  const dayCtx = r.dayEvents?.length ? `<div class="sub" style="margin:-8px 0 12px;font-size:12px">🗓️ Ese día ya tenés: ${r.dayEvents.map((e) => `${e.start} ${esc((e.title || "").slice(0, 16))}`).join(" · ")}</div>` : ""
  const conflictBanner = r.conflict?.length ? `<div id="sc-conf" style="background:#fdecea;color:#c0392b;border-radius:10px;padding:8px 12px;font-size:12.5px;margin-bottom:10px">⚠️ Pisa con: ${r.conflict.map((c) => `${c.start} ${esc((c.title || "").slice(0, 20))}`).join(", ")}</div>` : ""
  const proposeBtn = r.suggestions?.length ? `<button type="button" onclick="proponerHorarios()" class="pill" style="width:100%;padding:11px;margin-bottom:10px;border-color:var(--accent);color:var(--accent)">📤 Mejor proponerle estos horarios por chat</button>` : ""
  openSheet(`<h2 style="margin:0 0 4px">📅 Agendar reunión</h2>
    <div class="sub" style="margin-bottom:14px">Detectado: "${esc((r.matched || "").slice(0, 60))}"${r.viaLLM ? " · 🤖" : ""}</div>
    ${conflictBanner}
    <label class="tiny b">Título</label><input class="inp" id="sc-title" value="${esc(title)}" style="margin:4px 0 12px">
    ${slotsHtml}
    <label class="tiny b">Cuándo</label><input class="inp" id="sc-when" type="datetime-local" value="${dtLocal}" style="margin:4px 0 4px">
    ${dayCtx}
    <label class="tiny b">Duración</label>
    <select class="inp" id="sc-dur" style="margin:4px 0 12px">
      <option value="15">15 min</option><option value="30"${r.durationMin === 30 ? " selected" : ""}>30 min</option>
      <option value="45"${r.durationMin === 45 ? " selected" : ""}>45 min</option><option value="60"${r.durationMin === 60 ? " selected" : ""}>1 hora</option><option value="90">1.5 horas</option></select>
    <label class="tiny b">Plataforma</label>
    <div class="row" style="gap:8px;margin:4px 0 12px">
      <button type="button" id="sc-meet" onclick="pickPlat('meet')" class="pill${plat === "meet" ? " on" : ""}" style="flex:1;padding:11px">🟢 Meet</button>
      <button type="button" id="sc-teams" onclick="pickPlat('teams')" class="pill${plat === "teams" ? " on" : ""}" style="flex:1;padding:11px">🔵 Teams</button></div>
    <label class="tiny b">Invitar a (emails, separá con coma)</label>
    <input class="inp" id="sc-email" value="${esc(email)}" placeholder="${email ? "" : "sin email conocido — escribilo"}" style="margin:4px 0 12px">
    <label class="tiny b">Nota / agenda (opcional)</label>
    <textarea class="inp" id="sc-note" rows="2" placeholder="Tema o puntos a tratar…" style="margin:4px 0 14px;resize:none;font-family:inherit;line-height:1.35"></textarea>
    ${proposeBtn}
    <button class="btn" id="sc-go" onclick="confirmSchedule()" style="width:100%">Agendar y crear invite</button>
    <div id="sc-err" style="color:var(--urgent);font-size:13px;margin-top:8px;text-align:center"></div>`)
}
// Calendly-style: en vez de elegir vos, le proponés las opciones libres por chat
window.proponerHorarios = () => {
  const r = schedIntent; if (!r?.suggestions?.length) return
  const d = r.date, dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], dt = new Date(d.year, d.month - 1, d.day)
  const horas = r.suggestions.map((s) => s.label).join(", ").replace(/, ([^,]*)$/, " o $1")
  const msg = `¿Te viene bien el ${dias[dt.getDay()]} a las ${horas}? Decime cuál preferís y lo agendo 👍`
  if (schedIntent) _schedDismissed.add(convState.key + ":" + schedIntent.ts)
  closeSheet(); document.getElementById("schedChip")?.remove(); schedIntent = null
  const inp = document.getElementById("msgInput"); if (inp) { inp.value = msg; growComposer(inp); inp.focus() }
}
window.pickPlat = (p) => { window._plat = p; document.getElementById("sc-meet").classList.toggle("on", p === "meet"); document.getElementById("sc-teams").classList.toggle("on", p === "teams") }
window.confirmSchedule = async (force) => {
  const wh = document.getElementById("sc-when").value
  const err = (m) => { const e = document.getElementById("sc-err"); if (e) e.innerHTML = m }
  if (!wh) return err("Falta la fecha")
  const [dp, tp] = wh.split("T"), [year, month, day] = dp.split("-").map(Number), [hour, minute] = tp.split(":").map(Number)
  const emails = (document.getElementById("sc-email").value || "").split(",").map((s) => s.trim()).filter(Boolean)
  const note = document.getElementById("sc-note")?.value.trim() || ""
  const btn = document.getElementById("sc-go"); btn.disabled = true; btn.textContent = "Creando el evento…"
  const r = await post("/api/schedule/create", {
    key: convState.key, date: { year, month, day, hour, minute },
    durationMin: +document.getElementById("sc-dur").value,
    title: document.getElementById("sc-title").value.trim() || "Reunión",
    platform: window._plat || "meet", emails, note, force: !!force,
  })
  if (r?.conflict?.length) { // detección de conflictos (Calendly/GCal): avisa y ofrece agendar igual
    btn.disabled = false; btn.textContent = "Agendar y crear invite"
    return err(`⚠️ Pisa con ${r.conflict.map((c) => esc(c.start + " " + (c.title || "").slice(0, 18))).join(", ")}. <a href="#" onclick="confirmSchedule(true);return false" style="color:var(--accent);font-weight:700">Agendar igual</a>`)
  }
  if (!r || r.error) { btn.disabled = false; btn.textContent = "Agendar y crear invite"; return err(r?.error || "No se pudo crear el evento") }
  if (schedIntent) _schedDismissed.add(convState.key + ":" + schedIntent.ts) // ya agendado → el poll NO debe re-mostrar el chip
  window._lastSched = r.cancel || null; window._lastLink = r.link || ""
  closeSheet(); document.getElementById("schedChip")?.remove(); schedIntent = null
  const inp = document.getElementById("msgInput"); if (inp && r.draft) { inp.value = r.draft; growComposer(inp); inp.focus() } // borrador de confirmación en TU voz
  document.getElementById("schedToast")?.remove()
  const copy = window._lastLink ? ` · <a href="#" onclick="copyLink();return false" style="color:#fff;text-decoration:underline">📋 link</a>` : ""
  const undo = window._lastSched ? ` · <a href="#" onclick="undoSchedule();return false" style="color:#fff;text-decoration:underline;font-weight:700">deshacer</a>` : ""
  document.body.insertAdjacentHTML("beforeend", `<div id="schedToast" style="position:fixed;bottom:150px;left:50%;transform:translateX(-50%);z-index:40;background:var(--ok);color:#fff;padding:11px 16px;border-radius:12px;font-size:13.5px;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:440px;text-align:center;animation:fade .3s">✅ Agendado ${esc(r.when || "")} · ${window._plat === "teams" ? "Teams" : "Meet"}${copy}${undo}</div>`)
  setTimeout(() => document.getElementById("schedToast")?.remove(), 9000)
}
window.copyLink = () => { if (window._lastLink) navigator.clipboard?.writeText(window._lastLink).then(() => { const t = document.getElementById("schedToast"); if (t) t.innerHTML = "📋 Link copiado" }) }
window.undoSchedule = async () => {
  if (!window._lastSched) return
  const c = window._lastSched; window._lastSched = null
  document.getElementById("schedToast")?.remove()
  await post("/api/schedule/delete", c)
  const inp = document.getElementById("msgInput"); if (inp) inp.value = "" // limpiar el borrador de confirmación
  document.body.insertAdjacentHTML("beforeend", `<div id="schedToast" style="position:fixed;bottom:150px;left:50%;transform:translateX(-50%);z-index:40;background:#555;color:#fff;padding:11px 16px;border-radius:12px;font-size:13.5px;text-align:center">↩️ Reunión cancelada</div>`)
  setTimeout(() => document.getElementById("schedToast")?.remove(), 3500)
}
window.catchupSummary = async () => {
  const d = convState; if (!d) return
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Resumiendo lo que te perdiste…</b></div><div class="sub" style="margin-top:8px">Leyendo ${d.unread} mensajes — mirando imágenes, documentos, audios y videos. Puede tardar unos segundos.</div>`)
  const r = await api(`/api/thread/catchup?key=${enck(d.key)}&since=${d.lastSeen}`) || {}
  if (!r.summary) return openSheet(`<h2 style="margin:0 0 8px">Resumen</h2><div class="sub">No pude generar el resumen ahora. Intentá de nuevo.</div>`)
  const html = esc(r.summary).replace(/^[-•]\s?/gm, "· ").replace(/\n/g, "<br>").replace(/⚠️/g, '<span style="color:#e0663a">⚠️</span>')
  const mediaTag = r.media ? ` · 👁 ${r.media} adjunto${r.media > 1 ? "s" : ""} analizado${r.media > 1 ? "s" : ""}` : ""
  openSheet(`<h2 style="margin:0 0 4px">✨ Lo que te perdiste</h2><div class="sub" style="margin:0 0 12px">${r.count} mensajes · hace ${r.days} día${r.days > 1 ? "s" : ""}${mediaTag}</div><div style="font-size:15px;line-height:1.6">${html}</div>`)
}
window.loadOlder = async () => {
  const d = convState; if (!d || !d.hasMore) return
  const older = await api(`/api/thread?key=${enck(d.key)}&before=${d.oldestTs}&limit=100`)
  if (older && older.items && older.items.length) {
    d.items = [...older.items, ...d.items]; d.oldestTs = older.oldestTs; d.hasMore = older.hasMore
    idbSave(d.key, older.items, { oldestTs: d.oldestTs, hasMore: d.hasMore }) // persistir la página vieja → no se re-baja nunca más
    renderConv()
  } else { d.hasMore = false; idbSave(d.key, [], { hasMore: false }); renderConv() }
}
const emailIframe = (it) => {
  const raw = it.body || `<pre style="white-space:pre-wrap;font-family:system-ui;font-size:14px">${(it.full || it.text || "").replace(/</g, "&lt;").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#4f46e5">$1</a>')}</pre>`
  // CSP dentro del email: bloquea TODO recurso remoto (img-src data: → sin imágenes remotas). Mata pixeles de tracking /
  // read-receipts (el remitente no se entera de que abriste ni tu IP). Las imágenes inline (data:) sí se ven. Como Gmail.
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:">'
  const doc = '<!doctype html>' + csp + '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>body{margin:0;padding:12px;font-family:system-ui;color:#111;line-height:1.5;word-break:break-word}img{max-width:100%!important;height:auto}table{max-width:100%!important}</style>' + raw
  const srcdoc = doc.replace(/&/g, "&amp;").replace(/"/g, "&quot;") // escape para el atributo srcdoc
  // sandbox sin allow-scripts (bloquea JS/XSS) pero permite imágenes; allow-popups deja abrir links en pestaña nueva
  return `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${srcdoc}" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>`
}
window.showEmailFull = async (id) => {
  const it = (convState.items || []).find((x) => x.id === id) || {}
  const mtg = it.meeting || it.channel === "meeting"
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Abriendo ${mtg ? "transcripción" : "email"}…</b></div>`)
  let body = it.body
  if (!body && it.hasBody) { const r = await api("/api/email/body?id=" + enck(id)); body = r && r.body }
  let atts = []; try { atts = JSON.parse(it.attachments || "[]") } catch {}
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB")
  const attHtml = atts.length ? `<div style="margin:8px 0 4px;font-weight:600;font-size:14px">📎 ${atts.length} adjunto${atts.length > 1 ? "s" : ""}</div><div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">${atts.map((a) => `<div class="card itemtap" style="padding:10px 12px;display:flex;align-items:center;gap:10px;cursor:pointer" onclick="window.open(${escj(a.cas)},'_blank')"><span style="font-size:20px">📄</span><div style="flex:1;min-width:0"><div class="b" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div><div class="sub">${esc((a.mime || "").split("/").pop() || "archivo")} · ${kb(a.size || 0)}</div></div><span style="color:var(--accent)">↓</span></div>`).join("")}</div>` : ""
  openSheet(`<h2 style="margin:0">${mtg ? "🎙 Reunión" : "📧 Email"}</h2><div class="sub" style="margin:6px 0 10px">${esc((it.text || "").split(" — ")[0].replace(/^📅\s*/, ""))} · ${esc(it.name || "")}</div>${attHtml}${emailIframe({ ...it, body })}`)
}
window.viewMedia = async (key) => {
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Cargando adjuntos…</b></div>`)
  const d = await api("/api/thread/media?key=" + key) || { items: [] }
  const pol = await api("/api/media-policy").catch(() => ({ policy: { def: "store", threads: {} } }))
  const chatStore = ((pol.policy.threads || {})[decodeURIComponent(key)] || pol.policy.def || "store") === "store"
  const by = (t) => d.items.filter((i) => i.type === t)
  const imgs = d.items.filter((i) => i.type === "image" || i.type === "gif"), vids = by("video")
  const docs = d.items.filter((i) => i.type === "document" || i.type === "file"), av = by("audio")
  const row = (ic, i) => `<div class="media-row" onclick="window.open('${i.media}','_blank')"><span class="media-ic">${ic}</span><div class="media-tx"><div class="media-name">${esc(i.filename || i.media.split("/").pop())}</div><div class="media-sub">${esc(i.who)} · ${ago(i.ts)}</div></div></div>`
  openSheet(`<h2 class="sheet-h"><span class="ei">${IC_CLIP}</span>Adjuntos<span class="sheet-n">${d.items.length}</span></h2>
    <div class="media-cfg"><div class="media-cfg-row"><div class="ric">${IC_DISK}</div><div class="rm"><b>Guardar fotos y archivos</b><span>De este chat. El audio siempre se guarda.</span></div><button class="switch${chatStore ? " on" : ""}" role="switch" aria-checked="${chatStore}" aria-label="Guardar media de este chat" onclick="toggleChatMedia('${key}', ${!chatStore})"></button></div>
      <button class="btn ghost btn-danger" onclick="freeChatMedia('${key}')"><span class="ei">${IC_TRASH}</span>Liberar espacio de este chat</button></div>
    ${imgs.length ? `<div class="media-sec"><span class="ei">${IC_IMG}</span>Imágenes<span class="media-n">${imgs.length}</span></div><div class="media-grid">${imgs.slice(0, 30).map((i) => `<img loading="lazy" src="${i.media}" alt="Imagen adjunta" onclick="window.open('${i.media}','_blank')">`).join("")}</div>` : ""}
    ${vids.length ? `<div class="media-sec"><span class="ei">${IC_VIDEO}</span>Videos<span class="media-n">${vids.length}</span></div>${vids.slice(0, 12).map((i) => row(IC_VIDEO, i)).join("")}` : ""}
    ${docs.length ? `<div class="media-sec"><span class="ei">${IC_DOC}</span>Documentos<span class="media-n">${docs.length}</span></div>${docs.slice(0, 25).map((i) => row(IC_DOC, i)).join("")}` : ""}
    ${av.length ? `<div class="media-sec"><span class="ei">${IC_AUDIO}</span>Audios<span class="media-n">${av.length}</span></div>${av.slice(0, 15).map((i) => spdAudio(`<audio controls preload="none" src="${i.media}" class="media-aud" style="flex:1;min-width:0"></audio>`)).join("")}` : ""}
    ${!d.items.length ? '<div class="nt-none" style="margin-top:20px">Sin adjuntos en esta conversación.</div>' : ""}`)
}
window.toggleChatMedia = async (keyEnc, store) => { await post("/api/media-policy", { key: decodeURIComponent(keyEnc), mode: store ? "store" : "skip" }).catch(() => {}); viewMedia(keyEnc) }
window.freeChatMedia = async (keyEnc) => {
  if (!confirm("¿Mandar a la papelera las fotos, videos y documentos de este chat? El audio se mantiene y no se borran los mensajes. Recuperables 30 días.")) return
  const r = await post("/api/media/free", { key: decodeURIComponent(keyEnc) }).catch(() => null)
  alert(r ? `✅ ${r.count} adjuntos a la papelera · recuperables 30 días` : "No se pudo.")
  viewMedia(keyEnc)
}
window.viewPerson = (key) => go("#person/" + key) // key ya viene encodeURIComponent-eado por quien llama
// modal de un GRUPO en común: lista sus miembros (clickeables → cada persona) + abrir el chat del grupo
window.grpCardSheet = (i) => {
  const g = (window._pcGroups || [])[i]; if (!g) return
  const mem = g.members || []
  const chips = mem.length
    ? mem.map((m) => `<span class="pr-chip" style="cursor:pointer" onclick="closeSheet();viewPerson('${enck(m.name)}')">${esc(m.name)}${m.n > 1 ? ` <b>·${m.n}</b>` : ""}</span>`).join("")
    : '<div class="sub">No pude listar los miembros de este grupo.</div>'
  openSheet(`<h2 style="margin:0 0 4px">👥 ${esc(g.name)}</h2><div class="sub" style="margin:0 0 12px">${mem.length} ${mem.length === 1 ? "miembro" : "miembros"}${mem.length ? " · tocá para ver a cada uno" : ""}</div><div class="pr-chips">${chips}</div>${g.thread ? `<button class="btn" style="width:100%;margin-top:14px" onclick="closeSheet();go('#conv/${enck(g.thread)}')">Abrir el chat del grupo</button>` : ""}`)
}
const CHAN_META = { whatsapp: ["WhatsApp", "#25d366"], email: ["Email", "#ef4444"], telegram: ["Telegram", "#37aee2"], instagram: ["Instagram", "#e1306c"], teams: ["Teams", "#5b5fc7"], linkedin: ["LinkedIn", "#0a66c2"] }
const _ini = (s) => (String(s || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase()
async function viewPersonScreen(nameOrKey) {
  render(skel(5), ST.tab)
  const p = await api("/api/person?name=" + enck(nameOrKey)) || {}
  const nm = p.name || decodeURIComponent(nameOrKey), ini = esc(_ini(nm))
  window._personKey = nameOrKey // para refrescar este perfil tras configurar el modo encubierto
  const cov = (p.key && !p.isGroup) ? await api("/api/covert/config?key=" + enck(p.key)).catch(() => null) : null // estado del modo encubierto de este contacto
  const ap = (p.key && !p.isGroup) ? await api("/api/autopilot/config?key=" + enck(p.key)).catch(() => null) : null // estado del piloto automático
  const covLbl = cov?.styles?.find((s) => s.id === cov.style)?.label || cov?.style || ""
  const convKey = p.canon || nm
  const people = (p.shared?.people || []), groups = (p.shared?.groups || [])
  window._pcGroups = groups // para el modal de miembros al tocar un grupo
  // grafo: personas EN COMÚN (más cerca/grandes cuanto más comparten) + org + grupos; con movimiento
  const maxSh = Math.max(1, ...people.map((x) => x.shared || 1))
  const sats = []
  for (const pp of people.slice(0, 6)) sats.push({ label: pp.name, ini: _ini(pp.name), kind: "person", strength: (pp.shared || 1) / maxSh, person: enck(pp.name) })
  if (p.orgs) sats.push({ label: String(p.orgs).split(",")[0].trim(), ini: _ini(String(p.orgs).split(",")[0]), kind: "org", strength: 0.65 })
  if (groups.length) sats.push({ label: groups.length + (groups.length === 1 ? " grupo" : " grupos"), ini: "◎", kind: "groups", strength: 0.45 })
  const N = Math.max(1, sats.length)
  const nodes = sats.map((s, i) => { const ang = -Math.PI / 2 + ((i + 0.5) / N) * 2 * Math.PI; const r = 44 - (s.strength || 0.5) * 9
    return { ...s, x: 50 + r * Math.cos(ang) * 1.16, y: 44 + r * Math.sin(ang) * 0.92, sz: Math.round(40 + (s.strength || 0.5) * 13) } })
  const lines = nodes.map((n, i) => `<line id="grl${i}" x1="50" y1="44" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}" stroke="rgba(139,139,255,${(0.15 + (n.strength || 0) * 0.3).toFixed(2)})" stroke-width="0.5"/>`).join("")
  const satEls = nodes.map((n, i) => `<div class="gr-sat gr-${n.kind || "x"}${n.y < 40 ? " gr-up" : ""}" data-i="${i}"${n.person ? ` data-person="${n.person}"` : ""} style="left:${n.x}%;top:${n.y}%;animation-delay:${(i * 0.4).toFixed(1)}s" onpointerdown="grDrag(event,this)"><div class="gr-sat-c" style="width:${n.sz}px;height:${n.sz}px">${esc(n.ini)}</div><div class="gr-sat-l">${esc(n.label)}</div></div>`).join("")
  const stat = (v, l, cls = "") => `<div class="pr-stat"><div class="pr-stat-v ${cls}">${esc(String(v))}</div><div class="pr-stat-l">${esc(l)}</div></div>`
  const respTxt = p.stats?.respMin != null ? (p.stats.respMin < 60 ? `~${p.stats.respMin} min` : `~${(p.stats.respMin / 60).toFixed(1)} h`) : "—"
  const relDur = (ts) => { if (!ts) return "—"; const d = (Date.now() - ts) / 86400000; return d < 31 ? Math.round(d) + " d" : d < 365 ? Math.round(d / 30) + " meses" : (d / 365).toFixed(d < 730 ? 1 : 0) + " años" }
  const enComun = people.length + groups.length
  const chCard = (c) => { const m = CHAN_META[c.channel] || [c.channel, "#888"], active = c.last && (Date.now() - c.last < 86400000) ? "Activo hoy" : c.last ? "Hace " + ago(c.last) : ""
    return `<div class="pr-chan" style="--cc:${m[1]}"><span class="pr-chan-ic">${chanIcon(c.channel) || m[0][0]}</span><div><div class="b small">${m[0]}</div><div class="tiny muted">${esc(active)}</div></div></div>` }
  render(`<div class="screen pr" style="padding:0 0 30px">
    <div class="pr-hero">
      <div class="row spread" style="position:relative;z-index:2"><button class="mtg-back" onclick="history.back()">‹</button><div class="pr-graphify">GRAPHIFY</div><button class="mtg-back" onclick="calSearch()" title="Buscar" aria-label="Buscar">🔍</button></div>
      <div class="gr-graph">
        <svg class="gr-lines" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
        ${satEls}
        <div class="gr-center">${ini}</div>
      </div>
      <div class="pr-name">${esc(nm)}</div>
      <div class="pr-role">${esc([p.role, p.orgs].filter(Boolean).join(" · ") || p.tags || "Contacto")}</div>
    </div>
    <div style="padding:16px">
    <div class="pr-actions">
      <button class="pr-act" onclick="go('#conv/${enck(convKey)}')"><span>💬</span>Mensaje</button>
      <button class="pr-act" onclick="go('#conv/${enck(convKey)}')"><span>📞</span>Llamar</button>
      <button class="pr-act" onclick="go('#calendario')"><span>📅</span>Agendar</button>
    </div>
    ${p.bio ? `<div class="pr-bio"><div class="mtg-eyebrow light">✦ Quién es</div><div class="pr-bio-txt">${esc(p.bio)}</div></div>` : ""}
    <div class="pr-stats">${stat(respTxt, "responde", "good")}${stat(enComun || "—", "en común")}${stat(relDur(p.stats?.firstTs), "se conocen")}</div>
    ${(p.topics || []).length ? `<div class="mtg-card"><div class="mtg-eyebrow">De qué hablan</div>${p.topics.map((t) => `<div class="pr-topic"><span class="pr-recent-dot"></span><span>${esc(t)}</span></div>`).join("")}</div>` : ""}
    ${(p.groupMembers && p.groupMembers.length) ? `<div class="mtg-card"><div class="mtg-eyebrow">Miembros del grupo · ${p.groupMembers.length}</div><div class="pr-chips">${p.groupMembers.map((m) => `<span class="pr-chip" style="cursor:pointer" onclick="viewPerson('${enck(m.name)}')">${esc(m.name)}${m.n > 1 ? ` <b>·${m.n}</b>` : ""}</span>`).join("")}</div></div>` : ""}
    ${(people.length || groups.length) ? `<div class="mtg-card"><div class="mtg-eyebrow">En común</div>
      ${groups.length ? `<div class="pr-common"><span class="pr-common-l">Grupos</span><div class="pr-chips">${groups.map((g, i) => `<span class="pr-chip grp" style="cursor:pointer" onclick="grpCardSheet(${i})">👥 ${esc(g.name)}${(g.members || []).length ? ` <b>·${g.members.length}</b>` : ""}</span>`).join("")}</div></div>` : ""}
      ${people.length ? `<div class="pr-common"><span class="pr-common-l">Personas</span><div class="pr-chips">${people.map((pp) => `<span class="pr-chip" onclick="viewPerson('${enck(pp.name)}')">${esc(pp.name)}${pp.shared > 1 ? ` <b>·${pp.shared}</b>` : ""}</span>`).join("")}</div></div>` : ""}
    </div>` : ""}
    ${(p.contacts && ((p.contacts.phones || []).length || (p.contacts.emails || []).length)) ? `<div class="mtg-card"><div class="mtg-eyebrow">Datos de contacto</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">${(p.contacts.phones || []).map((n) => `<a href="tel:+${esc(n)}" style="display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border-radius:12px;background:var(--card2,#f1f3f8);color:inherit;text-decoration:none;font-size:14px;font-weight:600">📞 +${esc(n)}</a>`).join("")}${(p.contacts.emails || []).map((e) => `<a href="mailto:${esc(e)}" style="display:inline-flex;align-items:center;gap:6px;padding:9px 13px;border-radius:12px;background:var(--card2,#f1f3f8);color:inherit;text-decoration:none;font-size:14px;font-weight:600">✉️ ${esc(e)}</a>`).join("")}</div></div>` : ""}
    ${(p.channels || []).length ? `<div class="mtg-card"><div class="mtg-eyebrow">Canales</div><div class="pr-chans">${p.channels.map(chCard).join("")}</div></div>` : ""}
    ${(p.key && !p.isGroup) ? `<div class="mtg-card"><div class="mtg-eyebrow">🕊️ Modo encubierto</div>
      <div class="sub" style="margin:6px 0 10px">${cov && cov.enabled ? `<b style="color:var(--accent)">Activo</b> · estilo <b>${esc(covLbl)}</b>. Los mensajes que le mandes pueden ir cifrados como texto normal; ${esc(nm)} los ve descifrados con la clave.` : `Cifrá tus mensajes disfrazados de poema/cuento/receta — solo ${esc(nm)}, con la clave compartida, los puede leer (como en la película El Santo).`}</div>
      <button class="btn" style="width:100%" onclick='covertConfigSheet(${escj(enck(p.key))}, ${escj(nm)})'>${cov && cov.enabled ? "Cambiar clave o estilo · desactivar" : "🕊️ Configurar"}</button>
    </div>` : ""}
    ${(p.key && !p.isGroup) ? `<div class="mtg-card"><div class="mtg-eyebrow">🏖️ Piloto automático</div>
      <div class="sub" style="margin:6px 0 10px">${ap && ap.enabled ? `<b style="color:var(--accent)">Activo</b> · la IA responde <b>en tu voz</b> las preguntas simples de ${esc(nm)}${ap.maxPerDay > 0 ? ` (máx ${ap.maxPerDay}/día)` : ""}. Todo lo demás (reuniones, verse, plata, fotos, dudas) te lo escala. Nunca suena a IA ni da datos que no diste.` : `Dejá que la IA conteste sola las preguntas simples de ${esc(nm)}, en tu estilo con esta persona. Con filtro estricto: no acepta reuniones ni compromisos, no manda fotos, no inventa datos, y ante la duda te avisa a vos.`}</div>
      <button class="btn" style="width:100%" onclick='autopilotSheet(${escj(enck(p.key))}, ${escj(nm)})'>${ap && ap.enabled ? "Ajustar · desactivar" : "🏖️ Activar para " + esc(nm)}</button>
    </div>` : ""}
    ${(p.key && !p.isGroup) ? `<div class="mtg-card" id="enrichCard"><div class="mtg-eyebrow">🔎 Enriquecimiento social</div><div id="enrichBody" class="sub">Cargando…</div></div>` : ""}
    ${p.pending && !p.stats?.messages ? `<div class="hb-empty" style="text-align:center">Sin historial de conversación con este contacto.</div>` : ""}
    </div>
  </div>`, ST.tab)
  if (p.key && !p.isGroup) loadPersonSocial(p.key, nm)
}
// ── Enriquecimiento social + ego-grafo por persona (perfiles públicos anónimos vía Apify) ──
const REL_COL = { colega: "#5457e5", empresa: "#8158f0", socio: "#12a594", amigo: "#c2410c", amistad: "#c2410c", familia: "#c0392b" }
const relColor = (t) => REL_COL[String(t || "").toLowerCase().trim()] || "#6b6b7d"
const SOCIAL_PLATS = [["linkedin", "LinkedIn", "https://linkedin.com/in/…"], ["instagram", "Instagram", "@usuario o URL"], ["facebook", "Facebook", "URL del perfil"], ["x", "X (Twitter)", "@usuario o URL"]]
window._socialData = {} // enriquecimiento cacheado por key de contacto
let _egoSel = null
window.loadPersonSocial = async (key, nm) => {
  const d = await api("/api/contact/social?key=" + enck(key)).catch(() => null)
  window._socialData[key] = d || {}
  paintPersonSocial(key, nm)
}
function paintPersonSocial(key, nm) {
  const box = document.getElementById("enrichBody"); if (!box) return
  const d = window._socialData[key] || {}, links = d.links || {}
  const inputs = SOCIAL_PLATS.map(([id, label, ph]) =>
    `<label class="tiny muted" style="display:block;margin:9px 2px 3px">${label}</label>
     <input class="inp" id="soc-${id}" value="${esc(links[id] || "")}" placeholder="${esc(ph)}" onblur="savePersonLinks(${escj(enck(key))})" style="padding:9px 11px;box-sizing:border-box">`).join("")
  box.innerHTML = `<div class="sub" style="margin:0 0 4px">Perfiles públicos anónimos — no usa tus cookies ni tu sesión. Pegá las URLs. "Guardar" solo guarda los links; "Investigar" además los busca.</div>${inputs}
    <div class="row" style="gap:8px;margin-top:12px">
      <button class="btn ghost" style="flex:1" onclick='savePersonLinks(${escj(enck(key))}, true)'>💾 Guardar</button>
      <button class="btn" style="flex:1" id="soc-btn" onclick='investigatePerson(${escj(enck(key))}, ${escj(nm)})'>🔍 Investigar</button>
    </div>
    <div id="soc-status" class="tiny" style="text-align:center;margin-top:8px;min-height:15px;color:var(--accent)"></div>
    <div id="soc-result">${renderEnrich(d, nm)}</div>`
  drawEgo(d.profiles, nm)
}
function renderEnrich(d, nm) {
  const errs = d.errors || {}
  const errLine = Object.keys(errs).length ? `<div class="tiny" style="color:var(--warn);margin-top:8px">${Object.entries(errs).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" · ")}</div>` : ""
  const p = d.profiles
  if (!p) return errLine
  const meta = [p.role, p.company, p.location].filter(Boolean).map(esc).join(" · ")
  const interests = (p.interests || []).length ? `<div class="pr-chips" style="margin-top:8px">${p.interests.map((t) => `<span class="pr-chip" style="cursor:default">${esc(t)}</span>`).join("")}</div>` : ""
  const src = (d.sources || []).length ? `<div class="tiny muted" style="margin-top:8px">Fuentes: ${d.sources.map(esc).join(" / ")}</div>` : ""
  const graph = (p.relationships || []).length ? `<div class="mtg-eyebrow" style="margin:16px 0 6px">Grafo de relaciones</div>
    <div style="background:var(--bg2);border-radius:14px;padding:6px"><svg id="egoSvg" viewBox="0 0 100 100" style="width:100%;height:240px;display:block"></svg></div>
    <div id="egoLegend" style="display:flex;flex-wrap:wrap;margin-top:8px"></div>` : ""
  return `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
    ${p.summary ? `<div style="font-size:14px;line-height:1.5;color:var(--ink)">${esc(p.summary)}</div>` : ""}
    ${meta ? `<div class="sub" style="margin-top:6px">${meta}</div>` : ""}
    ${interests}${src}${errLine}${graph}
    ${d.updatedAt ? `<div class="tiny muted" style="margin-top:8px">Actualizado ${esc(ago(d.updatedAt))}</div>` : ""}</div>`
}
function drawEgo(p, nm) {
  const svg = document.getElementById("egoSvg"); if (!svg || !p || !(p.relationships || []).length) return
  const rels = p.relationships.slice(0, 12), cx = 50, cy = 50, R = 33, N = rels.length
  _egoSel = null
  let lines = "", nodes = ""; const types = new Set()
  rels.forEach((r, i) => {
    const ang = -Math.PI / 2 + (i / N) * 2 * Math.PI
    const x = cx + R * Math.cos(ang), y = cy + R * Math.sin(ang), col = relColor(r.type)
    const ty = (String(r.type || "").toLowerCase().trim()); if (ty) types.add(ty)
    lines += `<line class="ego-l" data-i="${i}" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-opacity=".45" stroke-width=".7"/>`
    const ly = y < cy ? y - 6.5 : y + 8.5
    nodes += `<g class="ego-n" data-i="${i}" onclick="egoHi(${i})" style="cursor:pointer">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.6" fill="${col}"/>
      <text x="${x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="3.5" font-weight="600" fill="currentColor">${esc(String(r.name || "").slice(0, 16))}</text></g>`
  })
  svg.style.color = "var(--ink)"
  svg.innerHTML = `${lines}<circle cx="${cx}" cy="${cy}" r="9" fill="var(--accent)"/><text x="${cx}" y="${cy + 1.6}" text-anchor="middle" font-size="4.6" font-weight="800" fill="#fff">${esc(_ini(nm))}</text>${nodes}`
  const leg = document.getElementById("egoLegend")
  if (leg) leg.innerHTML = [...types].map((t) => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);margin:2px 10px 2px 0"><i style="width:9px;height:9px;border-radius:50%;background:${relColor(t)};display:inline-block"></i>${esc(t)}</span>`).join("")
}
window.egoHi = (i) => {
  _egoSel = (_egoSel === i) ? null : i
  document.querySelectorAll("#egoSvg .ego-n").forEach((g) => { g.style.opacity = (_egoSel == null || +g.dataset.i === _egoSel) ? "1" : ".28" })
  document.querySelectorAll("#egoSvg .ego-l").forEach((l) => { l.setAttribute("stroke-opacity", _egoSel == null ? ".45" : (+l.dataset.i === _egoSel ? ".9" : ".1")) })
}
window.savePersonLinks = async (encKey, toast) => {
  const key = decodeURIComponent(encKey), links = {}
  SOCIAL_PLATS.forEach(([id]) => { const el = document.getElementById("soc-" + id); if (el) links[id] = el.value.trim() })
  window._socialData[key] = window._socialData[key] || {}; window._socialData[key].links = links
  await post("/api/contact/links", { key, links }).catch(() => null)
  if (toast) { const st = document.getElementById("soc-status"); if (st) { st.textContent = "✓ Links guardados"; setTimeout(() => { if (st.textContent === "✓ Links guardados") st.textContent = "" }, 2000) } }
}
window.investigatePerson = async (encKey, nm) => {
  const key = decodeURIComponent(encKey), links = {}
  SOCIAL_PLATS.forEach(([id]) => { const el = document.getElementById("soc-" + id); if (el) links[id] = el.value.trim() })
  const btn = document.getElementById("soc-btn"), st = document.getElementById("soc-status")
  if (!Object.values(links).some(Boolean)) { if (st) st.textContent = "Pegá al menos un perfil primero."; return }
  await post("/api/contact/links", { key, links }).catch(() => null)
  if (btn) { btn.disabled = true; btn.textContent = "Investigando…" }
  if (st) st.innerHTML = ORB2("Investigando… puede tardar")
  const r = await post("/api/contact/investigate", { key, links }).catch(() => null)
  if (btn) { btn.disabled = false; btn.textContent = "🔍 Investigar de nuevo" }
  if (!r) { if (st) st.textContent = "No se pudo investigar. Probá de nuevo en un rato."; return }
  if (st) st.textContent = ""
  window._socialData[key] = r
  const res = document.getElementById("soc-result"); if (res) res.innerHTML = renderEnrich(r, nm)
  drawEgo(r.profiles, nm)
}
// globitos del grafo: arrastrables (para leerlos sin que se tapen) y, si no arrastraste, tap → abre la persona
window.grDrag = (e, el) => {
  const graph = el.closest(".gr-graph"); if (!graph) return
  const rect = graph.getBoundingClientRect(), line = document.getElementById("grl" + el.dataset.i)
  let moved = false, sx = e.clientX, sy = e.clientY
  el.style.animation = "none"; el.style.zIndex = 6; el.style.cursor = "grabbing"
  try { el.setPointerCapture(e.pointerId) } catch {}
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return
    moved = true
    const x = Math.max(7, Math.min(93, ((ev.clientX - rect.left) / rect.width) * 100)), y = Math.max(9, Math.min(92, ((ev.clientY - rect.top) / rect.height) * 100))
    el.style.left = x + "%"; el.style.top = y + "%"
    if (line) { line.setAttribute("x2", x.toFixed(1)); line.setAttribute("y2", y.toFixed(1)) }
  }
  const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.style.cursor = "grab"; if (!moved && el.dataset.person) go("#person/" + el.dataset.person) }
  el.addEventListener("pointermove", move); el.addEventListener("pointerup", up)
}
window.showEmail = async (id, key) => { const d = await api("/api/thread?key=" + key); const it = (d.items || []).find((x) => x.id === id) || {}
  openSheet(`<h2>Email completo</h2><div class="sub" style="margin-bottom:12px">${esc(it.name || "")}</div><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${esc(it.full || it.text || "")}</div>`) }

// ══════════ CALENDARIO ══════════
let CALVIEW = "dia"
let CALDATE = "" // "" = hoy
async function viewCalendario() { render(skel(4), "calendario"); apiSWR(`/api/calendar?view=${CALVIEW}&date=${CALDATE}`, (r) => paintCalendario(r || { events: [], kpis: {}, days: [] })) }
// EMPTY-STATE del día sin eventos: en vez de solo "🎉", mostrá cuánto falta para el próximo evento (real) + la sugerencia del Coach (grounded).
function calEmpty(d) {
  const ne = d.nextEvent, cs = d.coachSuggest
  let html = `<div class="hb-empty" style="text-align:center;margin:18px 0 4px">Sin eventos hoy 🎉</div>`
  if (ne) {
    const dd = ne.daysAway, rel = dd <= 0 ? "hoy más tarde" : dd === 1 ? "mañana" : `en ${dd} días`
    const att = (ne.attendees || []).length ? ` · con ${esc(ne.attendees.join(", "))}` : ""
    html += `<div class="set-card" style="margin:10px 0;text-align:left;border-left:3px solid ${ne.color || "var(--accent)"}">
      <div class="tiny muted" style="margin-bottom:4px">Tu próximo evento · ${rel}</div>
      <div class="b" style="font-size:16px">${ne.icon || "📅"} ${esc(ne.title || "Evento")}</div>
      <div class="sub" style="text-transform:capitalize">${esc(ne.when || "")} · ${esc(ne.t1 || "")}${att}</div></div>`
  } else {
    html += `<div class="sub" style="text-align:center;margin:6px 0 12px">No tenés eventos próximos en la agenda.</div>`
  }
  if (cs && (cs.text || cs.convKey)) {
    const btn = cs.convKey ? `<button class="btn" style="margin-top:10px" onclick="go('#conv/${enck(cs.convKey)}')">${cs.name ? "Escribir a " + esc(cs.name) : "Abrir conversación"} →</button>` : ""
    html += `<div class="set-card" style="margin:10px 0;text-align:left;background:var(--bg2)">
      <div class="tiny muted" style="margin-bottom:4px">💡 El Coach sugiere</div>
      <div style="font-size:14px;line-height:1.5">${esc(cs.text || "Aprovechá el día libre para adelantar una conversación pendiente.")}</div>${btn}</div>`
  }
  return `<div style="max-width:480px;margin:8px auto 0;padding:0 4px">${html}</div>`
}
function paintCalendario(d) {
  const k = d.kpis || {}, isWeek = CALVIEW !== "dia", evs = d.events || []
  const MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
  const WD = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"]
  const parseD = (s) => new Date(s + "T12:00:00-05:00")
  const base = parseD(d.base || d.today)
  const semNum = (dt) => { const o = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate())); o.setUTCDate(o.getUTCDate() + 4 - (o.getUTCDay() || 7)); return Math.ceil(((o - new Date(Date.UTC(o.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7) }
  // header
  let eyebrow, title
  if (isWeek) { const d0 = parseD(d.days[0]), d1 = parseD(d.days[d.days.length - 1]); eyebrow = `${d0.getDate()}–${d1.getDate()} ${MES[d1.getMonth()]} ${d1.getFullYear()} · SEM ${semNum(base)}`; title = "Esta semana" }
  else { eyebrow = `${WD[base.getDay()]} · ${MES[base.getMonth()]} ${base.getFullYear()}`; title = `${d.base === d.today ? "Hoy, " : ""}${base.getDate()}` }
  const tabs = [["dia", "Día"], ["laboral", "Laboral"], ["semana", "Semana"]].map(([v, l]) => `<button class="cal-tab${CALVIEW === v ? " on" : ""}" onclick="setCal('${v}')">${l}</button>`).join("")
  // KPI card
  const catBar = (k.catBars || []).length ? `<div class="cal-bar">${(k.catBars).map((c) => `<i style="flex:${c.h};background:${c.color}"></i>`).join("")}<i style="flex:${Math.max(0.3, (k.freeH || 0))};background:rgba(255,255,255,.12)"></i></div>
    <div class="cal-legend">${(k.catBars).map((c) => `<span><b style="background:${c.color}"></b>${c.label} ${c.h}h</span>`).join("")}</div>` : ""
  const miniCards = isWeek
    ? [[`${k.kpiObjetivos || 0}`, "eventos con objetivo"], [k.busiest ? WD[parseD(k.busiest).getDay()] : "—", "día más cargado"], [`${k.pctWork || 0}%`, "en trabajo"]]
    : [[`${k.busyH || 0}h`, "ocupado"], [`${k.overlaps || 0}`, k.overlaps === 1 ? "solapamiento" : "solapamientos"], [k.bestGap || "—", "mejor hueco"]]
  const kpiCard = `<div class="cal-hero"><div class="cal-hero-glow"></div>
    <div class="spread" style="position:relative"><div class="cal-hero-t">${isWeek ? "Tu semana" : "Tu día"}</div><div class="cal-hero-sub">${isWeek ? `${evs.length} reuniones` : `${evs.length} eventos`} · ${k.freeH || 0} h libres</div></div>
    ${catBar}
    <div class="cal-minis">${miniCards.map(([v, l]) => `<div class="cal-mini"><div class="cal-mini-v">${esc(v)}</div><div class="cal-mini-l">${esc(l)}</div></div>`).join("")}</div></div>`
  // día selector (semana/laboral)
  // GRILLA SEMANAL: día×hora, eventos posicionados por hora y solapamientos repartidos en columnas
  const startMin = (e) => { const [h, m] = (e.t1 || "0:0").split(":").map(Number); return h * 60 + m }
  let weekBody = ""
  if (isWeek) {
    let H0 = 8, H1 = 19
    for (const e of evs) { const sm = startMin(e), em = sm + (e.durationMin || 30); H0 = Math.min(H0, Math.floor(sm / 60)); H1 = Math.max(H1, Math.ceil(em / 60)) }
    H0 = Math.max(6, H0); H1 = Math.min(23, H1)
    const rowH = 46, hours = []; for (let h = H0; h <= H1; h++) hours.push(h)
    const layoutDay = (list) => { const s = [...list].sort((a, b) => startMin(a) - startMin(b) || (b.durationMin || 30) - (a.durationMin || 30)); const colEnd = []; for (const e of s) { const sm = startMin(e), em = sm + (e.durationMin || 30); let c = 0; while (c < colEnd.length && sm < colEnd[c]) c++; e._col = c; colEnd[c] = em } const tot = Math.max(1, colEnd.length); s.forEach((e) => (e._cols = tot)); return s }
    const dayCol = (day) => {
      const list = layoutDay(evs.filter((e) => e.day === day))
      const lines = hours.map((h, i) => `<div class="wk-line" style="top:${i * rowH}px"></div>`).join("")
      const blocks = list.map((e) => { const sm = startMin(e), top = (sm - H0 * 60) * rowH / 60, hgt = Math.max(20, (e.durationMin || 30) * rowH / 60), w = 100 / e._cols, left = e._col * w
        return `<div class="wk-ev" style="top:${top}px;height:${hgt}px;left:calc(${left}% + 1px);width:calc(${w}% - 2px);background:${e.color}22;border-left:3px solid ${e.color}" onclick="go('#meeting/${enck(e.id)}')"><div class="wk-ev-t" style="color:${e.color}">${e.t1}</div><div class="wk-ev-ti">${esc(e.title)}</div></div>` }).join("")
      return `<div class="wk-col">${lines}${blocks}</div>`
    }
    const heads = d.days.map((day) => { const dt = parseD(day), on = day === d.today; return `<div class="wk-h${on ? " on" : ""}" onclick="goDay('${day}')"><span>${WD[dt.getDay()]}</span><b>${dt.getDate()}</b></div>` }).join("")
    const axis = hours.map((h, i) => `<div class="wk-hr" style="top:${i * rowH}px">${h}</div>`).join("")
    weekBody = `<div class="wk-head"><div class="wk-h-sp"></div>${heads}</div>
      <div class="wk-scroll"><div class="wk-grid" style="height:${(H1 - H0) * rowH}px"><div class="wk-axis">${axis}</div><div class="wk-cols">${d.days.map(dayCol).join("")}</div></div></div>`
  }
  // timeline del día (vista Día)
  const dayFilter = d.base
  let dayEvs = evs.filter((e) => e.day === dayFilter)
  const badge = (e) => {
    const b = []
    if (e.objetivo) b.push(`<span class="cal-badge kpi">🎯 ${esc((e.objetivo.title || "").replace(/^(Llegar a |Abrir operación en |Sanear |Ordenar |Tiempo de calidad con )/i, "").slice(0, 20))}</span>`)
    if (e.prepReady) b.push(`<span class="cal-badge prep">✦ Prep lista</span>`)
    return b.join("")
  }
  const evItem = (e, prevEnd) => {
    const avs = (e.attendees || []).slice(0, 3).map((a) => `<span class="cal-av" title="${esc(a.name || "")}">${esc(a.initials || (a.name || "?")[0])}</span>`).join("")
    const extra = e.nAtt > 3 ? `<span class="cal-av more">+${e.nAtt - 3}</span>` : ""
    return `<div class="cal-ev" style="--c:${e.color}" onclick="go('#meeting/${enck(e.id)}')">
      <div class="cal-ev-time"><b>${e.t1}</b><span>${e.durationMin >= 60 ? (e.durationMin / 60).toFixed(e.durationMin % 60 ? 1 : 0) + " h" : e.durationMin + " m"}</span></div>
      <div class="cal-ev-body">
        <div class="cal-ev-top"><span class="cal-ev-cat">${e.icon} ${(e.catLabel || "").toUpperCase()}</span>${badge(e)}</div>
        <div class="cal-ev-title">${esc(e.title)}</div>
        <div class="cal-ev-sub">${(e.sources || [])[0] ? esc((e.sources || [])[0]) : ""}${e.location ? " · " + esc(e.location) : ""}</div>
        ${(avs || e.url) ? `<div class="cal-ev-foot">${avs}${extra}${e.url ? `<span class="cal-ev-meet">📹 ${/meet/i.test(e.url) ? "Meet" : /teams/i.test(e.url) ? "Teams" : "Video"}</span>` : ""}</div>` : ""}
      </div></div>`
  }
  // insertar huecos libres entre eventos
  const rows = []
  let prevEnd = null
  for (const e of dayEvs) {
    if (prevEnd && e.t1 > prevEnd && parseInt(e.t1) - parseInt(prevEnd) >= 1) rows.push(`<div class="cal-gap" onclick="go('#mensajes')"><span class="cal-gap-line"></span><span>◎ Hueco libre — el Coach sugiere vaciar la bandeja</span></div>`)
    rows.push(evItem(e, prevEnd)); prevEnd = e.t2 || e.t1
  }
  render(`<div class="screen cal">
    <div class="cal-head"><div><div class="cal-eyebrow">${eyebrow}</div><h1 class="cal-title">${title}</h1></div>
      <div class="row" style="gap:8px"><button class="cal-icon" onclick="calSearch()" title="Buscar" aria-label="Buscar">🔍</button><button class="cal-icon" onclick="setCal('${CALVIEW}')"><span class="cal-filt">${(d.kpis||{}).count||evs.length}</span>⤢</button></div></div>
    <div class="cal-tabs">${tabs}</div>
    ${kpiCard}
    ${isWeek ? weekBody : `<div class="cal-timeline">${rows.join("") || calEmpty(d)}</div>`}
  </div>`, "calendario")
  _calBase = d.base || d.today || _calBase
  // swipe: izq = adelante (siguiente día/semana), der = atrás
  onSwipe(document.querySelector(".cal"), () => shiftCal(1), () => shiftCal(-1))
  setTimeout(preloadCal, 250) // precargar ±1 período en background → el swipe es instantáneo
}
let _calBase = ""
// precarga (y cachea) el período anterior y el siguiente → al deslizar ya está listo; apiSWR igual revalida en background
function preloadCal() {
  const step = CALVIEW === "dia" ? 1 : 7
  for (const dir of [-1, 1]) {
    const b = new Date((_calBase || new Date().toISOString().slice(0, 10)) + "T12:00:00")
    b.setDate(b.getDate() + dir * step)
    const url = `/api/calendar?view=${CALVIEW}&date=${b.toISOString().slice(0, 10)}`
    if (_lsGet(url)) continue // ya cacheado
    api(url).then((r) => { if (r) _lsSet(url, r) }).catch(() => {})
  }
}
window.shiftCal = (dir) => {
  const b = new Date((_calBase || new Date().toISOString().slice(0, 10)) + "T12:00:00")
  b.setDate(b.getDate() + dir * (CALVIEW === "dia" ? 1 : 7)) // día → ±1; laboral/semana → ±7
  CALDATE = b.toISOString().slice(0, 10); viewCalendario()
}
window.setCal = (v) => { CALVIEW = v; CALDATE = ""; viewCalendario() }
window.setCalDate = (day) => { CALDATE = day; viewCalendario() }
window.goDay = (day) => { CALVIEW = "dia"; CALDATE = day; viewCalendario() }
window.calSearch = () => go("#mensajes")

// ══════════ DETALLE REUNIÓN ══════════
async function viewMeeting(id) {
  render(skel(5))
  const m = await api("/api/meeting?id=" + enck(id)) || {}
  const c = m.color || "#6366f1"
  const dayLbl = m.dayLabel || "", t1 = m.t1 || "", t2 = m.t2 || ""
  const dur = m.durationMin ? (m.durationMin >= 60 ? (m.durationMin / 60).toFixed(m.durationMin % 60 ? 1 : 0) + " h" : m.durationMin + " min") : ""
  const att = m.attendees || [], conf = att.filter((a) => a.status === "yes").length
  const meetLabel = /meet/i.test(m.url || "") ? "Google Meet" : /teams/i.test(m.url || "") ? "Microsoft Teams" : /zoom/i.test(m.url || "") ? "Zoom" : "la reunión"
  const stIcon = (s) => s === "yes" ? '<span class="att-st ok">✓</span>' : s === "no" ? '<span class="att-st no">✕</span>' : s === "maybe" ? '<span class="att-st may">?</span>' : ""
  const person = (a) => `<div class="att-row" onclick="viewPerson('${enck(a.name || "")}')">
    <div class="att-av">${avatar(a.name || "?", null)}${stIcon(a.status)}</div>
    <div style="flex:1;min-width:0"><div class="att-name">${esc(a.name || "—")}${a.role ? ` <span class="att-role">· ${esc(a.role)}</span>` : ""}</div>${a.email ? `<div class="att-sub">${esc(a.email)}</div>` : ""}</div>
    <span class="muted">›</span></div>`
  render(`<div class="screen mtg" style="padding:0 0 30px">
    <div class="mtg-hero" style="background:linear-gradient(135deg,${c},${c}dd)">
      <div class="mtg-hero-glow"></div>
      <div class="row spread" style="position:relative"><button class="mtg-back" onclick="history.back()">‹</button>${m.url ? `<a class="mtg-hero-ic" href="${esc(m.url)}" target="_blank">📹</a>` : ""}</div>
      <div style="position:relative;margin-top:6px">
        <div class="mtg-tags">${m.objetivo ? `<span class="mtg-tag hi">🎯 ${esc((m.objetivo.title || "").slice(0, 24))}</span>` : ""}<span class="mtg-tag">${esc(m.catLabel || "Evento")}</span></div>
        <h1 class="mtg-title">${esc(m.title || "Reunión")}</h1>
        <div class="mtg-when">🕐 ${dayLbl}${t1 ? " · " + t1 : ""}${t2 ? "–" + t2 : ""}${dur ? " · " + dur : ""}</div>
        ${(m.sources || []).length ? `<div class="mtg-src">${(m.sources || []).map((s) => `<span>● ${esc(s)}</span>`).join("")}</div>` : ""}
      </div>
    </div>
    <div style="padding:16px">
    ${m.url ? `<a class="mtg-join" href="${esc(m.url)}" target="_blank">📹 Unirse a ${meetLabel}</a>` : ""}
    ${m.objetivo ? `<div class="mtg-card"><div class="spread" style="margin-bottom:2px"><div class="mtg-eyebrow accent" style="margin:0">◈ Aporta a este objetivo</div><span class="mtg-pct">${m.objetivo.pct || 0}%</span></div>
      <div class="b" style="font-size:15px;margin:6px 0">${esc(m.objetivo.title || "")}</div>
      <div class="mtg-prog"><i style="width:${m.objetivo.pct || 0}%"></i></div>
      <div class="mtg-2"><div class="mtg-kv"><div class="mtg-kv-l">Avance</div><div class="mtg-kv-v">${m.objetivo.current || 0}/${m.objetivo.target || 0}${m.objetivo.unit ? " " + esc(m.objetivo.unit) : ""}</div></div><div class="mtg-kv"><div class="mtg-kv-l">Ámbito</div><div class="mtg-kv-v">${esc(m.objetivo.scope || "—")}</div></div></div></div>` : ""}
    ${m.prep ? `<div class="mtg-prep"><div class="mtg-eyebrow light">✦ Preparación</div><div class="mtg-prep-txt">${esc(m.prep)}</div>
      ${(m.linked || []).length ? `<div class="mtg-prep-btns">${(m.linked || []).slice(0, 2).map((l) => `<button class="mtg-prep-btn" onclick="go('#conv/${enck(l.thread || "")}')">${esc((l.from || "hilo").split(" ")[0])} ›</button>`).join("")}</div>` : ""}</div>` : ""}
    ${m.desc ? `<div class="mtg-card"><div class="mtg-eyebrow">Descripción</div><div style="font-size:14.5px;line-height:1.5;color:var(--ink)">${esc(m.desc)}</div>
      ${(m.attachments || []).map((f) => `<div class="mtg-file">📄 ${esc(f.name || f)} ${f.size ? `<span class="muted" style="margin-left:auto">${esc(f.size)}</span>` : ""}</div>`).join("")}</div>` : ""}
    ${att.length ? `<div class="mtg-card"><div class="spread" style="margin-bottom:10px"><div class="mtg-eyebrow" style="margin:0">Asistentes · ${att.length}</div>${conf ? `<span class="att-conf">${conf} confirmado${conf === 1 ? "" : "s"}</span>` : ""}</div>${att.map(person).join("")}</div>` : ""}
    </div>
  </div>`)
}

// ══════════ COACH ══════════
// ══════════ IA PROACTIVA ══════════
let pendingDraft = null // borrador de IA a pre-cargar en el próximo chat que se abra
// Tabs de la sección Foco: Radar (proactivo) + Objetivos, unificados en un solo lugar del nav.
const focoTabs = (active) => `<div class="row" style="gap:6px;margin:0 0 14px">
  <button class="pill${active === "radar" ? " on" : ""}" style="flex:1;padding:9px;font-size:13px" onclick="go('#proactivo')">✨ Radar</button>
  <button class="pill${active === "objetivos" ? " on" : ""}" style="flex:1;padding:9px;font-size:13px" onclick="go('#objetivos')">🎯 Objetivos</button></div>`
async function viewProactivo() {
  render(skel(4), "proactivo")
  const [coach, threads, notes, agenda] = await Promise.all([
    api("/api/coach").then((x) => x || {}),
    api("/api/threads?limit=600").then((x) => x || []),
    api("/api/thread?key=self&limit=10").then((x) => x || { items: [] }),
    api("/api/agenda").then((x) => x || { meetings: [] }),
  ])
  const sugg = threads.filter((t) => t.suggested)
  const { promises = [], questions = [], waiting = [], proposals = [], nudges = [], brief } = coach
  const reconectar = nudges.filter((n) => n.type === "reconectar"), otrosNudges = nudges.filter((n) => n.type !== "reconectar")
  const noteItems = (notes.items || []).filter((i) => i.dir !== "ai" && (i.text || "").trim().length > 3).slice(-6).reverse()
  const now = Date.now()
  const nextMtg = (agenda.meetings || []).map((m) => ({ ...m, t: Date.parse(m.start || "") })).filter((m) => m.t > now && m.t < now + 2 * 86400000).sort((a, b) => a.t - b.t)[0]
  const hour = new Date().getHours(), saludo = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches"
  const ek = (k) => enck(k)
  const replyCard = (t) => `<div class="card" style="margin-bottom:9px;padding:12px">
    <div class="row itemtap" style="gap:9px" onclick="go('#conv/${ek(t.key)}')">${avatar(t.name, t.photo, "sm")}<div style="flex:1;min-width:0"><div class="b small">${esc(t.name)}</div><div class="tiny muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.lastText || "")}</div></div></div>
    <div class="row" style="gap:6px;margin-top:8px"><button class="pill" style="flex:1;background:var(--accent);color:#fff;font-size:12px;padding:6px" onclick="aiDraftGo('${ek(t.key)}')">✍️ Redactar con IA</button><button class="pill" style="font-size:12px;padding:6px 12px" onclick="go('#conv/${ek(t.key)}')">Abrir →</button></div></div>`
  const qCard = (q) => `<div class="card" style="margin-bottom:9px;padding:12px"><div class="itemtap" onclick="go('#conv/${ek(q.thread)}')"><div class="b small">❓ ${esc(q.who || "")} <span class="tiny muted">· hace ${q.ageDays}d</span></div><div class="tiny muted" style="margin-top:2px">"${esc(q.text)}"</div></div>
    <div class="row" style="margin-top:8px"><button class="pill" style="flex:1;background:var(--accent);color:#fff;font-size:12px;padding:6px" onclick="aiDraftGo('${ek(q.thread)}')">✍️ Responder con IA</button></div></div>`
  const promCard = (p) => `<div class="card itemtap" style="margin-bottom:9px;padding:12px" onclick="go('#conv/${ek(p.thread)}')"><div class="b small">🤝 ${esc(p.name || "")} ${p.stillOpen ? '<span class="pill" style="background:#f7e4e0;color:#c2483a;font-size:10px;padding:1px 7px">sin cerrar</span>' : ""}</div><div class="tiny muted" style="margin-top:2px">Prometiste: "${esc(p.text)}"</div></div>`
  const waitCard = (w) => `<div class="card itemtap" style="margin-bottom:9px;padding:12px" onclick="go('#conv/${ek(w.thread)}')"><div class="b small">⏳ ${esc(w.name || "")} <span class="tiny muted">· hace ${w.ageDays}d sin respuesta</span></div><div class="tiny muted" style="margin-top:2px">"${esc(w.text)}"</div></div>`
  const coachCard = (n) => `<div class="card" style="margin-bottom:9px;padding:12px"><div class="row" style="gap:8px;margin-bottom:4px">${ORB}<span class="b small itemtap" style="flex:1${n.convKey ? ";color:var(--accent)" : ""}" ${n.convKey ? `onclick="go('#conv/${ek(n.convKey)}')"` : ""}>${esc(n.subject || "")}${n.convKey ? ' <span class="tiny muted">›</span>' : ""}</span>${n.priority >= 4 ? '<span class="pill" style="background:#f7e4e0;color:#c2483a;padding:1px 7px;font-size:10px">alta</span>' : ""}</div>
    ${n.insight ? `<div class="tiny muted" style="line-height:1.45">${esc(n.insight)}</div>` : ""}${(n.steps || []).slice(0, 2).map((s) => `<div class="tiny" style="padding:2px 0;color:var(--accent)">→ ${esc(s)}</div>`).join("")}
    <div class="row" style="gap:6px;margin-top:8px"><button class="pill" style="font-size:11px;padding:4px 10px" onclick="coachAct('${ek(n.key)}','done',this)">✓ Hecho</button><button class="pill" style="font-size:11px;padding:4px 10px" onclick="coachAct('${ek(n.key)}','snooze',this)">⏰ Después</button><button class="pill" style="font-size:11px;padding:4px 10px" onclick="coachAct('${ek(n.key)}','dismiss',this)">✕ No</button></div></div>`
  const noteCard = (i) => `<div class="card itemtap" style="margin-bottom:8px;padding:11px" onclick="go('#notas')"><div class="small">📝 ${esc((i.text || "").slice(0, 110))}</div><div class="tiny muted" style="margin-top:3px">${ago(i.ts)} · en Mis Notas</div></div>`
  const mtgCard = nextMtg ? `<div class="card" style="margin-bottom:9px;padding:12px;border-left:3px solid var(--accent)"><div class="b small">📅 ${esc(nextMtg.title || "Reunión")}</div><div class="tiny muted" style="margin-top:2px">${new Date(nextMtg.t).toLocaleString("es", { weekday: "short", hour: "2-digit", minute: "2-digit" })}${(nextMtg.attendees || []).length ? ` · con ${esc((nextMtg.attendees || []).slice(0, 4).join(", "))}` : ""}</div></div>` : ""
  const sec = (icon, title, count, cards) => cards ? `<div class="row" style="gap:8px;margin:18px 2px 8px"><span>${icon}</span><span class="b">${title}</span><span class="sub">${count}</span></div>${cards}` : ""
  const total = sugg.length + questions.length + promises.length + waiting.length + proposals.length + nudges.length
  // RADAR proactivo: SOLO lo que el Home NO muestra (lo de hoy vive en Inicio). Acá = lo que se enfría / se te escapa + herramientas generativas.
  const radarTotal = waiting.length + questions.length + reconectar.length + proposals.length + otrosNudges.length
  render(`<div class="screen">${focoTabs("radar")}
    <div class="spread"><h1>✨ Radar</h1><div class="row" style="gap:6px"><button class="pill" id="bellBtn" style="font-size:12px" onclick="notifMenu()">🔔</button><button class="pill" style="font-size:12px" onclick="weeklyReview()">📊 Review</button></div></div>
    <div class="sub" style="margin:0 0 6px"><b>La IA vigila tus mensajes y te avisa qué atender — sin que preguntes nada.</b></div>
    <div class="sub" style="margin:0 0 12px">Acá está lo que se te puede escapar; lo urgente de hoy vive en <b onclick="go('#home')" style="color:var(--accent);cursor:pointer">Inicio 🏠</b>. ¿Querés <b>buscar o preguntar</b> algo puntual? Eso es <b onclick="go('#jarvis')" style="color:var(--accent);cursor:pointer">Jarvis 🧠</b>.</div>
    <div class="row" style="gap:8px;margin:0 0 4px"><button class="btn" style="flex:1;padding:11px;font-size:14px" onclick="socialDigest()">📰 Novedades de redes</button><button class="btn" style="flex:1;padding:11px;font-size:14px;background:#0a66c2" onclick="linkedinDrafts()">✍️ Posts LinkedIn</button></div>
    ${sec("⏳", "No te contestaron (reinsistir)", waiting.length, waiting.map(waitCard).join(""))}
    ${sec("❓", "Te preguntaron y no respondiste", questions.length, questions.map(qCard).join(""))}
    ${sec("🤝", "Reconectar (relaciones a cuidar)", reconectar.length, reconectar.slice(0, 20).map(coachCard).join(""))}
    ${sec("💡", "Oportunidades", proposals.length, proposals.map(coachCard).join(""))}
    ${sec("🎯", "Recordatorios", otrosNudges.length, otrosNudges.slice(0, 50).map(coachCard).join(""))}
    ${!radarTotal ? '<div class="sub" style="text-align:center;margin-top:40px">Nada en el radar ahora — lo urgente ya está en Inicio 🏠. La IA revisa cada pocas horas.</div>' : ""}
  </div>`, "proactivo")
}
// ── Push: registrar Service Worker + suscribirse a notificaciones del celular ──
function urlB64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}
// menú de notificaciones: activar push + horas de silencio (DND)
window.notifMenu = async () => {
  const p = (await api("/api/notif-prefs")) || {}
  window.__notifPrefs = p // mantené fresco el cache de horas de silencio para el sonido
  const opts = (v) => Array.from({ length: 24 }, (_, h) => `<option value="${h}"${v === h ? " selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")
  openSheet(`<h2>🔔 Notificaciones</h2>
    <button class="btn" style="margin:12px 0" onclick="enablePush()">Activar en este dispositivo</button>
    <div class="b small" style="margin:16px 0 6px">🔊 Sonido de mensajes nuevos (con la app abierta)</div>
    <button class="btn ${soundOn() ? "" : "ghost"}" id="soundToggle" onclick="toggleSound()">${soundOn() ? "🔊 Activado · tocá para silenciar" : "🔕 Silenciado · tocá para activar"}</button>
    <div class="b small" style="margin:16px 0 6px">🌙 Horas de silencio (no molestar)</div>
    <div class="row" style="gap:10px;align-items:center"><select class="inp" id="q-start"><option value="">—</option>${opts(p.quietStart)}</select><span class="muted">a</span><select class="inp" id="q-end"><option value="">—</option>${opts(p.quietEnd)}</select></div>
    <div class="sub" style="margin:6px 0 14px">En ese rango no suena ni te llegan notificaciones (los mensajes los ves igual al abrir la app).</div>
    <button class="btn" onclick="saveNotifPrefs()">Guardar</button>`)
}
window.toggleSound = () => { const on = soundOn(); localStorage.setItem("pipe_sound", on ? "off" : "on"); if (!on) playPing(); notifMenu() } // al activar, suena una vez de muestra
window.saveNotifPrefs = async () => {
  const qs = document.getElementById("q-start").value, qe = document.getElementById("q-end").value
  const prefs = { quietStart: qs === "" ? null : +qs, quietEnd: qe === "" ? null : +qe }
  await post("/api/notif-prefs", prefs)
  window.__notifPrefs = { ...(window.__notifPrefs || {}), ...prefs } // aplica las horas de silencio al sonido al instante
  closeSheet(); alert("🔕 Preferencias guardadas.")
}
window.muteThread = async (key, on) => { const r = await post("/api/notif-prefs/mute", { thread: decodeURIComponent(key), on }); return r }
window.enablePush = async () => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return alert("Este navegador no soporta notificaciones push. En iPhone: agregá la app a la pantalla de inicio primero.")
  try {
    const perm = await Notification.requestPermission()
    if (perm !== "granted") return alert("Permiso denegado. Podés reactivarlo en los ajustes del navegador.")
    const reg = await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready
    const { publicKey } = (await api("/api/push/vapid")) || {}
    if (!publicKey) return alert("El servidor no tiene push configurado.")
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) })
    await post("/api/push/subscribe", sub.toJSON())
    await post("/api/push/test", {})
    window.__pushOn = true
    document.querySelector(".push-banner")?.remove() // sacar el aviso al instante, sin esperar re-render
    const b = document.getElementById("bellBtn"); if (b) { b.textContent = "🔔 Activadas ✓"; b.style.opacity = ".7" }
    closeSheet()
    alert("🔔 Notificaciones activadas. Te mandé una de prueba — debería sonar y vibrar. Si no la ves, revisá que las notificaciones estén permitidas para la app en Ajustes de Android.")
  } catch (e) { alert("No se pudo activar: " + (e.message || e) + "\n\niPhone: agregá la app a la pantalla de inicio primero. Android: permití notificaciones para la app.") }
}
// chequea si ESTE dispositivo está suscrito a push → para mostrar el aviso de activación
async function checkPush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") { window.__pushOn = false }
    else { const reg = await navigator.serviceWorker.getRegistration(); window.__pushOn = !!(reg && (await reg.pushManager.getSubscription())) }
  } catch { window.__pushOn = false }
  if (window.__pushOn === false && ST.tab === "home") viewHome() // re-render para mostrar el aviso
}
window.socialDigest = async (force) => {
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>${force ? "Actualizando" : "Cargando"} tus redes…</b></div>${force ? '<div class="sub" style="margin-top:8px">Cruzando IG/FB/LinkedIn — unos segundos.</div>' : ""}`)
  const r = (await api("/api/coach/social" + (force ? "?force=1" : ""))) || {}
  if (!r.digest) return openSheet(`<h2>📰 Novedades de redes</h2><div class="sub">Todavía no hay novedades leídas. Los feeds se leen 4×/día.</div>`)
  const html = esc(r.digest).replace(/^[-•]\s?/gm, "· ").replace(/\n/g, "<br>")
  openSheet(`<div class="spread"><h2 style="margin:0 0 4px">📰 Novedades de tus redes</h2><button class="pill" style="font-size:12px" onclick="socialDigest(1)">🔄 Actualizar</button></div><div class="sub" style="margin:0 0 12px">De ${r.count || 0} posts · IG/FB/LinkedIn${r.cached ? " · guardado" : ""}</div><div style="font-size:15px;line-height:1.6">${html}</div>`)
}
window.linkedinDrafts = async (force) => {
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>${force ? "Regenerando" : "Cargando"} posts…</b></div>${force ? '<div class="sub" style="margin-top:8px">Cruzando novedades + tu voz — unos segundos.</div>' : ""}`)
  const r = (await api("/api/coach/linkedin" + (force ? "?force=1" : ""))) || {}
  if (!r.drafts || !r.drafts.length) return openSheet(`<h2>✍️ Posts para LinkedIn</h2><div class="sub">No pude generar borradores (¿pocas novedades todavía?). <a href="#" onclick="linkedinDrafts(1);return false" style="color:var(--accent)">Regenerar</a></div>`)
  window._liDrafts = r.drafts
  const cards = r.drafts.map((d, i) => `<div class="card" style="margin:8px 0;padding:12px"><div class="tiny b" style="color:var(--accent);margin-bottom:6px">${esc(d.tema || "Opción " + (i + 1))}</div><div style="white-space:pre-wrap;font-size:14.5px;line-height:1.5">${esc(d.texto || "")}</div><button class="pill" style="margin-top:8px" onclick="copyDraft(${i},this)">📋 Copiar</button></div>`).join("")
  openSheet(`<div class="spread"><h2 style="margin:0 0 4px">✍️ Posts para LinkedIn</h2><button class="pill" style="font-size:12px" onclick="linkedinDrafts(1)">🔄 Nuevos</button></div><div class="sub" style="margin:0 0 10px">En tu voz — editás y publicás vos${r.cached ? " · guardado" : ""}</div>${cards}`)
}
window.copyDraft = (i, btn) => { const t = (window._liDrafts || [])[i]?.texto || ""; navigator.clipboard?.writeText(t); if (btn) { btn.textContent = "✓ Copiado"; setTimeout(() => (btn.textContent = "📋 Copiar"), 2000) } }
window.weeklyReview = async () => {
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Armando tu review semanal…</b></div><div class="sub" style="margin-top:8px">Mirando la actividad de los últimos 7 días.</div>`)
  const r = await api("/api/coach/weekly") || {}
  if (!r.review) return openSheet(`<h2>Review semanal</h2><div class="sub">No pude generarlo ahora.</div>`)
  const html = esc(r.review).replace(/^[-•]\s?/gm, "· ").replace(/\n/g, "<br>")
  openSheet(`<h2 style="margin:0 0 4px">📊 Tu semana</h2><div class="sub" style="margin:0 0 12px">${r.sent} enviados · ${r.recv} recibidos${(r.top || []).length ? ` · top: ${esc((r.top || []).slice(0, 3).map((t) => t.name).join(", "))}` : ""}</div><div style="font-size:15px;line-height:1.6">${html}</div>`)
}
window.coachAct = async (key, action, btn) => {
  await post("/api/coach/action", { key: decodeURIComponent(key), action })
  const card = btn.closest(".card"); if (card) { card.style.transition = "opacity .25s"; card.style.opacity = ".3"; card.querySelectorAll("button").forEach((b) => (b.disabled = true)) }
}
window.aiDraftGo = async (key) => {
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Redactando tu respuesta…</b></div>`)
  const r = await api(`/api/thread/suggest-reply?key=${key}`) || {}
  closeSheet(); pendingDraft = r.draft || null
  go("#conv/" + key)
}

async function viewCoach() {
  render(skel(4), "coach")
  const d = await api("/api/coach") || { nudges: [], proposals: [] }
  const card = (n) => `<div class="card" style="margin-bottom:12px"><div class="row" style="gap:8px;margin-bottom:6px">${ORB}<span class="b itemtap" style="flex:1${n.convKey ? ";color:var(--accent)" : ""}" ${n.convKey ? `onclick="go('#conv/${enck(n.convKey)}')"` : ""}>${esc(n.subject || "")}${n.convKey ? ' <span class="tiny muted">›</span>' : ""}</span>${n.priority >= 4 ? '<span class="pill" style="background:#f7e4e0;color:#c2483a;padding:2px 8px;font-size:11px">alta</span>' : ""}</div>
    ${n.insight ? `<div class="small muted" style="line-height:1.45">${esc(n.insight)}</div>` : ""}
    ${(n.steps || []).length ? `<div style="margin-top:8px">${n.steps.map((s) => `<div class="small" style="padding:3px 0">→ ${esc(s)}</div>`).join("")}</div>` : ""}
    <div class="row" style="gap:6px;margin-top:10px"><button class="pill" style="font-size:11px;padding:4px 10px" onclick="coachAct('${enck(n.key)}','done',this)">✓ Hecho</button><button class="pill" style="font-size:11px;padding:4px 10px" onclick="coachAct('${enck(n.key)}','snooze',this)">⏰ Después</button><button class="pill" style="font-size:11px;padding:4px 10px" onclick="coachAct('${enck(n.key)}','dismiss',this)">🗄 Archivar</button></div></div>`
  render(`<div class="screen"><h1>Coach</h1><div class="sub" style="margin-bottom:14px">Sugerencias proactivas de Jarvis${d.updated ? " · " + esc(d.updated) : ""}</div>
    ${(d.nudges || []).slice(0, 50).map(card).join("")}
    ${(d.proposals || []).length ? `<div class="b" style="margin:16px 2px 8px">Propuestas</div>${(d.proposals || []).slice(0, 30).map(card).join("")}` : ""}
    ${!(d.nudges || []).length && !(d.proposals || []).length ? '<div class="sub" style="text-align:center;margin-top:30px">Sin sugerencias por ahora. Jarvis está observando.</div>' : ""}
  </div>`, "coach")
}

// ══════════ OBJETIVOS ══════════
async function viewObjetivos() {
  render(skel(4), "objetivos")
  const [objs, comps] = await Promise.all([api("/api/objetivos"), api("/api/companies")])
  const companies = comps || []
  const label = (o) => { const co = companies.find((x) => x.id === o.scope || x.name === o.scope); return co ? co.name : "Personal" }
  const colr = (o) => { const co = companies.find((x) => x.id === o.scope || x.name === o.scope); return co ? co.color : "#8bb0a2" }
  const row = (o) => { const pct = Math.min(100, Math.round(100 * (o.current || 0) / (o.target || 1)))
    return `<div class="card" style="margin-bottom:10px"><div class="spread"><div><span class="pill" style="background:${colr(o)}22;color:${colr(o)};padding:2px 9px;font-size:11px">${esc(label(o))}</span> <span class="b">${esc(o.title)}</span>${o.source === "ai" ? ' <span class="tiny muted">· sugerido</span>' : ""}</div>
      <div class="b">${o.current || 0}/${o.target || 0}</div></div><div class="progress"><i style="width:${pct}%;background:${colr(o)}"></i></div>
      <div class="row" style="gap:12px;margin-top:8px"><span class="tiny" style="color:var(--accent);cursor:pointer" onclick="editObj('${o.id}')">Editar</span><span class="tiny muted" style="cursor:pointer" onclick="delObj('${o.id}')">Borrar</span></div></div>` }
  const HZ = [["corto", "🎯 Corto plazo"], ["mediano", "📈 Mediano plazo"], ["largo", "🚀 Largo plazo"], ["familiar", "❤️ Familia"], ["otros", "📌 Otros"]]
  const grouped = HZ.map(([k, lbl]) => { const g = (objs || []).filter((o) => (o.horizon || "otros") === k); return g.length ? `<div class="hb-section-title" style="margin:18px 0 8px">${lbl}</div>${g.map(row).join("")}` : "" }).join("")
  render(`<div class="screen">${focoTabs("objetivos")}<div class="spread"><h1>Objetivos</h1><button class="pill on" onclick="editObj()">+ Nuevo</button></div>
    <div class="sub" style="margin-bottom:6px">KPIs personales y de tus empresas, por horizonte. Jarvis mide el progreso solo.</div>
    ${grouped || '<div class="sub" style="text-align:center;margin:20px 0">Todavía no cargaste objetivos.</div>'}
    <div class="card itemtap" style="margin-top:14px;color:var(--accent)" onclick="suggestObj()">${ORB2("Que Jarvis sugiera objetivos")}</div>
  </div>`, "proactivo")
}
window.suggestObj = async () => { openSheet('<div class="row" style="gap:8px">' + ORB + "<b>Jarvis está pensando objetivos…</b></div>")
  const s = await api("/api/objetivos/suggest") || []
  openSheet(`<h2>Sugerencias de Jarvis</h2><div class="sub" style="margin-bottom:12px">Tocá para agregar los que te sirvan.</div>
    ${s.map((o) => `<div class="card itemtap spread" style="margin-bottom:8px;padding:12px" onclick='addSug(${esc(JSON.stringify(o)).replace(/'/g, "&#39;")})'><div><div class="b">${esc(o.title)}</div><div class="sub">${esc(o.scope || "personal")} · meta ${o.target || ""} ${esc(o.unit || "")}</div></div><span style="color:var(--accent)">+</span></div>`).join("") || '<div class="sub">No pude generar sugerencias ahora.</div>'}`) }
window.addSug = async (o) => { await post("/api/objetivo", { ...o, source: "ai", current: 0 }); closeSheet(); viewObjetivos() }
const HORIZONS = [["corto", "🎯 Corto plazo"], ["mediano", "📈 Mediano plazo"], ["largo", "🚀 Largo plazo"], ["familiar", "❤️ Familia"]]
window.editObj = async (id) => { const objs = id ? (await api("/api/objetivos")) : []; const o = (objs || []).find((x) => x.id === id) || { title: "", target: 5, unit: "", scope: "personal", current: 0, horizon: "corto" }
  const comps = await api("/api/companies") || []
  openSheet(`<h2>${id ? "Editar" : "Nuevo"} objetivo</h2>
    <input class="inp" id="o-title" placeholder="Título (ej: 5 clientes nuevos)" value="${esc(o.title)}" style="margin:12px 0">
    <div class="row" style="gap:10px"><input class="inp" id="o-cur" type="number" placeholder="Actual" value="${o.current || 0}"><input class="inp" id="o-tgt" type="number" placeholder="Meta" value="${o.target || ""}"></div>
    <input class="inp" id="o-unit" placeholder="Unidad (clientes, %, noches/semana…)" value="${esc(o.unit || "")}" style="margin:10px 0">
    <select class="inp" id="o-horizon" style="margin-bottom:10px">${HORIZONS.map(([k, l]) => `<option value="${k}" ${(o.horizon || "corto") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select class="inp" id="o-scope" style="margin-bottom:14px"><option value="personal" ${o.scope === "personal" ? "selected" : ""}>Personal</option>${comps.map((c) => `<option value="${c.id}" ${o.scope === c.id || o.scope === c.name ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    <button class="btn" onclick="saveObj('${id || ""}')">Guardar</button>`) }
window.saveObj = async (id) => { const g = (x) => document.getElementById(x).value
  await post("/api/objetivo", { id: id || undefined, title: g("o-title"), current: +g("o-cur") || 0, target: +g("o-tgt") || 0, unit: g("o-unit"), scope: g("o-scope"), horizon: g("o-horizon"), source: "user" })
  closeSheet(); viewObjetivos() }
window.delObj = async (id) => { await post("/api/objetivo/delete", { id }); viewObjetivos() }

// ══════════ ESPACIOS ══════════
async function viewEspacios() {
  render(skel(3))
  const list = await api("/api/espacios") || []
  const roots = list.filter((e) => !e.parent)
  const item = (e) => `<div class="card itemtap row" style="margin-bottom:10px;padding:14px" onclick="go('#espacio/${e.id}')">
    <div class="av" style="background:var(--bg2);color:var(--ink)">${espIcon(e.icon)}</div>
    <div style="flex:1"><div class="b" style="font-size:16px">${esc(e.name)}</div><div class="sub">Espacio · ${(e.members || []).length} personas</div></div><span class="muted">›</span></div>`
  render(`<div class="screen"><div class="spread"><button class="back" onclick="go('#mensajes')">‹ Bandeja</button><button class="pill on" onclick="newEspacio()">+ Nuevo</button></div>
    <h1 style="margin-top:8px">Espacios</h1><div class="sub" style="margin-bottom:14px">Agrupá contactos en niveles (Trabajo → Equipo → Ana…). Cada espacio se ve como un contacto en tu bandeja.</div>
    ${roots.map(item).join("") || '<div class="sub" style="text-align:center;margin-top:20px">Todavía no creaste espacios.</div>'}
  </div>`)
}
window.newEspacio = (parent) => { openSheet(`<h2>Nuevo espacio</h2><input class="inp" id="e-name" placeholder="Nombre (ej: Trabajo, Familia, Clientes)" style="margin:12px 0">
  <input class="inp" id="e-icon" placeholder="Emoji (opcional, ej: 🎓)" style="margin-bottom:14px"><button class="btn" onclick="saveEsp('${parent || ""}')">Crear</button>`) }
window.saveEsp = async (parent) => { await post("/api/espacio", { name: document.getElementById("e-name").value, icon: document.getElementById("e-icon").value, parent: parent || null }); closeSheet(); location.hash.startsWith("#espacio/") ? viewEspacio(location.hash.split("/")[1]) : viewEspacios() }
const ruleIcon = { email: "✉️", domain: "🌐", phone: "📱", name: "👤" }
const ruleText = (r) => `${ruleIcon[r.type] || "•"} ${r.type === "domain" ? "*@" + r.value : esc(r.value)}`
async function viewEspacio(id) {
  render(skel(3))
  const d = await api("/api/espacio/view?id=" + id) || {}
  if (d.error) return render(`<div class="screen"><button class="back" onclick="go('#espacios')">‹ Espacios</button><div class="sub">No existe.</div></div>`)
  // marcar el espacio como visto (limpia el punto de no-leído en la bandeja)
  const maxTs = (d.recent || []).reduce((m, x) => Math.max(m, x.ts || 0), 0)
  if (maxTs) post("/api/thread/seen", { key: "espacio:" + id, ts: maxTs }).catch(() => {})
  const child = (c) => `<div class="card itemtap row" style="margin-bottom:8px;padding:13px" onclick="go('#espacio/${c.id}')"><div class="av sm" style="background:var(--bg2);color:var(--ink)">${espIcon(c.icon)}</div><div style="flex:1"><div class="b">${esc(c.name)}</div><div class="sub">${c.members} regla${c.members === 1 ? "" : "s"}</div></div><span class="muted">›</span></div>`
  // mensaje estilo chat: avatar + nombre + icono de canal + texto, tocable → abre la conversación real
  const msg = (m) => `<div class="esp-msg" ${m.thread ? `onclick="go('#conv/${enck(m.thread)}')"` : ""}>${avatar(m.name || "?", null)}
    <div style="flex:1;min-width:0"><div class="th-top"><span class="th-name">${esc(m.name || "—")}</span><span class="th-icons">${chanIcon(m.channel)}</span><span class="tiny muted" style="margin-left:auto">${ago(m.ts)}</span></div>
      <div class="th-prev">${m.dir === "out" ? "→ " : ""}${esc(m.text)}</div></div></div>`
  const rule = (r, i) => `<div class="pill" style="gap:8px">${ruleText(r)}<span onclick="delRule('${d.id}',${i})" style="cursor:pointer;color:var(--muted2);font-weight:700">✕</span></div>`
  const excp = (r, i) => `<div class="pill" style="gap:8px;background:color-mix(in srgb,var(--accent-2,#e0663a) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent-2,#e0663a) 30%,transparent)">🚫 ${ruleText(r)}<span onclick="delException('${d.id}',${i})" style="cursor:pointer;color:var(--muted2);font-weight:700">✕</span></div>`
  render(`<div class="screen"><button class="back" onclick="go('#mensajes')">‹ Bandeja</button>
    <div class="row" style="margin:8px 0 12px"><div class="av" style="background:var(--bg2);color:var(--ink)">${espIcon(d.icon)}</div><div style="flex:1"><div class="b" style="font-size:19px">${esc(d.name)}</div><div class="sub">Espacio · ${d.count || 0} mensajes</div></div>
      <button class="pill" onclick="newEspacio('${d.id}')">+ Sub</button></div>
    <div class="spread" style="margin:14px 2px 8px"><span class="b">Reglas</span><button class="pill on" style="padding:6px 12px" onclick="newRule('${d.id}')">+ Regla</button></div>
    <div class="sub" style="margin:0 2px 10px">Quién entra a este espacio: por correo, dominio (<b>*@colegio.edu.pe</b>), teléfono o nombre.</div>
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:6px">${(d.rules || []).map(rule).join("") || '<div class="sub">Todavía sin reglas. Tocá <b>+ Regla</b>.</div>'}</div>
    <div class="spread" style="margin:16px 2px 8px"><span class="b">Excepciones</span><button class="pill" style="padding:6px 12px" onclick="newException('${d.id}')">+ Excepción</button></div>
    <div class="sub" style="margin:0 2px 10px">Quién queda <b>afuera</b> aunque cumpla una regla (ej: sacar a una persona de un dominio).</div>
    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:6px">${(d.exceptions || []).map(excp).join("") || '<div class="sub">Sin excepciones.</div>'}</div>
    ${(d.children || []).length ? `<div class="b" style="margin:16px 2px 8px">Subespacios</div>${d.children.map(child).join("")}` : ""}
    <div class="b" style="margin:16px 2px 8px">Mensajes recientes</div>
    ${(d.recent || []).map(msg).join("") || '<div class="sub">Sin mensajes que matcheen las reglas todavía.</div>'}
  </div>`)
}
let ruleType = "email"
window.newRule = (id) => {
  ruleType = "email"
  const tb = (t, label) => `<button class="pill" id="rt-${t}" style="flex:1;justify-content:center;padding:9px" onclick="pickRuleType('${t}')">${ruleIcon[t]} ${label}</button>`
  openSheet(`<h2>Nueva regla</h2><div class="sub" style="margin:6px 0 12px">Los mensajes que matcheen entran al espacio.</div>
    <div class="row" style="gap:6px;margin-bottom:6px">${tb("email", "Correo")}${tb("domain", "Dominio")}</div>
    <div class="row" style="gap:6px;margin-bottom:12px">${tb("phone", "Teléfono")}${tb("name", "Nombre")}</div>
    <input class="inp" id="r-val" style="margin-bottom:6px" autofocus>
    <div class="sub" id="r-hint" style="margin-bottom:14px"></div>
    <button class="btn" onclick="saveRule('${id}')">Agregar regla</button>`)
  pickRuleType("email")
}
window.pickRuleType = (t) => {
  ruleType = t
  for (const x of ["email", "domain", "phone", "name"]) { const el = document.getElementById("rt-" + x); if (el) el.classList.toggle("on", x === t) }
  const ph = { email: "profesor@colegio.edu.pe", domain: "colegio.edu.pe", phone: "51999888777", name: "Nombre exacto del contacto" }
  const hint = { email: "Un correo exacto.", domain: "Todos los <b>*@dominio</b> (ej: cualquiera de colegio.edu.pe).", phone: "Solo dígitos, con código de país.", name: "Nombre tal cual aparece en la bandeja." }
  const inp = document.getElementById("r-val"); if (inp) { inp.placeholder = ph[t]; inp.focus() }
  const h = document.getElementById("r-hint"); if (h) h.innerHTML = hint[t]
}
window.saveRule = async (id) => {
  const value = document.getElementById("r-val").value.trim()
  if (!value) return
  const r = await post("/api/espacio/rule", { id, type: ruleType, value })
  if (r && r.error) return alert(r.error)
  closeSheet(); viewEspacio(id)
}
window.delRule = async (id, idx) => { await post("/api/espacio/rule/delete", { id, idx }); viewEspacio(id) }
window.newException = (id) => {
  ruleType = "email"
  const tb = (t, label) => `<button class="pill" id="rt-${t}" style="flex:1;justify-content:center;padding:9px" onclick="pickRuleType('${t}')">${ruleIcon[t]} ${label}</button>`
  openSheet(`<h2>Nueva excepción</h2><div class="sub" style="margin:6px 0 12px">Lo que matchee queda <b>AFUERA</b> del espacio, aunque cumpla una regla.</div>
    <div class="row" style="gap:6px;margin-bottom:6px">${tb("email", "Correo")}${tb("domain", "Dominio")}</div>
    <div class="row" style="gap:6px;margin-bottom:12px">${tb("phone", "Teléfono")}${tb("name", "Nombre")}</div>
    <input class="inp" id="r-val" style="margin-bottom:6px" autofocus>
    <div class="sub" id="r-hint" style="margin-bottom:14px"></div>
    <button class="btn" onclick="saveException('${id}')">Agregar excepción</button>`)
  pickRuleType("email")
}
window.saveException = async (id) => {
  const value = document.getElementById("r-val").value.trim()
  if (!value) return
  const r = await post("/api/espacio/exception", { id, type: ruleType, value })
  if (r && r.error) return alert(r.error)
  closeSheet(); viewEspacio(id)
}
window.delException = async (id, idx) => { await post("/api/espacio/exception/delete", { id, idx }); viewEspacio(id) }

// ══════════ FUSIÓN DE CONTACTOS ══════════
window.openContactSettings = async (keyEnc) => {
  const key = decodeURIComponent(keyEnc)
  openSheet(`<div class="row" style="gap:8px">${ORB}<b>Cargando…</b></div>`)
  const info = await api("/api/contact/info?key=" + enck(key)) || { category: "auto" }
  const cat = info.category || "auto"
  const catBtn = (id, label, emoji) => `<button class="pill ${cat === id ? "on" : ""}" style="flex:1;justify-content:center;padding:10px" onclick="setCategory('${keyEnc}','${id}')">${emoji} ${label}</button>`
  openSheet(`<h2>${esc(convState?.name || key)}</h2>
    <div class="sub" style="margin:6px 0 14px">¿Qué es esta persona para vos?</div>
    <div class="row" style="gap:6px;margin-bottom:8px">${catBtn("familia", "Familia", "🏠")}${catBtn("amigos", "Amigos", "🧑‍🤝‍🧑")}${catBtn("trabajo", "Trabajo", "💼")}</div>
    <div class="row" style="gap:6px;margin-bottom:16px"><button class="pill ${cat === "auto" ? "on" : ""}" style="flex:1;justify-content:center;padding:8px" onclick="setCategory('${keyEnc}','auto')">🤖 Que decida Jarvis</button></div>
    <div style="border-top:1px solid var(--line);padding-top:14px">
      <button class="btn ${info.pinned ? "" : "ghost"}" style="margin-bottom:10px" onclick="togglePin('${keyEnc}',${info.pinned ? "false" : "true"})">${info.pinned ? "📌 Fijado arriba · quitar" : "📌 Fijar arriba"}</button>
      <button class="btn ghost" style="margin-bottom:10px" onclick="toggleSilence('${keyEnc}',${info.silenced ? "false" : "true"})">${info.silenced ? "🔔 Quitar de Silenciados" : "🔕 Silenciar (mover a “Silenciados”)"}</button>
      <button class="btn ghost" onclick="findMerge('${keyEnc}')">🔗 Buscar si es la misma persona que otra</button></div>`)
}
window.togglePin = async (keyEnc, pinned) => { await post("/api/contact/pin", { key: decodeURIComponent(keyEnc), pinned: pinned === true || pinned === "true" }); closeSheet(); if (typeof viewMensajes === "function" && location.hash.replace("#", "").split("/")[0] === "mensajes") viewMensajes() }
// SILENCIAR: mover el hilo a la pestaña "Silenciados" (o sacarlo). Ruido que no es spam. Vuelve a la bandeja para reflejarlo.
window.toggleSilence = async (keyEnc, on) => { const yes = on === true || on === "true"; await post("/api/contact/silence", { key: decodeURIComponent(keyEnc), on: yes }); closeSheet()
  openSheet(`<div style="text-align:center;padding:20px"><div style="font-size:36px">${yes ? "🔕" : "🔔"}</div><b>${yes ? "Silenciado" : "De vuelta en la bandeja"}</b><div class="sub">${yes ? "Lo movimos a “Silenciados”. Podés verlo ahí cuando quieras." : "Vuelve a aparecer en tu bandeja normal."}</div><button class="btn" style="margin-top:14px" onclick="closeSheet();go('#mensajes')">Listo</button></div>`) }
window.setCategory = async (keyEnc, category) => { await post("/api/contact/category", { key: decodeURIComponent(keyEnc), category }); closeSheet()
  openSheet(`<div style="text-align:center;padding:20px"><div style="font-size:36px">✅</div><b>Guardado</b><div class="sub">Movido a ${category === "auto" ? "automático" : category}.</div><button class="btn" style="margin-top:14px" onclick="closeSheet();viewMensajes()">Listo</button></div>`) }
window.findMerge = async (keyEnc) => { openSheet(`<div class="row" style="gap:8px">${ORB}<b>Buscando coincidencias…</b></div>`)
  const sugs = await api("/api/contact/suggestions?key=" + keyEnc) || []
  const mine = sugs[0]
  if (!mine) return openSheet(`<h2>Sin coincidencias</h2><div class="sub">Jarvis no encontró otra conversación que parezca la misma persona.</div><button class="btn ghost" style="margin-top:14px" onclick="closeSheet()">Cerrar</button>`)
  openSheet(mergeCard(mine)) }
function mergeCard(s) {
  return `<div style="text-align:center"><div class="row" style="gap:8px;justify-content:center;margin-bottom:14px">${ORB}<b style="color:#5fa88f">Jarvis cree que son la misma persona</b></div>
    <div class="b" style="font-size:20px">${esc(s.name)}</div><div class="sub" style="margin-bottom:14px">${(s.channels || []).map((c) => CH[c] || c).join(" · ")}</div>
    <div class="progress" style="height:8px;margin:0 20px 6px"><i style="width:${s.confidence}%;background:${s.confidence >= 75 ? "var(--ok)" : "#e0a03a"}"></i></div><div class="small muted">Confianza · ${s.confidence >= 75 ? "Alta" : "Media"} · ${s.confidence}%</div>
    <div style="text-align:left;margin:14px 0 8px">${(s.reasons || []).map((r) => `<div class="small" style="padding:4px 0">${r[0] === "⚠" ? "" : "✓ "}${esc(r)}</div>`).join("")}</div>
    <div class="tiny muted" style="text-align:left;margin-bottom:6px">Últimos mensajes de cada conversación:</div>
    <div style="text-align:left;margin-bottom:14px">${(s.samples || []).map((sm) => `<div class="card" style="padding:9px 11px;margin-bottom:6px"><span class="tag ${sm.channel}">${esc(sm.label || sm.channel)}</span> <span class="small muted">${esc(sm.text || "—")}</span></div>`).join("")}</div>
    <div class="row" style="gap:10px"><button class="btn ghost" onclick="closeSheet()">Son distintas</button><button class="btn" style="background:var(--ok)" onclick='doMerge(${esc(JSON.stringify(s.name))},${esc(JSON.stringify(s.keys || s.channelIds || []))})'>Es la misma</button></div></div>`
}
window.doMerge = async (target, keys) => { await post("/api/contact/merge", { target, keys }); openSheet(`<div style="text-align:center;padding:20px"><div style="font-size:40px">✅</div><b>Fusionado.</b><div class="sub">Ahora son una sola conversación.</div><button class="btn" style="margin-top:16px" onclick="closeSheet();viewMensajes()">Listo</button></div>`) }

// ══════════ JARVIS ══════════
let jarvisMsgs = []
function viewJarvis() {
  ST.tab = "jarvis"
  const body = jarvisMsgs.map((m) => `<div class="bubble ${m.role === "me" ? "out" : "in"}">${esc(m.text)}</div>`).join("")
  app.innerHTML = `<div class="screen" style="min-height:100vh;display:flex;flex-direction:column">
    <button class="back" onclick="go('#home')">‹ Inicio</button>
    <div class="row" style="gap:10px;margin:8px 0 16px"><div class="orb" style="width:44px;height:44px"></div><div><div class="b" style="font-size:19px">Jarvis</div><div class="sub">Vos preguntás, él busca en tus datos · privado en tu server</div></div></div>
    <div id="jbody" style="flex:1;overflow:auto">${body || `<div class="sub" style="text-align:center;margin-top:40px">Preguntame lo que quieras sobre tus mensajes, gente, reuniones…<br><br>Ej: "¿quién me debe plata?", "resumime lo de Carlos"</div>`}</div>
    <div class="card row" style="padding:8px;gap:8px;margin-top:10px"><input class="inp" id="jinp" style="border:none" placeholder="Pregúntale a Jarvis…" onkeydown="if(event.key==='Enter')jarvisAsk()">
      <button class="orb" style="width:40px;height:40px;border:none" onclick="jarvisVoice()" id="jmic" aria-label="Hablar con Jarvis"></button></div></div>`
  const jb = document.getElementById("jbody"); if (jb) jb.scrollTop = jb.scrollHeight
}
window.jarvisAsk = async (text) => { const inp = document.getElementById("jinp"); const q = text || (inp && inp.value); if (!q) return
  jarvisMsgs.push({ role: "me", text: q }); if (inp) inp.value = ""; jarvisMsgs.push({ role: "ai", text: "…" }); viewJarvis()
  const r = await post("/api/ask", { q }); jarvisMsgs[jarvisMsgs.length - 1] = { role: "ai", text: (r && r.answer) || "No pude responder ahora." }; viewJarvis() }
window.jarvisVoice = async () => { const mic = document.getElementById("jmic"); if (mic) mic.style.transform = "scale(1.2)"
  try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const rec = new MediaRecorder(stream); const chunks = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); if (mic) mic.style.transform = ""
      const blob = new Blob(chunks, { type: "audio/webm" }); const r = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": "audio/webm" }, body: blob }).then((x) => x.json()).catch(() => null)
      if (r && r.text) jarvisAsk(r.text) }
    rec.start(); setTimeout(() => rec.stop(), 4500)
  } catch { if (mic) mic.style.transform = ""; alert("Necesito permiso de micrófono.") } }

// ══════════ SHEET ══════════
let _sheetReturn = null
window.openSheet = (html) => {
  closeSheet()
  _sheetReturn = document.activeElement // para devolver el foco al cerrar (a11y: no perder el lugar)
  const m = $(`<div class="modal" onclick="if(event.target===this)closeSheet()"><div class="sheet" role="dialog" aria-modal="true" tabindex="-1">${html}</div></div>`)
  document.body.appendChild(m)
  a11yUpgrade(m)
  m.querySelector(".sheet")?.focus() // mover el foco al diálogo (no a un input → no abre teclado de sorpresa)
}
window.closeSheet = () => {
  if (!document.querySelector(".modal")) return
  document.querySelectorAll(".modal").forEach((m) => m.remove())
  if (_sheetReturn?.focus) { try { _sheetReturn.focus() } catch {} ; _sheetReturn = null }
}

// ══════════ ROUTER ══════════
function route() {
  const h = location.hash.slice(1) || "home"; const [base, arg] = h.split("/"); closeSheet()
  if (base !== "conv") window.onscroll = null // solo la conversación usa el globito flotante de fecha
  if (base === "mensajes") return viewMensajes()
  if (base === "conv") return viewConv(decodeURIComponent(arg || ""))
  if (base === "calendario") { if (arg && ["dia", "laboral", "semana"].includes(arg)) CALVIEW = arg; return viewCalendario() }
  if (base === "meeting") return viewMeeting(decodeURIComponent(arg || ""))
  if (base === "proactivo") return viewProactivo()
  if (base === "coach") return viewProactivo() // Coach fusionado en Radar
  if (base === "objetivos") return viewObjetivos()
  if (base === "notas") { ST.tab = "notas"; return viewNotas() }
  if (base === "notas-raw") { ST.tab = "notas"; return viewConv("self") }
  if (base === "espacios") return viewEspacios()
  if (base === "espacio") return viewEspacio(arg)
  if (base === "person") return viewPersonScreen(decodeURIComponent(arg || ""))
  if (base === "jarvis") return viewJarvis()
  if (base === "cuenta") { ST.tab = "cuenta"; return viewSettings() }
  if (base === "agregar") { ST.tab = "cuenta"; viewSettings(); return addConnectionSheet(arg || "correo") } // deep-link / redirect de /link
  if (base === "ayuda") { ST.tab = "cuenta"; viewSettings(); return faqSheet() } // deep-link / redirect de /guia
  viewHome()
}
window.setupPinPrompt = async () => {
  const s = await api("/api/auth/status")
  if (!s || s.pinSet || !s.canSetup) return // ya tiene PIN, o no es un equipo local que pueda crearlo
  openSheet(`<h2 style="margin:0 0 4px">🔒 PIN de acceso remoto</h2><div class="sub" style="margin:0 0 12px">Para entrar desde internet (${esc(location.host)}) necesitás un PIN. Acá en tu equipo no te lo pide.</div>
    <input id="newpin" type="password" inputmode="numeric" maxlength="12" placeholder="PIN de 4 a 12 dígitos" style="width:100%;box-sizing:border-box;padding:12px;font-size:18px;letter-spacing:4px;text-align:center;border-radius:12px;border:1px solid var(--line);margin-bottom:10px" onkeydown="if(event.key==='Enter')savePin()">
    <button class="btn" style="width:100%" onclick="savePin()">Crear PIN</button>
    <button class="btn ghost" style="width:100%;margin-top:8px" onclick="closeSheet()">Ahora no</button>
    <div id="pinerr" style="color:#e0663a;font-size:13px;margin-top:8px"></div>`)
}
window.savePin = async () => {
  const r = await post("/api/auth/setup", { pin: document.getElementById("newpin").value })
  if (r && r.ok) { closeSheet(); alert("✅ PIN creado. Usalo para entrar desde internet.") }
  else document.getElementById("pinerr").textContent = (r && r.error) || "error"
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.querySelector(".modal")) closeSheet() }) // Escape cierra la sheet abierta
document.addEventListener("keydown", (e) => { // Enter/Espacio activan los [onclick] upgradeados (role=button) — como un botón nativo
  if (e.key !== "Enter" && e.key !== " ") return
  const el = e.target
  if (!el?.getAttribute || el.getAttribute("role") !== "button" || !el.hasAttribute("onclick")) return
  if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
  e.preventDefault(); el.click()
})
window.announce = (msg) => { const l = document.getElementById("live"); if (l) { l.textContent = ""; setTimeout(() => { l.textContent = String(msg || "") }, 60) } } // región aria-live (lectores de pantalla)
window.addEventListener("hashchange", route)
route()

// ── SYNC BAR: barra fija arriba que muestra qué canal está bajando su carga inicial (primera sync). En toda pantalla. ──
function ensureSyncBar() {
  if (document.getElementById("syncbar")) return
  const css = document.createElement("style")
  css.textContent = "#syncbar{position:fixed;top:0;left:0;right:0;z-index:99999;display:none;align-items:center;gap:9px;background:var(--accent,#5457e5);color:#fff;font-size:12.5px;font-weight:600;padding:6px 14px;box-shadow:0 1px 8px rgba(20,20,50,.2);overflow:hidden}#syncbar.on{display:flex}#syncbar .sb-sp{width:13px;height:13px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:sbspin .7s linear infinite;flex:none}#syncbar .sb-bar{position:absolute;bottom:0;height:2px;width:32%;background:rgba(255,255,255,.9);animation:sbslide 1.3s ease-in-out infinite}@keyframes sbspin{to{transform:rotate(360deg)}}@keyframes sbslide{0%{left:-32%}100%{left:100%}}@media(prefers-reduced-motion:reduce){#syncbar .sb-sp,#syncbar .sb-bar{animation:none}#syncbar .sb-bar{width:100%;left:0;opacity:.5}}"
  document.head.appendChild(css)
  const sb = document.createElement("div"); sb.id = "syncbar"; sb.setAttribute("role", "status"); sb.setAttribute("aria-live", "polite")
  document.body.appendChild(sb)
}
async function pollSync() {
  ensureSyncBar()
  const sb = document.getElementById("syncbar")
  try {
    const r = await api("/api/sync-status")
    const list = (r && r.syncing) || []
    if (list.length) { sb.className = "on"; sb.innerHTML = `<span class="sb-sp"></span><span>Sincronizando ${list.map((c) => esc(c.label) + (c.count ? ` · ${c.count} mensajes` : "")).join(" · ")}…</span><span class="sb-bar"></span>`; document.body.style.paddingTop = "29px" }
    else { sb.className = ""; document.body.style.paddingTop = "" }
  } catch {}
  clearTimeout(window._syncT); window._syncT = setTimeout(pollSync, 4000)
}
pollSync()
// retorno del OAuth de Gmail (/?gmail=ok|err&m=…#cuenta) → aviso + limpiar la URL
;(() => { const p = new URLSearchParams(location.search), g = p.get("gmail"); if (!g) return; alert(g === "ok" ? "✅ " + (p.get("m") || "Gmail conectado") : "⛔ No se pudo conectar Gmail: " + (p.get("m") || "")); history.replaceState(null, "", location.pathname + location.hash) })()

// BANNER DE RE-LINK: si un número de WhatsApp se desloguea (recibís pero no podés enviar), avisá arriba con 1 tap para revincular.
async function checkWaDown() {
  const r = await api("/api/wa/status").catch(() => null)
  const nums = (r && r.loggedOut) || []
  let b = document.getElementById("waBanner")
  if (!nums.length) { if (b) { b.remove(); document.body.style.paddingTop = "" } return }
  if (!b) { b = document.createElement("div"); b.id = "waBanner"; document.body.appendChild(b) }
  b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:80;background:#e0663a;color:#fff;padding:9px 14px;font-size:13px;line-height:1.35;display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap;box-shadow:0 2px 12px rgba(0,0,0,.18)"
  b.innerHTML = `<span>⚠️ WhatsApp <b>${nums.map(esc).join(", ")}</b> desconectado — recibís pero no podés responder esos chats.</span><button onclick="addConnectionSheet('telefonia')" style="background:#fff;color:#e0663a;border:0;border-radius:999px;padding:6px 14px;font-weight:700;font-size:13px;cursor:pointer;flex-shrink:0">Revincular →</button>`
  document.body.style.paddingTop = b.offsetHeight + "px"
}
checkWaDown(); setInterval(checkWaDown, 120000)
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkWaDown() })
// registrar el SW al arrancar → cachea el app-shell (carga rápida + offline). Silencioso, no bloquea.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(checkPush).catch(() => {})
setupPinPrompt() // se auto-descarta si el PIN ya está o si no es un equipo local; insiste en localhost hasta crearlo
// identidad del hub (nombre/empresa/números) → refresca el cache y re-pinta el Home si cambió el nombre
api("/api/hub-config").then((h) => { if (h && h.ownerName) { const changed = !window.__hub || window.__hub.ownerFirst !== h.ownerFirst; window.__hub = h; _lsSet("hub", h); if (changed && ST.tab === "home") viewHome() } }).catch(() => {})
// salud de canales: si un bridge se cayó, avisar en el Home para reconectar (los bridges son frágiles)
api("/api/channels").then((h) => { const s = (h && h.stale) || []; const changed = JSON.stringify(s) !== JSON.stringify(window.__chanStale || []); window.__chanStale = s; if (changed && s.length && ST.tab === "home") viewHome() }).catch(() => {})

// ── AUTO-REFRESH tipo AJAX (sin reload): al volver a la app y cada tanto, trae lo nuevo sin que tengas que refrescar ──
async function softRefreshThreads() {
  const rows = await api("/api/threads?limit=600").catch(() => null)
  if (!rows || ST.tab !== "mensajes") return
  if (threadsSig(rows) === _threadsSig) return // nada cambió → no repintar (evita churn/flicker + preserva scroll/filtro)
  const y = window.scrollY
  _lsSet("/api/threads?limit=600", rows); paintMensajes(rows); window.scrollTo(0, y) // repinta conservando el scroll
}
function refreshCurrent(fromResume) {
  if (document.hidden) return
  const base = (location.hash.slice(1) || "home").split("/")[0]
  if (base === "conv" && convState && convState.key) refreshConv(convState.key)
  else if (base === "mensajes") softRefreshThreads()
  else if (fromResume && (base === "home" || base === "" || base === "proactivo")) route() // al volver, re-fetch de la pantalla actual
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshCurrent(true) }) // volviste a la app → actualizá solo
setInterval(() => refreshCurrent(false), 15000) // cada 15s, solo si la app está visible (barato: ETag/304 en /api/threads)
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "refresh") refreshCurrent(false) }) // push → refrescá al instante

// ── SONIDO de mensaje nuevo (con la app abierta): poll barato del contador de entrantes; si sube → "ding" (WebAudio, sin assets, CSP-safe) ──
let _lastUnread = null, _skipPingOnce = false, _ac = null
const soundOn = () => localStorage.getItem("pipe_sound") !== "off" // por defecto: encendido
function inQuietHours() { // respeta las "horas de silencio" (mismas que el push) — no suena en ese rango
  const p = window.__notifPrefs; if (!p || p.quietStart == null || p.quietEnd == null) return false
  const h = new Date().getHours(), s = p.quietStart, e = p.quietEnd
  return s <= e ? (h >= s && h < e) : (h >= s || h < e) // rango que puede cruzar la medianoche
}
api("/api/notif-prefs").then((p) => { if (p) window.__notifPrefs = p }).catch(() => {}) // cachea las horas de silencio al arrancar
function _audioCtx() { try { _ac = _ac || new (window.AudioContext || window.webkitAudioContext)(); if (_ac.state === "suspended") _ac.resume() } catch {} return _ac }
function playPing() {
  const ac = _audioCtx(); if (!ac) return
  try {
    const t0 = ac.currentTime
    for (const [freq, at] of [[880, 0], [1320, 0.12]]) { // dos notas cortas tipo campanita
      const o = ac.createOscillator(), g = ac.createGain()
      o.type = "sine"; o.frequency.value = freq; o.connect(g); g.connect(ac.destination)
      g.gain.setValueAtTime(0.0001, t0 + at)
      g.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22)
      o.start(t0 + at); o.stop(t0 + at + 0.24)
    }
  } catch {}
}
// desbloquear el audio con el primer gesto (política de autoplay del navegador/webview)
;["pointerdown", "keydown", "touchstart"].forEach((ev) => window.addEventListener(ev, _audioCtx, { once: true }))
async function newMsgCheck() {
  if (document.hidden) return // en segundo plano el push/OS se encarga del aviso
  const r = await api("/api/unread").catch(() => null)
  if (!r || typeof r.n !== "number") return
  if (!_skipPingOnce && _lastUnread !== null && r.n > _lastUnread && soundOn() && !inQuietHours()) playPing() // subió el contador de entrantes → llegó algo nuevo (salvo silenciado / horas de silencio)
  _skipPingOnce = false; _lastUnread = r.n
}
setInterval(newMsgCheck, 12000)
document.addEventListener("visibilitychange", () => { if (!document.hidden) { _skipPingOnce = true; newMsgCheck() } }) // al volver, sincroniza el baseline SIN sonar (el push ya avisó)
newMsgCheck() // baseline inicial (no suena la primera vez)
