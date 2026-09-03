// 📧 SECCIÓN CORREO en las TRES apps — tres cajones y poder corregir al clasificador.
//
// Nace de un problema medido: de 267 hilos de correo, 223 estaban en el cajón de spam, y la bandeja esconde ese
// cajón por completo. O sea que un falso positivo era invisible Y no había forma de desmarcarlo desde la app.
// Entre lo escondido había un "Problema de facturación", un aviso de corte de servicio y una reunión de agenda.
//
// Runner: node --test test/correo-seccion.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"

const SRV = readFileSync("src/server.mjs", "utf8")
const WEB = readFileSync("public/app.js", "utf8")
const CSS = readFileSync("public/index.html", "utf8")

// Las apps viven en repos hermanos. En el servidor sólo está el hub, así que esas comprobaciones se SALTAN en vez
// de fallar: una prueba roja por un repo ausente no informa nada y entrena a ignorar el rojo.
const rutaApp = (p) => ["../pipe-app/", "../../pipe-app/"].map((b) => b + p).find(existsSync)
const rutaDesk = (p) => ["../pipe-desktop/", "../../pipe-desktop/"].map((b) => b + p).find(existsSync)

test("el endpoint acepta los tres cajones y nada más", () => {
  const i = SRV.indexOf('path === "/api/mail"')
  assert.ok(i > 0, "falta /api/mail")
  const fn = SRV.slice(i, i + 2200)
  assert.match(fn, /\["prioritarios", "todos", "spam"\]\.includes/, "la pestaña tiene que venir de una lista blanca")
  assert.match(fn, /counts/, "hay que devolver los conteos: si no, las pestañas no pueden mostrar cuántos hay")
})

test("el cajón spam se DEVUELVE (es el punto de la sección)", () => {
  const i = SRV.indexOf('path === "/api/mail"')
  const fn = SRV.slice(i, i + 2200)
  assert.match(fn, /spam: mails\.filter\(\(t\) => t\.bucket === "spam"\)/,
    "sin devolver el spam, el falso positivo sigue siendo invisible y no se puede corregir")
})

test("un hilo de mensajería no entra en la sección de Correo", () => {
  const i = SRV.indexOf('path === "/api/mail"')
  const fn = SRV.slice(i, i + 2200)
  assert.match(fn, /lastChannel === "email"/,
    "un contacto con WhatsApp Y correo trae ambos canales: si no se exige que el ÚLTIMO sea correo, se cuelan sus fotos de WhatsApp")
})

test("prioritarios excluye spam", () => {
  const i = SRV.indexOf("const prioritario =")
  assert.ok(i > 0)
  const fn = SRV.slice(i, i + 260)
  assert.match(fn, /t\.bucket !== "spam"/, "algo apartado como spam no puede salir en Prioritarios")
})

test("la consulta filtra por correo en la DB, no en memoria", () => {
  const REPO = readFileSync("src/lib/threads-repo.mjs", "utf8")
  assert.match(REPO, /soloEmail/, "falta la opción")
  assert.match(REPO, /channels LIKE '%email%'/, "hay que filtrar en el índice, no traer miles de hilos para descartarlos")
})

test("el cache de la bandeja distingue la vista de correo", () => {
  const INBOX = readFileSync("src/lib/brain/inbox.mjs", "utf8")
  const i = INBOX.indexOf("_ltCache.data")
  const linea = INBOX.slice(i, i + 220)
  assert.match(linea, /_ltCache\.soloEmail === soloEmail/,
    "sin soloEmail en la clave, la sección de Correo y la bandeja general se pisan el resultado cacheado")
})

for (const [rot, get] of [["web", () => WEB]]) {
  test(`${rot}: tres pestañas y las dos acciones`, () => {
    const s = get()
    assert.match(s, /prioritarios.*todos.*spam/s, "faltan los tres cajones")
    assert.match(s, /\/api\/spam\/unmark/, "falta 'No es spam'")
    assert.match(s, /\/api\/contact\/spam/, "falta 'Es spam'")
    assert.match(s, /viewCorreo/, "falta la vista")
  })
}

test("web: la sección tiene entrada propia en la navegación", () => {
  assert.match(WEB, /item\("correo", SVG\.mail, "Correo", "#correo"\)/, "sin entrada en la barra no se llega")
  assert.match(WEB, /SVG = \{[\s\S]{0,400}mail:/, "hace falta el ícono de sobre (no existía)")
  assert.match(WEB, /base === "correo"/, "falta la ruta")
  assert.match(CSS, /\.mail-row/, "faltan los estilos")
})

test("escritorio: panel propio, tres pestañas y las dos acciones", (t) => {
  const p = rutaDesk("src/Correo.tsx")
  if (!p) return t.skip("el repo del escritorio no está acá")
  const C = readFileSync(p, "utf8")
  assert.match(C, /\["prioritarios", "Prioritarios"\]/)
  assert.match(C, /mailNoSpam/), assert.match(C, /mailEsSpam/)
  const APP = readFileSync(rutaDesk("src/App.tsx"), "utf8")
  assert.match(APP, /pane === "correo" \? <Correo/, "el panel tiene que estar enganchado")
  assert.match(APP, /data-tip="Correo"/, "falta el botón en el rail")
})

test("móvil: pantalla propia, tres pestañas y las dos acciones", (t) => {
  const p = rutaApp("src/screens/Correo.js")
  if (!p) return t.skip("el repo móvil no está acá")
  const C = readFileSync(p, "utf8")
  assert.match(C, /\["prioritarios", "Prioritarios"\]/)
  assert.match(C, /mailNoSpam/), assert.match(C, /mailEsSpam/)
  // el parámetro de navegación es convKey; con `key` la fila no abre nada (error real cometido acá)
  assert.match(C, /navigate\("Conversation", \{ convKey:/, "Conversation espera convKey, no key")
  const APP = readFileSync(rutaApp("App.js"), "utf8")
  assert.match(APP, /name="Correo" component=\{Correo\}/, "falta la pestaña")
})

test("las tres apps usan el MISMO endpoint (una sola verdad)", (t) => {
  const pd = rutaDesk("src/api.ts"), pm = rutaApp("src/api.js")
  if (!pd || !pm) return t.skip("faltan los repos de las apps acá")
  const d = readFileSync(pd, "utf8")
  const m = readFileSync(pm, "utf8")
  for (const [rot, s] of [["web", WEB], ["escritorio", d], ["móvil", m]]) {
    assert.match(s, /\/api\/mail\?tab=/, `${rot} tiene que pegarle al endpoint compartido, no reimplementar el filtro`)
  }
})
