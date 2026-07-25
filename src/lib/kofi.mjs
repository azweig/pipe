// Ko-fi: avisos automáticos en el PRIMER pago de una suscripción (membership). NO auto-provisiona (el operador arma el server a mano).
// Manda 2 mails: (1) al operador → "armá el server" (KOFI_ADMIN_EMAIL); (2) al cliente en SU idioma → "servidor en preparación, máx 72h hábiles".
// Idioma: se busca el email del cliente en la waitlist del landing (KOFI_WAITLIST, jsonl {email,lang}). Default "en". Config-driven, sin hardcodear.
import { existsSync, readFileSync } from "node:fs"
import { sendEmail } from "./mailer.mjs"

function langOf(email) {
  const f = process.env.KOFI_WAITLIST
  if (!f || !email || !existsSync(f)) return "en"
  try {
    let lang = null
    for (const line of readFileSync(f, "utf8").split("\n")) { if (!line) continue; try { const r = JSON.parse(line); if (r.email && r.email.toLowerCase() === String(email).toLowerCase() && r.lang) lang = r.lang } catch {} }
    return lang || "en"
  } catch { return "en" }
}

// Plantillas al CLIENTE por idioma (asunto + cuerpo). Los locales del landing: es en pt de fr ja zh.
const hi = (n) => (n ? " " + n : "")
const CLIENT = {
  es: { subject: "pipe — Estamos preparando tu servidor", body: (n) => `¡Hola${hi(n)}!\n\nGracias por suscribirte a pipe 🎉\n\nEstamos preparando tu servidor dedicado. Estará listo en un máximo de 72 horas hábiles. Te avisaremos a este mismo correo apenas esté todo andando.\n\nGracias por confiar,\nel equipo de pipe` },
  en: { subject: "pipe — We're setting up your server", body: (n) => `Hi${hi(n)}!\n\nThanks for subscribing to pipe 🎉\n\nWe're setting up your dedicated server. It'll be ready within a maximum of 72 business hours. We'll email you here as soon as it's live.\n\nThank you,\nthe pipe team` },
  pt: { subject: "pipe — Estamos preparando o seu servidor", body: (n) => `Olá${hi(n)}!\n\nObrigado por assinar o pipe 🎉\n\nEstamos preparando o seu servidor dedicado. Ficará pronto em no máximo 72 horas úteis. Avisaremos por este mesmo e-mail assim que estiver no ar.\n\nObrigado pela confiança,\na equipe do pipe` },
  de: { subject: "pipe — Wir richten deinen Server ein", body: (n) => `Hallo${hi(n)}!\n\nDanke, dass du pipe abonniert hast 🎉\n\nWir richten deinen dedizierten Server ein. Er ist innerhalb von maximal 72 Geschäftsstunden bereit. Wir melden uns per E-Mail, sobald alles läuft.\n\nVielen Dank,\ndein pipe-Team` },
  fr: { subject: "pipe — Nous préparons votre serveur", body: (n) => `Bonjour${hi(n)} !\n\nMerci de vous être abonné à pipe 🎉\n\nNous préparons votre serveur dédié. Il sera prêt sous 72 heures ouvrées maximum. Nous vous préviendrons par e-mail dès qu'il sera en ligne.\n\nMerci de votre confiance,\nl'équipe pipe` },
  ja: { subject: "pipe — サーバーを準備しています", body: (n) => `こんにちは${hi(n)}！\n\npipe をご購読いただきありがとうございます 🎉\n\n専用サーバーを準備しています。最大72営業時間以内に準備が整います。稼働を開始次第、このメールアドレスにご連絡します。\n\nどうぞよろしくお願いいたします。\npipe チーム` },
  zh: { subject: "pipe — 我们正在准备您的服务器", body: (n) => `您好${hi(n)}！\n\n感谢您订阅 pipe 🎉\n\n我们正在为您准备专属服务器，最多将在 72 个工作小时内就绪。一切准备就绪后，我们会立即通过此邮箱通知您。\n\n感谢您的信任，\npipe 团队` },
}

export async function notifyNewSubscription({ email, name, tier, amount } = {}) {
  const out = {}
  const lang = langOf(email)
  const admin = (process.env.KOFI_ADMIN_EMAIL || "").trim()
  // 1) al operador: nueva suscripción → armá el server
  if (admin) {
    const detail = `Nueva suscripción de pipe 🎉\n\nCliente: ${name || "(sin nombre)"} <${email || "?"}>\nTier: ${tier || "(sin tier)"}\nMonto: ${amount || "?"}\nIdioma del cliente: ${lang}\n\n→ Provisioná su tenant (consola) y avisale cuando esté listo. El cliente ya recibió el aviso de "preparando, máx 72h hábiles" en ${lang}.`
    out.admin = await sendEmail({ to: admin, subject: `🟢 Nueva suscripción pipe: ${email || name || "?"}${tier ? " (" + tier + ")" : ""}`, text: detail })
  }
  // 2) al cliente en su idioma: servidor en preparación
  if (email) {
    const tpl = CLIENT[lang] || CLIENT.en
    out.client = await sendEmail({ to: email, subject: tpl.subject, text: tpl.body(name) })
  }
  return out
}
