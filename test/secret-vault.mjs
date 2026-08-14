// 🔒 El vault es la fuga que esquiva a todas las demás: graphify y learn leen data/messages.jsonl CRUDO (sin pasar por la
// DB ni por sus filtros), escriben notas de Obsidian, y esas notas se sincronizan a otro servidor por rsync.
// Se prueban las dos mitades: que no se escriba MÁS (isSecretJsonl) y qué pasa con lo YA escrito (cuarentena).
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-secvault-"))
mkdirSync(join(dir, "data"))
mkdirSync(join(dir, "vault", "People"), { recursive: true })
mkdirSync(join(dir, "vault", "Daily"), { recursive: true })
process.chdir(dir)
writeFileSync(join(dir, "data", "hub-config.json"), JSON.stringify({ myNumbers: ["51999000001", "51999000002"] }))

const dbc = await import("../src/lib/db-core.mjs")
const secret = await import("../src/lib/secret.mjs")
const sv = await import("../src/lib/secret-vault.mjs")

const SJID = "whatsapp:!roomSecreta:x" // sala de la línea secreta
const NJID = "whatsapp:!roomNormal:x"

before(() => {
  dbc.resetDb(":memory:")
  dbc.seed([
    // los SALIENTES son los que atan cada sala a una línea MÍA (sender = mi id) — sin ellos no hay dueño que marcar
    { thread: "mili", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000001:x", jid: SJID, text: "desde la secreta", ts: 10 },
    { thread: "mili", channel: "whatsapp", dir: "in", name: "Mili", sender: "@whatsapp_5111:x", jid: SJID, text: "secreto", ts: 11 },
    { thread: "mili", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000002:x", jid: NJID, text: "desde la normal", ts: 12 },
    { thread: "mili", channel: "whatsapp", dir: "in", name: "Mili", sender: "@whatsapp_5111:x", jid: NJID, text: "normal", ts: 13 },
    // contacto 100% SECRETO: solo existe en la línea secreta → su hilo se oculta entero, y su nota no debe salir del disco
    { thread: "solo", channel: "whatsapp", dir: "out", name: "yo", sender: "@whatsapp_51999000001:x", jid: SJID, text: "hola", ts: 20 },
    { thread: "solo", channel: "whatsapp", dir: "in", name: "Rita Solo", sender: "@whatsapp_5122:x", jid: SJID, text: "buenas", ts: 21 },
  ])
  secret.setSecretNumber("51999000001", true)
})
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

// ── 1) que no se escriba MÁS ──
test("isSecretJsonl: detecta una línea cruda del jsonl, incluso sin campo thread", () => {
  // el jsonl NO trae `thread` (lo calcula la ingesta): sin calcularlo, el import viejo se colaba al vault y al índice
  // ÉSTE es el caso que se colaba: un import viejo de un CONTACTO secreto, sin jid y sin thread — el número solo aparece
  // en `sender`. isSecretRow tal cual da false; recién al calcular el hilo (como hace la ingesta) se ve que es secreto.
  secret.setSecretNumber("51999000377", true) // número de un contacto marcado secreto (no una línea mía)
  const importViejo = { channel: "whatsapp", dir: "in", jid: "", sender: "51999000377", name: "", text: "hola", ts: 40 }
  assert.equal(secret.isSecretRow(importViejo), false, "sin calcular el hilo no se detecta — por eso existe isSecretJsonl")
  assert.equal(secret.isSecretJsonl(importViejo), true, "calculando el hilo como la ingesta, sí")
  assert.equal(secret.isSecretJsonl({ channel: "whatsapp", jid: SJID, name: "Mili", text: "x", ts: 1 }), true, "por jid de la línea secreta")
  assert.equal(secret.isSecretJsonl({ channel: "whatsapp", jid: NJID, name: "Mili", text: "x", ts: 1 }), false, "la línea normal sí se aprende")
  assert.equal(secret.isSecretJsonl(null), false)
  secret.setSecretNumber("51999000377", false) // dejar el estado como estaba para el resto del archivo
})

// ── 2) qué pasa con lo YA escrito ──
test("cuarentena: la nota que menciona la cuenta secreta sale del vault (y no se borra)", () => {
  const nota = join(dir, "vault", "People", "Mili.md")
  const otra = join(dir, "vault", "People", "Pedro.md")
  writeFileSync(nota, "---\nchannels: [whatsapp:+51 999 000 001]\n---\n# Mili\n\n- 2026-08-01 [whatsapp] habló de algo privado\n")
  writeFileSync(otra, "---\nchannels: [whatsapp:51999000002]\n---\n# Pedro\n")
  const movidas = sv.cuarentenaVault()
  assert.deepEqual(movidas, ["People/Mili.md"], "solo la nota de la cuenta secreta")
  assert.equal(existsSync(nota), false, "ya no está en el vault (que es lo que se sincroniza afuera)")
  assert.equal(existsSync(otra), true, "la otra nota no se toca")
  // NO se borró: sigue existiendo, fuera del vault
  const guardada = join(dir, "data", "secret-vault", "People", "Mili.md")
  assert.equal(existsSync(guardada), true, "se movió, no se destruyó")
  assert.ok(readFileSync(guardada, "utf8").includes("habló de algo privado"), "con su contenido intacto")
})

test("el número se detecta escrito de cualquier forma, pero NO dentro de otro número", () => {
  for (const forma of ["+51 999 000 001", "51999000001", "whatsapp:51999000001@s.whatsapp.net", "+51-999-000-001"])
    assert.equal(sv.esNotaSecreta("x.md", `canal: ${forma}`), true, forma)
  assert.equal(sv.esNotaSecreta("x.md", "canal: 51999000002"), false, "el número normal no")
  // FALSO POSITIVO que tenía el criterio viejo (reducía el documento entero a una sopa de dígitos):
  assert.equal(sv.esNotaSecreta("x.md", "Reunion 2026-05-19 9900 0001 con presupuesto 51 y factura 999"), false,
    "una fecha + cifras sueltas NO pueden hacer desaparecer una nota")
  assert.equal(sv.esNotaSecreta("x.md", "ID de pedido 7519990000019"), false, "ni un id que contenga el número")
})

test("criterio por NOMBRE: la nota de un contacto del bridge no lleva su teléfono y hay que agarrarla igual", () => {
  // así escribe graphify las fichas de quien entra por Matrix: el canal es la SALA, nunca el número
  const nota = "---\nchannels: []\naliases: []\n---\n# Rita Solo\n\n- 2026-08-02 [whatsapp] contó algo\n"
  assert.equal(sv.esNotaSecreta("vault/People/Rita Solo.md", nota), true, "por el título de la nota, sin ningún número adentro")
  assert.equal(sv.esNotaSecreta("vault/People/Pedro.md", "---\nchannels: []\n---\n# Pedro\n"), false, "un contacto normal no")
})

test("desmarcar la cuenta devuelve las notas a su lugar", () => {
  secret.setSecretNumber("51999000001", false)
  const vueltas = sv.restaurarVault()
  assert.deepEqual(vueltas, ["People/Mili.md"])
  assert.equal(existsSync(join(dir, "vault", "People", "Mili.md")), true, "la nota volvió sola")
  assert.equal(sv.estadoCuarentena().notas, 0, "la cuarentena queda vacía")
  secret.setSecretNumber("51999000001", true) // restaurar el estado para el resto
})

test("purgarRagDeNotas: los vectores de la nota en cuarentena salen del índice semántico", () => {
  const rag = join(dir, "data", "rag.jsonl")
  writeFileSync(rag, [
    JSON.stringify({ id: "note:People/Mili#0", kind: "note", ref: "People/Mili", text: "algo privado", vec: [0.1] }),
    JSON.stringify({ id: "note:People/Mili#1", kind: "note", ref: "People/Mili", text: "más privado", vec: [0.2] }),
    JSON.stringify({ id: "note:People/Pedro#0", kind: "note", ref: "People/Pedro", text: "público", vec: [0.3] }),
    JSON.stringify({ id: "msg:abc", kind: "msg", ref: "whatsapp/x", text: "un mensaje", vec: [0.4] }),
  ].join("\n") + "\n")
  const quitadas = sv.purgarRagDeNotas(["People/Mili.md"])
  assert.equal(quitadas, 2, "las dos líneas de esa nota")
  const quedan = readFileSync(rag, "utf8").trim().split("\n").map((l) => JSON.parse(l).id)
  assert.deepEqual(quedan, ["note:People/Pedro#0", "msg:abc"], "lo demás intacto")
})

test("sin cuentas secretas marcadas no se mueve nada (no molesta a quien no usa la función)", () => {
  secret.setSecretNumber("51999000001", false)
  assert.deepEqual(sv.cuarentenaVault(), [])
  secret.setSecretNumber("51999000001", true)
})

test("mover NO pisa: si mientras tanto se escribió una nota nueva con el mismo nombre, se guardan las dos", () => {
  const nota = join(dir, "vault", "People", "Mili.md")
  writeFileSync(nota, "---\nchannels: [whatsapp:51999000001]\n---\n# Mili\nVIEJA\n")
  assert.deepEqual(sv.cuarentenaVault().filter((r) => r.startsWith("People/")), ["People/Mili.md"])
  writeFileSync(nota, "---\nchannels: [whatsapp:51999000001]\n---\n# Mili\nNUEVA\n") // graphify la reescribe
  sv.cuarentenaVault()
  const guardadas = ["Mili.md", "Mili.1.md"].map((f) => join(dir, "data", "secret-vault", "People", f))
  assert.ok(existsSync(guardadas[0]) && existsSync(guardadas[1]), "las dos versiones sobreviven")
  const textos = guardadas.map((f) => readFileSync(f, "utf8"))
  assert.ok(textos.some((t) => t.includes("VIEJA")) && textos.some((t) => t.includes("NUEVA")), "ninguna se perdió")
  rmSync(join(dir, "data", "secret-vault"), { recursive: true, force: true })
})

test("el self-model (_Brain) también se aparta: se resume solo y learn lo reescribe para siempre", () => {
  mkdirSync(join(dir, "vault", "_Brain"), { recursive: true })
  writeFileSync(join(dir, "vault", "_Brain", "self-model.md"), "# modelo\nsin ningun identificador adentro\n")
  writeFileSync(join(dir, "vault", "People", "Mili.md"), "---\nchannels: [whatsapp:51999000001]\n---\n# Mili\n")
  // solo al MARCAR la cuenta (incluirBrain), no en cada sincronización: si no, learn regenera y la cuarentena vuelve a
  // apartarlo en un bucle sin fin — el modelo nunca sobrevive y el log histórico termina partido en .1/.2/.3
  assert.ok(!sv.cuarentenaVault().includes("_Brain/self-model.md"), "en el barrido de rutina NO se toca")
  const movidas = sv.cuarentenaVault({ incluirBrain: true })
  assert.ok(movidas.includes("_Brain/self-model.md"), "al marcar la cuenta sí: se aparta una vez y se regenera limpio")
  rmSync(join(dir, "data", "secret-vault"), { recursive: true, force: true })
})

// Regresión: buscar el NOMBRE como substring del cuerpo parecía razonable y era destructivo — hacía desaparecer notas de
// proyectos y de terceros que solo tenían la mala suerte de contener esas letras.
test("el nombre NO se busca como substring del cuerpo (borraba notas ajenas)", () => {
  const objs = { nums: [], mails: [], nombres: new Set(["rita", "solo", "mario"]), claves: [] }
  assert.equal(sv.esNotaSecreta("vault/Projects/Gravity.md", "# Gravity\nLa propuesta fue escrita por el equipo\n", objs), false, "'escrita' contiene 'rita'")
  assert.equal(sv.esNotaSecreta("vault/People/Pedro.md", "# Pedro\nTrabajamos solo con proveedores locales\n", objs), false, "'solo' como adverbio")
  assert.equal(sv.esNotaSecreta("vault/Topics/Colegio.md", "# Colegio\nEs el nivel primario\n", objs), false, "'primario' contiene 'mario'")
  // lo que SÍ cuenta: el título de la nota, y el nombre en el frontmatter (ahí lo escribió graphify, no es prosa)
  assert.equal(sv.esNotaSecreta("vault/People/Rita.md", "# Rita\n", objs), true, "el título")
  assert.equal(sv.esNotaSecreta("vault/People/X.md", "---\naliases: [Rita]\n---\n# X\n", objs), true, "el frontmatter")
})

test("un GRUPO de la línea secreta no convierte a sus participantes en cuentas secretas", () => {
  const h = dbc.handle()
  h.prepare("INSERT INTO messages (id,thread,channel,dir,name,sender,jid,text,ts) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("g1", "whatsapp:grupo@g.us", "whatsapp", "in", "Carla Reyes", "@whatsapp_5133:x", SJID, "hola", 50)
  secret.setSecretAccount("email", "nada", false) // invalida el cache del gate (15s) para que vea la fila recién insertada
  const objs = sv.objetivosSecretos()
  assert.ok(objs.claves.includes("whatsapp:grupo@g.us"), "el grupo SÍ se oculta entero (por eso el caso importa)")
  assert.ok(!objs.nombres.has("carla reyes"), "…pero sus participantes no son cuentas secretas: hablás con ellos por la otra línea")
  h.prepare("DELETE FROM messages WHERE id='g1'").run()
})
