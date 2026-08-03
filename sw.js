/* Pixel Deity service worker — cache-first so the god works with no signal. */
const CACHE = 'pixeldeity-v27';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/util.js', './js/codec.js', './js/world.js',
  // earthdata.js and earth.js were added two releases ago and never listed
  // here. Nothing broke loudly: the game simply booted a GENERATED world
  // offline instead of Earth, and said nothing about it. Precaching an asset
  // is not an optimisation when the app degrades silently without it.
  './js/earthdata.js', './js/earth.js',
  // the past: historydata.js is FETCHED at build time, history.js is the
  // records. Both must be here or the dial silently loses the past offline.
  './js/historydata.js', './js/history.js',
  './js/sim.js',
  './js/render.js', './js/tiles.js', './js/lod.js', './js/buildings.js', './js/render3d.js',
  './js/society.js', './js/afterlife.js',
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
