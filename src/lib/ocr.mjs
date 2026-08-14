// OCR LOCAL (opcional) — Unlimited-OCR corriendo en la GPU box. Extrae texto de imágenes/PDFs (facturas, documentos)
// SIN mandarlos a la nube. Se activa seteando OCR_URL (+ OCR_TOKEN) en el .env. Si no está, el hub sigue usando
// Gemini multimodal como siempre. Ver project_comms_hub_native_app / infra GPU.
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const ocrUrl = () => (process.env.OCR_URL || "").replace(/\/$/, "")
const ocrToken = () => process.env.OCR_TOKEN || ""
export function ocrEnabled() { return !!ocrUrl() }
export const ocrUrlActual = () => ocrUrl() // para decidir si se le puede mandar un archivo de una cuenta secreta

// OCR de un archivo del CAS (/cas/xx/hash.ext) → texto plano. "" si está deshabilitado, no existe, o falla.
export async function ocrCas(casPath, { timeoutMs = 180000 } = {}) {
  if (!ocrUrl() || !casPath) return ""
  const ext = String(casPath).split(".").pop()?.toLowerCase() || ""
  if (!/^(jpg|jpeg|png|webp|gif|bmp|tiff?|pdf)$/.test(ext)) return "" // solo imágenes/PDF
  const full = join(process.cwd(), "data", String(casPath).replace(/^\//, ""))
  if (!existsSync(full)) return ""
  try {
    const buf = readFileSync(full)
    const fd = new FormData()
    fd.append("file", new Blob([buf]), casPath.split("/").pop() || ("file." + ext))
    const r = await fetch(ocrUrl() + "/ocr", { method: "POST", headers: { Authorization: "Bearer " + ocrToken() }, body: fd, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return ""
    const j = await r.json().catch(() => ({}))
    return String(j.text || "").trim()
  } catch { return "" }
}
