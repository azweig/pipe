// One-off: resume (STT + LLM) audios recibidos que quedaron SIN summary — típicamente los rescatados por
// unipile-media-backfill (que les puso media pero no resumen). Bypassa el piso `audio_summary_from` del cron.
// Scopeado por `account` para NO re-resumir toda la historia. Correr: node src/audio-summarize-backfill.mjs [limit] [account]
import { loadEnv } from "./lib/env.mjs"
import { summarizeBatch } from "./audio-summarize.mjs"
import { handle } from "./lib/db-core.mjs"
import { isSecretRow } from "./lib/secret.mjs" // 🔒 no mandar a transcribir audio de una cuenta secreta
loadEnv()

const LIMIT = +process.argv[2] || 40
const ACC = process.argv[3] || "unipile"
const h = handle()
h.pragma("busy_timeout = 15000")

// mismo criterio que audioToSummarize (recibidos + tus notas de voz), pero sin piso temporal y acotado por cuenta.
// 🔒 el filtro por fuente secreta va acá también: esta consulta es una COPIA de la del cron, y taparlo solo allá dejaba
// esta puerta abierta — de acá el audio crudo sale igual hacia el servicio de transcripción.
const rows = h.prepare(`SELECT id, media, ts, thread, channel, account, jid FROM messages
  WHERE mediaType='audio' AND media IS NOT NULL AND media!=''
    AND (dir!='out' OR thread='self') AND (summary IS NULL OR summary='')
    AND account=? ORDER BY ts DESC LIMIT ?`).all(ACC, LIMIT * 3 + 10).filter((r) => !isSecretRow(r)).slice(0, LIMIT)

console.log(`${rows.length} audios recibidos sin resumen (account=${ACC})…`)
const done = await summarizeBatch(rows)
console.log(`✅ ${done}/${rows.length} resumidos`)
process.exit(0)
