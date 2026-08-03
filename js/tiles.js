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
// Measured: levels 0..8 exist and level 9 is a 400. Level 8 is 512x256 tiles
// of 512x512 px, which is 153 m per pixel at the equator. The quadtree goes
// past level 14 on the ground, so below level 8 the parent tile is stretched —
// imagery answers WHAT IS HERE and the procedural bake answers WHAT IT LOOKS
// LIKE AT ONE METRE. That split is the honest ceiling of this data, not a
// shortcoming of the code.
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
  const LAYER = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';
  const MATRIX = '250m';               // the deepest geographic set for this layer
  const MAX_Z = 8;                     // measured: 9 is a 400
  const TILE_PX = 512;

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

  function url(z, x, y, date) {
    return HOST + '/' + LAYER + '/default/' + date + '/' + MATRIX +
      '/' + z + '/' + y + '/' + x + '.jpg';
  }

  // A quadtree patch is a tile. This is the whole reason for choosing the
  // geographic matrix set.
  function tileFor(level, lon0, lat0) {
    const z = Math.min(MAX_Z, Math.max(0, level));
    const n = 1 << z;                              // rows; columns are 2n
    const x = Math.floor(((lon0 + Math.PI) / (Math.PI * 2)) * (2 * n));
    const y = Math.floor(((Math.PI / 2 - lat0) / Math.PI) * n);
    return { z, x: ((x % (2 * n)) + 2 * n) % (2 * n), y: PD.clamp(y, 0, n - 1) };
  }

  const key = (z, x, y, date) => z + '/' + x + '/' + y + '/' + date;

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
      maxRetries: opts.maxRetries == null ? 3 : opts.maxRetries
    };

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
      if (!date) return null;                       // outside the satellite era
      const t = tileFor(level, lon0, lat0);
      const want = key(t.z, t.x, t.y, date);
      const rec = live.get(want);
      if (rec) { stats.hit++; touch(want, rec); return { img: rec.img, uv: [0, 0, 1, 1], z: t.z }; }
      stats.miss++;
      if (!(opt && opt.noFetch)) request(t.z, t.x, t.y, date, (opt && opt.pri) || 0);

      // Walk up. Each level up halves the sub-rectangle and doubles the scale.
      let x = t.x, y = t.y, u0 = 0, v0 = 0, span = 1;
      for (let z = t.z - 1; z >= 0; z--) {
        u0 = (u0 + (x & 1)) / 2; v0 = (v0 + (y & 1)) / 2; span /= 2;
        x >>= 1; y >>= 1;
        const anc = live.get(key(z, x, y, date));
        if (anc) { touch(key(z, x, y, date), anc); return { img: anc.img, uv: [u0, v0, span, span], z }; }
      }
      return null;                                   // nothing yet: procedural
    }

    function request(z, x, y, date, pri) {
      const k = key(z, x, y, date);
      if (live.has(k) || pending.has(k) || missing.has(k)) return;
      if ((failed.get(k) || 0) >= o.maxRetries) return;
      for (const q of queue) if (q.key === k) { q.pri = Math.max(q.pri, pri); return; }
      queue.push({ key: k, z, x, y, date, pri: pri || 0 });
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
      const cancel = o.load(url(job.z, job.x, job.y, job.date), done);
      pending.set(k, { cancel: cancel || null, z: job.z, x: job.x, y: job.y });
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
      has: (z, x, y, date) => live.has(key(z, x, y, date)),
      isMissing: (z, x, y, date) => missing.has(key(z, x, y, date)),
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
    create, openStore, url, tileFor, dateFor, isoDay, defaultLoad,
    HOST, LAYER, MATRIX, MAX_Z, TILE_PX, FIRST_DAY
  };
})(window);
