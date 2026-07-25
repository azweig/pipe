// Genera el DOSSIER técnico completo (docs/dossier.html + docs/openapi.json) para revisión de arquitectura.
// Luego se convierte a PDF con Chrome headless. Correr:  node scripts/gen-dossier.mjs
import { readFileSync, writeFileSync, readdirSync } from "fs"
import { join } from "path"

const read = (f) => readFileSync(f, "utf8")
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// ── 1. Endpoints (fuente de verdad = server.mjs) ──
const server = read("src/server.mjs")
const eps = []
for (const m of server.matchAll(/path === "(\/api\/[^"]+)"(?:\s*&&\s*req\.method === "(\w+)")?/g)) eps.push({ path: m[1], method: m[2] || "GET" })
// dedup
const seen = new Set(); const endpoints = eps.filter((e) => { const k = e.method + e.path; if (seen.has(k)) return false; seen.add(k); return true })

const GROUPS = [
  ["Auth", /^\/api\/auth/],
  ["Bandeja e hilos", /^\/api\/(summary|threads|thread$|thread\?|thread\/|send)/],
  ["Contactos e identidad", /^\/api\/(person|contact|directory)/],
  ["IA · Coach · Búsqueda", /^\/api\/(coach|ask|reply|search|meeting-prep|llm-usage)/],
  ["Notificaciones push", /^\/api\/push/],
  ["Voz y briefing", /^\/api\/(briefing|daily-plan|config|voices|tts|stt)/],
  ["Espacios · Objetivos · Empresas", /^\/api\/(home|objetivo|compan|espacio)/],
  ["Reuniones (notetaker)", /^\/api\/meeting/],
  ["Integraciones y vínculos", /^\/api\/(wa-|matrix|status|add-email|agenda|email)/],
]
const groupOf = (p) => (GROUPS.find(([, rx]) => rx.test(p)) || ["Otros"])[0]

// descripciones curadas (legibilidad); las no mapeadas caen al nombre del handler
const DESC = {
  "GET /api/auth/status": "Estado del PIN y de la sesión (pinSet, authed, canSetup).",
  "POST /api/auth/setup": "Crea el PIN la primera vez (solo desde localhost/túnel).",
  "POST /api/auth": "Login con PIN → setea cookie de sesión (token aleatorio, no el PIN).",
  "POST /api/auth/logout": "Cierra sesión y borra la cookie.",
  "GET /api/summary": "Contadores globales de la bandeja (totales por canal, sin leer).",
  "GET /api/threads": "Lista de hilos unificados ordenados por actividad (bandeja). Param: limit.",
  "GET /api/thread": "Timeline unificado de una conversación (fusiona canales). Params: key, before, limit.",
  "GET /api/thread/catchup": "Resumen multimodal de lo que te perdiste en un hilo (imágenes/audios/docs). Params: key, since.",
  "GET /api/thread/media": "Galería de adjuntos de un hilo (fotos, docs, audios, video).",
  "GET /api/thread/targets": "Canales/números disponibles para responderle a ese contacto.",
  "POST /api/thread/seen": "Marca el hilo como visto hasta un timestamp.",
  "GET /api/thread/suggest-reply": "Borrador de respuesta con IA para el input (NO envía).",
  "GET /api/thread/summarize": "Resumen del chat en un rango, guardado como nota IA. Param: range.",
  "POST /api/send": "Envía una respuesta por el canal correcto (WhatsApp vía bridge / email vía SMTP).",
  "GET /api/person": "Vista 360 de una persona (histórico, canales, señales).",
  "GET /api/contact/profile": "Perfil rico de un contacto (categoría, empresa, foto, stats).",
  "POST /api/contact/pin": "Fija/desfija un contacto en la bandeja.",
  "POST /api/contact/archive": "Archiva/desarchiva un hilo.",
  "POST /api/contact/spam": "Marca un remitente como spam y archiva.",
  "POST /api/contact/merge": "Fusiona varios identificadores en un solo contacto (identidad manual).",
  "POST /api/contact/unmerge": "Deshace una fusión de contacto.",
  "POST /api/contact/photo": "Setea una foto de perfil manual.",
  "POST /api/contact/category": "Asigna categoría (familia/trabajo/grupo…).",
  "GET /api/contact/info": "Categoría y estado de pin de un contacto.",
  "GET /api/contact/suggestions": "Sugerencias de posibles fusiones (mismo humano en varios canales).",
  "GET /api/directory": "Directorio de todos los contactos conocidos.",
  "GET /api/coach": "Brief del día + secciones proactivas (pendientes, promesas, preguntas, reconectar…).",
  "POST /api/coach/action": "Cierra/pospone un nudge del coach.",
  "GET /api/coach/weekly": "Review semanal generado por IA (actividad de 7 días).",
  "GET /api/ask": "Chat global sobre TODA tu mensajería (RAG semántico + FTS sobre ~2M msgs). Param: q.",
  "GET /api/reply": "Redacta una respuesta a alguien según una instrucción. Body: name, instruction.",
  "GET /api/search": "Búsqueda full-text (FTS5) en todos los mensajes. Body/param: q.",
  "GET /api/meeting-prep": "Prepara una reunión: contexto del contacto + puntos a tratar.",
  "GET /api/llm-usage": "Medidor de uso de LLM: tokens/llamadas nube vs local.",
  "GET /api/push/vapid": "Llave pública VAPID + nº de dispositivos suscritos.",
  "POST /api/push/subscribe": "Registra una suscripción push del navegador.",
  "POST /api/push/unsubscribe": "Elimina una suscripción push.",
  "POST /api/push/test": "Envía una notificación de prueba a los dispositivos suscritos.",
  "GET /api/briefing": "Briefing hablado del día (clima, agenda, pendientes). Params opc: lat, lon, city, tz.",
  "GET /api/daily-plan": "Plan del día generado por IA.",
  "GET /api/config": "Lee la config (voz, ubicación…).", "POST /api/config": "Guarda la config.",
  "GET /api/voices": "Voces TTS disponibles + la actual.",
  "GET /api/tts": "Texto → audio (voz).",
  "GET /api/stt": "Audio → texto (transcripción).",
  "GET /api/home": "Datos del home rediseñado (objetivos, empresas, espacios, resumen).",
  "GET /api/objetivos": "Lista de objetivos.", "POST /api/objetivo": "Crea/edita un objetivo.",
  "POST /api/objetivo/delete": "Borra un objetivo.",
  "GET /api/objetivos/suggest": "Sugiere objetivos con IA a partir de tu actividad.",
  "GET /api/companies": "Lista de empresas.", "POST /api/company": "Crea/edita una empresa.",
  "POST /api/company/delete": "Borra una empresa.",
  "GET /api/espacios": "Lista de espacios (grupos de contactos por reglas).",
  "POST /api/espacio": "Crea/edita un espacio.", "POST /api/espacio/delete": "Borra un espacio.",
  "POST /api/espacio/rule": "Agrega una regla a un espacio (email/dominio/teléfono/nombre).",
  "POST /api/espacio/rule/delete": "Quita una regla de un espacio.",
  "GET /api/espacio/view": "Vista consolidada (rollup) de un espacio y sus hijos.",
  "POST /api/meeting/ingest": "Sube el audio de una reunión grabada → transcripción + notas.",
  "POST /api/meeting/reprocess": "Reprocesa una reunión (re-transcribe/re-resume).",
  "GET /api/meeting": "Detalle de una reunión (transcripción, resumen, acciones).",
  "GET /api/wa-qr": "QR en vivo para vincular WhatsApp.",
  "GET /api/wa-status": "Estado de vinculación de WhatsApp.",
  "GET /api/matrix-link": "Vincula una red vía el bridge Matrix (WA/IG/FB/Telegram/LinkedIn).",
  "GET /api/matrix-status": "Estado del bridge Matrix.",
  "GET /api/matrix-qr": "QR del bridge para vincular.",
  "GET /api/matrix-logins": "Sesiones/logins activos en el bridge.",
  "GET /api/status": "Estado global de integraciones.",
  "POST /api/add-email": "Conecta una cuenta de email (IMAP/Graph).",
  "GET /api/agenda": "Agenda: próximas reuniones (Google/Outlook).",
  "GET /api/email/body": "Cuerpo HTML completo de un email on-demand. Param: id.",
}
const descOf = (e) => DESC[e.method + " " + e.path] || "—"

// ── 2. Módulos + exports ──
function modules() { const f = []; for (const d of ["src", "src/lib"]) for (const x of readdirSync(d)) if (x.endsWith(".mjs")) f.push(join(d, x)); return f.sort() }
function exportsOf(file) {
  const L = read(file).split("\n"); const o = []
  for (let i = 0; i < L.length; i++) { const m = L[i].match(/^export (async function|function|const|class) (\w+)/); if (!m) continue
    let doc = ""; for (let k = i - 1; k >= 0 && /^\s*\/\//.test(L[k]); k--) doc = L[k].replace(/^\s*\/\/\s?/, "") + (doc ? " " + doc : "")
    o.push({ name: m[2], doc: doc.slice(0, 160) }) }
  return o
}
// una línea de "qué hace" por módulo (curada)
const MODDESC = {
  "src/server.mjs": "Servidor HTTP (sin framework): sirve la PWA y expone /api/*. Auth PIN, body caps, estáticos, CAS.",
  "src/daemon.mjs": "Supervisor: levanta y auto-reinicia los readers de cada canal + jobs periódicos (ingest, coach, mantenimiento).",
  "src/coach.mjs": "El coach proactivo: cada 4h lee señales y arma el brief + foco + nudges; empuja el foco al celu 1×/día.",
  "src/lib/brain.mjs": "Capa de consulta: bandeja, hilos unificados, catch-up, ask (RAG), perfiles, merges, envío.",
  "src/lib/db.mjs": "SQLite: esquema (messages/thread_stats/FTS/meta), índices, WAL, busy_timeout.",
  "src/lib/thread.mjs": "Claves de conversación determinísticas (computeThread), phoneOf (LID→número), detección de contenedores.",
  "src/lib/llm.mjs": "Router de LLM (gemini/ollama/claude), multimodal, cola+timeout para ollama, medidor de uso.",
  "src/lib/signals.mjs": "Extrae señales: pendientes, promesas, preguntas sin responder, esperando respuesta, importancia.",
  "src/lib/workspace.mjs": "Estado del usuario: objetivos, empresas, espacios+reglas, pins, categorías, spam, seen.",
  "src/lib/meetings.mjs": "Notetaker: ingesta de audio de reuniones, transcripción híbrida (whisper/Gemini), notas.",
  "src/lib/auth.mjs": "PIN (scrypt+salt), sesiones (token aleatorio), gate local/remoto.",
  "src/lib/push.mjs": "Web Push (VAPID+SW): suscripciones y envío de notificaciones al celular.",
  "src/lib/maintenance.mjs": "Auto-sanado: reconstruye thread_stats si se vacía, corrige fugas de grupo.",
  "src/lib/whisper.mjs": "Transcripción local con whisper.cpp (para audio sensible, sin nube).",
  "src/lib/embed.mjs": "Embeddings para RAG (búsqueda semántica sobre el histórico).",
  "src/lib/briefing.mjs": "Briefing del día (clima+agenda+pendientes) y plan diario; config de voz.",
  "src/lib/voice.mjs": "TTS/STT (texto↔voz).",
  "src/ingest-db.mjs": "Materializa messages.jsonl → tabla SQLite (dedup por id, offset tracking, actualiza thread_stats).",
  "src/matrix.mjs": "Reader del bridge Matrix: sincroniza WhatsApp/IG/FB/Telegram/LinkedIn y hace append al log.",
  "src/mail-imap.mjs": "Reader de email por IMAP (IDLE): asuntos + cuerpo (mailparser), adjuntos.",
  "src/mail-outlook.mjs": "Reader de email Outlook/Microsoft Graph.",
  "src/telegram.mjs": "Reader de Telegram.", "src/teams.mjs": "Reader de Microsoft Teams.",
  "src/notion.mjs": "Reader de Notion (páginas/menciones).",
  "src/google-sync.mjs": "Sincroniza Google Calendar + Drive.",
  "src/calendar-google.mjs": "Cliente de Google Calendar (agenda/reuniones).",
  "src/calendar-outlook.mjs": "Cliente de Outlook Calendar.",
  "src/drive-google.mjs": "Lee contenido de archivos de Drive (Docs→texto o descarga directa).",
  "src/drive-recordings.mjs": "Detecta grabaciones de reuniones en Drive para el notetaker.",
  "src/files-sharepoint.mjs": "Archivos de SharePoint/OneDrive.",
  "src/video-fetch.mjs": "Baja videos de links (yt-dlp+ffmpeg): FB/YT/IG/TikTok, guardados en CAS.",
  "src/graphify.mjs": "Vuelca la mensajería a un grafo de conocimiento (vault Obsidian) con Gemini.",
  "src/rag-index.mjs": "Indexa mensajes para RAG (chunks + embeddings en data/rag.jsonl).",
  "src/email-summarize.mjs": "Resume emails largos on-demand.",
  "src/dedup-media.mjs": "Deduplica adjuntos por contenido (mantenimiento del CAS).",
  "src/holidays.mjs": "Feriados (para el briefing/agenda).",
  "src/lib/cas.mjs": "Content-Addressable Storage: guarda un Buffer una sola vez por hash → ruta pública /cas/…",
  "src/lib/research.mjs": "Enriquecimiento de perfiles (p.ej. LinkedIn vía reader Python con cookie).",
  "src/lib/vault.mjs": "Escritura al vault Obsidian.", "src/lib/store.mjs": "Persistencia de estado en disco (JSON).",
  "src/lib/style.mjs": "Aprende el estilo de escritura del owner para redactar en su voz.",
  "src/lib/mailer.mjs": "Envío de email por SMTP (nodemailer, 587 STARTTLS).",
  "src/import-msgstore-db.mjs": "Importador del backup histórico de WhatsApp (msgstore.db).",
  "src/import-wa-export.mjs": "Importador de exports .txt de WhatsApp.",
}

// ── 3. Patrones ──
const PATTERNS = [
  ["Thread key determinística", "Toda conversación se reduce a una clave estable: WhatsApp 1:1 → por número; grupos → @g.us/!room; email → email:&lt;addr&gt;; self → self. Un mensaje de grupo NUNCA cae en un DM (guard por grp). Es el corazón que unifica 10 canales en una bandeja.", "lib/thread.mjs · computeThread"],
  ["Fire-and-forget para crons", "Los trabajos periódicos nunca bloquean el request ni corren loops pesados en paralelo dentro del server (evita SQLITE_BUSY y caídas). Patrón: encolar/disparar sin await en el hot-path.", "daemon.mjs"],
  ["Cola + timeout para ollama", "ollama en CPU cuelga bajo carga → se serializa (semáforo 1) con timeout de 90s; si tarda, cae a Gemini. Lo interactivo siempre va nube-primero.", "lib/llm.mjs · ollama()"],
  ["Router de LLM (smartChain)", "Elige cadena de proveedores según la tarea: visión/complejo → nube (gemini→openai→anthropic); sensible → local primero (ollama→gemini); simple → según LLM_LOCAL_FIRST (flag para cuando llegue la GPU A6000). Un medidor registra tokens nube vs local.", "lib/llm.mjs · smartChain / usageStats"],
  ["Índice denormalizado auto-sanado", "thread_stats es un índice de hilos (last_ts, count, canales) para que la bandeja sea O(1). Si se vacía por una carrera, se reconstruye solo al arrancar y cada 30 min. Un test lo vigila.", "lib/maintenance.mjs · ensureStats"],
  ["Tail-read de archivos gigantes", "j() lee solo la cola de archivos &gt;200MB. messages.jsonl (&gt;1GB) rompía Node con ERR_STRING_TOO_LONG al leerlo entero.", "lib/brain.mjs · j()"],
  ["RAG en vez de leer todo", "ask() no lee el log crudo: usa búsqueda semántica (embeddings) + FTS5 sobre ~2M mensajes. Rápido y sin reventar memoria.", "lib/brain.mjs · ask()"],
  ["Auth por contexto de red", "Detrás del proxy remoteAddress siempre es 127.0.0.1 → se distingue local (túnel SSH, confiable, sin PIN) de remoto (vía Caddy con X-Forwarded-For, exige PIN). La cookie guarda un token aleatorio, nunca el PIN.", "lib/auth.mjs · server.mjs"],
  ["CAS: almacenamiento dedupeado", "Los archivos se guardan una sola vez por contenido (hash SHA-256); N mensajes que comparten el mismo adjunto referencian la misma copia física.", "server.mjs · /cas"],
  ["Caché que nunca cachea vacío", "listThreads cachea el resultado solo si tiene filas (evita que una lectura vacía transitoria deje la bandeja pegada en 'vacía').", "lib/brain.mjs"],
  ["Backfills seguros", "Nunca loops fire-and-forget paralelos para reprocesar: endpoint que procesa 1 ítem por llamada + loop bash externo. Un backfill mal hecho tiró el server 2h una vez.", "pattern_backfill_safe"],
  ["Multimodal híbrido local/nube", "Catch-up entiende imágenes, audios, docs y video: Gemini para lo general, whisper.cpp local para audio sensible, LibreOffice para Office→PDF. Trivial (texto corto sin media) se resuelve sin LLM.", "lib/brain.catchup · whisper.mjs"],
]

// ── 4. Funcionalidades ──
const FEATURES = [
  ["📥 Bandeja unificada", "Un solo inbox con 10 fuentes (3× WhatsApp, email IMAP+Outlook, Telegram, Teams, Notion, Calendar, Drive). Cada mensaje se normaliza y se agrupa por thread key. Filtros no-exclusivos (Todos/Sin leer/Sin responder/Leídos/✨Sugeridos), pins, archivo y spam."],
  ["🧵 Hilo unificado", "Al abrir un contacto se fusionan TODOS sus canales en un solo timeline cronológico. Detecta el canal correcto para responder y ofrece los targets disponibles."],
  ["⏩ Catch-up multimodal", "Resume lo que te perdiste de un hilo, entendiendo imágenes, audios (transcritos), documentos y video con audio. Lo trivial se resuelve sin gastar LLM."],
  ["✨ Coach proactivo", "Cada 4h analiza señales (pendientes de responder, promesas hechas, preguntas sin contestar, relaciones a reconectar, importancia del contacto) y arma un brief del día + 'Foco de hoy' + nudges accionables. Review semanal on-demand."],
  ["🔔 Notificaciones push", "Web Push nativo del browser (VAPID + Service Worker), sin Firebase. El coach empuja el foco del día al celu 1×/día. En iPhone requiere instalar la PWA."],
  ["💬 Compositor", "Responde desde la conversación: WhatsApp vía el bridge Matrix (sala portal), email vía SMTP. Botón de IA para sugerir respuesta o resumir el chat (se guarda, no se envía solo)."],
  ["🧠 Ask global (RAG)", "Chat sobre TODA tu mensajería histórica (~2M msgs) combinando búsqueda semántica y full-text. Preguntás en lenguaje natural y responde con contexto real."],
  ["🎙️ Notetaker de reuniones", "Se une/graba llamadas del calendario, sube el audio, lo transcribe (whisper local si es sensible / Gemini si no) y genera resumen + acciones."],
  ["🗂️ Espacios y reglas", "Agrupá contactos por reglas (email exacto, dominio *@empresa, teléfono, nombre), anidados, con catch-all. El match es dinámico y retroactivo; da una vista rollup del espacio."],
  ["🎯 Objetivos y empresas", "Modelás tus objetivos y las empresas/personas clave; la IA sugiere objetivos a partir de tu actividad y prioriza el coaching según importancia."],
  ["🗣️ Briefing hablado + voz", "Briefing del día (clima + agenda + pendientes) con TTS, y dictado por voz (STT) para buscar/responder."],
  ["🔗 Vinculación de canales", "Panel para vincular WhatsApp (QR en vivo) y otras redes vía el bridge Matrix, más conexión de cuentas de email (IMAP/Graph)."],
  ["🆔 Identidad unificada", "Fusiona manualmente el mismo humano en varios canales (mail↔teléfono↔nombre) de forma durable, y sugiere posibles fusiones automáticas."],
]

// ── 5. OpenAPI ──
const openapi = { openapi: "3.0.3", info: { title: "pipe.one API", version: "1.0.0", description: "API interna del segundo cerebro / inbox unificado. Todos los endpoints requieren sesión (PIN) salvo desde el túnel local." }, servers: [{ url: "https://hub.example.com" }, { url: "http://localhost:3000" }], tags: GROUPS.map(([g]) => ({ name: g })), paths: {} }
for (const e of endpoints) {
  const p = (openapi.paths[e.path] = openapi.paths[e.path] || {})
  p[e.method.toLowerCase()] = { tags: [groupOf(e.path)], summary: descOf(e), responses: { 200: { description: "OK" }, 401: { description: "No autorizado (falta PIN)" } }, ...(e.method === "POST" ? { requestBody: { content: { "application/json": { schema: { type: "object" } } } } } : {}) }
}
writeFileSync("docs/openapi.json", JSON.stringify(openapi, null, 2))

// ── 6. HTML ──
const diagrams = read("docs/ARCHITECTURE.md").match(/```mermaid[\s\S]*?```/g).map((b) => b.replace(/```mermaid\n?/, "").replace(/```$/, ""))
const erDiagram = `erDiagram
    messages ||--o{ messages_fts : "indexado FTS5"
    messages {
      TEXT id PK
      TEXT channel
      TEXT thread "FK→thread_stats"
      TEXT jid
      TEXT sender
      TEXT name
      TEXT text
      INTEGER ts
      TEXT dir "in/out"
      TEXT grp "grupo o NULL"
      TEXT media
      TEXT body "HTML/cuerpo"
    }
    thread_stats {
      TEXT thread PK
      INTEGER last_ts
      INTEGER count
      INTEGER unread
      TEXT channels
      INTEGER nsenders
    }
    meta { TEXT k PK
      TEXT v }`

const mods = modules()
const apiRows = GROUPS.map(([g]) => {
  const rows = endpoints.filter((e) => groupOf(e.path) === g).sort((a, b) => a.path.localeCompare(b.path))
  if (!rows.length) return ""
  return `<h3>${esc(g)} <span class="cnt">${rows.length}</span></h3>
  <table class="api"><thead><tr><th>Método</th><th>Endpoint</th><th>Qué hace</th></tr></thead><tbody>
  ${rows.map((e) => `<tr><td><span class="m m-${e.method}">${e.method}</span></td><td><code>${esc(e.path)}</code></td><td>${esc(descOf(e))}</td></tr>`).join("")}
  </tbody></table>`
}).join("")

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>pipe — Dossier de arquitectura</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:"neutral",flowchart:{useMaxWidth:true},sequence:{useMaxWidth:true}})</script>
<style>
:root{--ink:#15151f;--accent:#6366f1;--muted:#6b6b78;--line:#e2e2e8;--bg2:#f6f6fa}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ink);margin:0;font-size:12.5px;line-height:1.5}
.page{padding:34px 40px}
h1{font-size:26px;margin:0 0 4px} h2{font-size:19px;color:var(--accent);border-bottom:2px solid var(--line);padding-bottom:5px;margin:26px 0 12px}
h3{font-size:14px;margin:16px 0 7px} h3 .cnt{background:var(--accent);color:#fff;border-radius:9px;padding:1px 7px;font-size:11px;vertical-align:middle}
code{font-family:"SF Mono",Menlo,monospace;font-size:11px;background:var(--bg2);padding:1px 5px;border-radius:5px}
table{border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:11.5px} th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--bg2);font-weight:600} .api td:nth-child(2){white-space:nowrap}
.m{font-weight:700;font-size:10px;padding:2px 6px;border-radius:5px;color:#fff} .m-GET{background:#16a34a} .m-POST{background:#e0662f}
.cover{height:100vh;display:flex;flex-direction:column;justify-content:center;background:linear-gradient(160deg,#0f0f16,#20203a);color:#fff;padding:0 60px}
.cover h1{font-size:46px;color:#fff} .cover .sub{font-size:18px;color:#b9b9d0;margin-top:10px;max-width:640px}
.cover .meta{margin-top:40px;color:#8a8aa8;font-size:13px;line-height:1.9}
.orb{font-size:60px}
.card{border:1px solid var(--line);border-radius:10px;padding:11px 14px;margin:8px 0;background:#fff}
.card b{color:var(--accent)} .card .src{color:var(--muted);font-size:10.5px;font-family:monospace;margin-top:4px}
.mermaid{margin:10px 0;text-align:center;page-break-inside:avoid} .mermaid svg{max-width:100%!important;max-height:660px;height:auto!important;width:auto!important} .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0} .kpi{background:var(--bg2);border-radius:10px;padding:10px 16px;text-align:center;flex:1}
.kpi b{display:block;font-size:22px;color:var(--accent)} .kpi span{font-size:10.5px;color:var(--muted)}
.pb{page-break-before:always} .muted{color:var(--muted)}
ul{margin:6px 0;padding-left:20px} li{margin:3px 0}
@page{margin:0;size:A4} @media print{.page{padding:26px 34px}}
</style></head><body>

<section class="cover">
  <div class="orb">🧠</div>
  <h1>pipe</h1>
  <div class="sub">Segundo cerebro · inbox unificado · AI-OS personal.<br>Dossier técnico completo para revisión de arquitectura.</div>
  <div class="meta">Stack: Node 20 (HTTP nativo, sin framework) · SQLite (~1.96M mensajes, WAL+FTS5) · PWA vanilla-JS<br>
  Infra: servidor headless (VPS) · Caddy (TLS + PIN) · bridge Matrix (mautrix)<br>
  Escala: 10 canales · 71 endpoints · 58 módulos<br>
  Generado: ${new Date().toISOString().slice(0, 10)} · <code>node scripts/gen-dossier.mjs</code></div>
</section>

<div class="page">
<h2>1 · Resumen ejecutivo</h2>
<p><b>pipe</b> unifica toda la mensajería personal (WhatsApp ×3, email, Telegram, Teams, Notion, Calendar, Drive) en una sola bandeja, sobre la que corre una capa de IA que resume, coachea proactivamente y responde. Corre en un único server headless; se expone de forma segura por Caddy (TLS + PIN) y por un túnel SSH local.</p>
<div class="kpis">
  <div class="kpi"><b>~1.96M</b><span>mensajes en SQLite</span></div>
  <div class="kpi"><b>10</b><span>canales unificados</span></div>
  <div class="kpi"><b>71</b><span>endpoints API</span></div>
  <div class="kpi"><b>58</b><span>módulos</span></div>
  <div class="kpi"><b>34</b><span>tests (unit+integ)</span></div>
</div>
<p class="muted">Filosofía de diseño: sin frameworks pesados, todo en Node nativo + SQLite; funciones puras testeables en el core; crons fire-and-forget; nube-primero para lo interactivo con camino local listo para cuando llegue la GPU A6000.</p>

<h2 class="pb">2 · Arquitectura</h2>
<h3>2.1 · Vista de componentes</h3>
<div class="mermaid">${diagrams[0]}</div>
<h3 class="pb">2.2 · Flujo de un mensaje (ingesta → visible)</h3>
<div class="mermaid">${diagrams[1]}</div>
<h3 class="pb">2.3 · Router de LLM (la "tercera vía")</h3>
<div class="mermaid">${diagrams[2]}</div>

<h2 class="pb">3 · Modelo de datos</h2>
<p>SQLite en modo WAL, <code>busy_timeout=10s</code>. El log de eventos <code>messages.jsonl</code> (append-only) es la fuente cruda; <code>ingest-db.mjs</code> lo materializa en la tabla <code>messages</code> con dedup por id. <code>thread_stats</code> es un índice denormalizado auto-sanado para que la bandeja sea instantánea. Búsqueda por <code>messages_fts</code> (FTS5).</p>
<div class="mermaid">${erDiagram}</div>
<h3>Índices</h3>
<ul>
<li><code>idx_thread_ts (thread,ts)</code> · <code>idx_thread_dir_ts (thread,dir,ts)</code> — timeline de un hilo</li>
<li><code>idx_dir_thread (dir,thread)</code> — pendientes de responder</li>
<li><code>idx_grp (grp) WHERE grp NOT NULL</code> — mensajes de grupo</li>
<li><code>idx_ts · idx_name · idx_channel · idx_stats_ts</code></li>
</ul>

<h2 class="pb">4 · Patrones de diseño</h2>
<p class="muted">Los patrones que sostienen la plataforma — varios aprendidos "a los golpes" en incidentes reales.</p>
${PATTERNS.map(([t, d, s]) => `<div class="card"><b>${esc(t)}</b><div>${d}</div><div class="src">${esc(s)}</div></div>`).join("")}

<h2 class="pb">5 · Funcionalidades</h2>
${FEATURES.map(([t, d]) => `<div class="card"><b>${esc(t)}</b><div>${esc(d)}</div></div>`).join("")}

<h2 class="pb">6 · API completa (Swagger / OpenAPI)</h2>
<p class="muted">${endpoints.length} endpoints agrupados por dominio. Todos requieren sesión (PIN) salvo por el túnel local. Spec importable: <code>docs/openapi.json</code> (OpenAPI 3.0.3).</p>
${apiRows}

<h2 class="pb">7 · Seguridad</h2>
<div class="card"><b>Modelo de autenticación</b><div>Local (túnel SSH, conexión directa a 127.0.0.1 sin X-Forwarded-For) = confiable, sin PIN. Remoto (vía Caddy, con XFF) = exige PIN (scrypt+salt). La cookie de sesión guarda un token aleatorio de 256 bits, HttpOnly, SameSite=Lax, Secure bajo HTTPS — nunca el PIN.</div></div>
<div class="card"><b>Superficie y mitigaciones</b><div>App bind a 127.0.0.1 (solo Caddy la alcanza). Body caps (JSON 5MB, raw 300MB). Rate-limit en login. Escape de HTML en el render de la PWA. Secrets en .env chmod 600. Iframe del visor de email en sandbox sin allow-scripts.</div></div>
<div class="card"><b>Pendiente (hardening propuesto)</b><div>Headers de seguridad en Caddy (X-Content-Type-Options, X-Frame-Options, Referrer-Policy) · CSP · rate-limit en endpoints caros de LLM (ask/summarize/catchup) · fail2ban en el borde · backups encriptados offsite con restore probado · npm audit.</div></div>

<h2 class="pb">8 · Testing y documentación</h2>
<p>Un comando corre todo: <code>node scripts/test-all.mjs</code></p>
<ul>
<li><b>Unitarios</b> (<code>test/unit.mjs</code>, node:test): funciones puras — thread keys, phoneOf, computeThread, router smartChain.</li>
<li><b>Integración</b> (<code>test/integration.mjs</code>): contra el server vivo + DB — forma de la API, 0 hilos-fantasma, thread_stats no vacío, perf de la bandeja, push, PWA instalable.</li>
<li><b>Docs auto-generadas</b>: <code>scripts/gen-docs.mjs → docs/REFERENCE.md</code> (nunca se desactualiza, sale del código). <code>docs/ARCHITECTURE.md</code> con los diagramas. Este dossier: <code>scripts/gen-dossier.mjs</code>.</li>
</ul>

<h2 class="pb">9 · Módulos (${mods.length})</h2>
<table><thead><tr><th>Módulo</th><th>Responsabilidad</th></tr></thead><tbody>
${mods.map((f) => `<tr><td><code>${esc(f.replace("src/", ""))}</code></td><td>${esc(MODDESC[f] || (exportsOf(f)[0]?.doc) || "—")}</td></tr>`).join("")}
</tbody></table>

<h2 class="pb">10 · Deuda técnica y roadmap</h2>
<ul>
<li><b>Diferido a la GPU A6000:</b> ollama/whisper/embeddings/multimodal locales; fine-tuning por destilación (dataset de mensajes enviados por el owner) para que el modelo local escriba con su voz.</li>
<li><b>Performance:</b> denormalizar más thread_stats (name/grp/lastText) · virtualizar la bandeja (render solo visible) · indexado incremental de RAG/FTS · rotar messages.jsonl (&gt;1GB).</li>
<li><b>Seguridad:</b> ver §7 pendiente.</li>
<li><b>Router:</b> habilitar Claude para el ~20% complejo cuando haya API key; el 80% simple ya cae en Gemini/local.</li>
</ul>
<p class="muted" style="margin-top:24px">— Fin del dossier · pipe · generado automáticamente desde el código —</p>
</div>
</body></html>`

writeFileSync("docs/dossier.html", html)
console.log(`✅ docs/dossier.html + docs/openapi.json — ${endpoints.length} endpoints · ${mods.length} módulos · ${PATTERNS.length} patrones · ${FEATURES.length} funcionalidades`)
