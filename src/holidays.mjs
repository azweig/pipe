// Feriados públicos (Nager.Date — open source, sin API key). Baja PE/AR/CO/BO/US para año actual + siguiente.
// Guarda en data/holidays.json → la UI filtra por país. Corré esto 1 vez por mes (o al arrancar) para refrescar.
import { mkdirSync, writeFileSync } from "fs"

mkdirSync("./data", { recursive: true })
const COUNTRIES = { PE: "Perú", AR: "Argentina", CO: "Colombia", BO: "Bolivia", US: "Estados Unidos" }
const year = new Date().getFullYear()
const YEARS = [year, year + 1]

async function fetchHolidays(code, y) {
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${code}`)
  if (!res.ok) throw new Error(`${code} ${y}: ${res.status}`)
  return res.json()
}

const out = {} // { PE: [{date, localName, name, global}], ... }
for (const code of Object.keys(COUNTRIES)) {
  out[code] = { country: COUNTRIES[code], holidays: [] }
  for (const y of YEARS) {
    try {
      const hs = await fetchHolidays(code, y)
      for (const h of hs) out[code].holidays.push({ date: h.date, localName: h.localName, name: h.name, global: h.global !== false })
    } catch (e) { console.log("err", e.message) }
  }
  out[code].holidays.sort((a, b) => a.date.localeCompare(b.date))
  console.log(`✅ ${COUNTRIES[code]} (${code}): ${out[code].holidays.length} feriados ${YEARS.join("+")}`)
}

writeFileSync("./data/holidays.json", JSON.stringify(out, null, 2))
console.log(`\n📅 Guardado en data/holidays.json — ${Object.keys(COUNTRIES).length} países.`)

// muestra los próximos 8 feriados (de cualquiera de los 5 países) desde hoy
const today = new Date().toISOString().slice(0, 10)
const upcoming = []
for (const code of Object.keys(out)) for (const h of out[code].holidays) if (h.date >= today) upcoming.push({ ...h, code, country: COUNTRIES[code] })
upcoming.sort((a, b) => a.date.localeCompare(b.date))
console.log("\nPróximos feriados:")
for (const h of upcoming.slice(0, 8)) console.log(`   ${h.date}  ${h.country.padEnd(15)} ${h.localName}`)
