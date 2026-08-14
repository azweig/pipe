// Tests de secret.mjs — 2º PIN (scrypt+salt), sesión secreta (sliding TTL, en memoria), marca de cuenta secreta.
// Hermético: escribe en ./data/*.json relativo al cwd → corremos en un cwd temporal para NO tocar el data/ real.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-secret-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

const auth = await import("../src/lib/auth.mjs")
const s = await import("../src/lib/secret.mjs")

test("2º PIN: sin configurar al inicio", () => { assert.equal(s.secretPinSet(), false) })

test("setSecretPin: rechaza cortos/no-numéricos y acepta 6-12 dígitos", () => {
  assert.ok(s.setSecretPin("123").error, "3 dígitos falla")
  assert.ok(s.setSecretPin("abcdef").error, "no-numérico falla")
  assert.equal(s.setSecretPin("222333").ok, true) // primera vez: no hay PIN previo, no hace falta el actual
  assert.equal(s.secretPinSet(), true)
})

test("setSecretPin: DEBE ser distinto del PIN de entrada", () => {
  auth.setPin("111222")                       // PIN principal
  // ya hay un 2º PIN puesto ("222333" del test anterior) → cambiarlo EXIGE el actual
  assert.ok(s.setSecretPin("111222", "222333").error, "igual al principal debe fallar")
  assert.equal(s.setSecretPin("999888", "222333").ok, true, "distinto pasa")
})

test("setSecretPin: cambiar el 2º PIN EXIGE el actual (tener la sesión principal no alcanza)", () => {
  // El modelo de amenaza de esta función es alguien que YA pasó el 1º PIN: tu pareja, tu socio, tu teléfono desbloqueado.
  // Sin este requisito redefinía el 2º PIN en un POST y veía todo lo oculto — la función no protegía de nada.
  assert.ok(s.setSecretPin("555444").error, "sin el actual NO se puede cambiar")
  assert.ok(s.setSecretPin("555444", "000000").error, "con el actual EQUIVOCADO tampoco")
  assert.equal(s.setSecretPin("555444", "999888").ok, true, "con el actual correcto sí")
  assert.equal(s.setSecretPin("999888", "555444").ok, true, "lo dejo como estaba para los tests que siguen")
})

test("unlockSecret: se frena la fuerza bruta (el PIN principal ya lo hacía; este no)", () => {
  const ip = "203.0.113.77"
  for (let i = 0; i < 5; i++) assert.ok(s.unlockSecret("000000", ip).error, "intento fallido " + i)
  const r = s.unlockSecret("999888", ip) // el CORRECTO, pero ya bloqueado
  assert.ok(r.error, "tras 5 fallos queda bloqueado aunque el PIN sea correcto")
  assert.match(r.error, /intentos/i)
  // otra IP no queda afectada por el bloqueo de la primera
  assert.equal(s.unlockSecret("999888", "198.51.100.9").ok, true)
})

test("unlock: PIN incorrecto no abre; correcto emite token de 256 bits válido", () => {
  assert.ok(s.unlockSecret("000000").error, "PIN incorrecto no desbloquea")
  const r = s.unlockSecret("999888")
  assert.equal(r.ok, true)
  assert.match(r.token, /^[a-f0-9]{64}$/)
  assert.equal(s.validSecretSession(r.token), true)
})

test("validSecretSession: rechaza tokens mal formados / inexistentes", () => {
  assert.equal(s.validSecretSession("bad"), false)
  assert.equal(s.validSecretSession("a".repeat(64)), false, "64 hex pero inexistente")
  assert.equal(s.validSecretSession(""), false)
  assert.equal(s.validSecretSession(undefined), false)
})

test("lockSecret / lockAllSecret: invalidan la sesión", () => {
  const t1 = s.unlockSecret("999888").token, t2 = s.unlockSecret("999888").token
  s.lockSecret(t1)
  assert.equal(s.validSecretSession(t1), false, "Ocultar cierra ese token")
  assert.equal(s.validSecretSession(t2), true, "el otro sigue")
  s.lockAllSecret()
  assert.equal(s.validSecretSession(t2), false, "lockAll cierra todo")
})

test("marcar una cuenta NO corta tu sesión (seguís autorizado para editar en config)", () => {
  const t = s.unlockSecret("999888").token
  assert.equal(s.validSecretSession(t), true)
  s.setSecretAccount("email", "gmail-x", true)
  assert.equal(s.validSecretSession(t), true, "seguís desbloqueado tras marcar")
  s.setSecretAccount("email", "gmail-x", false)
})

test("isSecretAccount: match case-insensitive por channel:account; toggle on/off", () => {
  s.setSecretAccount("email", "gmail-Personal", true)
  assert.equal(s.isSecretAccount("email", "gmail-personal"), true, "case-insensitive")
  assert.equal(s.isSecretAccount("email", "otro"), false)
  s.setSecretAccount("whatsapp", "+51999", true)
  assert.equal(s.isSecretAccount("whatsapp", "+51999"), true, "toggle on")
  s.setSecretAccount("whatsapp", "+51999", false)
  assert.equal(s.isSecretAccount("whatsapp", "+51999"), false, "toggle off")
})

test("secretAccountSet: devuelve las claves normalizadas para el gateo", () => {
  const set = s.secretAccountSet()
  assert.equal(set.has(s.secretKey("email", "gmail-personal")), true)
})

test("CUENTA SECRETA por número (WhatsApp) y por cuenta (email): marcar/normalizar/detectar", () => {
  s.setSecretNumber("+51 999 000 366", true)           // normaliza a dígitos
  assert.deepEqual(s.listSecretNumbers(), ["51999000366"])
  assert.equal(s.isSecretNumber("51999000366"), true)
  s.setSecretNumber("51999000366", false)
  assert.equal(s.isSecretNumber("51999000366"), false, "toggle off")
  // email por cuenta (isSecretAccount es independiente de la DB; isSecretMsg ya es por-HILO y se verifica en prod)
  s.setSecretAccount("email", "gmail-secreto", true)
  assert.equal(s.isSecretAccount("email", "gmail-secreto"), true, "cuenta de correo secreta")
  assert.equal(s.isSecretAccount("email", "gmail-normal"), false)
  s.setSecretAccount("email", "gmail-secreto", false)
})

test("clearSecretPin: borra el PIN y cierra sesiones", () => {
  const t = s.unlockSecret("999888").token
  s.clearSecretPin()
  assert.equal(s.secretPinSet(), false)
  assert.equal(s.validSecretSession(t), false)
})

// Regresión: un data/secret-*.json ILEGIBLE (disco lleno, escritura a medias) no puede degenerar en "no ocultes nada".
// El gate falla cerrado, y eso tiene que llegar a los lectores que filtran con `hide.has(clave)` — bandeja, home, ask.
test("marcas ilegibles: el gate oculta TODO y la bandeja queda vacía (no filtra)", async () => {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(join(dir, "data", "secret-numbers.json"), '["5199900')   // JSON cortado a la mitad
  s.setSecretAccount("email", "cualquiera", false)                       // invalida los caches del gate (API pública)
  const g = s.secretGate()
  assert.equal(g.blockAll, true, "sin poder calcular qué esconder → bloquea todo")
  assert.equal(g.hide.has("whatsapp:11111@s.whatsapp.net"), true, "hide dice que sí a cualquier hilo")
  assert.ok(s.secretThreadKeys().size > 0, "quien pregunta '¿hay algo que ocultar?' recibe que sí")
  assert.equal(s.isSecretMsg({ channel: "email", account: "trabajo" }), true, "por-mensaje también")
  // así filtra la bandeja de verdad (server.mjs /api/threads)
  const bandeja = [{ key: "whatsapp:11111@s.whatsapp.net" }, { key: "email:jefe@empresa.com" }]
  assert.deepEqual(bandeja.filter((t) => !g.hide.has(t.key)), [], "no sale ningún hilo")
  assert.equal(s.secretMarksBroken()?.includes("secret-numbers.json"), true, "queda dicho qué archivo falló")
})
