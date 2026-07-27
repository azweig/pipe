// Registro DECLARATIVO de tools MCP (Fase 1: SOLO LECTURA). Cada tool es un wrapper delgado sobre la API que ya existe
// (search-repo / threads-repo / meta-repo). NO sintetiza con el LLM del hub → cero egress: devuelve datos crudos para que
// razone el CLIENTE MCP. Las descripciones son ESTÁTICAS y autoradas por nosotros (nunca derivadas de input → sin tool-poisoning).
import { search } from "../lib/search-repo.mjs"
import { threadMessagesTail } from "../lib/threads-repo.mjs"
import { listTodos, listPromesas } from "../lib/meta-repo.mjs"

const clip = (s, n = 500) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n)
// un mensaje → forma compacta y neutral (sin exponer jids crudos de más de lo necesario)
const fmtMsg = (m) => ({ thread: m.thread, from: m.dir === "out" ? "yo" : clip(m.name || m.jid || "?", 60), channel: m.channel, ts: m.ts, text: clip(m.text, 500) })
const cap = (n, max, def) => Math.min(+n || def, max)

export const TOOLS = [
  {
    name: "search_inbox",
    scope: "read",
    description: "Busca en TODA la bandeja unificada del usuario (WhatsApp, email, Telegram, etc.) por palabras clave y devuelve los mensajes que coinciden. SOLO LECTURA. Devuelve los mensajes crudos (no sintetiza) para que el asistente razone. Útil para responder '¿qué me dijo X?', '¿de qué hablé sobre Y?'.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "palabras clave a buscar (nombre, tema, término)" },
      limit: { type: "integer", description: "máximo de resultados (default 20, tope 50)" },
    }, required: ["query"] },
    handler: ({ query, limit } = {}) => {
      const rows = search(String(query || ""), { limit: cap(limit, 50, 20), byRank: true }).map(fmtMsg)
      return { query: clip(query, 120), count: rows.length, results: rows }
    },
  },
  {
    name: "get_thread",
    scope: "read",
    description: "Devuelve los últimos mensajes de UNA conversación por su clave de hilo (la que aparece en 'thread' de search_inbox, ej 'Milagros Núñez' o 'whatsapp:519...@s.whatsapp.net'). SOLO LECTURA.",
    inputSchema: { type: "object", properties: {
      thread: { type: "string", description: "clave del hilo (campo 'thread' de search_inbox)" },
      limit: { type: "integer", description: "cuántos mensajes recientes (default 30, tope 60)" },
    }, required: ["thread"] },
    handler: ({ thread, limit } = {}) => {
      const rows = threadMessagesTail(String(thread || ""), { limit: cap(limit, 60, 30) }).map(fmtMsg)
      return { thread: String(thread || ""), count: rows.length, messages: rows }
    },
  },
  {
    name: "list_todos",
    scope: "read",
    description: "Lista las tareas y promesas PENDIENTES del usuario (lo que le pidieron y lo que prometió), cada una con la CITA textual del mensaje que la respalda. SOLO LECTURA.",
    inputSchema: { type: "object", properties: {
      limit: { type: "integer", description: "máximo por lista (default 30, tope 50)" },
    } },
    handler: ({ limit } = {}) => {
      const n = cap(limit, 50, 30)
      return {
        todos: listTodos({ limit: n }).map((t) => ({ tarea: clip(t.text, 240), de: clip(t.name, 60), cuando: t.due || "", cita: clip(t.cita, 240) })),
        promesas: listPromesas({ limit: n }).map((p) => ({ promesa: clip(p.text, 240), con: clip(p.name, 60), cuando: p.due || "", cita: clip(p.cita, 240) })),
      }
    },
  },
]
