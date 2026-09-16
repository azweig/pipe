// EL RESUMEN DE LA HOME. Los tests fijan lo que el experimento de 10 pasadas dejó claro:
// elegir QUÉ importa es determinista; el modelo sólo redacta. Si estas reglas fallan, ninguna IA lo salva.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { pendientes, tipoDe, asuntoDe } from "../src/lib/home-pendientes.mjs"
import { parsearAcciones, promptAcciones } from "../src/lib/home-acciones.mjs"

const ahora = Date.now()
const dias = (n) => ahora - n * 86400000
const msg = (o) => ({ id: "m" + Math.random().toString(36).slice(2), channel: "email", account: "buzon", jid: "j", sender: "s", grp: null, media: null, mediaType: null, filename: null, body: null, attachments: null, ...o })

test("una deuda con monto y plazo se marca PLATA aunque parezca aviso automático", () => {
  assert.equal(tipoDe("DEUDA APORTES. Pendiente de pago $130.92 hasta el 12/09/26. Regulariza"), "PLATA")
  assert.equal(tipoDe("DDJJ Ganancias 2025, vencimientos próximos"), "PLAZO")
})

test("una promo que dice 'factura' o 'plazo' NO es consecuencia", () => {
  // Esto es lo que rompía el primer intento: por decir estas palabras, Despegar e Invest Ready se trepaban
  // arriba de la correspondencia real.
  assert.equal(tipoDe("OUTLET DE VIAJES. Aprovecha el descuento"), null)
  assert.equal(tipoDe("Ampliación de plazo de postulación a la convocatoria"), null)
})

test("lo caro entra aunque nunca le hayas escrito a ese remitente", () => {
  resetDb(":memory:")
  seed([
    msg({ thread: "afp", name: "AFP Ejemplo", text: "DEUDA APORTES - EMPRESA EJEMPLO SAC", body: "Pendiente de pago $130.92 hasta el 12/09/26. Regulariza tu deuda.", ts: dias(1), dir: "in" }),
    msg({ thread: "amigo", name: "Fulano", text: "che cómo va?", ts: dias(0.5), dir: "in", channel: "whatsapp" }),
  ])
  const r = pendientes({ limite: 5 })
  const afp = r.pendientes.find((x) => x.quien === "AFP Ejemplo")
  assert.ok(afp, "la deuda no entró: es justo lo que el experimento mostró que se perdía")
  assert.equal(afp.tipo, "PLATA")
  assert.equal(r.pendientes[0].quien, "AFP Ejemplo", "lo caro va primero, no lo más reciente")
})

test("en un chat, la última palabra ajena NO es una deuda", () => {
  resetDb(":memory:")
  seed([
    msg({ thread: "chat1", channel: "whatsapp", name: "Amigo", text: "jaja tal cual", ts: dias(0.2), dir: "in" }),
    msg({ thread: "chat2", channel: "whatsapp", name: "Socio", text: "me pasás el contrato firmado?", ts: dias(0.3), dir: "in" }),
  ])
  const r = pendientes({ limite: 5 })
  const quienes = r.pendientes.map((x) => x.quien)
  assert.ok(!quienes.includes("Amigo"), "una charla que simplemente terminó no es algo pendiente")
  assert.ok(quienes.includes("Socio"), "un pedido explícito sí")
})

test("si contestaste vos, sale de pendientes y entra en cerrados CON EL NOMBRE DEL OTRO", () => {
  resetDb(":memory:")
  seed([
    msg({ thread: "t1", name: "Cliente Importante", text: "necesito el presupuesto", ts: dias(2), dir: "in" }),
    msg({ thread: "t1", name: "Yo Mismo", text: "va adjunto", ts: dias(1), dir: "out" }),
  ])
  const r = pendientes({ limite: 5 })
  assert.equal(r.pendientes.length, 0)
  assert.equal(r.cerrados[0].quien, "Cliente Importante",
    "mostraba tu propio nombre: el saliente tiene TU name, hay que tomar el del entrante")
})

test("una llamada perdida o un audio suelto no son un pendiente", () => {
  resetDb(":memory:")
  seed([msg({ thread: "c", channel: "whatsapp", name: "Alguien", text: "📞 Llamada de WhatsApp", ts: dias(0.1), dir: "in" })])
  assert.equal(pendientes({ limite: 5 }).pendientes.length, 0)
})

test("el prompt no mete nombres reales en el ejemplo (se copian como dato inventado)", () => {
  const p = promptAcciones(
    [{ tipo: "PLATA", quien: "Contacto Real SA", canal: "email", dias: 1, asunto: "Factura 123", cuerpo: "detalle" }],
    [{ quien: "Otro Contacto" }])
  const ej = p.slice(p.indexOf("Ejemplo de la forma"), p.indexOf("Acciones:"))
  assert.ok(!/Contacto Real SA/.test(ej), "un nombre real en el ejemplo reaparece inventado en la salida")
  // El canal y los días ya NO los escribe el modelo: los agrega el código desde los datos. El modelo ponía el
  // nombre del contacto donde iba el canal, y le puso "WhatsApp" a un correo.
  assert.match(p, /NO escribas el canal ni los días/, "hay que pedirle explícitamente que no los invente")
  assert.ok(p.lastIndexOf("Ya contestaste") > p.indexOf("Factura 123"),
    "la lista de contestados va AL FINAL: en el medio, el modelo la mezcla con los pendientes")
})

test("del texto del modelo se rescatan sólo las acciones numeradas, no su preámbulo", () => {
  const r = parsearAcciones(`Aquí tienes las acciones:

- 1. Pagá a Proveedora X la factura F-001
- 2. Mandale a Fulano los archivos

Ya contestaste: Ana, Luis`)
  assert.deepEqual(r.acciones, [{ num: 1, texto: "Pagá a Proveedora X la factura F-001" }, { num: 2, texto: "Mandale a Fulano los archivos" }])
  assert.equal(r.ya, "Ana, Luis")
})

// EL NÚMERO ES EL ANCLA. En producción el modelo se salteó un ítem y, como el código emparejaba por POSICIÓN, todo lo
// de abajo se corrió un lugar: 3 de 6 líneas quedaron pegadas a otra conversación —con su canal, sus días y su
// enlace— y el pendiente más caro desapareció del texto. Una línea sin número no se puede ubicar: se descarta.
test("una línea sin número se descarta en vez de pegarse al mensaje equivocado", () => {
  const r = parsearAcciones("- 1. Pagá la factura\n- Mandale los archivos a alguien\n- 3. Resolvé el tema")
  assert.deepEqual(r.acciones.map((a) => a.num), [1, 3], "la del medio no tiene ancla: fuera")
})

test("el asunto de un chat es la primera línea, no el mensaje entero", () => {
  // Un reenvío largo cuyo cuerpo menciona de pasada una palabra de deuda no puede convertirse en una obligación.
  const reenvio = "↷ Forwarded\n\nQué alegría saludarte. Te cuento que quedé libre de toda deuda y en paz."
  assert.equal(asuntoDe({ channel: "whatsapp", text: reenvio }), "Qué alegría saludarte. Te cuento que quedé libre de toda deuda y en paz.".slice(0, 140))
  assert.equal(tipoDe(asuntoDe({ channel: "whatsapp", text: "Hola!\n\nme debes plata de la factura 123" })), null,
    "la primera línea es un saludo: lo de abajo no lo convierte en deuda")
  // En correo se mantiene el formato "Asunto — cuerpo", que sí trae un asunto de verdad.
  assert.equal(asuntoDe({ channel: "email", text: "DEUDA APORTES — te escribimos para..." }), "DEUDA APORTES")
})

test("dos personas de la misma casa por el mismo expediente son UN pendiente", () => {
  resetDb(":memory:")
  const abogado = (jid, quien, ts) => msg({ thread: "email:" + jid, jid, name: quien, ts, dir: "in",
    text: "Re: EXPEDIENTE 55 | INTIMACIÓN DE PAGO — se adjunta mandamiento", body: "Regulariza la deuda antes del 30/09." })
  seed([
    abogado("ana@estudio-ficticio.com", "Ana Ficticia", dias(3)),
    abogado("luis@estudio-ficticio.com", "Luis Ficticio", dias(2)),
    msg({ thread: "email:otro@empresa-ficticia.com", jid: "otro@empresa-ficticia.com", name: "Otra Empresa", ts: dias(1), dir: "in",
      text: "DEUDA APORTES — regulariza", body: "Pendiente de pago $500 hasta el 30/09." }),
  ])
  const r = pendientes({ limite: 6 })
  const delEstudio = r.pendientes.filter((x) => /estudio-ficticio/.test(x.thread))
  assert.equal(delEstudio.length, 1, "el estudio ocupaba DOS de los seis lugares por el mismo expediente")
  assert.equal(delEstudio[0].tambien, 1, "hay que poder decir que además escribió otra persona de la misma casa")
  assert.ok(r.pendientes.some((x) => /empresa-ficticia/.test(x.thread)), "otro remitente con otro asunto NO se agrupa")
})

// UN RESUMEN QUE MIENTE UN NÚMERO ES PEOR QUE NO TENER RESUMEN. En la primera corrida real el modelo escribió
// "US$27448.18" sobre un correo que no menciona esa cifra — justo el tipo de falla que motivó todo este trabajo.
test("una cifra que no está en el correo invalida la línea", async () => {
  const { cifrasInventadas } = await import("../src/lib/home-acciones.mjs")
  assert.equal(cifrasInventadas("Pagá la factura por US$27448.18", "DDJJ Ganancias 2025, multa de $220.000"), "27448.18")
  assert.equal(cifrasInventadas("Pagá la multa de $220.000", "DDJJ Ganancias 2025, multa de $220.000"), null)
  assert.equal(cifrasInventadas("Resolvé el tema del 2026", "vencimiento en 2026"), null, "un año no es un monto")
  assert.equal(cifrasInventadas("Pagá $130.92", "Pendiente de pago $130.92 hasta el 12/09"), null)
})

// El modelo copia la etiqueta de tipo desde las filas del prompt y la deja adentro de la acción. Se vio en producción:
// "Responder al correo de [PLATA] facturacion@proveedor.example con los datos proporcionados". El ícono ya lo dice.
test("la etiqueta [PLATA] del prompt no puede terminar en el texto de la acción", async () => {
  const { limpiarLinea } = await import("../src/lib/home-acciones.mjs")
  assert.equal(limpiarLinea("Responder al correo de [PLATA] facturacion@proveedor.example con los datos (correo, 4 días)"),
    "Responder al correo de facturacion@proveedor.example con los datos")
  assert.equal(limpiarLinea("[PLAZO] Presentá la DDJJ"), "Presentá la DDJJ")
  assert.equal(limpiarLinea("Pagá a Acme (ref. F-001) la factura (correo, hoy)"), "Pagá a Acme (ref. F-001) la factura",
    "sólo se saca el paréntesis FINAL, que es el que agregamos nosotros")
})

// El modelo chico, ante la duda, COMENTA en vez de actuar. Al darle permiso de saltearse un ítem lo usó para opinar:
// escribió "Ignorar, no hay acción específica para este mensaje" en 5 de 6 líneas — sobre deudas que las reglas ya
// habían decidido que importaban. Una tarjeta que te dice que no hagas nada sobre una intimación es peor que sosa.
test("el modelo no puede decir 'ignorar' sobre algo que las reglas ya eligieron", async () => {
  const { esMetaComentario } = await import("../src/lib/home-acciones.mjs")
  for (const s of ["Ignorar, no hay acción específica para este mensaje.", "Sin acción", "No requiere acción",
                   "Ninguna acción necesaria", "N/A", "omitir este mensaje"])
    assert.equal(esMetaComentario(s), true, "debería descartarse: " + s)
  for (const s of ["Pagá la factura F-001", "Respondé a Fulano sobre el contrato", "No te olvides de firmar el acta"])
    assert.equal(esMetaComentario(s), false, "es una acción de verdad: " + s)
})

// EL NÚMERO ES UN ANCLA, NO UNA GARANTÍA. Tras poner el anclaje, el modelo numeró mal: escribió la acción de un
// mensaje con el número de otro. El ancla evitó la cascada (las demás quedaron bien) pero esas líneas seguían pegadas
// al hilo equivocado — con su canal, sus días y su enlace. Hay que verificar que la frase hable de ESE mensaje.
test("una línea que no habla del mensaje al que se ancló se descarta", async () => {
  const { correspondeAlItem } = await import("../src/lib/home-acciones.mjs")
  const factura = { quien: "facturacion@proveedor.example", asunto: "Factura Electrónica F002-7698 aceptada" }
  assert.equal(correspondeAlItem("Pagá la factura F002-7698 al proveedor", factura), true)
  assert.equal(correspondeAlItem("Respondé a Contadores Ficticios sobre la declaración jurada de ganancias", factura), false,
    "habla de otro asunto: pegarla acá mandaría al usuario a la conversación equivocada")
  // Acentos y mayúsculas no pueden decidir esto.
  assert.equal(correspondeAlItem("revisá la FACTURA electronica", factura), true)
  // Las palabras cortas no alcanzan como prueba: "de", "por", "con" aparecen en cualquier frase.
  assert.equal(correspondeAlItem("Hacelo ya por el de la otra vez", { quien: "Ana", asunto: "por el de la vez" }), false)
})

// ── LA PUERTA ───────────────────────────────────────────────────────────────────────────────────────────────────
// No se puede garantizar que un modelo no alucine. Lo que sí se garantiza es que nada que no se pueda verificar
// contra el mensaje de origen llegue a la pantalla. Estos tests son esa promesa escrita.
test("un nombre propio que no está en el correo invalida la línea", async () => {
  const { nombresInventados } = await import("../src/lib/home-acciones.mjs")
  const origen = "Factura F-001 de Proveedora Ejemplo por el servicio de mayo"
  assert.equal(nombresInventados("Pagá a Proveedora Ejemplo la factura F-001", origen), null)
  assert.equal(nombresInventados("Pagá a Constructora Fantasma la factura F-001", origen), "Constructora",
    "inventar una empresa se lee como un dato y manda al usuario a hablar con nadie")
  assert.equal(nombresInventados("Pagá la factura de PROVEEDORA por el servicio", origen), null, "la sigla en mayúsculas también se coteja")
  assert.equal(nombresInventados("Pagá la factura a SUNAT", origen), "SUNAT", "una sigla que no está en el origen tampoco pasa")
  // Un mes o un arranque de oración no son entidades inventadas.
  assert.equal(nombresInventados("Pagá antes de Diciembre la factura F-001", origen), null)
  // FALSO POSITIVO REAL: el correo traía la razón social en mayúsculas y el modelo la escribió en CamelCase. La regex partía el
  // CamelCase en "Quick", un token que no existe en ninguna parte, y tiraba abajo una línea correcta. Lo que se prueba
  // es que la entidad EXISTA en el correo, no que se escriba igual.
  const conSigla = "Re: EMPRESAFICTICIA | MANDAMIENTO INTIMACIÓN DE PAGO"
  assert.equal(nombresInventados("Contestá sobre el mandamiento de EmpresaFicticia S.A.S.", conSigla), null)
  assert.equal(nombresInventados("Contestá sobre el mandamiento de OtraCosa S.A.S.", conSigla), "OtraCosa",
    "la tolerancia no puede llegar a dejar pasar una entidad que no está")
})

test("una acción no puede estar dirigida a vos mismo", async () => {
  const { dirigidaAlDueno } = await import("../src/lib/home-acciones.mjs")
  // Caso real: el nombre del dueño venía en el ASUNTO del correo del contador y el modelo lo tomó como destinatario.
  assert.equal(dirigidaAlDueno("Consultá con Juan Pérez sobre la declaración", "Pérez Juan Carlos"), false)
  assert.equal(dirigidaAlDueno("Consultá con Juan Carlos Pérez sobre la declaración", "Juan Carlos Pérez"), true)
  assert.equal(dirigidaAlDueno("Pagá la factura", "Juan Carlos Pérez"), false)
  assert.equal(dirigidaAlDueno("Escribile a Ana", "Ana"), false, "un nombre de una sola palabra da falsos positivos")
})

test("la puerta devuelve el MOTIVO, no sólo un sí o un no", async () => {
  const { motivoRechazo, nombresInventados } = await import("../src/lib/home-acciones.mjs")
  const item = { quien: "Proveedora Ejemplo", asunto: "Factura F-001 vencida", cuerpo: "Saldo de $1.500 al 30/09." }
  assert.equal(motivoRechazo("Pagá a Proveedora Ejemplo la factura F-001 por $1.500", item, "Juan Carlos Pérez"), null)
  assert.match(motivoRechazo("Ignorar, no hay acción para este mensaje", item, ""), /meta-comentario/)
  assert.match(motivoRechazo("Respondé sobre el alquiler del depósito", item, ""), /no habla de este mensaje/)
  assert.match(motivoRechazo("Pagá a Proveedora Ejemplo la factura por $98.765", item, ""), /cifra inventada/)
  assert.match(motivoRechazo("Pagá a Proveedora Ejemplo y a Transportes Fantasma la F-001", item, ""), /nombre inventado/)
  // Fiel al caso real: el nombre del dueño VIENE en el asunto del correo del contador, así que no es "inventado" —
  // está en el origen. Por eso hace falta esta comprobación aparte: sin ella la línea pasaría limpia.
  const delContador = { quien: "Contadores Ficticios", asunto: "DDJJ 2025 - Juan Carlos Pérez", cuerpo: "Adjuntamos el borrador." }
  assert.equal(nombresInventados("Consultá con Juan Carlos Pérez la DDJJ 2025", `${delContador.quien} ${delContador.asunto} ${delContador.cuerpo}`), null,
    "el nombre SÍ está en el correo: la guarda de nombres no lo ve")
  assert.match(motivoRechazo("Consultá con Juan Carlos Pérez la DDJJ 2025", delContador, "Juan Carlos Pérez"), /vos mismo/)
  // El motivo se cuenta para poder MEDIR si el modelo empeora, en vez de enterarse por una captura de pantalla.
})
