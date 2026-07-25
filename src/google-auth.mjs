// Autorizar una cuenta de Google (Calendar + Drive). Uso: node src/google-auth.mjs <label> <email>
import { authorizeAccount } from "./lib/google.mjs"
const [label, email] = process.argv.slice(2)
if (!label) { console.log("Uso: node src/google-auth.mjs <label> <email>"); process.exit(1) }
await authorizeAccount(label, email, (url) => console.log(`\n🔑 AUTORIZÁ ${email || label} (elegí esa cuenta):\n\n${url}\n`))
console.log(`\n✅ ${label} autorizado (Drive + Calendar).`)
process.exit(0)
