// CATEGORIZADOR DE NOTAS. Toma cada self-nota nueva (thread='self' — cualquier cosa que el owner se manda a sí mismo por
// cualquier canal) y con IA: la descarta como 'junk' si es ruido/sistema (ej. notificaciones de pipe) o inentendible,
// o le asigna una CATEGORÍA semántica (reusa una existente si calza, o crea una nueva) + un título. Guarda en note_meta.
// Taxonomía flexible en meta['note_categories']. Cron cada ~5 min. Uso: node src/notes-categorize.mjs
import { loadEnv } from "./lib/env.mjs"
import { uncategorizedSelfNotes, activeNotesMissingEnrichment, setNoteMeta, getMeta, setMeta } from "./lib/db.mjs"
import { llm } from "./lib/llm.mjs"
loadEnv()

const BATCH = +process.env.NOTES_CAT_BATCH || 15
const BACKFILL = process.env.NOTES_CAT_BACKFILL === "1" || process.argv.includes("--backfill") // pobla catkey/acciones/veredicto en notas ya activas, sin re-junkear

// texto legible de una nota: el texto directo, o el resumen si fue audio; media sin texto útil → vacío (la IA decide junk)
function noteText(r) {
  const s = (r.summary && r.summary.trim() && !/^\(/.test(r.summary)) ? r.summary.trim() : ""
  const t = (r.text && !/^(🎤|🖼|📹|📄|🌟|📎|📍|👤)/.test(r.text.trim())) ? r.text.trim() : ""
  return (s || t).replace(/\s+/g, " ").slice(0, 500)
}

// ruido evidente de la app/sistema (self-test, verificaciones, confirmaciones) → junk directo, sin gastar IA
const NOISE = /verás este mensaje|verifica tu (cuenta|token|correo|email)|el env[íi]o (por|de)|self.?test|prueba de env|c[óo]digo de verificaci|verification code|\bcomms.?hub\b|no.?reply|tu cuenta de email|verás este/i

async function run() {
  const rows = BACKFILL ? activeNotesMissingEnrichment({ limit: BATCH }) : uncategorizedSelfNotes({ limit: BATCH })
  if (!rows.length) { console.log(BACKFILL ? "[notes-cat] backfill completo" : "[notes-cat] nada nuevo"); return }
  let cats = []
  try { cats = JSON.parse(getMeta("note_categories") || "[]") } catch {}
  const URLONLY = /^\s*(https?:\/\/\S+)(\s+\S{0,25})?\s*$/i // nota que es (casi) solo una URL
  const linkTitle = (u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").slice(0, 60)
  let preJunk = 0, preLink = 0
  const keep = []
  const mediaCatkey = (mt) => (mt === "image" || mt === "sticker") ? "otro" : mt === "video" ? "otro" : mt === "document" || mt === "file" ? "otro" : "otro"
  for (const r of rows) {
    const txt = noteText(r)
    if (!txt || txt.length < 4 || (!BACKFILL && NOISE.test(txt))) {
      // backfill: nota media-only o ruidosa YA activa → NO la re-junkeamos; solo le damos ícono genérico
      if (BACKFILL) setNoteMeta(r.id, { catkey: mediaCatkey(r.mediaType), status: "active", ts: r.ts })
      else { setNoteMeta(r.id, { status: "junk", ts: r.ts }); preJunk++ }
      continue
    }
    const um = txt.match(URLONLY)
    if (um) { setNoteMeta(r.id, { category: "Links para leer", catkey: "link", title: linkTitle(um[1]), status: "active", ts: r.ts }); preLink++; continue } // link pelado → directo, título = la URL (sin gastar IA)
    keep.push({ id: r.id, ts: r.ts, text: txt })
  }
  if (preLink && !cats.some((c) => /links para leer/i.test(c))) cats.push("Links para leer")
  if (!keep.length) { setMeta("note_categories", JSON.stringify(cats.slice(0, 40))); console.log(`[notes-cat] ${preLink} links · ${preJunk} junk (pre-filtro), nada para IA`); return }
  const byId = Object.fromEntries(keep.map((r) => [r.id, r]))
  const items = keep.map((r, i) => ({ i, id: r.id, text: r.text.slice(0, 500) }))

  const prompt = `Sos un archivista del "segundo cerebro" del owner. Clasificá estas NOTAS (cosas que se manda a sí mismo: ideas, links, aprendizajes, recetas, pendientes, noticias, facturas, etc.).
Categorías que YA existen (reusalas si calzan): ${cats.length ? cats.join(", ") : "(ninguna todavía)"}

Para CADA nota devolvé un objeto con su índice. Reglas:
- Si es RUIDO / mensaje de la app o el sistema (verificaciones, códigos, confirmaciones de envío, "verás este mensaje", pruebas, notificaciones de "pipe", errores automáticos) o algo INENTENDIBLE / sin contenido real → "category": "junk". Ante la duda: si NO es claramente una idea, link, aprendizaje, receta o pendiente del owner, marcalo "junk".
- Si es real → "category": etiqueta clara (REUSÁ una existente si aplica; si no CREÁ una corta: "Ideas de IA", "Recetas", "Proyectos", "Aprendizajes", "Links para leer", "Salud", "Finanzas", "Personal"). Y "title" de máximo 8 palabras.
- "catkey": UNA de esta lista fija (para el ícono): salud, receta, finanzas, trabajo, idea, compras, viaje, noticia, educacion, link, personal, otro.
- "acciones": lista (máx 3) de cosas concretas y accionables que se desprenden de la nota (ej: "Comprar amoxicilina en farmacia", "Llamar a la Dra. Salinas"). Cada una: {"texto":"...", "cuando":"fecha/hora si la nota la dice (ej 14:00, el 28, mañana), si no ''"}. Si no hay acciones claras → [].
- "veredicto": SOLO si la nota afirma un HECHO comprobable de noticia/salud/ciencia/dato. Devolvé {"nivel":"hoax|dudoso|verificado","motivo":"1 frase corta"}. Sé CONSERVADOR: usá "hoax"/"dudoso" únicamente si contradice claramente el consenso científico/fuentes confiables. Para todo lo demás (ideas, recetas, pendientes, opiniones, links sin afirmación fáctica) → null.

NOTAS:
${items.map((it) => `#${it.i}: ${it.text}`).join("\n")}

Devolvé SOLO JSON: { "notas": [ { "i": 0, "category": "Salud", "catkey": "salud", "title": "...", "acciones": [{"texto":"...","cuando":""}], "veredicto": null } ] }`

  let r
  try { r = await llm(prompt, { json: true, area: "summarize", temperature: 0.2, task: "notes-categorize" }) } catch (e) { console.error("[notes-cat]", e.message); return }
  const out = r?.notas || []
  const seen = new Set(cats.map((c) => c.toLowerCase()))
  const newCats = [...cats]
  let done = 0, junk = 0
  const norm = (c) => { const hit = newCats.find((x) => x.toLowerCase() === c.toLowerCase()); return hit || c } // reusar case-insensitive
  const CATKEYS = new Set(["salud", "receta", "finanzas", "trabajo", "idea", "compras", "viaje", "noticia", "educacion", "link", "personal", "otro"])
  for (const o of out) {
    const it = items[o.i]; if (!it) continue
    let cat = String(o.category || "").trim()
    // en backfill NUNCA re-junkeamos una nota ya activa; si la IA duda, cae en "Personal"/otro
    let isJunk = !cat || /^junk$/i.test(cat)
    if (BACKFILL && isJunk) { isJunk = false; cat = "Personal"; o.catkey = o.catkey || "personal" }
    if (!isJunk) { cat = norm(cat); if (!seen.has(cat.toLowerCase()) && cat.length > 1 && cat.length < 40) { newCats.push(cat); seen.add(cat.toLowerCase()) } }
    // catkey fijo para el ícono
    const catkey = isJunk ? null : (CATKEYS.has(String(o.catkey || "").toLowerCase()) ? String(o.catkey).toLowerCase() : "otro")
    // acciones detectadas → [{texto,cuando,done:false}] (máx 3, solo concretas)
    const acciones = isJunk ? null : (Array.isArray(o.acciones) ? o.acciones.map((a) => ({ texto: String(a?.texto || "").trim().slice(0, 120), cuando: String(a?.cuando || "").trim().slice(0, 40), done: false })).filter((a) => a.texto.length > 2).slice(0, 3) : [])
    // veredicto hoax/certeza (solo claims fácticos) → {nivel,motivo} o null
    let veredicto = null
    if (!isJunk && o.veredicto && ["hoax", "dudoso", "verificado"].includes(String(o.veredicto.nivel || "").toLowerCase())) {
      veredicto = { nivel: String(o.veredicto.nivel).toLowerCase(), motivo: String(o.veredicto.motivo || "").trim().slice(0, 200) }
    }
    setNoteMeta(it.id, { category: isJunk ? null : cat, catkey, title: (o.title || "").trim().slice(0, 90) || null, status: isJunk ? "junk" : "active", ts: byId[it.id]?.ts, actions: acciones, verdict: veredicto })
    isJunk ? junk++ : done++
  }
  // Si la IA devolvió resultados pero se salteó algunas, esas → junk (poco claras). Pero si NO devolvió NADA
  // (hiccup / rate-limit 429), NO junkear en masa: dejarlas sin categorizar para reintentar en la próxima corrida.
  if (!BACKFILL && out.length) for (const it of items) if (!out.some((o) => o.i === it.i)) { setNoteMeta(it.id, { status: "junk", ts: byId[it.id]?.ts }); junk++ }
  setMeta("note_categories", JSON.stringify(newCats.slice(0, 40)))
  console.log(`[notes-cat] ${done} categorizadas · ${preLink} links · ${junk + preJunk} junk · ${newCats.length} categorías`)
}

if (process.argv[1] && process.argv[1].endsWith("notes-categorize.mjs")) run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
