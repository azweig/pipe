// EL RESUMEN DE LA HOME. Los tests fijan lo que el experimento de 10 pasadas dejó claro:
// elegir QUÉ importa es determinista; el modelo sólo redacta. Si estas reglas fallan, ninguna IA lo salva.
import "./_setup.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { resetDb, seed } from "../src/lib/db-core.mjs"
import { pendientes, tipoDe } from "../src/lib/home-pendientes.mjs"
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

test("del texto del modelo se rescatan sólo las acciones, no su preámbulo", () => {
  const r = parsearAcciones(`Aquí tienes las acciones:

- Pagá a Proveedora X la factura F-001 (correo, 2 días)
- Mandale a Fulano los archivos (WhatsApp, hoy)

Ya contestaste: Ana, Luis`)
  assert.deepEqual(r.acciones, ["Pagá a Proveedora X la factura F-001 (correo, 2 días)", "Mandale a Fulano los archivos (WhatsApp, hoy)"])
  assert.equal(r.ya, "Ana, Luis")
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
