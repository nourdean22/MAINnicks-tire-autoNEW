// NOUR OS Service Worker v10 — Push Notifications + SAFE static-asset caching
//
// truth-substrate audit P1 (#15). This SW is now actually REGISTERED (see
// components/hud/sw-register.tsx). Two problems from the dead-code era are fixed:
//   1. Precaching retired routes (/command, /tasks) 404-rejected cache.addAll and
//      would fail install. Removed — nothing authed is precached at all.
//   2. The fetch handler cached EVERY non-API GET, including authed HTML shells,
//      unbounded + with no build-stamped invalidation (stale-shell + private-data
//      persistence risk). Now it caches ONLY immutable, content-hashed static
//      assets (/_next/static/ + hashed asset files). Those are safe to cache
//      forever (their filenames change per build), so there is no stale-shell risk
//      and no private HTML is ever written to Cache Storage. Navigations are
//      network-first with an inline offline fallback; nothing HTML/API is cached.
const CACHE_NAME = 'nour-os-v10';

// ── INSTALL ── (no precache — offline fallback is generated inline below)
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ── ACTIVATE ── purge every prior cache version.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// ── FETCH ──
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.includes('/api/')) return;

  // Cache-first for IMMUTABLE static assets only. Next.js content-hashes
  // /_next/static/ filenames, so a cached entry can never be stale, and no
  // authed HTML is ever stored.
  const isImmutableStatic =
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/.test(url.pathname);

  if (isImmutableStatic) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigations: network-first, inline offline fallback. NOT cached (never
  // persist an authed shell). Everything else falls through to the browser.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<html><body style="background:#050505;color:#c8c8c8;font-family:system-ui;text-align:center;padding:40px"><h1 style="color:#FDB913">NOUR OS</h1><p>Offline. Reconnect to sync.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          )
      )
    );
  }
});

// ── PUSH NOTIFICATIONS ──
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'NOUR OS', body: event.data.text() };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || 'nour-os',
    // audit #15: default click target was the retired /command route. Home now.
    data: data.data || { url: '/' },
    vibrate: data.vibrate || undefined,
    silent: data.silent || false,
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
    timestamp: Date.now(),
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'NOUR OS', options)
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // audit #15: default was the retired /command route. Home now.
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open for this app, focus + navigate. Match
      // bdnick.info (prod) OR localhost (dev) so the click works in both.
      for (const client of windowClients) {
        const sameApp =
          client.url.includes('bdnick.info') ||
          client.url.includes('localhost') ||
          client.url.includes('127.0.0.1');
        if (sameApp && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// ── NOTIFICATION CLOSE (analytics hook — no-op today) ──
self.addEventListener('notificationclose', () => {});
