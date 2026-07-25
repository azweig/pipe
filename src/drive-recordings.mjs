// Ingester de GRABACIONES desde Google Drive → notetaker. AGNÓSTICO A LA APP: agarra cualquier grabación de audio nueva
// que aparezca en Drive (Google Meet, Cube ACR, CallApp, Any Call, el grabador que sea), se llame como se llame la carpeta.
// Criterio: archivo de audio/video, reciente, cuyo NOMBRE o CARPETA sugiera "grabación/llamada". Inalámbrico, sin cables/adb.
import { google } from "googleapis"
import { googleAccounts, oauthClient, hasToken } from "./lib/google.mjs"
import { ingestRecording } from "./lib/meetings.mjs"
import { readFileSync, writeFileSync, existsSync } from "fs"

const SEEN_F = "./data/drive-recordings-seen.json"
const seen = new Set(existsSync(SEEN_F) ? JSON.parse(readFileSync(SEEN_F, "utf8")) : [])
const saveSeen = () => writeFileSync(SEEN_F, JSON.stringify([...seen]))

// SOLO grabaciones desde que se activó el feature (evita años de audio viejo). DRIVE_REC_SINCE=YYYY-MM-DD para backfill.
const CUTOFF = process.env.DRIVE_REC_SINCE ? new Date(process.env.DRIVE_REC_SINCE).getTime() : Date.now() - 2 * 86400000
const AUDIO_EXT = /\.(m4a|mp3|amr|ogg|opus|wav|aac|3gp|flac|mp4|webm|mov)$/i
// nombre de archivo o de carpeta que delata una grabación de llamada/reunión (multi-idioma + número de teléfono)
const REC_HINT = /call|rec(ord|-|\b)|llamad|grab|reunion|reunión|meet|voice|voz|conversa|\+?\d{8,}/i
// carpetas de grabadores conocidos (si el nombre matchea, se acepta cualquier audio adentro aunque el archivo no tenga hint)
const REC_FOLDER = /call|rec|llamad|grab|meet|cube|acr|voice|conversa/i

async function parentName(drive, id, cache) {
  if (!id) return ""
  if (cache.has(id)) return cache.get(id)
  try { const { data } = await drive.files.get({ fileId: id, fields: "name" }); cache.set(id, data.name || ""); return data.name || "" }
  catch { cache.set(id, ""); return "" }
}

async function scan() {
  const accts = googleAccounts().filter((a) => hasToken(a.label))
  if (!accts.length) return
  let ingested = 0
  for (const a of accts) {
    const drive = google.drive({ version: "v3", auth: oauthClient(a.label) })
    const folderCache = new Map()
    // traer archivos recientes que sean audio/video (por mimeType O por extensión — algunos grabadores usan octet-stream)
    const q = "trashed=false and (mimeType contains 'audio/' or mimeType contains 'video/' or name contains '.m4a' or name contains '.mp3' or name contains '.amr' or name contains '.ogg' or name contains '.wav' or name contains '.aac' or name contains '.3gp')"
    const { data } = await drive.files.list({ q, orderBy: "modifiedTime desc", fields: "files(id,name,mimeType,size,modifiedTime,createdTime,parents)", pageSize: 150 }).catch(() => ({ data: { files: [] } }))
    for (const k of data.files || []) {
      if (seen.has(k.id)) continue
      if (!AUDIO_EXT.test(k.name || "") && !/^(audio|video)\//.test(k.mimeType || "")) continue
      const mt = new Date(k.modifiedTime || k.createdTime || 0).getTime()
      if (mt < CUTOFF) { seen.add(k.id); continue } // vieja → marcar vista sin ingerir
      const folder = await parentName(drive, k.parents?.[0], folderCache)
      // aceptar si el nombre del archivo o de la carpeta delata una grabación (evita agarrar música/notas de voz random)
      if (!REC_HINT.test(k.name || "") && !REC_FOLDER.test(folder)) { seen.add(k.id); continue }
      try {
        const { data: bin } = await drive.files.get({ fileId: k.id, alt: "media" }, { responseType: "arraybuffer" })
        const buf = Buffer.from(bin)
        const ext = (k.name.split(".").pop() || "").toLowerCase()
        const title = k.name.replace(AUDIO_EXT, "").replace(/[_-]+/g, " ").trim() || "Grabación"
        const r = await ingestRecording({ audioBuffer: buf, ext, title, ts: mt, source: `drive:${a.label}` })
        console.log(`[drive-rec] ${folder}/${k.name} (${Math.round(buf.length / 1024)}KB) → ${r.id || r.error}`)
        seen.add(k.id); saveSeen(); ingested++
      } catch (e) { console.log(`[drive-rec] error ${k.name}: ${e.message}`) }
    }
  }
  if (ingested) console.log(`✅ [drive-rec] ${ingested} grabación(es) nueva(s) ingerida(s)`)
}

await scan()
