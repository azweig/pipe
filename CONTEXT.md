# CONTEXT — vocabulario de dominio

Nombres canónicos para los módulos y seams de pipe. Usá estos términos exactos en código,
commits y revisiones de arquitectura. Este archivo se creó en la Wave 0 del trabajo de "cerrar
el data seam" (privatizar el handle SQLite). Ver el reporte de arquitectura y los memos del audit
2026-07-13.

## La capa de datos (el data seam)

La capa de datos se organiza como una **fachada fina** (`db.mjs`) sobre un **core** y **repos por
dominio**. El objetivo es un módulo deep: mucho comportamiento detrás de una interfaz chica, con
el esquema encapsulado en un solo lugar.

### Regla del handle — **el handle nunca cruza el seam**

El handle de better-sqlite3 (la conexión SQLite) es privado de `db-core`. Ningún módulo fuera de
la capa de datos lo recibe, lo importa ni lo re-exporta. Los callers usan **named queries**; nunca
`db().prepare(...)` con SQL crudo. Concretamente:

- `db-core` posee el singleton del handle y lo entrega solo vía `handle()` **interno a los repos**.
- `db.mjs` **no** re-exporta `handle()`.
- El `export function db()` (handle crudo público) es transicional: existe durante la migración y
  se elimina al cerrar el seam (Wave 6). No agregar usos nuevos.

### Módulos

- **`db-core`** (`src/lib/db-core.mjs`) — dueño del handle SQLite + del esquema. Expone `initSchema`,
  `handle()` (interno), `configureDb`/`resetDb` (seam de tests) y `seed` (fixtures). Es el único
  lugar que construye conexiones a `messages.db`.
- **`initSchema(handle)`** — función pura con todo el DDL (tablas, índices, triggers FTS5, migraciones).
  Idempotente. La corren por igual prod (archivo) y los tests (`:memory:`) → un solo esquema, sin drift.
- **fachada `db.mjs`** — re-exporta las named queries de los repos. Los imports existentes
  (`import { threadsSummary } from './db.mjs'`) siguen válidos.

### Repos por dominio (destino de la migración; se materializan desde Wave 1)

Cada repo es un módulo deep que posee su slice del esquema y sus named queries. Ningún repo expone SQL.

- **`threads-repo`** — lecturas de conversación (resúmenes de bandeja, mensajes por hilo, paginado,
  conteos de no-leídos, targets de envío, media de un hilo).
- **`search-repo`** — búsqueda full-text (asunto vía `messages_fts`, cuerpo de emails vía `email_fts`)
  y la superficie RAG.
- **`router-repo`** — router por facetas + grafo ponderado (facetas, aristas del grafo, co-ocurrencia).
- **`meta-repo`** — KV (`meta`) y listas de acción (`todos`, `promesas`, `clips`). Los identificadores
  dinámicos de tabla se resuelven con **allowlist** (p. ej. `markDone(kind, id)` con `kind ∈ {todo, prom}`),
  nunca interpolando input.
- **`ingest-repo`** — camino de escritura (insertar mensajes, upsert de `thread_stats`, rebuilds).
- **`identity-repo`** — re-keying / merge / dedup / unificación de hilos (todo transaccional/atómico).
- **`espacios-repo`** — matching de mensajes por reglas de espacio (email/dominio/teléfono/nombre).

### Alcance

El seam cubre **solo `messages.db`** (la DB que `db-core` posee). La DB del **bridge Matrix**
(mautrix-whatsapp), abierta por `matrix.mjs`, `heartbeat.mjs`, `send-selftest.mjs`, `relink-media.mjs`
e `import-msgstore-db.mjs`, es una DB **foreign de solo lectura** y queda **fuera** de este seam
(seam separado opcional a futuro, si alguna vez molesta).

### Tests

El adapter in-memory es **SQLite `:memory:` real** con el mismo `initSchema` — no un fake JS.
Dos adapters justifican el seam: archivo en prod, `:memory:` en tests. Las characterization tests
(sembrar fixture → congelar output actual → migrar call-site → verificar) son la red de seguridad
de la migración y el primer suite real contra DB.
