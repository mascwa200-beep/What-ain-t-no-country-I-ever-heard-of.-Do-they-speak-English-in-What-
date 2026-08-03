// Real satellite imagery, streamed, with somewhere to fall back to.
//
// The ground is currently one 1440x960 texture for the whole planet — about
// 27 km per pixel — so the buildings the last change put on it are standing on
// a smooth colour gradient. This fetches what the Earth actually looked like.
//
// ---------------------------------------------------------------------------
// WHY EPSG:4326 AND NOT WEB MERCATOR
//
// GIBS serves both. The Mercator set is the one everybody uses, and it would
// have meant reprojecting every tile onto the quadtree's lon/lat patches.
//
// The geographic set does not: its tile matrix is 2^(z+1) x 2^z tiles over
// 360x180 degrees, which is EXACTLY the quadtree's own structure — two roots
// of 180x180 degrees, level L holding 2^(L+1) x 2^L patches. A patch at
// (level, col, row) is a tile at (z, col, row). No reprojection, no seams, no
// resampling. Checked before designing around the alternative.
//
// Every layer bottoms out somewhere — 306 m/px for Blue Marble, 153 m for the
// daily mosaic — and the quadtree goes past level 14 on the ground. So below
// the archive's floor the ancestor tile is stretched, and imagery answers WHAT
// IS HERE while the procedural bake answers WHAT IT LOOKS LIKE AT ONE METRE.
// That split is the honest ceiling of this data, not a shortcoming of the code.
// ---------------------------------------------------------------------------
//
// THIS ENDS THE OFFLINE GUARANTEE, knowingly. So offline is not an error path
// here, it is a supported mode that must look deliberate: every request either
// returns imagery, returns an ancestor's imagery with a UV sub-rectangle, or
// returns nothing and lets the procedural bake show through. There is no
// fourth outcome, and in particular there is no blank tile.
//
// Every side effect is injected — the image loader, the persistent store, the
// clock — so this whole file runs under Node with no network at all, which is
// the only way the failure paths can be tested rather than hoped about.
(function (global) {
  'use strict';
  const PD = global.PD;

  const HOST = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';
  const TILE_PX = 512;

  // -------------------------------------------------------------------------
  // TWO LAYERS, AND WHY THE DEFAULT IS THE CLOUD-FREE ONE
  //
  // The game simulates its own weather — a cloud deck, rain, snow settling on
  // the ground, cloud shadow cast onto the terrain. The daily satellite mosaic
  // has REAL clouds baked into the pixels, so using it as the ground means two
  // unrelated cloud systems on screen at once, one of which cannot move, cannot
  // rain, and does not match the season the sim thinks it is.
  //
  // Asked whose clouds should win, the answer was the game's own. So the ground
  // is Blue Marble: cloud-free, and therefore also swath-gap-free and
  // missing-day-free. Measured against the daily layer:
  //
  //   layer                 levels  m/px at the floor   KB/tile   date in URL
  //   BlueMarble (default)  0..7    306                 ~5-7      no
  //   VIIRS daily           0..8    153                 ~80       yes
  //
  // Blue Marble is 306 m/px against the 27 km/px of the single global bake this
  // replaces — 88x the ground resolution — and being untimed it works at EVERY
  // sim date, including prehistory and the year 40,000 where the daily layer
  // has nothing at all.
  //
  // The daily layer stays selectable rather than becoming dead code. This
  // project has now found six mechanics that were fully implemented and never
  // fired; `dateFor` and its whole clamp-to-yesterday apparatus would have been
  // the seventh.
  const LAYERS = {
    base: {
      key: 'base',
      id: 'BlueMarble_ShadedRelief_Bathymetry',
      matrix: '500m',
      maxZ: 7,                 // measured: 8 is a 400
      ext: 'jpg',
      temporal: false,
      label: 'Blue Marble',
      credit: 'NASA Earth Observatory (Blue Marble Next Generation)'
    },
    daily: {
      key: 'daily',
      id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
      matrix: '250m',
      maxZ: 8,                 // measured: 9 is a 400
      ext: 'jpg',
      temporal: true,
      label: 'Daily true colour',
      credit: 'NASA EOSDIS GIBS / VIIRS (Suomi NPP)'
    }
  };
  const DEFAULT_LAYER = 'base';
  function layerOf(name) {
    if (name && typeof name === 'object' && name.id) return name;
    return LAYERS[name] || LAYERS[DEFAULT_LAYER];
  }
  const MAX_Z = LAYERS[DEFAULT_LAYER].maxZ;

  // GIBS holds one image per day and 404s on anything in the future. The sim
  // clock can be anywhere, including the year 40,000, so the requested date is
  // always clamped to the last day that can exist.
  const FIRST_DAY = Date.UTC(2015, 10, 24) / 1000;   // VIIRS true colour begins

  function isoDay(unixSec) {
    const d = new Date(unixSec * 1000);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  // The date this world's clock should ask the satellite for. Outside the
  // satellite era there is no imagery to ask for, and saying so is better than
  // requesting a tile that will 404 forever.
  function dateFor(unixSec, nowSec) {
    const today = (nowSec == null ? Date.now() / 1000 : nowSec);
    // yesterday: today's mosaic is often still being assembled
    const latest = today - 86400;
    if (unixSec == null || !isFinite(unixSec)) return isoDay(latest);
    if (unixSec < FIRST_DAY) return null;          // before the satellites
    return isoDay(Math.min(unixSec, latest));
  }

  // What date string this layer should be asked for at this sim moment. An
  // untimed layer answers 'default' at every moment there has ever been, which
  // is exactly why it is the one that boots.
  function dateForLayer(layerName, unixSec, nowSec) {
    const L = layerOf(layerName);
    return L.temporal ? dateFor(unixSec, nowSec) : STATIC_DATE;
  }
  const STATIC_DATE = 'default';

  // GIBS REST is /{layer}/{style}/[{time}/]{matrixSet}/{z}/{row}/{col}.{ext} —
  // the time segment is present only for a temporal layer, and including it for
  // an untimed one is a 400 rather than a redirect.
  function url(z, x, y, date, layerName) {
    const L = layerOf(layerName);
    const when = L.temporal ? (date || STATIC_DATE) + '/' : '';
    return HOST + '/' + L.id + '/default/' + when + L.matrix +
      '/' + z + '/' + y + '/' + x + '.' + L.ext;
  }

  // A quadtree patch is a tile. This is the whole reason for choosing the
  // geographic matrix set.
  //
  // Below the archive's deepest level the patch is SMALLER than any tile that
  // exists, so the answer is a tile plus the sub-rectangle of it that the patch
  // occupies. Returning only the clamped index — which is what this did when it
  // shipped — stretches a whole level-7 tile across a level-14 patch, imagery
  // 128x too zoomed out in each axis. That renders as "the satellite picture is
  // wrong" and is very hard to trace back to an index clamp, so the rectangle
  // is part of the answer rather than something the caller must remember.
  function tileFor(level, lon0, lat0, layerName) {
    const maxZ = layerOf(layerName).maxZ;
    const lvl = Math.max(0, Math.floor(level));
    const n = 1 << lvl;                            // rows at the WANTED level
    let x = Math.floor(((lon0 + Math.PI) / (Math.PI * 2)) * (2 * n));
    let y = Math.floor(((Math.PI / 2 - lat0) / Math.PI) * n);
    x = ((x % (2 * n)) + 2 * n) % (2 * n);
    y = PD.clamp(y, 0, n - 1);
    // walk down to the deepest level that can exist, accumulating where the
    // patch sits inside each successively coarser tile
    let u0 = 0, v0 = 0, span = 1;
    for (let z = lvl; z > maxZ; z--) {
      u0 = (u0 + (x & 1)) / 2; v0 = (v0 + (y & 1)) / 2; span /= 2;
      x >>= 1; y >>= 1;
    }
    return { z: Math.min(lvl, maxZ), x, y, u0, v0, span };
  }

  const key = (lid, z, x, y, date) => lid + '/' + z + '/' + x + '/' + y + '/' + date;

  function create(opts) {
    opts = opts || {};
    const o = {
      // (url, onDone(imageOrNull, status)) -> cancel(). Injected so the
      // failure paths are reachable from a test.
      load: opts.load || defaultLoad,
      store: opts.store || null,       // { get(k), put(k, v) } — IndexedDB in the browser
      now: opts.now || (() => Date.now() / 1000),
      maxLive: opts.maxLive || 320,    // tiles held in memory
      maxInFlight: opts.maxInFlight || 6,
      maxRetries: opts.maxRetries == null ? 3 : opts.maxRetries,
      layer: opts.layer || DEFAULT_LAYER
    };
    // The date is part of the cache key, and an untimed layer has no date. Two
    // sim moments would otherwise mint two cache entries for one identical URL.
    function norm(L, date) { return L.temporal ? date : STATIC_DATE; }

    const live = new Map();            // key -> { img, at }  (LRU by `at`)
    const missing = new Set();         // 404s: never ask again
    const failed = new Map();          // key -> attempts (network errors: do ask again)
    const pending = new Map();         // key -> { cancel, want }
    const queue = [];                  // [{ key, z, x, y, date, pri }]
    let inFlight = 0, seq = 0;
    const stats = { hit: 0, miss: 0, fetched: 0, notFound: 0, errored: 0,
                    evicted: 0, fromStore: 0, cancelled: 0 };

    function touch(k, rec) { rec.at = ++seq; return rec; }

    function evict() {
      while (live.size > o.maxLive) {
        let oldestK = null, oldestAt = Infinity;
        for (const [k, rec] of live) if (rec.at < oldestAt) { oldestAt = rec.at; oldestK = k; }
        if (oldestK == null) break;
        live.delete(oldestK); stats.evicted++;
      }
    }

    // What to draw for this patch, right now, without waiting for anything.
    //
    // Returns { img, uv: [u0, v0, du, dv] } — the UV rectangle is what makes
    // an ancestor usable: a level-8 tile covers its level-11 descendant
    // exactly, at a known sub-rectangle, so the fallback needs no branch in
    // the shader. Returns null only when there is no ancestor either, and the
    // caller then shows the procedural bake.
    function get(level, lon0, lat0, date, opt) {
      const L = layerOf((opt && opt.layer) || o.layer);
      const d = norm(L, date);
      if (!d) return null;                          // outside the satellite era
      const t = tileFor(level, lon0, lat0, L);
      // t.u0/v0/span is already the sub-rectangle for everything BELOW the
      // archive's floor. The exact tile is therefore not always uv [0,0,1,1] —
      // on the ground it is a sliver of one, and starting the walk from zero
      // here is precisely the defect this replaces.
      let x = t.x, y = t.y, u0 = t.u0, v0 = t.v0, span = t.span;
      const want = key(L.key, t.z, x, y, d);
      const rec = live.get(want);
      if (rec) { stats.hit++; touch(want, rec); return { img: rec.img, uv: [u0, v0, span, span], z: t.z, layer: L.key }; }
      stats.miss++;
      if (!(opt && opt.noFetch)) request(t.z, x, y, d, (opt && opt.pri) || 0, L);

      // Walk up. Each level up halves the sub-rectangle and doubles the scale.
      for (let z = t.z - 1; z >= 0; z--) {
        u0 = (u0 + (x & 1)) / 2; v0 = (v0 + (y & 1)) / 2; span /= 2;
        x >>= 1; y >>= 1;
        const ak = key(L.key, z, x, y, d);
        const anc = live.get(ak);
        if (anc) { touch(ak, anc); return { img: anc.img, uv: [u0, v0, span, span], z, layer: L.key }; }
      }
      return null;                                   // nothing yet: procedural
    }

    function request(z, x, y, date, pri, layerName) {
      const L = layerOf(layerName == null ? o.layer : layerName);
      date = norm(L, date);
      if (!date) return;
      const k = key(L.key, z, x, y, date);
      if (live.has(k) || pending.has(k) || missing.has(k)) return;
      if ((failed.get(k) || 0) >= o.maxRetries) return;
      for (const q of queue) if (q.key === k) { q.pri = Math.max(q.pri, pri); return; }
      queue.push({ key: k, z, x, y, date, layer: L, pri: pri || 0 });
      pump();
    }

    function pump() {
      while (inFlight < o.maxInFlight && queue.length) {
        // highest priority first — the patch you are looking at, not the one
        // that happened to be asked for first
        let bi = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i].pri > queue[bi].pri) bi = i;
        const job = queue.splice(bi, 1)[0];
        start(job);
      }
    }

    function start(job) {
      const k = job.key;
      inFlight++;
      const done = (img, status) => {
        inFlight--; pending.delete(k);
        if (img) {
          live.set(k, { img, at: ++seq }); evict();
          stats.fetched++;
          if (o.store && !job.fromStore) { try { o.store.put(k, img); } catch (e) {} }
        } else if (status === 404) {
          // There is genuinely no tile here — a gap in the record, or a date
          // the satellite did not fly. Asking again forever would be a slow
          // denial of service against a public archive.
          missing.add(k); stats.notFound++;
        } else {
          failed.set(k, (failed.get(k) || 0) + 1); stats.errored++;
        }
        pump();
      };
      // the persistent store first: a revisit should work with no network
      if (o.store) {
        let hit = null;
        try { hit = o.store.get(k); } catch (e) { hit = null; }
        if (hit) {
          stats.fromStore++;
          job.fromStore = true;
          done(hit, 200);
          return;
        }
      }
      // Registered BEFORE the call, not after. A loader that settles
      // synchronously — a stub, a memory cache, a data: URL — runs `done`
      // inside `o.load`, so `pending.delete(k)` happens first and the entry
      // written afterwards is never removed. Every later request for that tile
      // then sees `pending.has(k)` and returns, so a synchronous FAILURE is
      // permanent: the tile can never be retried and never arrives, silently.
      pending.set(k, { cancel: null, z: job.z, x: job.x, y: job.y });
      const cancel = o.load(url(job.z, job.x, job.y, job.date, job.layer), done);
      const held = pending.get(k);
      if (held) held.cancel = cancel || null;
    }

    // The camera moved: anything queued but not started is no longer wanted.
    // In-flight requests are left alone — cancelling a nearly-complete fetch
    // wastes the bytes already paid for.
    function dropQueued(keepFn) {
      let n = 0;
      for (let i = queue.length - 1; i >= 0; i--) {
        if (!keepFn || !keepFn(queue[i])) { queue.splice(i, 1); n++; }
      }
      stats.cancelled += n;
      return n;
    }

    function cancelAll() {
      dropQueued(null);
      for (const [, p] of pending) if (p.cancel) { try { p.cancel(); } catch (e) {} }
      pending.clear(); inFlight = 0;
    }

    return {
      get, request, dropQueued, cancelAll, stats,
      url, tileFor, dateFor, isoDay,
      size: () => live.size,
      queued: () => queue.length,
      inFlight: () => inFlight,
      layer: () => o.layer,
      layerInfo: () => layerOf(o.layer),
      // Switching layers does not clear the cache: the key carries the layer,
      // so flipping back and forth is free rather than a re-download.
      setLayer: (name) => { if (LAYERS[name]) { o.layer = name; dropQueued(null); } return o.layer; },
      dateFn: (unixSec, nowSec) => dateForLayer(o.layer, unixSec, nowSec),
      has: (z, x, y, date, ln) => {
        const L = layerOf(ln == null ? o.layer : ln);
        return live.has(key(L.key, z, x, y, norm(L, date)));
      },
      isMissing: (z, x, y, date, ln) => {
        const L = layerOf(ln == null ? o.layer : ln);
        return missing.has(key(L.key, z, x, y, norm(L, date)));
      },
      clear: () => { live.clear(); missing.clear(); failed.clear(); }
    };
  }

  // The browser loader. crossOrigin is what makes the pixels readable by
  // WebGL; without it the texture upload throws a security error at the point
  // of use rather than here, which is a long way from the cause.
  function defaultLoad(u, done) {
    if (typeof global.Image !== 'function') { done(null, 0); return null; }
    const img = new global.Image();
    let settled = false;
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (!settled) { settled = true; done(img, 200); } };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      // An <img> cannot see the status code. A tile that is genuinely absent
      // and a network that is down look identical here, so this reports the
      // conservative one — a retryable error — and the 404 path is reached
      // only where a real status is available.
      done(null, 0);
    };
    img.src = u;
    return () => { settled = true; img.src = ''; };
  }

  // IndexedDB, wrapped so that its absence is ordinary rather than fatal.
  // Private browsing, an old WebView and a full disk all present as "no
  // store", and the game must simply stream every time in that case.
  function openStore(name, onReady) {
    const idb = global.indexedDB;
    if (!idb) { onReady(null); return; }
    let db = null;
    const mem = new Map();
    let req;
    try { req = idb.open(name || 'pd-tiles', 1); } catch (e) { onReady(null); return; }
    req.onupgradeneeded = () => {
      try { req.result.createObjectStore('t'); } catch (e) {}
    };
    req.onerror = () => onReady(null);
    req.onsuccess = () => {
      db = req.result;
      onReady({
        // Reads are served from a memory mirror populated in the background,
        // because `get` has to answer synchronously for the fallback walk and
        // IndexedDB cannot.
        get: (k) => mem.get(k) || null,
        put: (k, img) => {
          mem.set(k, img);
          try {
            const tx = db.transaction('t', 'readwrite');
            tx.objectStore('t').put(img.src || '', k);
          } catch (e) {}
        },
        _mem: mem
      });
    };
  }

  global.PD.Tiles = {
    create, openStore, url, tileFor, dateFor, dateForLayer, isoDay, defaultLoad,
    layerOf, LAYERS, DEFAULT_LAYER, STATIC_DATE,
    HOST, MAX_Z, TILE_PX, FIRST_DAY,
    // the acknowledgement NASA asks for, in one place so the UI cannot drift
    CREDIT: 'Imagery courtesy NASA EOSDIS GIBS — public domain'
  };
})(window);
