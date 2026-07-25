// Perfil de estilo de escritura de ${ownerFirst()} — aprendido de sus mensajes ENVIADOS (dir:out). Sin entrenar: por ejemplos.
// Se cachea en data/style-profile.json y se refina solo a medida que ${ownerFirst()} manda más mensajes.
import { readFileSync, existsSync, writeFileSync, readdirSync } from "fs"
import { ownerFirst } from "./hub.mjs"
import { llm } from "./llm.mjs"
import { sentMessages } from "./db.mjs"

const PROFILE = "./data/style-profile.json"
const PROFILES = "./data/style-profiles.json" // por categoría de relación

// categoría de relación de cada persona (según el grafo). Prioridad: lo más personal manda el tono.
const CAT_RULES = [["familia", "familia"], ["amigo", "amigo"], ["socio", "socio"], ["empleado", "equipo"], ["inversor", "inversor"], ["proveedor", "proveedor"], ["prospecto", "prospecto"], ["cliente", "cliente"]]
export function personCategories() {
  const map = {}
  if (!existsSync("./vault/People")) return map
  for (const f of readdirSync("./vault/People").filter((x) => x.endsWith(".md"))) {
    const md = readFileSync(`./vault/People/${f}`, "utf8")
    const hay = ((md.match(/tags: \[(.*?)\]/)?.[1] || "") + " " + (md.match(/^role:\s*(.*)$/m)?.[1] || "")).toLowerCase()
    let cat = "otro"
    for (const [needle, c] of CAT_RULES) if (hay.includes(needle)) { cat = c; break }
    map[f.slice(0, -3)] = cat
  }
  return map
}

const chIdOf = (e) => `${e.channel}:${e.jid || e.account || ""}`.slice(0, 80)
export function categoryOf(canon) { return personCategories()[canon] || "otro" }

// perfiles de estilo POR categoría de relación (cómo le escribe ${ownerFirst()} a cada grupo)
export async function buildStyleProfiles({ force = false } = {}) {
  if (!force && existsSync(PROFILES)) return JSON.parse(readFileSync(PROFILES, "utf8"))
  const out = outboundMessages()
  const idmap = existsSync("./data/identity-map.json") ? JSON.parse(readFileSync("./data/identity-map.json", "utf8")) : {}
  const aliases = existsSync("./data/aliases.json") ? JSON.parse(readFileSync("./data/aliases.json", "utf8")) : { people: {} }
  const cats = personCategories()
  // resolver por nombre también (para destinatarios de email): nombre/alias en minúscula → canónico
  const nameToCanon = {}
  for (const canon of Object.keys(cats)) { nameToCanon[canon.toLowerCase()] = canon; for (const a of aliases.people?.[canon] || []) nameToCanon[a.toLowerCase()] = canon }
  const groups = {}
  for (const e of out) {
    const canon = idmap[chIdOf(e)] || nameToCanon[(e.name || "").toLowerCase()]
    const cat = (canon && cats[canon]) || "otro"
    ;(groups[cat] = groups[cat] || []).push(e.text)
  }
  const profiles = {}
  for (const [cat, msgs] of Object.entries(groups)) {
    if (msgs.length < 3 || cat === "otro") continue // sin muestra suficiente → usa el global
    profiles[cat] = await llm(
      `Estos son mensajes que ${ownerFirst()} le escribió a gente de la categoría "${cat}". Extraé su estilo ESPECÍFICO con ese grupo. JSON: {"tono":"...","formalidad":"formal|semiformal|informal","saludos":["..."],"despedidas":["..."],"emojis":"nada|poco|mucho","notas":"cómo trata a este grupo en particular"}\n\nMENSAJES A ${cat.toUpperCase()}:\n${msgs.slice(-35).map((m) => `- ${m.slice(0, 200)}`).join("\n")}`,
      { json: true }
    ).catch(() => null)
  }
  writeFileSync(PROFILES, JSON.stringify(profiles, null, 2))
  return profiles
}

export function outboundMessages() {
  // desde la DB (antes leía el messages.jsonl de >1GB → ERR_STRING_TOO_LONG). Los enviados son pocos → sin problema.
  try { return sentMessages().map((r) => ({ ...r, group: r.grp })) } catch { return [] }
}

export async function buildStyleProfile({ force = false } = {}) {
  if (!force && existsSync(PROFILE)) return JSON.parse(readFileSync(PROFILE, "utf8"))
  const out = outboundMessages()
  if (out.length < 3) return null
  const sample = out.slice(-70).map((e) => `[${e.channel}] ${(e.text || "").slice(0, 240)}`).join("\n")
  const prof = await llm(
    `Analizá CÓMO ESCRIBE ${ownerFirst()} en base a estos mensajes SUYOS (enviados por él). Devolvé JSON con su estilo para poder imitarlo:
{"idioma":"español rioplatense/neutro/etc","tono":"...","formalidad":"formal|semiformal|informal","saludos":["..."],"despedidas":["..."],"largo":"corto|medio|largo","emojis":"nada|poco|mucho","muletillas":["expresiones típicas que usa"],"reglas":"2-3 reglas concretas para sonar como él","por_canal":{"email":"cómo escribe mails","whatsapp":"cómo escribe por chat"}}

MENSAJES DE ${ownerFirst()}:\n${sample}`,
    { json: true }
  )
  prof._builtFrom = out.length
  writeFileSync(PROFILE, JSON.stringify(prof, null, 2))
  return prof
}

// ejemplos reales de mensajes de ${ownerFirst()} para few-shot: prioriza MISMO CONTACTO (mismo thread), luego mismo canal.
// Antes matcheaba por jid que outboundMessages() NO traía → la rama "mismo contacto" NUNCA aplicaba (los borradores no
// aprendían cómo le escribís a ESA persona). Ahora matchea por thread (la clave de conversación canónica = la persona).
export function styleExamples(thread, channel, n = 6) {
  const out = outboundMessages()
  const same = out.filter((e) => thread && (e.thread === thread || e.jid === thread)).map((e) => e.text)
  const sameChan = out.filter((e) => e.thread !== thread && e.channel === channel).map((e) => e.text)
  return [...new Set([...sameChan.slice(-n), ...same.slice(-n)])].slice(-n) // los del MISMO contacto al final = más peso en el few-shot
}
