// Signal reader — trae tus mensajes de Signal a la bandeja. Usa signal-cli-rest-api (bbernhard/signal-cli-rest-api, Docker).
// Se VINCULA POR NÚMERO al hilo de WhatsApp/SMS del mismo contacto (computeThread rama 'signal'): una sola conversación por persona.
// Config: SIGNAL_CLI_URL (ej http://localhost:8080) + SIGNAL_NUMBER (tu número registrado, +51…). Sin eso → reader inactivo.
// Registro (una vez): seguí el README de signal-cli-rest-api (vincular como dispositivo o registrar el número). Uso: node src/signal.mjs
import { appendMessage } from "./lib/lock.mjs"
import { getSignal } from "./lib/integrations.mjs"

const _stored = getSignal() || {} // lo conectado desde la Consola (URL cifrada) — fallback tras el .env
const URL_ = (process.env.SIGNAL_CLI_URL || _stored.url || "").replace(/\/+$/, "")
const ME = (process.env.SIGNAL_NUMBER || _stored.number || "").trim()
if (!URL_ || !ME) console.log("[signal] sin SIGNAL_CLI_URL/SIGNAL_NUMBER — reader inactivo (dormido)")
const POLL = +process.env.SIGNAL_POLL_MS || 15000
const digits = (s) => String(s || "").replace(/[^\d]/g, "")

async function tick() {
  let arr = []
  try { arr = await fetch(`${URL_}/v1/receive/${encodeURIComponent(ME)}`).then((r) => r.json()) } catch (e) { console.error("[signal] receive:", e.message); return }
  if (!Array.isArray(arr) || !arr.length) return
  let n = 0
  for (const it of arr) {
    const env = it.envelope || it
    const dm = env.dataMessage || env.syncMessage?.sentMessage
    const text = (dm?.message || "").trim(); if (!text) continue
    const out = !!env.syncMessage // syncMessage = lo mandaste vos desde otro dispositivo
    const peer = out ? digits(dm?.destination || env.syncMessage?.sentMessage?.destination) : digits(env.sourceNumber || env.source)
    if (!peer) continue
    const ts = +(env.timestamp || dm?.timestamp) || Date.now()
    const name = env.sourceName || peer
    try { appendMessage({ id: `signal-${peer}-${ts}`, channel: "signal", account: "signal", jid: peer, name, text: text.slice(0, 4000), ts, dir: out ? "out" : "in" }); n++ } catch {}
  }
  if (n) console.log(`[signal] +${n} mensajes`)
}

if (URL_ && ME) {
  console.log(`[signal] escuchando ${URL_} (${ME}) cada ${POLL / 1000}s`)
  await tick()
  setInterval(() => tick().catch((e) => console.error("[signal]", e.message)), POLL)
} else { setInterval(() => {}, 2 ** 31 - 1) }
