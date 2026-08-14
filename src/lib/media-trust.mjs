// ¿Se le puede mandar el archivo de una cuenta SECRETA a este servicio de OCR / transcripción?
//
// OCR_URL y WHISPER_URL son la alternativa "privada" a la nube, y para el hub son de confianza por definición: los
// configuraste vos. Pero nada verifica QUÉ son. Si apuntan a una máquina tuya en la misma red, el archivo no sale de tu
// infraestructura; si apuntan a un host en internet, sale igual que si fuera a Google — solo que con otro nombre.
//
// Para el contenido normal eso lo decidís vos al configurarlo y no lo tocamos. Para una cuenta SECRETA fallamos cerrado:
// el archivo se manda solo si el destino está en tu red (loopback o IP privada), o si declaraste explícitamente que ese
// host es tuyo con MEDIA_HOST_PROPIO=1 (el caso de un servidor propio con IP pública, que es habitual).
const privado = (h) =>
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|::1$|::$|fe80:)/i.test(h) ||
  /^(fc|fd)[0-9a-f]{0,2}:/i.test(h) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
  h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")

export function destinoConfiable(url) {
  const u = String(url || "").trim()
  if (!u) return false
  if (process.env.MEDIA_HOST_PROPIO === "1") return true // "ese host es mío", declarado a mano
  try { return privado(new URL(u).hostname) } catch { return false }
}

// mensaje único para explicar por qué no se procesó (se muestra tal cual en la app)
export const MOTIVO_NO_CONFIABLE =
  "No proceso este archivo: es de una cuenta secreta y el servicio configurado no está en tu red. " +
  "Si ese servidor es tuyo, poné MEDIA_HOST_PROPIO=1 en el .env."
