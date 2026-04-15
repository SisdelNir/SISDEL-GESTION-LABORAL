const CACHE_NAME = 'sisdel-panico-v1';
const ASSETS = [
    '/',
    '/vecino.html',
    '/agente.html',
    '/index.html',
    '/css/vecino.css',
    '/css/main.css',
    '/css/panel.css',
    '/js/vecino.js',
    '/js/panel.js',
    '/manifest.json'
];

// Instalar: cachear archivos estáticos
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', event => {
    // No cachear llamadas API
    if (event.request.url.includes('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
