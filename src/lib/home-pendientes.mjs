// QUÉ TE DEBE UNA RESPUESTA — la etapa determinista del resumen de la Home.
//
// Sale de un experimento de 10 pasadas con modelos locales. La conclusión fue que ELEGIR no puede quedar en manos del
// modelo: con 60 candidatos prioriza por POSICIÓN en la lista, no por costo, y todo lo que está pasado el puesto 40
// se vuelve invisible. La deuda de AFP estaba en el puesto 48 y sólo una de diez pasadas la encontró.
//
// Acá se decide con reglas —exacto, 0 tokens, siempre trae lo caro— y el modelo sólo redacta lo ya elegido.
import { handle as db } from "./db-core.mjs"
import { isSecretRow } from "./secret.mjs"
import { MY_EMAILS } from "./thread.mjs"
import { owner } from "./hub.mjs"

const DIAS = +process.env.HOME_PEND_DIAS || 14
const limpio = (h) => String(h || "")
  .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim()

// Ruido de difusión. No alcanza con esto solo: un aviso de deuda se escribe igual que una promo.
const BULK = /unsubscribe|darse de baja|newsletter|bolet[ií]n|% ?off|outlet|sorteo|cashback|webinar|save the date|demo day|no-?reply@|noreply@|convocatoria|postulaci[oó]n|concurso/i

// PLATA y PLAZO por separado, y se exige que CO-OCURRAN para hablar de consecuencia. Una promo de viajes dice
// "factura" y una convocatoria dice "plazo"; lo que no hacen es traer un monto Y un vencimiento a la vez sobre algo
// que te involucra. Puntuar por palabra suelta trepaba Despegar e Invest Ready arriba de la correspondencia real.
// Sin el patrón de número suelto \b\d{1,3}(\.\d{3})+\b: agarraba números de comprobante y de documento, y metía
// un aviso del banco y un "nos vamos a Chile" como si fueran plata. La plata se nombra con símbolo o con palabra.
const PLATA = /(\$|S\/|USD|PEN|ARS|EUR)\s?[\d.,]{3,}|\bdeuda\b|adeuda|aportes impagos?|\bimpago\b|\bmora\b|\bmulta\b|factura|honorarios|\bsaldo (deudor|pendiente)|cobranza|pago pendiente|movimientos? (bancarios?|sin identificar)/i
const PLAZO = /vence|vencimiento|antes del|plazo|deadline|hasta el \d|fuera de t[eé]rmino|urgente|recordatorio|pendiente de pago|regulariza/i
// Obligaciones que valen por sí solas aunque no traigan monto: el fisco y los organismos no negocian.
// Lo único que puede saltarse el filtro de difusión. Una promo de viajes trae precios; lo que no trae es la palabra
// "deuda". Sin esto, un OUTLET con "$1.234" se colaba como PLATA arriba de la correspondencia real.
const DEUDA_DURA = /\bdeuda\b|adeuda|\bimpago\b|\bmora\b|\bmulta\b|aportes|regulariza|intimaci[oó]n|requerimiento|vencimiento de pago|fuera de t[eé]rmino/i
const FISCAL = /DDJJ|declaraci[oó]n jurada|SUNAT|AFIP|AFP\b|ONP\b|SUNAFIL|ESSALUD|requerimiento|intimaci[oó]n|embargo|acta de|resoluci[oó]n/i

const PIDE = /\?|¿|por favor|porfa|me pod[eé]s|puedes|podr[ií]as|necesito|necesitamos|nos ayudas|me ayudas|confirm|av[ií]same|mandame|env[ií]ame|pas[aá]me|revis[aá]|para cu[aá]ndo|quedamos|te parece|esperamos|adjunto|adjunta|imprimir|traer|firma/i
const SOLO_MEDIA = /^(📞|🎤|🖼|📹|🌟|👤|📍)/
// Avisos que informan algo YA HECHO: no piden nada. Distinto de una deuda, que pide que pagues.
const YA_HECHO = /te enviamos tu (nuevo )?comprobante|comprobante electr[oó]nico|estado de cuenta|constancia de pago|pago (exitoso|recibido|procesado)|tu pedido (fue|ha sido)|env[ií]o (realizado|confirmado)|gracias por tu (pago|compra)/i   // "llamada perdida" o un audio suelto no son un pedido

// Clasifica POR QUÉ algo importa. Es lo que después se le muestra al usuario como etiqueta.
export function tipoDe(texto) {
  const t = String(texto || "")
  if (FISCAL.test(t)) return "PLAZO"
  if (PLATA.test(t) && PLAZO.test(t)) return "PLATA"
  if (PLATA.test(t)) return "PLATA"
  return null
}

// Hilos donde la pelota es TUYA, ordenados por costo de no contestar.
// Devuelve { pendientes, cerrados, n } — `cerrados` es la otra mitad de la pregunta: qué cerraste.
export function pendientes({ dias = DIAS, limite = 8 } = {}) {
  const desde = Date.now() - dias * 86400000
  let hilos = []
  try {
    hilos = db().prepare(`SELECT thread, MAX(ts) ult FROM messages
      WHERE ts>? AND thread!='' AND thread!='spam:status' GROUP BY thread`).all(desde)
  } catch { return { pendientes: [], cerrados: [], n: { pend: 0, cerrados: 0 } } }

  const cand = [], cerrados = []
  for (const h of hilos) {
    let u, ent, histOut
    try {
      u = db().prepare("SELECT * FROM messages WHERE thread=? ORDER BY ts DESC LIMIT 1").get(h.thread)
      ent = db().prepare("SELECT * FROM messages WHERE thread=? AND dir!='out' ORDER BY ts DESC LIMIT 1").get(h.thread)
      histOut = db().prepare("SELECT COUNT(*) c FROM messages WHERE thread=? AND dir='out'").get(h.thread).c
    } catch { continue }
    if (!u || !ent) continue
    if (isSecretRow(ent) || isSecretRow(u)) continue // 🔒 lo secreto no asoma en la Home
    // Vos escribiéndote a vos mismo no es algo pendiente. Salía en el top como "Tu Propio Nombre — Re: hola".
    const deMi = MY_EMAILS.has(String(ent.jid || "").toLowerCase()) ||
                 MY_EMAILS.has(String(ent.thread || "").replace(/^email:/, "").toLowerCase()) ||
                 String(ent.name || "").toLowerCase() === String(owner() || "").toLowerCase()
    if (deMi) continue

    // CERRADO: después del último mensaje de ellos, saliste vos. El nombre es el del CONTACTO, no el tuyo —
    // mirar `name` del mensaje saliente devolvía tu propio nombre en toda la lista.
    if (u.dir === "out" && u.ts > ent.ts) {
      cerrados.push({ quien: ent.name || h.thread, canal: u.channel, dias: +((Date.now() - u.ts) / 86400000).toFixed(1), thread: h.thread })
      continue
    }

    const asunto = String(ent.text || "").split(" — ")[0]
    if (SOLO_MEDIA.test(asunto)) continue
    const cuerpo = limpio(ent.body)
    const txt = `${asunto} ${cuerpo}`
    const tipo = tipoDe(txt)
    const adj = !!(ent.attachments && ent.attachments !== "[]") || /document|file/.test(ent.mediaType || "")
    const pide = PIDE.test(txt)
    const esChat = ent.channel !== "email"

    // ── DOS CARRILES, no un puntaje único ────────────────────────────────────────────────────────────────────
    // Iterar expresiones regulares para "importancia" no converge: "factura" aparece igual en una deuda real y en
    // el aviso de Google Workspace, y un OUTLET con precios se disfraza de plata. Lo que SÍ separa la señal del
    // ruido es quién escribe: una persona con la que ya te escribís, o una máquina.
    //
    //   Carril 1 — OBLIGACIÓN: lo manda una máquina, pero es una deuda o el fisco. Entra aunque nunca le hayas
    //              escrito. Exige una marca DURA (deuda/aportes/multa/DDJJ/SUNAT/AFP), no un simple "factura".
    //   Carril 2 — PERSONA: alguien con quien ya te escribís y que te pide algo. Exacto y sin ruido.
    // Lo que no cae en ninguno de los dos, no va a la Home.
    // La marca tiene que estar en el ASUNTO, no en el cuerpo. Buscándola en 700 caracteres de cuerpo entraban un
    // boletín de inversiones, una charla tributaria y hasta un mail religioso, por una palabra suelta perdida adentro.
    // Una deuda de verdad lo dice en el asunto: "DEUDA APORTES", "DDJJ GANANCIAS", "INTIMACIÓN DE PAGO".
    const obligacion = (DEUDA_DURA.test(asunto) || FISCAL.test(asunto)) && !YA_HECHO.test(txt)
    // `histOut > 0` solo dejaba afuera a quien te escribe por PRIMERA vez pidiendo algo — un cliente nuevo, una
    // invitación a cotizar. En un chat, quien te escribe es una persona por definición; en correo se mantiene el
    // requisito de relación previa, que es lo que ahí separa a una persona de una máquina.
    const persona = (pide || adj) && !BULK.test(`${ent.name} ${txt}`) && (histOut > 0 || esChat)
    if (!obligacion && !persona) continue
    if (esChat && !persona) continue                              // una máquina no te escribe por WhatsApp

    const dd = (Date.now() - ent.ts) / 86400000
    let p = obligacion ? 100 : 40
    if (obligacion && PLATA.test(txt)) p += 15                    // deuda CON monto: primero entre las obligaciones
    if (persona) p += Math.min(20, histOut)                       // relación más sostenida, un poco más arriba
    if (pide) p += 10
    if (adj) p += 8
    if (ent.grp) p -= 12
    p += dd <= 2 ? 8 : dd <= 5 ? 5 : dd <= 10 ? 0 : -10

    cand.push({
      thread: h.thread, quien: ent.name || h.thread, canal: ent.channel,
      dias: +dd.toFixed(1), tipo: obligacion ? (PLATA.test(txt) ? "PLATA" : "PLAZO") : "PERSONA", p,
      asunto: asunto.slice(0, 110),
      // cuerpo AMPLIO a propósito: recortarlo a 180 dejó los montos afuera y ningún modelo podía nombrarlos
      cuerpo: cuerpo.slice(0, 700),
    })
  }
  cand.sort((a, b) => b.p - a.p)
  cerrados.sort((a, b) => a.dias - b.dias)
  return { pendientes: cand.slice(0, limite), cerrados: cerrados.slice(0, 12), n: { pend: cand.length, cerrados: cerrados.length } }
}
