#!/usr/bin/env node
// Compacta data/rag.jsonl: pasa los vectores de texto JSON (~15KB por entrada) a int8/base64 (~1KB).
// El coseno es invariante a escala, así que el orden de los resultados no cambia (test/rag-quant.mjs lo fija).
//
// Seguro por diseño: escribe a un archivo NUEVO, verifica, y recién ahí reemplaza (deja el viejo como .bak).
// Uso:  node scripts/rag-compact.mjs [--dry]
import { createReadStream, createWriteStream, existsSync, statSync, renameSync } from "fs"
import { createInterface } from "readline"
import { packVec, cosine, unpackVec } from "../src/lib/embed.mjs"

const F = "./data/rag.jsonl", TMP = F + ".compact", dry = process.argv.includes("--dry")
if (!existsSync(F)) { console.error("no existe " + F); process.exit(1) }
const antes = statSync(F).size

const out = dry ? null : createWriteStream(TMP)
const rl = createInterface({ input: createReadStream(F, "utf8"), crlfDelay: Infinity })
let n = 0, yaEstaban = 0, convertidos = 0, rotas = 0, peorError = 0
for await (const l of rl) {
  if (!l) continue
  let r; try { r = JSON.parse(l) } catch { rotas++; continue }
  n++
  if (Array.isArray(r.vec)) {
    const antesVec = r.vec
    r.vec = packVec(antesVec)
    // control de calidad: el coseno contra sí mismo tiene que seguir dando ~1
    const e = Math.abs(1 - cosine(antesVec, unpackVec(r.vec)))
    if (e > peorError) peorError = e
    convertidos++
  } else yaEstaban++
  if (out) out.write(JSON.stringify(r) + "\n")
}
if (out) await new Promise((res) => out.end(res))

const mb = (b) => (b / 1048576).toFixed(0) + "MB"
console.log(`entradas: ${n} · convertidas: ${convertidos} · ya compactas: ${yaEstaban} · ilegibles: ${rotas}`)
console.log(`peor desviación del coseno: ${peorError.toFixed(5)} (tiene que ser ~0)`)
if (dry) { console.log(`(ensayo en seco; el archivo pesa ${mb(antes)})`); process.exit(0) }
const despues = statSync(TMP).size
if (peorError > 0.01) { console.error("❌ la cuantización se desvió demasiado — NO reemplazo"); process.exit(1) }
if (despues > antes) { console.error("❌ el nuevo pesa más — NO reemplazo"); process.exit(1) }
renameSync(F, F + ".bak"); renameSync(TMP, F)
console.log(`✓ ${mb(antes)} → ${mb(despues)} (${(antes / despues).toFixed(1)}x). El viejo quedó en ${F}.bak`)
