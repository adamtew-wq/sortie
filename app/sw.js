// Sortie service worker. Bumps SHELL_CACHE on every shell change so old
// clients flush stale assets on activate. Static shell = cache-first;
// GitHub API = network-first so logged data stays fresh.

const SHELL_CACHE = 'sortie-shell-v4';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './app.js',
  './ui/state.js',
  './engine/index.js',
  './icons/icon.svg',
  '../framework/exercise-library.json',
  '../framework/session-templates.json',
  '../framework/session-schema.json',
  '../framework/rehab-protocols.json',
  '../data/equipment.json',
  '../data/baselines.json',
  '../data/attributes.json',
  '../data/events.json',
  '../data/niggles.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('sortie-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.hostname === 'api.github.com') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
