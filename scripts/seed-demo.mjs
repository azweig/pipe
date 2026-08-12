// Siembra una instancia con una bandeja FICTICIA, para demos, capturas y para probar la interfaz sin datos reales.
//
// Escribe por la vía normal (data/messages.jsonl) y deja que la ingesta haga su trabajo: así se ejercitan los mismos
// caminos que en producción (threading, thread_stats, FTS, rev) en vez de inventar filas a mano en la base.
//
// Uso:  node scripts/seed-demo.mjs        # sobre la instancia del directorio actual
// ⚠️  Es para instancias VACÍAS o de demo. No lo corras sobre tu hub real: mezclaría gente inventada con la de verdad.
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs"

const DATA = "./data"
const FILE = `${DATA}/messages.jsonl`
mkdirSync(DATA, { recursive: true })

// Aviso si la instancia ya tiene contenido: mejor frenar que ensuciar una bandeja real.
if (existsSync(FILE) && readFileSync(FILE, "utf8").trim().length > 0 && !process.argv.includes("--force")) {
  console.error("⚠️  Ya hay mensajes en esta instancia. Si igual querés sembrar la demo, agregá --force.")
  process.exit(1)
}

const H = 3600000, D = 86400000
const now = Date.now()
const ago = (h) => now - h * H

// Personas inventadas. Cualquier parecido con la realidad es casualidad — ese es el punto.
// En inglés porque es el idioma del repo y de las capturas del README; la interfaz igual se ve en tu idioma.
const T = [
  // — WhatsApp 1:1, con una pregunta esperando respuesta —
  { thread: "15550000001@s.whatsapp.net", channel: "whatsapp", jid: "15550000001@s.whatsapp.net", name: "Laura Fields", msgs: [
    ["in", "Hey! I emailed you the revised proposal — did you see it?", 26],
    ["out", "Opening it now, I'll get back to you", 25.5],
    ["in", "Sure. The only change is the timeline: 30 days became 45", 25.4],
    ["in", "Does that work for you or should we adjust it?", 3.2],
  ] },
  // — grupo —
  { thread: "120363000000000001@g.us", channel: "whatsapp", jid: "120363000000000001@g.us", grp: "Product Team", name: "Martin Shaw", msgs: [
    ["in", "Pushed the new build to staging, it's ready to try", 8],
    ["in", "Heads up: login got slow, I'm looking into it", 7.6],
    ["out", "Great, I'll test it shortly", 7.2],
  ] },
  // — email con cuerpo HTML (para el visor de correo) —
  { thread: "billing@southsupply.example", channel: "email", account: "work", jid: "billing@southsupply.example", name: "South Supply", msgs: [
    ["in", "August statement — Please find attached the breakdown of outstanding invoices as of month end.", 30,
      "<div style='font-family:system-ui'><p>Hello,</p><p>Attached is your <b>account statement</b> as of the end of August. The outstanding balance is <b>USD 4,820</b>, due on Sept 15.</p><p>Let us know if you have any questions.</p><p>Best,<br>Billing — South Supply</p></div>"],
  ] },
  { thread: "anna.miller@lawoffice.example", channel: "email", account: "work", jid: "anna.miller@lawoffice.example", name: "Anna Miller", msgs: [
    ["in", "Contract reviewed — Sending the contract back with two comments on clause 7.", 52,
      "<div style='font-family:system-ui'><p>Hi,</p><p>I reviewed the contract. Just two notes on <b>clause 7</b> (delivery timelines), which I left as comments.</p><p>Everything else looks ready to sign.</p><p>Best,<br>Anna</p></div>"],
    ["out", "Thanks Anna, I'll look at it today and confirm", 50],
  ] },
  // — Telegram —
  { thread: "900000001", channel: "telegram", account: "tg", jid: "900000001", name: "Dan Price", msgs: [
    ["in", "Are you still looking for someone for the afternoon shift?", 11],
    ["in", "I know someone who might be interested", 10.8],
  ] },
  // — nota de voz: el resumen es lo que hace la transcripción local —
  { thread: "15550000002@s.whatsapp.net", channel: "whatsapp", jid: "15550000002@s.whatsapp.net", name: "Carla Bianchi", msgs: [
    ["in", "🎤 Audio", 5, null, { mediaType: "audio", summary: "Says the shipment arrives Thursday and asks whether someone can receive it in the morning." }],
  ] },
  // — Teams —
  { thread: "project-atlas", channel: "teams", account: "work", jid: "project-atlas", grp: "Project Atlas", name: "Sophie King", msgs: [
    ["in", "The review is booked for Tuesday at 10:30", 20],
  ] },
  // — tus propias notas. `self: true` es la marca que usa computeThread() para el hilo "de mí para mí" —
  { thread: "self", channel: "whatsapp", jid: "15550000099@s.whatsapp.net", self: true, name: "You", msgs: [
    ["out", "Idea: charge setup separately and keep the monthly lower", 40],
    ["out", "Remember to ask for the August invoice", 15],
  ] },
]

let n = 0
for (const t of T) {
  for (const [dir, text, hours, body, extra] of t.msgs) {
    const rec = {
      id: `demo:${t.thread}:${n}`,
      channel: t.channel, account: t.account || "", thread: t.thread, jid: t.jid,
      name: dir === "out" ? "Vos" : t.name, text, ts: ago(hours), dir,
      unread: dir === "in" && hours < 12 ? 1 : 0,
      ...(t.grp ? { grp: t.grp } : {}), ...(t.self ? { self: true } : {}), ...(body ? { body } : {}), ...(extra || {}),
    }
    appendFileSync(FILE, JSON.stringify(rec) + "\n")
    n++
  }
}
console.log(`✅ ${n} mensajes ficticios en ${FILE} · ${T.length} conversaciones`)
console.log("   La ingesta los toma en su próximo ciclo (15s) o corré: node src/ingest.mjs")
