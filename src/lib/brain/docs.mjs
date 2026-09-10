// VISOR DE DOCUMENTOS — la capa que consumen las tres apps (web, escritorio, mobile). Todas piden lo mismo y
// muestran lo mismo: una lista de páginas (imágenes) y un texto. Ninguna parsea el archivo; el hub ya lo hizo.
//
// Dos formas de pedir un documento, porque hay dos formas de recibirlo:
//   · por ID de mensaje → un adjunto de chat (WhatsApp, Telegram, Slack…), que ES un mensaje
//   · por RUTA del CAS  → un adjunto de correo, que NO es un mensaje propio sino un archivo dentro de un email
// Sin la segunda, los adjuntos de correo seguirían siendo un link ciego, que es justo la mitad del problema.
//
// 🔒 Cada forma usa su gate, el mismo que ya protege ese camino en el resto del hub: messageById para los mensajes,
// casSecreto para las rutas del CAS. Ver un documento es leerlo: sin 2º PIN no se convierte ni se resume.
import { messageById } from "../threads-repo.mjs"
import { setMessageSummary, casSecreto } from "../db.mjs"
import { docPaginas, vistaPorDefecto, esVisualizable } from "../doc-view.mjs"
import { docTexto } from "../doc-text.mjs"

// Resuelve la referencia a { media, filename, msg } aplicando el gate que corresponda. null = no accesible.
function resolver(ref, secretOn) {
  const { id, media, filename } = typeof ref === "string" ? { id: ref } : (ref || {})
  if (id) {
    const m = messageById(id, { secretOn })
    if (!m) return { error: "mensaje no encontrado" }
    if (!m.media) return { error: "este mensaje no tiene documento" }
    return { media: m.media, filename: m.filename || "", msg: m }
  }
  if (media) {
    // 🔒 mismo 404 mudo que /cas/: un error distinto confirmaría que el archivo existe
    if (casSecreto(media, { secretOn })) return { error: "documento no encontrado" }
    return { media, filename: filename || "", msg: null }
  }
  return { error: "falta el documento" }
}

// Todo lo que la app necesita para abrir un documento: páginas, texto y con cuál de las dos vistas arrancar.
// `soloTexto` evita el trabajo de conversión cuando el cliente ya sabe que va a mostrar la tabla (XLSX).
export async function docView(ref, { secretOn = false, soloTexto = false } = {}) {
  const r = resolver(ref, secretOn)
  if (r.error) return { error: r.error }

  const nombre = r.filename || r.media
  const base = {
    id: r.msg?.id || null, media: r.media, filename: r.filename,
    vista: vistaPorDefecto(nombre), visor: esVisualizable(nombre),
    summary: r.msg?.summary || "",
  }

  // El texto se lee de la cache si ya está; si no, se extrae — y de paso queda indexado para la búsqueda.
  const texto = await docTexto(r.media, r.filename).catch(() => "")
  if (soloTexto || !base.visor) return { ...base, texto, pages: 0, urls: [] }

  const p = await docPaginas(r.media, r.filename)
  return { ...base, texto, pages: p.pages || 0, urls: p.urls || [], err: p.err || null }
}

// Sólo el texto (el botón "ver como texto"). Barato: si ya se extrajo, no vuelve a abrir el archivo.
export async function docTextView(ref, { secretOn = false } = {}) {
  const r = resolver(ref, secretOn)
  if (r.error) return { error: r.error }
  const texto = await docTexto(r.media, r.filename).catch(() => "")
  return { id: r.msg?.id || null, media: r.media, filename: r.filename, texto }
}

// Resumen ON-DEMAND, para los documentos VIEJOS (los nuevos los hace el cron solo). Es el botón que evita pagarle
// OCR a 10.248 documentos históricos que quizá nadie mire.
// Sólo tiene sentido sobre un MENSAJE: el resumen se guarda en su columna `summary`. Un adjunto de correo suelto no
// tiene dónde guardarse, así que para ésos se devuelve el texto extraído y listo.
export async function docSummarize(ref, { secretOn = false, rehacer = false } = {}) {
  const r = resolver(ref, secretOn)
  if (r.error) return { error: r.error }
  if (!r.msg) {
    const texto = await docTexto(r.media, r.filename).catch(() => "")
    return { id: null, summary: "", texto, nota: "los adjuntos de correo se leen, no se guardan resumidos" }
  }
  if (rehacer) setMessageSummary(r.msg.id, "")
  // import perezoso: doc-summarize.mjs carga el .env y la cadena de modelos, y no hace falta para abrir un documento
  const { summarizeDocBatch } = await import("../../doc-summarize.mjs")
  const hechos = await summarizeDocBatch([{ id: r.msg.id, media: r.media, filename: r.filename }])
  if (!hechos) return { error: "no se pudo leer el contenido del documento" }
  return { id: r.msg.id, summary: messageById(r.msg.id, { secretOn })?.summary || "" }
}
