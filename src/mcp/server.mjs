// Server MCP (transporte stdio, SOLO LECTURA) — expone la bandeja de Pipe a un cliente MCP LOCAL (Claude Desktop/Code) en la
// MISMA máquina. NO agrega egress: el único lugar donde tus datos "salen" es el asistente que VOS conectes. Sin dependencias:
// JSON-RPC 2.0 delimitado por líneas sobre stdin/stdout. LOGS SOLO A stderr (stdout es el canal del protocolo — no ensuciarlo).
// Spec objetivo: MCP 2025-06-18 (negocia la versión que pida el cliente). Uso: node src/mcp/server.mjs
import { TOOLS } from "./tools.mjs"
import { fence, UNTRUSTED_NOTE } from "../lib/safety.mjs"
import { appendFileSync, mkdirSync } from "fs"

const PROTO = "2025-06-18"
const SERVER_INFO = { name: "pipe", title: "Pipe — bandeja unificada", version: "1.0.0" }
mkdirSync("./data", { recursive: true })
const AUDIT = "./data/mcp-audit.jsonl" // registro de TODA llamada (qué tool, qué args, ok/error) → auditable por el usuario
const log = (...a) => process.stderr.write("[mcp] " + a.join(" ") + "\n")
const audit = (rec) => { try { appendFileSync(AUDIT, JSON.stringify(rec) + "\n") } catch {} }

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n")
const reply = (id, result) => send({ jsonrpc: "2.0", id, result })
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } })

async function handle(msg) {
  const { id, method, params } = msg || {}
  if (method === "initialize") return reply(id, { protocolVersion: params?.protocolVersion || PROTO, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
  if (method === "notifications/initialized" || method === "notifications/cancelled") return // notificaciones: sin respuesta
  if (method === "ping") return reply(id, {})
  if (method === "tools/list") return reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
  if (method === "tools/call") {
    const t = TOOLS.find((x) => x.name === params?.name)
    if (!t) return fail(id, -32602, `tool desconocida: ${params?.name}`)
    if (t.scope !== "read") return fail(id, -32603, "este server MCP es SOLO LECTURA (Fase 1) — no ejecuta acciones") // guard duro anti-write
    const at = { ts: nowSafe(), tool: t.name, args: params?.arguments || {} }
    try {
      const data = await t.handler(params?.arguments || {})
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
    Promise.resolve(handle(msg)).catch((e) => log("handle:", e.message))
  }
})
process.stdin.on("end", () => process.exit(0))
log("pipe MCP (stdio · SOLO LECTURA) listo · tools: " + TOOLS.map((t) => t.name).join(", "))
