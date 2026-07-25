// Preflight de engines (OSS): better-sqlite3 se compila contra el ABI nativo de Node. Con Node ≠ 20-24 el binario
// no carga y el error es críptico ("NODE_MODULE_VERSION 115 vs 141"). Esto falla temprano con un mensaje claro.
const major = Number(process.versions.node.split(".")[0])
if (major < 20 || major >= 25) {
  console.error(`\n❌ Node ${process.versions.node} no soportado. Este proyecto necesita Node 20–24 (ABI de better-sqlite3).`)
  console.error(`   Instalá Node 20 LTS (nvm install 20 && nvm use 20) y reintentá.\n`)
  process.exit(1)
}
