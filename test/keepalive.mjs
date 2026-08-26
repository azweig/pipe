// 502 ESPORÁDICOS — aparecían en cualquier endpoint, sin rastro en el server y con el proceso vivo hace 17 horas.
// No era un error del código: Node cierra las conexiones inactivas a los 5s (su default) y Caddy las reutiliza
// hasta 2 min. Cuando Caddy manda un pedido por una conexión que Node acaba de cerrar → 502, y el pedido ni
// siquiera llega a la app (por eso no había nada que loguear).
// La regla: el de arriba tiene que aguantar MÁS que el de abajo.
// Runner: node --test test/keepalive.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const SRV = readFileSync("src/server.mjs", "utf8")
const num = (re) => { const m = SRV.match(re); assert.ok(m, `no encontré ${re}`); return Number(m[1]) }

test("keepAliveTimeout supera los 2 min de idle que usa Caddy por defecto", () => {
  const ms = num(/server\.keepAliveTimeout = Number\(process\.env\.KEEPALIVE_MS \|\| (\d+)\)/)
  assert.ok(ms > 120000, `keepAliveTimeout=${ms}ms no alcanza: Caddy reutiliza conexiones hasta 120000ms`)
})

test("headersTimeout queda por encima de keepAliveTimeout (si no, corta pedidos legítimos)", () => {
  assert.match(SRV, /server\.headersTimeout = server\.keepAliveTimeout \+ \d+/)
})

test("se configura ANTES de escuchar (después no tiene efecto sobre las conexiones ya aceptadas)", () => {
  const iKa = SRV.indexOf("server.keepAliveTimeout =")
  const iListen = SRV.indexOf("server.listen(")
  assert.ok(iKa > 0 && iListen > iKa, "keepAliveTimeout tiene que ir antes de server.listen")
})
