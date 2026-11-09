// Service worker : met toute l'appli en cache (polices comprises) pour un usage hors ligne.
// Réseau d'abord : en ligne, on récupère toujours la dernière version ; hors ligne, on sert le cache.
const CACHE = 'portee-v14';
const ASSETS = ['./', 'index.html', 'css/style.css', 'css/fonts.css', 'js/main.js', 'js/chords.js', 'js/theory.js', 'js/staff.js',
  'js/keyboard.js', 'js/audio.js', 'js/midi.js', 'js/store.js', 'icon.svg', 'manifest.webmanifest',
  'fonts/Fraunces-latin-1.woff2', 'fonts/Fraunces-latin-ext-0.woff2', 'fonts/Inter-latin-3.woff2', 'fonts/Inter-latin-ext-2.woff2', 'fonts/NotoMusic-music-4.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // cache: 'no-cache' : on revalide toujours auprès du serveur, sinon le cache HTTP du navigateur
  // (10 min sur GitHub Pages) servirait une ancienne version après une mise à jour.
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
