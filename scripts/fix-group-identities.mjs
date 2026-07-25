// Limpieza: saca los jids de GRUPO que graphify metió por error como "canal" de una persona.
// Efecto del bug: un grupo (@g.us o portal !room del bridge) quedaba asociado a una persona → el grupo se
// confundía con la persona (caso: el grupo "Acme-Equipo/Soporte" tratado como un colega).
// Corre local o en el box:  node scripts/fix-group-identities.mjs        (--dry para solo ver)
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs"

const DRY = process.argv.includes("--dry")
const isGroupChannel = (ch) => /@g\.us|@broadcast|@newsletter|@thread\.v2|:!/.test(ch || "")

// 1) identity-map.json: borrar entradas cuya CLAVE es un jid de grupo (grupo → nombre de persona)
const IDMAP = "./data/identity-map.json"
if (existsSync(IDMAP)) {
  const m = JSON.parse(readFileSync(IDMAP, "utf8"))
  const bad = Object.keys(m).filter(isGroupChannel)
  console.log(`identity-map: ${bad.length} entradas de grupo mal mapeadas a persona:`)
  for (const k of bad) console.log(`   ${k} → "${m[k]}"`)
  if (!DRY) { for (const k of bad) delete m[k]; writeFileSync(IDMAP, JSON.stringify(m, null, 2)) }
}

// 2) vault/People/*.md: quitar de la línea `channels: [...]` los jids de grupo
const PDIR = "./vault/People"
let notesFixed = 0
if (existsSync(PDIR)) {
  for (const f of readdirSync(PDIR).filter((x) => x.endsWith(".md"))) {
    const path = `${PDIR}/${f}`
    const md = readFileSync(path, "utf8")
    const m = md.match(/^channels:\s*\[(.*?)\]\s*$/m)
    if (!m) continue
    const chans = m[1].split(",").map((s) => s.trim()).filter(Boolean)
    const clean = chans.filter((ch) => !isGroupChannel(ch))
    if (clean.length !== chans.length) {
      console.log(`${f}: canales de grupo removidos → ${chans.filter(isGroupChannel).join(", ")}`)
      notesFixed++
      if (!DRY) writeFileSync(path, md.replace(m[0], `channels: [${clean.join(", ")}]`))
    }
  }
}
console.log(`\n${DRY ? "[DRY] " : ""}listo · ${notesFixed} notas de persona limpiadas`)
