/* Pixel Deity service worker — cache-first so the god works with no signal. */
const CACHE = 'pixeldeity-v14';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/util.js', './js/codec.js', './js/world.js', './js/sim.js',
  './js/render.js', './js/render3d.js', './js/society.js', './js/afterlife.js',
  './js/cosmos.js', './js/powers.js', './js/game.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (e.request.method === 'GET' && res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
