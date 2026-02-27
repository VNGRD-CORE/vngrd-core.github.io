const CACHE_NAME = 'vngrd-v3-cache';
const ASSETS = [
    'index.html',
    'manifest.json',
    'src/Compositor.js'
];

// 1. Install Event — Establish the core broadcast cache
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

// 2. Activate Event — Purge old caches to force fresh code
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

// 3. Fetch Event — Network First with Cache Fallback (same-origin only)
// External APIs (Pollinations, Binance, Alchemy, etc.) pass through untouched.
self.addEventListener('fetch', (e) => {
    if (!e.request.url.startsWith('http')) return;

    // Only cache same-origin requests — never intercept external APIs
    var url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;

    e.respondWith(
        fetch(e.request)
            .then(function(r) { return r; })
            .catch(function() {
                return caches.match(e.request).then(function(cached) {
                    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
                });
            })
    );
});
