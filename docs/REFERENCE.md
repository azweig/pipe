# pipe.one — Referencia técnica (AUTO-GENERADA)

> Generado por `node scripts/gen-docs.mjs`. **No editar a mano** — se regenera. Última corrida: (stamp al commitear).

## 🌐 API — 142 endpoints

| Método | Endpoint |
|---|---|
| GET | `/api/accounts` |
| POST | `/api/accounts/email` |
| POST | `/api/accounts/email/remove` |
| POST | `/api/action/done` |
| POST | `/api/add-email` |
| GET | `/api/agenda` |
| GET | `/api/ask` |
| POST | `/api/auth` |
| POST | `/api/auth/change-pin` |
| POST | `/api/auth/logout` |
| POST | `/api/auth/revoke-all` |
| POST | `/api/auth/setup` |
| GET | `/api/auth/status` |
| GET | `/api/briefing` |
| GET | `/api/calendar` |
| POST | `/api/calendar/regen` |
| GET | `/api/channels` |
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
| POST | `/api/contact/merge` |
| POST | `/api/contact/photo` |
| POST | `/api/contact/pin` |
| GET | `/api/contact/profile` |
| POST | `/api/contact/spam` |
| GET | `/api/contact/suggestions` |
| POST | `/api/contact/unmerge` |
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
| POST | `/api/integration/remove` |
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
| GET | `/api/selftest` |
| POST | `/api/selftest` |
| POST | `/api/send` |
| POST | `/api/send-audio` |
| POST | `/api/send-media` |
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
| GET | `/api/thread/catchup` |
| GET | `/api/thread/media` |
| GET | `/api/thread/meetings` |
| GET | `/api/thread/schedule` |
| POST | `/api/thread/seen` |
| GET | `/api/thread/suggest-reply` |
| GET | `/api/thread/summarize` |
| GET | `/api/thread/targets` |
| GET | `/api/threads` |
| GET | `/api/tts` |
| GET | `/api/voices` |
| GET | `/api/wa-qr` |
| GET | `/api/wa-status` |
| GET | `/api/wa/status` |

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
- web `src/server.mjs`

**Jobs periódicos:**
- runGraphify — cada GRAPHIFY_MIN * 60000
- runCoach — cada 4 * 3600000
- runVaultSync — cada 20 * 60000
- runIngest — cada 15000
- runVideoFetch — cada 4 * 60000
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
- runNotesAi — cada 3 * 3600000
- runNotesCategorize — cada 5 * 60000
- runClips — cada 4 * 60000
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

## 📦 Módulos (112) y sus exports

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

### `src/lib/auth.mjs`
- **pinIsSet** *(fn)*
- **setPin** *(fn)* — setear/cambiar el PIN (6-12 dígitos). scrypt es lento a propósito → frena fuerza bruta offline si roban el archivo. Mínimo 6 (no 4): en un endpoint expuesto a internet, 10⁴ es brut
- **changePin** *(fn)* — cambiar el PIN desde adentro (ya autenticado): exige el PIN actual → nadie con una sesión robada lo cambia sin saberlo.
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
- **casPutBuffer** *(fn)* — guarda un Buffer y devuelve la ruta pública /cas/xx/<hash><ext>. Dedup por contenido; el ext es CANÓNICO (el del primer put) para que N callers con ext distinto referencien el MISM
- **casRegister** *(fn)* — registra en el índice un archivo YA colocado en el CAS (tools que mueven archivos directo, ej. dedup-media). Devuelve el pub canónico.
- **casUrlByHash** *(fn)* — ruta pública de un hash (para tools de import que mapean file_hash → URL del CAS).
- **casDelete** *(fn)* — borra un blob por su ruta pública → libera disco. El caller decide la seguridad (que nadie lo referencie). Devuelve bytes liberados.
- **casTrash** *(fn)* — ── PAPELERA (soft-delete con 30 días de "deshacer") ───────────────────────────────────────────── SOFT-DELETE → papelera. NO libera disco (el blob queda para deshacer). Guarda cómo
- **casRestore** *(fn)* — DESHACER: saca el blob de la papelera y devuelve los mensajes a re-vincular.
- **casTrashList** *(fn)* — contenido de la papelera para la UI (más reciente primero) + cuándo se purga cada uno.
- **casGC** *(fn)* — GC: manda a papelera los blobs que NINGÚN mensaje vivo referencia, y RESCATA los que volvieron a estar vivos. livePubs = set de rutas vivas.
- **casPurge** *(fn)* — PURGE: borra de verdad (libera disco) lo que lleva > TRASH_TTL en papelera, PERO re-verifica vivo primero (no borra media re-referenciada).
- **casStats** *(fn)*

### `src/lib/db-core.mjs`
- **initSchema** *(fn)* — initSchema(handle): función PURA con el mismo DDL que vivía dentro de db(). Idempotente (CREATE IF NOT EXISTS + PRAGMA table_info para migraciones). Corre igual sobre archivo o ':m
- **withRetry** *(fn)*
- **handle** *(fn)* — getter interno del singleton. NO se re-exporta desde db.mjs (el handle no cruza el seam).
- **setBusyTimeout** *(fn)* — ajusta el busy_timeout del handle (algunos crons quieren más/menos que el default de 20s según su workload). Named op → el handle sigue privado. Sin try/catch interno: el caller lo
- **configureDb** *(fn)* — cambia el path y reabre (cierra el handle actual). Para tests: configureDb({ path: ':memory:' }).
- **resetDb** *(fn)* — cierra y reabre una DB fresca. Default ':memory:' → cada test arranca aislado y vacío.
- **seed** *(fn)*

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

### `src/lib/intents.mjs`
- **detectSchedule** *(fn)* — Devuelve la fecha como COMPONENTES (year/month/day/hour/minute), no como instante UTC: el evento se crea después con timeZone explícito → evita el clásico bug de timezone (el owner
- **parsePhrase** *(fn)* — parsea una frase de fecha/hora (español) → componentes. Reusado por el detector LLM.
- **hasWeakSignal** *(fn)*
- **detectScheduleLLM** *(async)* — DETECTOR LLM (para frases relacionadas que el regex no agarra, ej: "tenés tiempo el martes?"). llmFn(convoTexto, refISO) → debe devolver { scheduling, when, time, durationMin, topi

### `src/lib/jsonl.mjs`
- **tailJsonl** *(fn)* — TAIL: parsea solo los últimos maxBytes → objetos. Para "actividad reciente". La 1ª línea puede venir cortada (empieza a mitad de línea) → JSON.parse falla y se descarta, sin proble
- **streamJsonl** *(async)* — STREAM: recorre TODO el archivo línea por línea sin cargarlo entero. Para reindexado incremental.

### `src/lib/llm.mjs`
- **visionLLM** *(async)* — VISIÓN: lee/entiende imágenes (para emails que son pura imagen). Gemini 2.5 Flash → OpenAI gpt-4o-mini. Hook Mistral OCR: si algún día hay MISTRAL_API_KEY, se puede anteponer /v1/o
- **llmConfigMasked** *(fn)* — ── CONFIG BYOK expuesta a la app (Configuración → Motor de IA) ──
- **testKey** *(async)* — PROBAR una key puntual: ping mínimo → si responde, anda. Incluye ollama (usa el host).
- **providerKey** *(fn)*
- **sttMode** *(fn)*
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
- **sendEmailReply** *(async)*

### `src/lib/maintenance.mjs`
- **ensureStats** *(fn)* — AUTO-SANADO: si thread_stats quedó vacío (race/interrupción de un rebuild) pero hay mensajes → reconstruir. Evita que la bandeja aparezca vacía. Corre al arrancar y en el mantenimi
- **fixGroupLeaks** *(fn)* — Corrector de HILOS-FANTASMA: mensajes de grupo (grp seteado) que quedaron en un hilo que NO es del grupo (DM falso por número, o hilo de persona) → moverlos al hilo real del grupo 

### `src/lib/media-policy.mjs`
- **getMediaPolicy** *(fn)*
- **setMediaDefault** *(fn)*
- **setThreadMediaPolicy** *(fn)*
- **threadMediaMode** *(fn)* — modo efectivo de un chat ("store"|"skip"), considerando override del chat → default de la cuenta.
- **shouldStoreMedia** *(fn)* — ¿bajar/guardar la media de este mensaje? El audio/llamada nunca se descarta. El resto sigue la política del chat.

### `src/lib/meetings.mjs`
- **isSensitiveMeeting** *(fn)*
- **matchCalendarEvent** *(fn)*
- **summarizeMeeting** *(async)*
- **ingestRecording** *(async)* — ── ingesta: guarda audio en CAS, crea el hilo (placeholder), y procesa en background (fire-and-forget, 1 job por reunión) ──
- **reprocessMeeting** *(async)* — reprocesar (debug/reintento)

### `src/lib/meta-repo.mjs`
- **clipFlag** *(fn)* — pin/archivo de un clip (por id del mensaje self). Crea la fila de clip si no existía (aún sin enriquecer).
- **getMeta** *(fn)*
- **setMeta** *(fn)*
- **count** *(fn)*
- **clipCandidates** *(fn)* — ── clips absorbidos en Wave 3 ── mensajes de 'self' que aún no tienen fila en clips (candidatos a enriquecer). (era clips.run)
- **insertClip** *(fn)* — inserta un clip enriquecido (idempotente por id, OR IGNORE). archived=1 oculta spam/sin-sentido. (era clips.run)
- **insertTodo** *(fn)* — tarea nueva (lo que me pidieron / quedó de mi lado). Idempotente por id (OR IGNORE). (era extract-actions)
- **insertPromesa** *(fn)* — promesa nueva (lo que YO me comprometí a hacer). Idempotente por id. (era extract-actions)
- **openActionItems** *(fn)* — ítems abiertos (done=0) de todos|promesas. kind por allowlist. Defensivo (nunca tira). (era home-brief.openActions)
- **markDone** *(fn)*
- **upsertMetric** *(fn)* — upsert de una métrica diaria (historia de KPIs). (era home-brief.recordMetric)
- **metricHistory** *(fn)* — historia reciente de una métrica (más nuevas primero). (era home-brief.deltaOf)
- **clipsForNotes** *(fn)* — clips de 'self' filtrados por tipo, paginados hacia atrás. (era brain.notesClips) El mapeo a la vista queda en brain.
- **pinnedNotesClips** *(fn)* — clips fijados (self, no archivados) para mostrar arriba. (era brain.notesClips)

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
- **search** *(fn)*
- **allForRag** *(fn)*
- **rebuildMessagesFts** *(fn)* — reconstruye el índice FTS de asuntos/nombres (external-content: el trigger solo cubre INSERT, no UPDATE). (era meetings.updateMeeting) Wave 3.

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

### `src/lib/spam.mjs`
- **manyLinks** *(const)* — señal ESTRUCTURAL clave (agnóstica de idioma/marca): un envío promocional pone VARIOS links, casi siempre al MISMO dominio (ej. Plaud: 3× plaud.ai). Un amigo que comparte "mirá est
- **isSpam** *(fn)* — ¿este mensaje parece marketing/promoción (no correspondencia personal)? jid+name ayudan con el remitente. Capa 1: ESTRUCTURAL (barata, sincrónica). Resuelve la mayoría sin costo.
- **llmSpam** *(fn)*
- **notSpam** *(fn)*
- **setNotSpam** *(fn)*
- **threadIsSpam** *(fn)* — spam DEFINITIVO para un hilo = NO si el usuario lo des-marcó; si no, estructural O veredicto LLM cacheado.

### `src/lib/store.mjs`
- **loadNewEvents** *(async)*
- **resetOffsets** *(fn)* — resetea offsets (reprocesar TODO desde el principio — caro por LLM, solo con --all)
- **loadSnapshot** *(fn)* — snapshots (calendario/archivos/notion) — se leen enteros

### `src/lib/style.mjs`
- **personCategories** *(fn)*
- **categoryOf** *(fn)*
- **buildStyleProfiles** *(async)* — perfiles de estilo POR categoría de relación (cómo le escribe ${ownerFirst()} a cada grupo)
- **outboundMessages** *(fn)*
- **buildStyleProfile** *(async)*
- **styleExamples** *(fn)* — ejemplos reales de mensajes de ${ownerFirst()} para few-shot: prioriza MISMO CONTACTO (mismo thread), luego mismo canal. Antes matcheaba por jid que outboundMessages() NO traía → l

### `src/lib/telegram-login.mjs`
- **telegramConnected** *(fn)*
- **telegramConfigured** *(fn)*
- **telegramLoginStatus** *(fn)*
- **telegramStartLogin** *(async)* — arranca el login: manda el código al Telegram del usuario y queda esperando /api/telegram/code
- **telegramSubmitCode** *(fn)*
- **telegramSubmitPassword** *(fn)*

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
- **getBody** *(fn)*
- **threadsSummary** *(fn)* — ── consultas ── resumen por hilo (para la bandeja) — agrega en SQL, no carga todo en memoria
- **channelsOf** *(fn)*
- **threadMessages** *(fn)*
- **threadMessagesTail** *(fn)*
- **threadPage** *(fn)* — página de historial: los `limit` mensajes anteriores a `before` (0 = los más recientes). Para paginar hacia atrás.
- **threadCount** *(fn)*
- **threadSince** *(fn)* — mensajes ENTRANTES (no míos) posteriores a una marca de "visto" — para el resumen de "lo que me perdí"
- **threadUnreadCount** *(fn)*
- **inboundUnansweredThreads** *(fn)* — ── absorbidas en Wave 2 (antes SQL crudo en crons/libs) ── hilos ENTRANTES recientes SIN respuesta, un mensaje representativo (el último) por hilo: excluye grupos, 'self', y hilos 
- **selfNotesSince** *(fn)* — notas propias (thread='self') desde una marca, más nuevas primero — texto + resumen de nota de voz. (era notes-ai.recentNotes)
- **uncategorizedSelfNotes** *(fn)* — ── NOTAS categorizadas: self-notes (thread='self') + note_meta (categoría/estado/pin) ── self-notes todavía SIN categorizar (para el cron notes-categorize)
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
- **messageById** *(fn)* — un mensaje por id (o undefined). (era meetings.reprocessMeeting)
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
- **sentCountSince** *(fn)* — conteo de enviados desde una marca. (era brain.weeklyReview)
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
- **VOICES** *(const)*
- **tts** *(async)* — texto → audio mp3 (Buffer)
- **audioExt** *(fn)* — extensión de archivo canónica según el mime del audio → el codec que Whisper (local u OpenAI) espera por el nombre del archivo.
- **stt** *(async)* — audio → texto. SELF-HOSTED primero si el hub lo pide (stt=local) o si no hay key OpenAI pero whisper.cpp está: el audio NUNCA sale.

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

