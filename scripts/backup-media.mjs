// BACKUP DE LA MEDIA (data/cas) A TU GOOGLE DRIVE — cifrado, por lotes e incremental.
//
// El backup diario (backup.sh + backup-drive.mjs) sube 1,6 GB: la base, los configs y auth/. Deja AFUERA los ~60 GB
// del CAS, o sea todas tus fotos, audios y videos. El índice (cas.db) sí se respalda, así que un restore sabría qué
// archivos DEBERÍA haber… y no tendría ninguno. Esto cierra ese hueco.
//
// Por qué por LOTES y no archivo por archivo: son ~240k blobs. Subirlos de a uno tarda días y come el rate limit de
// Drive. El CAS está repartido en 256 carpetas (cas/<2 hex>/), así que subimos un .tar.zst.enc por carpeta: ~256
// piezas de ~235 MB, cada una verificable y re-subible sola.
//
// INCREMENTAL: el CAS es inmutable (el nombre del archivo ES su hash), así que una carpeta solo CRECE. Guardamos
// cuántos archivos y cuántos bytes tenía cada lote al subirlo; si no cambió, se saltea. Cortar el proceso a la mitad
// y volver a lanzarlo retoma donde quedó.
//
// Uso:  node scripts/backup-media.mjs           → sube lo que falte
//       node scripts/backup-media.mjs --dry     → solo dice qué haría
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, createReadStream, unlinkSync } from "fs"
import { execFileSync, spawnSync } from "child_process"
import { loadEnv } from "../src/lib/env.mjs"
loadEnv()
const { backupDrive, backupStatus } = await import("../src/lib/google.mjs")

const CAS = "./data/cas"
const PASS = "secrets/backup.pass"
const ESTADO = "./data/backup-media-estado.json"
const CARPETA = "pipe-backups-media"
const TMP = "./data/tmp"
const DRY = process.argv.includes("--dry")
// --limit N: subir solo N lotes por corrida. Sirve para probar y para ir de a poco sin dejar el proceso horas colgado.
const LIMITE = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || 0)

if (!existsSync(CAS)) { console.error(`no existe ${CAS}`); process.exit(1) }
if (!existsSync(PASS)) { console.error(`falta la passphrase (${PASS})`); process.exit(1) }
const st = backupStatus()
if (!st || !st.connected) { console.error("Drive no está conectado (Consola → Backup → Conectar)"); process.exit(1) }

// huella de un lote: cuántos archivos y cuántos bytes. Con el CAS inmutable alcanza para saber si cambió.
function huella(dir) {
  let n = 0, bytes = 0
  for (const f of readdirSync(dir)) {
    try { const s = statSync(`${dir}/${f}`); if (s.isFile()) { n++; bytes += s.size } } catch { /* archivo que se fue: no cuenta */ }
  }
  return { n, bytes }
}

const estado = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, "utf8")) : {}
const lotes = readdirSync(CAS).filter((d) => { try { return statSync(`${CAS}/${d}`).isDirectory() } catch { return false } }).sort()

let pendientes = [], totalBytes = 0, yaBytes = 0
for (const l of lotes) {
  const h = huella(`${CAS}/${l}`)
  const prev = estado[l]
  if (prev && prev.n === h.n && prev.bytes === h.bytes) { yaBytes += h.bytes; continue }
  pendientes.push({ lote: l, ...h }); totalBytes += h.bytes
}
const gb = (b) => (b / 1073741824).toFixed(2)
console.log(`CAS: ${lotes.length} lotes · ya respaldados ${gb(yaBytes)} GB · faltan ${pendientes.length} lotes (${gb(totalBytes)} GB)`)
if (DRY || !pendientes.length) { if (!pendientes.length) console.log("✅ nada que subir: la media está al día"); process.exit(0) }
if (LIMITE > 0) { pendientes = pendientes.slice(0, LIMITE); totalBytes = pendientes.reduce((a, x) => a + x.bytes, 0); console.log(`  (limitado a ${pendientes.length} lotes = ${gb(totalBytes)} GB)`) }

const drive = backupDrive()
async function carpetaId() {
  const q = `name='${CARPETA}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 })
  if (r.data.files?.length) return r.data.files[0].id
  const c = await drive.files.create({ requestBody: { name: CARPETA, mimeType: "application/vnd.google-apps.folder" }, fields: "id" })
  return c.data.id
}
const fid = await carpetaId()
// lo que ya está arriba (por nombre) → si el proceso murió después de subir pero antes de anotar, no re-subimos
const arriba = new Map()
let page = null
do {
  const r = await drive.files.list({ q: `'${fid}' in parents and trashed=false`, fields: "nextPageToken, files(id,name,size)", pageSize: 200, pageToken: page })
  for (const f of r.data.files || []) arriba.set(f.name, f)
  page = r.data.nextPageToken
} while (page)

let hechos = 0, subidos = 0
for (const p of pendientes) {
  const nombre = `cas-${p.lote}.tar.zst.enc`
  const tmp = `${TMP}/${nombre}`
  // tar → zstd → openssl, igual que el backup diario (misma passphrase, mismo descifrado)
  const cmd = `tar -cf - -C ${CAS} ${p.lote} | zstd -q -3 | openssl enc -aes-256-cbc -md sha512 -pbkdf2 -iter 200000 -salt -pass file:${PASS} > ${tmp}.partial`
  const r = spawnSync("bash", ["-c", `set -o pipefail; ${cmd}`], { encoding: "utf8" })
  if (r.status !== 0) { console.error(`  ✗ ${p.lote}: falló el cifrado (${(r.stderr || "").trim().slice(0, 120)})`); continue }
  execFileSync("mv", ["-f", `${tmp}.partial`, tmp]) // atómico: nunca subimos un .enc truncado
  try {
    const viejo = arriba.get(nombre)
    if (viejo) await drive.files.delete({ fileId: viejo.id }).catch(() => {}) // el lote creció → reemplazamos
    await drive.files.create({
      requestBody: { name: nombre, parents: [fid] },
      media: { mimeType: "application/octet-stream", body: createReadStream(tmp) },
      fields: "id,size",
    })
    estado[p.lote] = { n: p.n, bytes: p.bytes, ts: Date.now() }
    writeFileSync(ESTADO, JSON.stringify(estado, null, 1)) // anotamos DESPUÉS de subir: si morimos antes, se reintenta
    subidos += p.bytes; hechos++
    console.log(`  ✓ ${p.lote} (${p.n} archivos, ${gb(p.bytes)} GB) · ${hechos}/${pendientes.length} · ${gb(subidos)}/${gb(totalBytes)} GB`)
  } catch (e) {
    console.error(`  ✗ ${p.lote}: ${e.message}`)
  } finally {
    try { unlinkSync(tmp) } catch { /* ya no está */ }
  }
}
console.log(`\nlistos ${hechos}/${pendientes.length} lotes · ${gb(subidos)} GB subidos`)
