// MODO ENCUBIERTO ("El Santo") — esteganografía lingüística con cifrado REAL.
// El mensaje se cifra con una passphrase compartida (AES-256-GCM) y los bytes cifrados se codifican en un texto tapadera que se LEE
// como lenguaje natural (poema / cuento / receta / oración) pero es semánticamente vacío. Quien lo ve por WhatsApp lee "un poema";
// quien tiene Pipe + la passphrase lo revierte y recupera el mensaje. El tag GCM autentica: sin la clave no se lee y no hay falsos
// positivos (un texto que NO sea nuestro, o con clave equivocada, falla el auth y se muestra tal cual).
//
// Seguridad: confidencialidad FUERTE (depende de la passphrase). Detectabilidad: MODERADA — un analista que conozca este esquema
// puede notar que el texto usa nuestros diccionarios, pero igual NO puede descifrarlo. Es un feature de privacidad, no un canal militar.
// Contra honesta: el texto tapadera es largo (la codificación coherente tiene poca densidad de bits) → ideal para notas cortas.
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "crypto"

// ── cripto (passphrase simétrica) ───────────────────────────────────────────────────────────────────────────────────────────
const SALT = "pipe.one/covert/v1" // salt fijo del KDF: passphrase compartida → misma clave en ambos lados. El nonce (aleatorio por
const _kc = new Map() //                                mensaje) es lo que da la seguridad GCM. Cache de claves derivadas (self-host).
function keyFor(pass) {
  const s = String(pass || "")
  let k = _kc.get(s)
  if (!k) { k = scryptSync(s, SALT, 32, { N: 16384, r: 8, p: 1 }); _kc.set(s, k) }
  return k
}
function seal(text, pass) {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", keyFor(pass), iv, { authTagLength: 8 }) // tag de 8 bytes (64-bit) → más compacto; suficiente
  const ct = Buffer.concat([c.update(Buffer.from(String(text), "utf8")), c.final()]) //                            para este caso de uso
  return Buffer.concat([iv, c.getAuthTag(), ct]) // 12 + 8 + N
}
function open(blob, pass) {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 20), ct = blob.subarray(20)
  const d = createDecipheriv("aes-256-gcm", keyFor(pass), iv, { authTagLength: 8 })
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8") // lanza si el auth falla (clave mala / texto ajeno)
}

// ── bits ⇄ bytes ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const toBits = (buf) => { const b = []; for (const byte of buf) for (let i = 7; i >= 0; i--) b.push((byte >> i) & 1); return b }
const fromBits = (bits) => { const out = Buffer.alloc(Math.floor(bits.length / 8)); for (let i = 0; i < out.length; i++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j]; out[i] = v } return out }
const log2 = (n) => Math.round(Math.log2(n))

// ── gramáticas por estilo ───────────────────────────────────────────────────────────────────────────────────────────────────
// Cada estilo define: `lists` (diccionarios de largo potencia-de-2 → cada palabra codifica log2(N) bits), `seq` (ciclo de elementos:
// {lit} palabra fija sin bits, o {slot} palabra de una lista que SÍ lleva bits), y `fmt` (SOLO cosmético: capitaliza, corta en versos,
// agrega puntuación — NO agrega/quita/reordena palabras, porque el decoder depende de la secuencia exacta de palabras).
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
function group(words, per, sep, end) {
  const lines = []
  for (let i = 0; i < words.length; i += per) lines.push(cap(words.slice(i, i + per).join(" ")))
  return lines.join(sep) + end
}

const GRAMMARS = {
  poema: {
    label: "🕊️ Poema",
    lists: {
      SUS: ["luna", "sombra", "río", "viento", "fuego", "mar", "cielo", "piedra", "flor", "noche", "alba", "niebla", "estrella", "camino", "silencio", "abismo"],
      VER: ["arde", "cae", "sueña", "espera", "canta", "tiembla", "huye", "nace", "vuela", "calla", "brilla", "sangra", "danza", "respira", "olvida", "regresa"],
      ADJ: ["azul", "eterno", "roto", "dorado", "lejano", "herido", "salvaje", "quieto", "oscuro", "tibio", "desnudo", "antiguo", "frágil", "inmenso", "secreto", "amargo"],
      PRE: ["sobre", "bajo", "entre", "hacia", "sin", "tras", "desde", "contra"],
    },
    seq: [{ slot: "SUS" }, { slot: "VER" }, { lit: "y" }, { slot: "ADJ" }, { slot: "SUS" }, { slot: "VER" }, { slot: "PRE" }, { slot: "SUS" }],
    fmt: (w) => group(w, 4, ",\n", "."),
  },
  cuento: {
    label: "📖 Cuento",
    lists: {
      QUI: ["el viajero", "la niña", "un rey", "la anciana", "el lobo", "la reina", "un pastor", "el herrero", "la bruja", "un marino", "el monje", "la hija", "un ladrón", "el juglar", "la sombra", "un niño"],
      ACC: ["caminó", "encontró", "perdió", "buscó", "guardó", "temió", "recordó", "cruzó", "soñó", "escondió", "abrió", "siguió", "olvidó", "vendió", "quemó", "halló"],
      OBJ: ["la llave", "un mapa", "el anillo", "la carta", "un espejo", "la moneda", "el reloj", "la espada", "un frasco", "la corona", "el retrato", "la lámpara", "un dado", "la aguja", "el cofre", "la vela"],
      LUG: ["el bosque", "la aldea", "el puerto", "la torre", "un desván", "la feria", "el molino", "la cueva"],
    },
    seq: [{ lit: "entonces" }, { slot: "QUI" }, { slot: "ACC" }, { slot: "OBJ" }, { lit: "en" }, { slot: "LUG" }, { lit: "y" }, { slot: "QUI" }, { slot: "ACC" }, { slot: "OBJ" }],
    fmt: (w) => group(w, 6, ". ", "."),
  },
  receta: {
    label: "🍲 Receta",
    lists: {
      ACT: ["mezcla", "corta", "hierve", "dora", "sirve", "bate", "reposa", "sazona", "pica", "funde", "escurre", "flambea", "amasa", "glasea", "tuesta", "marina"],
      ING: ["cebolla", "harina", "tomate", "ajo", "romero", "canela", "manteca", "azúcar", "laurel", "queso", "pimienta", "limón", "menta", "jengibre", "vainilla", "comino"],
      MOD: ["a fuego lento", "sin prisa", "con cuidado", "hasta dorar", "en frío", "al punto", "muy fino", "de a poco"],
    },
    seq: [{ slot: "ACT" }, { lit: "la" }, { slot: "ING" }, { lit: "con" }, { slot: "ING" }, { slot: "MOD" }, { lit: "y" }, { slot: "ACT" }, { lit: "el" }, { slot: "ING" }],
    fmt: (w) => group(w, 6, ", ", "."),
  },
  oracion: {
    label: "🙏 Oración",
    lists: {
      LUZ: ["luz", "gracia", "paz", "fe", "gloria", "misericordia", "esperanza", "consuelo", "perdón", "fuerza", "calma", "sabiduría", "dicha", "amparo", "fervor", "bondad"],
      ACO: ["guía", "protege", "sostén", "ilumina", "acompaña", "bendice", "escucha", "levanta", "consuela", "perdona", "cuida", "sana", "abraza", "sostiene", "renueva", "salva"],
      ALM: ["mi alma", "tu siervo", "el camino", "la noche", "mi voz", "los tuyos", "el débil", "la casa", "mi paso", "el mundo", "tu nombre", "la herida", "mi anhelo", "el humilde", "la vida", "mi espera"],
      HOR: ["hoy", "siempre", "ahora", "aquí", "también", "aún", "todavía", "ya"],
    },
    seq: [{ lit: "señor" }, { slot: "ACO" }, { slot: "ALM" }, { lit: "con tu" }, { slot: "LUZ" }, { slot: "HOR" }, { lit: "y danos" }, { slot: "LUZ" }],
    fmt: (w) => group(w, 4, ",\n", "."),
  },
}

export function styles() { return Object.entries(GRAMMARS).map(([id, g]) => ({ id, label: g.label })) }

// ── codificar: texto plano + passphrase + estilo → texto tapadera ───────────────────────────────────────────────────────────
export function encodeCovert(text, pass, styleId = "poema") {
  const g = GRAMMARS[styleId] || GRAMMARS.poema
  const t = String(text || "")
  if (!t.trim()) throw new Error("mensaje vacío")
  const blob = seal(t, pass)
  if (blob.length > 0xffff) throw new Error("mensaje demasiado largo para modo encubierto (probá algo más corto)")
  const bits = []
  for (let i = 15; i >= 0; i--) bits.push((blob.length >> i) & 1) // prefijo de 16 bits con el largo del blob → el decoder sabe cuántos bytes tomar
  bits.push(...toBits(blob))
  const words = []
  let pos = 0
  do {
    for (const el of g.seq) {
      if (el.lit) { words.push(el.lit); continue }
      const list = g.lists[el.slot], k = log2(list.length)
      let idx = 0
      for (let j = 0; j < k; j++) { idx = (idx << 1) | (pos < bits.length ? bits[pos] : 0); pos++ } // relleno con 0 al final para cerrar el ciclo
      words.push(list[idx])
    }
  } while (pos < bits.length)
  return g.fmt(words)
}

// intenta parsear el texto con UNA gramática → devuelve el bitstream, o null si no encaja (palabra fija distinta / palabra fuera de lista)
function parseWith(g, tokens) {
  const bits = []
  let ti = 0
  while (ti < tokens.length) {
    for (const el of g.seq) {
      if (ti >= tokens.length) return bits // se acabaron los tokens en medio de un ciclo → devolvemos lo que hay
      const w = tokens[ti++]
      if (el.lit) { if (w !== el.lit && !el.lit.split(" ").includes(w)) return null; if (el.lit.includes(" ")) ti += el.lit.split(" ").length - 1; continue }
      const list = g.lists[el.slot], k = log2(list.length)
      let idx = list.indexOf(w)
      if (idx < 0 && w) { // los multi-palabra ("la llave") se tokenizan en varias → reintentar uniendo las siguientes
        for (let n = 2; n <= 3 && idx < 0; n++) { const joined = [w, ...tokens.slice(ti, ti + n - 1)].join(" "); idx = list.indexOf(joined); if (idx >= 0) ti += n - 1 }
      }
      if (idx < 0) return null
      for (let j = k - 1; j >= 0; j--) bits.push((idx >> j) & 1)
    }
  }
  return bits
}

// ── decodificar: texto tapadera + passphrase → { text, style } | null ───────────────────────────────────────────────────────
// Style-agnóstico: prueba cada gramática; la que produzca un blob cuyo tag GCM valide con la passphrase gana. Si ninguna → null
// (no era un mensaje encubierto nuestro, o la passphrase es equivocada) → el mensaje se muestra tal cual.
export function decodeCovert(coverText, pass) {
  const tokens = String(coverText || "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean)
  if (tokens.length < 4) return null
  for (const styleId of Object.keys(GRAMMARS)) {
    const bits = parseWith(GRAMMARS[styleId], tokens)
    if (!bits || bits.length < 16) continue
    let L = 0; for (let i = 0; i < 16; i++) L = (L << 1) | bits[i]
    const need = 16 + L * 8
    if (L < 20 || bits.length < need) continue // blob mínimo = 12(iv)+8(tag) = 20 bytes
    try { return { text: open(fromBits(bits.slice(16, need)), pass), style: styleId } } catch { /* auth falló → siguiente estilo */ }
  }
  return null
}
