// Pruebas de INTEGRACIÓN de pipe. Corren contra el server vivo (localhost:3000) + la DB/archivos.
// Uso:  node test/integration.mjs           (rápido, sin IA)
//       node test/integration.mjs --llm      (incluye IA: suggest-reply, lento/costoso)
// Sale con código 1 si algo falla → sirve para "antes y después" de cada cambio.
const BASE = process.env.HUB || "http://localhost:3000"
const WITH_LLM = process.argv.includes("--llm")
let pass = 0, fail = 0
const out = []
async function test(name, fn) {
  try { await fn(); pass++; out.push("  ✓ " + name) }
  catch (e) { fail++; out.push("  ✗ " + name + " — " + e.message) }
}
const assert = (c, m) => { if (!c) throw new Error(m || "assert falló") }
const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, json: await r.json().catch(() => null) } }
const importDb = async () => (await import("../src/lib/db-core.mjs")).handle() // Wave 6: el handle vive en db-core (db() ya no se exporta)

console.log("── PRUEBAS DE INTEGRACIÓN pipe ──\n")

// SKIP-IF-NO-SERVER: este suite es MANUAL (necesita el server vivo en :3000). Sin él, un `node --test test/*.mjs` colgaba 28s y
// "fallaba" → un contribuidor nuevo cree que el repo está roto. Probamos la reachability y salimos limpio (exit 0) si no hay server.
try { await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(1500) }) }
catch { console.log(`⏭️  SKIP: no hay server en ${BASE}. Este suite es manual — levantá el daemon y corré:  node test/integration.mjs`); process.exit(0) }

// ══ API: salud y forma ══
await test("server responde /", async () => { const r = await fetch(BASE + "/"); assert(r.status === 200, "status " + r.status) })
await test("/api/threads devuelve array con la forma esperada", async () => {
  const { status, json } = await get("/api/threads?limit=50")
  assert(status === 200, "status " + status); assert(Array.isArray(json) && json.length > 0, "no array o vacío")
  for (const k of ["key", "name", "channels", "lastChannel", "ts"]) assert(k in json[0], "falta campo " + k)
  assert(json.some((x) => "suggested" in x), "falta suggested"); assert(json.some((x) => "unseen" in x), "falta unseen")
})
await test("/api/coach trae brief + secciones", async () => {
  const { json } = await get("/api/coach")
  for (const k of ["nudges", "proposals", "promises", "questions", "waiting"]) assert(Array.isArray(json[k]), "no-array: " + k)
})
await test("/api/agenda", async () => { const { json } = await get("/api/agenda"); assert(Array.isArray(json.meetings), "meetings") })
await test("/api/thread?key=self", async () => { const { json } = await get("/api/thread?key=self&limit=10"); assert(Array.isArray(json.items), "items") })
await test("/api/thread de un contacto real", async () => {
  const { json: th } = await get("/api/threads?limit=200")
  const t = th.find((x) => !x.group && x.count > 2); assert(t, "no hay contacto en 200")
  const { json } = await get("/api/thread?key=" + encodeURIComponent(t.key))
  assert(Array.isArray(json.items) && json.items.length > 0 && json.name, "sin items/nombre")
})
await test("/api/thread/targets (WhatsApp)", async () => {
  const { json: th } = await get("/api/threads?limit=200")
  const w = th.find((x) => x.lastChannel === "whatsapp" && !x.group); assert(w, "no hay WA en 200")
  const { json } = await get("/api/thread/targets?key=" + encodeURIComponent(w.key))
  assert(Array.isArray(json.targets), "targets")
})
await test("/api/auth/status", async () => { const { json } = await get("/api/auth/status"); assert(typeof json.pinSet === "boolean" && typeof json.authed === "boolean", "forma") })
await test("/api/llm-usage (medidor nube/local)", async () => {
  const { json } = await get("/api/llm-usage")
  for (const k of ["cloudTok", "localTok", "cloudCalls", "localCalls"]) assert(typeof json[k] === "number", "falta " + k)
})
await test("/api/espacios", async () => { const { json } = await get("/api/espacios"); assert(Array.isArray(json), "array") })
await test("/api/status: integraciones desde la DB (no crashea con jsonl gigante)", async () => {
  const { status, json } = await get("/api/status")
  assert(status === 200 && json && typeof json === "object", "status/forma")
  // al menos un canal debe figurar como activo (WhatsApp entra seguido) → prueba que NO cayó al catch vacío
  const s = JSON.stringify(json)
  assert(/whatsapp|email|teams/i.test(s), "sin canales en el estado")
})
await test("/api/channels: heartbeat por canal con umbral adaptativo", async () => {
  const { status, json } = await get("/api/channels")
  assert(status === 200, "status " + status)
  assert(typeof json.ok === "boolean" && Array.isArray(json.channels), "forma")
  assert(json.channels.length > 0, "sin canales")
  const wa = json.channels.find((c) => c.channel === "whatsapp")
  assert(wa && typeof wa.ageH === "number" && typeof wa.thresholdH === "number" && "stale" in wa, "canal sin campos")
  assert(json.ingest && typeof json.ingest.lagSec === "number", "sin lag de ingesta")
  assert(json.ingest.stuck === false, "la ingesta NO debe estar trabada (lag " + json.ingest.lagSec + "s)")
})
await test("/api/selftest: último resultado del auto-test de envío (forma)", async () => {
  const { status, json } = await get("/api/selftest")
  assert(status === 200, "status " + status)
  assert(json && typeof json.ts === "number" && Array.isArray(json.results), "forma {ts,results[]}")
  for (const r of json.results) assert(r.channel && typeof r.ok === "boolean" && typeof r.detail === "string", "resultado sin channel/ok/detail")
})
await test("/api/calendar: incluye próximo evento + sugerencia del coach (empty-state)", async () => {
  const { status, json } = await get("/api/calendar?view=dia")
  assert(status === 200, "status " + status)
  assert(Array.isArray(json.events), "sin events")
  assert("nextEvent" in json && "coachSuggest" in json, "faltan nextEvent/coachSuggest")
  if (json.nextEvent) assert(typeof json.nextEvent.daysAway === "number" && typeof json.nextEvent.title === "string", "nextEvent sin daysAway/title")
})
await test("/api/push/vapid entrega la llave pública", async () => {
  const { status, json } = await get("/api/push/vapid")
  assert(status === 200, "status " + status)
  assert(typeof json.publicKey === "string" && json.publicKey.length > 20, "sin publicKey")
  assert(typeof json.count === "number", "sin count")
})
await test("PWA instalable: /manifest.json + /sw.js + iconos", async () => {
  const m = await fetch(BASE + "/manifest.json"); assert(m.status === 200, "manifest " + m.status)
  const mj = await m.json(); assert(mj.icons && mj.icons.length >= 2, "manifest sin iconos")
  const sw = await fetch(BASE + "/sw.js"); assert(sw.status === 200, "sw " + sw.status)
  assert((sw.headers.get("content-type") || "").includes("javascript"), "sw no es JS")
  const ic = await fetch(BASE + "/icon-192.png"); assert(ic.status === 200, "icon " + ic.status)
})

// ══ Integridad de datos ══
await test("DB: 0 hilos-fantasma (mensajes de grupo en hilo no-grupo)", async () => {
  const d = await importDb()
  const c = d.prepare("SELECT COUNT(DISTINCT thread) c FROM messages WHERE grp IS NOT NULL AND grp!='' AND thread NOT LIKE '%@g.us' AND thread NOT LIKE 'whatsapp:!%' AND thread NOT LIKE '%@newsletter' AND thread NOT LIKE '%@broadcast' AND thread NOT LIKE '%@thread.v2' AND thread!='self'").get().c
  assert(c === 0, c + " hilos con mensajes de grupo filtrados")
})
await test("DB: thread_stats sin corrupción gruesa (tolera drift menor)", async () => {
  const d = await importDb()
  const rows = d.prepare("SELECT thread, count FROM thread_stats ORDER BY last_ts DESC LIMIT 5").all()
  for (const s of rows) { const real = d.prepare("SELECT COUNT(*) c FROM messages WHERE thread=?").get(s.thread).c; assert(Math.abs(s.count - real) <= 3, `${s.thread}: stat ${s.count} vs real ${real} (drift >3)`) }
})
await test("DB: thread_stats NO está vacío (bandeja no vacía)", async () => {
  const d = await importDb()
  const stats = d.prepare("SELECT count(*) c FROM thread_stats").get().c
  assert(stats > 100, "thread_stats casi vacío: " + stats)
})
await test("DB: índice idx_dir_thread existe", async () => {
  const d = await importDb()
  assert(d.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dir_thread'").get(), "falta idx_dir_thread")
})
await test("DB: identity-manual carga y tiene mapeos", async () => {
  const { readFileSync, existsSync } = await import("fs")
  if (!existsSync("./data/identity-manual.json")) return // opcional: puede no existir en una instancia nueva
  const man = JSON.parse(readFileSync("./data/identity-manual.json", "utf8"))
  assert(man && typeof man === "object", "identity-manual no es objeto")
})

// ══ Señales (motor de proactividad) ══
await test("signals: todas devuelven arrays/obj sin explotar", async () => {
  const s = await import("../src/lib/signals.mjs")
  for (const fn of ["pendingReplies", "promises", "unansweredQuestions", "waitingOnThem", "recentNotes"]) assert(Array.isArray(s[fn]()), fn + " no array")
  assert(typeof s.importanceMap() === "object", "importanceMap")
})

// ══ Espacios: jerarquía padre/hijo ══
await test("espacios: estructura y anidamiento válidos", async () => {
  const ws = await import("../src/lib/workspace.mjs")
  const esp = ws.espacios()
  assert(Array.isArray(esp), "espacios no es array")
  for (const e of esp) if (e.parent) assert(esp.some((p) => p.id === e.parent), `espacio "${e.name}" apunta a un parent inexistente`)
})

// ══ Perfil de contacto (no debe crashear leyendo el jsonl gigante) ══
await test("/api/person de un contacto real no crashea", async () => {
  const { json: th } = await get("/api/threads?limit=200")
  const t = th.find((x) => !x.group && x.count > 3); assert(t, "no hay contacto")
  const { json } = await get("/api/person?key=" + encodeURIComponent(t.key))
  assert(json && !json.error && (json.name || json.canon), "personView vacío/error: " + JSON.stringify(json).slice(0, 80))
})

await test("/api/contact/profile (perfil rico)", async () => {
  const { json: th } = await get("/api/threads?limit=200")
  const t = th.find((x) => !x.group && x.count > 5); assert(t, "no hay contacto")
  const { json } = await get("/api/contact/profile?key=" + encodeURIComponent(t.key))
  assert(json && json.name && typeof json.total === "number" && Array.isArray(json.channels), "perfil incompleto")
  assert(json.total > 0 && (json.sent + json.recv === json.total), "stats inconsistentes")
})
await test("/api/thread/media (galería de adjuntos)", async () => {
  const { json: th } = await get("/api/threads?limit=200")
  const t = th.find((x) => !x.group && x.count > 5); assert(t, "no hay contacto")
  const { json } = await get("/api/thread/media?key=" + encodeURIComponent(t.key))
  assert(json && Array.isArray(json.items), "media no es array")
})

// ══ Performance (SOLO informativo — NO es assert) ══
// Una sola muestra contra data real no es una señal: es ruido que entrena a ignorar el suite. Se mide y se reporta, no se afirma.
// Para un umbral real → bench/ con múltiples corridas y percentiles.
await test("perf: /api/threads?limit=600 (informativo, sin umbral)", async () => {
  await get("/api/threads?limit=600") // warm-up (calienta cache/ptags como en uso real)
  const t0 = Date.now(); await get("/api/threads?limit=600"); const ms = Date.now() - t0
  console.log(`      ⏱️  /api/threads?limit=600 steady-state: ${ms}ms (referencia <50ms; no falla el suite)`)
})

// ══ IA (opcional, lento) ══
if (WITH_LLM) {
  await test("IA: suggest-reply devuelve draft", async () => {
    const { json: th } = await get("/api/threads?limit=200")
    const t = th.find((x) => x.lastChannel === "whatsapp" && !x.group && x.lastDir === "in"); assert(t, "no hay hilo")
    const { json } = await get("/api/thread/suggest-reply?key=" + encodeURIComponent(t.key))
    assert(json && typeof json.draft === "string", "sin draft")
  })
  await test("IA: /api/coach/weekly (review semanal)", async () => {
    const { json } = await get("/api/coach/weekly")
    assert(json && typeof json.review === "string" && json.review.length > 10 && typeof json.sent === "number", "review incompleto")
  })
  await test("IA: /api/ask responde (chat global RAG)", async () => {
    const r = await fetch(BASE + "/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "¿con quién tengo temas de plata pendientes?" }) })
    const json = await r.json()
    assert(json && typeof json.answer === "string" && json.answer.length > 3, "sin answer: " + JSON.stringify(json).slice(0, 80))
  })
}

console.log(out.join("\n"))
console.log(`\n${pass} PASS · ${fail} FAIL${WITH_LLM ? " (con IA)" : ""}`)
process.exit(fail ? 1 : 0)
