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
  assert.equal(s.setSecretPin("222333").ok, true)
  assert.equal(s.secretPinSet(), true)
})

test("setSecretPin: DEBE ser distinto del PIN de entrada", () => {
  auth.setPin("111222")                       // PIN principal
  assert.ok(s.setSecretPin("111222").error, "igual al principal debe fallar")
  assert.equal(s.setSecretPin("999888").ok, true, "distinto pasa")
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
  s.setSecretAccount("email", "gmail-Alvaro", true)
  assert.equal(s.isSecretAccount("email", "gmail-alvaro"), true, "case-insensitive")
  assert.equal(s.isSecretAccount("email", "otro"), false)
  s.setSecretAccount("whatsapp", "+51999", true)
  assert.equal(s.isSecretAccount("whatsapp", "+51999"), true, "toggle on")
  s.setSecretAccount("whatsapp", "+51999", false)
  assert.equal(s.isSecretAccount("whatsapp", "+51999"), false, "toggle off")
})

test("secretAccountSet: devuelve las claves normalizadas para el gateo", () => {
  const set = s.secretAccountSet()
  assert.equal(set.has(s.secretKey("email", "gmail-alvaro")), true)
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
