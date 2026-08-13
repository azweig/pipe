// Carga ./.env a process.env SIN pisar variables ya definidas (el env del proceso/compose gana).
//
// El parser anterior era `/^([^#=]+)=(.*)$/` + trim: se quedaba con TODO lo que seguía al "=", comentario incluido.
// Como .env.example traía comentarios en la misma línea, un `cp .env.example .env` (lo que dice el README, y lo que hace
// install.sh) dejaba HOST="127.0.0.1   # 0.0.0.0 dentro de un container…" → server.listen() con ese hostname → el DNS falla
// y el proceso se queda vivo sin abrir NUNCA el puerto. Peor: SECRETS_KEY quedaba con el texto del comentario, que es
// truthy, así que toda instalación por defecto cifraba los tokens con una clave derivable del repo público.
//
// Reglas (las de dotenv, para no sorprender a nadie):
//   FOO=bar # comentario   → "bar"        (un # PRECEDIDO DE ESPACIO abre comentario)
//   FOO=   # comentario    → ""           (valor vacío, no el comentario)
//   FOO=a#b                → "a#b"        (sin espacio antes no es comentario: una contraseña puede llevar #)
//   FOO="a # b"            → "a # b"      (entre comillas se respeta tal cual)
import { existsSync, readFileSync } from "fs"

export function loadEnv(path = ".env") {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue // "export FOO", basura, líneas partidas
    if (key in process.env) continue                    // el env del proceso gana

    let val = line.slice(eq + 1)
    const q = val.trim()[0]
    if (q === '"' || q === "'") {                       // entrecomillado: literal hasta la comilla de cierre
      const s = val.indexOf(q), e = val.indexOf(q, s + 1)
      if (e > s) { process.env[key] = val.slice(s + 1, e); continue }
    }
    const c = val.search(/(^|\s)#/)                     // comentario al final (o valor que es solo comentario)
    if (c >= 0) val = val.slice(0, c)
    process.env[key] = val.trim()
  }
}
