// CUÁNDO SE REARMA EL RESUMEN DE LA HOME.
//
// Dos corridas al día, no un intervalo. El intervalo cada 30 min era trabajo desperdiciado (el contenido cambia
// despacio) y además dejaba el resumen "a mitad de camino" a cualquier hora. Con horario fijo el trato es claro:
// entrás a la mañana y ya está lo del día; entrás a la tarde y está lo que llegó desde entonces.
//
// Todo acá es aritmética pura sobre una hora local — sin estado, sin DB — para poder probarlo a cualquier hora.
export const HORAS_DEFAULT = [4, 16] // 4am y 4pm, hora del hub

// Acepta [4,16], "4,16", "4 16", "04:00, 16:00". Descarta lo que no sea una hora del día y deduplica.
// Si no queda ninguna válida devuelve el default: la Home nunca se queda sin horario por un valor mal tipeado.
export function normalizarHoras(v, def = HORAS_DEFAULT) {
  // Se corta SÓLO por separadores (coma, punto y coma, espacio). Cortando por "todo lo que no sea dígito", un "-3"
  // se convertía en 3 y una cadena vacía en 0: dos valores que el usuario nunca escribió.
  const crudo = Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/)
  const n = crudo
    .map((x) => String(x).trim())
    .filter(Boolean)                              // "" → Number("") es 0, o sea medianoche: hay que sacarlo ANTES
    .map((x) => x.split(":")[0])                  // "16:30" → la corrida es a las 16, los minutos no se configuran
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x >= 0 && x <= 23)
  const u = [...new Set(n)].sort((a, b) => a - b)
  return u.length ? u : [...def]
}

// Partes de la hora LOCAL del hub. Intl es la única forma correcta de hacer esto: restarle un offset fijo a la fecha
// se rompe en cualquier zona con horario de verano.
export function partesLocales(ms, tz = "America/Lima") {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const p = {}
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second }
}

// El instante de la última corrida programada que YA pasó. Si hoy todavía no llegó ninguna, es la última de ayer.
// Se calcula RESTANDO el tiempo transcurrido desde esa hora local en vez de reconstruir un epoch desde la fecha local:
// invertir tz→epoch tiene casos ambiguos en los saltos de horario, y restar no.
export function ultimaProgramada(ms, horas = HORAS_DEFAULT, tz = "America/Lima") {
  const hs = normalizarHoras(horas)
  const { h, mi, s } = partesLocales(ms, tz)
  const desdeLaHora = mi * 60000 + s * 1000 + (ms % 1000) // lo que va corrido de la hora actual
  const previa = [...hs].reverse().find((x) => x <= h)
  const atras = previa != null ? h - previa : h + 24 - hs[hs.length - 1] // si ninguna pasó hoy, la última de ayer
  return ms - atras * 3600000 - desdeLaHora
}

// La PRÓXIMA, para poder decirle al usuario cuándo se actualiza (la Home lo muestra).
export function proximaProgramada(ms, horas = HORAS_DEFAULT, tz = "America/Lima") {
  const hs = normalizarHoras(horas)
  const { h, mi, s } = partesLocales(ms, tz)
  const restaDeLaHora = 3600000 - (mi * 60000 + s * 1000 + (ms % 1000))
  const sig = hs.find((x) => x > h)
  const adelante = sig != null ? sig - h - 1 : hs[0] + 24 - h - 1
  return ms + adelante * 3600000 + restaDeLaHora
}

// ¿Hay que correr? Sí cuando el último resultado quedó ANTES de la corrida programada más reciente.
// Formulado así, el mismo chequeo cubre los tres casos sin código extra: la hora llegó recién, el daemon estuvo
// caído y se perdió una corrida, o alguien cambió el horario en Configuración hace un minuto.
export function tocaCorrer(ms, tsUltimo, horas = HORAS_DEFAULT, tz = "America/Lima") {
  return !(tsUltimo > 0) || tsUltimo < ultimaProgramada(ms, horas, tz)
}

export const horasEs = (horas = HORAS_DEFAULT) =>
  normalizarHoras(horas).map((h) => `${String(h).padStart(2, "0")}:00`).join(" y ")
