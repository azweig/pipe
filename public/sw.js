// Service Worker de pipe: (1) cache del app-shell → cargas rápidas + offline, (2) Web Push rico (badge, foto, acciones, re-suscripción).
const CACHE = "pipe-shell-v50"
const SHELL = ["/", "/index.html", "/app.js", "/i18n.js", "/manifest.json", "/icon-192.png", "/icon-512.png"]

self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))) })
self.addEventListener("activate", (e) => { e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()) })

// SOLO cachea el shell estático same-origin (GET). NUNCA /api, /avatars, /cas, /media, /.well-known → datos sensibles/detrás del PIN.
self.addEventListener("fetch", (e) => {
  const req = e.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (/^\/(api|avatars|cas|media)(\/|$)/.test(url.pathname) || url.pathname.startsWith("/.well-known")) return
  const isShell = url.pathname === "/" || /\.(html|js|css|png|svg|ico)$/.test(url.pathname) || url.pathname === "/manifest.json"
  if (!isShell) return
  e.respondWith((async () => {
    try {
      const net = await fetch(req)
      if (net && net.ok) { const c = await caches.open(CACHE); c.put(req, net.clone()).catch(() => {}) }
      return net
    } catch {
      return (await caches.match(req)) || (await caches.match("/index.html")) || Response.error()
    }
  })())
})

const jpost = (url, obj) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(obj) }).catch(() => {})

self.addEventListener("push", (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data && e.data.text() } }
  e.waitUntil((async () => {
    // badge de no-leídos en el ícono de la app
    if (typeof d.badge === "number" && self.navigator && "setAppBadge" in self.navigator) {
      try { d.badge > 0 ? await self.navigator.setAppBadge(d.badge) : await self.navigator.clearAppBadge() } catch {}
    }
    const isMsg = (d.tag || "").startsWith("msg:")
    // avisar a las ventanas abiertas para que refresquen (AJAX, sin reload) → ves lo nuevo al instante
    const cls = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    cls.forEach((c) => { try { c.postMessage({ type: "refresh" }) } catch {} })
    // no molestar con la NOTIFICACIÓN de mensajes si la app está abierta y visible (ya los ves, y ya refrescó)
    if (isMsg && cls.some((c) => c.visibilityState === "visible")) return
    const actions = isMsg
      ? [{ action: "reply", title: "Responder", type: "text", placeholder: "Escribí una respuesta…" }, { action: "read", title: "Marcar visto" }]
      : (d.actions || [])
    return self.registration.showNotification(d.title || "pipe", {
      body: d.body || "",
      icon: d.icon || "/icon-192.png",
      badge: "/icon-192.png",
      image: d.image || undefined,
      tag: d.tag || undefined,
      renotify: !!d.tag,
      timestamp: d.timestamp || undefined,
      vibrate: isMsg ? [80, 40, 80] : [120, 60, 120],
      silent: false,
      actions,
      data: { url: d.url || "/", thread: d.thread || "" },
    })
  })())
})

self.addEventListener("notificationclick", (e) => {
  const data = e.notification.data || {}
  e.notification.close()
  e.waitUntil((async () => {
    // responder INLINE desde la notificación (Android) → manda el mensaje sin abrir la app
    if (e.action === "reply" && e.reply && data.thread) { await jpost("/api/send", { key: data.thread, text: e.reply }); return }
    // marcar visto
    if (e.action === "read" && data.thread) {
      await jpost("/api/thread/seen", { key: data.thread, ts: Date.now() })
      if (self.navigator && "clearAppBadge" in self.navigator) { try { await self.navigator.clearAppBadge() } catch {} }
      return
    }
    // click normal → abrir/enfocar la conversación
    const url = data.url || "/"
    const cl = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    for (const c of cl) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus() }
    return self.clients.openWindow(url)
  })())
})

// las suscripciones push EXPIRAN solas → re-suscribir automáticamente para que las notificaciones no se caigan en silencio
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    try {
      const r = await fetch("/api/push/vapid", { credentials: "same-origin" }).then((x) => x.json())
      if (!r || !r.publicKey) return
      const key = Uint8Array.from(atob(r.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await jpost("/api/push/subscribe", sub.toJSON())
    } catch {}
  })())
})
