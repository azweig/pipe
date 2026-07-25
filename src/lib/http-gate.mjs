// Gate de autenticación/CSRF/DNS-rebinding — EXTRAÍDO de server.mjs sin cambiar comportamiento (mismas expresiones exactas),
// para poder testearlo (hallazgo #5: 126/128 rutas sin cobertura → la lógica de seguridad más crítica no tenía red).
// Puro: recibe campos del request (host, xff, remoteAddress, secFetchSite, origin, path) → decisiones. NO toca I/O ni estado.

// Local (túnel SSH: conexión directa a 127.0.0.1 SIN X-Forwarded-For) = confiable → sin PIN.
// Remoto (vía Caddy: llega como 127.0.0.1 PERO con X-Forwarded-For) = requiere PIN.
// isLocal exige ADEMÁS que el Host sea localhost/127 → cierra DNS-rebinding (evil.com→127.0.0.1).
export function localFlags({ host = "", xff = "", remoteAddress = "" } = {}) {
  const viaProxy = !!xff
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host || "")
  const isLocal = !viaProxy && localHost && /^(127\.|::1|::ffff:127\.)/.test(remoteAddress || "")
  return { viaProxy, localHost, isLocal }
}

// IP real del cliente para rate-limit: Caddy ANEXA el IP verdadero al FINAL del XFF (el cliente solo spoofea los del principio) → tomar el último.
export function clientIpFrom({ xff = "", remoteAddress = "" } = {}) {
  const parts = String(xff || "").split(",").map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : (remoteAddress || "?")
}

// CSRF / drive-by: aplica a TODO /api salvo status/health (lectura pura). Cross-site (Sec-Fetch-Site≠same-origin/none) u Origin≠Host → bloquea.
// A PROPÓSITO no mira el método: hay GETs con efecto (ask/tts queman tokens, matrix-link spawnea un proceso) → también deben gatearse.
export function csrfReason({ path = "", secFetchSite = "", origin = "", host = "" } = {}) {
  if (!path.startsWith("/api/") || path === "/api/auth/status" || path === "/api/health") return null
  const sfs = secFetchSite
  if (sfs && sfs !== "same-origin" && sfs !== "none") return "solicitud cross-site bloqueada"
  if (origin) { let oh = ""; try { oh = new URL(origin).host } catch {} ; if (oh && oh !== host) return "origen cruzado bloqueado (CSRF)" }
  return null
}

// Host allowlist (anti DNS-rebinding). Solo activa si TRUSTED_HOSTS está seteado. localhost/127 siempre pasan (túnel).
export function hostAllowed({ host = "", trustedHosts = "" } = {}) {
  if (!trustedHosts) return true
  const hostname = String(host || "").split(":")[0].toLowerCase()
  if (hostname === "localhost" || hostname === "127.0.0.1") return true
  return trustedHosts.split(",").map((s) => s.trim().toLowerCase()).some((h) => h === hostname)
}
