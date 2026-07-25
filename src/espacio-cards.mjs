// PRE-GENERA el rollup de cada espacio (count + recientes + canales). El scan de reglas sobre 1.96M msgs es caro (~5s) →
// se hace acá en background, NO en cada carga de bandeja/IA. La UI lee la tarjeta (meta['espcard:<id>']) → instantáneo.
import { setBusyTimeout } from "./lib/db.mjs"
import { genEspacioCards } from "./lib/brain.mjs"

try { setBusyTimeout(8000) } catch {}
const t0 = Date.now()
const n = genEspacioCards()
console.log(`[espacio-cards] ${n} espacios pre-generados en ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(0)
