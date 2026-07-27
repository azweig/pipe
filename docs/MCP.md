# Pipe — conector MCP (Model Context Protocol)

Expone tu bandeja de Pipe a un cliente MCP (Claude Desktop, Claude Code, etc.) para que un asistente pueda **leer** tu inbox, hilos y pendientes. Fase 1: **SOLO LECTURA**, transporte **stdio**, **sin dependencias** y **sin egress propio**.

## Postura de privacidad y seguridad
- **El server no saca datos afuera.** Solo lee tu base local (`data/messages.db`). El ÚNICO punto por donde tus datos pueden salir es **el asistente que vos conectes** — si enchufás un LLM en la nube, los *resultados* de las tools van a ese LLM. Es tu decisión; el server nunca sale solo. (Verificado: 0 `fetch`/HTTP en `src/mcp/`.)
- **Solo lectura.** No manda ni borra nada. Todo intento de write se rechaza (`-32603`). Los writes con confirmación (human-in-the-loop) son Fase 2.
- **Anti prompt-injection / tool-poisoning.** El contenido de terceros se devuelve envuelto con `fence()` + nota de seguridad (`safety.mjs`) → el modelo lo trata como DATO, no como órdenes. Las descripciones de tools son estáticas (nunca derivadas de tus mensajes).
- **Auditable.** Cada llamada queda en `data/mcp-audit.jsonl` (tool, args, ok/error, bytes). Revisala cuando quieras.
- **Sin token passthrough, sin OAuth de terceros** (evita *confused deputy*): el server no proxea credenciales; usa la base local directamente.

## Tools (Fase 1, read-only)
| Tool | Qué hace |
|---|---|
| `search_inbox(query, limit?)` | Busca por palabras clave en toda la bandeja (WhatsApp/email/Telegram/…) → mensajes crudos. |
| `get_thread(thread, limit?)` | Últimos mensajes de UNA conversación (por su clave de hilo). |
| `list_todos(limit?)` | Tareas y promesas pendientes, cada una con su cita textual. |

## Conectar

### A) Hub LOCAL (Pipe corre en tu misma máquina)
En `claude_desktop_config.json` (Claude Desktop) o el MCP config de tu cliente:
```json
{
  "mcpServers": {
    "pipe": {
      "command": "node",
      "args": ["/ruta/a/pipe/src/mcp/server.mjs"],
      "env": { "MESSAGES_DB": "/ruta/a/pipe/data/messages.db" }
    }
  }
}
```

### B) Hub REMOTO (Pipe corre en tu server) — stdio sobre SSH
No hace falta abrir ningún puerto: SSH tuneliza stdin/stdout, cifrado y ya autenticado por tu llave.
```json
{
  "mcpServers": {
    "pipe": {
      "command": "ssh",
      "args": ["-i", "/ruta/a/tu_llave", "usuario@TU_SERVER",
               "cd /opt/pipe && node src/mcp/server.mjs"]
    }
  }
}
```
> El proceso MCP corre DONDE está la base (el server), así los datos nunca viajan salvo por el canal SSH cifrado hacia tu cliente.

Reiniciá tu cliente MCP y preguntale, p.ej.: *"buscá en mi inbox qué me dijo Milagros de la factura"* o *"¿qué tareas tengo pendientes?"*.

## Node
Requiere **Node 20 LTS** (igual que el resto de Pipe). El server MCP no toca la red; solo la base SQLite local (lecturas concurrentes vía WAL, no bloquea al daemon).

## Roadmap
- **Fase 2**: writes con confirmación (`send_reply`, `forward_message`, `create_todo`) vía *elicitation* (el modelo propone, vos confirmás).
- **Fase 3**: config OSS/privado + tests de invariante (el server MCP no dispara egress).
- **Fase 4 (opcional)**: transporte HTTP para acceso remoto → ahí sí OAuth 2.1 + PKCE + Resource Indicators del spec MCP 2025-11-25.
