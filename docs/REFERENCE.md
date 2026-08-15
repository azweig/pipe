# pipe.one — Referencia técnica (AUTO-GENERADA)

> Generado por `node scripts/gen-docs.mjs`. **No editar a mano** — se regenera. Última corrida: (stamp al commitear).

## 🌐 API — 202 endpoints

| Método | Endpoint |
|---|---|
| GET | `/api/accounts` |
| POST | `/api/accounts/email` |
| POST | `/api/accounts/email/remove` |
| POST | `/api/action/done` |
| POST | `/api/add-email` |
| GET | `/api/agenda` |
| POST | `/api/apify/accounts` |
| GET | `/api/apify/accounts` |
| GET | `/api/ask` |
| GET | `/api/assistant` |
| POST | `/api/assistant` |
| POST | `/api/assistant/try` |
| POST | `/api/auth` |
| POST | `/api/auth/change-pin` |
| POST | `/api/auth/logout` |
| POST | `/api/auth/revoke-all` |
| POST | `/api/auth/setup` |
| GET | `/api/auth/status` |
| POST | `/api/autopilot/config` |
| GET | `/api/autopilot/config` |
| POST | `/api/autopilot/council` |
| GET | `/api/autopilot/council` |
| POST | `/api/autopilot/feedback` |
| GET | `/api/autopilot/log` |
| POST | `/api/autopilot/persona` |
| GET | `/api/autopilot/persona` |
| POST | `/api/autopilot/policy` |
| GET | `/api/autopilot/policy` |
| POST | `/api/autopilot/preview` |
| GET | `/api/autopilot/train-card` |
| POST | `/api/autopilot/voice` |
| GET | `/api/autopilot/voice` |
| GET | `/api/briefing` |
| GET | `/api/calendar` |
| POST | `/api/calendar/regen` |
| GET | `/api/channels` |
| GET | `/api/channels/catalog` |
| POST | `/api/clip/archive` |
| POST | `/api/clip/pin` |
| GET | `/api/coach` |
| POST | `/api/coach/action` |
| GET | `/api/coach/linkedin` |
| GET | `/api/coach/social` |
| GET | `/api/coach/social-highlights` |
| GET | `/api/coach/weekly` |
| GET | `/api/companies` |
| POST | `/api/company` |
| POST | `/api/company/delete` |
| POST | `/api/compose/correct` |
| GET | `/api/config` |
| POST | `/api/contact/archive` |
| POST | `/api/contact/category` |
| GET | `/api/contact/info` |
| POST | `/api/contact/investigate` |
| POST | `/api/contact/links` |
| POST | `/api/contact/merge` |
| POST | `/api/contact/photo` |
| POST | `/api/contact/pin` |
| GET | `/api/contact/profile` |
| POST | `/api/contact/silence` |
| GET | `/api/contact/social` |
| POST | `/api/contact/spam` |
| GET | `/api/contact/suggestions` |
| POST | `/api/contact/unmerge` |
| GET | `/api/conversation/channels` |
| POST | `/api/conversation/new` |
| POST | `/api/covert/config` |
| GET | `/api/covert/config` |
| POST | `/api/covert/preview` |
| GET | `/api/daily-plan` |
| GET | `/api/directory` |
| GET | `/api/email/body` |
| POST | `/api/espacio` |
| POST | `/api/espacio/delete` |
| POST | `/api/espacio/exception` |
| POST | `/api/espacio/exception/delete` |
| POST | `/api/espacio/rule` |
| POST | `/api/espacio/rule/delete` |
| GET | `/api/espacio/view` |
| GET | `/api/espacios` |
| POST | `/api/forward` |
| POST | `/api/gpu-health` |
| GET | `/api/groups` |
| POST | `/api/groups/assign` |
| POST | `/api/groups/auto` |
| POST | `/api/groups/delete` |
| POST | `/api/groups/save` |
| GET | `/api/health` |
| GET | `/api/home` |
| GET | `/api/home/audio` |
| POST | `/api/home/regen` |
| GET | `/api/hub-config` |
| POST | `/api/hub-config/save` |
| POST | `/api/import/whatsapp` |
| POST | `/api/import/whatsapp-zip` |
| POST | `/api/ingest/sms` |
| POST | `/api/integration/remove` |
| GET | `/api/integrations` |
| POST | `/api/integrations/signal` |
| POST | `/api/integrations/signal/remove` |
| POST | `/api/integrations/slack` |
| POST | `/api/integrations/slack/remove` |
| GET | `/api/llm-config` |
| POST | `/api/llm-config/save` |
| POST | `/api/llm-config/test` |
| GET | `/api/llm-usage` |
| POST | `/api/mail/backfill` |
| GET | `/api/mail/backfill/status` |
| POST | `/api/matrix-link` |
| POST | `/api/matrix-link-token` |
| GET | `/api/matrix-logins` |
| GET | `/api/matrix-qr` |
| GET | `/api/matrix-status` |
| GET | `/api/media-policy` |
| POST | `/api/media/free` |
| POST | `/api/media/restore` |
| POST | `/api/media/summarize` |
| GET | `/api/media/trash` |
| GET | `/api/meeting` |
| GET | `/api/meeting-prep` |
| POST | `/api/meeting/ingest` |
| POST | `/api/meeting/reprocess` |
| POST | `/api/notes/action` |
| POST | `/api/notes/categorize` |
| POST | `/api/notes/chat` |
| GET | `/api/notes/chat` |
| GET | `/api/notes/clips` |
| GET | `/api/notes/digest` |
| GET | `/api/notes/list` |
| POST | `/api/notes/regen` |
| GET | `/api/notif-prefs` |
| POST | `/api/notif-prefs/mute` |
| GET | `/api/oauth/google/configured` |
| POST | `/api/objetivo` |
| POST | `/api/objetivo/delete` |
| GET | `/api/objetivos` |
| GET | `/api/objetivos/suggest` |
| POST | `/api/ocr` |
| GET | `/api/onboarding` |
| GET | `/api/person` |
| GET | `/api/person` |
| GET | `/api/person/full` |
| POST | `/api/push/subscribe` |
| POST | `/api/push/test` |
| POST | `/api/push/unsubscribe` |
| GET | `/api/push/vapid` |
| GET | `/api/reply` |
| POST | `/api/resync` |
| GET | `/api/router-search` |
| POST | `/api/schedule/create` |
| POST | `/api/schedule/delete` |
| POST | `/api/schedule/move` |
| GET | `/api/search` |
| POST | `/api/secret/account` |
| GET | `/api/secret/accounts` |
| POST | `/api/secret/lock` |
| POST | `/api/secret/setup` |
| GET | `/api/secret/state` |
| GET | `/api/secret/status` |
| POST | `/api/secret/unlock` |
| POST | `/api/secret/wa` |
| GET | `/api/selftest` |
| POST | `/api/selftest` |
| POST | `/api/send` |
| POST | `/api/send-audio` |
| POST | `/api/send-media` |
| POST | `/api/send-sticker` |
| POST | `/api/signature` |
| GET | `/api/signatures` |
| POST | `/api/social/ingest` |
| POST | `/api/social/mystyle` |
| POST | `/api/spam/unmark` |
| GET | `/api/status` |
| GET | `/api/stt` |
| GET | `/api/summary` |
| GET | `/api/sync-status` |
| POST | `/api/telegram/code` |
| POST | `/api/telegram/connected` |
| POST | `/api/telegram/password` |
| POST | `/api/telegram/start` |
| GET | `/api/telegram/status` |
| GET | `/api/thread` |
| GET | `/api/thread` |
| GET | `/api/thread/catchup` |
| GET | `/api/thread/delta` |
| GET | `/api/thread/media` |
| GET | `/api/thread/meetings` |
| GET | `/api/thread/schedule` |
| POST | `/api/thread/seen` |
| GET | `/api/thread/suggest-reply` |
| GET | `/api/thread/summarize` |
| GET | `/api/thread/sync` |
| GET | `/api/thread/targets` |
| GET | `/api/threads` |
| GET | `/api/tts` |
| GET | `/api/unread` |
| POST | `/api/voices` |
| GET | `/api/voices` |
| GET | `/api/wa-qr` |
| GET | `/api/wa-status` |
| GET | `/api/wa/status` |
| POST | `/api/webhook/kofi` |

## 🗄️ Base de datos (SQLite)

**Tablas:** 

**Columnas migradas:** —

**Índices:**


## ⚙️ Daemon (supervisor)

**Readers (auto-restart):**
- telegram `src/telegram.mjs`
- teams `src/teams.mjs`
- mail-outlook `src/mail-outlook.mjs`
- calendar-outlook `src/calendar-outlook.mjs`
- mail-imap `src/mail-imap.mjs`
- google `src/google-sync.mjs`
- files-sharepoint `src/files-sharepoint.mjs`
- notion `src/notion.mjs`
- matrix `src/matrix.mjs`
- unipile `src/unipile.mjs`
- slack `src/slack.mjs`
- signal `src/signal.mjs`
- web `src/server.mjs`

**Jobs periódicos:**
- runGraphify — cada GRAPHIFY_MIN * 60000
- runCoach — cada 4 * 3600000
- runVaultSync — cada 20 * 60000
- runIngest — cada 15000
- runVideoFetch — cada 4 * 60000
- runAutopilot — cada 60000
- runAssistant — cada 60000
- runFeeds — cada 20 * 60000
- runEmbedWatchdog — cada 5 * 60000
- runBridgeSync — cada 6 * 3600000
- runBridgePortals — cada 20 * 60000
- runHomeBrief — cada 6 * 3600000
- runCalendarPrep — cada 2 * 3600000
- runPersonCards — cada 6 * 3600000
- runEspacioCards — cada 4 * 60000
- runEnrich — cada ENRICH_MIN * 60000
- runBuildGraph — cada GRAPH_MIN * 60000
- runCasGc — cada 24 * 3600000
- runDriveRecordings — cada 5 * 60000
- runEmailSum — cada 3 * 60000
- runAudioSummary — cada 2 * 60000
- runExtract — cada 10 * 60000
- runWarmCorrect — cada 8 * 60000
- runNotesAi — cada 3 * 3600000
- runNotesCategorize — cada 5 * 60000
- runClips — cada 4 * 60000
- runRecordings — cada 60000
- runMaintain — cada 30 * 60000
- runResolve — cada 20 * 60000
- runSpamClassify — cada 12 * 60000
- runRagIndex — cada 10 * 60000
- runLearn — cada 6 * 3600000
- runHeartbeat — cada 3600000
- runSelfTest — cada SELFTEST_HOURS * 3600000
- runRsvp — cada 30 * 60000
- runMsgPush — cada 2 * 60000
- runSocialDaily — cada 2 * 3600000

## 📦 Módulos (146) y sus exports

### `src/audio-summarize.mjs`
- **mimeFor** *(fn)* — mime real según la extensión del archivo en CAS (no todos los audios son .ogg: iOS/adjuntos vienen .m4a, etc). Sin esto, mandar un .m4a etiquetado como audio/ogg hace que OpenAI Wh
- **audioSummaryPrompt** *(fn)* — prompt de resumen de nota de voz: fiel, que SE ENTIENDA sin escuchar, largo ADAPTATIVO (no aplastar el contenido).
- **summarizeBatch** *(async)* — resume un lote de audios (id+media) con STT + el prompt adaptativo. Reutilizable (cron + backfills). Devuelve #hechos.

### `src/clips.mjs`
- **URL_RE** *(const)*
- **clipKind** *(fn)* — tipo de clip derivado del mensaje (sin LLM)

### `src/drive-google.mjs`
- **getContent** *(async)* — lee el contenido de un archivo (export de Google Docs a texto, o descarga directa)

### `src/home-brief.mjs`
- **generateHomeBrief** *(async)*

### `src/lib/accounts.mjs`
- **guessHost** *(fn)* — servidor IMAP sugerido por el dominio del correo
- **listAccounts** *(fn)* — cuentas conectadas + actividad real (de la DB) → sin exponer contraseñas
- **addEmailAccount** *(async)* — valida credenciales conectándose por IMAP; si andan, guarda la cuenta. El reader mail-imap se reconecta y la ingesta arranca.
- **saveGmailOAuth** *(fn)* — guarda una cuenta Gmail conectada por OAuth (refresh token CIFRADO). El reader mail-imap la usa por XOAUTH2 (nada de app-passwords).
- **removeEmailAccount** *(fn)*

### `src/lib/apify.mjs`
- **apifyAccounts** *(fn)* — ── cuentas (tokens CIFRADOS en reposo; la UI nunca ve el token en claro, solo los últimos 4) ──
- **addApifyAccount** *(fn)*
- **removeApifyAccount** *(fn)*
- **setApifyActors** *(fn)*
- **hasApify** *(fn)*
- **runActor** *(async)* — ROUND-ROBIN + failover: salta cuentas agotadas este mes; si una da error de cuota la marca y sigue con la siguiente.
- **investigateProfiles** *(async)* — ── enriquecer: corre los actors de los links que el usuario pegó; devuelve la data cruda por plataforma (+ errores) ──

### `src/lib/auth.mjs`
- **pinIsSet** *(fn)*
- **setPin** *(fn)* — setear/cambiar el PIN (6-12 dígitos). scrypt es lento a propósito → frena fuerza bruta offline si roban el archivo. Mínimo 6 (no 4): en un endpoint expuesto a internet, 10⁴ es brut
- **changePin** *(fn)* — cambiar el PIN desde adentro (ya autenticado): exige el PIN actual → nadie con una sesión robada lo cambia sin saberlo.
- **verifyPin** *(fn)*
- **rateLimitedScoped** *(const)* — Mismo limitador, contadores SEPARADOS por ámbito: lo usa el 2º PIN (secret.mjs), que no tenía ninguno — con la sesión principal en mano, 6 dígitos sin freno se rompen a fuerza brut
- **recordFailScoped** *(const)*
- **clearFailsScoped** *(const)*
- **__resetLimits** *(fn)* — para los tests: limpiar TODO el estado de rate-limit en memoria (per-IP + global) entre casos
- **login** *(fn)*
- **validSession** *(fn)*
- **logout** *(fn)*
- **sessionCount** *(fn)* — cuántas sesiones activas (para mostrar "N dispositivos vinculados")
- **logoutAll** *(fn)* — REVOCAR TODO: cierra sesión en TODOS los dispositivos (si perdés/robaron un celu). Invalida cada token guardado.
- **logoutOthers** *(fn)* — cierra TODAS las sesiones MENOS la actual (para changePin: revoca dispositivos viejos sin desloguear a quien hace el cambio)

### `src/lib/briefing.mjs`
- **getConfig** *(fn)*
- **setConfig** *(fn)*
- **detectLocation** *(async)* — ubicación: detecta por IP (una vez), cacheada en config. Se puede sobreescribir (geo del browser).
- **weather** *(async)*
- **news** *(async)*
- **buildBriefing** *(async)*
- **dailyPlan** *(async)* — resumen humano de la mañana + plan del día, alrededor de la rutina real de ${ownerFirst()}

### `src/lib/calendar.mjs`
- **createGoogleEvent** *(async)* — ── Google Meet ──
- **deleteGoogleEvent** *(async)*
- **createOutlookEvent** *(async)*
- **deleteOutlookEvent** *(async)*
- **createEvent** *(async)* — ── unificado ──
- **moveGoogleEvent** *(async)* — reprogramar: mueve un evento a una nueva fecha/hora (para "movamos la reu al jueves")
- **upcomingMeetings** *(async)* — PRÓXIMAS reuniones que YO organicé, con el estado de confirmación (RSVP) de cada invitado. Para los recordatorios.
- **upcomingWith** *(async)* — próximas reuniones CON un contacto (por su email), las organice yo o él. Para la tarjeta en el chat.

### `src/lib/cas.mjs`
- **casPathOf** *(fn)* — ruta en disco de un blob (por hash) — para que los optimizadores trabajen sobre el archivo sin pasar por Buffers gigantes
- **casPendingOptimize** *(fn)* — blobs todavía SIN pasar por el optimizador, del tipo pedido y por encima de un mínimo de tamaño (los chiquitos no pagan el CPU)
- **casMarkOptimized** *(fn)* — registra el resultado. `opt`='none'/'skip' marca "ya lo intenté, no re-procesar" (así el runner converge y no gira en falso).
- **casPendingPhash** *(fn)* — blobs sin huella perceptual todavía (para el detector de casi-duplicados)
- **casSetPhash** *(fn)*
- **casPhashGroups** *(fn)* — grupos de blobs que comparten huella perceptual EXACTA = misma imagen re-codificada por otro canal (el dedup por contenido no los ve)
- **casOptimizeStats** *(fn)* — resumen de lo que el optimizador ya recuperó
- **casPutBuffer** *(fn)* — guarda un Buffer y devuelve la ruta pública /cas/xx/<hash><ext>. Dedup por contenido; el ext es CANÓNICO (el del primer put) para que N callers con ext distinto referencien el MISM
- **casRegister** *(fn)* — registra en el índice un archivo YA colocado en el CAS (tools que mueven archivos directo, ej. dedup-media). Devuelve el pub canónico.
- **casUrlByHash** *(fn)* — ruta pública de un hash (para tools de import que mapean file_hash → URL del CAS).
- **casReadBuffer** *(fn)* — lee un blob por su ruta pública (/cas/xx/<hash><ext>) → Buffer, o null si no está. Para inlinear imágenes de email como data: URI.
- **casDelete** *(fn)* — borra un blob por su ruta pública → libera disco. El caller decide la seguridad (que nadie lo referencie). Devuelve bytes liberados.
- **casTrash** *(fn)* — ── PAPELERA (soft-delete con 30 días de "deshacer") ───────────────────────────────────────────── SOFT-DELETE → papelera. NO libera disco (el blob queda para deshacer). Guarda cómo
- **casRestore** *(fn)* — DESHACER: saca el blob de la papelera y devuelve los mensajes a re-vincular.
- **casTrashList** *(fn)* — contenido de la papelera para la UI (más reciente primero) + cuándo se purga cada uno.
- **casGC** *(fn)* — GC: manda a papelera los blobs que NINGÚN mensaje vivo referencia, y RESCATA los que volvieron a estar vivos. livePubs = set de rutas vivas.
- **casPurge** *(fn)* — PURGE: borra de verdad (libera disco) lo que lleva > TRASH_TTL en papelera, PERO re-verifica vivo primero (no borra media re-referenciada).
- **casStats** *(fn)*

### `src/lib/channels.mjs`
- **CHANNELS** *(const)*
- **channelList** *(const)*
- **getChannel** *(const)*
- **isChannel** *(const)*
- **bridgeNets** *(const)* — nets que el bot mautrix del server puede vincular por QR/código (connect.method === "matrix-bridge"). El endpoint /api/matrix-link valida contra esto → no se spawnea un login para 
- **tokenNets** *(const)*
- **isSimpleSender** *(const)* — ids de los canales con envío SIMPLE (slack/signal/telegram/…) — reply.sendReply valida contra esto antes de despachar por SIMPLE_SENDERS.
- **sendableDirectChannels** *(const)* — los mismos, como lista: threadTargets los usa para ofrecer destino en hilos que no son WhatsApp ni email.
- **channelLabel** *(const)*
- **channelCatalog** *(fn)* — catálogo público (sin fns ni rutas de módulo) para que los clientes deriven labels/iconos/flujos de conexión de UN solo lugar.

### `src/lib/covertext.mjs`
- **styles** *(fn)*
- **encodeCovert** *(fn)* — ── codificar: texto plano + passphrase + estilo → texto tapadera ───────────────────────────────────────────────────────────
- **decodeCovert** *(fn)* — ── decodificar: texto tapadera + passphrase → { text, style } | null ─────────────────────────────────────────────────────── Style-agnóstico: prueba cada gramática; la que produzca

### `src/lib/db-core.mjs`
- **initSchema** *(fn)* — initSchema(handle): función PURA con el mismo DDL que vivía dentro de db(). Idempotente (CREATE IF NOT EXISTS + PRAGMA table_info para migraciones). Corre igual sobre archivo o ':m
- **withRetry** *(fn)*
- **handle** *(fn)* — getter interno del singleton. NO se re-exporta desde db.mjs (el handle no cruza el seam).
- **setBusyTimeout** *(fn)* — ajusta el busy_timeout del handle (algunos crons quieren más/menos que el default de 20s según su workload). Named op → el handle sigue privado. Sin try/catch interno: el caller lo
- **configureDb** *(fn)* — cambia el path y reabre (cierra el handle actual). Para tests: configureDb({ path: ':memory:' }).
- **resetDb** *(fn)* — cierra y reabre una DB fresca. Default ':memory:' → cada test arranca aislado y vacío.
- **seed** *(fn)*

### `src/lib/email-inline.mjs`
- **inlineCidImages** *(fn)*

### `src/lib/embed.mjs`
- **embed** *(async)*
- **cosine** *(fn)*
- **topK** *(fn)* — top-K por similitud coseno contra un índice [{...,vec}]

### `src/lib/env.mjs`
- **loadEnv** *(fn)*

### `src/lib/espacios-repo.mjs`
- **espacioMessages** *(fn)* — mensajes que matchean las reglas de un espacio: email exacto, dominio (@colegio.edu.pe), teléfono, o nombre. matchea mensajes por reglas (email/dominio/teléfono/nombre) DINÁMICAMEN

### `src/lib/google.mjs`
- **SCOPES** *(const)*
- **googleAccounts** *(fn)*
- **hasToken** *(fn)*
- **oauthClient** *(fn)*
- **authorizeAccount** *(async)* — autoriza una cuenta (flujo loopback). Devuelve la URL primero (para compartir), luego espera el código.
- **GMAIL_SCOPES** *(const)* — ══ Gmail vía OAuth WEB — el flujo "app normal": "Conectar Gmail → Permitir" en el navegador (nada de app-passwords) ══ Scope full-mailbox (https://mail.google.com/) → habilita IMAP
- **googleConfigured** *(fn)*
- **gmailAuthUrl** *(fn)* — URL de consentimiento (el usuario va a Google y aprueba). state = anti-CSRF.
- **exchangeGmailCode** *(async)* — canjea el ?code= por tokens + resuelve el email de la cuenta conectada
- **gmailAccessToken** *(async)* — dado un refresh_token, devuelve un access_token FRESCO (para IMAP/SMTP XOAUTH2; expiran ~1h)

### `src/lib/grounding.mjs`
- **stripP** *(const)* — —— todos/promesas: normaliza sacando TODA la puntuación ——
- **wordsOf** *(const)*
- **grounded** *(fn)* — ¿la cita está REALMENTE en el texto? substring normalizado, o ≥70% de sus palabras presentes (tolera parafraseo mínimo del LLM).
- **gstrip** *(const)* — —— graphify: normaliza CONSERVANDO @._- (dominios de email / canales) ——
- **anchored** *(fn)* — ¿la entidad tiene ANCLA textual? nombre completo, o alguna palabra significativa (apellido, dominio) presente en el lote.

### `src/lib/groups.mjs`
- **listGroups** *(fn)* — lista de grupos resuelta para la UI (auto con overrides + custom), en orden.
- **contactGroupsMap** *(fn)* — mapa key→[groupIds custom] para el cliente (así el filtro por tab es client-side)
- **setAutoGroup** *(fn)* — renombrar/ocultar un auto-grupo
- **saveGroup** *(fn)* — crear / renombrar grupo custom
- **deleteGroup** *(fn)*
- **assignContact** *(fn)* — asignar / quitar un contacto (por thread key) de un grupo custom

### `src/lib/http-gate.mjs`
- **localFlags** *(fn)* — Local (túnel SSH: conexión directa a 127.0.0.1 SIN X-Forwarded-For) = confiable → sin PIN. Remoto (vía Caddy: llega como 127.0.0.1 PERO con X-Forwarded-For) = requiere PIN. isLocal
- **clientIpFrom** *(fn)* — IP real del cliente para rate-limit: Caddy ANEXA el IP verdadero al FINAL del XFF (el cliente solo spoofea los del principio) → tomar el último.
- **csrfReason** *(fn)* — CSRF / drive-by: aplica a TODO /api salvo status/health (lectura pura). Cross-site (Sec-Fetch-Site≠same-origin/none) u Origin≠Host → bloquea. A PROPÓSITO no mira el método: hay GET
- **hostAllowed** *(fn)* — Host allowlist (anti DNS-rebinding). Solo activa si TRUSTED_HOSTS está seteado. localhost/127 siempre pasan (túnel).

### `src/lib/hub.mjs`
- **owner** *(const)*
- **ownerFirst** *(const)*
- **company** *(const)*
- **myNumbers** *(const)*
- **myEmails** *(const)*
- **tz** *(const)*
- **hubDomain** *(const)*
- **tzOffset** *(fn)* — offset UTC actual de la tz configurada, formato "-05:00" (para parsear datetimes naive de Outlook/calendario)
- **hubConfig** *(fn)*
- **setHubConfig** *(fn)*

### `src/lib/identity-repo.mjs`
- **safeName** *(fn)* — nombre de agenda de un número SOLO si es ÚNICO (no homónimo): si el mismo nombre está en 2+ números, keyear por nombre fusionaría personas DISTINTAS en un hilo → responderías al eq
- **rekeyContacts** *(fn)* — re-etiqueta hilos WhatsApp 1:1 (número) → nombre del contacto, para unificar con bridge/email. Devuelve #hilos migrados.
- **rekeyEmails** *(fn)* — re-etiqueta TODOS los emails por la dirección del contraparte (email:<addr>), salvo los cubiertos por reglas manuales. Arregla los merges erróneos del grafo (emails de gente distin
- **rekeyBridge** *(fn)* — re-etiqueta mensajes del BRIDGE (matrix) 1:1 por el número del sender (@whatsapp_<num>) → nombre de contacto. NO toca grupos.
- **dedupMessages** *(fn)* — DEDUP: el mismo mensaje capturado por varias fuentes (2+ teléfonos, bridge viejo) → aparece repetido. Mismo (thread, ts, dir, contenido) = mismo mensaje. Se queda con el mejor (con
- **unifyByNumber** *(fn)* — CORRIDA: unifica TODOS los hilos 1:1 de WhatsApp que compartan el mismo número real (jid, sender del bridge, o LID→número). Devuelve {grupos, hilosFusionados, mensajesMovidos}. NO 
- **mergeThreads** *(fn)* — fusiona hilos: mueve todos los mensajes de <sources[]> al hilo <target>. Para "es la misma persona".
- **rekeyManual** *(fn)* — re-etiqueta hilos 1:1 según identidades manuales. NUNCA toca grupos (matchea por JID de la conversación, no por sender).

### `src/lib/ingest-repo.mjs`
- **insertMany** *(fn)*
- **insertSent** *(fn)* — inserta un mensaje ENVIADO por mí (dir:out) directo en el hilo dado (sin pasar por computeThread). Para el compositor.
- **rebuildStats** *(fn)* — reconstruye thread_stats desde cero (después de un import masivo). ATÓMICO: DELETE+INSERT en UNA transacción. Si el proceso muere en el medio → rollback → conserva los datos viejos
- **setVideoMedia** *(fn)* — ── escrituras de enriquecimiento absorbidas en Wave 3 (UPDATE de contenido de un mensaje) ── linkea el video descargado a un mensaje, SOLO si aún no tenía media. Devuelve el info (
- **setMessageSummary** *(fn)* — guarda el resumen (STT) de un audio. (era audio-summarize)
- **updateMessageContent** *(fn)* — actualiza texto/cuerpo/resumen de un mensaje (transcripción de reunión). Faltantes → null (como el original). (era meetings.updateMeeting)
- **linkMediaBatch** *(fn)* — backfill: vincula media a mensajes que aún no la tienen, en UNA transacción. Devuelve #cambios. (era relink-media)
- **insertSocialDigest** *(fn)* — inserta el digest de un feed social (mensaje entrante + upsert de thread_stats) ATÓMICO. (era brain.ingestSocial)
- **freeThreadMedia** *(fn)* — LIBERAR ESPACIO: borra la media PESADA (no audio) ya guardada de un chat (threadKey), o de TODA la cuenta (threadKey=null). Deja el mensaje con placeholder "(borrada)". El blob del
- **restoreMedia** *(fn)* — DESHACER un borrado de media: restaura el blob de la papelera y re-vincula los mensajes afectados.
- **liveMediaPaths** *(fn)* — rutas /cas/ referenciadas por algún mensaje vivo → para que el GC sepa qué blobs son huérfanos.

### `src/lib/integrations.mjs`
- **getSlackToken** *(fn)* — —— acceso DESCIFRADO, solo para los readers ——
- **getSignal** *(fn)*
- **getIntegrations** *(fn)* — —— estado ENMASCARADO para la UI (nunca devuelve el token) ——
- **setSlack** *(async)* — —— Slack: valida el token con auth.test ANTES de guardar (falla rápido si es inválido) ——
- **removeSlack** *(fn)*
- **setSignal** *(fn)* — —— Signal: guarda la URL de signal-cli-rest-api (en tu server) + tu número ——
- **removeSignal** *(fn)*

### `src/lib/intents.mjs`
- **detectSchedule** *(fn)* — Devuelve la fecha como COMPONENTES (year/month/day/hour/minute), no como instante UTC: el evento se crea después con timeZone explícito → evita el clásico bug de timezone (el owner
- **parsePhrase** *(fn)* — parsea una frase de fecha/hora (español) → componentes. Reusado por el detector LLM.
- **hasWeakSignal** *(fn)*
- **detectScheduleLLM** *(async)* — DETECTOR LLM (para frases relacionadas que el regex no agarra, ej: "tenés tiempo el martes?"). llmFn(convoTexto, refISO) → debe devolver { scheduling, when, time, durationMin, topi

### `src/lib/jsonl.mjs`
- **tailJsonl** *(fn)* — TAIL: parsea solo los últimos maxBytes → objetos. Para "actividad reciente". La 1ª línea puede venir cortada (empieza a mitad de línea) → JSON.parse falla y se descarta, sin proble
- **streamJsonl** *(async)* — STREAM: recorre TODO el archivo línea por línea sin cargarlo entero. Para reindexado incremental.

### `src/lib/kofi.mjs`
- **notifyNewSubscription** *(async)*

### `src/lib/linkmask.mjs`
- **URL_RE** *(const)* — Protección de LINKS para la corrección de texto: los enlaces NUNCA se corrigen. El LLM podría meterles espacios, "arreglar" el dominio o romper los query params, así que:  - si el 
- **maskLinks** *(const)*
- **unmaskLinks** *(const)*
- **isOnlyLinks** *(const)*

### `src/lib/llm.mjs`
- **gestionadoModels** *(async)* — modelos disponibles en el motor gestionado (GPU box, /api/tags de ollama vía gateway) → para armar el council desde la app
- **visionLLM** *(async)* — VISIÓN: lee/entiende imágenes (para emails que son pura imagen). Gemini 2.5 Flash → OpenAI gpt-4o-mini. Hook Mistral OCR: si algún día hay MISTRAL_API_KEY, se puede anteponer /v1/o
- **llmConfigMasked** *(fn)* — ── CONFIG BYOK expuesta a la app (Configuración → Motor de IA) ──
- **testKey** *(async)* — PROBAR una key puntual: ping mínimo → si responde, anda. Incluye ollama (usa el host).
- **providerKey** *(fn)*
- **sttMode** *(fn)* — Transcripción de audio: "local" (whisper en tu máquina) por DEFECTO. Antes era "openai", así que en un hub con key de OpenAI CADA nota de voz recibida se subía a la nube automática
- **setLlmConfig** *(fn)*
- **cloudOverCap** *(fn)*
- **trackDaily** *(fn)*
- **usageStats** *(fn)*
- **SENSITIVE_FEATURES** *(const)* — ── ROUTER ("la tercera vía"): elige la cadena según la DIFICULTAD/PRIVACIDAD de la tarea. Local para lo simple/privado, nube para lo pesado. En este box ollama es CPU (lento) → sim
- **featureWantsCloud** *(fn)* — ¿esta feature va a la nube? DEFAULT local (privacidad). Con feature: manda la config del hub (UI). Sin feature (legacy/headless): el switch global SENSITIVE_ALLOW_CLOUD. Nunca fail
- **smartChain** *(fn)*
- **llm** *(async)*
- **geminiUploadFile** *(async)* — ── MULTIMODAL (Gemini nativo): ve imágenes, LEE documentos/PDF, ESCUCHA audios y procesa VIDEO CON AUDIO ── Sube un archivo local a la Files API de Gemini y espera a que esté ACTIV
- **geminiMultimodal** *(async)* — Genera texto a partir de prompt + partes multimodales. `media` = array de { text } | { mime, data(base64) } | { mime, uri }. SOLO Gemini (es el único con audio+video nativo por API

### `src/lib/lock.mjs`
- **withLock** *(fn)* — corre fn() con el lock EXCLUSIVO tomado. Si NO se pudo tomar tras ~3s → FALLA-CERRADO (throw). El modo de falla correcto para un read-modify-write compartido (cas-index, append) es
- **appendMessage** *(fn)* — append SERIALIZADO a messages.jsonl → sin interleave entre lectores. Reintenta ante contención (el append es rápido, resuelve en ms); tras agotar, tira con log VISIBLE en vez de co

### `src/lib/mail-archive.mjs`
- **archiveThreadOnServer** *(async)* — archiva (on=true) o restaura (on=false) en el buzón real todos los emails recibidos del hilo. Idempotente y no-fatal.

### `src/lib/mailer.mjs`
- **sendEmail** *(async)* — Envío TRANSACCIONAL genérico (no-reply): notificaciones del sistema (ej. suscripción Ko-fi). fromName = display, replyTo opcional.
- **sendEmailReply** *(async)* — RESPUESTA a un hilo de email: usa el SMTP de la cuenta que recibió el hilo (Gmail, Mailcow, lo que sea). Un correo NO es un mensaje de texto: va con FIRMA, con parte HTML (para que

### `src/lib/maintenance.mjs`
- **ensureStats** *(fn)* — AUTO-SANADO: si thread_stats quedó vacío (race/interrupción de un rebuild) pero hay mensajes → reconstruir. Evita que la bandeja aparezca vacía. Corre al arrancar y en el mantenimi
- **fixGroupLeaks** *(fn)* — Corrector de HILOS-FANTASMA: mensajes de grupo (grp seteado) que quedaron en un hilo que NO es del grupo (DM falso por número, o hilo de persona) → moverlos al hilo real del grupo 

### `src/lib/media-optimize.mjs`
- **IMG_LOSSLESS** *(const)*
- **VIDEO_EXTS** *(const)*
- **optimizerFor** *(fn)* — argumentos del optimizador para (entrada → salida). null = no hay optimizador para ese tipo.
- **acceptResult** *(fn)* — ¿Aceptamos el resultado? Reglas duras — ante la duda, se queda el original.  - tiene que existir y pesar algo,  - tiene que ser MÁS CHICO con margen real (si gana <3%, no vale re-e
- **pct** *(const)*
- **mb** *(const)*

### `src/lib/media-policy.mjs`
- **getMediaPolicy** *(fn)*
- **setMediaDefault** *(fn)*
- **setThreadMediaPolicy** *(fn)*
- **threadMediaMode** *(fn)* — modo efectivo de un chat ("store"|"skip"), considerando override del chat → default de la cuenta.
- **shouldStoreMedia** *(fn)* — ¿bajar/guardar la media de este mensaje? El audio/llamada nunca se descarta. El resto sigue la política del chat.

### `src/lib/media-trust.mjs`
- **destinoConfiable** *(fn)*
- **MOTIVO_NO_CONFIABLE** *(const)* — mensaje único para explicar por qué no se procesó (se muestra tal cual en la app)

### `src/lib/meetings.mjs`
- **isSensitiveMeeting** *(fn)*
- **matchCalendarEvent** *(fn)*
- **summarizeMeeting** *(async)*
- **ingestRecording** *(async)* — ── ingesta: guarda audio en CAS, crea el hilo (placeholder), y procesa en background (fire-and-forget, 1 job por reunión) ──
- **reprocessMeeting** *(async)* — reprocesar (debug/reintento)

### `src/lib/meta-repo.mjs`
- **clipFlag** *(fn)* — pin/archivo de un clip (por id del mensaje self). Crea la fila de clip si no existía (aún sin enriquecer).
- **getMeta** *(fn)*
- **delMeta** *(fn)*
- **delMetaLike** *(fn)* — borra por PREFIJO (personcard:/mtgcard:/espcard:). El prefijo es literal (sin comodines del dominio) → no escapamos.
- **setMeta** *(fn)*
- **count** *(fn)*
- **clipCandidates** *(fn)* — ── clips absorbidos en Wave 3 ── mensajes de 'self' que aún no tienen fila en clips (candidatos a enriquecer). (era clips.run)
- **insertClip** *(fn)* — inserta un clip enriquecido (idempotente por id, OR IGNORE). archived=1 oculta spam/sin-sentido. (era clips.run)
- **insertTodo** *(fn)* — tarea nueva (lo que me pidieron / quedó de mi lado). Idempotente por id (OR IGNORE). (era extract-actions)
- **insertPromesa** *(fn)* — promesa nueva (lo que YO me comprometí a hacer). Idempotente por id. (era extract-actions)
- **listTodos** *(fn)* — listados de PENDIENTES (para el server MCP read-only). Solo lo no-hecho, con la cita textual que respalda cada ítem.
- **listPromesas** *(fn)*
- **openActionItems** *(fn)* — ítems abiertos (done=0) de todos|promesas. kind por allowlist. Defensivo (nunca tira). (era home-brief.openActions)
- **markDone** *(fn)*
- **upsertMetric** *(fn)* — upsert de una métrica diaria (historia de KPIs). (era home-brief.recordMetric)
- **metricHistory** *(fn)* — historia reciente de una métrica (más nuevas primero). (era home-brief.deltaOf)
- **clipsForNotes** *(fn)* — clips de 'self' filtrados por tipo, paginados hacia atrás. (era brain.notesClips) El mapeo a la vista queda en brain.
- **pinnedNotesClips** *(fn)* — clips fijados (self, no archivados) para mostrar arriba. (era brain.notesClips)

### `src/lib/ocr.mjs`
- **ocrEnabled** *(fn)*
- **ocrUrlActual** *(const)*
- **ocrCas** *(async)* — OCR de un archivo del CAS (/cas/xx/hash.ext) → texto plano. "" si está deshabilitado, no existe, o falla.

### `src/lib/onboarding.mjs`
- **calcularOnboarding** *(fn)* — Checklist de primer arranque: conectá WhatsApp · agregá tu correo · elegí tu IA.  Vivía SÓLO en el cliente web, con 4 llamadas y las reglas de "está conectado" escritas ahí. El esc

### `src/lib/phash.mjs`
- **dhashFromGray9x8** *(fn)* — dhash a partir del raw gris de 9x8 (72 bytes) que escupe ffmpeg. PURA: sin ffmpeg ni disco, testeable.
- **isDegenerateHash** *(fn)* — Huella DEGENERADA = sin poder discriminativo. Una imagen plana (un fotograma negro, un fondo liso) da todos los píxeles iguales → 0000…/ffff… . Dos videos que arrancan en negro dar
- **hamming** *(fn)* — distancia de Hamming entre dos huellas hex (0 = idénticas). ≤5 sobre 64 bits ya es "la misma imagen".
- **PHASH_EXTS** *(const)* — ¿vale la pena huellar esto? Solo imagen/video: un PDF o un zip no tienen "parecido visual".
- **isVideoExt** *(const)*
- **ffmpegPhashArgs** *(fn)* — comando ffmpeg para sacar el raw 9x8 gris. En video se toma un fotograma ~1s adentro (el 0 suele ser negro).

### `src/lib/push.mjs`
- **vapidPublic** *(const)*
- **subscribe** *(fn)*
- **unsubscribe** *(fn)*
- **subCount** *(fn)*
- **sendPush** *(async)* — manda una notificación a TODOS los dispositivos suscritos. Limpia las suscripciones muertas (410/404).

### `src/lib/quota.mjs`
- **storageStatus** *(fn)* — estado cacheado 60s: casStats parsea el índice del CAS → no leerlo en cada mensaje entrante.
- **storageOverQuota** *(fn)* — ¿pasó el límite del plan? → el gate de media deja de guardar lo pesado nuevo (soft-enforce, tolerancia de ~60s por el cache).

### `src/lib/research.mjs`
- **linkedinProfile** *(async)* — perfil de LinkedIn (vía el reader Python, con la cookie). Búsqueda/perfiles funcionan aunque la mensajería no.
- **hasWebSearch** *(fn)*
- **webSearch** *(async)*
- **newsSearch** *(async)* — NOTICIAS con fecha + fuente + imagen (Serper /news) — para "Para vos" en la home. `gl`/`hl` sesgan a LATAM/español.
- **researchEntity** *(async)* — perfil resumido de una persona (o empresa) desde la web, orientado a una reunión

### `src/lib/router-repo.mjs`
- **staleConversations** *(fn)* — hilos que necesitan (re)enriquecerse: nuevos, o con mensajes más nuevos que el último enriquecimiento. Los más activos primero.
- **saveConversation** *(fn)* — guarda el enriquecimiento de una conversación + reconstruye sus facetas (entidad/tag/keyword, expandiendo palabras).
- **facetThreads** *(fn)* — devuelve las filas {thread,kind,facet} que matchean EXACTO alguna de las facetas candidatas (indexado).
- **conversationsByThreads** *(fn)*
- **convStats** *(fn)*
- **pruneOrphanConversations** *(fn)* — PODA de conversaciones HUÉRFANAS: filas de conversations/conv_facets cuyo thread ya no tiene mensajes (quedaron tras un re-key que movió los mensajes a otro hilo). thread_stats se 
- **graphVocabulary** *(fn)* — ── GRAFO PONDERADO v2 (tags con puntajes por grafo + activación por difusión) ──
- **replaceGraphEdges** *(fn)*
- **graphEdgesFor** *(fn)*
- **graphCoNodes** *(fn)* — 2º salto: nodos que CO-OCURREN con las semillas (Juan ↔ deuda) → energía se propaga a más contenido
- **graphStats** *(fn)*

### `src/lib/router.mjs`
- **queryFacets** *(fn)* — tokens (3+) + bigramas de la consulta → candidatos a faceta (para pescar "via cargo", "juan pérez", etc.)
- **parseIntent** *(fn)* — tipo de intención: BUSCAR (traer media/docs, sin LLM) vs PREGUNTA (sintetizar respuesta).
- **route** *(fn)* — enruta: puntúa conversaciones por facetas matcheadas (poda: se queda con las mejores). Confiado solo si hay entidad/tag claros.
- **activate** *(fn)*

### `src/lib/safety.mjs`
- **UNTRUSTED_NOTE** *(const)*
- **fence** *(fn)* — Envuelve contenido no confiable en delimitadores claros para que el modelo distinga dato de instrucción.
- **harden** *(fn)* — Agrega la nota de seguridad a un system prompt existente.

### `src/lib/search-repo.mjs`
- **mediaInThreads** *(fn)* — mensajes con media/adjunto dentro de un set de hilos (para intents "buscar memes / documentos").
- **ftsDocFreq** *(fn)*
- **ftsThreadCounts** *(fn)*
- **rebuildEmailFts** *(fn)* — (re)construye el índice FTS de cuerpos de email. Se corre tras un backfill (que actualiza bodies de filas existentes → el trigger de INSERT no los cubre).
- **searchBody** *(fn)* — busca en el CUERPO de los emails (donde viven montos/fechas). Devuelve mensajes con un snippet del match.
- **bodyMatchInThreads** *(fn)* — cuerpos de email (donde viven montos/fechas, fuera del FTS) en los hilos ruteados que contengan alguno de los términos. terms se expanden con la co-ocurrencia del grafo (juan→deuda
- **filesByTerms** *(fn)* — archivos/media que están en los hilos ruteados O cuyo nombre/texto contiene alguno de los términos (para "docs de globex" en toda la DB).
- **search** *(fn)* — OJO: filtra lo secreto. Era el ÚNICO lector de corpus sin filtro (threads-repo y meta-repo sí lo hacen), y el conector MCP lo usa para search_inbox: un cliente MCP preguntando cual
- **allForRag** *(fn)* — corpus completo para reindexar. 🔒 Filtra los canales secretos en el ORIGEN: lo que entre acá termina vectorizado y saliendo en respuestas de IA, donde ya no hay forma de distingui
- **rebuildMessagesFts** *(fn)* — reconstruye el índice FTS de asuntos/nombres (external-content: el trigger solo cubre INSERT, no UPDATE). (era meetings.updateMeeting) Wave 3.

### `src/lib/secret-vault.mjs`
- **objetivosSecretos** *(fn)* — A quién hay que tapar: los NOMBRES de los hilos secretos (así se llaman las notas) + los identificadores crudos. El identity-map (canal → nombre canónico, el que usa graphify para 
- **esNotaSecreta** *(fn)* — ¿esta nota es de una cuenta secreta? La nota TRATA de esa persona (su título es su nombre) o contiene su identificador.  Lo que NO se hace: buscar el nombre como substring del cuer
- **cuarentenaVault** *(fn)* — mueve a cuarentena toda nota del vault que mencione una cuenta secreta. Devuelve las rutas relativas movidas.
- **restaurarVault** *(fn)* — devuelve al vault lo que ya NO menciona ninguna cuenta secreta (desmarcaste el número/la cuenta).
- **purgarRagDeNotas** *(fn)* — saca del índice semántico las líneas de las notas que se fueron a cuarentena. El índice guarda `ref` = ruta de la nota sin el .md. No hace falta tocar las líneas de MENSAJES: ésas 
- **estadoCuarentena** *(fn)* — tamaño de la cuarentena, para poder decirlo en la UI/logs sin revelar QUÉ hay adentro

### `src/lib/secret.mjs`
- **secretMarksBroken** *(fn)*
- **secretPinSet** *(fn)* — ── 2º PIN ──
- **setSecretPin** *(fn)* — setear/cambiar el 2º PIN. Exige 6-12 dígitos (igual que el principal) y que sea DISTINTO del PIN de entrada (si no, no aísla nada). `oldPin` es OBLIGATORIO si ya hay un PIN puesto.
- **verifySecretPin** *(fn)*
- **clearSecretPin** *(fn)* — borrar el 2º PIN (lo usa el flujo de reset y al desactivar la función). También cierra TODAS las sesiones secretas.
- **unlockSecret** *(fn)* — `ip` para el rate-limit. No tenía NINGUNO: con la sesión principal ya abierta (que es justo el escenario que esta función existe para cubrir), 6 dígitos sin freno se rompen a fuerz
- **validSecretSession** *(fn)*
- **lockSecret** *(fn)*
- **lockAllSecret** *(fn)*
- **listSecretAccounts** *(fn)*
- **isSecretAccount** *(fn)* — ¿este (channel, account) de un mensaje cae en una cuenta secreta? (exacto O comodín de red channel:*)
- **setSecretAccount** *(fn)*
- **secretAccountSet** *(fn)*
- **secretKey** *(const)*
- **listSecretNumbers** *(fn)*
- **isSecretNumber** *(fn)*
- **setSecretNumber** *(fn)*
- **secretGate** *(fn)*
- **secretThreadKeys** *(fn)* — hilos que se ocultan ENTEROS (100% secretos). Los parciales NO están acá (se muestran filtrados por-mensaje).
- **isSecretMsg** *(fn)* — ¿ESTE mensaje es secreto? por CANAL: email de cuenta secreta, o WhatsApp de sala secreta, o import sin dueño en un hilo con canal secreto de WA.
- **isSecretRow** *(fn)* — helper de conveniencia para superficies DERIVADAS (home/coach/search/people/espacios): ¿este row es de fuente secreta? Cubre hilo 100%-secreto (thread en hide) Y mensaje parcial (i
- **isSecretSelfNote** *(fn)* — ESTRICTO para "Mis Notas" (thread='self', hilo mezcla de todos tus números): oculta una nota SOLO si ESE mensaje vino de un canal secreto (jid de número secreto o email de cuenta s
- **secretSelfClause** *(fn)* — fragmento SQL "ESTE row (alias.jid / alias.channel+account) es de canal secreto", para excluir self-notes secretas en agregados (categorías, conteos) sin traer columnas extra a JS.
- **secretMsgExcludeSql** *(fn)* — fragmento SQL para EXCLUIR mensajes secretos en agregados cross-hilo (espacios): jid de número secreto, email de cuenta secreta, o hilo 100%-secreto. Sin la rama import/waSecretThr
- **secretJsonlIndeciso** *(fn)* — ¿alguna vez, en este proceso, NO se pudo decidir? Ojo: no alcanza con mirar secretGate(), porque computeThread lee sus propios mapas de contactos y un JSON roto ahí tira una excepc
- **isSecretJsonl** *(fn)*
- **secretUnread** *(fn)* — no-leídos de hilos 100% secretos (para restar del contador). Los parciales no se restan (over-count menor, no filtra contenido).

### `src/lib/secrets.mjs`
- **isEncrypted** *(fn)*
- **encSecret** *(fn)*
- **decSecret** *(fn)*

### `src/lib/signals.mjs`
- **promises** *(fn)*
- **unansweredQuestions** *(fn)* — ── #3 PREGUNTAS SIN RESPONDER: el ÚLTIMO mensaje del hilo es entrante y tiene "?" ──
- **waitingOnThem** *(fn)* — ── #4 BOLA EN SU CANCHA: vos escribiste último y no te respondieron (reinsistir) ──
- **pendingReplies** *(fn)* — PENDIENTES DE RESPUESTA: hilos cuyo ÚLTIMO mensaje es entrante (esperan tu respuesta). DB, no el JSONL gigante.
- **recentNotes** *(fn)* — ── #1 NOTAS: cosas que te mandaste a Mis Notas (para que el coach extraiga TODOs/ideas) ──
- **importanceMap** *(fn)* — ── #14 IMPORTANCIA: score por tags del vault (inversor/cliente/familia > amigo) → rankear ──

### `src/lib/signature.mjs`
- **listSignatures** *(fn)*
- **getSignature** *(fn)*
- **setSignature** *(fn)*
- **defaultSignature** *(fn)* — Firma por defecto: sobria y sin inventar datos. Solo lo que el hub SABE (nombre y, si hay, empresa).
- **textToHtml** *(fn)* — texto plano → HTML seguro (escapado, saltos de línea respetados, links clicables)
- **composeEmailBody** *(fn)*
- **looksSigned** *(fn)* — ¿el texto ya termina con una firma escrita a mano? Evita la firma duplicada cuando pegás una respuesta completa.

### `src/lib/sources.mjs`
- **isCurrentAffairs** *(const)*
- **DEFAULT_LOCALES** *(const)* — ── PAÍSES ──────────────────────────────────────────────────────────────────────────────────────── Serper sesga por país (gl) e idioma (hl). Una sola consulta a Perú se pierde noti
- **dedupeByTitle** *(fn)*
- **newsMulti** *(async)*
- **redditSearch** *(async)* — ── REDDIT (API pública, sin credenciales) ──────────────────────────────────────────────────────── Aporta lo que la prensa no: hilos de gente contando lo que pasa. `t` acota la ven
- **DEFAULT_FEEDS** *(const)* — Arranque razonable si no configuraste nada: agencias e internacionales en español e inglés.
- **listFeeds** *(fn)*
- **saveFeeds** *(fn)*
- **parseFeed** *(fn)*
- **feedMatches** *(fn)*
- **feedCache** *(fn)*
- **refreshFeeds** *(async)*
- **rssSearch** *(async)*
- **gatherCurrent** *(async)*

### `src/lib/spam.mjs`
- **manyLinks** *(const)* — señal ESTRUCTURAL clave (agnóstica de idioma/marca): un envío promocional pone VARIOS links, casi siempre al MISMO dominio (ej. Plaud: 3× plaud.ai). Un amigo que comparte "mirá est
- **isSpam** *(fn)* — ¿este mensaje parece marketing/promoción (no correspondencia personal)? jid+name ayudan con el remitente. Capa 1: ESTRUCTURAL (barata, sincrónica). Resuelve la mayoría sin costo.
- **llmSpam** *(fn)*
- **notSpam** *(fn)*
- **setNotSpam** *(fn)*
- **threadIsSpam** *(fn)* — spam DEFINITIVO para un hilo = NO si el usuario lo des-marcó; si no, estructural O veredicto LLM cacheado.

### `src/lib/store.mjs`
- **loadNewEvents** *(async)* — `desdeCero`: releer el jsonl entero SIN tocar el archivo de offsets todavía. Es lo que necesita `--all`: antes escribía 0 ANTES de procesar, así que si la corrida fallaba el offset
- **resetOffsets** *(fn)* — resetea offsets (reprocesar TODO desde el principio — caro por LLM, solo con --all)
- **loadSnapshot** *(fn)* — snapshots (calendario/archivos/notion) — se leen enteros

### `src/lib/style.mjs`
- **personCategories** *(fn)*
- **categoryOf** *(fn)*
- **buildStyleProfiles** *(async)* — perfiles de estilo POR categoría de relación (cómo le escribe ${ownerFirst()} a cada grupo)
- **outboundMessages** *(fn)*
- **buildStyleProfile** *(async)*
- **styleExamples** *(fn)* — ejemplos reales de mensajes de ${ownerFirst()} para few-shot: prioriza MISMO CONTACTO (mismo thread), luego mismo canal. Antes matcheaba por jid que outboundMessages() NO traía → l

### `src/lib/teams-send.mjs`
- **teamsConfigured** *(const)*
- **teamsSend** *(async)* — chatId de Teams: viene como "19:....@thread.v2" (o el id de un chat 1:1). El key del hilo es "teams:<chatId>".

### `src/lib/telegram-login.mjs`
- **telegramConnected** *(fn)*
- **telegramConfigured** *(fn)*
- **telegramLoginStatus** *(fn)*
- **telegramStartLogin** *(async)* — arranca el login: manda el código al Telegram del usuario y queda esperando /api/telegram/code
- **telegramSubmitCode** *(fn)*
- **telegramSubmitPassword** *(fn)*

### `src/lib/telegram-store.mjs`
- **tgRecord** *(async)*
- **tgDialogName** *(const)*

### `src/lib/thread.mjs`
- **phoneOf** *(fn)* — número real de cualquier identificador WhatsApp (jid @s.whatsapp.net, @lid, sender @whatsapp_<num> o @whatsapp_lid-<lid>)
- **contactName** *(fn)*
- **nameExtends** *(fn)* — ¿un nombre EXTIENDE al otro con apellido? (superset real: "Carlos Mendoza" ⊃ "Carlos"). Devuelve FALSE para dos nombres de pila IDÉNTICOS ("Diego" vs "Diego") → son homónimos, pers
- **manualCanon** *(fn)*
- **MY_NUMBERS** *(const)* — identidad del dueño desde la config por-hub (data/hub-config.json). Defaults = genéricos → cada instancia define su identidad ahí.
- **MY_EMAILS** *(const)*
- **isContainerJid** *(const)* — un contenedor (grupo/thread/sala/newsletter/broadcast) NUNCA es una persona
- **isGroupJid** *(const)*
- **computeThread** *(fn)*

### `src/lib/threads-repo.mjs`
- **recentInThread** *(fn)*
- **getBody** *(fn)* — 🔒 LECTORES POR-ID: la bandeja y el visor ya filtran por hilo, pero pedir un id suelto los saltea — con el id de un correo de una cuenta secreta se leía el cuerpo entero sin 2º PIN
- **casSecreto** *(fn)* — 🔒 ¿este archivo del CAS es de fuente secreta? El CAS se sirve por RUTA (/cas/<sha>.jpg), que no pasa por el gate por-hilo: con la ruta en la mano se bajaba la foto o se la mandaba
- **getAttachments** *(fn)*
- **setAttachments** *(fn)*
- **emailsMissingInline** *(fn)* — emails cuyo cuerpo referencia imágenes inline (cid:) pero que NO tienen esas imágenes guardadas → candidatos al backfill
- **searchThreadKeys** *(fn)* — ── consultas ── resumen por hilo (para la bandeja) — agrega en SQL, no carga todo en memoria CLAVES DE HILO que matchean un texto — sobre TODOS los hilos, no solo los recientes. Po
- **threadsSummary** *(fn)*
- **channelsOf** *(fn)*
- **threadMessages** *(fn)*
- **threadMessagesTail** *(fn)*
- **threadPage** *(fn)* — página de historial: los `limit` mensajes anteriores a `before` (0 = los más recientes). Para paginar hacia atrás.
- **threadCount** *(fn)*
- **threadSince** *(fn)* — mensajes ENTRANTES (no míos) posteriores a una marca de "visto" — para el resumen de "lo que me perdí" 🔒 por defecto filtra, igual que su gemela threadMessagesSinceAll. El único l
- **threadUnreadCount** *(fn)*
- **threadDelta** *(fn)* — SYNC edit-aware: filas del hilo con rev > sinceRev (NUEVAS o editadas), en orden de revisión. El cliente hace upsert por id.
- **threadMaxRev** *(fn)* — rev máxima actual del hilo (para que el cliente sepa hasta dónde llegó, aunque el delta venga vacío/paginado)
- **inboundUnansweredThreads** *(fn)* — ── absorbidas en Wave 2 (antes SQL crudo en crons/libs) ── hilos ENTRANTES recientes SIN respuesta, un mensaje representativo (el último) por hilo: excluye grupos, 'self', y hilos 
- **selfNotesSince** *(fn)* — notas propias (thread='self') desde una marca, más nuevas primero — texto + resumen de nota de voz. (era notes-ai.recentNotes)
- **selfNotesSinceAll** *(fn)* — Notas propias INCLUYENDO las de líneas secretas. Solo para el ASISTENTE y solo con su opt-in explícito. Por qué se permite acá y no en el resto: "secreto" significa OCULTO EN LA AP
- **isSecretSelfRow** *(fn)* — ¿esta nota vino de una línea secreta? → para decidir si se responde con modelo LOCAL (no mandar eso a la nube)
- **selfNotesHiddenCount** *(fn)* — Cuántas notas propias quedaron OCULTAS por el 2º PIN en ese lapso. Es solo un CONTEO (nunca el contenido): sirve para que el asistente pueda decir "no vi nada porque está bajo el P
- **uncategorizedSelfNotes** *(fn)* — ── NOTAS categorizadas: self-notes (thread='self') + note_meta (categoría/estado/pin) ── self-notes todavía SIN categorizar (para el cron notes-categorize)
- **activeNotesMissingEnrichment** *(fn)* — BACKFILL: notas YA activas pero sin el enriquecimiento nuevo (catkey/acciones/veredicto) — para poblar lo existente sin re-junkear.
- **setNoteMeta** *(fn)*
- **listNotes** *(fn)* — notas para la UI: por categoría + estado, DEDUPEADAS por contenido, pineadas primero. Se muestra la MÁS RECIENTE de cada grupo. ROW_NUMBER (un solo criterio, ts DESC) elige represe
- **noteCategories** *(fn)*
- **noteJunkCount** *(fn)*
- **noteAction** *(fn)*
- **allThreadLastTs** *(fn)* — last_ts por hilo desde thread_stats (recencia real, para el coach). (era coach.mjs)
- **sentMessages** *(fn)* — todos mis mensajes SALIENTES con texto real (para perfilar el estilo). (era style.outboundMessages)
- **emailMessagesInThread** *(fn)* — emails RECIBIDOS de un hilo (id + cuenta), para archivar en el buzón real. (era mail-archive.emailMsgsOf)
- **accountMessageStats** *(fn)* — conteo + última actividad de una cuenta (para el estado de integraciones). (era accounts.listAccounts) Devuelve {n, last}.
- **videoCandidates** *(fn)* — ── absorbidas en Wave 3 (reads) ── mensajes con link de video y sin media todavía (candidatos del fetcher). (era video-fetch.candidates)
- **inbound1to1Since** *(fn)* — mensajes ENTRANTES nuevos de conversaciones 1:1 (excluye grupos/canales/spam) desde una marca. (era msg-push)
- **totalUnread** *(fn)* — total de no-leídos (para el badge del ícono). (era msg-push)
- **audioToSummarize** *(fn)* — audios nuevos sin resumen (recibidos + notas de voz propias) desde una marca. (era audio-summarize)
- **messageById** *(fn)* — un mensaje por id (o undefined). (era meetings.reprocessMeeting) 🔒 mismo criterio que getBody: sin 2º PIN, un mensaje de fuente secreta no se entrega por id (reenviarlo, transcrib
- **recentOutbound** *(fn)* — ── absorbidas en Wave 4 (signals — señales para coach/home) ── mensajes salientes recientes (para detectar promesas cumplidas/pendientes). (era signals.promises)
- **lastInboundQuestions** *(fn)* — hilos cuyo ÚLTIMO mensaje es entrante y tiene "?" (preguntas sin responder, sin grupos). (era signals.unansweredQuestions)
- **lastOutboundPerThread** *(fn)* — hilos cuyo ÚLTIMO mensaje es TUYO (saliente) — bola en su cancha. (era signals.waitingOnThem)
- **lastInboundPerThread** *(fn)* — hilos cuyo ÚLTIMO mensaje es entrante (pendientes de respuesta, sin grupos). (era signals.pendingReplies)
- **selfNotesText** *(fn)* — texto de las notas propias (Mis Notas) recientes. (era signals.recentNotes)
- **maxMessageTs** *(fn)* — ── absorbidas en Wave 4 (extract-actions + home-brief) ── ts máximo en messages, con fallback si está vacío. (era extract-actions)
- **activeThreadsSince** *(fn)* — hilos 1:1 reales con actividad nueva desde una marca (excluye email/grupos/status/spam/self). (era extract-actions)
- **threadTextTail** *(fn)* — cola de mensajes con texto de un hilo (para armar el transcript del extractor). (era extract-actions)
- **messagesForResponseRate** *(fn)* — mensajes (thread/ts/dir) para calcular la tasa de respuesta <24h de la Home. (era home-brief.computeKpis)
- **activeOutboundThreads** *(fn)* — nº de hilos 1:1 distintos a los que escribí desde una marca (contactos activos). (era home-brief)
- **recentCalls** *(fn)* — llamadas entrantes/perdidas recientes (mediaType='call'). (era home-brief.computeCalls)
- **threadStats** *(fn)* — ── absorbidas en Wave 5 (brain.mjs — reads) ── stats de un hilo: total/enviados/primer-ts/último-ts. (era brain.contactProfile)
- **threadMediaCount** *(fn)* — nº de adjuntos reales (no stickers) de un hilo. (era brain.contactProfile)
- **threadChannelCounts** *(fn)* — conteo por canal de un hilo. (era brain.contactProfile)
- **threadMediaGallery** *(fn)* — galería: todos los adjuntos de un hilo, más nuevos primero. (era brain.threadMedia)
- **channelActivityStats** *(fn)* — actividad entrante por canal (last + conteos 30d/7d) para el health check. (era brain.channelHealth)
- **recentIngestByChannel** *(fn)* — mensajes ingeridos por canal desde `since` (para el sync bar: una ráfaga reciente = backfill/primera sync en curso).
- **channelTotals** *(fn)* — total de mensajes de canales puntuales (para mostrar el número que sube en el sync bar). Solo se llama con pocos canales activos.
- **lastInboundName** *(fn)* — último nombre ENTRANTE de un hilo (para prefill de contacto). (era brain.schedulePrefill)
- **channelAccountActivity** *(fn)* — última actividad (ts) por canal+cuenta, para el panel de integraciones. (era brain.channelAccountLast)
- **topInboundNames** *(fn)* — nombres entrantes más frecuentes de un hilo (fallback de avatar). (era brain._photoFor)
- **repliedThreads** *(fn)* — hilos donde YA respondí (correspondencia real) — ALIMENTA listThreads (la bandeja). (era brain.listThreads)
- **latestThreadLike** *(fn)* — hilo más reciente que matchea un patrón LIKE (resolver número→hilo). (era brain.coachData)
- **sentCountSince** *(fn)* — conteo de enviados desde una marca. (era brain.weeklyReview) 🔒 los tres agregados del review semanal (coach) excluyen lo secreto: no solo por el contenido — un contador que sube d
- **recvCountSince** *(fn)* — conteo de recibidos reales (no self/spam/broadcast) desde una marca. (era brain.weeklyReview)
- **topThreadsSince** *(fn)* — hilos con más ida y vuelta desde una marca (para el review semanal). (era brain.weeklyReview)
- **threadMessagesSinceAll** *(fn)* — todos los mensajes de un hilo (cualquier dir) desde una marca. (era brain.summarizeChat)
- **groupMembershipRows** *(fn)* — filas para el índice de membresía de grupos (remitentes por grupo). (era brain.buildMembershipIndex)
- **threadCountFirstLast** *(fn)* — stats simples de un hilo (conteo + primer/último ts). (era brain.buildPersonCard)
- **threadChannelActivity** *(fn)* — actividad por canal de un hilo (last + n). (era brain.buildPersonCard)
- **threadDirTimeline** *(fn)* — timeline (ts, dir) de un hilo para calcular tiempos de respuesta. (era brain.buildPersonCard)
- **threadInboundSenders** *(fn)* — remitentes entrantes distintos de un hilo (para resolver el número real). (era brain.buildPersonCard)
- **threadTextRowids** *(fn)* — rowids de mensajes con texto útil de un hilo (para muestrear la relación). (era brain.buildPersonCard)
- **messagesByRowids** *(fn)* — mensajes (dir,text) por un set de rowids, en orden cronológico. (era brain.buildPersonCard)
- **whatsappRoomsOf** *(fn)* — ── send-path: resolución de destino de un hilo (Wave 5c) ── salas portal de WhatsApp (bridge) de un hilo, por jid, la más reciente primero. (era brain.threadTargets)
- **roomInboundSenders** *(fn)* — remitentes entrantes de una sala portal concreta. (era brain.threadTargets)
- **emailAddressesOf** *(fn)* — direcciones de email de un hilo, la más reciente primero. (era brain.threadTargets)
- **directPeersOf** *(fn)* — DESTINOS de los canales de mensajería DIRECTA (telegram/slack/signal/teams/…): un destino por (canal, jid) visto en el hilo. Sin esto threadTargets() solo sabía de WhatsApp y email
- **lastInboundJid** *(fn)* — jid del último mensaje ENTRANTE de un hilo (destino default). (era brain.threadTargets)
- **lastEmailByAddress** *(fn)* — último email (cuenta+texto) por dirección exacta. (era brain.sendReply)
- **lastEmailInThread** *(fn)* — último email (cuenta+texto) de un hilo. (era brain.sendReply)
- **lastUnipileJid** *(fn)* — último jid gestionado por Unipile de un hilo (WhatsApp híbrido). (era brain.sendReply)
- **lastWhatsappRoom** *(fn)* — última sala portal de WhatsApp (bridge) de un hilo — destino de envío. (era brain.sendReply*)
- **lastHistoricJid** *(fn)* — último jid histórico crudo (<num>@s.whatsapp.net, sin sala del bridge). (era brain.sendReply*)
- **mediaWithoutFile** *(fn)* — ── absorbidas en Wave 6 (últimos handle-importers) ── mensajes con tipo de media pero sin archivo vinculado (para el backfill de CAS). (era relink-media)
- **emailsToSummarize** *(fn)* — emails con cuerpo y sin resumen (para el cron de pitch/resumen). (era email-summarize)

### `src/lib/unipile-api.mjs`
- **unipileConfigured** *(fn)*
- **unipileSend** *(async)* — envía texto a un contacto/grupo gestionado por Unipile. jid = provider_id del chat (contacto o @g.us).

### `src/lib/vault.mjs`
- **slug** *(fn)*
- **writeSeedNote** *(fn)* — --- escribir un nodo SEMILLA (autoritativo). Preserva Timeline previo. ---
- **upsertNode** *(fn)* — --- upsert de graphify. Si el nodo es semilla, solo suma Timeline + aliases/channels (no pisa el cuerpo). ---
- **mergeNotes** *(fn)* — --- fusionar un nodo duplicado dentro del canónico (mueve Timeline + channels, borra el dup) ---
- **noteExists** *(fn)*
- **normalizeVaultLinks** *(fn)* — --- reescribir [[alias]] → [[canónico]] en TODAS las notas (colapsa nodos fantasma) ---
- **loadIdentity** *(fn)*
- **saveIdentity** *(fn)*

### `src/lib/voice.mjs`
- **transcribeMedia** *(async)* — #5: transcribe audio O VIDEO con auto-detección de idioma (inglés/japonés/etc) → { text, lang }. ffmpeg extrae el audio del video.
- **VOICES** *(const)*
- **tts** *(async)* — texto → audio mp3 (Buffer)
- **audioExt** *(fn)* — extensión de archivo canónica según el mime del audio → el codec que Whisper (local u OpenAI) espera por el nombre del archivo.
- **stt** *(async)* — audio → texto. SELF-HOSTED primero si el hub lo pide (stt=local) o si no hay key OpenAI pero whisper.cpp está: el audio NUNCA sale.

### `src/lib/wa-import.mjs`
- **parseWhatsAppExport** *(fn)* — ── PARSER puro: texto del export → [{ts, sender, dir, text, mediaType}] ──
- **importWhatsApp** *(fn)* — ── IMPORT: parsea + mergea al hilo con dedup por contenido (ts±90s + texto). Devuelve stats. ──
- **importWhatsAppZip** *(fn)*

### `src/lib/whisper.mjs`
- **whisperAvailable** *(fn)*
- **transcribeWhisper** *(async)* — transcribe un archivo de audio local → texto plano (sin timestamps). lang "es"/"en"/"auto".

### `src/lib/workspace.mjs`
- **companies** *(fn)*
- **saveCompany** *(fn)*
- **deleteCompany** *(fn)*
- **objetivos** *(fn)* — ── OBJETIVOS / KPIs (personales o de una empresa) ──
- **saveObjetivo** *(fn)*
- **deleteObjetivo** *(fn)*
- **pins** *(fn)* — ── ESPACIOS ANIDADOS (parent = null es raíz; se ven como contactos en la lista) ── hilos fijados arriba de la bandeja (por key). El usuario "pinea" personas/grupos importantes.
- **setPin** *(fn)*
- **archived** *(fn)* — archivar hilos (ocultar de la bandeja) + marcar remitentes de email como spam (ese y los futuros)
- **archive** *(fn)*
- **silenced** *(fn)* — SILENCIAR: ruido que NO es spam (grupos que no me interesan ahora). NO se ocultan como los archivados: viven en la pestaña "Silenciados".
- **silence** *(fn)*
- **spamSenders** *(fn)*
- **addSpamSender** *(fn)*
- **seenMap** *(fn)* — ── "ÚLTIMA VEZ VISTO" por hilo (read state) — para ofrecer resumen de lo que me perdí desde la última vez que entré ──
- **lastSeen** *(fn)*
- **markSeen** *(fn)*
- **aiNotes** *(fn)* — ── NOTAS DE IA por hilo (resúmenes de chat que la IA genera y quedan GRABADOS para vos — nunca se envían) ──
- **addAiNote** *(fn)*
- **espacios** *(fn)*
- **saveEspacio** *(fn)*
- **deleteEspacio** *(fn)*
- **espacioAddRule** *(fn)* — reglas de pertenencia de un espacio: {type: email|domain|phone|name, value}. Los mensajes que matchean cualquier regla entran al espacio.
- **espacioRemoveRule** *(fn)*
- **espacioAddException** *(fn)* — EXCEPCIONES: {type,value} igual que las reglas, pero SACAN del espacio lo que matchean (aunque cumplan una regla). Ej: regla domain "acme.com" + excepción email "ceo@acme.com" → to
- **espacioRemoveException** *(fn)*
- **contactOverrides** *(fn)* — ── OVERRIDES DE CONTACTO: fusiones manuales, separaciones y fotos elegidas ── { merges: { canonKey: [channelIds...] }, splits: [channelId...], photos: { key: url } }
- **saveContactOverrides** *(fn)*
- **mergeContacts** *(fn)*
- **unmergeContact** *(fn)*
- **setContactPhoto** *(fn)*
- **contactCategories** *(fn)* — categoría manual del contacto: familia | amigos | trabajo | otro. Manda sobre lo que adivine la IA.
- **setContactCategory** *(fn)*

### `src/matrix.mjs`
- **login** *(async)*
- **sendMatrix** *(async)* — ENVÍO: manda un mensaje a una sala del bridge (WhatsApp/IG/…) → el bridge lo entrega al contacto. Usado por /api/send.
- **sendMatrixAudio** *(async)* — ENVÍO DE NOTA DE VOZ: m.audio con los marcadores MSC1767/MSC3245 → los bridges (WhatsApp/Telegram/Discord/Signal) la entregan como mensaje de voz (PTT), no como archivo. El audio y
- **sendMatrixMedia** *(async)* — ENVÍO DE IMAGEN / VIDEO / ARCHIVO: sube al content-repo y manda m.image/m.video/m.file → los bridges lo entregan como adjunto.
- **sendMatrixSticker** *(async)* — ENVÍO DE STICKER: evento m.sticker (tipo de evento propio, no m.room.message) con la imagen webp → los bridges lo entregan como sticker nativo (WhatsApp exige webp; el server lo co
- **startWhatsAppChat** *(async)* — INICIAR un chat de WhatsApp NUEVO por número (contacto histórico sin sala en el bridge). Le pide al bot del bridge que cree el portal (start-chat) y devuelve el mxid de la sala. Re
- **roomLogin** *(async)* — estado del login (número) DUEÑO de una sala portal: { receiver, alive }. Sirve para decir "revinculá X" cuando el envío falla porque ese número está deslogueado (el bridge acepta e
- **loggedOutNumbers** *(async)* — números propios (hub-config) que están DESLOGUEADOS en el bridge (reciben pero no envían). Para el banner de re-link in-app.
- **syncBridgeAvatars** *(async)* — SYNC COMPLETO desde la DB de mautrix: avatares (ghost + portal) + nombres, keyeados por el nombre real del contacto/grupo. Las fotos SÍ están en el bridge (columna avatar_mxc). Uso
- **linkNetwork** *(async)* — VINCULAR: manda login y captura QR/código del bot. Escribe /tmp/matrix_qr_<net>.png y /tmp/matrix_code_<net>.
- **linkWithToken** *(async)* — VINCULAR POR TOKEN/COOKIE: para redes cuyo login no es QR (Discord=token, meta=cookies). Manda el comando y espera el ok.
- **runReader** *(async)*
- **listLogins** *(async)* — lista las cuentas conectadas de una red (via `list-logins` al bot). Escribe /tmp/matrix_logins_<net>.json
- **backfillAllAvatars** *(async)* — backfill de avatares: recorre todas las salas y baja las fotos de perfil de los miembros (sin tocar mensajes) Backfill REAL contacto-por-contacto: por cada hilo le pide a Matrix la
- **syncBridgePortals** *(async)* — SYNC de portales: pone el NOMBRE real de cada grupo (de la DB del bridge) y unifica los DMs del bridge con el contacto.
- **backfillAvatars** *(async)*

### `src/notes-ai.mjs`
- **recentNotes** *(fn)* — stream de notas reales de los últimos 30 días: texto directo, o el resumen si fue nota de voz. Se saltean medias sin texto.
- **generateNotesDigest** *(async)*

### `src/send-selftest.mjs`
- **runSelfTest** *(async)* — corre los canales pedidos (o los de CHANNELS), guarda el resultado y avisa por push si algo falló. Reutilizable (cron + endpoint).
- **lastSelfTest** *(fn)*

### `src/unipile.mjs`
- **attachLabel** *(fn)* — tipo Unipile → mediaType de pipe + texto de etiqueta
- **fetchAttachment** *(async)* — baja el 1er adjunto de un mensaje Unipile al CAS → {media, mediaType, text, filename} o null. Respeta la política de media del chat: si es "no guardar", devuelve placeholder sin ba

