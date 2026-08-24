// CONTACTO DUPLICADO EN LA BANDEJA: llega un mensaje y la persona aparece DOS VECES — el hilo viejo con toda la
// historia, y uno nuevo con ese único mensaje. A los ~20 min el re-key los une, pero mientras tanto ahí está.
//
// Causa: la agenda de WhatsApp lista a cada contacto DOS veces, por teléfono y por LID de 15 dígitos, con el MISMO
// nombre. El guard anti-homónimo de la INGESTA los contaba como dos personas distintas y se negaba a keyear por
// nombre → hilo por número. (El del re-key periódico ya estaba arreglado; esta es la segunda copia de la regla.)
// Dos entradas que resuelven al MISMO teléfono son la misma persona.
// Runner: node --test test/thread-lid-dup.mjs
import "./_setup.mjs"
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const NUM = "51900000001", LID = "117000000000001", OTRO = "51900000002"
let cwd, dir, computeThread

before(async () => {
  cwd = process.cwd(); dir = mkdtempSync(join(tmpdir(), "pipe-lid-"))
  process.chdir(dir); mkdirSync("data", { recursive: true })
  // la agenda tiene al MISMO contacto dos veces (teléfono + LID), como la baja el bridge
  writeFileSync("data/contacts-map.json", JSON.stringify({ [NUM]: "Ana García", [LID]: "Ana García", [OTRO]: "Otro Contacto" }))
  writeFileSync("data/lid-map.json", JSON.stringify({ [LID]: NUM })) // el LID resuelve a su teléfono
  ;({ computeThread } = await import("../src/lib/thread.mjs"))
})
after(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) })

test("un contacto listado por teléfono Y por LID NO es un homónimo: el hilo va por nombre", () => {
  const t = computeThread({ channel: "whatsapp", jid: `${NUM}@s.whatsapp.net`, sender: `${NUM}@s.whatsapp.net`, name: `+${NUM} (WA)`, dir: "in", text: "hola", ts: Date.now() })
  assert.equal(t, "Ana García", "si no, cada mensaje nuevo abre un hilo aparte y la persona sale duplicada")
})

test("el mensaje que llega POR el LID cae en el mismo hilo", () => {
  const t = computeThread({ channel: "whatsapp", jid: `${LID}@lid`, sender: `${LID}@lid`, name: "Ana", dir: "in", text: "hola", ts: Date.now() })
  assert.equal(t, "Ana García")
})

test("dos personas DISTINTAS con el mismo nombre siguen sin fusionarse", async () => {
  writeFileSync("data/contacts-map.json", JSON.stringify({ "51911111111": "Juan Pérez", "51922222222": "Juan Pérez" }))
  const { computeThread: ct } = await import("../src/lib/thread.mjs?v=2") // recarga: la agenda cambió
  const t = ct({ channel: "whatsapp", jid: "51911111111@s.whatsapp.net", sender: "51911111111@s.whatsapp.net", name: "Juan", dir: "in", text: "x", ts: Date.now() })
  assert.equal(t, "whatsapp:51911111111@s.whatsapp.net", "dos teléfonos reales con el mismo nombre: NO keyear por nombre")
})
