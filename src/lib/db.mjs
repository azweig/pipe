// Capa de datos SQLite para mensajes. FACHADA: re-exporta las named queries de los repos por dominio.
// El esquema y el handle viven en db-core.mjs. REGLA: el handle NUNCA cruza el seam (ver CONTEXT.md) →
// esta fachada NO re-exporta handle(). Los callers usan named queries; nadie corre SQL crudo fuera de la capa.
//
// Wave 6: `db()` (el handle crudo) fue ELIMINADO — el seam está CERRADO. Ningún consumidor corre SQL crudo.
// Los pocos accesos admin/one-off que necesitan el handle importan `handle` de db-core.mjs EXPLÍCITAMENTE
// (matrix backfills, lib/maintenance) — el handle no se re-exporta desde acá.

// named op de la capa de datos (ajuste de busy_timeout por-proceso). NO expone el handle.
export { setBusyTimeout } from "./db-core.mjs"

export * from "./threads-repo.mjs"
export * from "./search-repo.mjs"
export * from "./router-repo.mjs"
export * from "./meta-repo.mjs"
export * from "./ingest-repo.mjs"
export * from "./identity-repo.mjs"
export * from "./espacios-repo.mjs"
