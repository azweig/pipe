// UN MOTOR OCUPADO NO ES UN MOTOR MUERTO.
//
// El vigilante de embeddings hacía un ping con 40s de paciencia y, a los 3 fallos seguidos, reiniciaba ollama.
// Pero ollama atiende de a UNO: mientras un cron largo ocupaba el motor (~200s por lote), el ping se encolaba y
// vencía. O sea que 15 minutos de trabajo NORMAL disparaban el reinicio, matando el trabajo en curso — que al
// no poder terminar reempezaba de cero, y volvía a pasar lo mismo. Un ciclo infinito que se veía como "ollama
// se cae solo": 41 lotes seguidos muertos con ECONNREFUSED.
//
// Es el mismo error que el de los lectores "vivos pero sordos", al revés: medir latencia y llamarlo liveness.
//
// Runner: node --test test/watchdog-ocupado.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const WD = readFileSync("src/embed-watchdog.mjs", "utf8")

test("antes de reiniciar, comprueba que esté vivo con algo que NO infiera", () => {
  assert.match(WD, /\/api\/tags/, "hace falta una llamada barata que conteste aunque el motor esté generando")
  const i = WD.indexOf("async function vivo")
  assert.ok(i > 0, "falta la comprobación de vida, separada del ping de embeddings")
  const fn = WD.slice(i, WD.indexOf("\nasync function ping", i))
  assert.ok(!/embeddings|api\/generate/.test(fn), "la comprobación de vida no puede depender de una inferencia: es justo lo que se encola")
})

test("si el embed vence pero el motor responde, NO reinicia", () => {
  const i = WD.indexOf("const ok = await ping()")
  const decision = WD.slice(i)
  const iBusy = decision.indexOf("await vivo()")
  const iRestart = decision.indexOf('spawnSync("systemctl"')
  assert.ok(iBusy > 0 && iRestart > 0, "faltan la rama de ocupado o la de reinicio")
  assert.ok(iBusy < iRestart, "la comprobación de vida tiene que ir ANTES de decidir el reinicio")
  const rama = decision.slice(iBusy - 200, iRestart)
  assert.ok(/no lo toco|ocupado/i.test(rama), "la rama de 'ocupado' tiene que existir y no reiniciar")
})

test("el contador de fallos se limpia cuando estaba ocupado", () => {
  const i = WD.indexOf("await vivo()")
  const rama = WD.slice(i, i + 400)
  assert.match(rama, /save\(\{\s*fails:\s*0/, "si estaba ocupado, los fallos previos no deben acumularse hacia un reinicio")
})

test("sigue reiniciando cuando de verdad está muerto", () => {
  assert.match(WD, /spawnSync\("systemctl", \["restart", "ollama"\]/, "el reinicio real tiene que seguir existiendo")
  assert.match(WD, /FAIL_LIMIT/, "y seguir exigiendo varios fallos seguidos, no uno suelto")
})
