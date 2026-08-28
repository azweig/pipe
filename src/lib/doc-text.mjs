// TEXTO DE LOS ADJUNTOS — el cerebro solo veía la línea de chat. Todo lo que vive DENTRO de un archivo (contratos,
// adendas, facturas, planillas) le era invisible, así que contestaba "no hay información" teniendo el dato: la
// adenda de un cliente tenía el monto escrito en el PDF y la búsqueda juraba que no había ninguno.
//
// Estrategia PEREZOSA, no backfill: son 10.248 documentos y pasarlos todos por OCR son horas de GPU para texto que
// quizá nadie pregunte. En vez de eso, ante una consulta hacemos una PREBÚSQUEDA barata (nombre de archivo + texto
// del mensaje + hilo) para elegir unos pocos candidatos, y recién sobre ESOS extraemos. El resultado queda cacheado
// por ruta del CAS, así que un archivo se paga UNA vez aunque te lo hayan mandado cinco veces.
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { handle as db, withRetry } from "./db-core.mjs"
import { ocrCas, ocrEnabled } from "./ocr.mjs"

const MAX_CHARS = 20000 // un contrato entero no entra en el prompt; con esto alcanza y sobra para los datos duros

const extOf = (s) => (String(s || "").match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase()
const esOfficeZip = (e) => /^(docx|xlsx|pptx)$/.test(e)
const esOcr = (e) => /^(pdf|jpg|jpeg|png|webp|gif|bmp|tiff?)$/.test(e)
const esPlano = (e) => /^(txt|csv|md|json|log|xml|html?|vcf|srt)$/.test(e) // se leen directo: ni OCR ni descomprimir

// docx/xlsx/pptx son ZIP con XML adentro: se leen sin OCR y sin dependencias. `ocrCas` los rechaza (solo imagen/pdf),
// y son 2.282 archivos — los más numerosos después de los PDF.
function textoOffice(rutaAbs) {
  const py = `
import sys, zipfile, re
partes = []
try:
    z = zipfile.ZipFile(sys.argv[1])
    for n in z.namelist():
        if not n.endswith('.xml'): continue
        if not (n.startswith('word/') or n.startswith('xl/') or n.startswith('ppt/')): continue
        if 'theme' in n or 'settings' in n or 'styles' in n: continue
        try: s = z.read(n).decode('utf8', 'ignore')
        except Exception: continue
        s = re.sub(r'<[^>]+>', ' ', s)
        partes.append(s)
except Exception as e:
    sys.stderr.write(str(e)); sys.exit(1)
t = re.sub(r'\\s+', ' ', ' '.join(partes)).strip()
sys.stdout.write(t[:%d])
`.replace("%d", String(MAX_CHARS))
  const r = spawnSync("python3", ["-c", py, rutaAbs], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60000 })
  return r.status === 0 ? (r.stdout || "").trim() : ""
}

const leerCache = (media) => { try { return db().prepare("SELECT texto, err FROM doc_text WHERE media=?").get(media) || null } catch { return null } }
const guardarCache = (media, texto, err) => {
  try { withRetry(() => db().prepare("INSERT INTO doc_text (media, texto, chars, ts, err) VALUES (?,?,?,?,?) ON CONFLICT(media) DO UPDATE SET texto=excluded.texto, chars=excluded.chars, ts=excluded.ts, err=excluded.err")
    .run(media, texto || "", (texto || "").length, Date.now(), err || null)) } catch { /* si la base está trabada, se reintenta la próxima */ }
}

// Texto de UN adjunto. Cacheado: la segunda vez es gratis. "" si no se puede (y se anota, para no reintentar en vano).
export async function docTexto(media, filename = "") {
  if (!media) return ""
  const cache = leerCache(media)
  if (cache) return cache.texto || ""
  const ext = extOf(filename) || extOf(media)
  const ruta = "./data" + media
  if (!existsSync(ruta)) { guardarCache(media, "", "archivo ausente"); return "" }
  let texto = "", err = null
  try {
    if (esPlano(ext)) texto = readFileSync(ruta, "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    else if (esOfficeZip(ext)) texto = textoOffice(ruta)
    else if (esOcr(ext)) { if (!ocrEnabled()) err = "OCR apagado"; else texto = await ocrCas(media, { timeoutMs: 240000 }) }
    else err = "formato no soportado: " + (ext || "?")
  } catch (e) { err = e.message }
  texto = String(texto || "").slice(0, MAX_CHARS)
  guardarCache(media, texto, texto ? null : err || "sin texto")
  return texto
}

// PREBÚSQUEDA: elige qué documentos vale la pena abrir, SIN abrirlos. Puntúa por dónde aparecen las palabras de la
// pregunta: en el nombre del archivo pesa mucho (un "adenda-cliente-2025.pdf" es evidente), en el texto del mensaje
// que lo acompaña algo menos, y en el nombre del hilo un poco.
export function candidatos(pregunta, { limit = 4 } = {}) {
  const tokens = String(pregunta || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3)
  if (!tokens.length) return []
  const like = tokens.map(() => "(LOWER(COALESCE(filename,'')) LIKE ? OR LOWER(COALESCE(text,'')) LIKE ? OR LOWER(COALESCE(thread,'')) LIKE ?)").join(" OR ")
  const args = tokens.flatMap((t) => [`%${t}%`, `%${t}%`, `%${t}%`])
  let filas = []
  try {
    filas = db().prepare(`SELECT id, media, filename, text, thread, name, ts FROM messages
      WHERE mediaType IN ('document','file') AND media IS NOT NULL AND media<>'' AND (${like})
      ORDER BY ts DESC LIMIT 60`).all(...args)
  } catch { return [] }
  // TAMBIÉN por CONTENIDO ya extraído. La prebúsqueda por nombre de archivo tiene un límite de origen: no puede
  // encontrar lo que está DENTRO de un documento que todavía no abrió. Pero lo ya extraído queda en doc_text, así
  // que se busca ahí — y la búsqueda mejora sola a medida que se extraen más. (Caso real: la contraparte de un
  // contrato aparece en el cuerpo del PDF y en ninguna otra parte.)
  try {
    const likeTxt = tokens.map(() => "texto LIKE ?").join(" AND ") // TODOS los tokens: si no, "san" trae cualquier cosa
    const yaExtra = db().prepare(`SELECT media FROM doc_text WHERE texto IS NOT NULL AND texto<>'' AND (${likeTxt}) LIMIT 20`).all(...tokens.map((t) => `%${t}%`))
    if (yaExtra.length) {
      const medias = yaExtra.map((r) => r.media)
      const extra = db().prepare(`SELECT id, media, filename, text, thread, name, ts FROM messages
        WHERE media IN (${medias.map(() => "?").join(",")}) GROUP BY media ORDER BY ts DESC`).all(...medias)
      for (const r of extra) if (!filas.some((f) => f.media === r.media)) filas.push({ ...r, _porContenido: true })
    }
  } catch { /* sin doc_text todavía: seguimos solo con el nombre */ }
  const puntuar = (r) => {
    const fn = String(r.filename || "").toLowerCase(), tx = String(r.text || "").toLowerCase(), th = String(r.thread || "").toLowerCase()
    let p = 0
    for (const t of tokens) { if (fn.includes(t)) p += 10; if (tx.includes(t)) p += 3; if (th.includes(t)) p += 2 }
    if (r._porContenido) p += 12 // el texto del documento MENCIONA lo que preguntás: es la señal más fuerte que hay
    return p
  }
  // dedup por ruta del CAS: el mismo contrato reenviado 5 veces es UN documento, no cinco candidatos
  const porMedia = new Map()
  for (const r of filas) { const p = puntuar(r); const prev = porMedia.get(r.media); if (!prev || p > prev.p) porMedia.set(r.media, { ...r, p }) }
  return [...porMedia.values()].sort((a, b) => b.p - a.p || (b.ts || 0) - (a.ts || 0)).slice(0, limit)
}

// Prebúsqueda + extracción de los elegidos. Es lo que consume el cerebro.
export async function docsRelevantes(pregunta, { limit = 4, excluir = () => false } = {}) {
  const out = []
  for (const c of candidatos(pregunta, { limit: limit * 2 })) {
    if (out.length >= limit) break
    if (excluir(c)) continue // hilos/mensajes secretos: nunca salen del gate
    const texto = await docTexto(c.media, c.filename).catch(() => "")
    if (texto && texto.length > 40) out.push({ ...c, texto })
  }
  return out
}
