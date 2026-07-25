// Investigación web — Serper.dev (Google Search API, free tier 2500 búsquedas). SERPER_API_KEY en .env.
// Usado por meeting-prep y el coach para investigar personas/empresas desconocidas.
import { llm } from "./llm.mjs"
import { execFile } from "child_process"
import { existsSync } from "fs"
import { promisify } from "util"
const execFileP = promisify(execFile)

// perfil de LinkedIn (vía el reader Python, con la cookie). Búsqueda/perfiles funcionan aunque la mensajería no.
export async function linkedinProfile(name) {
  if (!existsSync("./auth/linkedin-cookies.json")) return null
  const py = process.env.LINKEDIN_PY || "/tmp/li-env/bin/python"
  try {
    const { stdout } = await execFileP(py, ["src/linkedin_reader.py", "profile", name], { timeout: 45000 })
    const j = JSON.parse(stdout.trim().split("\n").pop())
    return j.found ? j : null
  } catch { return null }
}

export function hasWebSearch() { return !!process.env.SERPER_API_KEY }

export async function webSearch(q, num = 6) {
  const key = process.env.SERPER_API_KEY
  if (!key) throw new Error("falta SERPER_API_KEY")
  const res = await fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q, num }) })
  if (!res.ok) throw new Error(`Serper ${res.status}: ${(await res.text()).slice(0, 150)}`)
  const d = await res.json()
  return {
    answer: d.answerBox?.answer || d.answerBox?.snippet || d.knowledgeGraph?.description || "",
    results: (d.organic || []).slice(0, num).map((r) => ({ title: r.title, snippet: r.snippet || "", link: r.link })),
  }
}

// NOTICIAS con fecha + fuente + imagen (Serper /news) — para "Para vos" en la home. `gl`/`hl` sesgan a LATAM/español.
export async function newsSearch(q, { num = 6, gl = "pe", hl = "es" } = {}) {
  const key = process.env.SERPER_API_KEY
  if (!key) throw new Error("falta SERPER_API_KEY")
  const res = await fetch("https://google.serper.dev/news", { method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q, num, gl, hl }) })
  if (!res.ok) throw new Error(`Serper news ${res.status}: ${(await res.text()).slice(0, 150)}`)
  const d = await res.json()
  return (d.news || []).slice(0, num).map((r) => ({ title: r.title, link: r.link, source: r.source || "", date: r.date || "", img: r.imageUrl || "" }))
}

// perfil resumido de una persona (o empresa) desde la web, orientado a una reunión
export async function researchEntity(name, context = "") {
  if (!hasWebSearch()) return null
  const s = await webSearch(`${name} ${context}`.trim())
  const blob = [s.answer && `Destacado: ${s.answer}`, ...s.results.map((r) => `- ${r.title}: ${r.snippet} (${r.link})`)].filter(Boolean).join("\n")
  const prof = await llm(`Resumí en 3-4 bullets quién es "${name}"${context ? ` (contexto: ${context})` : ""} según estos resultados web. Cargo, empresa, seniority, y algo útil para una reunión de negocios. Si los resultados no son claramente sobre esta persona/entidad, decilo honestamente.\n\nRESULTADOS WEB:\n${blob || "(sin resultados)"}`)
  return { profile: prof.trim(), sources: s.results.map((r) => r.link) }
}
