// Google Drive reader (OAuth, googleapis) — LECTURA de archivos. Reusa el MISMO cliente OAuth que el calendario.
// Necesita: habilitar "Google Drive API" en el proyecto de Google Cloud + scope drive.readonly (reautorizás 1 vez).
// Lista archivos recientes → data/drive.jsonl. Puede leer/exportar el contenido de un archivo (getContent).
import { google } from "googleapis"
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "fs"
import http from "http"

mkdirSync("./data", { recursive: true })
const cfg = JSON.parse(readFileSync("./auth/google-oauth.json", "utf8"))
const tokenFile = "./auth/google-drive-token.json" // token propio (scope distinto al calendario)
const REDIRECT = "http://localhost:53682/oauth2callback"
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
const POLL_MS = 180000

const oauth2 = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, REDIRECT)
oauth2.on("tokens", (t) => { const cur = existsSync(tokenFile) ? JSON.parse(readFileSync(tokenFile, "utf8")) : {}; writeFileSync(tokenFile, JSON.stringify({ ...cur, ...t })) })

async function authorize() {
  if (existsSync(tokenFile)) { oauth2.setCredentials(JSON.parse(readFileSync(tokenFile, "utf8"))); return }
  const url = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES })
  console.log(`\n🔑 [drive] ABRÍ ESTE LINK Y AUTORIZÁ (misma cuenta):\n\n${url}\n`)
  const code = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith("/oauth2callback")) { const c = new URL(req.url, REDIRECT).searchParams.get("code"); res.end("pipe: Drive listo, cerrá la pestaña."); server.close(); resolve(c) }
    }).listen(53682)
  })
  const { tokens } = await oauth2.getToken(code); oauth2.setCredentials(tokens); writeFileSync(tokenFile, JSON.stringify(tokens))
  console.log("✅ [drive] token guardado.")
}

const drive = google.drive({ version: "v3", auth: oauth2 })

async function poll() {
  const { data } = await drive.files.list({
    orderBy: "modifiedTime desc", pageSize: 50, spaces: "drive",
    fields: "files(id,name,mimeType,modifiedTime,size,owners(displayName),webViewLink,parents)",
    q: "trashed = false",
  })
  const files = data.files || []
  const lines = files.map((f) => JSON.stringify({
    channel: "drive", account: "google", id: f.id, name: f.name, mime: f.mimeType,
    modified: f.modifiedTime, size: f.size || "", owner: f.owners?.[0]?.displayName || "", url: f.webViewLink || "",
  }))
  writeFileSync("./data/drive.jsonl", lines.join("\n") + (lines.length ? "\n" : ""))
  console.log(`📁 [drive-google] ${files.length} archivos recientes:`)
  for (const f of files.slice(0, 12)) console.log(`   • ${(f.modifiedTime || "").slice(0, 10)}  ${f.name}`)
}

// lee el contenido de un archivo (export de Google Docs a texto, o descarga directa)
export async function getContent(fileId, mime) {
  if ((mime || "").startsWith("application/vnd.google-apps")) {
    const exportMap = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" }
    const to = exportMap[mime] || "text/plain"
    const res = await drive.files.export({ fileId, mimeType: to }, { responseType: "text" })
    return res.data
  }
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" })
  return Buffer.from(res.data)
}

await authorize()
console.log(`\n✅ [drive-google] CONECTADO — listando cada ${POLL_MS / 60000} min...\n`)
await poll()
setInterval(() => poll().catch((e) => console.log("[drive] err:", e.message)), POLL_MS)
