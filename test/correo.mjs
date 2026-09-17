// REDACTAR CORREO. Esto le manda mensajes a OTRAS personas desde la dirección del usuario: un error acá no se ve en
// una pantalla, se ve en la bandeja de un tercero y no se puede deshacer. Por eso cada regla está fijada.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseDirecciones, asuntoLimpio, asuntoRespuesta, asuntoReenvio, destinatariosRespuesta,
  citaHtml, reenvioHtml, htmlATexto, limpiarHtml, armarCuerpo } from "../src/lib/correo.mjs"

test("se acepta lo que la gente PEGA, no lo que sería ideal que escribiera", () => {
  assert.deepEqual(parseDirecciones('Ana Ficticia <ana@ejemplo.com>, luis@ejemplo.com'), ["ana@ejemplo.com", "luis@ejemplo.com"])
  assert.deepEqual(parseDirecciones("a@x.com; b@x.com\nc@x.com"), ["a@x.com", "b@x.com", "c@x.com"], "punto y coma y saltos de línea también")
  assert.deepEqual(parseDirecciones("email:a@x.com"), ["a@x.com"], "las claves internas llevan prefijo; la dirección no")
  assert.deepEqual(parseDirecciones("no-es-un-mail, otro@sin-tld"), [], "lo inválido se descarta en vez de intentar mandarlo")
})

test("el asunto no acumula prefijos", () => {
  assert.equal(asuntoLimpio("Re: RE: Fwd: Propuesta"), "Propuesta")
  assert.equal(asuntoRespuesta("Re: Re: Propuesta"), "Re: Propuesta", "así es como nacen los 'Re: Re: Re:'")
  assert.equal(asuntoReenvio("RV: Propuesta"), "Fwd: Propuesta")
  assert.equal(asuntoRespuesta(""), "Re: (sin asunto)")
  assert.equal(asuntoLimpio("RE[2]: Propuesta"), "Propuesta", "Outlook numera los suyos")
})

// RESPONDER A TODOS ES DONDE SE HACE EL DAÑO: si tus propias direcciones quedan en la copia, te llega tu propia
// respuesta y cada respuesta ajena te vuelve a duplicar en el hilo.
test("responder a todos nunca te incluye a vos mismo", () => {
  const correo = { from: "ana@ejemplo.com", fromName: "Ana", to: "yo@mihub.com, luis@ejemplo.com", cc: "eva@ejemplo.com, yo@mihub.com" }
  const mias = ["yo@mihub.com"]
  assert.deepEqual(destinatariosRespuesta(correo, mias, false), { to: ["ana@ejemplo.com"], cc: [] })
  const todos = destinatariosRespuesta(correo, mias, true)
  assert.deepEqual(todos.to, ["ana@ejemplo.com"])
  assert.deepEqual(todos.cc, ["luis@ejemplo.com", "eva@ejemplo.com"], "sin vos, y sin repetir a quien ya está en Para")
})

test("responder a un correo TUYO le escribe al destinatario, no a vos", () => {
  // Pasa constantemente: el último mensaje del hilo lo escribiste vos y querés agregar algo.
  const mio = { from: "yo@mihub.com", to: "cliente@ejemplo.com", cc: "" }
  assert.deepEqual(destinatariosRespuesta(mio, ["yo@mihub.com"], false), { to: ["cliente@ejemplo.com"], cc: [] })
})

test("la cita va en blockquote y el reenvío no", () => {
  const c = { from: "ana@ejemplo.com", fromName: "Ana", subject: "Hola", ts: Date.parse("2026-09-16T15:00:00Z"), html: "<p>texto original</p>", to: "yo@mihub.com" }
  const cita = citaHtml(c, "UTC")
  assert.match(cita, /blockquote/, "sin blockquote, Gmail no lo colapsa y se ve un muro de texto")
  assert.match(cita, /escribió:/)
  const fwd = reenvioHtml(c, "UTC")
  assert.ok(!/blockquote/.test(fwd), "en un reenvío el contenido ES el mensaje, no una cita")
  assert.match(fwd, /Mensaje reenviado/)
  assert.match(fwd, /<b>Para:<\/b>/, "hay que ver a quién iba el original")
})

test("siempre sale una parte de texto plano", () => {
  // Sin text/plain, un cliente en modo texto ve un correo VACÍO y varios filtros lo puntúan como spam.
  const r = armarCuerpo({ html: "<p>Hola<br>Qué tal</p>", cuenta: "*", conFirma: false })
  assert.match(r.text, /Hola/)
  assert.match(r.text, /Qué tal/)
  assert.equal(htmlATexto("<ul><li>uno</li><li>dos</li></ul>"), "• uno\n• dos")
})

test("la firma va ARRIBA de la cita, no al final del historial", () => {
  const r = armarCuerpo({ html: "<p>mi respuesta</p>", cuenta: "*", cita: "<blockquote>lo viejo</blockquote>" })
  const iFirma = r.html.indexOf("--"), iCita = r.html.indexOf("blockquote")
  assert.ok(iFirma > 0 && iFirma < iCita, "debajo del historial citado no la lee nadie")
})

// EL EDITOR ES contentEditable: pegar desde Word o desde una web trae de todo. Esto sale del hub hacia afuera.
test("del HTML pegado no puede salir nada ejecutable", () => {
  assert.equal(limpiarHtml('<script>robar()</script><p>hola</p>'), "<p>hola</p>")
  assert.equal(limpiarHtml('<p onclick="robar()">hola</p>'), "<p>hola</p>", "los manejadores de eventos se van")
  assert.equal(limpiarHtml('<a href="javascript:robar()">click</a>'), "<a>click</a>")
  assert.equal(limpiarHtml('<iframe src="http://malo"></iframe>texto'), "texto")
  assert.match(limpiarHtml('<a href="https://ejemplo.com">ok</a>'), /href="https:\/\/ejemplo.com"/, "un link normal sobrevive")
  assert.match(limpiarHtml('<b style="color:red;position:fixed">x</b>'), /style="color:red"/, "se filtra la propiedad, no el estilo entero")
  assert.ok(!/position/.test(limpiarHtml('<b style="position:fixed">x</b>')), "posicionar no es dar formato")
})

test("el formato que SÍ se usa al escribir sobrevive", () => {
  const h = '<p>Hola <b>Ana</b>, te paso la <i>lista</i>:</p><ul><li>uno</li></ul><blockquote>citado</blockquote>'
  assert.equal(limpiarHtml(h), h, "negrita, cursiva, listas y citas son lo que se usa en un correo de verdad")
})

test("los adjuntos tienen tope y se avisa ANTES de mandar", async () => {
  const { normalizarAdjuntos } = await import("../src/lib/brain/correo.mjs")
  const chico = normalizarAdjuntos([{ nombre: "a.pdf", mime: "application/pdf", b64: Buffer.from("hola").toString("base64") }])
  assert.equal(chico.items.length, 1)
  assert.equal(chico.items[0].content.toString(), "hola")
  // Un adjunto grande no falla acá: falla en el SMTP del otro lado, minutos después, y el usuario lo vive como
  // "mandé el correo y no llegó". Por eso se corta antes de enviar, con un mensaje que explique.
  const grande = normalizarAdjuntos([{ nombre: "g.bin", b64: Buffer.alloc(21 * 1048576).toString("base64") }])
  assert.match(grande.error || "", /pasan de 20 MB/)
  // El prefijo data: que manda el navegador se saca solo.
  const conPrefijo = normalizarAdjuntos([{ nombre: "b.txt", b64: "data:text/plain;base64," + Buffer.from("ok").toString("base64") }])
  assert.equal(conPrefijo.items[0].content.toString(), "ok")
  assert.deepEqual(normalizarAdjuntos(null).items, [], "sin adjuntos no es un error")
})
