// VISOR DE DOCUMENTOS — hasta acá un PDF que te mandaban era un callejón sin salida: la app lo mostraba como
// "Abrir / descargar" y para leerlo tenías que sacarlo de la app. Acá se convierte a PÁGINAS (imágenes) que las tres
// apps pueden mostrar igual: la web y el desktop las pintan, y mobile las mete en un <Image> — sin WebView, sin
// módulo nativo, sin romper Expo Go.
//
// Por qué en el servidor y no con pdf.js en cada cliente: una implementación en vez de tres, cero dependencias
// nuevas en un `public/` que no tiene build, y sobre todo NINGÚN archivo ajeno se parsea dentro del cliente — el
// mismo criterio que puso el iframe sin allow-scripts en el visor de correo. El precio es que no se puede
// seleccionar texto sobre la página; para eso está la vista de texto (docTexto).
//
// Todo local: poppler y LibreOffice corren en el hub. Un contrato no sale de la caja para poder mirarlo.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"

const RAIZ = "./data/docview"
const MAX_PAGINAS = +process.env.DOCVIEW_MAX_PAGES || 100 // un PDF de 500 páginas son 500 imágenes que nadie va a mirar
const DPI = +process.env.DOCVIEW_DPI || 110              // legible en celular sin que cada página pese de más
const CALIDAD = +process.env.DOCVIEW_JPEG_Q || 82
const T_OFFICE = +process.env.DOCVIEW_SOFFICE_MS || 90000
const T_PDF = +process.env.DOCVIEW_PDFTOPPM_MS || 120000

const extDe = (s) => (String(s || "").match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase()
const hashDe = (media) => String(media || "").split("/").pop().split(".")[0]

const ES_PDF = (e) => e === "pdf"
const ES_OFFICE = (e) => /^(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/.test(e)
export const esVisualizable = (nombre) => { const e = extDe(nombre); return ES_PDF(e) || ES_OFFICE(e) }

// XLSX abre en TABLA y no en página: LibreOffice parte las columnas anchas entre hojas y una planilla real queda
// ilegible partida en cuatro. PDF y DOCX al revés, que es donde la vista fiel sirve (firmas, sellos, membrete).
export const vistaPorDefecto = (nombre) => (/^(xlsx?|ods|csv)$/.test(extDe(nombre)) ? "texto" : "paginas")

const dirDe = (hash) => join(RAIZ, hash.slice(0, 2), hash)
const metaDe = (hash) => join(dirDe(hash), "meta.json")

function leerMeta(hash) {
  try { return JSON.parse(readFileSync(metaDe(hash), "utf8")) } catch { return null }
}
function guardarMeta(hash, meta) {
  try { mkdirSync(dirDe(hash), { recursive: true }); writeFileSync(metaDe(hash), JSON.stringify(meta)) } catch { /* disco lleno: se reintenta la próxima */ }
}

// Corre un comando y devuelve true si salió bien. `spawnSync` con timeout: una conversión colgada no puede quedarse
// con el proceso del hub.
function correr(cmd, args, ms, opts = {}) {
  const r = spawnSync(cmd, args, { timeout: ms, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...opts })
  return r.status === 0
}

// Office → PDF. GOTCHA: LibreOffice usa UN perfil de usuario y se NIEGA a correr una segunda instancia mientras la
// primera lo tiene tomado — dos documentos abiertos a la vez y la segunda conversión falla en silencio. Por eso cada
// corrida estrena su propio perfil descartable con -env:UserInstallation.
function officeAPdf(rutaAbs, salida) {
  const perfil = join(tmpdir(), "lo-" + Math.random().toString(36).slice(2))
  const ok = correr("soffice", [
    "-env:UserInstallation=file://" + perfil,
    "--headless", "--norestore", "--invisible",
    "--convert-to", "pdf", "--outdir", salida, rutaAbs,
  ], T_OFFICE)
  try { rmSync(perfil, { recursive: true, force: true }) } catch {}
  if (!ok) return ""
  const pdf = readdirSync(salida).find((f) => f.toLowerCase().endsWith(".pdf"))
  return pdf ? join(salida, pdf) : ""
}

// PDF → p001.jpg, p002.jpg… `pdftoppm` numera con un ancho que depende del total, así que después se renombra a un
// formato estable (p001) para que el cliente pueda pedir la página N sin adivinar cómo quedó el nombre.
function pdfAPaginas(pdfAbs, destino) {
  const prefijo = join(destino, "raw")
  const ok = correr("pdftoppm", ["-jpeg", "-jpegopt", "quality=" + CALIDAD, "-r", String(DPI), "-f", "1", "-l", String(MAX_PAGINAS), pdfAbs, prefijo], T_PDF)
  const sueltas = readdirSync(destino).filter((f) => f.startsWith("raw-") && f.endsWith(".jpg"))
  if (!ok && !sueltas.length) return 0 // pdftoppm puede devolver !=0 y HABER generado páginas (PDF con una página rota)
  const orden = sueltas.sort((a, b) => (+a.match(/(\d+)\.jpg$/)?.[1] || 0) - (+b.match(/(\d+)\.jpg$/)?.[1] || 0))
  orden.forEach((f, i) => { try { renameSync(join(destino, f), join(destino, "p" + String(i + 1).padStart(3, "0") + ".jpg")) } catch {} })
  return orden.length
}

// Dos pedidos del mismo documento a la vez arrancaban DOS LibreOffice para el mismo archivo. El segundo espera al
// primero en vez de duplicar el trabajo.
const enVuelo = new Map()

// Convierte (o devuelve de cache) las páginas de UN documento del CAS.
// → { pages, urls, type, cached, err }.  pages=0 con err explica por qué no se pudo.
export async function docPaginas(media, filename = "") {
  if (!media) return { pages: 0, urls: [], err: "sin archivo" }
  const hash = hashDe(media)
  if (!hash) return { pages: 0, urls: [], err: "ruta inválida" }

  const previo = leerMeta(hash)
  if (previo) return { ...previo, urls: urlsDe(hash, previo.pages), cached: true }

  if (enVuelo.has(hash)) return enVuelo.get(hash)
  const tarea = (async () => {
    const ext = extDe(filename) || extDe(media)
    const origen = join(process.cwd(), "data", String(media).replace(/^\//, ""))
    if (!existsSync(origen)) { const m = { pages: 0, type: ext, err: "el archivo ya no está" }; guardarMeta(hash, m); return { ...m, urls: [] } }
    if (!ES_PDF(ext) && !ES_OFFICE(ext)) { const m = { pages: 0, type: ext, err: "formato sin vista previa: " + (ext || "?") }; guardarMeta(hash, m); return { ...m, urls: [] } }

    const destino = dirDe(hash)
    mkdirSync(destino, { recursive: true })
    const tmp = join(tmpdir(), "dv-" + hash.slice(0, 12))
    let pdf = origen, paginas = 0, err = null
    try {
      if (ES_OFFICE(ext)) {
        mkdirSync(tmp, { recursive: true })
        pdf = officeAPdf(origen, tmp)
        if (!pdf) err = "LibreOffice no pudo convertirlo"
      }
      if (!err) {
        paginas = pdfAPaginas(pdf, destino)
        if (!paginas) err = "no se pudieron generar páginas"
      }
    } catch (e) { err = e.message } finally { try { rmSync(tmp, { recursive: true, force: true }) } catch {} }

    // El documento es inmutable (dirección = hash del contenido), así que el resultado —incluido el fracaso— vale
    // para siempre: sin esto un PDF corrupto re-arrancaba LibreOffice en cada apertura.
    const meta = { pages: paginas, type: ext, media, err, ts: Date.now() }
    guardarMeta(hash, meta)
    return { ...meta, urls: urlsDe(hash, paginas) }
  })().finally(() => enVuelo.delete(hash))

  enVuelo.set(hash, tarea)
  return tarea
}

const urlsDe = (hash, n) => Array.from({ length: n || 0 }, (_, i) => `/docview/${hash.slice(0, 2)}/${hash}/p${String(i + 1).padStart(3, "0")}.jpg`)

// La ruta del CAS de un documento ya renderizado. La usa el servidor para gatear /docview/ con el MISMO criterio que
// /cas/: sin esto, las páginas serían una puerta de atrás para leer un documento de una cuenta secreta.
export function mediaDeHash(hash) {
  const m = leerMeta(String(hash || ""))
  return m?.media || ""
}

// Espacio que ocupan las páginas renderizadas (para la pantalla de almacenamiento).
export function docviewStats() {
  let files = 0, bytes = 0
  const rec = (d) => {
    let ents = []
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) rec(p)
      else if (e.name.endsWith(".jpg")) { files++; try { bytes += statSync(p).size } catch {} }
    }
  }
  rec(RAIZ)
  return { files, bytes }
}
