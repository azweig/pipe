// PLANTILLA de semilla del grafo — la "verdad de negocio" con la que arranca tu segundo cerebro.
// Copiá este archivo a `src/seed-graph.mjs` (gitignored) y reemplazá los datos ficticios por los tuyos.
// Los nodos quedan seed:true → graphify les suma Timeline pero NO pisa las relaciones. Es idempotente (re-ejecutable).
//   node src/seed-graph.mjs
import { writeSeedNote } from "./lib/vault.mjs"

// ── TU EMPRESA ──────────────────────────────────────────────
const COMPANY = "Acme Inc"
const COMPANY_ALIASES = ["Acme", "ACME Corp"]

// ── TU GENTE ────────────────────────────────────────────────
const SOCIOS = ["Jane Partner"]
const EMPLEADOS = ["John Employee", "Mary Staff"]
const PERSON_ALIASES = { "John Employee": ["Johnny"] }

// ── TUS CLIENTES ────────────────────────────────────────────
// direct = cliente directo; agency = agencia partner con SUS propios sub-clientes.
const CLIENTS = [
  { name: "Globex", kind: "cliente directo", contacts: ["Alice Client"] },
  { name: "Initech", kind: "agencia partner", owner: "Bob Agency", subClients: ["Umbrella", "Soylent"] },
]

const personSeed = (name, role, roleTxt, extraTags = []) =>
  writeSeedNote("person", name, { role, orgs: [COMPANY], tags: [role, "empresa", ...extraTags], aliases: PERSON_ALIASES[name] || [] },
    `# ${name}\n\n${roleTxt}`)

console.log(`🌱 Sembrando el grafo con la estructura de ${COMPANY}...\n`)

// 1) empresa
writeSeedNote("company", COMPANY, { kind: "propia", aliases: COMPANY_ALIASES, tags: ["empresa", "propia"] },
  `# ${COMPANY}\n\nTu empresa. Socios, empleados y clientes cuelgan de acá.`)

// 2) socios y empleados
for (const s of SOCIOS) personSeed(s, "socio", `Socio de ${COMPANY}.`, ["socio"])
for (const e of EMPLEADOS) personSeed(e, "empleado", `Trabaja en ${COMPANY}.`, ["empleado"])

// 3) clientes (y agencias partner con sus sub-clientes)
for (const c of CLIENTS) {
  writeSeedNote("company", c.name, { kind: c.kind, aliases: c.aliases || [], tags: ["cliente"] },
    `# ${c.name}\n\n${c.kind} de [[${COMPANY}]].${c.owner ? ` Contacto principal: [[${c.owner}]].` : ""}`)
  for (const p of c.contacts || []) personSeed(p, "cliente", `Contacto en [[${c.name}]].`, ["cliente"])
  if (c.owner) personSeed(c.owner, "partner", `Dueño de la agencia [[${c.name}]].`, ["partner"])
  for (const sub of c.subClients || [])
    writeSeedNote("company", sub, { kind: "sub-cliente", tags: ["cliente"] }, `# ${sub}\n\nSub-cliente vía [[${c.name}]].`)
}

console.log("✅ Grafo sembrado. Editá src/seed-graph.mjs con tus datos reales y re-ejecutá cuando quieras.")
