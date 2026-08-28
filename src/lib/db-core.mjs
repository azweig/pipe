// db-core: dueño del handle SQLite y del esquema. El seam de datos.
// REGLA: el handle NUNCA cruza el seam. Vive privado acá; los repos lo obtienen vía handle() (interno),
// los callers usan named queries. En Wave 0 esto es andamiaje: solo lo usan los tests (:memory:).
// db.mjs sigue teniendo su db() intacto y comparte SOLO initSchema() con este módulo.
import Database from "better-sqlite3"

// initSchema(handle): función PURA con el mismo DDL que vivía dentro de db(). Idempotente
// (CREATE IF NOT EXISTS + PRAGMA table_info para migraciones). Corre igual sobre archivo o ':memory:'.
// Versión del esquema de abajo. ⚠️ SI TOCÁS initSchema, SUBÍ ESTE NÚMERO: si no, las bases que ya existen se
// saltean la migración y quedan viejas en silencio. `test/schema-version.mjs` falla si te olvidás.
export const SCHEMA_V = 4

export function initSchema(h) {
  // ATAJO: abrir una base YA inicializada no debe tomar WRITE-LOCK. Todo lo de abajo (CREATE IF NOT EXISTS, ALTER,
  // INSERT OR IGNORE) abre transacción de escritura aunque no cambie NADA, y con >20 procesos escribiendo la misma
  // base eso hacía morir jobs enteros en el propio open ("database is locked" antes de hacer una sola consulta).
  // Con la marca puesta, abrir es solo-lectura. Una base nueva o vieja no la tiene → corre todo y la deja marcada.
  try { if (h.prepare("SELECT v FROM meta WHERE k='schema_v'").get()?.v === String(SCHEMA_V)) return } catch {}
  h.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel TEXT, account TEXT, thread TEXT, jid TEXT,
      sender TEXT, name TEXT, text TEXT, ts INTEGER, dir TEXT,
      grp TEXT, media TEXT, mediaType TEXT, filename TEXT, unread INTEGER DEFAULT 0, body TEXT,
      rev INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_thread_ts ON messages(thread, ts);
    CREATE INDEX IF NOT EXISTS idx_ts ON messages(ts);
    CREATE INDEX IF NOT EXISTS idx_name ON messages(name);
    CREATE INDEX IF NOT EXISTS idx_channel ON messages(channel);
    CREATE INDEX IF NOT EXISTS idx_dir_thread ON messages(dir, thread);
    CREATE INDEX IF NOT EXISTS idx_thread_dir_ts ON messages(thread, dir, ts);
    CREATE INDEX IF NOT EXISTS idx_grp ON messages(grp) WHERE grp IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_media ON messages(media) WHERE media IS NOT NULL; -- 🔒 permite gatear un archivo del CAS por su RUTA (OCR, papelera, /cas/) sin barrer la tabla
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, name, content='messages', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, text, name) VALUES (new.rowid, new.text, new.name);
    END;
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    -- envíos ya procesados, por id que genera el CLIENTE. Es lo que hace seguro reintentar: si el 502 pasó DESPUÉS
    -- de que el mensaje saliera, el reintento encuentra su id acá y devuelve el resultado viejo en vez de mandar otra vez.
    CREATE TABLE IF NOT EXISTS sent_ids (id TEXT PRIMARY KEY, ts INTEGER, done INTEGER DEFAULT 0, result TEXT);
    CREATE INDEX IF NOT EXISTS idx_sent_ids_ts ON sent_ids(ts);
    -- texto extraído de los adjuntos (OCR para pdf/imagen, zip+XML para docx/xlsx). Clave = ruta del CAS, así el
    -- mismo contrato reenviado cinco veces se extrae UNA. La columna err marca lo que no se pudo, para no reintentar en vano.
    CREATE TABLE IF NOT EXISTS doc_text (media TEXT PRIMARY KEY, texto TEXT, chars INTEGER, ts INTEGER, err TEXT);
    CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, text TEXT, thread TEXT, name TEXT, due TEXT, ts INTEGER, done INTEGER DEFAULT 0, created INTEGER);
    CREATE TABLE IF NOT EXISTS promesas (id TEXT PRIMARY KEY, text TEXT, thread TEXT, name TEXT, due TEXT, ts INTEGER, done INTEGER DEFAULT 0, created INTEGER);
    CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, ts INTEGER, kind TEXT, url TEXT, title TEXT, para TEXT, done INTEGER DEFAULT 0, created INTEGER);
    CREATE TABLE IF NOT EXISTS note_meta (id TEXT PRIMARY KEY, category TEXT, title TEXT, status TEXT DEFAULT 'active', pinned INTEGER DEFAULT 0, ts INTEGER);
    -- historia diaria de KPIs (para deltas reales en la Home). Antes la creaba home-brief.mjs; el esquema es de db-core (fuente única).
    CREATE TABLE IF NOT EXISTS metrics (metric TEXT, day TEXT, value REAL, PRIMARY KEY(metric, day));
    -- Router por facetas (búsqueda barata): una fila por CONVERSACIÓN con tags/entidades/keywords pre-computados offline.
    CREATE TABLE IF NOT EXISTS conversations (
      thread TEXT PRIMARY KEY, name TEXT, channels TEXT,
      summary TEXT, entities TEXT, tags TEXT, keywords TEXT,
      n_msgs INTEGER, first_ts INTEGER, last_ts INTEGER,
      enriched_last_ts INTEGER DEFAULT 0, enriched_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_ts DESC);
    -- índice invertido: faceta -> hilo. El routing es un SELECT ... WHERE facet IN (...) (indexado, sin LLM).
    CREATE TABLE IF NOT EXISTS conv_facets (thread TEXT, kind TEXT, facet TEXT);
    CREATE INDEX IF NOT EXISTS idx_facet ON conv_facets(facet);
    CREATE INDEX IF NOT EXISTS idx_facet_thread ON conv_facets(thread);
    -- v2: grafo PONDERADO (tags con puntajes). node="kind:facet" (entity:juan pérez, topic:deuda). weight = frecuencia×idf sobre TODO el hilo (FTS), no solo el tail.
    CREATE TABLE IF NOT EXISTS graph_edges (node TEXT, thread TEXT, kind TEXT, weight REAL, PRIMARY KEY(node, thread));
    CREATE INDEX IF NOT EXISTS idx_ge_node ON graph_edges(node);
    CREATE INDEX IF NOT EXISTS idx_ge_thread ON graph_edges(thread);
    -- FTS sobre el CUERPO de los emails (el messages_fts principal solo indexa el asunto → los montos/fechas que viven en el body no eran buscables).
    CREATE VIRTUAL TABLE IF NOT EXISTS email_fts USING fts5(body);
    CREATE TRIGGER IF NOT EXISTS messages_body_ai AFTER INSERT ON messages WHEN new.body IS NOT NULL AND new.body != '' BEGIN
      INSERT INTO email_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
    -- external-content FTS necesita _ad/_au además de _ai: sin ellos, borrar/editar filas desincroniza el índice EN SILENCIO
    -- (el integrity-check pasa igual). Bug real reproducido: tras el dedup, un rowid REUSADO hacía que buscar "X" devolviera el mensaje de OTRO contacto.
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, name) VALUES('delete', old.rowid, old.text, old.name);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text, name ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, text, name) VALUES('delete', old.rowid, old.text, old.name);
      INSERT INTO messages_fts(rowid, text, name) VALUES (new.rowid, new.text, new.name);
    END;
    -- email_fts NO es external-content y el cuerpo llega por UPDATE (los emails entran sin body) → el _ai con WHEN body IS NOT NULL nunca lo indexaba.
    -- Sin estos, todo email backfilleado por cuerpo era inbuscable, y tras un dedup su rowid apuntaba a otra fila (cross-contamination).
    CREATE TRIGGER IF NOT EXISTS email_body_au AFTER UPDATE OF body ON messages BEGIN
      DELETE FROM email_fts WHERE rowid = old.rowid;
      INSERT INTO email_fts(rowid, body) SELECT new.rowid, new.body WHERE new.body IS NOT NULL AND new.body != '';
    END;
    CREATE TRIGGER IF NOT EXISTS email_body_ad AFTER DELETE ON messages BEGIN
      DELETE FROM email_fts WHERE rowid = old.rowid;
    END;
  `)
  // migración: columna body (cuerpo completo del email, HTML) + summary (pitch IA) para DBs existentes
  const mcols = h.prepare("PRAGMA table_info(messages)").all().map((c) => c.name)
  if (!mcols.includes("body")) h.exec("ALTER TABLE messages ADD COLUMN body TEXT")
  if (!mcols.includes("summary")) h.exec("ALTER TABLE messages ADD COLUMN summary TEXT")
  if (!mcols.includes("attachments")) h.exec("ALTER TABLE messages ADD COLUMN attachments TEXT") // JSON [{name,cas,mime,size}] — adjuntos de email (multi)
  // SYNC EDIT-AWARE: `rev` = revisión monotónica global por fila. Se estampa por TRIGGER en cada INSERT y cada UPDATE (cualquier
  // columna), así el cliente pide solo `rev > lastSeenRev` y recibe mensajes NUEVOS *y* editados (media backfilleada, resumen, etc.)
  // sin re-bajar todo. Contador en meta('msg_rev'). Los triggers se crean acá (post-ALTER) para que `rev` exista en DBs viejas.
  if (!mcols.includes("rev")) h.exec("ALTER TABLE messages ADD COLUMN rev INTEGER DEFAULT 0")
  h.exec(`
    INSERT OR IGNORE INTO meta(k, v) VALUES ('msg_rev', '0');
    CREATE INDEX IF NOT EXISTS idx_rev ON messages(rev);
    CREATE TRIGGER IF NOT EXISTS messages_rev_ai AFTER INSERT ON messages BEGIN
      UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k='msg_rev';
      UPDATE messages SET rev = (SELECT CAST(v AS INTEGER) FROM meta WHERE k='msg_rev') WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS messages_rev_au AFTER UPDATE ON messages WHEN NEW.rev = OLD.rev BEGIN
      UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k='msg_rev';
      UPDATE messages SET rev = (SELECT CAST(v AS INTEGER) FROM meta WHERE k='msg_rev') WHERE id = NEW.id;
    END;
  `)
  // migración: pin/archivo de clips (para priorizar/enfocar en Notas)
  const ccols = h.prepare("PRAGMA table_info(clips)").all().map((c) => c.name)
  if (!ccols.includes("pinned")) h.exec("ALTER TABLE clips ADD COLUMN pinned INTEGER DEFAULT 0")
  if (!ccols.includes("archived")) h.exec("ALTER TABLE clips ADD COLUMN archived INTEGER DEFAULT 0")
  // migración: categorización gráfica de notas (catkey→ícono), acciones detectadas (checklist JSON) y veredicto hoax/certeza (JSON)
  const ncols = h.prepare("PRAGMA table_info(note_meta)").all().map((c) => c.name)
  if (!ncols.includes("catkey")) h.exec("ALTER TABLE note_meta ADD COLUMN catkey TEXT")   // clave de categoría fija para el ícono (salud/receta/link/…)
  if (!ncols.includes("actions")) h.exec("ALTER TABLE note_meta ADD COLUMN actions TEXT")  // JSON [{texto,cuando,done}] — acciones detectadas por la IA
  if (!ncols.includes("verdict")) h.exec("ALTER TABLE note_meta ADD COLUMN verdict TEXT")  // JSON {nivel:hoax|dudoso|verificado, motivo} — solo para claims/noticias
  // source grounding: cita textual del mensaje que respalda cada tarea/promesa (anti-alucinación + trazabilidad). Nombres de tabla fijos (no input).
  for (const t of ["todos", "promesas"]) {
    const cols = h.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
    if (!cols.includes("cita")) h.exec(`ALTER TABLE ${t} ADD COLUMN cita TEXT`)
  }
  // resumen por hilo (derivado) — recrear si el esquema cambió
  // `tag`: marca de qué CLASE es el mensaje cuando no es una conversación normal. Hoy: "historia" (respuesta a un
  // estado de WhatsApp). Va como columna y no dentro del texto para que se pueda filtrar y mostrar distinto sin
  // ensuciar lo que escribiste.
  try { const mc = h.prepare("PRAGMA table_info(messages)").all().map((c) => c.name); if (!mc.includes("tag")) h.exec("ALTER TABLE messages ADD COLUMN tag TEXT") } catch {}
  const cols = h.prepare("PRAGMA table_info(thread_stats)").all().map((c) => c.name)
  if (!cols.includes("channels") || !cols.includes("nsenders")) h.exec("DROP TABLE IF EXISTS thread_stats")
  h.exec(`CREATE TABLE IF NOT EXISTS thread_stats (thread TEXT PRIMARY KEY, last_ts INTEGER, count INTEGER, unread INTEGER, channels TEXT, nsenders INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_stats_ts ON thread_stats(last_ts DESC);`)
  // marca de esquema al día → los próximos open no escriben nada
  try { h.prepare("INSERT INTO meta(k,v) VALUES('schema_v',?) ON CONFLICT(k) DO UPDATE SET v=?").run(String(SCHEMA_V), String(SCHEMA_V)) } catch {}
}

// reintento centralizado para ESCRITURAS ante SQLITE_BUSY (lock multi-proceso: server + ingest + crons compiten por el write-lock).
// Backoff LINEAL y SÍNCRONO (better-sqlite3 es sync → dormimos el thread con Atomics.wait, igual que replaceGraphEdges).
// Re-lanza cualquier error que NO sea BUSY/locked — NO traga. El seam lo habilita: un solo lugar para todas las writes.
const _isBusy = (e) => !!e && (e.code === "SQLITE_BUSY" || e.code === "SQLITE_BUSY_SNAPSHOT" || /database is locked|database table is locked/i.test(e.message || "")) // preciso: NO matchear "busy" suelto (evita reintentar errores ajenos)
export function withRetry(fn, { tries = 6, baseMs = 200 } = {}) {
  for (let i = 0; ; i++) {
    try { return fn() }
    catch (e) {
      if (!_isBusy(e) || i >= tries - 1) throw e // no-BUSY → re-lanza YA; reintentos agotados → re-lanza el último BUSY
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, baseMs * (i + 1)) // sleep síncrono con backoff lineal
    }
  }
}

// ── handle privado ──────────────────────────────────────────────────────────
let _db = null
let _path = process.env.MESSAGES_DB || "./data/messages.db"
const isFile = (p) => p !== ":memory:" && !String(p).startsWith("file::memory:")

// construye un handle con los MISMOS pragmas que db() (WAL/mmap solo si es archivo) + esquema.
function openDb(path) {
  const h = new Database(path)
  h.pragma("synchronous = NORMAL")
  // DEFAULT 15s (era 2s). En esta caja hay >20 procesos escribiendo la MISMA base y SQLite admite UN escritor:
  // con 2s, cualquier job que abría la base mientras otro escribía moría con "database is locked". No es un costo
  // fijo — es una espera MÁXIMA: si el lock se libera en 200ms, seguís en 200ms. Cinco jobs ya lo venían parcheando
  // a mano (8s/20s/30s) uno por uno; esto lo arregla para todos, incluido el momento de ABRIR (initSchema), que
  // ocurre ANTES de que setBusyTimeout pueda correr — por eso el autopiloto seguía cayéndose aunque pidiera 30s.
  h.pragma("busy_timeout = " + (+process.env.DB_BUSY_TIMEOUT_MS || 15000))
  if (isFile(path)) {
    try { h.pragma("journal_mode = WAL") } catch {}          // WAL requiere archivo
    try { h.pragma("mmap_size = 1073741824") } catch {}       // 1GB mapeado (no aplica a :memory:)
    // TAMAÑO DEL WAL: sin esto el archivo crece y NO se devuelve nunca. En prod llegó a 213 MB de espacio
    // reutilizable pero ocupado — con ~22 procesos conectados, un checkpoint casi nunca encuentra la ventana para
    // truncar. journal_size_limit le dice a SQLite que recorte el archivo tras cada checkpoint. 64 MB es holgado
    // para el ritmo de escritura de la ingesta y acota el desperdicio.
    try { h.pragma("journal_size_limit = " + (+process.env.DB_WAL_LIMIT_BYTES || 67108864)) } catch {}
  }
  try { h.pragma("cache_size = " + -(1024 * (+process.env.DB_CACHE_MB || 16))) } catch {} // cache PRIVADO por conexión. 16MB default: 64MB×~22 procesos (readers+crons) = 1.4GB reventaba el mem_limit del container (OOM→crash-loop). El server puede subirlo con DB_CACHE_MB.
  try { h.pragma("temp_store = MEMORY") } catch {}
  // initSchema hace ALTER/CREATE INDEX/CREATE TRIGGER → necesita WRITE-LOCK. Sin reintento, cualquier proceso que
  // abriera la base mientras otro escribía moría de entrada, ANTES de hacer nada (así se caían ingest y person-cards).
  // El busy_timeout ya está puesto arriba; esto agrega los reintentos con backoff para los picos de contención.
  withRetry(() => initSchema(h))
  try { h.pragma("optimize") } catch {}
  return h
}

// getter interno del singleton. NO se re-exporta desde db.mjs (el handle no cruza el seam).
export function handle() {
  if (!_db) _db = openDb(_path)
  return _db
}

// ajusta el busy_timeout del handle (algunos crons quieren más que el default). OJO: esto corre DESPUÉS de abrir
// la base, así que NO cubre initSchema — para eso está el default de arriba.
// Named op → el handle sigue privado. Sin try/catch interno: el caller lo envuelve como hacía con db().pragma(...).
export function setBusyTimeout(ms) {
  handle().pragma("busy_timeout = " + Number(ms))
}

// cambia el path y reabre (cierra el handle actual). Para tests: configureDb({ path: ':memory:' }).
export function configureDb({ path } = {}) {
  if (_db) { _db.close(); _db = null }
  if (path !== undefined) _path = path
  return handle()
}

// cierra y reabre una DB fresca. Default ':memory:' → cada test arranca aislado y vacío.
export function resetDb(path = ":memory:") {
  return configureDb({ path })
}

// ── seed de fixtures para tests ──────────────────────────────────────────────
// Inserta filas de `messages` (dispara el trigger de FTS por esquema). NO mantiene thread_stats:
// eso lo hace insertMany/rebuildStats del ingest-repo (Wave 1). Suficiente para caracterizar lecturas.
const SEED_COLS = ["id", "channel", "account", "thread", "jid", "sender", "name", "text", "ts", "dir", "grp", "media", "mediaType", "filename", "unread", "body", "summary", "attachments", "rev", "tag"]
function normSeed(r) {
  const ts = r.ts ?? 0
  return {
    id: r.id || `${r.channel || "x"}:${ts}:${String(r.name || "").slice(0, 12)}`,
    channel: r.channel || "", account: r.account || "", thread: r.thread || "", jid: r.jid || "",
    sender: r.sender || "", name: r.name || "", text: r.text || "", ts, dir: r.dir || "in",
    grp: r.grp ?? null, media: r.media ?? null, mediaType: r.mediaType ?? null, filename: r.filename ?? null,
    unread: r.unread ? 1 : 0, body: r.body ?? null, summary: r.summary ?? null, attachments: r.attachments ?? null, tag: r.tag ?? null,
    rev: r.rev ?? 0, // el trigger de sync-rev la re-stampa en el INSERT; el seed provee un valor para el guard de cobertura de columnas
  }
}
export function seed(rows = []) {
  const h = handle()
  const cols = SEED_COLS.join(", ")
  const vals = SEED_COLS.map((c) => "@" + c).join(", ")
  const stmt = h.prepare(`INSERT OR IGNORE INTO messages (${cols}) VALUES (${vals})`)
  const tx = h.transaction((rs) => { for (const r of rs) stmt.run(normSeed(r)) })
  tx(rows)
  return rows.length
}
