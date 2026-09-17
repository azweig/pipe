// SOLO LO NUEVO de un correo: recorta la conversación CITADA que cuelga debajo de una respuesta.
//
// Por qué existe: el resumidor tomaba los primeros 4.000 caracteres del cuerpo. En una respuesta, lo nuevo va ARRIBA
// y abajo viene pegado todo el hilo anterior. Medido en la bandeja real: de los correos que citan, en el 100% el
// historial OCUPA MÁS que el mensaje — un "¡Qué bueno, era una preocupación que tuvo buen final!" de 605 caracteres
// llegaba al modelo con 3.395 caracteres de historial viejo encima, y el resumen decía lo contrario del mensaje
// (hablaba del rechazo que ya se había resuelto).
//
// Son el 6% de los correos, pero son EXACTAMENTE la correspondencia real: los boletines y las notificaciones no
// citan nada. O sea que el 100% de lo que te contesta una persona se resumía mal.

// Marcadores de "acá empieza lo citado". Van anclados a principio de línea: "De:" suelto en medio de una frase no
// corta nada, pero "De: Fulano <...>" al principio de una línea es el encabezado que mete Outlook.
// OJO con la bandera `m`: sin ella `^` ancla al principio del TEXTO, no de cada línea, y el marcador sólo se
// detecta si el correo empieza con él — que es justo lo que nunca pasa en una respuesta.
const MARCAS = [
  /^\s*_{10,}\s*$/m,                                        // la línea de guiones bajos de Outlook
  /^\s*-{2,}\s*(Original Message|Mensaje original|Forwarded message|Mensaje reenviado)\s*-*/im,
  /^\s*-{5,}\s*$/m,                                          // separador suelto
  /^\s*(De|From)\s*:\s*.{2,}$/im,                           // encabezado citado
  /^\s*(El|On)\s+.{5,90}\s+(escribi[oó]|wrote)\s*:\s*$/im,  // "El lun, 7 sept 2026 … escribió:"
  /^\s*(El|On)\s+.{5,90}\s+(escribi[oó]|wrote)\s*:/im,      // variante sin fin de línea
  /^\s*>\s?/m,                                              // citado con ">"
  /^\s*Enviado desde mi\s/im,                               // firmas de móvil que preceden a la cita
  /^\s*(Get|Obtener) Outlook para\s/im,
  /^\s*Sent from my\s/im,
]

// Corta en la marca MÁS TEMPRANA. Si lo que queda es demasiado corto para decir algo, devuelve el texto completo:
// vale más un resumen con ruido que uno de dos palabras — y hay correos legítimos que empiezan con "De:".
//
// 12 y no 40: "Listo, confirmado." son 18 caracteres y ES el mensaje; con el umbral alto caía al texto completo y
// volvíamos al problema original. Abajo de 12 quedan sólo los "ok" y "gracias" sueltos, donde el historial sí ayuda.
const MIN_UTIL = 12

// ⚠️ UN REENVÍO NO ES UNA RESPUESTA. En un "Re:" lo citado es ruido y el mensaje está arriba. En un "Fwd:" pasa lo
// contrario: arriba hay un "te comparto esto" que no dice nada y el CONTENIDO es justamente lo reenviado. Recortar un
// reenvío convertía "Monto pendiente de amortización: $71.390" en "Te comparto la información que nos envió Valia".
// Por eso el asunto decide: con reenvío no se recorta.
export const esReenvio = (asunto) => /^\s*(fwd?|rv|reenv)[:\s]/i.test(String(asunto || ""))

export function soloLoNuevo(texto, { minUtil = MIN_UTIL, asunto = "" } = {}) {
  const t = String(texto || "")
  if (!t.trim()) return ""
  if (esReenvio(asunto)) return t.trim() // el contenido reenviado es el mensaje
  let corte = t.length
  for (const re of MARCAS) {
    const m = re.exec(t)
    if (m && m.index < corte) corte = m.index
  }
  const nuevo = t.slice(0, corte).trim()
  return nuevo.length >= minUtil ? nuevo : t.trim()
}

// ¿Cuánto de este cuerpo es historial? Para diagnóstico y para decidir si vale la pena avisar.
export function proporcionCitada(texto) {
  const t = String(texto || "")
  if (!t.trim()) return 0
  const nuevo = soloLoNuevo(t, { minUtil: 0 })
  return t.length ? 1 - nuevo.length / t.length : 0
}
