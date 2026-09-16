// LAS ACCIONES DE LA HOME — etapa 2: convertir lo ya elegido en imperativos.
//
// El modelo NO elige (eso lo hizo home-pendientes con reglas): sólo redacta. Ese reparto salió de 10 pasadas de
// experimento y es la única forma en que lo caro entra siempre.
//
// DEGRADABLE POR DISEÑO: si el modelo tarda, falla o está encolado, `acciones()` devuelve igual la lista armada con
// reglas. La Home nunca se queda vacía por culpa del LLM — que en este hub llegó a tardar 233s por cola.
import { llm, smartChain } from "./llm.mjs"
import { pendientes } from "./home-pendientes.mjs"
import { owner } from "./hub.mjs"

const VERBO = { PLATA: "Pagá", PLAZO: "Resolvé", PERSONA: "Respondé a", OTRO: "Revisá" }
const canalEs = (c) => (c === "email" ? "correo" : c === "whatsapp" ? "WhatsApp" : c === "telegram" ? "Telegram" : c === "teams" ? "Teams" : c || "mensaje")
const diasEs = (d) => (d < 1 ? "hoy" : d < 2 ? "ayer" : `${Math.round(d)} días`)

// Línea de respaldo, sin modelo. Es lo que se muestra si el LLM no está.
const lineaRegla = (x) => `${VERBO[x.tipo] || "Revisá"} ${x.quien}: ${x.asunto.slice(0, 70)} (${canalEs(x.canal)}, ${diasEs(x.dias)})`

// Aprendido a los golpes en el experimento:
//  · Los ejemplos van con nombres FICTICIOS. Con un nombre real adentro, el modelo lo copia a la salida como si fuera
//    un dato — una pasada escribió la línea de una deuda que no estaba entre los seleccionados.
//  · El formato se muestra con valores CONCRETOS: pedir "(canal, N días)" hacía que copiara la "N" literal.
//  · La lista de "ya contestaste" va AL FINAL, pegada a su instrucción: en el medio del prompt, el modelo la mezclaba
//    con los pendientes y nombraba gente que en realidad estaba esperando respuesta.
//  · Texto plano, no JSON: el JSON cuesta ~30% más tokens de salida y con este hardware termina truncado.
export function promptAcciones(pend, cerrados) {
  const filas = pend.map((x, i) =>
    `${i + 1}. [${x.tipo}] ${x.quien} · ${canalEs(x.canal)} · hace ${diasEs(x.dias)}\n   ${x.asunto}\n   ${x.cuerpo.slice(0, 320)}`).join("\n\n")
  const nombres = cerrados.slice(0, 6).map((c) => c.quien).filter(Boolean)
  return `Sos el asistente de quien te habla. Estos ${pend.length} mensajes ya fueron seleccionados: todos le piden algo.

${filas}

Escribí las acciones para su pantalla de inicio. Una por línea, empezando con "- " y EL NÚMERO DEL MENSAJE.
- Una línea por cada mensaje de arriba, TODOS, empezando con su número y un punto: "- 1. ", "- 2. "…
- El número tiene que ser el del mensaje al que corresponde la acción. Es lo único que los vincula.
- Estos mensajes YA fueron filtrados: todos requieren algo. No existe "ignorar" ni "sin acción".
- Cada línea arranca con un verbo en imperativo y dice QUÉ hacer y CON QUIÉN, usando el nombre tal cual figura.
- NO escribas el canal ni los días: eso se agrega solo.
- Si el mensaje trae un monto, una fecha o un número de expediente, incluilo. Si no lo trae, no lo inventes.
- Nada de "responder el correo de": decí la acción concreta que resuelve el asunto.

Ejemplo de la forma (datos ficticios, no los uses):
- 1. Pagá a Proveedora Ejemplo la factura F-001 por $1.234
- 2. Mandale a Fulano Ficticio los archivos que pidió

${nombres.length ? `Al final agregá una sola línea que empiece con "Ya contestaste: " nombrando SOLO a estas personas: ${nombres.join(", ")}.` : ""}

Acciones:`
}

// Parsea la salida: sólo las líneas que empiezan con "-" y la de cierre. Todo lo demás (preámbulos tipo "Aquí tienes",
// numeraciones sueltas, comentarios del modelo) se descarta.
export function parsearAcciones(texto) {
  const l = String(texto || "").split("\n").map((s) => s.trim())
  const acciones = []
  for (const linea of l) {
    if (!/^[-•*]\s+\S/.test(linea)) continue
    const cuerpo = linea.replace(/^[-•*]\s+/, "").trim()
    // El número es el ANCLA al mensaje de origen. Sin él la línea no se puede ubicar y se descarta: es la diferencia
    // entre "falta una acción" y "esta acción apunta a la conversación equivocada".
    const m = /^(\d{1,2})\s*[.)-]\s*(.+)$/.exec(cuerpo)
    if (!m || m[2].length <= 8) continue
    acciones.push({ num: +m[1], texto: m[2].trim() })
  }
  const ya = l.find((s) => /^ya contestaste\s*:/i.test(s)) || ""
  return { acciones, ya: ya.replace(/^ya contestaste\s*:\s*/i, "").trim() }
}

// Resumen completo para la Home. Nunca tira: si el modelo falla, `fuente` dice "reglas" y las acciones son las de
// respaldo. El llamador puede mostrar exactamente lo mismo en los dos casos.
// Toda cifra de 3+ dígitos que el modelo escriba tiene que existir en el texto de origen. Un modelo chico inventa
// montos con total aplomo — en la primera corrida escribió "US$27448.18" sobre un correo que no lo menciona. Un
// resumen que miente un número es peor que no tener resumen, así que ante la duda se cae a las reglas.
export function cifrasInventadas(linea, origen) {
  const norm = (x) => String(x).replace(/[.,\s]/g, "")
  const enOrigen = new Set((String(origen).match(/\d[\d.,]{2,}/g) || []).map(norm))
  for (const c of String(linea).match(/\d[\d.,]{2,}/g) || []) {
    const n = norm(c)
    if (n.length < 3) continue
    if (/^(20\d\d|19\d\d)$/.test(n)) continue          // años: no son montos
    if (!enOrigen.has(n) && ![...enOrigen].some((o) => o.includes(n))) return c
  }
  return null
}

// El modelo copia la etiqueta [PLATA]/[PLAZO] de las filas que le pasamos y la deja EN LA ACCIÓN:
// "Responder al correo de [PLATA] sfacturacion@…". El ícono de la tarjeta ya dice el tipo; en el texto es ruido.
// El paréntesis FINAL también se saca porque lo reponemos nosotros con el canal y los días reales.
// UN MODELO CHICO, ANTE LA DUDA, COMENTA EN VEZ DE ACTUAR: "Ignorar, no hay acción específica para este mensaje".
// Es una contradicción con el diseño —las reglas ya decidieron que el mensaje importa— y además deja al usuario con
// una tarjeta que le dice que no haga nada sobre una deuda. Estas líneas se descartan y vale la línea por reglas.
// (Apareció al darle permiso de saltearse ítems: el permiso lo usó para opinar, no para omitir.)
const META = /^\s*(ignorar|omitir|sin acci[oó]n|no (hay|requiere|necesita|aplica)|ninguna acci[oó]n|n\/?a\b|no se requiere)/i
export const esMetaComentario = (s) => META.test(String(s || ""))

export const limpiarLinea = (s) => String(s).replace(/\[(PLATA|PLAZO|PERSONA|OTRO)\]\s*/gi, "")
  .replace(/\s*\([^)]*\)\s*$/, "").replace(/\s{2,}/g, " ").trim()

// ¿ESTA FRASE HABLA DE ESTE MENSAJE? El número que escribe el modelo es un ancla, no una garantía: puede numerar mal.
// Visto en producción tras poner el ancla: escribió la acción de la DDJJ con el número de la factura, y la de la AFP
// con el número de la DDJJ. El ancla evitó la cascada —las otras cuatro quedaron bien— pero esas dos seguían pegadas
// al hilo equivocado.
// La verificación es la misma idea que la de las cifras: exigir que algo de la frase EXISTA en el origen. Si la línea
// no comparte ni una palabra con el nombre ni con el asunto del mensaje, no es su línea.
const fichas = (s) => new Set(String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .match(/[a-z0-9]{4,}/g) || [])
export function correspondeAlItem(linea, item) {
  const enLinea = fichas(linea)
  for (const f of fichas(`${item?.quien || ""} ${item?.asunto || ""}`)) if (enLinea.has(f)) return true
  return false
}

// ── LA PUERTA ────────────────────────────────────────────────────────────────────────────────────────────────────
// NO SE PUEDE GARANTIZAR QUE UN MODELO NO ALUCINE. Lo que sí se puede garantizar es que nada que no se pueda
// verificar contra el mensaje de origen llegue a la pantalla. Esa es la única promesa que este archivo hace, y está
// concentrada acá: una línea del modelo entra sólo si pasa TODAS las comprobaciones; si falla una, se usa la línea
// armada con reglas — más sosa, pero construida con los datos, no escrita por un modelo.
//
// Las cinco salieron de fallas REALES observadas en producción, no de imaginar qué podría salir mal.
const normal = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
const tokens = (s) => new Set(normal(s).match(/[a-z0-9]{3,}/g) || [])

// Nombres propios y siglas que el modelo escribe: capitalizados en medio de la frase, o en mayúsculas sostenidas.
// Cada uno tiene que existir en el origen. Es el hueco más peligroso que quedaba: inventar una cifra se nota, pero
// inventar el nombre de una empresa o de una persona se lee como un dato y manda a alguien a hablar con un fantasma.
// La palabra se captura ENTERA aunque venga en CamelCase: partir "AcmeCorp" en "Acme" deja un token que no existe
// en ningún lado y hace rechazar una línea correcta. Pasó en la primera corrida con la puerta puesta.
const PROPIOS = /(?<=[a-záéíóúñ,;:]\s+)([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)|\b([A-ZÁÉÍÓÚÑ]{3,})\b/gu
export function nombresInventados(linea, origen) {
  const enOrigen = tokens(origen)
  for (const m of String(linea).matchAll(PROPIOS)) {
    const palabra = m[1] || m[2]
    const t = normal(palabra)
    if (t.length < 3) continue
    if (PALABRAS_COMUNES.has(t)) continue
    if (enOrigen.has(t)) continue
    // Y se acepta la coincidencia parcial en los dos sentidos: el origen escribe "ACMECORP" y el modelo "Acmecorp
    // S.A.S.", o al revés. Lo que se está probando es que la entidad EXISTA en el correo, no que se escriba idéntica.
    if (t.length >= 4 && [...enOrigen].some((o) => o.length >= 4 && (o.includes(t) || t.includes(o)))) continue
    return palabra
  }
  return null
}
// Capitalizadas que NO son nombres propios: arranques de oración, meses, y el vocabulario que cualquier redacción usa.
// Sin esta lista, un "Declaraciones Juradas" perfectamente legítimo se leería como entidad inventada.
const PALABRAS_COMUNES = new Set(("enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre " +
  "noviembre diciembre lunes martes miercoles jueves viernes sabado domingo hola estimado estimada saludos " +
  "declaraciones juradas factura facturas boleta recibo contrato informe documento adjunto pago pagos deuda " +
  "aportes planilla planillas impuesto impuestos vencimiento expediente resolucion acta reunion").split(" "))

// Que la acción no te la dirija a VOS. El asunto de un correo del contador suele traer el nombre del propio
// destinatario ("DDJJ 2025 - <tu nombre>"), y el modelo lo tomó como si fuera la contraparte: escribió una acción
// para hablar con uno mismo. Como el nombre SÍ está en el origen, la guarda de nombres inventados no lo ve.
export function dirigidaAlDueno(linea, duenio) {
  const t = tokens(duenio)
  if (t.size < 2) return false                     // un nombre de una sola palabra da demasiados falsos positivos
  const enLinea = tokens(linea)
  return [...t].every((x) => enLinea.has(x))
}

// LA PUERTA. Devuelve null si la línea es publicable, o el MOTIVO del rechazo (que se cuenta, para poder medir si el
// modelo está empeorando en vez de enterarse por una captura de pantalla).
export function motivoRechazo(linea, item, duenio = "") {
  if (!linea || String(linea).trim().length < 10) return "vacía"
  if (esMetaComentario(linea)) return "meta-comentario"
  if (!correspondeAlItem(linea, item)) return "no habla de este mensaje"
  const origen = `${item?.quien || ""} ${item?.asunto || ""} ${item?.cuerpo || ""}`
  const cifra = cifrasInventadas(linea, origen)
  if (cifra) return "cifra inventada: " + cifra
  const nombre = nombresInventados(linea, origen)
  if (nombre) return "nombre inventado: " + nombre
  if (dirigidaAlDueno(linea, duenio)) return "te la dirige a vos mismo"
  return null
}

export async function acciones({ limite = 6, usarLLM = true } = {}) {
  const { pendientes: pend, cerrados, n } = pendientes({ limite })
  const base = {
    acciones: pend.map(lineaRegla),
    items: pend.map((x) => ({ tipo: x.tipo, quien: x.quien, canal: x.canal, dias: x.dias, thread: x.thread, asunto: x.asunto })),
    cerrados: cerrados.map((c) => c.quien).filter(Boolean).slice(0, 6),
    n, fuente: "reglas", ts: Date.now(),
  }
  if (!pend.length || !usarLLM) return base
  try {
    const txt = await llm(promptAcciones(pend, cerrados), {
      feature: "home", chain: smartChain({ sensitive: true, feature: "home" }),
      temperature: 0.2, numPredict: 420, raw: true,
      timeoutMs: +process.env.HOME_ACCIONES_TIMEOUT_MS || 240000,
    })
    const p = parsearAcciones(txt)
    // EMPAREJAR POR NÚMERO, NUNCA POR POSICIÓN. "Una línea por mensaje, en el mismo orden" es una instrucción del
    // prompt, no un contrato: el modelo se saltea ítems. Cuando se emparejaba por posición, saltarse UNO corría todo
    // lo de abajo un lugar — y como el canal, los días y el enlace los pone el código, cada línea corrida quedaba
    // pegada a la conversación equivocada y con datos que parecían confiables. Visto en producción: 3 de 6 líneas
    // apuntaban a otro hilo y el ítem más caro desapareció del texto.
    const porItem = new Map()
    for (const { num, texto } of p.acciones) {
      if (!(num >= 1 && num <= pend.length)) continue   // número que no corresponde a ningún mensaje: se descarta
      if (porItem.has(num)) continue                    // repetido: vale el primero
      porItem.set(num, texto)
    }
    if (porItem.size) {
      // Se recorren los ÍTEMS, no las líneas: así todos los mensajes elegidos aparecen, y los que el modelo se saltó
      // caen a su línea por reglas en vez de desaparecer.
      const rechazos = []
      const lineas = pend.map((x, i) => {
        const t = porItem.get(i + 1)
        if (!t) { rechazos.push({ i: i + 1, motivo: "el modelo no la escribió" }); return lineaRegla(x) }
        const limpia = limpiarLinea(t)
        const motivo = motivoRechazo(limpia, x, owner())
        if (motivo) { rechazos.push({ i: i + 1, motivo }); return lineaRegla(x) }
        return `${limpia} (${canalEs(x.canal)}, ${diasEs(x.dias)})`
      })
      const verificadas = pend.length - rechazos.length
      return { ...base, acciones: lineas, ya: p.ya, verificadas, rechazos,
               fuente: verificadas === pend.length ? "ia" : verificadas ? "mixto" : "reglas" }
    }
  } catch { /* encolado, timeout o sin modelo: se muestran las reglas */ }
  return base
}
