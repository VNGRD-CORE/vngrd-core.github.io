const CACHE_NAME = 'vngrd-v4-cache';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './sw.js',
    './src/app.js',
    './src/Compositor.js',
    './src/RecorderWorker.js',
    './src/synesthesia-voice-engine.js',
    './src/css/main.css',
    './src/js/main.js',
    './src/js/vj-engine.js',
    './src/js/vb-shader.js',
    './src/js/vb-timers.js',
    './src/js/audio-rotation.js',
    './src/js/gesture.js',
    './src/js/logo-3d.js',
    './src/js/speech-engine.js',
    './src/modules/ai-generator.js',
    './src/modules/audio-chain.js',
    './src/modules/audio-synth.js',
    './src/modules/camera.js',
    './src/modules/ghost.js',
    './src/modules/gif-decoder.js',
    './src/modules/liquid-library.js',
    './src/modules/main-loop.js',
    './src/modules/media-controls.js',
    './src/modules/media-loader.js',
    './src/modules/media-strip.js',
    './src/modules/mic-ducking.js',
    './src/modules/mixer-card.js',
    './src/modules/mpc-drum-machine.js',
    './src/modules/nft-recording.js',
    './src/modules/render-loop.js',
    './src/modules/slicer-card.js',
    './src/modules/sonic-suite.js',
    './src/modules/summoner.js',
    './src/modules/tb303-bassline.js',
    './src/modules/ticker.js',
    './src/modules/token-gate.js',
    './src/modules/trinity-input.js',
    './src/modules/ui-utils.js',
    './src/modules/vfx-layer.js',
    './src/modules/wallet.js',
    './src/modules/workspace.js',
    './src/modules/xy-pad.js',
    './src/modules/weather.js',
    './src/kinetic-rack/KineticRack.js',
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
