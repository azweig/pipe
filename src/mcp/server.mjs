// Server MCP (transporte stdio, SOLO LECTURA) — expone la bandeja de Pipe a un cliente MCP LOCAL (Claude Desktop/Code) en la
// MISMA máquina. NO agrega egress: el único lugar donde tus datos "salen" es el asistente que VOS conectes. Sin dependencias:
// JSON-RPC 2.0 delimitado por líneas sobre stdin/stdout. LOGS SOLO A stderr (stdout es el canal del protocolo — no ensuciarlo).
// Spec objetivo: MCP 2025-06-18 (negocia la versión que pida el cliente). Uso: node src/mcp/server.mjs
import { TOOLS } from "./tools.mjs"
import { fence, UNTRUSTED_NOTE } from "../lib/safety.mjs"
import { appendFileSync, mkdirSync, readFileSync } from "fs"

// Config por-hub (data/mcp-config.json, gitignoreada). Permite al self-hoster DESHABILITAR tools y GATEAR las privadas.
// OSS: allowPrivate=false por defecto → las tools marcadas private:true NO se exponen. El hub privado la pone en true.
let CFG = {}; try { CFG = JSON.parse(readFileSync("./data/mcp-config.json", "utf8")) } catch {}
const DISABLED = new Set(CFG.disabled || [])
const ALLOW_PRIVATE = CFG.allowPrivate === true
// conjunto ACTIVO de tools (lo que realmente se lista y se puede llamar)
const ACTIVE = TOOLS.filter((t) => !DISABLED.has(t.name) && (!t.private || ALLOW_PRIVATE))

const PROTO = "2025-06-18"
const SERVER_INFO = { name: "pipe", title: "Pipe — bandeja unificada", version: "1.0.0" }
const WRITES_ON = process.env.MCP_ALLOW_WRITES === "1" // writes OFF por defecto (least privilege); se activan explícito
let clientCaps = {} // capacidades declaradas por el cliente en initialize (p.ej. si soporta elicitation)
mkdirSync("./data", { recursive: true })
const AUDIT = "./data/mcp-audit.jsonl" // registro de TODA llamada (qué tool, qué args, ok/error) → auditable por el usuario
const log = (...a) => process.stderr.write("[mcp] " + a.join(" ") + "\n")
const audit = (rec) => { try { appendFileSync(AUDIT, JSON.stringify(rec) + "\n") } catch {} }

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n")
const reply = (id, result) => send({ jsonrpc: "2.0", id, result })
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } })

// ── requests del SERVER hacia el cliente (para elicitation/confirmación) ──
const pending = new Map(); let reqSeq = 0
function serverRequest(mth, prms, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const rid = "srv-" + (++reqSeq)
    pending.set(rid, resolve)
    send({ jsonrpc: "2.0", id: rid, method: mth, params: prms })
    setTimeout(() => { if (pending.has(rid)) { pending.delete(rid); resolve(null) } }, timeoutMs) // sin respuesta → null (no confirmado)
  })
}
// human-in-the-loop: si el cliente soporta elicitation, PIDE confirmación explícita antes de una acción outward.
// Si no la soporta, se procede confiando en que el cliente ya aprueba cada tool-call (elicitation es defensa EXTRA).
async function confirmWithUser(message) {
  if (!clientCaps.elicitation) return true
  const r = await serverRequest("elicitation/create", { message, requestedSchema: { type: "object", properties: { confirm: { type: "boolean", description: "Sí para confirmar" } }, required: ["confirm"] } })
  return !!(r && r.action === "accept" && r.content && r.content.confirm === true)
}

async function handle(msg) {
  const { id, method, params } = msg || {}
  if (method === "initialize") { clientCaps = params?.capabilities || {}; return reply(id, { protocolVersion: params?.protocolVersion || PROTO, capabilities: { tools: {} }, serverInfo: SERVER_INFO }) }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return // notificaciones: sin respuesta
  if (method === "ping") return reply(id, {})
  if (method === "tools/list") return reply(id, { tools: ACTIVE.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
  if (method === "tools/call") {
    const t = ACTIVE.find((x) => x.name === params?.name)
    if (!t) return fail(id, -32602, `tool desconocida o deshabilitada: ${params?.name}`)
    const args = params?.arguments || {}
    const at = { ts: nowSafe(), tool: t.name, args }
    if (t.scope === "write") {
      if (!WRITES_ON) { audit({ ...at, ok: false, blocked: "writes-off" }); return fail(id, -32603, "writes deshabilitados — arrancá el server MCP con MCP_ALLOW_WRITES=1 para permitir enviar/reenviar/crear") }
      if (t.confirm) { // acciones outward (enviar/reenviar) requieren confirmación humana explícita
        const ok = await confirmWithUser(t.confirm(args))
        if (!ok) { audit({ ...at, ok: false, cancelled: true }); return reply(id, { content: [{ type: "text", text: "Acción cancelada: el usuario no la confirmó." }] }) }
      }
    }
    try {
      const data = await t.handler(args)
      audit({ ...at, ok: true, bytes: JSON.stringify(data).length })
      // El resultado lleva contenido de TERCEROS → se envuelve con la nota anti-injection + fence, así el modelo lo trata como DATO, no órdenes.
      const text = UNTRUSTED_NOTE + "\n\n" + fence(JSON.stringify(data, null, 1), "RESULTADO")
      return reply(id, { content: [{ type: "text", text }], structuredContent: data })
    } catch (e) {
      audit({ ...at, ok: false, error: e.message })
      return reply(id, { content: [{ type: "text", text: "error: " + e.message }], isError: true })
    }
  }
  if (id != null) fail(id, -32601, `método no soportado: ${method}`)
}
// Date.now() está bien acá (proceso normal, no un script de Workflow); envuelto por si algún runtime lo restringe.
function nowSafe() { try { return Date.now() } catch { return 0 } }

let buf = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
    if (!line) continue
    let msg; try { msg = JSON.parse(line) } catch { log("json inválido, ignorado"); continue }
    if (msg && msg.method) { Promise.resolve(handle(msg)).catch((e) => log("handle:", e.message)) } // request/notif del cliente
    else if (msg && msg.id != null && pending.has(msg.id)) { const r = pending.get(msg.id); pending.delete(msg.id); r(msg.error ? null : msg.result) } // respuesta a nuestro elicitation
  }
})
process.stdin.on("end", () => process.exit(0))
log(`pipe MCP (stdio) listo · writes=${WRITES_ON ? "ON" : "OFF"} · tools: ${ACTIVE.map((t) => t.name).join(", ")}`)
