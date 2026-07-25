// Setup de tests: inyecta una identidad de hub FICTICIA vía HUB_CONFIG, antes de que hub.mjs/thread.mjs carguen.
// Importalo PRIMERO en los tests que dependen de la identidad (MY_NUMBERS/MY_EMAILS).
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const f = join(tmpdir(), "pipe-test-hub-" + process.pid + ".json")
writeFileSync(f, JSON.stringify({
  ownerName: "Test Owner",
  ownerFirst: "Test",
  company: "TestCo",
  myNumbers: ["15551230001", "15551230002", "15551230003"],
  myEmails: ["me@example.com"],
  timezone: "America/Lima",
  domain: "localhost",
}))
process.env.HUB_CONFIG = f
