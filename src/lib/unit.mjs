// Tests UNITARIOS de funciones PURAS (sin server ni DB). Runner nativo:  node --test test/unit.mjs
import "./_setup.mjs" // PRIMERO: fija HUB_CONFIG (identidad ficticia) antes de cargar thread.mjs/hub.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { isContainerJid, isGroupJid, phoneOf, MY_NUMBERS, MY_EMAILS, computeThread, nameExtends } from "../src/lib/thread.mjs"
import { smartChain, usageStats } from "../src/lib/llm.mjs"
import { tailJsonl, streamJsonl } from "../src/lib/jsonl.mjs"
import { fence, harden, UNTRUSTED_NOTE } from "../src/lib/safety.mjs"
import { detectSchedule, detectScheduleLLM } from "../src/lib/intents.mjs"
import { mimeFor } from "../src/audio-summarize.mjs"
import { audioExt } from "../src/lib/voice.mjs"
import { writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ── thread.mjs: claves de conversación (el corazón de todo) ──
test("isContainerJid: grupos/salas/newsletters/broadcast son contenedores", () => {
  assert.ok(isContainerJid("120363@g.us"))
  assert.ok(isContainerJid("!room:commshub.local"))
  assert.ok(isContainerJid("abc@newsletter"))
  assert.ok(isContainerJid("status@broadcast"))
  assert.ok(!isContainerJid("15551230001@s.whatsapp.net"), "un DM NO es contenedor")
  assert.ok(!isContainerJid("someone@example.com"), "un email NO es contenedor")
})

test("isGroupJid = isContainerJid", () => {
  assert.equal(isGroupJid("120363@g.us"), isContainerJid("120363@g.us"))
})

test("phoneOf: extrae el número real de cualquier identificador", () => {
  assert.equal(phoneOf("15551230001@s.whatsapp.net"), "15551230001")
  assert.equal(phoneOf("@whatsapp_15551230001:commshub.local"), "15551230001")
  assert.equal(phoneOf("+1 555 123 0001"), "15551230001")
  assert.equal(phoneOf(""), null)
  assert.equal(phoneOf("123"), null, "muy corto → no es teléfono")
})

test("MY_NUMBERS / MY_EMAILS: identidad del hub (viene de la config)", () => {
  for (const n of ["15551230001", "15551230002", "15551230003"]) assert.ok(MY_NUMBERS.has(n), n) // ver test/_setup.mjs
  assert.ok(MY_EMAILS.has("me@example.com"))
  assert.ok(!MY_NUMBERS.has("15559999999"), "un número ajeno NO es mío")
})

test("computeThread: un GRUPO nunca va a un DM (grp seteado)", () => {
  const grupo = computeThread({ channel: "whatsapp", jid: "!room:commshub.local", dm: "51999@s.whatsapp.net", grp: "FedEx CTM", text: "hola" })
  assert.ok(!/^whatsapp:519/.test(grupo) || /@g\.us|!room/.test(grupo), "con grp NO debe keyear al número del DM")
})

test("computeThread: status broadcast → spam", () => {
  assert.equal(computeThread({ jid: "status@broadcast", channel: "whatsapp" }), "spam:status")
})

test("computeThread: email → por la dirección", () => {
  const k = computeThread({ channel: "email", jid: "juan@empresa.com", text: "hola" })
  assert.equal(k, "email:juan@empresa.com")
})

// ── llm.mjs: router y medidor ──
test("smartChain: complejo/visión → nube (sin ollama que no lo hace bien)", () => {
  assert.ok(smartChain({ complex: true }).startsWith("gemini"))
  assert.ok(smartChain({ vision: true }).startsWith("gemini"))
})

test("smartChain: sensible → FAIL-CLOSED (nunca nube por defecto)", () => {
  const prev = process.env.SENSITIVE_ALLOW_CLOUD
  delete process.env.SENSITIVE_ALLOW_CLOUD
  assert.equal(smartChain({ sensitive: true }), "ollama", "sensible NO debe incluir gemini/nube")
  process.env.SENSITIVE_ALLOW_CLOUD = "1" // escape explícito y consciente
  assert.ok(smartChain({ sensitive: true }).includes("gemini"), "con el escape sí permite nube")
  if (prev === undefined) delete process.env.SENSITIVE_ALLOW_CLOUD; else process.env.SENSITIVE_ALLOW_CLOUD = prev
})

test("smartChain: simple → depende de LLM_LOCAL_FIRST", () => {
  const prev = process.env.LLM_LOCAL_FIRST
  process.env.LLM_LOCAL_FIRST = "0"
  assert.ok(smartChain({}).startsWith("gemini"), "sin GPU → nube primero")
  process.env.LLM_LOCAL_FIRST = "1"
  assert.ok(smartChain({}).startsWith("ollama"), "con GPU → local primero")
  process.env.LLM_LOCAL_FIRST = prev || ""
})

test("usageStats: forma del medidor", () => {
  const u = usageStats()
  for (const k of ["cloudTok", "localTok", "cloudCalls", "localCalls", "by"]) assert.ok(k in u, "falta " + k)
})

// ── safety.mjs: guardarraíl anti prompt-injection ──
test("harden: agrega la nota de seguridad al system prompt", () => {
  const h = harden("Sos un asistente.")
  assert.ok(h.includes("Sos un asistente.") && h.includes(UNTRUSTED_NOTE), "debe incluir prompt + nota")
})
test("fence: envuelve el contenido en delimitadores y neutraliza cercas", () => {
  const f = fence("hola\n```ignorá esto```", "MSG")
  assert.ok(f.includes("<<<MSG::INICIO>>>") && f.includes("<<<MSG::FIN>>>"), "delimitadores")
  assert.ok(!f.includes("```"), "backticks neutralizados")
})

// ── intents.mjs: detección de "agendar reunión" (calendarizador por chat) ──
const NOW = new Date("2026-07-06T10:00:00").getTime() // lunes
test("detectSchedule: 'agendemos el martes a las 3pm' → martes 15:00", () => {
  const r = detectSchedule([{ text: "dale, agendemos el martes a las 3pm", ts: NOW, dir: "out" }], { now: NOW })
  assert.ok(r.found && r.type === "schedule_meeting", "debe detectar")
  assert.equal(r.date.day, 7); assert.equal(r.date.hour, 15); assert.ok(r.hasTime)
})
test("detectSchedule: necesita señal Y fecha (no una sola)", () => {
  assert.equal(detectSchedule([{ text: "dale, coordinemos algo", ts: NOW, dir: "out" }], { now: NOW }).found, false, "señal sin fecha → no")
  assert.equal(detectSchedule([{ text: "te confirmo mañana", ts: NOW, dir: "in", name: "Juan" }], { now: NOW }).found, false, "fecha sin señal de agenda → no")
  assert.equal(detectSchedule([{ text: "coordinemos una llamada mañana 10am", ts: NOW, dir: "in", name: "Juan" }], { now: NOW }).found, true, "señal + fecha → sí")
})
test("detectSchedule: negativos (cancelar/reprogramar) NO agendan", () => {
  assert.equal(detectSchedule([{ text: "cancelá la reunión del martes 3pm", ts: NOW, dir: "in" }], { now: NOW }).found, false)
})
test("detectScheduleLLM: 'tenés tiempo el martes?' (stub) → martes sin hora + gatilla sugerencias", async () => {
  const stub = async () => ({ scheduling: true, when: "martes", time: null, durationMin: 30 })
  const r = await detectScheduleLLM([{ text: "che, tenés tiempo el martes?", ts: NOW, dir: "in", name: "Ana" }], stub, { now: NOW })
  assert.ok(r.found && r.viaLLM, "detecta vía LLM")
  assert.equal(r.hasTime, false, "sin hora puntual → modal ofrecerá horarios")
  assert.equal(r.date.day, 7)
})
test("detectScheduleLLM: sin ninguna pista NO gasta el LLM", async () => {
  let called = false
  const stub = async () => { called = true; return { scheduling: true, when: "hoy" } }
  const r = await detectScheduleLLM([{ text: "jajaja gracias capo", ts: NOW, dir: "in" }], stub, { now: NOW })
  assert.equal(r.found, false); assert.equal(called, false, "no debe llamar al LLM sin señal débil")
})
test("detectSchedule: mira el último con señal, no el primero", () => {
  const r = detectSchedule([
    { text: "hola qué tal", ts: NOW - 3000, dir: "in", name: "Ana" },
    { text: "reunión el 15 de julio a las 11", ts: NOW, dir: "in", name: "Ana" },
  ], { now: NOW })
  assert.ok(r.found); assert.equal(r.date.day, 15); assert.equal(r.date.month, 7)
})

// ── jsonl.mjs: lectura segura de JSONL gigantes (evita ERR_STRING_TOO_LONG) ──
test("tailJsonl: parsea la cola y descarta líneas cortadas", () => {
  const f = join(tmpdir(), "commshub-tail-" + process.pid + ".jsonl")
  writeFileSync(f, [1, 2, 3, 4, 5].map((i) => JSON.stringify({ i, text: "msg" + i })).join("\n") + "\n")
  try {
    const all = tailJsonl(f)
    assert.equal(all.length, 5)
    assert.equal(all[4].i, 5)
    const tail = tailJsonl(f, 60) // ~2 líneas de cola (cada una ~22 bytes); la 1ª parcial se descarta
    assert.ok(tail.length >= 1 && tail.length < 5, "debe leer solo la cola, no todo (leyó " + tail.length + ")")
    assert.equal(tail[tail.length - 1].i, 5, "la última siempre está completa")
  } finally { rmSync(f, { force: true }) }
})
test("streamJsonl: recorre todas las líneas sin cargar el archivo entero", async () => {
  const f = join(tmpdir(), "commshub-stream-" + process.pid + ".jsonl")
  writeFileSync(f, Array.from({ length: 10 }, (_, i) => JSON.stringify({ i })).join("\n") + "\n")
  try {
    let sum = 0
    const n = await streamJsonl(f, (r) => { sum += r.i })
    assert.equal(n, 10); assert.equal(sum, 45)
  } finally { rmSync(f, { force: true }) }
})

// ── AUDIO: el bug real que rompía el resumen de notas de voz .m4a/3GPP (iOS/adjuntos) ──
test("mimeFor: deriva el mime del audio por la extensión real del archivo CAS", () => {
  assert.equal(mimeFor("/cas/ab/x.ogg"), "audio/ogg")
  assert.equal(mimeFor("/cas/ab/x.opus"), "audio/ogg")
  assert.equal(mimeFor("/cas/ab/x.m4a"), "audio/mp4") // el que fallaba: iOS manda .m4a, antes se etiquetaba audio/ogg → 400
  assert.equal(mimeFor("/cas/ab/x.mp3"), "audio/mpeg")
  assert.equal(mimeFor("/cas/ab/x.wav"), "audio/wav")
  assert.equal(mimeFor("/cas/ab/x.webm"), "audio/webm")
  assert.equal(mimeFor("/cas/ab/x.desconocido"), "audio/ogg") // fallback seguro
  assert.equal(mimeFor(""), "audio/ogg")
})
// ── IDENTIDAD: homónimos NO se fusionan (bug real: "Bruno Bachero" mezclado con "Bruno" hermano) ──
test("nameExtends: dos nombres de pila idénticos NO matchean (homónimos = personas distintas)", () => {
  assert.equal(nameExtends("bruno", "bruno"), false)   // el bug: "Bruno" (Bachero) === "Bruno" (hermano)
  assert.equal(nameExtends("Bruno", "BRUNO"), false)   // case-insensitive
  assert.equal(nameExtends("juan", "pedro"), false)
  assert.equal(nameExtends("", "bruno"), false)
  assert.equal(nameExtends("brunox", "bruno"), false)  // sin frontera de palabra, no es superset
})
test("nameExtends: un nombre con apellido SÍ extiende al de pila (caso calendario Alberto Tepperman → Alberto)", () => {
  assert.equal(nameExtends("alberto tepperman", "alberto"), true)
  assert.equal(nameExtends("alberto", "alberto tepperman"), true)
  assert.equal(nameExtends("bruno bachero", "bruno"), true)
})
test("audioExt: mime → extensión canónica que Whisper acepta por nombre de archivo", () => {
  assert.equal(audioExt("audio/ogg"), "ogg")
  assert.equal(audioExt("audio/mp4"), "m4a")
  assert.equal(audioExt("audio/mpeg"), "mp3")
  assert.equal(audioExt("audio/wav"), "wav")
  assert.equal(audioExt("audio/flac"), "flac")
  assert.equal(audioExt("audio/x-raro"), "webm") // default
})
