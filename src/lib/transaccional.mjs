// ¿ESTE MENSAJE ES TRANSACCIONAL? — o sea: te lo mandó una máquina, pero es SOBRE VOS y algo pasa.
//
// El antispam etiqueta REMITENTES. Es razonable para promociones, pero rompe con el correo transaccional: la misma
// dirección que te manda "40% OFF" te manda "problema de facturación", "tu servicio se corta", "vencimiento",
// "constancia de transferencia" o la invitación a una reunión. Marcado el remitente, esos avisos desaparecían de la
// bandeja junto con las promos. Casos reales medidos: un "Problema de facturación" de Apple, un "Approaching your
// limits: Upgrade now to avoid service disruption" de Vercel, la notificación de una reunión de Google Calendar, un
// aviso del banco de la empresa y un comunicado de mantenimiento de un cliente.
//
// La señal no es quién manda: es QUÉ dice. Estas frases no aparecen en una promoción.

const ACCION = [
  // dinero y cuentas
  /\b(problema|error|fall[oó])\s+(de|con|en)\s+(la\s+)?(facturaci[oó]n|pago|cobro|tarjeta|suscripci[oó]n)\b/i,
  /\b(pago|cobro|cargo|d[eé]bito)\s+(rechazad|fallid|no\s+procesad|pendiente|vencid)/i,
  /\b(fondos\s+insuficientes|tarjeta\s+(vencida|rechazada)|payment\s+(failed|declined|issue|problem))\b/i,
  /\b(vencimientos?|vence|por\s+vencer|[uú]ltimo\s+d[ií]a|fecha\s+l[ií]mite|due\s+date|overdue|past\s+due)\b/i,
  /\b(factura|boleta|comprobante|recibo|invoice|estado\s+de\s+cuenta)\b.{0,40}\b(electr[oó]nic|adjunt|disponible|emitid|n[°º]|\d)/i,
  /\b(constancia|comprobante)\s+de\s+(transferencia|pago|dep[oó]sito)\b/i,
  // servicio en riesgo
  /\b(service\s+disruption|suspensi[oó]n|suspended|se\s+(va\s+a\s+)?(cortar|suspender|desactivar)|interrupci[oó]n\s+del\s+servicio)\b/i,
  /\b(approaching|exceeded|reached)\s+your\s+(limit|quota|usage)/i,
  /\b(l[ií]mite\s+(alcanzado|excedido)|cuota\s+(agotada|excedida))\b/i,
  /\b(expira|expir[oó]|expiring|expires?)\s+(hoy|ma[ñn]ana|en\s+\d|in\s+\d|tu|su|your)/i,
  // seguridad
  /\b(inicio\s+de\s+sesi[oó]n|acceso)\s+(sospechos|no\s+reconocid|desde\s+un\s+dispositivo)/i,
  /\b(restablec|restabl[eé]|reset|recuperaci[oó]n)\s+(de\s+)?(tu\s+|su\s+|your\s+)?(contrase[ñn]a|password)\b/i,
  /\b(contrase[ñn]a|password)\s+(reset|recovery|change|nueva)\b/i,
  /\b(c[oó]digo\s+de\s+verificaci[oó]n|verification\s+code|one[- ]time\s+(code|password)|2fa)\b/i,
  // agenda: una reunión tuya no es una promoción
  /\b(invitaci[oó]n|invitation):\s/i,
  /\b(notificaci[oó]n|recordatorio|reminder):\s.{0,60}\b\d{1,2}(:\d{2})?\s*(am|pm|a\.\s?m\.|p\.\s?m\.)/i,
  /\b(reuni[oó]n|meeting|evento)\b.{0,30}\b(hoy|ma[ñn]ana|cancelad|reprogramad|movid)/i,
  /\b(cancelaci[oó]n|cancelad[oa]|reprogramaci[oó]n)\s+de\s+/i,
  // envíos que ya son tuyos
  // ojo: sin \b al cerrar — en JS la \b no reconoce vocales acentuadas, y "Llegó" no matcheaba
  /\b(lleg[oó]|en\s+camino|entregad[oa]|despachad[oa]|demorad[oa]).{0,30}\b(tu|su)\s+(compra|pedido|env[ií]o|paquete)\b/i,
  /\b(tu|su)\s+(compra|pedido|env[ií]o|paquete)\b.{0,30}\b(lleg[oó]|en\s+camino|entregad|despachad|demorad)/i,
  // avisos operativos que un cliente te manda
  /\b(comunicado|aviso)\b.{0,30}\b(mantenimiento|cancelaci[oó]n|urgente|importante)\b/i,
]

// …y estas SÍ son promoción, aunque contengan alguna palabra de arriba ("última oportunidad", "vence tu descuento").
const PROMO = [
  /\b\d{1,3}\s*%\s*(de\s+)?(dcto|dscto|desc|descuento|off)\b/i,
  /\b(oferta|promoci[oó]n|rebajas|sale|black\s+friday|cyber|liquidaci[oó]n|env[ií]o\s+gratis|free\s+shipping)\b/i,
  /\b(reclam[aá]|claim)\s+(tu|your)\s+(bono|bonus|regalo|premio|descuento)\b/i,
  /\b(newsletter|edici[oó]n\s+n?[°º]?\s*\d+|edition\s+\d+|weekly\\s+(newsletter|digest|roundup|recap)|digest)\b/i,
  /\b(webinar|masterclass|inscr[ií]b|reg[ií]strate|register\s+now|rsvp)\b/i,
]

/** ¿Hay que mostrarlo aunque el remitente esté marcado como spam? */
export function esTransaccional(texto) {
  const t = String(texto || "").slice(0, 600) // el asunto y el arranque: el pie de página está lleno de ruido legal
  if (!t.trim()) return false
  if (PROMO.some((re) => re.test(t))) return false // una promo con urgencia fingida sigue siendo una promo
  return ACCION.some((re) => re.test(t))
}
