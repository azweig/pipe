// Descarga videos de links (Facebook / Instagram / TikTok / YouTube / Twitter-X) que llegan en los mensajes,
// los guarda en el CAS (dedup por hash) y los linkea al mensaje → se ven inline aunque después los borren del origen.
// Corre en el daemon cada ~4 min, throttled (pocos por corrida) para no gatillar bloqueos de IG/FB.
// Estado por URL en data/video-fetch-state.json → no reintenta infinito. Cookies opcionales en auth/cookies.txt (contenido privado).
import { execFileSync } from "child_process"
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync, statSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { videoCandidates, setVideoMedia } from "./lib/db.mjs"
import { casPutBuffer } from "./lib/cas.mjs"
import { shouldStoreMedia } from "./lib/media-policy.mjs"

const STATE = "./data/video-fetch-state.json"
const COOKIES = "./auth/cookies.txt"
const YTDLP = "/usr/local/bin/yt-dlp"
// Segundo motor de descarga: gallery-dl. Cubre casos donde yt-dlp falla (IG/TikTok/galerías de fotos) y también respeta auth/cookies.txt.
const GALLERYDL = ["/usr/bin/gallery-dl", "/usr/local/bin/gallery-dl"].find((p) => existsSync(p)) || "gallery-dl"
// Motor específico de Instagram: instaloader. Baja reels/posts PÚBLICOS SIN login (anónimo) — a bajo volumen IG no lo bloquea, solo throttlea (429).
// Como video-fetch ya está throttleado (MAX_PER_RUN + DELAY), encaja bien. Es el 1er intento para links de IG (antes que yt-dlp/gallery-dl que piden cookies).
const INSTALOADER = ["/root/.local/bin/instaloader", "/usr/local/bin/instaloader"].find((p) => existsSync(p)) || "instaloader"
const IG_SHORTCODE = /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i
const MAX_PER_RUN = parseInt(process.env.VIDEO_MAX_PER_RUN || "6") // descargas reales por corrida (throttle)
const MAX_ATTEMPTS = 3 // tras 3 fallos, se marca failed y no se reintenta
const MAX_FILESIZE = process.env.VIDEO_MAX_FILESIZE || "300M"
const DL_TIMEOUT = 120000 // 2 min por video
const DELAY_S = 4 // pausa entre descargas → suaviza rate-limits

const VIDEO_HOSTS = /(?:^|\.)(instagram\.com|tiktok\.com|facebook\.com|fb\.watch|youtube\.com|youtu\.be|twitter\.com|x\.com)$/i
const RE_URL = /https?:\/\/[^\s<>"']+/g

const loadState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {})
const saveState = (s) => writeFileSync(STATE, JSON.stringify(s))
const cleanUrl = (u) => u.replace(/[)>\].,;!?"'»]+$/, "") // quita puntuación pegada al final
function isVideoUrl(u) { try { return VIDEO_HOSTS.test(new URL(u).host.replace(/^www\./, "")) } catch { return false } }

// mensajes con link de video y sin media todavía (los más recientes primero)
function candidates() {
  const rows = videoCandidates()
  const out = []
  for (const r of rows) {
    const m = (r.text || "").match(RE_URL); if (!m) continue
    for (const raw of m) { const u = cleanUrl(raw); if (isVideoUrl(u)) { out.push({ id: r.id, url: u, thread: r.thread }); break } }
  }
  return out
}

// Instagram público con instaloader (anónimo, sin cookies). Devuelve {buf, ext} o null.
function downloadInstaloader(url, dir) {
  const m = String(url).match(IG_SHORTCODE); if (!m) return null
  try {
    // el "-<shortcode>" (con guión) le dice a instaloader que es un POST por shortcode, no un perfil. --dirname-pattern fija el dir plano.
    execFileSync(INSTALOADER, ["--quiet", "--no-metadata-json", "--no-captions", "--no-video-thumbnails", "--dirname-pattern=" + dir, "--", "-" + m[1]],
      { timeout: DL_TIMEOUT, stdio: "ignore", env: { ...process.env, PATH: (process.env.PATH || "") + ":/root/.local/bin" } })
    const vids = readdirSync(dir).filter((f) => /\.(mp4|mov|webm)$/i.test(f))
    const pick = vids[0] || readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort((a, b) => statSync(join(dir, b)).size - statSync(join(dir, a)).size)[0]
    if (!pick) return null
    const buf = readFileSync(join(dir, pick)); if (!buf.length) return null
    return { buf, ext: pick.split(".").pop().toLowerCase() || "mp4" }
  } catch { return null }
}

// baja UNA url a un dir temporal → {buf, ext} o null
function download(url) {
  const dir = mkdtempSync(join(tmpdir(), "vf-"))
  try {
    // Instagram → instaloader primero (baja público sin cookies); si no saca nada, sigue con yt-dlp/gallery-dl.
    if (IG_SHORTCODE.test(url)) { const ig = downloadInstaloader(url, dir); if (ig) return ig }
    const args = ["--no-playlist", "--no-warnings", "--quiet", "--no-progress", "--max-filesize", MAX_FILESIZE,
      "-f", "best[ext=mp4]/best", "-o", join(dir, "v.%(ext)s")]
    if (existsSync(COOKIES)) args.push("--cookies", COOKIES) // desbloquea IG/FB/TikTok privados
    args.push(url)
    execFileSync(YTDLP, args, { timeout: DL_TIMEOUT, stdio: "ignore" })
    const files = readdirSync(dir).filter((f) => f.startsWith("v.") && !f.endsWith(".part"))
    if (!files.length) return downloadGallery(url, dir) // yt-dlp no sacó nada → probar gallery-dl
    const buf = readFileSync(join(dir, files[0]))
    if (!buf.length) return downloadGallery(url, dir)
    return { buf, ext: files[0].split(".").pop() || "mp4" }
  } catch { return downloadGallery(url, dir) } finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
}

// Fallback con gallery-dl al MISMO dir temporal (el finally del caller lo limpia). Baja a plano con -D y agarra el archivo más grande.
function downloadGallery(url, dir) {
  try {
    const args = ["-q", "--no-mtime", "-D", dir, "--range", "1-4"]
    if (existsSync(COOKIES)) args.push("--cookies", COOKIES)
    args.push(url)
    execFileSync(GALLERYDL, args, { timeout: DL_TIMEOUT, stdio: "ignore" })
    const media = readdirSync(dir).filter((f) => /\.(mp4|mov|webm|mkv|jpg|jpeg|png|webp|gif)$/i.test(f) && !f.endsWith(".part"))
    if (!media.length) return null
    // preferir video; si no hay, la imagen más grande
    const pick = media.map((f) => ({ f, size: statSync(join(dir, f)).size, vid: /\.(mp4|mov|webm|mkv)$/i.test(f) }))
      .sort((a, b) => (b.vid - a.vid) || (b.size - a.size))[0]
    const buf = readFileSync(join(dir, pick.f))
    if (!buf.length) return null
    return { buf, ext: pick.f.split(".").pop().toLowerCase() || "mp4" }
  } catch { return null }
}

const AUTH_HOST = /instagram\.com|tiktok\.com|twitter\.com|x\.com/i // suelen requerir login → reintentar cuando lleguen cookies

function run() {
  if (!existsSync(YTDLP)) { console.log("[video] yt-dlp no instalado, skip"); return }
  const cookiesNow = existsSync(COOKIES)
  const state = loadState()
  // agrupar candidatos por URL → un intento por URL única por corrida, y linkea TODOS los mensajes que la comparten
  const byUrl = new Map()
  for (const c of candidates()) { if (!byUrl.has(c.url)) byUrl.set(c.url, { ids: [], threads: new Set() }); const e = byUrl.get(c.url); e.ids.push(c.id); if (c.thread) e.threads.add(c.thread) }
  let downloaded = 0, linked = 0
  for (const [url, { ids, threads }] of byUrl) {
    // respetar "no guardar media": si TODOS los chats donde apareció el link tienen media en "skip", no bajar el video (es media pesada)
    if (threads.size && ![...threads].some((t) => shouldStoreMedia(t, "video"))) continue
    const st = state[url] || { attempts: 0, status: "pending" }
    if (st.status === "done" && st.cas) { for (const id of ids) if (setVideoMedia(id, st.cas).changes) linked++; continue } // ya bajado → linkea
    if (st.status === "failed" || st.attempts >= MAX_ATTEMPTS) {
      // reintentar si AHORA hay cookies, antes no las había, y el host es de los que piden login (IG/TikTok privados)
      if (!(cookiesNow && !st.cookies && AUTH_HOST.test(url))) continue
      st.attempts = 0; st.status = "pending"
    }
    if (downloaded >= MAX_PER_RUN) continue // tope de descargas nuevas por corrida
    st.attempts++; st.cookies = cookiesNow
    const res = download(url)
    if (res) {
      const pub = casPutBuffer(res.buf, res.ext, `video:${url}`)
      for (const id of ids) if (setVideoMedia(id, pub).changes) linked++
      st.status = "done"; st.cas = pub; delete st.attempts
      downloaded++
      console.log(`[video] ✓ ${url} → ${pub} (${(res.buf.length / 1e6).toFixed(1)}MB, ${ids.length} msg)`)
    } else {
      st.status = st.attempts >= MAX_ATTEMPTS ? "failed" : "pending"
      console.log(`[video] ✗ ${url} (intento ${st.attempts}${st.status === "failed" ? ", descartado" : ""})`)
    }
    state[url] = st; saveState(state)
    if (downloaded < MAX_PER_RUN) { try { execFileSync("sleep", [String(DELAY_S)]) } catch {} } // throttle entre descargas
  }
  console.log(`[video] corrida: ${downloaded} descargados, ${linked} mensajes linkeados, ${byUrl.size} urls únicas`)
}

run()
