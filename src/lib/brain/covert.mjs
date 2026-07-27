// MODO ENCUBIERTO — capa de feature sobre covertext.mjs: config por-contacto (passphrase cifrada en reposo + estilo), codificar al
// enviar, y auto-descifrar los mensajes entrantes/salientes del hilo. La passphrase NUNCA se guarda en claro: va cifrada con SECRETS_KEY.
import { readFileSync, writeFileSync } from "fs"
import { encSecret, decSecret } from "../secrets.mjs"
import { encodeCovert, decodeCovert, styles } from "../covertext.mjs"

const FILE = "data/covert.json" // { [threadKey]: { pass: "enc:v1:…", style } } — en data/ (gitignored, va en el backup cifrado)
function load() { try { return JSON.parse(readFileSync(FILE, "utf8")) } catch { return {} } }
function save(o) { writeFileSync(FILE, JSON.stringify(o)) }

export function covertStyles() { return styles() }
export function getCovert(key) { const c = load()[key]; return { enabled: !!c, style: c?.style || "poema", styles: styles() } }

export function setCovert(key, pass, style = "poema") {
  const o = load()
  if (!pass) delete o[key] // pass vacía → desactivar el modo encubierto para este contacto
  else o[key] = { pass: encSecret(String(pass)), style }
  save(o); return getCovert(key)
}

function passFor(key) { const c = load()[key]; if (!c) return null; try { return decSecret(c.pass) } catch { return null } }

// codifica un texto para ESTE contacto (con su clave + estilo guardados) → texto tapadera listo para mandar por el canal
export function encodeCovertFor(key, text) {
  const c = load()[key]; if (!c) throw new Error("este contacto no tiene modo encubierto configurado")
  const pass = decSecret(c.pass); if (!pass) throw new Error("no pude leer la clave del contacto (¿cambió SECRETS_KEY?)")
  return encodeCovert(text, pass, c.style || "poema")
}

// preview en vivo para el sheet de configuración (no persiste nada): texto + clave + estilo → cómo se vería
export function previewCovert(text, pass, style = "poema") { return encodeCovert(text || "hola, esto es una prueba", pass || "clave", style) }

// enriquece los items de un hilo: si el contacto tiene clave, intenta descifrar cada mensaje de TEXTO → it.covert = { text, style }.
// Barato: los mensajes que no son nuestros fallan el parseo/auth al instante (el tag GCM evita falsos positivos).
export function enrichCovert(key, items) {
  const pass = passFor(key); if (!pass || !Array.isArray(items)) return items
  for (const it of items) {
    if (!it || !it.text || it.mediaType || it.channel === "email" || it.channel === "meeting" || it.dir === "ai") continue
    try { const d = decodeCovert(it.text, pass); if (d) it.covert = { text: d.text, style: d.style } } catch {}
  }
  return items
}
