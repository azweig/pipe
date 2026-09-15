// LAS ACCIONES DE LA HOME — etapa 2: convertir lo ya elegido en imperativos.
//
// El modelo NO elige (eso lo hizo home-pendientes con reglas): sólo redacta. Ese reparto salió de 10 pasadas de
// experimento y es la única forma en que lo caro entra siempre.
//
// DEGRADABLE POR DISEÑO: si el modelo tarda, falla o está encolado, `acciones()` devuelve igual la lista armada con
// reglas. La Home nunca se queda vacía por culpa del LLM — que en este hub llegó a tardar 233s por cola.
import { llm, smartChain } from "./llm.mjs"
import { pendientes } from "./home-pendientes.mjs"

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

Escribí las acciones para su pantalla de inicio. Una por línea, empezando con "- ".
- Una línea por cada mensaje de arriba, en el MISMO orden. No agregues ni saques ninguno.
- Cada línea arranca con un verbo en imperativo y dice QUÉ hacer y CON QUIÉN, usando el nombre tal cual figura.
- NO escribas el canal ni los días: eso se agrega solo.
- Si el mensaje trae un monto, una fecha o un número de expediente, incluilo. Si no lo trae, no lo inventes.
- Nada de "responder el correo de": decí la acción concreta que resuelve el asunto.

Ejemplo de la forma (datos ficticios, no los uses):
- Pagá a Proveedora Ejemplo la factura F-001 por $1.234
- Mandale a Fulano Ficticio los archivos que pidió

${nombres.length ? `Al final agregá una sola línea que empiece con "Ya contestaste: " nombrando SOLO a estas personas: ${nombres.join(", ")}.` : ""}

Acciones:`
}

// Parsea la salida: sólo las líneas que empiezan con "-" y la de cierre. Todo lo demás (preámbulos tipo "Aquí tienes",
// numeraciones sueltas, comentarios del modelo) se descarta.
export function parsearAcciones(texto) {
  const l = String(texto || "").split("\n").map((s) => s.trim())
  const acciones = l.filter((s) => /^[-•*]\s+\S/.test(s)).map((s) => s.replace(/^[-•*]\s+/, "").trim()).filter((s) => s.length > 8)
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
    // Si devolvió menos de la mitad de las líneas pedidas, algo salió mal (truncado, preámbulo raro): mejor las reglas.
    if (p.acciones.length >= Math.ceil(pend.length / 2)) {
      const limpias = []
      for (let i = 0; i < Math.min(p.acciones.length, pend.length); i++) {
        const x = pend[i]
        const inventada = cifrasInventadas(p.acciones[i], `${x.asunto} ${x.cuerpo}`)
        // el canal y la demora los ponemos NOSOTROS: el modelo ponía el nombre del contacto donde iba el canal,
        // y le puso "WhatsApp" a un correo.
        const cuerpo = String(p.acciones[i]).replace(/\s*\([^)]*\)\s*$/, "").trim()
        limpias.push(inventada ? lineaRegla(x) : `${cuerpo} (${canalEs(x.canal)}, ${diasEs(x.dias)})`)
      }
      if (limpias.length) return { ...base, acciones: limpias, ya: p.ya, fuente: "ia" }
    }
  } catch { /* encolado, timeout o sin modelo: se muestran las reglas */ }
  return base
}
