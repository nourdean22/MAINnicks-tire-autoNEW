/**
 * Service Worker — PWA offline support + push notifications.
 *
 * Strategies:
 * - Network-first for API calls (always try fresh data)
 * - Cache-first for static assets (fast load, update in background)
 * - Stale-while-revalidate for pages (show cached, fetch fresh)
 */

const CACHE_NAME = "nicks-v1";
const STATIC_ASSETS = [
  "/",
  "/tires",
  "/estimate",
  "/pay",
  "/services",
  "/contact",
  "/manifest.json",
];

// Install — pre-cache critical pages
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — smart routing
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // API calls — network first, no cache
  if (url.pathname.startsWith("/api/")) return;

  // Static assets — cache first
  if (url.pathname.match(/\.(js|css|png|jpg|webp|svg|woff2|ico)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
      )
    );
    return;
  }

  // Pages — stale while revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetching = fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);

      return cached || fetching;
    })
  );
});

// Push notifications
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Nick's Tire & Auto";
  const options = {
    body: data.body || "You have a new notification",
    icon: "/icon-192x192.png",
    badge: "/favicon-32x32.png",
    tag: data.tag || "default",
    data: { url: data.url || "/" },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — open the relevant page
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
