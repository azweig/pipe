// Genera el resumen de acciones de la Home y lo deja en data/home-acciones.json.
// Corre desde el daemon: la Home LEE el archivo, nunca invoca al modelo en el pedido del usuario — acá el LLM local
// llegó a tardar 233s por cola, y eso no puede estar entre el usuario y su pantalla.
import { loadEnv } from "./lib/env.mjs"
loadEnv()
import { writeFileSync, mkdirSync } from "node:fs"
import { acciones } from "./lib/home-acciones.mjs"

const r = await acciones({ limite: +process.env.HOME_ACCIONES_N || 6 })
try { mkdirSync("./data", { recursive: true }) } catch {}
writeFileSync("./data/home-acciones.json", JSON.stringify(r))
console.log(`[home-acciones] ${r.acciones.length} acciones (fuente: ${r.fuente}) · ${r.n.pend} pendientes · ${r.n.cerrados} cerrados`)
for (const a of r.acciones) console.log("  -", a)
process.exit(0)
