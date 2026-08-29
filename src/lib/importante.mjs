// ¿ESTE CORREO MERECE TU ATENCIÓN HOY? — "Prioritarios" era solo los hilos que fijabas a mano, así que nada podía
// destacarse solo. Un correo real invitando a un programa beta quedó mezclado con el marketing del mismo dominio y
// se perdió; nadie lo marcó porque no había nada que marcara.
//
// Heurística explicable y sin costo (0 tokens). No intenta adivinar "importancia" en abstracto — busca las dos
// señales que separan una oportunidad de un boletín:
//   1. que sea PERSONAL (una persona escribiéndote), no un envío masivo;
//   2. que te PIDA o te OFREZCA algo concreto.
// Se exige lo primero SIEMPRE: sin eso, cualquier promoción con la palabra "exclusivo" entraría.
const MASIVO = [
  /\bunsubscribe\b|\bdarse de baja\b|\bdesuscribi|\bcancelar (la )?suscripci/i,
  /\bver (este )?(correo|email) en el navegador\b|\bview (this )?(email|message) in browser\b/i,
  /\bno[-_. ]?reply\b|\bnoreply\b/i,
  /\b(promoci[oó]n|descuento|oferta|cupón|cupon|sale|% off|black friday|cyber)\b/i,
]
const REMITENTE_MASIVO = /^(no-?reply|noreply|info|news|newsletter|marketing|notificaciones|notifications|hello|hi|soporte|support|billing|no_reply)@/i
const OPORTUNIDAD = [
  /\b(invitaci[oó]n|invitamos|te invito|te invitamos|inviting you|you'?re invited|invite you)\b/i,
  /\b(beta|early access|acceso anticipado|programa piloto|pilot program|builder program|test(ing)? team)\b/i,
  /\b(seleccionad[oa]s?|elegid[oa]s?|selected|shortlisted|congratulations|felicitaciones)\b/i,
  /\b(propuesta|oportunidad|opportunity|partnership|colaboraci[oó]n|proposal)\b/i,
  /\b(entrevista|interview|reuni[oó]n|meeting|llamada|call)\b.{0,40}\b(agend|schedul|coordin|disponib)/i,
]
const PIDE_RESPUESTA = [
  /\b(confirm[aá]|confírmame|confirm|responder?me|repl(y|ies)|av[ií]same|let me know|d[ée]jame saber)\b/i,
  /\b(antes del|hasta el|deadline|vence|expira|plazo|before)\b.{0,25}\d/i,
  /\b(disponibilidad|availability|te queda bien|te sirve|coordinamos|agendamos)\b/i,
]
// Un "?" suelto NO cuenta: la mitad de los mensajes de trabajo terminan en pregunta y la pestaña se llenaría de
// ruido. Lo que distingue un pedido real es que nombre una acción o una fecha.

// ¿el remitente parece una PERSONA y no un buzón? "ana@" sí, "info@"/"billing@" no. Es la segunda vía para
// considerar algo personal cuando no te nombran: un pedido concreto de una persona real importa igual.
const remitenteHumano = (from) => {
  const local = String(from || "").split("@")[0].toLowerCase()
  if (!local || REMITENTE_MASIVO.test(String(from))) return false
  if (/^(admin|contacto|contact|ventas|sales|team|equipo|cuentas|cobranzas|facturacion|alerts?|updates?)$/.test(local)) return false
  return /^[a-záéíóúñ][a-záéíóúñ.\-_]{1,28}$/i.test(local) // nombre-ish, no un id largo ni un buzón genérico
}

const alguno = (res, t) => res.some((re) => re.test(t))

// `nombrePropio`: tu nombre de pila — que te nombren es la señal más fuerte de que no es un envío masivo.
export function evaluarImportancia({ text = "", body = "", from = "", subject = "", nombrePropio = "" } = {}) {
  const t = `${subject}\n${text}\n${String(body).replace(/<[^>]+>/g, " ")}`.slice(0, 4000)
  if (!t.trim()) return { importante: false, razon: "" }
  if (REMITENTE_MASIVO.test(String(from)) || alguno(MASIVO, t)) return { importante: false, razon: "" } // boletín: fuera, sin importar qué prometa
  const personal = !!(nombrePropio && new RegExp(`\\b${nombrePropio.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i").test(t))
  const oportunidad = alguno(OPORTUNIDAD, t)
  const pide = alguno(PIDE_RESPUESTA, t)
  if (!oportunidad && !pide) return { importante: false, razon: "" }
  // sin que te nombren, hace falta que el remitente parezca una persona: eso es lo que evita que una promo
  // "exclusiva" de un buzón de marketing se cuele en la pestaña.
  const humano = remitenteHumano(from)
  if (!personal && !humano && !(oportunidad && pide)) return { importante: false, razon: "" }
  const razon = oportunidad ? "te ofrecen o te invitan a algo" : "te piden una respuesta"
  return { importante: true, razon, personal, oportunidad, pide }
}
