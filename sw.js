/* ============================================================
   Tracktify — service worker
   Makes the app installable + usable offline. Strategy:
   - same-origin GETs (the app shell): NETWORK-FIRST so you always get the
     latest when online, with a cached fallback when offline.
   - /api/* and cross-origin: left to the network (never cached — auth'd /
     dynamic). The app's own data lives in localStorage via core.js.
   Bump CACHE on a breaking change to evict old assets.
   ============================================================ */
const CACHE = 'tracktify-v2';
const SHELL = [
  '/', 'index.html', 'env.js', 'core.js', 'auth.js', 'script.js',
  'expenses.js', 'events.js', 'habits.js', 'water.js', 'workouts.js',
  'sleep.js', 'calories.js', 'custom.js', 'dashboard.js',
  'styles.css', 'favicon.svg', 'icon.svg', 'manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  // allSettled → one missing file can't abort the whole install.
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return Promise.allSettled(SHELL.map(function (u) { return c.add(u); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  const url = new URL(req.url);
  // Only handle same-origin GETs; never intercept the API.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;

  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) {
          // Offline navigations fall back to the cached app shell.
          return cached || (req.mode === 'navigate' ? caches.match('/index.html') : undefined);
        });
      })
  );
});
