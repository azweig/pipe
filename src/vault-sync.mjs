// Sincroniza el vault Obsidian (el cerebro) a la computadora que creamos (server tu servidor).
// Backup versionado-vivo + base para que el LLM aprenda ahí. Uso: node src/vault-sync.mjs
import { execFileSync } from "child_process"
import { existsSync, readdirSync } from "fs"
import { loadEnv } from "./lib/env.mjs"

loadEnv()

// configurá VAULT_SSH_KEY y VAULT_DEST en tu .env para sincronizar el vault a un server remoto (backup versionado-vivo)
const KEY = process.env.VAULT_SSH_KEY || `${process.env.HOME}/.ssh/id_ed25519`
const DEST = process.env.VAULT_DEST || ""
// sin destino o sin llave (ej: corriendo YA en el server, donde el vault es nativo) → nada que sincronizar
if (!DEST || !existsSync(KEY)) { console.log("[vault-sync] sin VAULT_DEST/llave → sync remoto desactivado"); process.exit(0) }
// GUARD ANTI-BORRADO: rsync --delete ESPEJA. Si vault/ está vacío (volumen no montado / recreado por el Dockerfile mkdir),
// espejar borraría el backup remoto ENTERO — justo cuando ya perdiste el local. Un vault vacío sale 0, así que el catch no lo ve.
// contar ARCHIVOS reales recursivamente (no entradas de directorio): un volumen recreado que conserva el árbol de carpetas VACÍAS
// pasaba el guard (readdirSync('vault')=['notas'] → length 1) → --delete borraba el backup. Igual mkdirSync("./vault/Daily") de graphify.
function hasRealFiles(dir) {
  const stack = [dir]
  while (stack.length) {
    let entries; const d = stack.pop(); try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name === ".obsidian" || e.name.startsWith(".")) continue
      if (e.isDirectory()) stack.push(d + "/" + e.name)
      else if (e.isFile()) return true
    }
  }
  return false
}
if (!hasRealFiles("vault")) { console.error("[vault-sync] ⛔ vault/ sin archivos reales (dirs vacíos / recién recreado) → NO sincronizo (--delete borraría el backup remoto)"); process.exit(1) }

// 🔒 ÚLTIMA COMPUERTA. La cuarentena corre cuando marcás una cuenta como secreta, pero eso es un solo intento: si el
// proceso se murió a la mitad, o si graphify escribió una nota nueva después, quedaba contenido secreto esperando el
// próximo rsync. Acá es donde el vault SALE de la máquina, así que se revisa una vez más antes de mandarlo.
try {
  const { secretGate } = await import("./lib/secret.mjs")
  // Un `cuarentenaVault()` vacío NO significa "no hay nada que ocultar": si el gate no se pudo calcular, devuelve vacío
  // sin lanzar, y esta compuerta dejaba pasar el rsync entero. Este proceso arranca de cero cada vez, así que nunca tiene
  // un cálculo bueno previo del que agarrarse: hay que preguntar explícitamente.
  const g = secretGate()
  if (g.blockAll || g.degraded) { console.error("[vault-sync] ⛔ no puedo calcular qué cuentas son secretas → NO sincronizo (reintento en la próxima corrida)"); process.exit(1) }
  const { cuarentenaVault, restaurarVault, purgarRagDeNotas } = await import("./lib/secret-vault.mjs")
  const vueltas = restaurarVault() // lo que dejó de ser secreto vuelve al vault antes de subirlo
  const movidas = cuarentenaVault()
  if (movidas.length) purgarRagDeNotas(movidas) // si no, la nota sale del vault pero sus vectores siguen alimentando a la IA
  if (movidas.length || vueltas.length) console.log(`[vault-sync] 🔒 ${movidas.length} notas apartadas, ${vueltas.length} devueltas antes de sincronizar`)
} catch (e) { console.error("[vault-sync] ⛔ no pude revisar las cuentas secretas → NO sincronizo:", e?.message || e); process.exit(1) }
try {
  execFileSync("rsync", ["-az", "--delete", "--exclude", ".obsidian", "-e", `ssh -i ${KEY} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new`, "vault/", DEST], { stdio: ["ignore", "ignore", "inherit"] })
  console.log(`[vault-sync] ✅ vault → server ${new Date().toISOString().slice(11, 16)}`)
} catch (e) { console.error("[vault-sync] error:", e.message) }
