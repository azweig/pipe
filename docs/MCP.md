# Pipe — conector MCP (Model Context Protocol)

Expone tu bandeja de Pipe a un cliente MCP (Claude Desktop, Claude Code, etc.) para que un asistente pueda **leer** tu inbox/hilos/pendientes y —si lo activás— **responder/reenviar con tu confirmación**. Transporte **stdio**, **sin dependencias**, **sin egress propio**. Lectura por defecto; escritura **opt-in**.

## Postura de privacidad y seguridad
- **El server no saca datos afuera.** Solo lee tu base local (`data/messages.db`). El ÚNICO punto por donde tus datos pueden salir es **el asistente que vos conectes** — si enchufás un LLM en la nube, los *resultados* de las tools van a ese LLM. Es tu decisión; el server nunca sale solo. (Verificado: 0 `fetch`/HTTP en `src/mcp/`.)
- **Escritura opt-in + confirmada.** Las tools de escritura están **apagadas por defecto** (least privilege): se activan arrancando el server con `MCP_ALLOW_WRITES=1`. Con eso, las acciones *outward* (`send_reply`/`forward_message`) piden **confirmación explícita** vía *elicitation* antes de ejecutar (si el cliente la soporta), además de la aprobación de tool-call del propio cliente.
- **Guard anti-exfiltración.** Solo se puede responder/reenviar a **hilos que YA existen** (contactos reales con los que ya hablás). Una injection no puede mandar tus datos a un número/persona arbitrario del atacante.
- **Anti prompt-injection / tool-poisoning.** El contenido de terceros se devuelve envuelto con `fence()` + nota de seguridad (`safety.mjs`) → el modelo lo trata como DATO, no como órdenes. Las descripciones de tools son estáticas (nunca derivadas de tus mensajes).
- **Auditable.** Cada llamada queda en `data/mcp-audit.jsonl` (tool, args, ok/error, bytes). Revisala cuando quieras.
- **Sin token passthrough, sin OAuth de terceros** (evita *confused deputy*): el server no proxea credenciales; usa la base local directamente.

## Tools
**Lectura (siempre disponibles):**
| Tool | Qué hace |
|---|---|
| `search_inbox(query, limit?)` | Busca por palabras clave en toda la bandeja (WhatsApp/email/Telegram/…) → mensajes crudos. |
| `get_thread(thread, limit?)` | Últimos mensajes de UNA conversación (por su clave de hilo). |
| `list_todos(limit?)` | Tareas y promesas pendientes, cada una con su cita textual. |

**Escritura (solo con `MCP_ALLOW_WRITES=1`):**
| Tool | Qué hace | Confirmación |
|---|---|---|
| `send_reply(thread, text)` | Responde a una conversación existente. | Sí (elicitation) |
| `forward_message(id, to_thread)` | Reenvía un mensaje (preserva media) a un hilo existente. | Sí (elicitation) |
| `create_todo(text, cuando?)` | Crea un pendiente. Local, reversible. | No (no sale afuera) |

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

Para habilitar escritura, agregá `"env": { "MCP_ALLOW_WRITES": "1" }` (junto con `MESSAGES_DB` si aplica) al bloque del server en tu config MCP. Para máxima seguridad, usá un cliente que soporte *elicitation* (Claude Desktop) → así cada envío pide confirmación explícita.

## Roadmap
- ~~**Fase 1**: read-only (search/get_thread/list_todos).~~ ✅
- ~~**Fase 2**: writes con confirmación (`send_reply`/`forward_message`/`create_todo`) vía *elicitation*.~~ ✅
- **Fase 3**: config OSS/privado + test de invariante (el server MCP no dispara egress).
- **Fase 4 (opcional)**: transporte HTTP para acceso remoto → OAuth 2.1 + PKCE + Resource Indicators (spec MCP 2025-11-25).
