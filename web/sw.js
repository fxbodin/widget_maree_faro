// Coquille de l'app disponible hors ligne (en mer). Les données sont gardées par app.js
// (localStorage) : tides.php n'est jamais mis en cache ici, pour ne pas masquer une panne.
// Incrémenter VERSION à chaque modification des fichiers listés.
const VERSION = 'maree-faro-v2';
const SHELL = ['./', 'index.html', 'app.js', 'app.css', 'manifest.webmanifest',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Coquille : cache d'abord (lancement instantané même sans réseau), mise à jour en arrière-plan.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/tides.php')) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
