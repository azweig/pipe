// Mantiene CALIENTE el modelo de corrección de texto en el GPU box → evita el cold-start de ~44s que hacía timeout y mostraba
// "sin errores". Lo spawnea el daemon cada pocos minutos (dentro de la ventana keep_alive de 30m). Barato: un generate de 8 tokens.
import { warmCorrectModel } from "./lib/brain.mjs"
await warmCorrectModel()
process.exit(0)
