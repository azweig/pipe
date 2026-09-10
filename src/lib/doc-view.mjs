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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, statSync, openSync, readSync, closeSync } from "node:fs"
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

// TIPO REAL POR CONTENIDO. 408 de los 7.435 documentos llegaron SIN filename y con la ruta terminada en `.bin`:
// la ingesta nunca registró el tipo. Pero el archivo SÍ es un documento — medido en la base de producción, entre esos
// .bin hay planillas XLSX, manuales HTML de 1 MB, .ics y audios. Rechazarlos por la extensión es rechazarlos por un
// dato que falta, no porque no se puedan mostrar.
//
// Se leen los primeros bytes y se decide por la firma. Barato (una lectura de 8 bytes) y sólo cuando hace falta.
export function tipoPorContenido(rutaAbs) {
  let fd
  try {
    fd = openSync(rutaAbs, "r")
    // 256 bytes, no 8: las firmas binarias entran en 4, pero HTML puede empezar con BOM, espacios, comentarios o un
    // <?xml antes del <html. Leer de menos hacía que "<!DOCTYPE html>" nunca matcheara — el prefijo era más largo
    // que lo leído, así que la comparación era falsa SIEMPRE y 4 manuales reales quedaban sin vista previa.
    const b = Buffer.alloc(256)
    const n = readSync(fd, b, 0, 256, 0)
    const head = b.slice(0, n)
    if (head.slice(0, 4).toString("latin1") === "%PDF") return "pdf"
    if (head.slice(0, 4).toString("latin1") === "PK\u0003\u0004") return zipDe(rutaAbs) // ooxml u odf: hay que mirar adentro
    if (head.slice(0, 5).toString("latin1") === "{\\rtf") return "rtf"
    const txt = head.toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase()
    if (txt.startsWith("<!doctype html") || txt.startsWith("<html") || /^<\?xml[\s\S]{0,200}<html/.test(txt)) return "html"
    return ""
  } catch { return "" } finally { if (fd !== undefined) try { closeSync(fd) } catch {} }
}

// Un ZIP puede ser docx/xlsx/pptx/odt/ods/odp. Se distingue por los directorios que trae adentro.
function zipDe(rutaAbs) {
  const r = spawnSync("python3", ["-c", `
import sys, zipfile
try:
    n = zipfile.ZipFile(sys.argv[1]).namelist()
except Exception:
    sys.exit(1)
if any(x.startswith('word/') for x in n): print('docx')
elif any(x.startswith('xl/') for x in n): print('xlsx')
elif any(x.startswith('ppt/') for x in n): print('pptx')
else:
    mt = [x for x in n if x == 'mimetype']
    print('odf' if mt else '')
`, rutaAbs], { encoding: "utf8", timeout: 20000 })
  return r.status === 0 ? String(r.stdout || "").trim() : ""
}

// HTML se convierte igual que Office: LibreOffice lo pasa a PDF y de ahí a páginas.
const ES_HTML = (e) => /^html?$/.test(e)
const ES_PDF = (e) => e === "pdf"
const ES_OFFICE = (e) => /^(docx?|xlsx?|pptx?|odt|ods|odp|odf|rtf|html?)$/.test(e)
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
    let ext = extDe(filename) || extDe(media)
    const origen = join(process.cwd(), "data", String(media).replace(/^\//, ""))
    // tampoco se cachea "no está": el archivo puede volver (restore, re-descarga)
    if (!existsSync(origen)) return { pages: 0, type: ext, err: "el archivo ya no está", urls: [] }
    // La extensión no alcanza: hay documentos guardados como `.bin` y sin filename. Antes de rendirse, mirar el
    // CONTENIDO. Así una planilla que llegó sin tipo se abre igual.
    if (!ES_PDF(ext) && !ES_OFFICE(ext)) { const real = tipoPorContenido(origen); if (real) ext = real }
    // NO se cachea el rechazo por formato. Decidirlo es barato (4 bytes) y, sobre todo, la respuesta puede CAMBIAR
    // cuando el detector mejora: la primera versión leía 8 bytes y no reconocía HTML, así que dejó marcados como
    // "sin vista previa" documentos que sí se podían mostrar — y con el fallo cacheado no se recuperaban nunca.
    // Sólo se cachea lo que costó caro (LibreOffice/pdftoppm de verdad ejecutados).
    if (!ES_PDF(ext) && !ES_OFFICE(ext)) return { pages: 0, type: ext, err: "formato sin vista previa: " + (ext || "?"), urls: [] }

    const destino = dirDe(hash)
    mkdirSync(destino, { recursive: true })
    const tmp = join(tmpdir(), "dv-" + hash.slice(0, 12))
    let pdf = origen, paginas = 0, err = null
    try {
      if (ES_OFFICE(ext)) {
        mkdirSync(tmp, { recursive: true })
        // LibreOffice decide el FILTRO por la extensión del archivo, no por su contenido: un xlsx llamado ".bin" no
        // lo convierte. Se le pasa una copia con el nombre correcto (el original queda intacto en el CAS).
        let entrada = origen
        if (extDe(origen) !== ext) { entrada = join(tmp, "doc." + ext); writeFileSync(entrada, readFileSync(origen)) }
        pdf = officeAPdf(entrada, tmp)
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
