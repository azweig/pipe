// Gate HTTP (hallazgo #5): la lógica de auth ambiental / CSRF / DNS-rebinding / rate-limit-key es la más crítica del server
// y no tenía cobertura. Extraída a src/lib/http-gate.mjs (puras) y anclada acá con los escenarios de ataque reales.
import { test } from "node:test"
import assert from "node:assert/strict"
import { localFlags, clientIpFrom, csrfReason, hostAllowed } from "../src/lib/http-gate.mjs"

test("isLocal: túnel SSH (127.0.0.1, sin XFF, host localhost) = confiable", () => {
  const f = localFlags({ host: "localhost:3000", xff: "", remoteAddress: "127.0.0.1" })
  assert.equal(f.isLocal, true)
  assert.equal(f.viaProxy, false)
})

test("isLocal: remoto vía Caddy (con XFF) NO es local aunque remoteAddress sea 127", () => {
  const f = localFlags({ host: "hub.example.com", xff: "203.0.113.7", remoteAddress: "127.0.0.1" })
  assert.equal(f.isLocal, false, "detrás de proxy remoteAddress SIEMPRE es local → el XFF es lo que delata al remoto")
})

test("DNS-rebinding: Host evil.com resolviendo a 127.0.0.1 NO gana isLocal", () => {
  const f = localFlags({ host: "evil.com", xff: "", remoteAddress: "127.0.0.1" })
  assert.equal(f.isLocal, false, "el host no es localhost/127 → pide PIN (cierra rebinding)")
})

test("isLocal acepta IPv6 loopback mapeado ::ffff:127.x", () => {
  assert.equal(localFlags({ host: "127.0.0.1", xff: "", remoteAddress: "::ffff:127.0.0.1" }).isLocal, true)
  assert.equal(localFlags({ host: "[::1]", xff: "", remoteAddress: "::1" }).isLocal, true)
})

test("clientIp toma el ÚLTIMO valor del XFF (Caddy anexa el IP real; el cliente spoofea los del principio)", () => {
  assert.equal(clientIpFrom({ xff: "1.1.1.1, 2.2.2.2, 203.0.113.7", remoteAddress: "127.0.0.1" }), "203.0.113.7")
  assert.equal(clientIpFrom({ xff: "", remoteAddress: "10.0.0.5" }), "10.0.0.5", "sin XFF cae al remoteAddress")
})

test("CSRF: request cross-site a /api/ se bloquea; same-origin y none pasan", () => {
  assert.equal(csrfReason({ path: "/api/threads", secFetchSite: "cross-site", host: "h" }), "solicitud cross-site bloqueada")
  assert.equal(csrfReason({ path: "/api/threads", secFetchSite: "same-origin", host: "h" }), null)
  assert.equal(csrfReason({ path: "/api/threads", secFetchSite: "none", host: "h" }), null)
  assert.equal(csrfReason({ path: "/api/threads", host: "h" }), null, "curl/no-browser (sin Sec-Fetch) pasa: sin browser no hay CSRF")
})

test("CSRF: Origin de otro host se bloquea aunque Sec-Fetch falte", () => {
  assert.equal(csrfReason({ path: "/api/send", origin: "https://evil.com", host: "hub.example.com" }), "origen cruzado bloqueado (CSRF)")
  assert.equal(csrfReason({ path: "/api/send", origin: "https://hub.example.com", host: "hub.example.com" }), null)
})

test("CSRF: un GET cross-site TAMBIÉN se bloquea (hay GETs con efecto: ask/tts queman tokens, matrix-link spawnea)", () => {
  // el gate NO mira el método a propósito → un <img src=.../api/tts> cross-site debe caer igual que un POST
  assert.equal(csrfReason({ path: "/api/tts", secFetchSite: "cross-site", host: "hub.example.com" }), "solicitud cross-site bloqueada")
  assert.equal(csrfReason({ path: "/api/ask", origin: "https://evil.com", host: "hub.example.com" }), "origen cruzado bloqueado (CSRF)")
})

test("CSRF: status y health quedan EXENTOS (lectura pura, monitoreo)", () => {
  assert.equal(csrfReason({ path: "/api/auth/status", secFetchSite: "cross-site", host: "h" }), null)
  assert.equal(csrfReason({ path: "/api/health", secFetchSite: "cross-site", host: "h" }), null)
})

test("hostAllowed: sin TRUSTED_HOSTS todo pasa (self-host); con lista solo los declarados + localhost", () => {
  assert.equal(hostAllowed({ host: "cualquiera.com", trustedHosts: "" }), true)
  assert.equal(hostAllowed({ host: "hub.example.com", trustedHosts: "hub.example.com, otro.com" }), true)
  assert.equal(hostAllowed({ host: "evil.com", trustedHosts: "hub.example.com" }), false)
  assert.equal(hostAllowed({ host: "localhost:3000", trustedHosts: "hub.example.com" }), true, "localhost siempre (túnel)")
})
