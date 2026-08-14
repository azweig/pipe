// Lista los archivos del CAS que pertenecen a una cuenta/número SECRETO, en rutas relativas a data/cas
// (el formato que espera `rclone --exclude-from`). Uso: node scripts/cas-secretos.mjs
//
// Por qué existe: el bundle del backup va cifrado, pero los 64GB de media se suben aparte con `rclone copy` y ahí van
// EN CLARO, tal cual, al almacenamiento de un tercero. Una foto o una nota de voz de una cuenta secreta no puede salir
// así. Sin un remoto cifrado, la única opción honesta es no subirlas — y decirlo, en vez de subirlas en silencio.
import { isSecretRow } from "../src/lib/secret.mjs"
import { handle } from "../src/lib/db-core.mjs"

import { existsSync } from "fs"

// Fallar cerrado de verdad: una lista vacía es indistinguible de "no pude mirar". Si la base no está o no tiene filas,
// se sale con error para que el backup NO suba nada sin cifrar, en vez de subirlo todo en silencio.
if (!existsSync("./data/messages.db")) {
  console.error("[cas-secretos] no encuentro data/messages.db → no puedo decidir qué es secreto")
  process.exit(1)
}

try {
  const rows = handle().prepare(
    "SELECT DISTINCT media, thread, channel, account, jid FROM messages WHERE media IS NOT NULL AND media != ''"
  ).all()
  const total = handle().prepare("SELECT COUNT(*) c FROM messages").get().c
  if (!total) { console.error("[cas-secretos] la base no tiene mensajes → no puedo decidir qué es secreto"); process.exit(1) }
  const fuera = new Set()
  for (const r of rows) {
    if (!isSecretRow(r)) continue
    const rel = String(r.media).replace(/^\/?(cas|media)\//, "") // /cas/ab/hash.jpg → ab/hash.jpg
    if (rel) fuera.add(rel)
  }
  // adjuntos de correo: no están en `media` sino en la columna `attachments` (JSON [{name,cas,…}])
  for (const r of handle().prepare("SELECT thread, channel, account, jid, attachments FROM messages WHERE attachments IS NOT NULL AND attachments != ''").all()) {
    if (!isSecretRow(r)) continue
    let arr = []; try { arr = JSON.parse(r.attachments) || [] } catch { continue }
    for (const a of arr) { const rel = String(a?.cas || "").replace(/^\/?(cas|media)\//, ""); if (rel) fuera.add(rel) }
  }
  for (const f of fuera) console.log(f)
  if (fuera.size) console.error(`[cas-secretos] ${fuera.size} archivos de cuentas secretas quedan FUERA del offsite sin cifrar`)
} catch (e) {
  // fallar cerrado: sin lista no se puede distinguir, así que el llamador debe abortar la subida
  console.error("[cas-secretos] no pude calcular la lista:", e?.message || e)
  process.exit(1)
}
