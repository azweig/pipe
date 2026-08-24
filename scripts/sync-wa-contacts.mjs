#!/usr/bin/env node
// Sincroniza la AGENDA de WhatsApp (la que el bridge mautrix ya baja de tu cuenta) hacia data/contacts-map.json.
// Es la fuente más completa de nombres: el export del teléfono envejece, esto se mantiene solo.
//
// NO PISA lo que ya tenés: si un número ya está en contacts-map.json, gana lo tuyo (puede ser una corrección manual).
// Solo RELLENA los que faltan. Con --dry no escribe nada, solo muestra qué agregaría.
//
// Uso:  node scripts/sync-wa-contacts.mjs [--dry] [ruta-al-mautrix-whatsapp.db]
import Database from "better-sqlite3"
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs"

const args = process.argv.slice(2)
const dry = args.includes("--dry")
// MAUTRIX_WA_DB es el nombre que usa el resto del código (matrix.mjs, heartbeat, selftest). Se acepta WA_BRIDGE_DB
// como alias porque backup.sh lo usaba así. Una sola variable, documentada en .env.example — nada de rutas fijas.
const BRIDGE = args.find((a) => !a.startsWith("--")) || process.env.MAUTRIX_WA_DB || process.env.WA_BRIDGE_DB || "/opt/matrix/bridges/whatsapp/mautrix-whatsapp.db"
const MAP = "./data/contacts-map.json"

if (!existsSync(BRIDGE)) { console.error(`❌ no encuentro la DB del bridge en ${BRIDGE}`); process.exit(1) }

const actual = existsSync(MAP) ? JSON.parse(readFileSync(MAP, "utf8")) : {}
const B = new Database(BRIDGE, { readonly: true })
// full_name/first_name = como TE lo guardaste vos; push_name = como se llama la persona; business_name = cuentas de empresa.
const rows = B.prepare("SELECT their_jid, full_name, first_name, push_name, business_name FROM whatsmeow_contacts").all()

const nuevos = {}
let yaEstaba = 0, sinNombre = 0
for (const r of rows) {
  const num = String(r.their_jid || "").split("@")[0].replace(/\D/g, "")
  const nm = String(r.full_name || r.first_name || r.push_name || r.business_name || "").trim()
  if (!num || num.length < 8) continue
  if (!nm || /^[\d\s+()\-.]+$/.test(nm)) { sinNombre++; continue } // un "nombre" que es el propio número no sirve
  if (actual[num] !== undefined) { yaEstaba++; continue }           // lo tuyo manda
  if (nuevos[num] === undefined) nuevos[num] = nm
}

const n = Object.keys(nuevos).length
console.log(`agenda del bridge: ${rows.length} filas · ya en tu mapa: ${yaEstaba} · sin nombre útil: ${sinNombre}`)
console.log(`${dry ? "AGREGARÍA" : "agrego"}: ${n} contactos nuevos (tu mapa pasa de ${Object.keys(actual).length} a ${Object.keys(actual).length + n})`)
for (const [k, v] of Object.entries(nuevos).slice(0, 10)) console.log(`   ${k.padEnd(16)} ${v}`)
if (n > 10) console.log(`   … y ${n - 10} más`)

if (dry) { console.log("\n(ensayo en seco: no escribí nada)"); process.exit(0) }
if (!n) { console.log("nada que agregar"); process.exit(0) }
if (existsSync(MAP)) copyFileSync(MAP, MAP + ".bak") // respaldo antes de tocar la agenda
writeFileSync(MAP, JSON.stringify({ ...actual, ...nuevos }, null, 2))
console.log(`✓ escrito ${MAP} (respaldo en ${MAP}.bak). Corré 'node src/resolve-identities.mjs' para aplicarlo a los hilos.`)
