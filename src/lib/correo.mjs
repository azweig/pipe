// CORREO COMO CORREO — redactar, responder, responder a todos, reenviar.
//
// Hasta acá el hub trataba un email como "un mensaje más de un hilo": se respondía con texto plano a UN destinatario
// y hacer clic en un correo llevaba a la vista de chat, que no tiene asunto ni destinatarios. Este módulo aporta lo
// que un correo necesita y un chat no: asunto, CC/CCO, cuerpo HTML, adjuntos, cita del original y firma.
//
// NO reimplementa el envío: se apoya en mailer.mjs (transporte SMTP por cuenta, cabeceras de hilo) y en
// signature.mjs (firma por cuenta). Acá va sólo lo que es propio del correo como formato.
import { getSignature, defaultSignature } from "./signature.mjs"

// ── DIRECCIONES ──────────────────────────────────────────────────────────────────────────────────────────────────
// Se acepta lo que la gente pega de verdad: "Nombre <a@b.com>", separadas por coma o punto y coma, con espacios.
export function parseDirecciones(v) {
  if (Array.isArray(v)) return v.flatMap(parseDirecciones)
  return String(v || "")
    .split(/[,;\n]+/)
    .map((s) => {
      const m = /<([^>]+)>/.exec(s)              // "Nombre <a@b.com>" → a@b.com
      return (m ? m[1] : s).trim().replace(/^email:/, "")
    })
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
}
export const direccionValida = (s) => parseDirecciones(s).length === 1

// ── ASUNTO ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Un asunto no acumula prefijos: "Re: Re: Re: algo" es lo que pasa cuando cada respuesta antepone el suyo sin mirar.
// Se saca TODO prefijo previo (en los idiomas que aparecen en una bandeja real) y se pone uno solo.
const PREFIJOS = /^\s*((re|rv|fw|fwd|reenv|res|antw|aw)\s*(\[\d+\])?\s*:\s*)+/i
export const asuntoLimpio = (s) => String(s || "").replace(PREFIJOS, "").trim()
export const asuntoRespuesta = (s) => "Re: " + (asuntoLimpio(s) || "(sin asunto)")
export const asuntoReenvio = (s) => "Fwd: " + (asuntoLimpio(s) || "(sin asunto)")

// ── RESPONDER A TODOS ────────────────────────────────────────────────────────────────────────────────────────────
// Se responde a quien escribió, y van a CC todos los demás MENOS vos: si tus propias direcciones quedan en la copia,
// te llega tu propia respuesta y —peor— cada respuesta de los demás te duplica en el hilo.
export function destinatariosRespuesta(correo, misDirecciones = [], todos = false) {
  const mias = new Set(parseDirecciones([...misDirecciones]).map((s) => s.toLowerCase()))
  const de = parseDirecciones(correo?.from || correo?.email || "")
  const noSoyYo = (s) => !mias.has(s.toLowerCase())
  // Si el correo lo escribiste VOS, "responder" es seguir escribiéndole al destinatario original, no a vos mismo.
  const para = de.filter(noSoyYo).length ? de.filter(noSoyYo) : parseDirecciones(correo?.to || "").filter(noSoyYo)
  if (!todos) return { to: para.slice(0, 1), cc: [] }
  const resto = [...parseDirecciones(correo?.to || ""), ...parseDirecciones(correo?.cc || "")]
    .filter(noSoyYo)
    .filter((s) => !para.some((p) => p.toLowerCase() === s.toLowerCase()))
  return { to: para, cc: [...new Set(resto)] }
}

// ── CITA DEL ORIGINAL ────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const fechaLarga = (ts, tz = "America/Lima") => {
  try { return new Date(ts || Date.now()).toLocaleString("es", { timeZone: tz, dateStyle: "full", timeStyle: "short" }) }
  catch { return new Date(ts || Date.now()).toISOString() }
}

// La cita va en un <blockquote> con la cabecera de siempre, para que cualquier cliente (Gmail, Outlook) la colapse
// como "mostrar contenido citado" en vez de mostrar un muro de texto.
export function citaHtml(correo, tz) {
  if (!correo) return ""
  const cab = `El ${esc(fechaLarga(correo.ts, tz))}, ${esc(correo.fromName || correo.from || "")} escribió:`
  const cuerpo = String(correo.html || "").trim() || `<pre style="white-space:pre-wrap;font:inherit">${esc(correo.text || "")}</pre>`
  return `<br><div>${cab}</div><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555">${cuerpo}</blockquote>`
}
export function citaTexto(correo, tz) {
  if (!correo) return ""
  const cab = `El ${fechaLarga(correo.ts, tz)}, ${correo.fromName || correo.from || ""} escribió:`
  return `\n\n${cab}\n` + String(correo.text || "").split("\n").map((l) => "> " + l).join("\n")
}

// ── REENVÍO ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Un reenvío NO es una cita: el contenido reenviado ES el mensaje, así que va con su cabecera completa y SIN
// blockquote, para que el que lo recibe vea de quién venía, a quién iba y cuándo.
export function reenvioHtml(correo, tz) {
  if (!correo) return ""
  const fila = (k, v) => (v ? `<div><b>${k}:</b> ${esc(v)}</div>` : "")
  return `<br><div>---------- Mensaje reenviado ----------</div>` +
    fila("De", correo.fromName ? `${correo.fromName} <${correo.from}>` : correo.from) +
    fila("Fecha", fechaLarga(correo.ts, tz)) +
    fila("Asunto", correo.subject) +
    fila("Para", correo.to) + fila("CC", correo.cc) +
    `<br>${String(correo.html || "").trim() || `<pre style="white-space:pre-wrap;font:inherit">${esc(correo.text || "")}</pre>`}`
}

// ── CUERPO FINAL ─────────────────────────────────────────────────────────────────────────────────────────────────
// Devuelve {text, html} listo para nodemailer. La firma va SIEMPRE arriba de la cita: quien lee tu respuesta te lee a
// vos primero. Ponerla al final del todo, después del historial, es lo que hace que nadie la vea nunca.
export function armarCuerpo({ html = "", texto = "", cuenta = "", cita = "", citaTxt = "", conFirma = true, tz } = {}) {
  const f = conFirma ? (getSignature(cuenta) || defaultSignature()) : null
  const cuerpoHtml = String(html || "").trim() || `<div>${esc(texto).replace(/\n/g, "<br>")}</div>`
  const firmaHtml = f?.html ? `<br>${f.html}` : f?.text ? `<br><pre style="white-space:pre-wrap;font:inherit">${esc(f.text)}</pre>` : ""
  const cuerpoTexto = String(texto || "").trim() || htmlATexto(html)
  const firmaTexto = f?.text ? `\n\n${f.text}` : ""
  return {
    html: `<div>${cuerpoHtml}</div>${firmaHtml}${cita || ""}`,
    text: `${cuerpoTexto}${firmaTexto}${citaTxt || ""}`,
  }
}

// El text/plain NO es opcional: sin él, cualquier cliente en modo texto (y varios filtros antispam) ven un correo
// vacío. Se deriva del HTML conservando los cortes de párrafo.
export function htmlATexto(h) {
  return String(h || "")
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
}

// ── SANEADO DEL HTML QUE ESCRIBE EL USUARIO ──────────────────────────────────────────────────────────────────────
// El editor es contentEditable: pegar desde Word o desde una página trae <script>, <iframe>, `onclick=` y estilos
// enteros. Eso no puede salir del hub ni guardarse en un borrador. Lista BLANCA, no negra: lo que no está, se va.
const TAGS_OK = new Set(["b", "strong", "i", "em", "u", "s", "a", "p", "div", "span", "br", "ul", "ol", "li",
  "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "td", "th", "img", "hr"])
const ATTR_OK = { a: ["href", "title"], img: ["src", "alt", "width", "height"], "*": ["style"] }
const ESTILO_OK = /^(color|background-color|font-weight|font-style|text-decoration|text-align|margin|margin-left|padding|padding-left|border-left|white-space|font-family|font-size)$/i

export function limpiarHtml(entrada) {
  let h = String(entrada || "")
  h = h.replace(/<!--[\s\S]*?-->/g, "")
  h = h.replace(/<(script|style|iframe|object|embed|form|input|button|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi, "")
  h = h.replace(/<(script|style|iframe|object|embed|form|input|button|link|meta|base)\b[^>]*>/gi, "")
  return h.replace(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, (todo, cierre, tag, attrs) => {
    const t = tag.toLowerCase()
    if (!TAGS_OK.has(t)) return ""
    if (cierre) return `</${t}>`
    const permitidos = [...(ATTR_OK[t] || []), ...ATTR_OK["*"]]
    const salida = []
    for (const m of String(attrs).matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const nombre = m[1].toLowerCase()
      let valor = m[3] ?? m[4] ?? ""
      if (!permitidos.includes(nombre)) continue
      if (nombre === "href" || nombre === "src") {
        // javascript:, data: y vbscript: en un href son ejecución; sólo http(s), mailto y cid (imágenes embebidas).
        if (!/^(https?:|mailto:|cid:|\/)/i.test(valor.trim())) continue
      }
      if (nombre === "style") {
        valor = valor.split(";").map((d) => d.trim()).filter((d) => {
          const p = d.split(":")[0]?.trim()
          return p && ESTILO_OK.test(p) && !/expression|url\s*\(|javascript:/i.test(d)
        }).join("; ")
        if (!valor) continue
      }
      salida.push(`${nombre}="${valor.replace(/"/g, "&quot;")}"`)
    }
    return `<${t}${salida.length ? " " + salida.join(" ") : ""}>`
  })
}
