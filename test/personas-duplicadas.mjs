// DOS FICHAS DE LA MISMA PERSONA SE DETECTAN POR IDENTIFICADOR, NUNCA POR NOMBRE.
//
// Por nombre ya hay un test entero en este proyecto explicando por qué no: dos personas se llaman igual y fusionarlas
// mezcla conversaciones ajenas. Un teléfono o un correo, en cambio, es de una sola persona.
//
// Lo caro de acá fue el falso positivo: un LID de WhatsApp (el identificador de privacidad) es una cadena de 13 a 15
// dígitos que parece un teléfono. Contarlo como tal inventaba tres personas duplicadas que no existían.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { gruposDuplicados, identificadores } from "../scripts/personas-duplicadas.mjs"

const wa = (jid) => ({ channel: "whatsapp", jid, sender: "", thread: "x" })

test("un LID NO es un teléfono", () => {
  assert.deepEqual([...identificadores(wa("77490286493915@lid"))], [])
  assert.deepEqual([...identificadores(wa("51900000001@s.whatsapp.net"))], ["tel:51900000001"])
})

test("una sala del puente identifica una conversación, no a una persona", () => {
  assert.deepEqual([...identificadores(wa("!sala:dominio.local"))], [])
})

test("dos hilos con el mismo teléfono son la misma persona", () => {
  const g = gruposDuplicados([
    { ...wa("51900000002@s.whatsapp.net"), thread: "Nombre Real", n: 900 },
    { ...wa("51900000002@s.whatsapp.net"), thread: "51900000002", n: 4 },
  ])
  assert.equal(g.length, 1)
  assert.equal(g[0].principal, "Nombre Real", "manda el hilo con más mensajes: es la ficha que el usuario reconoce")
  assert.deepEqual(g[0].sueltos.map((s) => s.thread), ["51900000002"])
})

test("dos hilos con el mismo correo son la misma persona", () => {
  const g = gruposDuplicados([
    { channel: "email", sender: "Ana <ana@ejemplo.com>", jid: "", thread: "Ana", n: 10 },
    { channel: "email", sender: "ANA@EJEMPLO.COM", jid: "", thread: "ana@ejemplo.com", n: 2 },
  ])
  assert.deepEqual(g.map((x) => x.id), ["mail:ana@ejemplo.com"])
})

test("dos personas distintas no se fusionan aunque compartan nombre", () => {
  assert.deepEqual(gruposDuplicados([
    { ...wa("51900000003@s.whatsapp.net"), thread: "Pablo", n: 5 },
    { ...wa("51900000004@s.whatsapp.net"), thread: "Pablo ", n: 5 },
  ]), [])
})

// El caso que se escapaba: los mensajes salientes de una ficha suelta no llevan el número en el jid, sólo en la
// clave del hilo. Sin esto, un contacto con dos fichas —una con nombre y otra con el número pelado— no se detecta.
test("un hilo cuya CLAVE es un teléfono cuenta como ese teléfono", () => {
  assert.deepEqual([...identificadores({ channel: "whatsapp", jid: "", sender: "",
    thread: "whatsapp:51900000005@s.whatsapp.net" })], ["tel:51900000005"])
  const g = gruposDuplicados([
    { ...wa("51900000005@s.whatsapp.net"), thread: "Renata", n: 900 },
    { channel: "whatsapp", jid: "", sender: "", thread: "whatsapp:51900000005@s.whatsapp.net", n: 4 },
  ])
  assert.equal(g.length, 1)
  assert.equal(g[0].principal, "Renata")
})

test("la clave de un GRUPO nunca se lee como teléfono", () => {
  // Un grupo se llama <número del creador>-<timestamp>@g.us: leerlo como persona fusiona el grupo con su creador.
  assert.deepEqual([...identificadores({ channel: "whatsapp", jid: "", sender: "",
    thread: "whatsapp:51900000006-1613864780@g.us" })], [])
  assert.deepEqual([...identificadores({ channel: "whatsapp", jid: "", sender: "",
    thread: "whatsapp:120363024887454918@g.us" })], [])
})
