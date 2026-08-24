// LA REGLA DE IDENTIDAD SE ESCRIBE UNA SOLA VEZ.
//
// Historia (24-ago): "¿puedo keyear este hilo por el nombre de agenda, o serían dos personas?" estaba escrita DOS
// veces — en la ingesta (thread.mjs) y en el re-key (identity-repo.mjs). El 18-ago arreglé una sola. El bug siguió
// vivo por la otra y los contactos aparecían DUPLICADOS en la bandeja: la historia en un hilo y el mensaje nuevo
// solo en otro. Nadie lo notó porque las dos "parecían" bien por separado.
//
// Este test no revisa comportamiento: revisa que la regla NO vuelva a tener dos implementaciones.
// Runner: node --test test/identity-rule-once.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const archivos = []
const recorrer = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) recorrer(p); else if (e.name.endsWith(".mjs")) archivos.push(p) } }
recorrer("src")

test("el conteo de identidades colisionantes existe UNA sola vez", () => {
  // la firma de la regla: recorrer la agenda contando cuántas identidades distintas comparten el nombre
  const conLaRegla = archivos.filter((f) => {
    const s = readFileSync(f, "utf8")
    return /ids\.add\(phoneOf\(k\)\s*\|\|\s*k\)/.test(s)
  })
  assert.deepEqual(conLaRegla, ["src/lib/thread.mjs"],
    `la regla de identidad se duplicó. Debe vivir SOLO en thread.mjs (canonNameFor) y el resto delegar. Copias: ${conLaRegla.join(", ")}`)
})

test("el guard VIEJO (contar claves de agenda) no volvió a aparecer", () => {
  // `for (const v of Object.values(cm)) if (v === nm && ++c > 1)` — contaba CLAVES, no identidades: por eso un
  // contacto listado por teléfono y por LID parecía dos personas.
  const malos = archivos.filter((f) => /if\s*\(v === nm && \+\+c > 1\)/.test(readFileSync(f, "utf8")))
  assert.deepEqual(malos, [], `volvió el guard que cuenta claves en vez de identidades: ${malos.join(", ")}`)
})

test("los dos caminos (ingesta y re-key) usan la MISMA función", async () => {
  const { canonNameFor } = await import("../src/lib/thread.mjs")
  const { safeName } = await import("../src/lib/db.mjs")
  const cm = { "51900000009": "Ana García", "117000000000009": "Ana García" } // teléfono + LID del MISMO contacto
  // sin lid-map en este cwd el LID no resuelve → los dos caminos tienen que coincidir, sea cual sea el veredicto
  assert.equal(safeName(cm, "51900000009", {}, null), canonNameFor(cm, "51900000009"),
    "si difieren, volvimos a tener dos reglas")
})
