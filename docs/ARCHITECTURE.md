# pipe.one — Arquitectura

Segundo cerebro / inbox unificado + AI-OS. Node 20 (vanilla `http`, sin framework) + SQLite (1.96M mensajes) + PWA vanilla-JS. Corre en un servidor headless (VPS), expuesto por Caddy (TLS + PIN) en `hub.example.com`.

## 1. Vista general (componentes)

```mermaid
flowchart TB
    subgraph Fuentes["📥 Fuentes (12+ canales)"]
        WA[WhatsApp x3<br/>bridge mautrix]
        UP[WhatsApp Unipile<br/>híbrido]
        EM[Email IMAP + Outlook Graph]
        TG[Telegram]; TE[Teams]; NO[Notion]
        GC[Google Calendar+Drive]; SP[SharePoint/OneDrive]; IG[Instagram/Messenger/Discord]
        CAL[Calendar Google+Outlook]; DR[Drive]
    end
    subgraph Readers["⚙️ Daemon: readers (auto-restart)"]
        MX[matrix.mjs]; MI[mail-imap.mjs]; MO[mail-outlook.mjs]
        TGR[telegram.mjs]; TER[teams.mjs]; NOR[notion.mjs]; GS[google-sync.mjs]
    end
    Fuentes --> Readers
    Readers -->|append| JSONL[(messages.jsonl<br/>log de eventos)]
    JSONL -->|ingest-db.mjs<br/>offset tracking| DB[(SQLite<br/>messages + thread_stats + FTS5)]
    DB --> BRAIN[brain.mjs<br/>capa de consulta]
    subgraph AI["🧠 IA"]
        LLM[llm.mjs<br/>router gemini/ollama/claude]
        RAG[rag-index + embed<br/>búsqueda semántica]
        WHISPER[whisper.cpp<br/>transcripción local]
        GRAPH[graphify → vault Obsidian]
        COACH[coach.mjs<br/>proactividad]
    end
    BRAIN <--> AI
    BRAIN --> API[server.mjs<br/>120 endpoints /api/*]
    API -->|auth PIN + TLS| CADDY[Caddy]
    CADDY --> SPA[public/app.js<br/>PWA]
    API -.túnel SSH.-> LOCAL[localhost:3000]
```

## 2. Flujo de un mensaje (ingesta → visible)

```mermaid
sequenceDiagram
    participant C as Contacto
    participant B as Bridge/IMAP
    participant R as Reader (daemon)
    participant J as messages.jsonl
    participant I as ingest-db
    participant DB as SQLite
    participant A as API/brain
    participant U as Vos (PWA)
    C->>B: manda mensaje
    B->>R: /sync (Matrix) / IDLE (IMAP)
    R->>J: append (con computeThread → thread key)
    Note over R: phoneOf() resuelve LID→número<br/>dmPeer detecta 1:1 vs grupo
    I->>J: lee desde offset
    I->>DB: insertMany (dedup por id) + thread_stats
    U->>A: GET /api/threads
    A->>DB: threadsSummary (cache 6s + warming)
    A->>U: bandeja unificada
```

## 3. Router de LLM (la "tercera vía")

```mermaid
flowchart LR
    T[Tarea] --> R{smartChain}
    R -->|vision/complex| CLOUD[gemini → openai → anthropic]
    R -->|sensible| LOCALF[ollama → gemini]
    R -->|simple| DEF{LLM_LOCAL_FIRST?}
    DEF -->|sí GPU A6000| LOCALF
    DEF -->|no CPU| CLOUD2[gemini → ollama]
    CLOUD --> METER[medidor /api/llm-usage]
    LOCALF --> METER
    CLOUD2 --> METER
    Note1[ollama encolado:<br/>semáforo 1 + timeout 90s<br/>→ nunca cuelga] -.-> LOCALF
```

## 4. Conceptos clave

| Concepto | Qué es | Dónde |
|---|---|---|
| **Thread key** | Clave determinística de conversación. WhatsApp 1:1 → por número; grupos → `@g.us`/`!room`; email → `email:<addr>`; self → `self`. | `lib/thread.mjs computeThread` |
| **thread_stats** | Índice denormalizado de hilos (last_ts, count, channels) → bandeja rápida. Auto-sanado si se vacía. | `lib/db.mjs`, `lib/maintenance.mjs` |
| **Espacios** | Agrupar contactos por reglas (email/dominio/teléfono/nombre), anidados, con catch-all. Match dinámico → retroactivo. | `lib/workspace.mjs`, `lib/brain.espacioView` |
| **Coach** | Cada 4h analiza señales (pendientes, promesas, preguntas, notas, importancia) → brief + foco + nudges. | `coach.mjs`, `lib/signals.mjs` |
| **Notetaker** | Graba calls en el cliente (Mac/Android), sube a `/api/meeting/ingest`, transcribe híbrido (whisper local si sensible / Gemini si no). | `lib/meetings.mjs`, `lib/whisper.mjs`, `agents/` |
| **Auth** | Local (túnel SSH sin XFF) = confiable; remoto (vía Caddy con XFF) = PIN scrypt + cookie token. | `lib/auth.mjs` |
| **Catch-up / ask** | Resumen multimodal de lo perdido + chat global RAG (semántico + FTS sobre 2M msgs). | `lib/brain.catchup / ask` |

## 5. Reglas de oro (aprendidas a los golpes)
- **Fire-and-forget** para crons; nunca loops paralelos pesados dentro del server.
- **Verificar el schema** (`src/lib/db.mjs`) antes de escribir SQL.
- **NO merges/correctores pesados con el server vivo** (SQLITE_BUSY) → función in-proceso o stop/start.
- **ollama en CPU cuelga** → todo lo interactivo va gemini-first; ollama encolado + timeout.
- **`j()` lee solo la cola** de archivos >200MB (messages.jsonl >1GB rompía con ERR_STRING_TOO_LONG).
- **Detrás de proxy** `remoteAddress` siempre es 127.0.0.1 → distinguir local/remoto por `X-Forwarded-For`.

## 6. Tests
- **Integración** (`test/integration.mjs`, 21+): contra el server vivo + DB. `node test/integration.mjs [--llm]`.
- **Unitarios** (`test/unit.mjs`): funciones puras (thread keys, router). `node --test test/unit.mjs`.
- **Referencia auto-generada**: `node scripts/gen-docs.mjs` → `docs/REFERENCE.md`.
- Todo junto: `node scripts/test-all.mjs`.
