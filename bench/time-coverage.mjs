// COVERAGE DE TIEMPOS — mide cada endpoint que dispara la app (mediana de N corridas contra localhost:3000).
// Correr en el server: node bench/time-coverage.mjs   → imprime tabla markdown. Re-correr en cada deploy y comparar contra el baseline.
const BASE = process.env.BENCH_BASE || "http://localhost:3000"
const N = +process.env.BENCH_N || 5
const now = () => Number(process.hrtime.bigint() / 1000000n)
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

async function hit(method, path, body) {
  const opt = { method, headers: body ? { "Content-Type": "application/json" } : {} }
  if (body) opt.body = JSON.stringify(body)
  const t = now(); let ok = true
  try { const r = await fetch(BASE + path, opt); await r.text(); ok = r.ok } catch { ok = false }
  return { ms: now() - t, ok }
}
async function bench(label, method, path, body) {
  await hit(method, path, body) // warmup
  const runs = []; let ok = true
  for (let i = 0; i < N; i++) { const r = await hit(method, path, body); runs.push(r.ms); ok = ok && r.ok }
  return { label, method, path: path.split("?")[0], ms: med(runs), min: Math.min(...runs), max: Math.max(...runs), ok }
}

// descubrir params reales (hilo, persona, evento, espacio)
const threads = await fetch(BASE + "/api/threads?limit=50").then((r) => r.json()).catch(() => [])
const arr = Array.isArray(threads) ? threads : (threads.threads || [])
const dm = arr.find((t) => !t.group && !t.espacio && t.canon) || arr[0] || {}
const esp = arr.find((t) => t.espacio) || {}
const cal = await fetch(BASE + "/api/calendar?view=dia").then((r) => r.json()).catch(() => ({ events: [] }))
const mtgId = (cal.events || [])[0]?.id || ""
const espId = (esp.espId) || (await fetch(BASE + "/api/espacios").then((r) => r.json()).catch(() => []))[0]?.id || ""
const personName = dm.canon || dm.name || "Contacto"
const threadKey = dm.key || "self"

// endpoints que carga la UI (los de pantalla/lectura + la corrección al enviar)
const TARGETS = [
  ["Bandeja (inbox)", "GET", "/api/threads?limit=400"],
  ["Home", "GET", "/api/home"],
  ["Calendario · Día", "GET", "/api/calendar?view=dia"],
  ["Calendario · Semana", "GET", "/api/calendar?view=laboral"],
  ["Abrir conversación", "GET", "/api/thread?key=" + encodeURIComponent(threadKey) + "&limit=100"],
  ["Targets de hilo", "GET", "/api/thread/targets?key=" + encodeURIComponent(threadKey)],
  ["Persona (Graphify)", "GET", "/api/person?name=" + encodeURIComponent(personName)],
  ["Detalle de evento", "GET", "/api/meeting?id=" + encodeURIComponent(mtgId)],
  ["Espacio (vista)", "GET", "/api/espacio/view?id=" + encodeURIComponent(espId)],
  ["Coach / IA", "GET", "/api/coach"],
  ["Agenda", "GET", "/api/agenda"],
  ["Espacios (lista)", "GET", "/api/espacios"],
  ["Objetivos", "GET", "/api/objetivos"],
  ["Empresas", "GET", "/api/companies"],
  ["Corrección al enviar", "POST", "/api/compose/correct", { text: "ola q tal nos vemos maana", channel: "whatsapp" }],
]

const rows = []
for (const [label, method, path, body] of TARGETS) rows.push(await bench(label, method, path, body))

console.log(`\n# Coverage de tiempos — ${new Date().toISOString().slice(0, 16).replace("T", " ")} (mediana de ${N}, localhost)\n`)
console.log("| Función (pantalla) | Método | Endpoint | Mediana | min–max | OK |")
console.log("|---|---|---|---:|---:|:--:|")
for (const r of rows) console.log(`| ${r.label} | ${r.method} | \`${r.path}\` | **${r.ms} ms** | ${r.min}–${r.max} | ${r.ok ? "✅" : "❌"} |`)
console.log("")
process.exit(0)
