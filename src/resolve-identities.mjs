// Resuelve identidades en la DB periódicamente: número→nombre (histórico + bridge 1:1) + reglas manuales.
// Corre en el daemon. Distingue 1:1 de grupo por conteo de remitentes (algo que computeThread no puede saber por mensaje).
import { existsSync, readFileSync } from "fs"
import { rekeyContacts, rekeyBridge, rekeyManual, rekeyEmails, unifyByNumber } from "./lib/db.mjs"

const contacts = existsSync("./data/contacts-map.json") ? JSON.parse(readFileSync("./data/contacts-map.json", "utf8")) : {}
const manual = existsSync("./data/identity-manual.json") ? JSON.parse(readFileSync("./data/identity-manual.json", "utf8")) : {}

const c = rekeyContacts(contacts)   // histórico WhatsApp 1:1 por número
const b = rekeyBridge(contacts)     // bridge 1:1 por número del sender
const e = rekeyEmails(manual)       // emails por dirección (no grafo)
const u = unifyByNumber(contacts)   // fusiona TODO hilo 1:1 con el mismo número real (incluye LID→número)
const m = rekeyManual(manual)       // reglas manuales del usuario ("es la misma persona")
console.log(`[resolve] contactos:${c} bridge:${b} emails:${e} unify:${JSON.stringify(u)} manual:${m}`)
