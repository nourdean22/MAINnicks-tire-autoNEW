/**
 * Service Worker — PWA offline support + push notifications.
 *
 * Strategies:
 * - Network-first for API calls (always try fresh data)
 * - Cache-first for static assets (fast load, update in background)
 * - Stale-while-revalidate for pages (show cached, fetch fresh)
 */

// Old caches are pruned in the activate handler.
//
// THIS CONSTANT IS NO LONGER LOAD-BEARING FOR CORRECTNESS, and that is the fix.
// It previously read "bump this on any structural change (new CSS/JS bundle
// hashes)" — a cache-invalidation scheme that depends on a human remembering.
// Nobody did: it sat at 2026-05-05 while bundle hashes rotated on every deploy.
//
// 2026-08-01, measured in prod: the admin rendered a BLANK PAGE. The SW served a
// cached index.html from an old build, whose hashed <script> tags 404'd because
// those files no longer existed. rootChars=0, buttons=0, no console error — a
// silent black screen with nothing to report.
//
// Navigations are now NETWORK-FIRST (see fetch), so the shell is always fresh and
// only ever requests hashes that exist. Hash rotation is harmless when the HTML
// is current; the entire failure mode required a stale shell.
const CACHE_NAME = "nicks-v3-network-first-shell";
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

  // Static assets — cache first. Safe BECAUSE the filenames are content-hashed:
  // a given hash is immutable, so a cache hit can never be stale. Only `ok`
  // responses are cached — a 404 or a 5xx must never be stored, or one bad
  // deploy moment gets frozen into the cache and served forever.
  if (url.pathname.match(/\.(js|css|png|jpg|webp|svg|woff2|ico)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) =>
        cached || fetch(event.request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
      )
    );
    return;
  }

  // Navigations / pages — NETWORK FIRST. This is the fix.
  //
  // Was stale-while-revalidate (`return cached || fetching`), which hands back
  // the CACHED index.html immediately and only refreshes the cache for NEXT
  // time. On a SPA that means: old shell now, referencing bundle hashes that
  // were deleted by the latest deploy -> every <script> 404s -> blank page. The
  // revalidate "fixes" a load the user already lost, and they see black.
  //
  // Network-first costs one round trip and removes the entire failure class:
  // the shell is always current, so it only ever asks for hashes that exist.
  // The cache is retained purely as an OFFLINE fallback, which is what a PWA
  // actually needs it for.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      // Offline (or the request genuinely failed) — fall back to the cached
      // shell, then to the cached root so a deep link still opens the app.
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("/"))
      )
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
