// Cómo se le CUENTA una conversación al LLM que extrae las facetas (resumen, entidades, tags, keywords) para el
// router barato. Vive acá y no dentro de enrich-convos.mjs porque ese archivo es un script que corre al importarse:
// separado, esto se puede probar sin arrancar el cron entero.
//
// Lo que cambió: antes, de un contrato adjunto sólo se le pasaba el NOMBRE del archivo ("adjunto-final.pdf"), así que
// las facetas del hilo salían vacías de contenido real y el router no podía llevarte a la conversación donde estaba
// el monto. Ahora entra lo que dice adentro del documento.
import { docTextoCache } from "./doc-text.mjs"

export const striphtml = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#\d+;|&gt;|&lt;|&amp;/g, " ").replace(/\s+/g, " ").trim()

// Lo que dice ADENTRO de un adjunto, si ya está extraído. Se prefiere el resumen (viene destilado) y si no, el texto.
// NUNCA extrae acá: es cache-only. Este camino recorre miles de mensajes por corrida del cron, y tirar de la
// extracción convertiría un cron barato en horas de GPU — la misma decisión perezosa que ya tomó doc-text.mjs.
export function textoAdjunto(m) {
  if (!m || !m.media || !/^(document|file)$/.test(String(m.mediaType || ""))) return ""
  const marca = `[documento${m.filename ? " " + m.filename : ""}]`
  const dentro = (m.summary || docTextoCache(m.media) || "").replace(/\s+/g, " ").trim()
  // Aunque no haya texto extraído todavía, el NOMBRE del archivo se conserva igual. Antes se perdía entero cuando el
  // mensaje traía texto: `text || filename` se quedaba con el texto, y un "te paso lo que hablamos" con un
  // "contrato-globex-2026.pdf" adjunto dejaba las facetas sin el rastro más obvio del hilo.
  return dentro ? `${marca} ${dentro.slice(0, 700)}` : marca
}

export function convText(msgs) {
  return (msgs || []).map((m) => {
    const who = m.dir === "out" ? "yo" : (m.name || "?")
    let t = m.text || ""
    if (m.channel === "email" && m.body) t = (t ? t + " — " : "") + striphtml(m.body).slice(0, 500) // el asunto está en text; el DETALLE (montos, fechas) en body → sin esto el resumen no captura la deuda
    const doc = textoAdjunto(m)
    // el documento se recorta aparte y NO comparte el presupuesto del mensaje: con el tope de 160 de mensajería, el
    // contenido del PDF entraba mutilado en la primera línea y no llegaba ni al primer monto.
    const body = (t || m.filename || (m.mediaType ? `[${m.mediaType}]` : "")).replace(/\s+/g, " ").slice(0, m.channel === "email" ? 520 : 160)
    const linea = [body, doc].filter((x) => x && x.length > 1).join(" — ")
    return linea.length > 1 ? `${who}: ${linea}` : ""
  }).filter(Boolean).join("\n").slice(0, 8000) // subido de 6000: los documentos aportan contenido real, no relleno
}
