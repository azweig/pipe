// Resume con IA los emails con cuerpo en una frase tipo "tweet pitch", para saber de qué van sin abrirlos.
// Corre en el daemon (throttled). Cascada para emails-imagen: tesseract (OCR local, gratis) → si saca texto lo resume el modelo local; si no, visión Gemini.
import { emailsToSummarize, setMessageSummary } from "./lib/db.mjs"
import { llm, visionLLM, smartChain, featureWantsCloud } from "./lib/llm.mjs"
import { execFileSync } from "node:child_process"
import { writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lookup } from "node:dns/promises"
import net from "node:net"

// SSRF guard: el email es el input más HOSTIL (cualquiera te escribe). Un <img src="http://169.254.169.254/..."> haría
// que el server pegue a metadata/hosts internos. Resolvemos el host y bloqueamos IPs privadas/loopback/link-local/metadata.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number); return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224 }
  const x = String(ip).toLowerCase()
  return x === "::1" || x.startsWith("fe80") || x.startsWith("fc") || x.startsWith("fd") || /^::ffff:(127|10|0)\./.test(x) || x.startsWith("::ffff:192.168") || x.startsWith("::ffff:169.254")
}
async function safeToFetch(u) {
  try {
    const { hostname } = new URL(u); if (!hostname) return false
    if (net.isIP(hostname.replace(/^\[|\]$/g, ""))) return !isPrivateIp(hostname.replace(/^\[|\]$/g, ""))
    const { address } = await lookup(hostname); return !isPrivateIp(address) // bloquea DNS que apunte a IP interna
  } catch { return false }
}

const cleanPitch = (s) => String(s || "").trim().replace(/^["'“”]+|["'“”]+$/g, "").split("\n")[0].slice(0, 180)

// OCR local con tesseract (español+inglés). Gratis e instantáneo; bueno para texto plano, flojo en banners estilizados.
function ocrImage(buf, i) {
  const f = join(tmpdir(), `es-ocr-${process.pid}-${i}.png`)
  try { writeFileSync(f, buf); return execFileSync("tesseract", [f, "stdout", "-l", "spa+eng"], { timeout: 20000, stdio: ["ignore", "pipe", "ignore"] }).toString().replace(/\s+/g, " ").trim() }
  catch { return "" } finally { try { unlinkSync(f) } catch {} }
}

// extrae imágenes REALES del HTML del email (data-uri inline o URLs http), salta píxeles de tracking. Devuelve [{mime,data(base64)}].
async function emailImages(html) {
  const urls = [...String(html || "").matchAll(/<img[^>]+src\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]).filter(Boolean)
  const out = []
  for (const u of urls) {
    if (out.length >= 3) break
    try {
      if (u.startsWith("data:image/")) { const m = u.match(/^data:(image\/[^;]+);base64,(.+)$/); if (m && m[2].length > 3000) out.push({ mime: m[1], data: m[2] }); continue }
      if (!/^https?:\/\//i.test(u)) continue
      if (!(await safeToFetch(u))) continue // SSRF: no pegar a IPs internas/metadata
      const r = await fetch(u, { signal: AbortSignal.timeout(8000), redirect: "error" })
      if (!r.ok) continue
      const mime = r.headers.get("content-type") || "image/png"
      if (!/^image\//.test(mime)) continue
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 2500 || buf.length > 5_000_000) continue // salta píxeles de tracking (chicos) y monstruos
      out.push({ mime, data: buf.toString("base64") })
    } catch { /* imagen inaccesible → skip */ }
  }
  return out
}

// HTML → texto plano (para darle contenido legible al modelo)
const stripHtml = (h) => (h || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<(br|\/p|\/div|\/tr|\/li)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#\d+;/g, " ")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()

// solo emails CON cuerpo (los recientes + nuevos) y sin resumen → naturalmente acotado, no toca el historial viejo sin body
const rows = emailsToSummarize()
let done = 0

for (const r of rows) {
  const subject = (r.text || "").split(" — ")[0]
  const content = stripHtml(r.body || "").slice(0, 4000)
  // email SIN texto (pura imagen) → visión: descargamos la(s) imagen(es) y las lee Gemini
  if (content.replace(/\s/g, "").length < 15) {
    // no gastar visión en marketing (se oculta como spam igual)
    if (/temu|shein|falabella|mallplaza|ticketmaster|ripley|aliexpress|oferta|descuento|promo|exclusiv|newsletter|% off/i.test(`${subject} ${r.name}`)) { setMessageSummary(r.id, "📷 Email promocional (imagen). Abrilo para verlo."); continue }
    const imgs = await emailImages(r.body || "")
    if (imgs.length) {
      // 1) OCR local (tesseract) — gratis. Si saca texto útil, lo resume el modelo LOCAL.
      let ocr = ""
      for (let i = 0; i < imgs.length; i++) { ocr += " " + ocrImage(Buffer.from(imgs[i].data, "base64"), i); if (ocr.replace(/\s/g, "").length > 400) break }
      ocr = ocr.replace(/\s+/g, " ").trim()
      if (ocr.replace(/[^a-záéíóúñ0-9]/gi, "").length > 40) {
        try {
          let s = cleanPitch(await llm(`Asunto: ${subject}\nDe: ${r.name}\nTexto extraído (OCR) del email:\n${ocr.slice(0, 3000)}\n\nUNA frase corta (máx 18 palabras) en español con lo esencial/accionable. Directo, sin comillas.`, { chain: smartChain({ sensitive: true, feature: "email" }), model: process.env.EMAIL_SUM_MODEL || "qwen2.5:3b", temperature: 0.2, raw: true }))
          if (s) { setMessageSummary(r.id, s); done++; console.log(`[email-sum] 🔤ocr ${subject.slice(0, 24)} → ${s.slice(0, 50)}`); continue }
        } catch { /* cae a visión */ }
      }
      // 2) OCR flojo (banner estilizado) → visión Gemini. SOLO si el hub eligió nube para "email": la visión no existe en local,
      // así que respetar el toggle = no mandar la imagen a Gemini si el usuario pidió email local.
      if (!featureWantsCloud("email")) { setMessageSummary(r.id, "📷 Email de imágenes — abrilo para verlo."); continue }
      try {
        const vp = `Email de "${r.name}", asunto "${subject}". Mirá la imagen y escribí UNA frase corta (máx 18 palabras) en español con lo esencial/accionable (monto, oferta, dato clave, estado). Directo, sin comillas ni "el email dice".`
        const s = cleanPitch(await visionLLM(vp, imgs, { temperature: 0.2 }))
        if (s) { setMessageSummary(r.id, s); done++; console.log(`[email-sum] 👁 ${subject.slice(0, 26)} → ${s.slice(0, 55)}`); continue }
      } catch (e) { console.log(`[email-sum] vision err ${subject.slice(0, 20)}: ${e.message}`) }
    }
    setMessageSummary(r.id, "📷 Email de imágenes — abrilo para verlo."); continue
  }
  const prompt = `Asunto: ${subject}\nDe: ${r.name}\n\nContenido del email:\n${content}\n\nEscribe UNA sola frase corta (máximo 18 palabras), en español, con lo esencial y accionable de este email — como un tweet. Directo, sin "el email dice" ni comillas. Si es una notificación (banco, compra, envío, factura) incluí el dato clave (monto, operación, estado, fecha).`
  try {
    let s = await llm(prompt, { chain: smartChain({ sensitive: true, feature: "email" }), model: process.env.EMAIL_SUM_MODEL || "qwen2.5:3b", temperature: 0.2, raw: true }) // cuerpos de email = sensible → smartChain (era `|| "ollama,gemini"` = fail-open standalone)
    s = String(s || "").trim().replace(/^["'“”]+|["'“”]+$/g, "").split("\n")[0].slice(0, 180)
    if (s) { setMessageSummary(r.id, s); done++; console.log(`[email-sum] ${subject.slice(0, 28)} → ${s.slice(0, 60)}`) }
  } catch (e) { console.log(`[email-sum] err ${subject.slice(0, 24)}: ${e.message}`) }
}
console.log(`[email-sum] ${done}/${rows.length} resumidos`)
