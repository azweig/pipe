// 1×/día (mañana): pre-genera los borradores de LinkedIn y empuja un push con las novedades. Se auto-gatea (1 vez/día).
import { readFileSync, writeFileSync, existsSync } from "fs"
import { loadEnv } from "./lib/env.mjs"
import { tz } from "./lib/hub.mjs"
import * as brain from "./lib/brain.mjs"
loadEnv()

const NOW = Date.now()
const hourLima = +new Date(NOW).toLocaleString("en-US", { timeZone: tz(), hour: "2-digit", hour12: false })
const today = new Date(NOW).toLocaleString("en-US", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" })
const F = "./data/social-daily-last.json"
const last = existsSync(F) ? JSON.parse(readFileSync(F, "utf8")).day : ""
if (hourLima < 8 || last === today) { console.log(`[social-daily] skip (hora ${hourLima}, último ${last})`); process.exit(0) }

const drafts = await brain.linkedinDrafts({ force: true }).catch((e) => { console.error("drafts err:", e.message); return { drafts: [] } })
const dig = await brain.socialDigest({ days: 3, force: true }).catch(() => ({ highlights: [] }))
const parts = []
if (drafts.drafts?.length) parts.push(`✍️ ${drafts.drafts.length} borradores de LinkedIn listos`)
if (dig.highlights?.length) parts.push(`📰 ${dig.highlights.length} novedades para revisar`)
if (parts.length) {
  try { const push = await import("./lib/push.mjs"); await push.sendPush({ title: "📰 Tus redes hoy", body: parts.join(" · ") + " — abrí la pestaña ✨ IA", url: "/", tag: "social-daily" }) } catch {}
}
writeFileSync(F, JSON.stringify({ day: today, ts: NOW }))
console.log(`[social-daily] ${parts.join(" · ") || "nada"} · push enviado`)
