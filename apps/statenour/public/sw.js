// NOUR OS Service Worker v9.0 — Offline Support + Push Notifications
// v9 Apr 17: dropped /admin + /m (dead routes after separation pass),
// added /journal + /system/health which are load-bearing now.
const CACHE_NAME = 'nour-os-v9';
const OFFLINE_URLS = [
  '/',
  '/command',
  '/chat',
  '/tasks',
  '/journal',
  '/system/health',
  '/settings',
];

// ── INSTALL ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS.map(url => new Request(url, { cache: 'reload' })));
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    })
  );
  self.clients.claim();
});

// ── FETCH (offline support) ──
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return new Response(
              '<html><body style="background:#050505;color:#c8c8c8;font-family:system-ui;text-align:center;padding:40px"><h1 style="color:#FDB913">NOUR OS</h1><p>Offline. Reconnect to sync.</p></body></html>',
              { headers: { 'Content-Type': 'text/html' } }
            );
          }
        });
      })
  );
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
    data: data.data || { url: '/command' },
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

  const url = event.notification.data?.url || '/command';
  const action = event.action;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open for this app, focus + navigate.
      // Match autonicks.com (prod) OR localhost (dev) so the PWA click
      // works in both environments.
      for (const client of windowClients) {
        const sameApp =
          client.url.includes('autonicks.com') ||
          client.url.includes('localhost') ||
          client.url.includes('127.0.0.1');
        if (sameApp && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});

// ── NOTIFICATION CLOSE (analytics) ──
self.addEventListener('notificationclose', (event) => {
  // Could track dismissed notifications for analytics
  const data = event.notification.data;
  if (data?.level === 'critical') {
    // Critical notifications that are dismissed without action = concerning
    // Could send this to the brain for pattern tracking
  }
});
