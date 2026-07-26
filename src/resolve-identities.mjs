// Resuelve identidades en la DB periódicamente: número→nombre (histórico + bridge 1:1) + reglas manuales.
// Corre en el daemon. Distingue 1:1 de grupo por conteo de remitentes (algo que computeThread no puede saber por mensaje).
import { existsSync, readFileSync } from "fs"
import { rekeyContacts, rekeyBridge, rekeyManual, rekeyEmails, unifyByNumber, pruneOrphanConversations } from "./lib/db.mjs"

const contacts = existsSync("./data/contacts-map.json") ? JSON.parse(readFileSync("./data/contacts-map.json", "utf8")) : {}
const manual = existsSync("./data/identity-manual.json") ? JSON.parse(readFileSync("./data/identity-manual.json", "utf8")) : {}

// el mapa MANUAL (verdad del usuario) se pasa a los re-keys por número → consolidan al NOMBRE elegido, no al número.
// Sin esto unifyByNumber usaba solo la agenda y peleaba con computeThread → la misma persona rebotaba entre dos hilos.
const c = rekeyContacts(contacts, manual)   // histórico WhatsApp 1:1 por número → nombre (agenda o manual)
const b = rekeyBridge(contacts, manual)     // bridge 1:1 por número del sender → nombre (agenda o manual)
const e = rekeyEmails(manual)               // emails por dirección (no grafo)
const u = unifyByNumber(contacts, manual)   // fusiona TODO hilo 1:1 con el mismo número real (incluye LID→número)
const m = rekeyManual(manual)               // reglas manuales del usuario ("es la misma persona")
const p = pruneOrphanConversations()        // borra conversaciones fantasma (thread ya sin mensajes tras el re-key)
console.log(`[resolve] contactos:${c} bridge:${b} emails:${e} unify:${JSON.stringify(u)} manual:${m} poda:${JSON.stringify(p)}`)
