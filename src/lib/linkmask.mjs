// Protección de LINKS para la corrección de texto: los enlaces NUNCA se corrigen.
// El LLM podría meterles espacios, "arreglar" el dominio o romper los query params, así que:
//  - si el mensaje es SOLO links → ni se manda a corregir (isOnlyLinks)
//  - si hay texto + links → se enmascaran con un token opaco (LNK0X, LNK1X…) que el LLM copia verbatim
//    y no colisiona con dígitos del texto ("8 soles"), y después se restauran textualmente (unmaskLinks).
export const URL_RE = /(?:https?:\/\/|www\.)[^\s]+|[\w.+-]+@[\w-]+\.[\w.-]+/gi

export const maskLinks = (s) => {
  const urls = []
  const masked = String(s).replace(URL_RE, (m) => { urls.push(m); return `LNK${urls.length - 1}X` })
  return { masked, urls }
}

export const unmaskLinks = (s, urls) => String(s).replace(/LNK(\d+)X/g, (_, i) => (urls[+i] != null ? urls[+i] : ""))

export const isOnlyLinks = (s) => { const t = String(s).trim(); return t.length > 0 && t.replace(URL_RE, "").trim() === "" }
