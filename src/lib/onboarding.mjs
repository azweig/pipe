// Checklist de primer arranque: conectá WhatsApp · agregá tu correo · elegí tu IA.
//
// Vivía SÓLO en el cliente web, con 4 llamadas y las reglas de "está conectado" escritas ahí. El escritorio y el móvil
// no podían mostrarlo sin reimplementarlo y quedar desincronizados, así que ahora el cálculo es uno solo. Vive acá
// —y no dentro del handler HTTP— para poder probarlo: el gateo por cuentas secretas es sutil y ya se coló un error.
//
// 🔒 REGLA CLAVE: sin el 2º PIN, este cálculo tiene que ver EXACTAMENTE lo mismo que /api/status y /api/accounts, que sí
// filtran. Aunque acá sólo salgan booleanos, el booleano ES la filtración: si /api/status dice "no hay WhatsApp" y esto
// dice "sí hay", queda claro que hay una línea oculta. Peor todavía, el checklist DESAPARECE al quedar completo, y esa
// desaparición se ve en las tres apps.
export function calcularOnboarding({ st = {}, acc = {}, llm = {}, chans = [], secretOn = false,
  esNumeroSecreto = () => false, esCuentaSecreta = () => false, numerosSecretos = [] } = {}) {
  const wa = (st && st.whatsapp) || {}
  const bridge = (wa.bridge || []).filter((n) => secretOn || !esNumeroSecreto(n))
  const baileys = (wa.baileys || []).filter((b) => secretOn || !esNumeroSecreto(b && b.num))
  // channelHealth agrega por CANAL, no por cuenta: no se puede saber si esos mensajes son de la línea secreta o de otra.
  // Esta señal sólo se usa cuando NO hay números marcados; si los hay, mandan bridge/baileys ya filtrados. (Un correo
  // secreto no tiene nada que ver acá y no la apaga.)
  const hayWaSecreto = !secretOn && (numerosSecretos || []).length > 0
  const waMsgs = hayWaSecreto ? false : chans.some((c) => c && c.channel === "whatsapp" && ((c.n30 || 0) > 0 || (c.n7 || 0) > 0))
  const waOK = bridge.length > 0 || baileys.length > 0 || waMsgs
  const mailOK = ((acc.email || []).filter((e) => secretOn || !esCuentaSecreta("email", e && e.label))).length > 0
  // IA lista = hay key de NUBE, o el usuario eligió ollama como primario a propósito. Ollama por default NO cuenta: en un
  // tenant no hay ollama corriendo y la IA no funcionaría — habría que pedirle la key igual.
  const aiOK = (llm.providers || []).some((p) => p && p.hasKey && p.id !== "ollama") || (Array.isArray(llm.chain) && llm.chain[0] === "ollama")
  const steps = [
    { id: "whatsapp", ok: waOK, icon: "📱", title: "Conectá WhatsApp", sub: "Escaneá un QR desde tu teléfono" },
    { id: "email", ok: mailOK, icon: "📧", title: "Agregá tu correo", sub: "Gmail/Outlook con contraseña de aplicación" },
    { id: "ia", ok: aiOK, icon: "🤖", title: "Elegí tu IA", sub: "Tu motor y token (o usá el nuestro)" },
  ]
  const done = steps.filter((x) => x.ok).length
  return { steps, done, total: steps.length, listo: done === steps.length }
}
