#!/usr/bin/env node
// Agente NOTETAKER para Mac — graba mic + audio del sistema durante tus calls y sube la grabación a pipe,
// que la transcribe (whisper self-hosted si es sensible / Gemini si no) y la resume con puntos de acción.
//
// La captura de audio del sistema en macOS necesita un "Dispositivo Agregado" (mic + BlackHole). Ver setup.sh.
// Uso:
//   node notetaker.mjs devices                 → lista los dispositivos de audio (para elegir el agregado)
//   node notetaker.mjs start ["Título"]        → empieza a grabar (título opcional; si no, lo saca del calendar)
//   node notetaker.mjs stop                     → corta y sube la grabación
//   node notetaker.mjs watch                    → daemon: auto-graba durante los eventos de calendar con link de reunión
//   node notetaker.mjs upload <archivo> [tit]   → sube una grabación ya hecha
//
// Config por env: HUB_URL (default http://localhost:3000 vía túnel SSH), AUDIO_DEVICE (índice avfoundation del agregado).
import { spawn, execFileSync } from "child_process"
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from "fs"
import { homedir, tmpdir } from "os"
import { join } from "path"

const HUB = (process.env.HUB_URL || "http://localhost:3000").replace(/\/$/, "")
const STATE = join(homedir(), ".comms-notetaker.json")
const CFG = join(homedir(), ".comms-notetaker.cfg.json")
const cfg = existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : {}
const AUDIO_DEVICE = process.env.AUDIO_DEVICE || cfg.device || "0"
const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null)
const writeState = (s) => writeFileSync(STATE, JSON.stringify(s))

function listDevices() {
  try { execFileSync("ffmpeg", ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], { stdio: ["ignore", "ignore", "inherit"] }) }
  catch { /* ffmpeg imprime la lista en stderr y sale con error — normal */ }
}

// título/sensibilidad desde el evento de calendar más cercano (via la API del hub)
async function meetingContext() {
  try {
    const r = await fetch(`${HUB}/api/agenda`).then((x) => x.json())
    const now = Date.now()
    const ev = (r.meetings || []).map((m) => ({ ...m, s: new Date(m.start).getTime(), e: m.end ? new Date(m.end).getTime() : 0 }))
      .filter((m) => m.s && Math.abs(m.s - now) < 45 * 60000 || (m.s <= now && (m.e || m.s + 3600000) >= now))
      .sort((a, b) => Math.abs(a.s - now) - Math.abs(b.s - now))[0]
    return ev ? { title: ev.title, attendees: ev.attendees || [] } : {}
  } catch { return {} }
}

function startRecording(title) {
  if (readState()) { console.log("Ya hay una grabación en curso. Usá `stop` primero."); return }
  const file = join(tmpdir(), `meeting-${Date.now()}.m4a`)
  // avfoundation: ":<idx>" = solo audio del dispositivo <idx> (el agregado mic+BlackHole)
  const p = spawn("ffmpeg", ["-nostdin", "-f", "avfoundation", "-i", `:${AUDIO_DEVICE}`, "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k", "-y", file], { detached: true, stdio: "ignore" })
  p.unref()
  writeState({ pid: p.pid, file, title: title || "", startedAt: Date.now() })
  console.log(`🎙  Grabando (pid ${p.pid}) → ${file}\nAl terminar la call: node notetaker.mjs stop`)
}

async function stopRecording() {
  const s = readState()
  if (!s) { console.log("No hay ninguna grabación en curso."); return }
  try { process.kill(s.pid, "SIGINT") } catch {} // SIGINT deja a ffmpeg cerrar el archivo limpio
  await new Promise((r) => setTimeout(r, 1500))
  unlinkSync(STATE)
  if (!existsSync(s.file) || statSync(s.file).size < 2000) { console.log("⚠️  La grabación salió vacía. Revisá el dispositivo de audio (node notetaker.mjs devices)."); return }
  const durationSec = Math.round((Date.now() - s.startedAt) / 1000)
  await uploadFile(s.file, s.title, durationSec)
  try { unlinkSync(s.file) } catch {}
}

async function uploadFile(file, title, durationSec = 0) {
  const ctx = await meetingContext()
  const finalTitle = title || ctx.title || ""
  const buf = readFileSync(file)
  const qs = new URLSearchParams({ title: finalTitle, source: "mac", ts: String(Date.now()), duration: String(durationSec) })
  if (ctx.attendees?.length) qs.set("attendees", ctx.attendees.join(","))
  console.log(`⬆️  Subiendo ${(buf.length / 1024 / 1024).toFixed(1)}MB — "${finalTitle || "(sin título)"}"…`)
  const r = await fetch(`${HUB}/api/meeting/ingest?${qs}`, { method: "POST", headers: { "Content-Type": "audio/mp4" }, body: buf }).then((x) => x.json())
  console.log(r.error ? `❌ ${r.error}` : `✅ Reunión ${r.id} — transcribiendo con ${r.engine}${r.sensitive ? " (privado/sensible)" : ""}. Aparecerá en tu inbox.`)
}

// daemon: mira el calendar y graba solo durante los eventos que tienen link de reunión
async function watch() {
  console.log("👀 watch: auto-grabo durante eventos de calendar con link de reunión. Ctrl-C para salir.")
  let recordingFor = null
  setInterval(async () => {
    try {
      const r = await fetch(`${HUB}/api/agenda`).then((x) => x.json())
      const now = Date.now()
      const live = (r.meetings || []).map((m) => ({ ...m, s: new Date(m.start).getTime(), e: m.end ? new Date(m.end).getTime() : new Date(m.start).getTime() + 3600000 }))
        .find((m) => m.meetingUrl && m.s - 60000 <= now && m.e + 120000 >= now) // dentro del evento (con margen)
      if (live && !readState()) { console.log(`▶️  Evento en curso: ${live.title}`); recordingFor = live.title; startRecording(live.title) }
      else if (!live && readState()) { console.log("⏹  Evento terminó — subiendo."); await stopRecording(); recordingFor = null }
    } catch (e) { /* hub caído / sin túnel → reintentar */ }
  }, 30000)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === "devices") listDevices()
else if (cmd === "start") startRecording(rest.join(" "))
else if (cmd === "stop") await stopRecording()
else if (cmd === "watch") await watch()
else if (cmd === "upload" && rest[0]) await uploadFile(rest[0], rest.slice(1).join(" "))
else console.log("Uso: node notetaker.mjs devices | start [\"Título\"] | stop | watch | upload <archivo> [título]")
