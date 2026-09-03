// Service worker do XibataPaterna.
// Estratégia: cache-first para o casco do app, rede-primeiro para a API.
const CACHE = 'xibata-v1';
const SHELL = [
  '/',
  '/index.html',
  '/carteirinha.html',
  '/styles.css',
  '/app.js',
  '/carteirinha.js',
  '/manifest.webmanifest',
  '/manifest-carteirinha.webmanifest',
  '/icons/icon.svg',
  '/icons/carteirinha.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A API nunca é servida do cache: os dados precisam estar frescos.
  if (url.pathname.startsWith('/api/')) return;

  // Navegações caem no casco correspondente quando não há rede.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(url.pathname.startsWith('/c/') ? '/carteirinha.html' : '/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
