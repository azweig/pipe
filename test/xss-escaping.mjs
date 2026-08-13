// XSS ALMACENADO: el peor fallo posible de esta app. Todo lo que entra por un mensaje —texto, nombre de contacto, nombre de
// grupo, URL de media— lo escribe un TERCERO, y app.js lo pinta con innerHTML/insertAdjacentHTML. Un solo `${x}` sin escapar
// convierte "alguien te escribió" en "alguien ejecuta código en tu hub, con tu sesión abierta".
//
// Historia: el chip de "Agendar reunión" interpolaba `${(r.matched||"").slice(0,40)}` —un recorte LITERAL del mensaje entrante—
// sin escapar, mientras la MISMA variable sí iba escapada 21 líneas más abajo. Era un olvido, no una decisión.
//
// Esta prueba es estática a propósito: no simula un navegador, revisa el FUENTE. Así falla en CI antes de llegar a producción.
// Runner: node --test test/xss-escaping.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SRC = readFileSync("public/app.js", "utf8")
const lineOf = (i) => SRC.slice(0, i).split("\n").length

// Un valor interpolado es SEGURO si pasa por uno de los ayudantes del archivo (definidos y documentados en las líneas 86-98):
//   esc     → texto/atributos HTML
//   escj    → dentro de una string JS de un onclick (esc ahí es un no-op: el HTML decodifica las entidades ANTES que el parser JS)
//   escCss  → dentro de url() en un style (mismo motivo)
//   enck    → identificadores en una URL
const SAFE = /^\s*(esc|escj|escCss|enck|ek|_p2|Number|parseInt|String\(|JSON\.stringify)\b/
// literales y expresiones que no pueden traer datos de terceros
const INERT = /^\s*(`|'|"|\d|\+?\+|[A-Z_]+\s*[,)\]]?$|window\.|location\.|Date\b|Math\.)/

test("ningún url() de CSS interpola un valor sin escCss()", () => {
  const bad = []
  for (const m of SRC.matchAll(/url\(\$\{([^}]*)\}/g)) {
    if (!/escCss\(/.test(m[1])) bad.push(`línea ${lineOf(m.index)}: url(\${${m[1].slice(0, 40)}})`)
  }
  assert.deepEqual(bad, [], `esc() NO alcanza dentro de url(): el atributo decodifica las entidades antes que el parser CSS.\n${bad.join("\n")}`)
})

test("el chip de agenda escapa el fragmento del mensaje entrante", () => {
  // pineamos el caso concreto que fue explotable: viene de /api/thread/schedule, o sea del texto que te mandaron
  const chip = SRC.slice(SRC.indexOf('id="schedChip"'), SRC.indexOf('id="schedChip"') + 1200)
  assert.ok(chip.length > 100, "no encontré el chip de agenda — ¿se renombró?")
  for (const m of chip.matchAll(/\$\{([^}]+)\}/g)) {
    const expr = m[1]
    if (/r\.matched|when|r\.topic|r\.title/.test(expr)) {
      assert.match(expr, /esc\(/, `el chip interpola ${JSON.stringify(expr.slice(0, 50))} sin escapar — es texto de un tercero`)
    }
  }
})

test("los handlers inline no interpolan valores crudos dentro de la string JS", () => {
  // onclick="fn('${x}')" con x crudo = ejecución directa. El idioma correcto es fn(${escj(x)}) o fn('${enck(x)}').
  const bad = []
  for (const m of SRC.matchAll(/on(?:click|change|input|error|load)="[^"]*?\(\s*'\$\{([^}]+)\}'/g)) {
    const expr = m[1]
    if (SAFE.test(expr) || INERT.test(expr)) continue
    bad.push(`línea ${lineOf(m.index)}: '\${${expr.slice(0, 45)}}'`)
  }
  assert.deepEqual(bad, [], `valor crudo dentro de una string JS de un handler inline:\n${bad.join("\n")}`)
})
