// EXTRACTOR OPCIONAL (MarkItDown, de Microsoft). Sólo para PDF y Office, sólo en el SERVIDOR.
//
// Por qué: los documentos que llegan acá son facturas, planillas y estados de cuenta — o sea TABLAS. `pdftotext` las
// aplana a un renglón continuo y el monto termina separado de su concepto; el extractor propio de docx/xlsx/pptx es
// todavía más burdo (abre el ZIP y borra etiquetas con una regex, así que una hoja de cálculo sale como una tirada de
// celdas sin filas ni columnas). MarkItDown usa pdfplumber y detecta tablas —incluso sin bordes— y las devuelve como
// tablas de Markdown. Eso es mejor materia prima para el resumen y para buscar ADENTRO del documento.
//
// OPCIONAL A PROPÓSITO. Pipe es self-hostable y hoy la extracción no tiene NINGUNA dependencia instalada: usa binarios
// del sistema y la stdlib. Convertir un árbol de Python en requisito duro le complicaría la instalación a cualquiera
// que levante su hub. Si el venv no está, todo sigue exactamente como antes. Y para volver atrás alcanza con borrarlo:
// no hace falta desplegar nada.
//
// LO QUE NO HACE: OCR. Un PDF escaneado no tiene texto que leer, así que ese camino sigue siendo el servicio de OCR.
import { existsSync, statSync } from "fs"
import { spawnSync } from "child_process"

const BIN = process.env.MARKITDOWN_BIN || "/opt/markitdown-venv/bin/python"
// TOPE DE TAMAÑO, medido — no a ojo. pdfplumber cuesta segundos donde pdftotext cuesta milisegundos, y esta caja
// comparte 8 núcleos con ollama.
// Las PLANILLAS son el caso peligroso y llevan tope aparte: una de 4 MB tardó 2m09s y generó 10,9 MILLONES de
// caracteres, de los que igual nos quedamos con 20.000 — o sea, dos minutos de CPU para tirar el 99,8%. El costo de
// una hoja de cálculo no crece con su peso sino con filas × columnas. En los 1.132 xlsx del hub la mediana son 31 KB
// y el percentil 90 es 1 MB: con 2 MB entra el 93,7% y queda afuera exactamente la cola patológica (la mayor: 81 MB).
const MAX_MB = +process.env.MARKITDOWN_MAX_MB || 10
const MAX_MB_HOJA = +process.env.MARKITDOWN_MAX_MB_HOJA || 2
const esHoja = (e) => e === "xlsx" || e === "xls"
const TIMEOUT = +process.env.MARKITDOWN_TIMEOUT_MS || 90000
const NICE = +process.env.MARKITDOWN_NICE || 15   // 0 = prioridad normal; 19 = lo último de la cola
const EXT_OK = new Set(["pdf", "docx", "xlsx", "xls", "pptx", "msg"])

// Apagado explícito con MARKITDOWN=0 sin desinstalar nada (para comparar, o si un día molesta en producción).
export function markitdownEnabled() {
  if (/^(0|off|no|false)$/i.test(process.env.MARKITDOWN || "")) return false
  return existsSync(BIN)
}
export const markitdownSirve = (ext) => EXT_OK.has(String(ext || "").toLowerCase())

// El archivo se pasa como STREAM con la extensión declarada aparte. En el CAS los adjuntos se guardan por hash y
// muchos quedaron como `.bin` sin nombre: si MarkItDown tuviera que adivinar el formato por la extensión del archivo
// —como le pasa a LibreOffice— no elegiría el conversor correcto. `StreamInfo(extension=...)` se lo dice.
const PY = `
import sys
from markitdown import MarkItDown, StreamInfo
ruta, ext, tope = sys.argv[1], sys.argv[2], int(sys.argv[3])
md = MarkItDown(enable_plugins=False)   # sin plugins de terceros: nada que no hayamos instalado nosotros corre acá
with open(ruta, "rb") as f:
    r = md.convert(f, stream_info=StreamInfo(extension="." + ext))
sys.stdout.write((r.text_content or "")[:tope])
`

// Devuelve "" ante cualquier problema: el llamador cae al extractor de siempre. Nunca tira.
export function textoMarkitdown(rutaAbs, ext, { maxChars = 20000 } = {}) {
  const e = String(ext || "").toLowerCase()
  if (!markitdownEnabled() || !markitdownSirve(e)) return ""
  const tope = (esHoja(e) ? MAX_MB_HOJA : MAX_MB) * 1048576
  try { if (statSync(rutaAbs).size > tope) return "" } catch { return "" }
  // CON `nice`: esto corre en crons de fondo y comparte 8 núcleos con ollama, que en esta caja llega al 376% de CPU.
  // Medido con la caja cargada, un PDF que en el banco tardaba ~3,6s tardó 46s. Nada de eso urge —el texto se cachea
  // y el usuario no está esperando—, así que cede el procesador a lo que sí urge (responder, transcribir, el modelo).
  // Si `nice` no existe (ENOENT), se reintenta directo: no vale perder la extracción por no poder bajar la prioridad.
  const args = ["-c", PY, rutaAbs, e, String(maxChars)]
  const opts = { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: TIMEOUT }
  let r = spawnSync("nice", ["-n", String(NICE), BIN, ...args], opts)
  if (r.error && r.error.code === "ENOENT") r = spawnSync(BIN, args, opts)
  if (r.status !== 0) return ""
  // Se conservan los saltos de línea A PROPÓSITO: sin ellos una tabla de Markdown deja de ser una tabla y el trabajo
  // de detectar columnas se tira a la basura. Sólo se colapsan espacios y líneas en blanco de más.
  return String(r.stdout || "").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}
