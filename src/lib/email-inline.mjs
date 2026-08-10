// Imágenes INLINE de un email: el HTML las referencia como src="cid:xxx" y el binario viaja como adjunto marcado
// inline. Acá se sustituye cada cid: por un data: URI leído del CAS.
//
// ¿Por qué data: y no una URL del hub (/cas/…)? El visor de correo es un iframe SANDBOXEADO (origin null, sin
// cookies) con CSP `img-src data:`. Ese CSP es a propósito: bloquea los pixeles de tracking remotos, así el
// remitente no se entera de que abriste el correo ni ve tu IP. Una URL del hub daría 401 (sin cookie) y relajar el
// CSP tiraría abajo la garantía. data: cumple las dos cosas.
//
// Vive fuera de brain/ para no ensuciar la fachada (que tiene su lista fija de exports) y para poder testearla pura.

const INLINE_MAX = 4 * 1024 * 1024    // por imagen: más que esto no vale la pena inlinear
const INLINE_TOTAL = 8 * 1024 * 1024  // suma de imágenes DISTINTAS (un hilo largo repite la misma firma 20 veces)
const OUTPUT_MAX = 12 * 1024 * 1024   // tope del HTML emitido: un srcdoc gigante traba el render del webview

/**
 * @param {string|null} body   HTML del correo
 * @param {Array}  atts        adjuntos parseados: [{cas, cid, mime, size, inline}]
 * @param {(pub:string)=>Buffer|null} read  lector del blob por ruta pública del CAS
 * @returns {string|null} el mismo HTML con los cid: resueltos a data:
 */
export function inlineCidImages(body, atts, read) {
  if (!body || !/\bcid:/i.test(body)) return body
  const byCid = new Map()
  for (const a of atts || []) {
    const c = String(a.cid || "").replace(/^<|>$/g, "")
    if (c && a.cas) byCid.set(c.toLowerCase(), a)
  }
  if (!byCid.size) return body
  // un hilo reenviado repite la MISMA imagen decenas de veces (firma, logo). Se lee del CAS y se codifica UNA sola vez
  // por imagen distinta: el presupuesto cuenta bytes únicos y el base64 se reusa. Antes: 82 lecturas + 82 base64 del mismo PNG.
  const cache = new Map() // cid → data: URI (o null si no se puede)
  let unique = 0, emitted = body.length
  const uriFor = (a) => {
    if (cache.has(a.cas)) return cache.get(a.cas)
    let uri = null
    if ((a.size || 0) <= INLINE_MAX && unique + (a.size || 0) <= INLINE_TOTAL) {
      let buf = null
      try { buf = read(a.cas) } catch { buf = null }
      if (buf && buf.length) { unique += buf.length; uri = `data:${a.mime || "image/png"};base64,${buf.toString("base64")}` }
    }
    cache.set(a.cas, uri)
    return uri
  }
  // sustituye SOLO dentro de comillas (src="cid:x" / src='cid:x') → no toca texto suelto del cuerpo
  return body.replace(/(["'])cid:([^"']+)\1/gi, (whole, q, cid) => {
    let key = cid
    try { key = decodeURIComponent(cid) } catch { /* cid con % suelto: se usa tal cual */ }
    const a = byCid.get(key.replace(/^<|>$/g, "").toLowerCase())
    if (!a) return whole
    const uri = uriFor(a)
    // sin imagen en el CAS, o pasó algún tope → queda el cid: (recuadro roto ahí, pero el resto del correo se lee)
    if (!uri || emitted + uri.length > OUTPUT_MAX) return whole
    emitted += uri.length
    return `${q}${uri}${q}`
  })
}
