#!/usr/bin/env node
// Sube el backup CIFRADO a TU Google Drive. Se conecta desde la Consola ("Conectar → Permitir"), no por SSH.
//
// Qué sube: el último bundle `pipe-*.tar.zst.enc` — base de datos, configuración y credenciales, ya cifrado con
// tu passphrase (secrets/backup.pass). Google guarda un blob que no puede leer.
// Qué NO sube: los 60GB de media (data/cas). Eso es aparte y depende de tu plan de Drive: `--media` lo incluye.
//
// Permiso: `drive.file` → pipe solo ve los archivos que él mismo creó. No puede leer el resto de tu Drive.
// Uso:  node scripts/backup-drive.mjs [--keep N] [--dry]
import { createReadStream, existsSync, readdirSync, statSync } from "fs"
import { loadEnv } from "../src/lib/env.mjs"
import { backupDrive, backupStatus } from "../src/lib/google.mjs"

loadEnv()
const args = process.argv.slice(2)
const dry = args.includes("--dry")
const KEEP = +(args[args.indexOf("--keep") + 1] || 0) || 5
const CARPETA = "Pipe Backups"

const st = backupStatus()
if (!st.connected) { console.log("[backup-drive] Drive no conectado — conectalo desde la Consola (Configuración → Backup)."); process.exit(0) }
const drive = backupDrive()
if (!drive) { console.error("[backup-drive] falta el client OAuth (GOOGLE_CLIENT_ID/SECRET)"); process.exit(1) }

// último bundle local
const DIR = "./data/backups"
if (!existsSync(DIR)) { console.error("[backup-drive] no hay " + DIR); process.exit(1) }
const bundles = readdirSync(DIR).filter((f) => /^pipe-.*\.tar\.zst\.enc$/.test(f)).sort()
if (!bundles.length) { console.error("[backup-drive] no encontré ningún bundle"); process.exit(1) }
const ultimo = bundles[bundles.length - 1]
const ruta = `${DIR}/${ultimo}`, tam = statSync(ruta).size
// en GB a partir del giga: "1540MB" se lee mucho peor que "1.5GB" y confunde sobre la escala real
const mb = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + "GB" : (b / 1048576).toFixed(0) + "MB"

// carpeta propia (la crea la primera vez). Con drive.file solo vemos lo NUESTRO, así que este listado ya está acotado.
async function carpetaId() {
  const q = `name='${CARPETA}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 })
  if (r.data.files?.length) return r.data.files[0].id
  const c = await drive.files.create({ requestBody: { name: CARPETA, mimeType: "application/vnd.google-apps.folder" }, fields: "id" })
  return c.data.id
}

const fid = await carpetaId()
const yaEstan = (await drive.files.list({ q: `'${fid}' in parents and trashed=false`, fields: "files(id,name,size,createdTime)", pageSize: 100 })).data.files || []
if (yaEstan.some((f) => f.name === ultimo)) { console.log(`[backup-drive] ${ultimo} ya está en Drive (${mb(tam)}) — nada que hacer`); process.exit(0) }
if (dry) { console.log(`[backup-drive] SUBIRÍA ${ultimo} (${mb(tam)}) a "${CARPETA}" de ${st.email}; ya hay ${yaEstan.length}`); process.exit(0) }

console.log(`[backup-drive] subiendo ${ultimo} (${mb(tam)}) a "${CARPETA}" de ${st.email}…`)
const t0 = Date.now()
await drive.files.create({
  requestBody: { name: ultimo, parents: [fid] },
  media: { mimeType: "application/octet-stream", body: createReadStream(ruta) },
  fields: "id,size",
})
console.log(`[backup-drive] ✓ subido en ${Math.round((Date.now() - t0) / 1000)}s`)

// ROTACIÓN: dejamos los KEEP más nuevos. Sin esto el Drive se llena solo (1.6GB por día).
const todos = [...yaEstan, { name: ultimo }].sort((a, b) => a.name.localeCompare(b.name))
const sobran = todos.slice(0, Math.max(0, todos.length - KEEP)).filter((f) => f.id)
for (const f of sobran) { try { await drive.files.delete({ fileId: f.id }); console.log(`  borrado viejo: ${f.name}`) } catch (e) { console.log(`  no pude borrar ${f.name}: ${e.message}`) } }
console.log(`[backup-drive] listo · ${Math.min(todos.length, KEEP)} copias en Drive`)
