// EL RESUMEN DECÍA LO CONTRARIO DEL CORREO.
//
// Caso real de la bandeja: el corredor de seguros escribió "¡Qué bueno Renata! Era una preocupación que tuvo buen
// final" — 605 caracteres. Debajo colgaban 9.133 caracteres del hilo anterior. El resumidor tomaba los primeros
// 4.000 y le pasaba al modelo 3.395 de historial viejo, así que resumió el historial: "Rechazo por falta de informe
// médico". El caso se había resuelto BIEN y Pipe avisaba lo opuesto.
//
// Medido sobre la bandeja: de los correos que citan, en el 100% el historial ocupa más que el mensaje. Son el 6% del
// total pero son EXACTAMENTE la correspondencia real — los boletines no citan nada.
import { test } from "node:test"
import assert from "node:assert/strict"
import { soloLoNuevo, proporcionCitada, esReenvio } from "../src/lib/email-quote.mjs"

test("una respuesta corta con hilo largo debajo → se queda con la respuesta", () => {
  const cuerpo = `Qué bueno Renata!!!!!! Era una preocupación que tuvo buen final. Un abrazo para ti y para tu familia!!!

EDGAR E. ZÁRATE SÁENZ
CORREDOR DE SEGUROS

________________________________
De: Nombre Apellido <yo@ejemplo.com>
Enviado: martes, 9 de septiembre
Asunto: Re: Rechazo

Nos rechazaron por falta de informe médico, seguimos esperando el Reporte Siniestral y la carta de garantía.`
  const nuevo = soloLoNuevo(cuerpo)
  assert.match(nuevo, /tuvo buen final/, "perdió el mensaje real")
  assert.ok(!/Rechazo por falta|Reporte Siniestral/.test(nuevo),
    "se coló el historial: es lo que hacía que el resumen dijera lo contrario")
})

test("los distintos formatos de cita se reconocen", () => {
  const casos = {
    "Outlook (guiones bajos)": "Listo, confirmado.\n\n________________________________\nDe: Fulano\nesto es viejo",
    "Gmail español": "Gracias, lo reviso hoy y te aviso sin falta.\n\nEl lun, 7 sept 2026 a las 15:46, Renata <r@ejemplo.com> escribió:\nesto es viejo",
    "Gmail inglés": "Sounds good, I will send it over tomorrow morning.\n\nOn Mon, Sep 7, 2026 at 3:46 PM John <j@ejemplo.com> wrote:\nesto es viejo",
    "reenviado": "Te reenvío lo que mandaron del colegio.\n\n---------- Forwarded message ---------\nesto es viejo",
    "citado con >": "Confirmo la reunión para el jueves a las diez.\n\n> esto es viejo\n> y esto también",
    "Original Message": "Ya está pagado, adjunto el comprobante.\n\n-----Original Message-----\nesto es viejo",
  }
  for (const [etiqueta, cuerpo] of Object.entries(casos)) {
    const n = soloLoNuevo(cuerpo)
    assert.ok(!/esto es viejo/.test(n), `no cortó el formato: ${etiqueta} → ${JSON.stringify(n.slice(0, 70))}`)
    assert.ok(n.length > 15, `cortó de más en ${etiqueta}`)
  }
})

test("si lo nuevo es un 'ok' suelto, mejor devolver todo que resumir dos palabras", () => {
  const cuerpo = "ok\n\nEl lun 7 sept, Fulano escribió:\nAcá va el detalle largo de la propuesta con los montos y las fechas que importan."
  const n = soloLoNuevo(cuerpo)
  assert.match(n, /detalle largo/, "con un mensaje de 2 letras no hay nada que resumir: conviene el contexto")
})

test("un correo SIN cita queda intacto (los boletines son el 94%)", () => {
  const cuerpo = "Te recordamos que aún no recibimos la documentación para las DDJJ 2025. La multa asciende a $220.000 por obligación."
  assert.equal(soloLoNuevo(cuerpo), cuerpo)
  assert.equal(proporcionCitada(cuerpo), 0)
})

test("un 'De:' en medio de una frase NO corta el correo", () => {
  const cuerpo = "Hola, te escribo De: parte del equipo de finanzas para pedirte los movimientos bancarios pendientes de identificar."
  assert.equal(soloLoNuevo(cuerpo), cuerpo, "cortó por un 'De:' que no era un encabezado citado")
})

test("proporcionCitada mide cuánto del cuerpo es historial", () => {
  const cuerpo = "Confirmado, nos vemos el jueves.\n\n________________________________\n" + "historial viejo ".repeat(40)
  const p = proporcionCitada(cuerpo)
  assert.ok(p > 0.7, `debería detectar que la mayoría es historial, dio ${p.toFixed(2)}`)
})

// UN REENVÍO NO ES UNA RESPUESTA. Detectado al comparar contra la bandeja real: recortar un "Fwd:" convertía
// "Monto pendiente de amortización: $71.390 para septiembre" en "Te comparto la información que nos envió la contadora".
// En un Re: lo de abajo es ruido; en un Fwd: lo de abajo ES el mensaje.
test("un reenvío conserva lo reenviado: ahí está el contenido", () => {
  const cuerpo = `Hola Renata, te comparto lo que nos envió la contadora. Saludos,

---------- Forwarded message ---------
Monto pendiente de amortización: $71.390 para septiembre. Adjunto estado de cuentas.`
  const n = soloLoNuevo(cuerpo, { asunto: "Fwd: Deuda San Borja/Quickcomm" })
  assert.match(n, /71\.390/, "se comió el contenido reenviado, que es lo único que importaba")
})

test("…pero la misma cadena en un Re: sí se recorta", () => {
  const cuerpo = `Listo, ya lo revisé y está todo correcto.

---------- Forwarded message ---------
Monto pendiente de amortización: $71.390`
  const n = soloLoNuevo(cuerpo, { asunto: "Re: Deuda San Borja/Quickcomm" })
  assert.ok(!/71\.390/.test(n), "en una respuesta, lo de abajo es historial")
})

test("reconoce las variantes de reenvío", () => {
  for (const a of ["Fwd: algo", "FW: algo", "RV: algo", "Reenv: algo"])
    assert.equal(esReenvio(a), true, "no reconoció: " + a)
  for (const a of ["Re: algo", "algo", "Fwd", "RE: Fwd de ayer"])
    assert.equal(esReenvio(a), false, "reconoció de más: " + a)
})
