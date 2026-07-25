// Daemon supervisor — el corazón vivo de comms-hub. Mantiene los 10 lectores corriendo (los reinicia si mueren)
// + corre graphify cada N min sobre eventos nuevos + refresca feriados 1×/día. Un solo comando levanta todo el cerebro.
// Uso: node src/daemon.mjs   ·   logs por servicio en data/logs/*.log   ·   estado en data/daemon.log
import { spawn } from "child_process"
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, statSync, renameSync, readdirSync } from "fs"
import { loadEnv } from "./lib/env.mjs"

// cargar .env
loadEnv()
mkdirSync("data/logs", { recursive: true })

const NODE = process.execPath // el mismo node20 con que se arranca el daemon
const PY = process.env.LINKEDIN_PY || "/tmp/li-env/bin/python"
const GRAPHIFY_MIN = parseInt(process.env.GRAPHIFY_INTERVAL_MIN || "15")
const READERS = [
  // WhatsApp: TODO consolidado en el bridge Matrix (server, always-on). Los números propios (ver hub-config) viven ahí. Baileys retirado.
  ["telegram", NODE, ["src/telegram.mjs"]],
  ["teams", NODE, ["src/teams.mjs"]],
  ["mail-outlook", NODE, ["src/mail-outlook.mjs"]],
  ["calendar-outlook", NODE, ["src/calendar-outlook.mjs"]],
  ["mail-imap", NODE, ["src/mail-imap.mjs"]],
  ["google", NODE, ["src/google-sync.mjs"]], // Calendar + Drive multi-cuenta (reemplaza calendar-google + drive-google)
  ["files-sharepoint", NODE, ["src/files-sharepoint.mjs"]],
  ["notion", NODE, ["src/notion.mjs"]],
  ["matrix", NODE, ["src/matrix.mjs"]], // lector de bridges Matrix (WhatsApp/Instagram/... del server) → messages.jsonl
  ["web", NODE, ["src/server.mjs"]], // servidor web + API (localhost:3000)
  // LinkedIn: mensajería no-oficial rota (redirect) → fuera del loop. Perfiles se usan on-demand vía research.mjs.
  // ["linkedin", PY, ["src/linkedin_reader.py"]],
]

function log(m) { const line = `[${new Date().toISOString().slice(0, 19)}] ${m}`; console.log(line); try { appendFileSync("data/daemon.log", line + "\n") } catch {} }

// spawn a un job, logueando a data/logs/<name>.log y CERRANDO el fd al salir el hijo.
// (antes cada job hacía openSync sin closeSync → fuga de fds; con ingest cada 15s el daemon llegaba a EMFILE en ~1h y moría.)
function spawnLogged(name, exec, args, env = process.env) {
  const fd = openSync(`data/logs/${name}.log`, "a")
  const p = spawn(exec, args, { env: { ...env, LLM_TASK: env.LLM_TASK || name }, stdio: ["ignore", fd, fd] }) // LLM_TASK → atribuye el gasto de nube a este cron (visibilidad de costo)
  p.on("exit", () => { try { closeSync(fd) } catch {} }) // primer listener: liberar el fd pase lo que pase
  return p
}

// un throw suelto en un callback de setInterval NO debe tumbar el daemon entero (que nadie reinicia).
process.on("uncaughtException", (e) => log(`💥 uncaughtException: ${e?.stack || e}`))
process.on("unhandledRejection", (e) => log(`💥 unhandledRejection: ${e?.stack || e}`))

// ROTACIÓN DE LOGS: los logs crecían sin límite → llenaban el disco en semanas. Al superar el tope, rotamos a .1
// (el hijo que tenga el fd sigue escribiendo en .1 hasta reiniciar; el próximo spawn abre el log fresco). Cada log ≤ 2×tope.
const LOG_MAX = +process.env.LOG_MAX_BYTES || 20 * 1024 * 1024
function rotateLogs() {
  const files = ["data/daemon.log", ...(existsSync("data/logs") ? readdirSync("data/logs").filter((f) => f.endsWith(".log")).map((f) => `data/logs/${f}`) : [])]
  for (const f of files) { try { if (existsSync(f) && statSync(f).size > LOG_MAX) renameSync(f, f + ".1") } catch {} }
}

// --- lectores con auto-restart y backoff ---
const backoff = {}
let shuttingDown = false
const children = new Set()
function startReader(name, exec, args) {
  const p = spawnLogged(name, exec, args)
  children.add(p)
  log(`▶️  ${name} (pid ${p.pid})`)
  p.on("exit", (code) => {
    children.delete(p)
    if (shuttingDown) return // no reiniciar durante apagado
    const wait = Math.min((backoff[name] = (backoff[name] || 2) * 1.5), 60)
    log(`⚠️  ${name} salió (code ${code}) — reinicio en ${Math.round(wait)}s`)
    setTimeout(() => startReader(name, exec, args), wait * 1000)
  })
  p.on("spawn", () => { setTimeout(() => { backoff[name] = 2 }, 30000) }) // si sobrevive 30s, resetea backoff
  return p
}

// --- graphify periódico (sin solaparse) ---
let graphifyRunning = false
function runGraphify() {
  if (graphifyRunning) { log("⏭️  graphify aún corriendo, salto este ciclo"); return }
  graphifyRunning = true
  // HÍBRIDO: graphify procesa tus mensajes → LLM local primero (privado), Gemini de respaldo si el local falla
  const p = spawnLogged("graphify", NODE, ["src/graphify.mjs"], { ...process.env, GEMINI_MODEL: "gemini-2.5-flash-lite", LLM_CHAIN: process.env.LLM_CHAIN_SENSITIVE || "ollama,gemini" })
  p.on("exit", (code) => { graphifyRunning = false; log(`🧠 graphify ciclo terminado (code ${code})`); runVaultSync() })
}

// --- descarga de videos de links (FB/IG/TikTok/YT) → CAS → linkea al mensaje (throttled) ---
let videoRunning = false
function runVideoFetch() {
  if (videoRunning) return
  videoRunning = true
  const p = spawnLogged("video", NODE, ["src/video-fetch.mjs"])
  p.on("exit", () => { videoRunning = false })
}

let heartbeatRunning = false
function runHeartbeat() {
  if (heartbeatRunning) return
  heartbeatRunning = true
  const p = spawnLogged("heartbeat", NODE, ["src/heartbeat.mjs"])
  p.on("exit", () => { heartbeatRunning = false })
}

let rsvpRunning = false
function runRsvp() {
  if (rsvpRunning) return
  rsvpRunning = true
  const p = spawnLogged("rsvp", NODE, ["src/rsvp-reminder.mjs"])
  p.on("exit", () => { rsvpRunning = false })
}

let msgPushRunning = false
function runMsgPush() {
  if (msgPushRunning) return
  msgPushRunning = true
  const p = spawnLogged("msg-push", NODE, ["src/msg-push.mjs"])
  p.on("exit", () => { msgPushRunning = false })
}

let socialDailyRunning = false
function runSocialDaily() { // pre-genera posts de LinkedIn + push de novedades (se auto-gatea 1×/día en la mañana)
  if (socialDailyRunning) return
  socialDailyRunning = true
  const p = spawnLogged("social-daily", NODE, ["src/social-daily.mjs"])
  p.on("exit", () => { socialDailyRunning = false })
}

// --- sync del bridge: fotos de perfil + nombres de grupo + unificación (desde la DB de mautrix) ---
let bridgeSyncRunning = false
function runBridgeSync() {
  if (bridgeSyncRunning) return
  bridgeSyncRunning = true
  const p = spawnLogged("bridge-sync", NODE, ["src/matrix.mjs", "bridge-avatars"])
  p.on("exit", () => { const p2 = spawnLogged("bridge-sync", NODE, ["src/matrix.mjs", "bridge-portals"]); p2.on("exit", () => { bridgeSyncRunning = false }) })
}

// --- CALENDAR PREP: pre-genera tarjetas de eventos (categoría, asistentes, objetivo, prep IA) → calendario/reunión instantáneos ---
let calPrepRunning = false
function runCalendarPrep() { if (calPrepRunning) return; calPrepRunning = true; const p = spawnLogged("calendar-prep", NODE, ["src/calendar-prep.mjs"]); p.on("exit", () => { calPrepRunning = false }) }
// --- PERSON CARDS: pre-genera tarjetas de personas (bio, stats, canales, grafo) → vista de persona instantánea ---
let personCardsRunning = false
function runPersonCards() { if (personCardsRunning) return; personCardsRunning = true; const p = spawnLogged("person-cards", NODE, ["src/person-cards.mjs"]); p.on("exit", () => { personCardsRunning = false }) }

// --- ESPACIO CARDS: pre-genera el rollup de espacios (evita el scan de 5s en cada carga de bandeja/IA) ---
let espacioCardsRunning = false
function runEspacioCards() { if (espacioCardsRunning) return; espacioCardsRunning = true; const p = spawnLogged("espacio-cards", NODE, ["src/espacio-cards.mjs"]); p.on("exit", () => { espacioCardsRunning = false }) }

// --- HOME BRIEF: genera el snapshot de la home (prosa+audio+KPIs+agenda+noticias+coach) cada 6h ---
let homeBriefRunning = false
function runHomeBrief() {
  if (homeBriefRunning) return
  homeBriefRunning = true
  const p = spawnLogged("home-brief", NODE, ["src/home-brief.mjs"])
  p.on("exit", () => { homeBriefRunning = false })
}

// --- AUDIO SUMMARY: transcribe + resume (no literal) las notas de voz recibidas nuevas → resumen bajo el player ---
let audioSummaryRunning = false
function runAudioSummary() { if (audioSummaryRunning) return; audioSummaryRunning = true; const p = spawnLogged("audio-summary", NODE, ["src/audio-summarize.mjs"]); p.on("exit", () => { audioSummaryRunning = false }) }

// --- EXTRACT ACTIONS: to-dos (lo que te pidieron) + promesas (lo que prometiste) de las conversaciones activas → Home ---
let extractRunning = false
function runExtract() { if (extractRunning) return; extractRunning = true; const p = spawnLogged("extract-actions", NODE, ["src/extract-actions.mjs"]); p.on("exit", () => { extractRunning = false }) }

// --- NOTES AI: digest de tus notas propias (resumen + ideas + reflexión) para el compañero de IA de Notas ---
let notesAiRunning = false
function runNotesAi() { if (notesAiRunning) return; notesAiRunning = true; const p = spawnLogged("notes-ai", NODE, ["src/notes-ai.mjs"]); p.on("exit", () => { notesAiRunning = false }) }

// --- CLIPS: clasifica cada nota-a-vos-mismo (link/idea/pendiente/media), saca título del link y "para qué sirve" ---
let clipsRunning = false
function runClips() { if (clipsRunning) return; clipsRunning = true; const p = spawnLogged("clips", NODE, ["src/clips.mjs"]); p.on("exit", () => { clipsRunning = false }) }

// SOLO la fusión de salas portal → @g.us (dedup de grupos duplicados en la bandeja). Barato (sin subir avatares) → corre seguido.
let bridgePortalsRunning = false
function runBridgePortals() {
  if (bridgePortalsRunning || bridgeSyncRunning) return
  bridgePortalsRunning = true
  const p = spawnLogged("bridge-portals", NODE, ["src/matrix.mjs", "bridge-portals"])
  p.on("exit", () => { bridgePortalsRunning = false })
}

// --- ingester de grabaciones desde Google Drive (Meet, Cube ACR, etc.) → notetaker ---
let driveRecRunning = false
function runDriveRecordings() {
  if (driveRecRunning) return
  driveRecRunning = true
  const p = spawnLogged("drive-rec", NODE, ["src/drive-recordings.mjs"])
  p.on("exit", () => { driveRecRunning = false })
}

// --- resumen IA de emails nuevos (tweet pitch) ---
let emailSumRunning = false
function runEmailSum() {
  if (emailSumRunning) return
  emailSumRunning = true
  const p = spawnLogged("email-sum", NODE, ["src/email-summarize.mjs"], { ...process.env, LLM_CHAIN: process.env.LLM_CHAIN_SENSITIVE || "ollama,gemini" })
  p.on("exit", () => { emailSumRunning = false })
}

// --- ingesta JSONL → SQLite (mensajes nuevos del bridge/lectores a la DB consultable) ---
let ingestRunning = false
function runIngest() {
  if (ingestRunning) return
  ingestRunning = true
  const p = spawnLogged("ingest", NODE, ["src/ingest-db.mjs"])
  p.on("exit", () => { ingestRunning = false })
}

// --- clasificador de spam LLM (capa 2): clasifica hilos dudosos en lote, cachea el veredicto ---
let spamRunning = false
function runSpamClassify() {
  if (spamRunning) return
  spamRunning = true
  const p = spawnLogged("spam-classify", NODE, ["src/spam-classify.mjs"])
  p.on("exit", () => { spamRunning = false })
}

// --- resolver identidades (número→nombre histórico+bridge, reglas manuales) cada 20 min ---
let resolveRunning = false
function runResolve() {
  if (resolveRunning) return
  resolveRunning = true
  const p = spawnLogged("resolve", NODE, ["src/resolve-identities.mjs"])
  p.on("exit", () => { resolveRunning = false })
}

// --- índice RAG semántico (embeddings de mensajes + vault, incremental) ---
let ragRunning = false
function runRagIndex() {
  if (ragRunning) return
  ragRunning = true
  const p = spawnLogged("rag-index", NODE, ["src/rag-index.mjs"])
  p.on("exit", () => { ragRunning = false })
}

// --- sync del vault al server (después de cada graphify + periódico) ---
function runVaultSync() {
  spawnLogged("vault-sync", NODE, ["src/vault-sync.mjs"])
}

// --- aprendizaje: el LLM refina el modelo de Alvaro (self-model) cada 6h ---
let learnRunning = false
function runLearn() {
  if (learnRunning) return
  learnRunning = true
  // HÍBRIDO: el self-model se hace sobre tus mensajes → LLM local primero (privado), Gemini de respaldo
  const p = spawnLogged("learn", NODE, ["src/learn.mjs"], { ...process.env, LLM_CHAIN: process.env.LLM_CHAIN_SENSITIVE || "ollama,gemini" })
  p.on("exit", (code) => { learnRunning = false; log(`🧠 learn ciclo terminado (code ${code})`); runVaultSync() })
}

// --- coach proactivo (cada 4h) ---
let coachRunning = false
function runCoach() {
  if (coachRunning) return
  coachRunning = true
  const p = spawnLogged("coach", NODE, ["src/coach.mjs"])
  p.on("exit", (code) => { coachRunning = false; log(`🎯 coach ciclo terminado (code ${code})`) })
}

// --- feriados 1×/día ---
let lastHolidays = ""
function maybeHolidays() {
  const today = new Date().toISOString().slice(0, 10)
  if (lastHolidays === today) return
  lastHolidays = today
  spawnLogged("holidays", NODE, ["src/holidays.mjs"])
  log("🎌 feriados refrescados")
}

// --- arranque ---
log(`🧠 comms-hub daemon ARRIBA — ${READERS.length} lectores · graphify cada ${GRAPHIFY_MIN} min`)
for (const [name, exec, args] of READERS) startReader(name, exec, args)
maybeHolidays()
setTimeout(runGraphify, 20000) // primer graphify a los 20s
setInterval(runGraphify, GRAPHIFY_MIN * 60000)
setTimeout(runCoach, 90000) // primer coach a los 90s (después del primer graphify)
setInterval(runCoach, 4 * 3600000) // cada 4h
setTimeout(runVaultSync, 30000) // sync inicial del vault al server
setInterval(runVaultSync, 20 * 60000) // sync vault cada 20 min (respaldo del post-graphify)
setTimeout(runIngest, 15000) // primera ingesta a la DB a los 15s
setInterval(runIngest, 15000) // ingesta JSONL→DB cada 15s (mensajes nuevos consultables casi al toque)
setTimeout(runVideoFetch, 180000) // primera descarga de videos a los 3 min
setInterval(runVideoFetch, 4 * 60000) // baja videos de links nuevos cada 4 min (pocos por corrida, throttled)
setTimeout(runBridgeSync, 8 * 60000) // sync del bridge (fotos+nombres) a los 8 min
setInterval(runBridgeSync, 6 * 3600000) // fotos de perfil + nombres de grupo cada 6h (mautrix DB)
setTimeout(runBridgePortals, 90000) // primera fusión de grupos duplicados a los 90s
setInterval(runBridgePortals, 20 * 60000) // fusiona salas portal → @g.us (dedup grupos) cada 20 min — barato
setTimeout(runHomeBrief, 150000) // primer brief de la home a los ~2.5 min (tras graphify/coach)
setInterval(runHomeBrief, 6 * 3600000) // regenera la home (prosa+audio+KPIs+noticias) cada 6h = 4×/día
setTimeout(runCalendarPrep, 100000) // primeras tarjetas de evento a los ~1.5 min
setInterval(runCalendarPrep, 2 * 3600000) // pre-genera tarjetas de eventos cada 2h (calendario sincroniza en vivo)
setTimeout(runPersonCards, 220000) // primeras tarjetas de persona a los ~3.5 min (tras graphify/learn)
setInterval(runPersonCards, 6 * 3600000) // pre-genera/actualiza tarjetas de persona cada 6h (evolucionan)
setTimeout(runEspacioCards, 40000) // primer rollup de espacios a los 40s
setInterval(runEspacioCards, 4 * 60000) // pre-genera rollup de espacios cada 4 min (llegan emails nuevos)
setTimeout(runDriveRecordings, 200000) // primer scan de grabaciones en Drive a los ~3min
setInterval(runDriveRecordings, 5 * 60000) // baja grabaciones nuevas (Meet/Cube ACR) cada 5 min
setTimeout(runEmailSum, 75000) // primer resumen IA de emails a los 75s
setInterval(runEmailSum, 3 * 60000) // resume emails nuevos cada 3 min
setTimeout(runAudioSummary, 100000) // primer resumen de notas de voz a los ~1.5 min
setInterval(runAudioSummary, 2 * 60000) // transcribe+resume notas de voz recibidas nuevas cada 2 min (batch chico)
setTimeout(runExtract, 130000) // primera extracción de tareas/promesas a los ~2 min
setInterval(runExtract, 10 * 60000) // extrae to-dos + promesas de conversaciones activas cada 10 min
setTimeout(runNotesAi, 160000) // primer digest de notas a los ~2.5 min
setInterval(runNotesAi, 3 * 3600000) // digest de tus notas (resumen+ideas+reflexión) cada 3h
setTimeout(runClips, 115000) // primer enriquecimiento de clips a los ~2 min
setInterval(runClips, 4 * 60000) // clasifica + "para qué sirve" los clips nuevos cada 4 min (batch chico)
setTimeout(runResolve, 120000) // primer resolve de identidades a los 2 min
setInterval(runResolve, 20 * 60000) // resuelve número→nombre + reglas manuales cada 20 min
setTimeout(runSpamClassify, 4 * 60000) // primera clasificación de spam a los 4 min
setInterval(runSpamClassify, 12 * 60000) // clasifica hilos dudosos (capa 2 LLM) cada 12 min, en lote y cacheado
setTimeout(runRagIndex, 60000) // primer índice RAG al minuto
setInterval(runRagIndex, 10 * 60000) // indexa mensajes/vault nuevos cada 10 min
setTimeout(runLearn, 150000) // primer aprendizaje a los ~2.5 min (después de graphify)
setInterval(runLearn, 6 * 3600000) // el LLM refina el self-model del dueño cada 6h
setTimeout(runHeartbeat, 5 * 60000) // primer chequeo de salud de canales a los 5 min
setInterval(runHeartbeat, 3600000) // heartbeat por canal cada 1h: avisa si un canal dejó de recibir (fallo silencioso)
setTimeout(runRsvp, 6 * 60000) // primer chequeo de RSVP a los 6 min
setInterval(runRsvp, 30 * 60000) // recordatorios de reunión (confirmación pendiente + "empieza pronto") cada 30 min
setTimeout(runMsgPush, 90000) // primer push de mensajes a los 90s
setInterval(runMsgPush, 2 * 60000) // push de mensajes nuevos (DMs) cada 2 min
setTimeout(runSocialDaily, 4 * 60000) // primer chequeo del resumen diario de redes
setInterval(runSocialDaily, 2 * 3600000) // cada 2h chequea (se auto-gatea a 1×/día en la mañana)
setInterval(maybeHolidays, 3600000)
rotateLogs(); setInterval(rotateLogs, 3600000) // rotar logs al arranque y cada hora (evita llenar el disco)
setInterval(() => log(`💓 vivo · graphify ${graphifyRunning ? "corriendo" : "idle"}`), 600000) // heartbeat cada 10 min

function shutdown() {
  shuttingDown = true
  log(`🛑 daemon deteniéndose — matando ${children.size} hijos`)
  for (const c of children) { try { c.kill("SIGTERM") } catch {} }
  setTimeout(() => process.exit(0), 1500)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
