// 🔒 E2E de superficies DERIVADAS: prueba que radar/home/notas/calendar/search/espacios NO exponen mensajes de fuente secreta.
// Modelo por-canal: se marca un NÚMERO tuyo (owner) secreto → sus salas/jids y sus notas self se ocultan; un contacto con
// línea secreta + línea normal SIGUE visible mostrando SOLO lo no-secreto. Corre en cwd temporal + DB :memory: (no toca prod).
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-secsurf-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
// config: dos números MÍOS; el primero se marcará secreto. NADA hardcodeado en la lib: sale de acá.
writeFileSync(join(dir, "data", "hub-config.json"), JSON.stringify({ myNumbers: ["51999000001", "51999000002"] }))

const dbc = await import("../src/lib/db-core.mjs")
const secret = await import("../src/lib/secret.mjs")
const tr = await import("../src/lib/threads-repo.mjs")
const esp = await import("../src/lib/espacios-repo.mjs")

const SJID = "whatsapp:!roomSecreta:x"   // sala de la línea SECRETA (owner 51999000001)
const NJID = "whatsapp:!roomNormal:x"    // sala de la línea NORMAL  (owner 51999000002)

before(() => {
  dbc.resetDb(":memory:")
  dbc.seed([
    // — contacto PARCIAL "Mili": misma persona en dos salas (una secreta, una normal) —
    { thread: "mili", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000001:x", jid: SJID, text: "hola desde la secreta", ts: 10 },
    { thread: "mili", channel: "whatsapp", dir: "in", name: "Mili", sender: "@whatsapp_5111:x", jid: SJID, text: "MENSAJE_SECRETO_MILI", ts: 11 },
    { thread: "mili", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000002:x", jid: NJID, text: "hola desde la normal", ts: 12 },
    { thread: "mili", channel: "whatsapp", dir: "in", name: "Mili", sender: "@whatsapp_5111:x", jid: NJID, text: "MENSAJE_NORMAL_MILI", ts: 13 },
    // — contacto 100% SECRETO "Solo" (solo en la línea secreta) —
    { thread: "solo", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000001:x", jid: SJID, text: "hola solo", ts: 20 },
    { thread: "solo", channel: "whatsapp", dir: "in", name: "Solo", sender: "@whatsapp_5122:x", jid: SJID, text: "MENSAJE_DE_SOLO", ts: 21 },
    // — notas propias (thread='self'): una por la línea secreta, una normal —
    { thread: "self", channel: "whatsapp", dir: "out", name: "yo", jid: SJID, text: "NOTA_SECRETA_XYZ", ts: 30 },
    { thread: "self", channel: "whatsapp", dir: "out", name: "yo", jid: NJID, text: "NOTA_NORMAL_XYZ", ts: 31 },
    // — llamada perdida por la línea secreta —
    { thread: "solo", channel: "whatsapp", dir: "in", name: "Solo", jid: SJID, mediaType: "call", text: "Llamada perdida", ts: 22 },
    // — import VIEJO: DM 1:1 cuya CLAVE es el número secreto, con jid="" (el número solo vive en la clave) —
    { thread: "whatsapp:51999000001@s.whatsapp.net", channel: "whatsapp", dir: "out", name: "yo", jid: "", sender: "me", text: "IMPORT_VIEJO_SECRETO", ts: 40 },
  ])
  secret.setSecretNumber("51999000001", true) // marca la línea 1 como cuenta secreta
})
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

test("isSecretMsg: mensaje de la sala secreta sí, de la normal no", () => {
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: SJID, thread: "mili" }), true)
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: NJID, thread: "mili" }), false)
})

test("secretGate: 'solo' se oculta entero (100% secreto); 'mili' NO (parcial, sigue visible)", () => {
  const g = secret.secretGate()
  assert.equal(g.hide.has("solo"), true, "solo debe estar en hide")
  assert.equal(g.hide.has("mili"), false, "mili es parcial → NO se oculta entero")
})

test("selfNotesSince (Notas/digest): excluye la nota de la línea secreta", () => {
  const notes = tr.selfNotesSince(0, { limit: 50 }).map((n) => n.text)
  assert.ok(notes.includes("NOTA_NORMAL_XYZ"), "la nota normal debe estar")
  assert.ok(!notes.includes("NOTA_SECRETA_XYZ"), "la nota SECRETA NO debe aparecer")
})

test("recentCalls (Home/radar): no muestra la llamada de la línea secreta (hilo 100%-secreto)", () => {
  const calls = tr.recentCalls(0, { limit: 30 })
  assert.equal(calls.length, 0, "la llamada de 'solo' (secreto) no debe listarse")
})

test("espacioMessages (Espacios): un espacio por nombre 'Mili' muestra SOLO lo no-secreto", () => {
  const r = esp.espacioMessages([{ type: "name", value: "Mili" }], { limit: 50 })
  const texts = r.recent.map((m) => m.text)
  assert.ok(texts.includes("MENSAJE_NORMAL_MILI"), "el mensaje normal debe estar")
  assert.ok(!texts.includes("MENSAJE_SECRETO_MILI"), "el mensaje SECRETO NO debe aparecer")
})

test("import viejo con jid='': DM cuya clave es el número secreto queda oculto entero", () => {
  const k = "whatsapp:51999000001@s.whatsapp.net"
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: "", thread: k }), true, "isSecretMsg por clave DM")
  assert.equal(secret.secretThreadKeys().has(k), true, "debe estar en hide (100% secreto)")
  // un DM 1:1 con un número NO secreto NO se oculta
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: "", thread: "whatsapp:51999000002@s.whatsapp.net" }), false)
  // un GRUPO cuyo id contiene el número secreto NO se oculta por esto
  assert.equal(secret.isSecretMsg({ channel: "whatsapp", jid: "", thread: "whatsapp:51999000001-123@g.us" }), false, "grupo no se oculta")
})

test("desmarcar la cuenta secreta restaura la visibilidad en las superficies derivadas", () => {
  secret.setSecretNumber("51999000001", false)
  const notes = tr.selfNotesSince(0, { limit: 50 }).map((n) => n.text)
  assert.ok(notes.includes("NOTA_SECRETA_XYZ"), "sin marca secreta, la nota vuelve a verse")
  const calls = tr.recentCalls(0, { limit: 30 })
  assert.equal(calls.length, 1, "sin marca secreta, la llamada vuelve")
  secret.setSecretNumber("51999000001", true) // restaurar estado por si otro test corre después
})

// 🔒 EL BUSCADOR DE LA BANDEJA: buscar por nombre no puede ser una puerta trasera a un hilo 100% secreto.
// (regresión: la búsqueda server-side se agregó para llegar a contactos fuera de la ventana de recientes;
//  si no respetara el gate, escribir el nombre revelaría que esa conversación existe).
test("searchThreadKeys encuentra el hilo secreto, pero el gate lo tapa antes de salir", () => {
  const keys = tr.searchThreadKeys("solo", { limit: 20 })
  assert.ok(keys.includes("solo"), "el índice sí lo encuentra (por eso el gate es imprescindible)")
  const hide = secret.secretThreadKeys()
  assert.equal(hide.has("solo"), true, "un hilo 100% secreto NO puede salir en resultados de búsqueda")
  // el parcial sí puede aparecer: se muestra filtrado por-mensaje, no oculto
  assert.equal(hide.has("mili"), false)
})

test("searchThreadKeys: sin query o con 1 letra no devuelve nada (no barre la base entera)", () => {
  assert.deepEqual(tr.searchThreadKeys("", { limit: 20 }), [])
  assert.deepEqual(tr.searchThreadKeys("a", { limit: 20 }), [])
})

test("searchThreadKeys: tolera sintaxis de FTS5 sin explotar", () => {
  for (const q of ['"', 'a OR b', 'x NEAR(y)', "mili*", "((("]) {
    assert.ok(Array.isArray(tr.searchThreadKeys(q, { limit: 5 })), `no debe tirar con: ${q}`)
  }
})

// ── LECTORES POR-ID ── La bandeja y el visor filtran POR HILO, pero pedir un id suelto los saltea: con el id en la mano
// se leía el cuerpo del correo, se reenviaba el mensaje o se mandaba a transcribir. El id no es adivinable, pero aparece
// en exports, backups y capturas viejas — no es un secreto. Sin 2º PIN, esa fila no existe.
const idDe = (texto) => dbc.handle().prepare("SELECT id FROM messages WHERE text=?").get(texto)?.id

test("messageById: niega la fila secreta y devuelve la normal", () => {
  const secreto = idDe("MENSAJE_SECRETO_MILI"), normal = idDe("MENSAJE_NORMAL_MILI")
  assert.ok(secreto && normal, "el seed tiene que traer ids")
  assert.equal(tr.messageById(secreto), undefined, "sin 2º PIN no se entrega")
  assert.equal(tr.messageById(normal)?.text, "MENSAJE_NORMAL_MILI", "el normal sí")
  assert.equal(tr.messageById(secreto, { secretOn: true })?.text, "MENSAJE_SECRETO_MILI", "con 2º PIN sí")
})

test("getBody (visor de correo): el cuerpo de una fila secreta no sale por id", () => {
  const id = idDe("MENSAJE_SECRETO_MILI")
  dbc.handle().prepare("UPDATE messages SET body=? WHERE id=?").run("<p>CUERPO_SECRETO</p>", id)
  assert.equal(tr.getBody(id), null, "sin 2º PIN, sin cuerpo")
  assert.equal(tr.getBody(id, { secretOn: true }), "<p>CUERPO_SECRETO</p>", "con 2º PIN sí")
})

test("forwardMessages: no reenvía un mensaje secreto sin 2º PIN", async () => {
  const { forwardMessages } = await import("../src/lib/brain/reply.mjs")
  const r = await forwardMessages([idDe("MENSAJE_SECRETO_MILI")], "mili")
  // el error EXACTO importa: prueba que se negó al LEERLO, no que falló al mandarlo (eso pasaría igual sin el candado)
  assert.equal(r?.error, "No encontré los mensajes a reenviar.", "tiene que negarse antes de intentar mandarlo")
})

test("summarizeMedia: no transcribe/describe un adjunto de fuente secreta sin 2º PIN", async () => {
  const { summarizeMedia } = await import("../src/lib/brain/media-ai.mjs")
  const r = await summarizeMedia(idDe("MENSAJE_SECRETO_MILI"))
  assert.equal(r?.error, "mensaje no encontrado")
})

test("allForRag (corpus del índice semántico): no entrega mensajes de canal secreto", async () => {
  const sr = await import("../src/lib/search-repo.mjs")
  const textos = sr.allForRag({ since: 0 }).map((r) => r.text)
  assert.ok(textos.includes("MENSAJE_NORMAL_MILI"), "lo normal sí entra al índice")
  for (const t of ["MENSAJE_SECRETO_MILI", "MENSAJE_DE_SOLO", "NOTA_SECRETA_XYZ", "IMPORT_VIEJO_SECRETO"])
    assert.ok(!textos.includes(t), `${t} NO puede vectorizarse`)
})

// ── ÍNDICE SEMÁNTICO (RAG) ── El agujero más grande: rag.jsonl no guardaba el hilo, así que el filtro de ask() (`it.thread
// && …`) era falso SIEMPRE y los mensajes de canales secretos entraban al contexto que ve la IA. Se resuelve por id.
test("ragItemVisible: la línea vieja del índice (sin hilo) se resuelve por id y la secreta queda fuera", async () => {
  const { ragItemVisible } = await import("../src/lib/brain/ask.mjs")
  const visible = ragItemVisible({ secretKeys: secret.secretThreadKeys(), isSecret: secret.isSecretMsg })
  const idSec = idDe("MENSAJE_SECRETO_MILI"), idNor = idDe("MENSAJE_NORMAL_MILI")
  // líneas VIEJAS (sin thread): antes pasaban las dos
  assert.equal(visible({ id: "msg:" + idSec, kind: "msg", text: "x" }), false, "la secreta NO entra al contexto")
  assert.equal(visible({ id: "msg:" + idNor, kind: "msg", text: "x" }), true, "la normal sí")
  // línea NUEVA (con thread) del hilo 100%-secreto
  assert.equal(visible({ id: "msg:z", kind: "msg", thread: "solo", text: "x" }), false)
  // notas del vault y items sociales no son mensajes de canal: no se descartan
  assert.equal(visible({ id: "note:People/Ana#0", kind: "note", text: "x" }), true)
  // id que ya no existe en la DB → se descarta (fallar cerrado)
  assert.equal(visible({ id: "msg:no-existe-999", kind: "msg", text: "x" }), false)
})

// ── CONTADORES Y AGREGADOS ── Que un contador suba de más, o que el contacto salga en un "top", ya delata que la
// conversación existe. El review semanal (coach) los exponía con nombre y todo.
test("coach semanal: los contadores y el top de contactos no incluyen lo secreto", () => {
  const tops = tr.topThreadsSince(0, { limit: 20 }).map((t) => t.thread)
  assert.ok(!tops.includes("solo"), "el hilo 100%-secreto no puede salir en el top")
  assert.ok(!tops.includes("whatsapp:51999000001@s.whatsapp.net"), "el import viejo tampoco")
  const antes = tr.sentCountSince(0) + tr.recvCountSince(0)
  secret.setSecretNumber("51999000001", false)
  const conTodo = tr.sentCountSince(0) + tr.recvCountSince(0)
  secret.setSecretNumber("51999000001", true)
  assert.ok(conTodo > antes, "al desmarcarla el conteo tiene que SUBIR: si no, es que nunca se estaba restando")
})

test("estilo/few-shot: los salientes de la línea secreta no se usan como ejemplo para escribirle a otro", () => {
  const textos = tr.sentMessages().map((m) => m.text)
  assert.ok(textos.includes("hola desde la normal"), "los salientes normales sí")
  assert.ok(!textos.includes("hola desde la secreta"), "el saliente de la línea secreta NO puede ir al LLM")
  assert.ok(!textos.includes("hola solo"))
})

test("ficha de contacto: pedirla por NOMBRE no revela la clave del hilo ni el teléfono", async () => {
  const { personCard } = await import("../src/lib/brain/people.mjs")
  const card = await personCard("Solo")
  assert.ok(!card?.contacts, "no puede devolver teléfonos/correos de un contacto secreto")
  assert.ok(!card?.key || !secret.secretThreadKeys().has(card.key), "ni la clave del hilo")
  // y tiene que ser INDISTINGUIBLE de un nombre que no existe: un "secret:true" sería un oráculo por sí mismo
  const inventado = await personCard("Zzz Noexiste")
  assert.deepEqual(Object.keys(card).sort(), Object.keys(inventado).sort(), "misma forma que un nombre inventado")
  assert.equal(card.canon, null, "sin canon: si lo devolviera, ya confirma que la persona existe")
  assert.equal(card.secret, undefined, "y sin bandera que lo delate")
})

test("archivos del CAS: se niegan por RUTA si el mensaje que los trae es secreto", () => {
  const h = dbc.handle()
  h.prepare("UPDATE messages SET media=? WHERE text=?").run("/cas/aa11.jpg", "MENSAJE_SECRETO_MILI")
  h.prepare("UPDATE messages SET media=? WHERE text=?").run("/cas/bb22.jpg", "MENSAJE_NORMAL_MILI")
  assert.equal(tr.casSecreto("/cas/aa11.jpg"), true, "la foto del canal secreto no se entrega")
  assert.equal(tr.casSecreto("/cas/bb22.jpg"), false, "la normal sí")
  assert.equal(tr.casSecreto("/cas/aa11.jpg", { secretOn: true }), false, "con 2º PIN sí")
})
