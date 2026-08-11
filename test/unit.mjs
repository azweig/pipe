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
  assert.ok(isContainerJid("!room:pipe.local"))
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
  assert.equal(phoneOf("@whatsapp_15551230001:pipe.local"), "15551230001")
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
  const grupo = computeThread({ channel: "whatsapp", jid: "!room:pipe.local", dm: "51999@s.whatsapp.net", grp: "FedEx CTM", text: "hola" })
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
  const f = join(tmpdir(), "pipe-tail-" + process.pid + ".jsonl")
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
  const f = join(tmpdir(), "pipe-stream-" + process.pid + ".jsonl")
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
// ── IDENTIDAD: homónimos NO se fusionan (bug real: "Diego Ramírez" mezclado con "Diego" hermano) ──
test("nameExtends: dos nombres de pila idénticos NO matchean (homónimos = personas distintas)", () => {
  assert.equal(nameExtends("diego", "diego"), false)   // el bug: "Diego" (Bachero) === "Diego" (hermano)
  assert.equal(nameExtends("Diego", "DIEGO"), false)   // case-insensitive
  assert.equal(nameExtends("juan", "pedro"), false)
  assert.equal(nameExtends("", "diego"), false)
  assert.equal(nameExtends("diegox", "diego"), false)  // sin frontera de palabra, no es superset
})
test("nameExtends: un nombre con apellido SÍ extiende al de pila (caso calendario Carlos Mendoza → Carlos)", () => {
  assert.equal(nameExtends("carlos mendoza", "carlos"), true)
  assert.equal(nameExtends("carlos", "carlos mendoza"), true)
  assert.equal(nameExtends("diego ramírez", "diego"), true)
})
test("audioExt: mime → extensión canónica que Whisper acepta por nombre de archivo", () => {
  assert.equal(audioExt("audio/ogg"), "ogg")
  assert.equal(audioExt("audio/mp4"), "m4a")
  assert.equal(audioExt("audio/mpeg"), "mp3")
  assert.equal(audioExt("audio/wav"), "wav")
  assert.equal(audioExt("audio/flac"), "flac")
  assert.equal(audioExt("audio/x-raro"), "webm") // default
})

// ── Imágenes INLINE de email (cid: → data:) ──────────────────────────────────────────────────────
// El visor es un iframe sandboxeado con CSP img-src data:, así que las imágenes del cuerpo tienen que
// viajar embebidas. Antes ni se guardaban y el correo mostraba recuadros vacíos.
{
  const { inlineCidImages } = await import("../src/lib/email-inline.mjs")
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const read = (pub) => (pub === "/cas/aa/hash.png" ? png : null)
  const att = { cas: "/cas/aa/hash.png", cid: "image001.png@01DD", mime: "image/png", size: png.length, inline: true }

  test("inlineCidImages: reemplaza el cid: por el data: URI del blob", () => {
    const out = inlineCidImages('<img src="cid:image001.png@01DD">', [att], read)
    assert.equal(out, `<img src="data:image/png;base64,${png.toString("base64")}">`)
  })
  test("inlineCidImages: el cid es case-insensitive y tolera <> alrededor", () => {
    const out = inlineCidImages("<img src='cid:IMAGE001.PNG@01dd'>", [{ ...att, cid: "<image001.png@01DD>" }], read)
    assert.ok(out.includes("data:image/png;base64,"))
  })
  test("inlineCidImages: si el blob no está en el CAS deja el cid: (no rompe el resto del correo)", () => {
    const out = inlineCidImages('<p>hola</p><img src="cid:falta@x">', [{ ...att, cid: "falta@x", cas: "/cas/bb/otro.png" }], read)
    assert.equal(out, '<p>hola</p><img src="cid:falta@x">')
  })
  test("inlineCidImages: sin adjuntos inline devuelve el cuerpo intacto", () => {
    const html = '<img src="cid:x@y">'
    assert.equal(inlineCidImages(html, [], read), html)
    assert.equal(inlineCidImages(html, [{ cas: "/cas/aa/hash.png", mime: "image/png" }], read), html) // adjunto sin cid → no matchea
  })
  test("inlineCidImages: una imagen gigante NO se inlinea (tope por imagen)", () => {
    const out = inlineCidImages('<img src="cid:image001.png@01DD">', [{ ...att, size: 9 * 1024 * 1024 }], read)
    assert.ok(out.includes("cid:image001.png@01DD"))
  })
  test("inlineCidImages: cuerpo vacío o sin cid: pasa de largo", () => {
    assert.equal(inlineCidImages(null, [att], read), null)
    assert.equal(inlineCidImages("<p>sin imágenes</p>", [att], read), "<p>sin imágenes</p>")
  })
}

{
  const { inlineCidImages } = await import("../src/lib/email-inline.mjs")
  test("inlineCidImages: la MISMA imagen repetida se lee del CAS una sola vez", () => {
    const png = Buffer.alloc(64, 7)
    let reads = 0
    const read = () => { reads++; return png }
    const att = { cas: "/cas/aa/h.png", cid: "logo@x", mime: "image/png", size: png.length, inline: true }
    const html = Array.from({ length: 20 }, () => '<img src="cid:logo@x">').join("")
    const out = inlineCidImages(html, [att], read)
    assert.equal(reads, 1, "debe leer el blob una vez, no una por ocurrencia")
    assert.equal((out.match(/data:image\/png/g) || []).length, 20, "las 20 ocurrencias quedan resueltas")
  })
}

// ── Huella perceptual + optimización de media ────────────────────────────────────────────────────
{
  const { dhashFromGray9x8, hamming, isVideoExt, ffmpegPhashArgs } = await import("../src/lib/phash.mjs")
  const { optimizerFor, acceptResult } = await import("../src/lib/media-optimize.mjs")

  // gradiente creciente por fila → cada píxel es MENOR que el de su derecha → todos los bits en 0
  const gray = (fn) => Buffer.from(Array.from({ length: 72 }, (_, i) => fn(i % 9, Math.floor(i / 9))))

  test("dhash: 64 bits en 16 hex", () => {
    const h = dhashFromGray9x8(gray((x) => x * 20))
    assert.equal(h.length, 16)
    assert.equal(h, "0000000000000000") // siempre creciente hacia la derecha
  })
  test("dhash: gradiente invertido da el complemento", () => {
    assert.equal(dhashFromGray9x8(gray((x) => 200 - x * 20)), "ffffffffffffffff")
  })
  test("dhash: buffer corto o vacío → null (no inventa huella)", () => {
    assert.equal(dhashFromGray9x8(Buffer.alloc(10)), null)
    assert.equal(dhashFromGray9x8(null), null)
  })
  test("hamming: 0 entre iguales, 64 entre opuestas, y compara de a bits", () => {
    assert.equal(hamming("0000000000000000", "0000000000000000"), 0)
    assert.equal(hamming("ffffffffffffffff", "0000000000000000"), 64)
    assert.equal(hamming("0000000000000001", "0000000000000000"), 1)
    assert.equal(hamming("abc", null), 64) // defensivo: sin huella → lo más lejos posible
  })
  test("ffmpegPhashArgs: en video busca un fotograma adentro, en imagen no", () => {
    assert.ok(isVideoExt(".mp4") && !isVideoExt(".jpg"))
    assert.ok(ffmpegPhashArgs("/x.mp4", ".mp4").includes("-ss"))
    assert.ok(!ffmpegPhashArgs("/x.jpg", ".jpg").includes("-ss"))
  })
  test("optimizerFor: cada tipo a su herramienta; el video queda marcado como CON pérdida", () => {
    assert.equal(optimizerFor(".jpg", "i", "o").tool, "jpegtran")
    assert.ok(optimizerFor(".jpg", "i", "o").args.join(" ").includes("-copy all"), "el EXIF (orientación) se conserva")
    assert.equal(optimizerFor(".JPEG", "i", "o").tool, "jpegtran") // case-insensitive
    assert.equal(optimizerFor(".png", "i", "o").tool, "optipng")
    assert.equal(optimizerFor(".mp4", "i", "o").lossy, true)
    assert.equal(optimizerFor(".jpg", "i", "o").lossy, false)
    assert.equal(optimizerFor(".pdf", "i", "o"), null) // no se toca lo que no es media
  })
  test("acceptResult: rechaza salida vacía, ganancia mínima y video con duración distinta", () => {
    assert.equal(acceptResult({ origSize: 1000, newSize: 0, lossy: false }).ok, false)
    assert.equal(acceptResult({ origSize: 1000, newSize: 990, lossy: false }).ok, false) // 1% no paga
    assert.equal(acceptResult({ origSize: 1000, newSize: 500, lossy: false }).ok, true)
    // video que se cortó a la mitad: MÁS chico pero inaceptable
    assert.equal(acceptResult({ origSize: 1000, newSize: 400, lossy: true, origDur: 60, newDur: 30 }).ok, false)
    assert.equal(acceptResult({ origSize: 1000, newSize: 400, lossy: true, origDur: 60, newDur: 60.2 }).ok, true)
    assert.equal(acceptResult({ origSize: 1000, newSize: 400, lossy: true, origDur: null, newDur: null }).ok, false)
  })
}

{
  const { ffmpegPhashArgs } = await import("../src/lib/phash.mjs")
  test("ffmpegPhashArgs ya incluye el '-' de salida a stdout (no duplicarlo en el caller)", () => {
    const a = ffmpegPhashArgs("/x.jpg", ".jpg")
    assert.equal(a[a.length - 1], "-")
    assert.equal(a.filter((x) => x === "-").length, 1)
  })
}

{
  const { isDegenerateHash } = await import("../src/lib/phash.mjs")
  test("isDegenerateHash: una imagen plana (fotograma negro) no puede agrupar como duplicado", () => {
    assert.equal(isDegenerateHash("0000000000000000"), true)  // todo negro / liso
    assert.equal(isDegenerateHash("ffffffffffffffff"), true)
    assert.equal(isDegenerateHash("6d6d6d6d6d6d6f6d"), false) // patrón repetido PERO con señal
    assert.equal(isDegenerateHash("e773565f4b8f0e16"), false)
    assert.equal(isDegenerateHash(""), true)
    assert.equal(isDegenerateHash(null), true)
  })
}

// ── Firmas de correo ─────────────────────────────────────────────────────────────────────────────
// Un email se responde CON firma; un WhatsApp no. Antes los dos salían como texto pelado.
{
  const { composeEmailBody, looksSigned, textToHtml } = await import("../src/lib/signature.mjs")
  test("composeEmailBody: agrega la firma y arma la parte HTML", () => {
    const r = composeEmailBody("Confirmo el pago el lunes.", "no-existe@x")
    assert.ok(r.text.includes("Confirmo el pago el lunes."))
    assert.ok(r.text.includes("--"), "la firma por defecto lleva el separador estándar")
    assert.ok(r.html.startsWith("<div>"), "siempre hay parte HTML (si no, la firma se ve rota)")
  })
  test("composeEmailBody: con skip NO firma (el texto ya venía firmado)", () => {
    const r = composeEmailBody("Saludos,\nAlvaro", "x", { skip: true })
    assert.equal(r.text, "Saludos,\nAlvaro")
  })
  test("looksSigned: detecta el separador -- para no duplicar la firma", () => {
    assert.equal(looksSigned("Listo, mañana lo veo.\n\n--\nAlvaro"), true)
    assert.equal(looksSigned("Listo, mañana lo veo."), false)
    assert.equal(looksSigned(""), false)
  })
  test("textToHtml: escapa HTML del usuario y respeta los saltos de línea", () => {
    const h = textToHtml("hola <script>alert(1)</script>\nchau")
    assert.ok(!h.includes("<script>"), "no se puede inyectar HTML desde el compositor")
    assert.ok(h.includes("&lt;script&gt;") && h.includes("<br>"))
  })
  test("textToHtml: los links quedan clicables", () => {
    assert.ok(textToHtml("mirá https://pipe.one acá").includes('<a href="https://pipe.one">'))
  })
}
