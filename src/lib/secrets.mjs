// CIFRADO DE SECRETOS en reposo (AES-256-GCM). Los tokens de IA (llm-config.json) y las contraseñas IMAP (imap-accounts.json)
// se guardan cifrados. Transparente: `decSecret` devuelve el texto plano si NO está cifrado (compat con valores legacy).
// Clave maestra: env SECRETS_KEY (recomendado en prod) o ./data/.secret-key (en el VOLUMEN, 600). Va en el backup cifrado (necesaria
// para descifrar los BYOK al restaurar). Antes estaba en ./ (raíz) = capa de imagen → cada rebuild la regeneraba y los tokens BYOK
// cifrados quedaban INDESCIFRABLES en silencio ("la IA dejó de andar" sin pista). Ahora persiste en data/ y se migra la vieja si existe.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"
import { existsSync, readFileSync, writeFileSync, chmodSync } from "fs"

const KEYFILE = "./data/.secret-key"
const LEGACY_KEYFILE = "./.secret-key" // ubicación vieja (raíz) → migrar al volumen para no perder los tokens ya cifrados
const PREFIX = "enc:v1:"
let _key = null
function masterKey() {
  if (_key) return _key
  if (process.env.SECRETS_KEY) { _key = scryptSync(process.env.SECRETS_KEY, "commshub-secrets-v1", 32); return _key }
  if (existsSync(KEYFILE)) { _key = Buffer.from(readFileSync(KEYFILE, "utf8").trim(), "base64"); return _key }
  if (existsSync(LEGACY_KEYFILE)) { // migración: mover la clave vieja al volumen (misma clave → los BYOK cifrados siguen descifrándose)
    const k = readFileSync(LEGACY_KEYFILE, "utf8").trim()
    try { writeFileSync(KEYFILE, k, { mode: 0o600 }); chmodSync(KEYFILE, 0o600) } catch {} // {mode} en el write → sin ventana de 0644 entre write y chmod
    _key = Buffer.from(k, "base64"); return _key
  }
  _key = randomBytes(32); try { writeFileSync(KEYFILE, _key.toString("base64"), { mode: 0o600 }); chmodSync(KEYFILE, 0o600) } catch (e) { console.error("[secrets] no pude persistir .secret-key:", e.message) }
  return _key
}

export function isEncrypted(v) { return typeof v === "string" && v.startsWith(PREFIX) }
export function encSecret(plain) {
  if (plain == null || plain === "" || isEncrypted(plain)) return plain
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", masterKey(), iv)
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]), tag = c.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64")
}
export function decSecret(v) {
  if (v == null || v === "" || !isEncrypted(v)) return v // texto plano legacy → tal cual (compat)
  try {
    const raw = Buffer.from(String(v).slice(PREFIX.length), "base64")
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28)
    const d = createDecipheriv("aes-256-gcm", masterKey(), iv); d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8")
  } catch (e) {
    // dato CIFRADO que no se pudo descifrar = clave equivocada (típicamente un rebuild regeneró .secret-key) o dato corrupto —
    // NO es texto plano. Devolvemos "" (falla segura) pero logueamos fuerte: antes era silencioso e indiagnosticable.
    console.error("[secrets] ⚠️ no pude descifrar un secreto (¿cambió SECRETS_KEY/.secret-key tras un rebuild?):", e.message)
    return ""
  }
}
