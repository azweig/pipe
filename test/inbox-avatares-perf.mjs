// ABRIR LA BANDEJA COSTABA ~1,9 s EN FRÍO, y el 97% se iba en una sola función.
//
// `photoFor()` corre una vez por hilo (600 hilos) y en cada llamada hacía `avatarMap()`, que leía y parseaba
// `auth/avatars.json` DESDE EL DISCO: 182 KB y 4.143 entradas × 600 = ~109 MB de JSON parseado para pintar una lista.
// Medido en producción: avatarMap()×600 = 1.607 ms, y todo lo demás del bucle junto = 73 ms.
//
// Lo irónico es que el patrón correcto ya vivía cuatro líneas más abajo, en el mismo archivo: `contactsMap()` cachea
// por mtime desde siempre. A `avatarMap()` nunca se lo aplicaron.
//
// Estos tests afirman el CONTRATO (memoiza, y se entera si el archivo cambia), no el texto del código.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs"
import { join } from "node:path"

async function enSandbox(fn) {
  const raiz = join(process.cwd(), "data-test-avat-" + process.pid + "-" + Math.random().toString(36).slice(2))
  const previo = process.cwd()
  mkdirSync(join(raiz, "auth"), { recursive: true })
  mkdirSync(join(raiz, "data"), { recursive: true })
  process.chdir(raiz)
  try { return await fn(raiz) } finally { process.chdir(previo); rmSync(raiz, { recursive: true, force: true }) }
}

const avatares = (n) => {
  const o = {}
  for (let i = 0; i < n; i++) o["contacto " + i] = "/cas/ab/foto" + i + ".jpg"
  return o
}

test("avatarMap memoiza: dos llamadas seguidas no vuelven a leer el disco", async () => {
  await enSandbox(async () => {
    writeFileSync(join("auth", "avatars.json"), JSON.stringify(avatares(4000)))
    const { avatarMap } = await import("../src/lib/brain/kernel/contacts.mjs?" + Math.random())
    const a = avatarMap(), b = avatarMap()
    assert.equal(a, b, "devolvió un objeto NUEVO: está re-leyendo y re-parseando el archivo en cada llamada")
  })
})

test("…pero se entera si el archivo cambió (si no, las fotos nuevas no aparecerían nunca)", async () => {
  await enSandbox(async () => {
    const f = join("auth", "avatars.json")
    writeFileSync(f, JSON.stringify({ "ana garcía": "/cas/ab/ana.jpg" }))
    const { avatarMap } = await import("../src/lib/brain/kernel/contacts.mjs?" + Math.random())
    assert.equal(avatarMap()["ana garcía"], "/cas/ab/ana.jpg")

    writeFileSync(f, JSON.stringify({ "ana garcía": "/cas/ab/ana-nueva.jpg", "luis pérez": "/cas/cd/luis.jpg" }))
    const futuro = new Date(Date.now() + 2000)
    utimesSync(f, futuro, futuro) // mtime distinto: un cache por mtime TIENE que notarlo
    assert.equal(avatarMap()["ana garcía"], "/cas/ab/ana-nueva.jpg", "se quedó con la foto vieja: el cache no se invalida")
    assert.equal(avatarMap()["luis pérez"], "/cas/cd/luis.jpg", "no ve los contactos nuevos")
  })
})

test("sin el archivo devuelve vacío, no explota", async () => {
  await enSandbox(async () => {
    const { avatarMap } = await import("../src/lib/brain/kernel/contacts.mjs?" + Math.random())
    assert.deepEqual(avatarMap(), {})
  })
})

// El número que importa: 600 llamadas es lo que hace UNA apertura de bandeja. Antes eran ~1.600 ms.
// El margen es enorme a propósito (30×) para que no sea un test que falla por el humor de la máquina.
test("600 llamadas —una apertura de bandeja— cuestan milisegundos, no segundos", async () => {
  await enSandbox(async () => {
    writeFileSync(join("auth", "avatars.json"), JSON.stringify(avatares(4000)))
    const { avatarMap } = await import("../src/lib/brain/kernel/contacts.mjs?" + Math.random())
    avatarMap() // primera lectura, la que sí cuesta
    const t0 = Date.now()
    for (let i = 0; i < 600; i++) avatarMap()
    const ms = Date.now() - t0
    assert.ok(ms < 50, `600 llamadas tardaron ${ms} ms — está releyendo el archivo (antes: ~1.600 ms)`)
  })
})
