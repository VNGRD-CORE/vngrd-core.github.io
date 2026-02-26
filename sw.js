const CACHE_NAME = 'vngrd-v1-cache';
const ASSETS = [
    'index.html',
    'manifest.json',
    'src/Compositor.js'
];

// 1. Install Event — Establish the core broadcast cache
self.addEventListener('install', (e) => {
    // Forces the service worker to activate immediately, ending any "zombie" lag
    self.skipWaiting(); 
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

// 2. Fetch Event — Network First with Cache Fallback
// This ensures that live updates to your indexbackup.html are reflected immediately
self.addEventListener('fetch', (e) => {
    // Skip non-HTTP(S) schemes — blob: and data: URLs must be handled by the browser
    if (!e.request.url.startsWith('http')) return;
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
