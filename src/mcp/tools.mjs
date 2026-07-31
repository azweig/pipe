// Registro DECLARATIVO de tools MCP (Fase 1: SOLO LECTURA). Cada tool es un wrapper delgado sobre la API que ya existe
// (search-repo / threads-repo / meta-repo). NO sintetiza con el LLM del hub → cero egress: devuelve datos crudos para que
// razone el CLIENTE MCP. Las descripciones son ESTÁTICAS y autoradas por nosotros (nunca derivadas de input → sin tool-poisoning).
import { search } from "../lib/search-repo.mjs"
import { threadMessagesTail } from "../lib/threads-repo.mjs"
import { listTodos, listPromesas, insertTodo } from "../lib/meta-repo.mjs"
import { sendReply, forwardMessages } from "../lib/brain.mjs"
import { createHash } from "crypto"

const clip = (s, n = 500) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n)
// un mensaje → forma compacta y neutral (incluye id para poder reenviar; sin exponer jids crudos de más)
const fmtMsg = (m) => ({ id: m.id, thread: m.thread, from: m.dir === "out" ? "yo" : clip(m.name || m.jid || "?", 60), channel: m.channel, ts: m.ts, text: clip(m.text, 500) })
const cap = (n, max, def) => Math.min(+n || def, max)
// GUARD anti-exfiltración: solo se puede escribir a un hilo que YA existe (una conversación real) → una injection no puede
// mandar datos a un número/persona arbitrario del atacante; solo a contactos con los que el usuario ya habla.
const threadExists = (thread) => threadMessagesTail(String(thread || ""), { limit: 1 }).length > 0

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
    description: "Devuelve los últimos mensajes de UNA conversación por su clave de hilo (la que aparece en 'thread' de search_inbox, ej 'Ana Pérez' o 'whatsapp:519...@s.whatsapp.net'). SOLO LECTURA.",
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

  // ───────── WRITES (Fase 2) — OFF salvo MCP_ALLOW_WRITES=1; los outward piden confirmación (elicitation) ─────────
  {
    name: "send_reply",
    scope: "write",
    description: "Envía una respuesta de texto a una conversación EXISTENTE (por su clave de hilo). Requiere confirmación del usuario. Solo se puede responder a hilos que ya existen (no a números nuevos arbitrarios).",
    inputSchema: { type: "object", properties: {
      thread: { type: "string", description: "clave del hilo destino (de search_inbox/get_thread)" },
      text: { type: "string", description: "el texto EXACTO a enviar" },
    }, required: ["thread", "text"] },
    confirm: (a) => `¿Enviar esta respuesta a «${clip(a.thread, 60)}»?\n\n${clip(a.text, 500)}`,
    handler: async ({ thread, text } = {}) => {
      thread = String(thread || ""); text = String(text || "").trim()
      if (text.length < 1) throw new Error("texto vacío")
      if (!threadExists(thread)) throw new Error("hilo inexistente — solo se puede responder a conversaciones que ya existen")
      const r = await sendReply(thread, text, {})
      if (!r || r.error) throw new Error((r && r.error) || "no se pudo enviar")
      return { ok: true, thread, channel: r.channel, enviado: clip(text, 300) }
    },
  },
  {
    name: "forward_message",
    scope: "write",
    description: "Reenvía un mensaje existente (por su id, de search_inbox/get_thread) a otra conversación EXISTENTE, preservando el media (audio/imagen). Requiere confirmación.",
    inputSchema: { type: "object", properties: {
      id: { type: "string", description: "id del mensaje a reenviar (campo 'id')" },
      to_thread: { type: "string", description: "clave del hilo destino" },
    }, required: ["id", "to_thread"] },
    confirm: (a) => `¿Reenviar el mensaje a «${clip(a.to_thread, 60)}»?`,
    handler: async ({ id, to_thread } = {}) => {
      to_thread = String(to_thread || "")
      if (!threadExists(to_thread)) throw new Error("hilo destino inexistente")
      const r = await forwardMessages([String(id || "")], to_thread)
      if (!r || r.error) throw new Error((r && r.error) || "no se pudo reenviar")
      return { ok: true, to: to_thread, sent: r.sent }
    },
  },
  {
    name: "create_todo",
    scope: "write",
    description: "Crea una tarea/recordatorio en tu lista de pendientes. Es LOCAL (no manda nada afuera) → no requiere confirmación.",
    inputSchema: { type: "object", properties: {
      text: { type: "string", description: "la tarea" },
      cuando: { type: "string", description: "plazo/fecha opcional" },
    }, required: ["text"] },
    // sin confirm: es local y reversible (marcar hecho / borrar)
    handler: ({ text, cuando } = {}) => {
      const txt = String(text || "").trim(); if (txt.length < 3) throw new Error("texto muy corto")
      const now = Date.now()
      const id = "todo:mcp:" + createHash("sha1").update(txt.toLowerCase()).digest("hex").slice(0, 16)
      insertTodo(id, txt.slice(0, 500), "self", "yo", String(cuando || "").slice(0, 40), now, now, null)
      return { ok: true, tarea: txt.slice(0, 300) }
    },
  },
]
