// Carga ./.env a process.env SIN pisar variables ya definidas (el env del proceso/compose gana).
import { existsSync, readFileSync } from "fs"
export function loadEnv(path = ".env") {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m && !(m[1].trim() in process.env)) process.env[m[1].trim()] = m[2].trim()
  }
}
