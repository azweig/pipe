// 🔒 Cuarentena del vault — qué pasa con lo YA escrito cuando marcás una cuenta como secreta.
//
// El resto del gateo evita que se escriba contenido secreto de acá en adelante. Pero el vault (notas de Obsidian que
// escriben graphify y learn) ya puede tener notas de esa persona: sus canales, su timeline, lo que hablaron. Y esas
// notas se sincronizan a otro servidor con rsync, así que quedarse quieto no es una opción.
//
// NO se borran: se MUEVEN a data/secret-vault/ conservando la ruta. Eso deja el vault limpio (y por lo tanto el rsync
// y el índice del RAG), pero no destruye nada tuyo: si desmarcás la cuenta, las notas vuelven solas a su lugar. Borrar
// notas que escribiste vos porque tocaste un checkbox sería una sorpresa desagradable e irreversible.
//
// CÓMO SE DECIDE QUÉ ES DE UNA CUENTA SECRETA. Buscar el número dentro de la nota NO alcanza: contadas sobre un vault real,
// solo 12 de 400 notas contienen un número, y 124 de 177 fichas de persona tienen `channels: []`. La razón es que lo que
// entra por el bridge de Matrix llega con la SALA (!room) como identificador, y graphify descarta las salas por ser
// contenedores — así que la ficha de un contacto del bridge nunca guarda su teléfono.
// El criterio real es el NOMBRE: la nota se llama como la persona (vault/People/<Nombre>.md), y sabemos qué nombres
// corresponden a hilos secretos preguntándole a la base. Los identificadores se siguen usando, pero como token con
// bordes: comparar sopas de dígitos daba falsos positivos absurdos (una fecha + un presupuesto "parecían" el número).
//
// LÍMITE HONESTO: una nota que hable de la persona con un apodo que no está en la base ni en los alias no se detecta.
import { existsSync, readFileSync, readdirSync, mkdirSync, renameSync, rmdirSync, writeFileSync, statSync } from "fs"
import { join, dirname, relative, basename } from "path"
import { listSecretNumbers, listSecretAccounts, secretThreadKeys, secretGate } from "./secret.mjs"
import { handle } from "./db-core.mjs"

const VAULT = "./vault"
const CUARENTENA = "./data/secret-vault"
const RAG = "./data/rag.jsonl"

const norm = (s) => String(s || "").trim().toLowerCase()

// A quién hay que tapar: los NOMBRES de los hilos secretos (así se llaman las notas) + los identificadores crudos.
// El identity-map (canal → nombre canónico, el que usa graphify para nombrar la nota) es la fuente más directa.
export function objetivosSecretos() {
  const nums = listSecretNumbers().map((n) => String(n).replace(/\D/g, "")).filter((n) => n.length >= 7)
  const claves = (() => { try { const h = secretThreadKeys(); return secretGate().blockAll ? [] : [...h] } catch { return [] } })()
  // OJO: NO se busca la etiqueta de la cuenta ("trabajo", "personal"). Esa etiqueta es TUYA, no del contacto: graphify
  // escribe la dirección de la OTRA persona, así que buscar la etiqueta no encontraba nunca la nota — y encima una
  // etiqueta corta como "work" aparecía por casualidad en notas ajenas. Lo que sirve son las direcciones de los hilos
  // secretos, que están en la propia clave del hilo (email:<dirección>).
  const mails = claves.filter((k) => k.startsWith("email:")).map((k) => norm(k.slice(6))).filter((m) => m.includes("@"))
  const nombres = new Set()
  // el nombre con el que aparece cada hilo secreto: es el que graphify usa para titular la nota
  // SOLO hilos 1:1. En un GRUPO servido por la línea secreta hablan diez personas: meter a todas acá hacía desaparecer las
  // notas de contactos normales con los que también hablás por la línea que no es secreta. El grupo se oculta igual (su
  // hilo está en `claves`), pero sus participantes no son "cuentas secretas".
  const esGrupo = (k) => /@g\.us|@newsletter|@broadcast|@thread\.v2|:!/.test(k)
  try {
    const db = handle()
    const q = db.prepare("SELECT DISTINCT name FROM messages WHERE thread=? AND dir!='out' AND name!='' LIMIT 5")
    for (const k of claves) {
      if (esGrupo(k)) continue
      for (const r of q.all(k)) if (r.name) nombres.add(norm(r.name))
      if (!/^(whatsapp|email|telegram|teams|signal|sms):/.test(k)) nombres.add(norm(k)) // hilos keyeados por nombre de persona
    }
  } catch {}
  // identity-map: canal → nombre canónico. Cubre al contacto cuyo canal es la sala del bridge.
  try {
    const idm = JSON.parse(readFileSync("./data/identity-map.json", "utf8"))
    for (const [canal, canon] of Object.entries(idm || {})) {
      const d = String(canal).replace(/\D/g, "")
      if (nums.some((n) => d.includes(n)) || mails.some((m) => norm(canal).includes(m))) nombres.add(norm(canon))
    }
  } catch {}
  nombres.delete("")
  return { nums, mails, nombres, claves }
}

// .md y .canvas: el rsync del vault sube TODO menos .obsidian, así que un canvas viaja igual que una nota
const ES_NOTA = /\.(md|canvas)$/i
function notas(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...notas(p))
    else if (ES_NOTA.test(e.name)) out.push(p)
  }
  return out
}

// un número dentro de un texto, tolerando +, espacios y guiones, pero con BORDES: no puede ser un pedazo de otro número.
// Sin los bordes, "2026-05-19 9900 0001 … 51 … 999" se leía como el número entero y se llevaba puesta una nota inocente.
function contieneNumero(texto, num) {
  const patron = num.split("").join("[\\s.\\-()]*")
  return new RegExp(`(?<![0-9])\\+?${patron}(?![0-9])`).test(texto)
}

// ¿esta nota es de una cuenta secreta? La nota TRATA de esa persona (su título es su nombre) o contiene su identificador.
//
// Lo que NO se hace: buscar el nombre como substring del cuerpo. Sonaba razonable y era destructivo — "Rita" aparece dentro
// de "escrita" y "favorita"; "solo" dentro de "trabajamos solo con proveedores"; "mario" dentro de "primario". Se llevaba
// puestas notas de proyectos y de terceros, que desaparecían del vault sin explicación. El título de la nota es la señal
// que graphify realmente controla; el resto se cubre por identificador, que sí es inequívoco.
export function esNotaSecreta(ruta, contenido, objs = objetivosSecretos()) {
  const titulo = norm(basename(String(ruta || "")).replace(ES_NOTA, ""))
  if (titulo && objs.nombres.has(titulo)) return true
  const t = String(contenido || "")
  if (!t) return false
  const low = t.toLowerCase()
  for (const m of objs.mails) if (low.includes(m)) return true
  for (const n of objs.nums) if (contieneNumero(t, n)) return true
  // el nombre en el FRONTMATTER (aliases/channels) sí cuenta: ahí lo escribió graphify, no es prosa
  const fm = (low.match(/^---\n([\s\S]*?)\n---/) || [])[1] || ""
  if (fm) for (const nom of objs.nombres) if (new RegExp(`(^|[^\\p{L}])${nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(fm)) return true
  return false
}

// mueve SIN PISAR. Un rename ciego borraba la nota nueva que graphify hubiera escrito mientras la vieja estaba guardada:
// pérdida de datos silenciosa. Si el destino existe, se guardan las dos.
function mover(desde, hacia) {
  mkdirSync(dirname(hacia), { recursive: true })
  let destino = hacia
  for (let i = 1; existsSync(destino) && i < 100; i++) destino = hacia.replace(/(\.[^.]+)$/, `.${i}$1`)
  if (existsSync(destino)) return null // 100 colisiones: mejor no tocar nada
  renameSync(desde, destino)
  return destino
}

// mueve a cuarentena toda nota del vault que mencione una cuenta secreta. Devuelve las rutas relativas movidas.
export function cuarentenaVault({ incluirBrain = false } = {}) {
  const objs = objetivosSecretos()
  // ojo: NO alcanza con mirar nums/mails. Una red entera marcada secreta se guarda como account "*" (sin número), y ahí
  // los únicos objetivos son los nombres de los hilos.
  if (!objs.nums.length && !objs.mails.length && !objs.nombres.size) return []
  const movidas = []
  for (const f of notas(VAULT)) {
    let cont = ""
    try { cont = readFileSync(f, "utf8") } catch { continue }
    if (!esNotaSecreta(f, cont, objs)) continue
    const rel = relative(VAULT, f)
    try { if (mover(f, join(CUARENTENA, rel))) movidas.push(rel) } catch {}
  }
  // El self-model (vault/_Brain) resume TODO lo que pasó, sin nombrar canales: no lo agarra ningún criterio de arriba, y
  // encima learn() se lo pasa a sí mismo en cada corrida con la orden de "mantené lo que sigue siendo cierto" → lo derivado
  // de la cuenta secreta se reescribiría para siempre. Se guarda UNA vez, al marcar la cuenta, y se regenera limpio.
  //
  // `incluirBrain` es false por defecto A PROPÓSITO: esto también corre antes de cada sincronización del vault, y hacerlo
  // ahí apartaba el modelo recién regenerado una y otra vez — learn quedaba de hecho apagado y el log histórico terminaba
  // partido en self-model.1.md, .2.md, .3.md… La regeneración se dispara al MARCAR, no cada 20 minutos.
  if (incluirBrain) { // (arriba ya salimos si no hay ninguna cuenta secreta marcada)
    for (const f of notas(join(VAULT, "_Brain"))) {
      const rel = relative(VAULT, f)
      if (existsSync(join(CUARENTENA, rel))) continue // ya hay una versión apartada: no acumular copias
      try { if (mover(f, join(CUARENTENA, rel))) movidas.push(rel) } catch {}
    }
  }
  return movidas
}

// devuelve al vault lo que ya NO menciona ninguna cuenta secreta (desmarcaste el número/la cuenta).
export function restaurarVault() {
  if (!existsSync(CUARENTENA)) return []
  const objs = objetivosSecretos()
  const vueltas = []
  for (const f of notas(CUARENTENA)) {
    let cont = ""
    try { cont = readFileSync(f, "utf8") } catch { continue }
    if (esNotaSecreta(f, cont, objs)) continue // sigue siendo secreta → se queda
    const rel = relative(CUARENTENA, f)
    try { if (mover(f, join(VAULT, rel))) vueltas.push(rel) } catch {}
  }
  // limpiar carpetas que quedaron vacías (rmdir falla si no lo están, y está bien: no borramos nada con contenido)
  const limpiar = (d) => { if (!existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) limpiar(join(d, e.name))
    try { rmdirSync(d) } catch {} }
  limpiar(CUARENTENA)
  return vueltas
}

// saca del índice semántico las líneas de las notas que se fueron a cuarentena. El índice guarda `ref` = ruta de la nota
// sin el .md. No hace falta tocar las líneas de MENSAJES: ésas ya se filtran al consultar, resolviéndolas contra la DB.
// Reescribe por streaming a un temporal y renombra: si el indexador appendeó algo en el medio, se pierde esa línea y la
// vuelve a agregar en la corrida siguiente (reconstruye su set de ids leyendo el archivo).
export function purgarRagDeNotas(refsRelativas = []) {
  if (!refsRelativas.length || !existsSync(RAG)) return 0
  const fuera = new Set(refsRelativas.map((r) => String(r).replace(/\.md$/, "")))
  const tmp = `${RAG}.${process.pid}.tmp`
  let quitadas = 0
  try {
    const buf = readFileSync(RAG)
    const salida = []
    let start = 0
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 10) continue
      const linea = buf.toString("utf8", start, i); start = i + 1
      if (!linea) continue
      let r; try { r = JSON.parse(linea) } catch { salida.push(linea); continue }
      // ref de una nota = "People/Fulano#3" → comparamos contra la parte anterior al #
      const ref = String(r.ref || "").split("#")[0]
      if (r.kind === "note" && fuera.has(ref)) { quitadas++; continue }
      salida.push(linea)
    }
    if (!quitadas) return 0
    writeFileSync(tmp, salida.join("\n") + "\n")
    renameSync(tmp, RAG)
  } catch { return 0 }
  return quitadas
}

// tamaño de la cuarentena, para poder decirlo en la UI/logs sin revelar QUÉ hay adentro
export function estadoCuarentena() {
  if (!existsSync(CUARENTENA)) return { notas: 0, bytes: 0 }
  const fs_ = notas(CUARENTENA)
  let bytes = 0
  for (const f of fs_) { try { bytes += statSync(f).size } catch {} }
  return { notas: fs_.length, bytes }
}
