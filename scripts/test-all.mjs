// Corre TODO: regenera docs, tests unitarios (funciones puras) e integración (server vivo).
// Uso:  node scripts/test-all.mjs [--llm]
import { execFileSync } from "child_process"
const withLlm = process.argv.includes("--llm")
function run(label, args) {
  console.log(`\n━━━━ ${label} ━━━━`)
  try { process.stdout.write(execFileSync("node", args, { encoding: "utf8" })); return true }
  catch (e) { process.stdout.write((e.stdout || "") + (e.stderr || "")); return false }
}
let ok = true
run("📄 Docs (auto-gen)", ["scripts/gen-docs.mjs"])
ok = run("🧪 Unitarios", ["--test", "test/unit.mjs"]) && ok
ok = run("🔗 Integración", ["test/integration.mjs", ...(withLlm ? ["--llm"] : [])]) && ok
console.log(ok ? "\n✅ TODO VERDE" : "\n❌ HAY FALLOS")
process.exit(ok ? 0 : 1)
