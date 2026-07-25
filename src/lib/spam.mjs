// ÚNICO detector de spam/marketing del sistema. Lo comparten el inbox (brain.bucketOf) y las señales del coach/IA
// (signals.mjs) → lo que es spam en un lado es spam en el otro. Antes había DOS detectores desconectados: el del inbox
// (lista hardcodeada de marcas, solo emails) y uno mínimo aparte en las señales → por eso Plaud (marketing en inglés,
// sin marca conocida) se colaba en "preguntas sin responder".
//
// Filosofía: señales ESTRUCTURALES (agnósticas de marca/idioma), no una lista de marcas puntuales:
//  1) remitente automático / de rol (noreply, newsletter, hello@, team@, mailchimp, ...) → correspondencia no personal
//  2) 2+ links en el cuerpo → envío masivo/promocional (esto agarra Plaud y cualquier futuro, sin nombrarlo)
//  3) frases de baja de suscripción / promo genérica (unsubscribe, darte de baja, oferta, descuento, black friday)
// Las marcas quedan como complemento heredado, NO como base.

import { readFileSync, existsSync, writeFileSync } from "fs"
import { withLock } from "./lock.mjs"

const BULK_SENDER = /noreply|no-reply|donotreply|do-not-reply|notification|newsletter|mailer|marketing|market@|sale@|shop@|store@|updates@|news@|hello@|team@|info@|hola@|contacto@|@mail\.|@email\.|@news\.|@info\.|@\S*(mailchimp|substack|sendgrid|hubspot|intercom|klaviyo|shopify)/i
const PROMO_WORDS = /\b(unsubscribe|desuscrib\w*|darte de baja|dejar de recibir|view in browser|ver en (el )?navegador|black ?friday|cyber ?(monday|day)|hot ?sale|liquidaci[oó]n|promoci[oó]n|promo|ofertas?|descuentos?|exclusiv\w*|cup[oó]n|sorteo|gratis)\b/i
const BRANDS = /\b(temu|shein|aliexpress|falabella|mallplaza|ticketmaster|ripley|plazavea|oechsle|promart|linio|platanitos|gapfactory)\b/i

// señal ESTRUCTURAL clave (agnóstica de idioma/marca): un envío promocional pone VARIOS links, casi siempre al MISMO dominio
// (ej. Plaud: 3× plaud.ai). Un amigo que comparte "mirá estos 2" manda dominios DISTINTOS → no lo marcamos. Así evitamos falsos positivos.
export const manyLinks = (text = "") => {
  const hosts = (String(text).match(/https?:\/\/([^/\s]+)/gi) || []).map((u) => u.replace(/^https?:\/\//i, "").replace(/^www\./, "").toLowerCase())
  if (hosts.length >= 3) return true // 3+ links = casi seguro un blast
  const counts = {}
  for (const h of hosts) counts[h] = (counts[h] || 0) + 1
  return Object.values(counts).some((c) => c >= 2) // 2+ al mismo dominio = promocional
}

// ¿este mensaje parece marketing/promoción (no correspondencia personal)? jid+name ayudan con el remitente.
// Capa 1: ESTRUCTURAL (barata, sincrónica). Resuelve la mayoría sin costo.
export function isSpam(jid = "", name = "", text = "") {
  const hay = `${jid} ${name} ${text}`.toLowerCase()
  return BULK_SENDER.test(hay) || manyLinks(text) || PROMO_WORDS.test(hay) || BRANDS.test(hay)
}

// Capa 2: VEREDICTO DEL LLM cacheado por hilo (lo escribe el cron src/spam-classify.mjs, para lo que la capa 1 no resuelve
// — ej. ventas en texto plano sin links). Acá solo se LEE el cache (barato); la clasificación cara corre en background.
const CACHE = "./data/spam-cache.json"
let _c = { m: null, ts: 0 }
function cache() {
  if (!_c.m || Date.now() - _c.ts > 30000) { try { _c.m = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {} } catch { _c.m = {} } _c.ts = Date.now() }
  return _c.m
}
export function llmSpam(thread) { return cache()[thread] === true }

// #31 DES-MARCAR SPAM: override manual del usuario. Si un hilo está en not-spam, NUNCA es spam (gana sobre estructural + LLM).
// Corrige los falsos positivos del clasificador → confianza. Y le enseña al sistema (el LLM no lo vuelve a marcar).
const NOTSPAM = "./data/not-spam.json"
let _ns = { m: null, ts: 0 }
function notSpamSet() {
  if (!_ns.m || Date.now() - _ns.ts > 30000) { try { _ns.m = new Set((existsSync(NOTSPAM) ? JSON.parse(readFileSync(NOTSPAM, "utf8")) : []).map(String)) } catch { _ns.m = new Set() } _ns.ts = Date.now() }
  return _ns.m
}
export function notSpam(thread) { return notSpamSet().has(String(thread)) }
export function setNotSpam(thread) {
  withLock(NOTSPAM, () => { let a = []; try { a = existsSync(NOTSPAM) ? JSON.parse(readFileSync(NOTSPAM, "utf8")) : [] } catch {}; if (!a.includes(thread)) a.push(thread); writeFileSync(NOTSPAM, JSON.stringify(a)) })
  withLock(CACHE, () => { let c = {}; try { c = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {} } catch {}; c[thread] = false; writeFileSync(CACHE, JSON.stringify(c)) }) // limpiar el veredicto LLM viejo
  _ns = { m: null, ts: 0 }; _c = { m: null, ts: 0 } // invalidar caches
}

// spam DEFINITIVO para un hilo = NO si el usuario lo des-marcó; si no, estructural O veredicto LLM cacheado.
export function threadIsSpam(thread, jid = "", name = "", text = "") { return !notSpam(thread) && (isSpam(jid, name, text) || llmSpam(thread)) }
