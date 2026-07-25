// Tests de auth.mjs — PIN (scrypt+salt), sesiones, rate-limit anti-fuerza-bruta, revoke-all.
// Seguridad-crítico. Hermético: auth.mjs escribe en ./data/auth-*.json relativo al cwd → corremos en
// un cwd temporal para NO tocar el data/ real. (node --test aísla cada archivo en su propio proceso.)
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const orig = process.cwd()
const dir = mkdtempSync(join(tmpdir(), "pipe-auth-"))
mkdirSync(join(dir, "data"))
process.chdir(dir)
after(() => { process.chdir(orig); rmSync(dir, { recursive: true, force: true }) })

process.env.RATE_MAP_PRUNE = "10"; process.env.RATE_MAP_MAX = "20" // umbrales bajos → el test de regresión del Map cebado corre rápido
const { pinIsSet, setPin, changePin, login, validSession, logout, logoutAll, sessionCount } = await import("../src/lib/auth.mjs")

test("PIN: sin configurar al inicio", () => {
  assert.equal(pinIsSet(), false)
})

test("setPin: rechaza cortos/no-numéricos/largos, acepta 6-12 dígitos", () => {
  assert.ok(setPin("1234").error, "4 dígitos debe fallar")
  assert.ok(setPin("abcdef").error, "no-numérico debe fallar")
  assert.ok(setPin("1234567890123").error, "13 dígitos debe fallar")
  assert.equal(setPin("123456").ok, true)
  assert.equal(pinIsSet(), true)
})

test("login: PIN incorrecto falla; correcto emite un token de sesión válido (256 bits)", () => {
  assert.ok(login("000000", "ip-a").error, "PIN incorrecto no debe loguear")
  const s = login("123456", "ip-a")
  assert.equal(s.ok, true)
  assert.match(s.token, /^[a-f0-9]{64}$/, "token = 32 bytes hex")
  assert.equal(validSession(s.token), true)
})

test("validSession: rechaza tokens mal formados o inexistentes", () => {
  assert.equal(validSession("bad"), false)
  assert.equal(validSession("a".repeat(64)), false, "64 hex pero inexistente")
  assert.equal(validSession(""), false)
  assert.equal(validSession(undefined), false)
})

test("logout: invalida ese token", () => {
  const s = login("123456", "ip-b")
  assert.equal(validSession(s.token), true)
  logout(s.token)
  assert.equal(validSession(s.token), false)
})

test("changePin: exige el PIN actual; después el viejo ya no loguea", () => {
  assert.ok(changePin("999999", "654321").error, "PIN actual incorrecto no cambia nada")
  assert.equal(changePin("123456", "654321").ok, true)
  assert.ok(login("123456", "ip-c").error, "el PIN viejo ya no sirve")
  assert.equal(login("654321", "ip-c").ok, true)
})

test("rate-limit: 5 intentos fallidos del mismo IP bloquean el 6º", () => {
  const ip = "ip-brute"
  for (let i = 0; i < 5; i++) assert.match(login("000000", ip).error, /incorrecto/i, `intento ${i + 1} = PIN incorrecto`)
  assert.match(login("000000", ip).error, /Demasiados|Esperá/i, "6º intento = rate-limited")
})

test("rate-limit REGRESIÓN: Map cebado > umbral NO desactiva el bloqueo, ni evapora bloqueos vigentes", () => {
  // cebar con IPs BLOQUEADAS (5 fallos c/u) por encima de RATE_MAP_MAX(20) → sobreviven a la poda y disparan el evict LRU
  for (let i = 0; i < 25; i++) { const p = "prime-" + i; for (let j = 0; j < 5; j++) login("000000", p) }
  // una IP NUEVA debe seguir bloqueándose al 6º (el rate-limiter sigue VIVO, no lo mató la poda) ← la regresión que metí y cerré
  const v = "fresh-victim"
  for (let j = 0; j < 5; j++) assert.match(login("000000", v).error, /incorrecto/i, `víctima intento ${j + 1}`)
  assert.match(login("000000", v).error, /Demasiados|Esperá/i, "el 6º sigue bloqueado tras cebar el Map (rate-limit vivo)")
  // y un atacante YA bloqueado no pierde su bloqueo por el evict (aunque mande el PIN correcto)
  assert.match(login("123456", "prime-0").error, /Demasiados|Esperá/i, "un IP bloqueado sigue bloqueado (el evict no evapora bloqueos)")
})

test("logoutAll: cierra TODAS las sesiones (celu perdido/robado)", () => {
  const a = login("654321", "ip-d"), b = login("654321", "ip-e")
  assert.ok(sessionCount() >= 2, "hay sesiones activas")
  logoutAll()
  assert.equal(sessionCount(), 0)
  assert.equal(validSession(a.token), false)
  assert.equal(validSession(b.token), false)
})
