#!/usr/bin/env node
// Agente NOTETAKER para Android — baja las grabaciones de LLAMADAS nuevas del celu (vía adb) y las sube a pipe,
// que las transcribe (whisper self-hosted si es sensible / Gemini si no) y las resume. iPhone no deja grabar llamadas; Android sí.
//
// Requiere: adb + el teléfono con una app que grabe llamadas (Cube ACR, o el grabador nativo de Xiaomi/Samsung).
// El teléfono puede estar por USB o por WiFi (`adb connect <ip>:5555` tras `adb tcpip 5555`).
// Uso:
//   node pull.mjs list                → muestra qué grabaciones ve en el celu (para confirmar la carpeta)
//   node pull.mjs once                → baja y sube las nuevas una vez
//   node pull.mjs watch               → daemon: cada 60s baja y sube las nuevas
// Config env: HUB_URL, ANDROID_CALL_DIR (carpeta de grabaciones en el celu), ADB (path a adb).
import { execFileSync } from "child_process"
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "fs"
import { join } from "path"
import { homedir, tmpdir } from "os"

const HUB = (process.env.HUB_URL || "http://localhost:3000").replace(/\/$/, "")
const ADB = process.env.ADB || "adb"
// carpetas típicas de grabación de llamada según la app/ROM (se prueban en orden)
const DIRS = (process.env.ANDROID_CALL_DIR || "/sdcard/CubeCallRecorder/All,/sdcard/MIUI/sound_recorder/call_rec,/sdcard/Recordings/Call,/sdcard/Call recordings,/sdcard/Sounds").split(",").map((s) => s.trim())
const STATE = join(homedir(), ".comms-android-notetaker.json")
const AUDIO_RE = /\.(m4a|mp3|amr|ogg|wav|aac|3gp)$/i
const seen = existsSync(STATE) ? new Set(JSON.parse(readFileSync(STATE, "utf8"))) : new Set()
const saveSeen = () => writeFileSync(STATE, JSON.stringify([...seen]))
const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 1 << 26 })

function callDir() {
  for (const d of DIRS) { try { adb("shell", "ls", "-d", d); return d } catch {} }
  return null
}
function listRemote() {
  const dir = callDir()
  if (!dir) { console.log("No encontré carpeta de grabaciones. Configurá ANDROID_CALL_DIR con la ruta correcta."); return { dir: null, files: [] } }
  const out = adb("shell", "ls", "-1", dir).split("\n").map((s) => s.trim()).filter((f) => AUDIO_RE.test(f))
  return { dir, files: out }
}

// nombre → título legible + fecha (los apps nombran "Call_Juan_20260705_1130.m4a" o similar)
function titleFromName(name) {
  const base = name.replace(AUDIO_RE, "").replace(/[_-]+/g, " ")
  const who = base.replace(/\b\d{6,}\b/g, "").replace(/\b(call|rec|llamada|grabacion|grabación)\b/gi, "").replace(/\s+/g, " ").trim()
  return `Llamada${who ? " con " + who : ""}`
}

async function uploadOne(localPath, name) {
  const buf = readFileSync(localPath)
  if (buf.length < 2000) return console.log(`  · ${name}: vacío, salto`)
  const ext = (name.match(AUDIO_RE)?.[1] || "m4a").toLowerCase()
  const mime = { m4a: "audio/mp4", mp3: "audio/mpeg", amr: "audio/amr", ogg: "audio/ogg", wav: "audio/wav", aac: "audio/aac", "3gp": "audio/3gpp" }[ext] || "audio/mp4"
  const qs = new URLSearchParams({ title: titleFromName(name), source: "android", ts: String(Date.now()), ext })
  const r = await fetch(`${HUB}/api/meeting/ingest?${qs}`, { method: "POST", headers: { "Content-Type": mime }, body: buf }).then((x) => x.json()).catch((e) => ({ error: e.message }))
  console.log(r.error ? `  · ${name}: ❌ ${r.error}` : `  · ${name}: ✅ ${r.id} (${r.engine}${r.sensitive ? ", privado" : ""})`)
  return !r.error
}

async function once() {
  const { dir, files } = listRemote()
  if (!dir) return
  const fresh = files.filter((f) => !seen.has(f))
  if (!fresh.length) { console.log("Sin grabaciones nuevas."); return }
  console.log(`${fresh.length} grabación(es) nueva(s):`)
  const tmp = mkdtempSync(join(tmpdir(), "android-calls-"))
  for (const f of fresh) {
    try {
      const local = join(tmp, f.replace(/[^\w.\-]/g, "_"))
      adb("pull", `${dir}/${f}`, local)
      if (await uploadOne(local, f)) { seen.add(f); saveSeen() }
    } catch (e) { console.log(`  · ${f}: error adb ${e.message}`) }
  }
}

const cmd = process.argv[2]
if (cmd === "list") { const { dir, files } = listRemote(); console.log("carpeta:", dir); files.forEach((f) => console.log("  ", f, seen.has(f) ? "(ya subida)" : "")) }
else if (cmd === "once") await once()
else if (cmd === "watch") { console.log("👀 watch Android: bajo grabaciones de llamada cada 60s. Ctrl-C para salir."); await once(); setInterval(once, 60000) }
else console.log("Uso: node pull.mjs list | once | watch")
