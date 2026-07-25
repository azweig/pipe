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
try {
  execFileSync("rsync", ["-az", "--delete", "--exclude", ".obsidian", "-e", `ssh -i ${KEY} -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new`, "vault/", DEST], { stdio: ["ignore", "ignore", "inherit"] })
  console.log(`[vault-sync] ✅ vault → server ${new Date().toISOString().slice(11, 16)}`)
} catch (e) { console.error("[vault-sync] error:", e.message) }
