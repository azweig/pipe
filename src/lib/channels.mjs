// ── REGISTRO DE CANALES — la ÚNICA fuente de verdad de qué canales existen y cómo se conectan/envían/muestran. ──
// Antes esto vivía disperso: daemon.READERS (spawn), reply.sendReply (if-chain de envío), server (endpoints de conexión) y
// app.js (mapas CH/CHAN_ICON/chanLabel/CONN_PROV). Agregar un canal obligaba a tocar los 4. Ahora un canal de mensajería SIMPLE
// se agrega con UNA entrada acá (+ su reader y su fn de envío). Ver docs/ADDING-A-CHANNEL.md.
//
// Forma de una entrada (todos los campos salvo id/label/kind son opcionales):
//   id       clave interna del canal (= el valor de `channel` en messages) y del `net` del bridge Matrix.
//   label    nombre visible.
//   brand    color de marca (#hex) para los iconos de los clientes.
//   kind     "messaging" | "email" | "calendar" | "files" | "notes"  → agrupa/gatea capacidades (voz/media/stickers = solo messaging).
//   reader   nombre del proceso lector que lo INGIERE (ver daemon.READERS). Varios canales pueden compartir reader (el bridge Matrix
//            ingiere whatsapp/instagram/facebook/linkedin/discord con un solo proceso "matrix").
//   connect  cómo se VINCULA desde la UI:
//              { method:"matrix-bridge", net, multi }   → QR/código por el bot mautrix (/api/matrix-link?net=)
//              { method:"matrix-token",  net }           → token (Discord) (/api/matrix-link-token?net=)
//              { method:"telegram-login" }               → teléfono→código→2FA (/api/telegram/*)
//              { method:"integration", provider, fields }→ token/URL cifrados (/api/integrations/<provider>)
//              { method:"email-account" }                → IMAP/OAuth/Graph (/api/accounts/email)
//              { method:"server" }                       → se activa en el servidor (guía), sin flujo in-app
//   send     "simple" = envío de mensajería directo (target+texto): reply.sendReply lo despacha genérico desde su mapa SIMPLE_SENDERS.
//            Los canales con lógica de envío especial (email, whatsapp y demás salas del bridge) NO llevan `send` acá.
//   gate     variable(s) de entorno que habilitan el reader (informativo, para la guía/estado).

export const CHANNELS = {
  whatsapp:  { id: "whatsapp",  label: "WhatsApp",  brand: "#25d366", kind: "messaging", reader: "matrix",  connect: { method: "matrix-bridge", net: "whatsapp",  multi: true } },
  instagram: { id: "instagram", label: "Instagram", brand: "#e1306c", kind: "messaging", reader: "matrix",  connect: { method: "matrix-bridge", net: "instagram", multi: true } },
  facebook:  { id: "facebook",  label: "Facebook",  brand: "#1877f2", kind: "messaging", reader: "matrix",  connect: { method: "matrix-bridge", net: "facebook",  multi: true } },
  linkedin:  { id: "linkedin",  label: "LinkedIn",  brand: "#0a66c2", kind: "messaging", reader: "matrix",  connect: { method: "matrix-bridge", net: "linkedin",  multi: true } },
  discord:   { id: "discord",   label: "Discord",   brand: "#5865f2", kind: "messaging", reader: "matrix",  connect: { method: "matrix-token",  net: "discord" } },
  telegram:  { id: "telegram",  label: "Telegram",  brand: "#37aee2", kind: "messaging", reader: "telegram", connect: { method: "telegram-login" }, send: "simple" },
  slack:     { id: "slack",     label: "Slack",     brand: "#4a154b", kind: "messaging", reader: "slack",    connect: { method: "integration", provider: "slack",  fields: ["token"] },        gate: ["SLACK_TOKEN"],                     send: "simple" },
  signal:    { id: "signal",    label: "Signal",    brand: "#3a76f0", kind: "messaging", reader: "signal",   connect: { method: "integration", provider: "signal", fields: ["url", "number"] }, gate: ["SIGNAL_CLI_URL", "SIGNAL_NUMBER"], send: "simple" },
  email:     { id: "email",     label: "Email",     brand: "#ea4335", kind: "email",     reader: "mail-imap", connect: { method: "email-account" } },
  teams:     { id: "teams",     label: "Teams",     brand: "#5b5fc7", kind: "messaging", reader: "teams",    connect: { method: "server" }, send: "simple" },
  notion:    { id: "notion",    label: "Notion",    brand: "#111827", kind: "notes",     reader: "notion",   connect: { method: "server" } },
  calendar:  { id: "calendar",  label: "Calendar",  brand: "#6366f1", kind: "calendar",  reader: "google",   connect: { method: "server" } },
}

export const channelList = () => Object.values(CHANNELS)
export const getChannel = (id) => CHANNELS[String(id || "").toLowerCase()] || null
export const isChannel = (id) => !!getChannel(id)

// nets que el bot mautrix del server puede vincular por QR/código (connect.method === "matrix-bridge"). El endpoint /api/matrix-link
// valida contra esto → no se spawnea un login para una red inexistente/no soportada.
export const bridgeNets = () => channelList().filter((c) => c.connect?.method === "matrix-bridge").map((c) => c.connect.net)
export const tokenNets = () => channelList().filter((c) => c.connect?.method === "matrix-token").map((c) => c.connect.net)

// ids de los canales con envío SIMPLE (slack/signal/telegram/…) — reply.sendReply valida contra esto antes de despachar por SIMPLE_SENDERS.
export const isSimpleSender = (id) => getChannel(id)?.send === "simple"
// los mismos, como lista: threadTargets los usa para ofrecer destino en hilos que no son WhatsApp ni email.
export const sendableDirectChannels = () => channelList().filter((c) => c.send === "simple").map((c) => c.id)
export const channelLabel = (id) => getChannel(id)?.label || String(id || "")

// catálogo público (sin fns ni rutas de módulo) para que los clientes deriven labels/iconos/flujos de conexión de UN solo lugar.
export function channelCatalog() {
  return channelList().map((c) => ({
    id: c.id, label: c.label, brand: c.brand, kind: c.kind,
    connect: c.connect ? { method: c.connect.method, net: c.connect.net, provider: c.connect.provider, fields: c.connect.fields, multi: !!c.connect.multi } : null,
    canSend: !!c.send || c.kind === "email" || c.connect?.method === "matrix-bridge",
  }))
}
