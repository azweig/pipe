// Política de almacenamiento de media (fotos/videos/documentos). Para ahorrar disco: "no guardar puros memes".
// Aplica a nivel de TODA la cuenta (default) y con override POR CHAT. Guardada en meta['media_policy'].
// EXCEPCIÓN: el audio (notas de voz) y los registros de llamada SIEMPRE se guardan — son chicos y valiosos
// (las notas de voz tienen resumen). Así el "no guardar" apunta a lo pesado (imágenes/videos/docs), no a la voz.
import { getMeta, setMeta } from "./db.mjs"
import { storageOverQuota } from "./quota.mjs"

const ALWAYS = new Set(["audio", "call"])

export function getMediaPolicy() {
  try {
    const p = JSON.parse(getMeta("media_policy") || "{}")
    return { def: p.def === "skip" ? "skip" : "store", threads: p.threads && typeof p.threads === "object" ? p.threads : {} }
  } catch { return { def: "store", threads: {} } }
}
function save(p) { setMeta("media_policy", JSON.stringify({ def: p.def, threads: p.threads })) }

export function setMediaDefault(mode) { const p = getMediaPolicy(); p.def = mode === "skip" ? "skip" : "store"; save(p); return p }
export function setThreadMediaPolicy(key, mode) {
  const p = getMediaPolicy()
  if (!key) return p
  if (mode === "default" || mode == null) delete p.threads[key]        // vuelve a seguir el default de la cuenta
  else p.threads[key] = mode === "skip" ? "skip" : "store"
  save(p); return p
}

// modo efectivo de un chat ("store"|"skip"), considerando override del chat → default de la cuenta.
export function threadMediaMode(threadKey) { const p = getMediaPolicy(); return p.threads[threadKey] || p.def }

// ¿bajar/guardar la media de este mensaje? El audio/llamada nunca se descarta. El resto sigue la política del chat.
export function shouldStoreMedia(threadKey, mediaType) {
  if (ALWAYS.has(mediaType)) return true              // audio/llamada: siempre, sin importar quota ni política
  if (storageOverQuota()) return false                // pasaste el límite del plan → no guardar media PESADA nueva (el mensaje igual entra)
  return threadMediaMode(threadKey) === "store"
}
