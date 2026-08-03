// Streaming imagery, and every way it can fail.
//
// This is the first thing in the project that depends on a network, which
// means it is the first thing that is USUALLY BROKEN in some way — offline,
// throttled, 404ing, arriving out of order, arriving after the camera has
// moved somewhere else. Those are not edge cases here, they are the ordinary
// condition, and the rule the whole module is built around is:
//
//   every request returns imagery, or an ancestor's imagery with a UV
//   sub-rectangle, or nothing at all so the procedural bake shows through.
//   There is no fourth outcome, and there is never a blank tile.
//
// js/tiles.js takes its image loader, its persistent store and its clock as
// arguments precisely so this file can run with no network and still reach
// every one of those paths.
//
// Usage: node tools/test-tiles.js [repoRoot]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.argv[2] || '.';

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, Date, Error,
  Uint8Array, Uint16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer,
  setTimeout: (f) => f, clearTimeout: () => 0
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(ctx);
for (const f of ['util.js', 'tiles.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'js', f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD, T = PD.Tiles;

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

// A loader you can steer: it records what was asked for and settles only when
// told to, which is what makes "arrives out of order" and "never arrives"
// expressible at all.
function makeLoader() {
  const calls = [];
  let cancelled = 0;
  const load = (u, done) => {
    const c = { url: u, done, settled: false };
    calls.push(c);
    return () => { c.cancelled = true; cancelled++; };
  };
  load.calls = calls;
  load.cancelled = () => cancelled;
  load.settle = (i, img, status) => {
    const c = calls[i];
    if (!c || c.settled) return false;
    c.settled = true; c.done(img, status); return true;
  };
  load.settleAll = (img, status) => {
    // deliberately in REVERSE, because "in the order requested" is an
    // assumption a real network never honours
    for (let i = calls.length - 1; i >= 0; i--) load.settle(i, img, status);
  };
  return load;
}
const IMG = (tag) => ({ tag, src: 'x' });

// ---------------------------------------------------------------------------
console.log('\n--- the URL, and the archive it points at ---');
{
  const u = T.url(3, 4, 2, '2026-08-01');
  check('the date is in the path, so imagery is a time machine',
    u.indexOf('/2026-08-01/') > 0, u.slice(u.indexOf('/default/')));
  check('it asks for the geographic matrix set, not Mercator',
    u.indexOf('/epsg4326/') > 0 && u.indexOf('/250m/') > 0);
  // GIBS is {z}/{row}/{col}; getting that backwards puts the whole planet at
  // ninety degrees and looks like a projection bug rather than an index one.
  check('row comes before column, as GIBS orders them',
    u.endsWith('/3/2/4.jpg'), u.slice(-12));
}

// ---------------------------------------------------------------------------
console.log('\n--- a patch IS a tile ---');
{
  // The whole reason for choosing the geographic set. If this mapping is
  // wrong the imagery lands on the wrong ground, which reads as "the textures
  // are offset" and is very hard to trace back to an index.
  const P = Math.PI;
  const t0 = T.tileFor(0, -P, P / 2);         // top-left of the world
  check('level 0 top-left is tile 0,0', t0.z === 0 && t0.x === 0 && t0.y === 0,
    JSON.stringify(t0));
  const t1 = T.tileFor(0, 0, P / 2);          // the other root
  check('the second root is the second tile', t1.x === 1 && t1.y === 0, JSON.stringify(t1));
  const t2 = T.tileFor(1, -P, P / 2);
  check('level 1 has 4x2 tiles', t2.z === 1 && t2.x === 0 && t2.y === 0, JSON.stringify(t2));
  const t3 = T.tileFor(3, 0, 0);              // equator, prime meridian
  check('the equator at the prime meridian is mid-grid',
    t3.z === 3 && t3.x === 8 && t3.y === 4, JSON.stringify(t3));
  const deep = T.tileFor(14, 0.5, 0.5);
  check('a patch deeper than the archive clamps to its deepest level',
    deep.z === T.MAX_Z, 'level 14 -> z' + deep.z);
  // and the indices must stay inside the grid at every level
  let oob = 0;
  for (let z = 0; z <= T.MAX_Z; z++) {
    for (let i = 0; i < 200; i++) {
      const lon = -Math.PI + (i / 200) * Math.PI * 2;
      const lat = Math.PI / 2 - (i / 200) * Math.PI;
      const t = T.tileFor(z, lon, lat);
      if (t.x < 0 || t.x >= (2 << z) || t.y < 0 || t.y >= (1 << z)) oob++;
    }
  }
  check('no tile index ever falls outside its grid', oob === 0, oob + ' out of range');
}

// ---------------------------------------------------------------------------
console.log('\n--- the clock cannot ask for a photograph of the future ---');
{
  const now = Date.UTC(2026, 7, 3) / 1000;
  check('an ordinary date is asked for as itself',
    T.dateFor(Date.UTC(2020, 4, 17) / 1000, now) === '2020-05-17',
    T.dateFor(Date.UTC(2020, 4, 17) / 1000, now));
  // The sim clock reaches the year 40,000. GIBS 404s on tomorrow, and a
  // request that can only ever fail is worse than one that is quietly clamped.
  check('a date in the future clamps to the most recent day that exists',
    T.dateFor(Date.UTC(4000, 0, 1) / 1000, now) === '2026-08-02',
    T.dateFor(Date.UTC(4000, 0, 1) / 1000, now));
  check('and so does today, because today is still being assembled',
    T.dateFor(now, now) === '2026-08-02', T.dateFor(now, now));
  // Rewind past the satellites and there is nothing to ask for. Saying so is
  // better than requesting a tile that will 404 forever.
  check('before the satellite era there is no date at all',
    T.dateFor(Date.UTC(1900, 0, 1) / 1000, now) === null);
  check('and the era starts when VIIRS true colour actually starts',
    T.dateFor(T.FIRST_DAY + 1, now) === '2015-11-24',
    T.dateFor(T.FIRST_DAY + 1, now));
}

// ---------------------------------------------------------------------------
console.log('\n--- an ancestor is a usable answer ---');
{
  const load = makeLoader();
  const c = T.create({ load, maxInFlight: 99 });
  const D = '2026-08-01';
  // ask for something deep, and answer only the root
  const first = c.get(6, 0.1, 0.1, D);
  check('nothing yet means nothing yet, not a blank tile', first === null);
  check('and asking put exactly one fetch in flight', load.calls.length === 1,
    load.calls.length + ' requests');

  // Hand it ONLY the level-0 tile the deep patch descends from. Settling
  // everything in flight would also answer the deep tile's own request, and
  // the lookup would then find an exact match — which is a different test
  // that happens to pass.
  const root = T.tileFor(0, 0.1, 0.1);
  c.request(root.z, root.x, root.y, D, 9);
  const rootIdx = load.calls.findIndex(cc => cc.url.indexOf('/0/' + root.y + '/' + root.x + '.jpg') > 0);
  check('the root was requested separately from the deep tile', rootIdx >= 0,
    'call ' + rootIdx + ' of ' + load.calls.length);
  load.settle(rootIdx, IMG('root'), 200);
  const got = c.get(6, 0.1, 0.1, D, { noFetch: true });
  check('a distant ancestor is used rather than nothing', !!got && got.img.tag === 'root',
    got ? 'z' + got.z : 'null');
  check('and it comes with the sub-rectangle that makes it fit',
    !!got && got.uv[2] > 0 && got.uv[2] <= 1 && got.uv[2] === got.uv[3],
    got ? 'uv ' + got.uv.map(n => n.toFixed(4)).join(',') : '');
  {
    // the rectangle must be the right SIZE for the level gap: six levels down
    // is one sixty-fourth of the ancestor in each axis
    const span = got ? got.uv[2] : 0;
    check('the sub-rectangle matches the level gap exactly',
      Math.abs(span - 1 / 64) < 1e-12, span.toFixed(8) + ' vs ' + (1 / 64).toFixed(8));
    // And it must be the RIGHT rectangle, derived from geometry rather than
    // from the same walk that produced it. The ancestor covers a known patch
    // of the globe; where the descendant sits inside that patch is
    // arithmetic, and it has to agree.
    //
    // (The first version of this compared the descendant's position in GLOBAL
    // uv against a rectangle expressed in the ANCESTOR's uv. The level-0
    // ancestor spans half the world in longitude, so the two differ by a
    // factor of two and an offset, and the check failed on correct code.)
    const t = T.tileFor(6, 0.1, 0.1);
    const P2 = Math.PI * 2;
    const ancCols = 2 << got.z, ancRows = 1 << got.z;
    const aLon0 = -Math.PI + (root.x / ancCols) * P2, aLonSpan = P2 / ancCols;
    const aLat0 = Math.PI / 2 - (root.y / ancRows) * Math.PI, aLatSpan = Math.PI / ancRows;
    const dCols = 2 << 6, dRows = 1 << 6;
    const dLon0 = -Math.PI + (t.x / dCols) * P2;
    const dLat0 = Math.PI / 2 - (t.y / dRows) * Math.PI;
    const expU = (dLon0 - aLon0) / aLonSpan;
    const expV = (aLat0 - dLat0) / aLatSpan;
    check('and the rectangle is where the geometry says it is',
      Math.abs(got.uv[0] - expU) < 1e-9 && Math.abs(got.uv[1] - expV) < 1e-9,
      'got ' + got.uv[0].toFixed(6) + ',' + got.uv[1].toFixed(6) +
      ' expected ' + expU.toFixed(6) + ',' + expV.toFixed(6));
  }
  // and the exact tile, once it arrives, beats the ancestor
  const exact = T.tileFor(6, 0.1, 0.1);
  const exIdx = load.calls.findIndex(cc =>
    cc.url.indexOf('/6/' + exact.y + '/' + exact.x + '.jpg') > 0);
  load.settle(exIdx, IMG('exact'), 200);
  const now2 = c.get(6, 0.1, 0.1, D, { noFetch: true });
  check('the real tile replaces the stand-in as soon as it lands',
    now2.img.tag === 'exact' && now2.uv[2] === 1, now2.img.tag);
}

// ---------------------------------------------------------------------------
console.log('\n--- with the network off ---');
{
  // Nothing loads, ever. The game must still be playable, which here means
  // every call returns promptly and nothing is left waiting on a promise.
  const load = makeLoader();
  const c = T.create({ load, maxInFlight: 4 });
  const D = '2026-08-01';
  for (let i = 0; i < 40; i++) c.get(5, i * 0.05, 0.2, D);
  check('requests are capped in flight rather than all fired at once',
    c.inFlight() <= 4, c.inFlight() + ' in flight, ' + c.queued() + ' queued');
  check('every lookup answered immediately with "use the bake"',
    c.get(5, 0.1, 0.2, D, { noFetch: true }) === null);
  // now fail them all, the way a dead network does
  for (let i = 0; i < load.calls.length; i++) load.settle(i, null, 0);
  check('a dead network never yields a tile', c.size() === 0, c.size() + ' cached');
  check('and it is still answering', c.get(5, 0.1, 0.2, D, { noFetch: true }) === null);
  check('the failures were counted, not swallowed', c.stats.errored > 0,
    c.stats.errored + ' errors');
}

// ---------------------------------------------------------------------------
console.log('\n--- with tiles 404ing ---');
{
  // A 404 is different from a dead network and must be treated differently:
  // the tile is genuinely absent and asking again forever is a slow denial of
  // service against a public archive.
  const load = makeLoader();
  const c = T.create({ load, maxRetries: 3 });
  const D = '2026-08-01';
  c.request(2, 1, 1, D, 0);
  load.settleAll(null, 404);
  const before = load.calls.length;
  for (let i = 0; i < 20; i++) c.request(2, 1, 1, D, 0);
  check('a 404 is never asked for a second time',
    load.calls.length === before, (load.calls.length - before) + ' repeat requests');
  check('and it is remembered as missing', c.isMissing(2, 1, 1, D));

  // a network error, by contrast, IS retried — but not forever
  const load2 = makeLoader();
  const c2 = T.create({ load: load2, maxRetries: 3 });
  let tries = 0;
  for (let i = 0; i < 10; i++) {
    c2.request(2, 1, 1, D, 0);
    if (load2.calls.length > tries) { load2.settle(tries, null, 0); tries++; }
  }
  check('a network error is retried', tries > 1, tries + ' attempts');
  check('but it gives up rather than hammering forever', tries <= 3, tries + ' attempts');
}

// ---------------------------------------------------------------------------
console.log('\n--- with tiles arriving slowly and out of order ---');
{
  const load = makeLoader();
  const c = T.create({ load, maxInFlight: 8 });
  const D = '2026-08-01';
  const want = [];
  for (let i = 0; i < 6; i++) { const t = T.tileFor(4, i * 0.3, 0.1); want.push(t); c.request(t.z, t.x, t.y, D, i); }
  check('all six were started', load.calls.length === 6, load.calls.length + '');
  // settle backwards, and interleave a duplicate of one already settled
  load.settle(5, IMG('f'), 200);
  load.settle(0, IMG('a'), 200);
  load.settle(3, IMG('d'), 200);
  check('out-of-order arrivals all land', c.size() === 3, c.size() + ' cached');
  check('and each is retrievable at its own coordinates',
    !!c.get(4, want[0].x === T.tileFor(4, 0, 0.1).x ? 0 : 0, 0.1, D, { noFetch: true }) ||
    c.has(want[0].z, want[0].x, want[0].y, D));
  // settling something twice must not double-count or resurrect it
  const n = c.size();
  load.settle(5, IMG('f2'), 200);
  check('a duplicate arrival is ignored', c.size() === n, c.size() + ' vs ' + n);
  // the ones that never arrive must not block the ones that do
  check('nothing is stuck in flight that was never answered',
    c.inFlight() === 3, c.inFlight() + ' still open');
}

// ---------------------------------------------------------------------------
console.log('\n--- the camera moved ---');
{
  const load = makeLoader();
  const c = T.create({ load, maxInFlight: 2 });
  const D = '2026-08-01';
  for (let i = 0; i < 20; i++) { const t = T.tileFor(5, i * 0.2, 0.1); c.request(t.z, t.x, t.y, D, 0); }
  const queuedBefore = c.queued();
  check('most of them are waiting, not in flight', queuedBefore > 10,
    queuedBefore + ' queued, ' + c.inFlight() + ' in flight');
  const dropped = c.dropQueued(null);
  check('flying away discards what has not started', dropped === queuedBefore && c.queued() === 0,
    dropped + ' dropped');
  // in-flight work is deliberately NOT cancelled: the bytes are already paid
  check('but not what is already on the wire', c.inFlight() === 2, c.inFlight() + ' still open');
}

// ---------------------------------------------------------------------------
console.log('\n--- priority, and memory ---');
{
  const load = makeLoader();
  const c = T.create({ load, maxInFlight: 1 });
  const D = '2026-08-01';
  c.request(4, 1, 1, D, 0);       // starts immediately
  c.request(4, 2, 2, D, 1);
  c.request(4, 3, 3, D, 9);       // the one you are looking at
  c.request(4, 4, 4, D, 5);
  load.settle(0, IMG('first'), 200);
  check('the highest-priority tile goes next, not the oldest',
    load.calls[1] && load.calls[1].url.indexOf('/4/3/3.jpg') > 0,
    load.calls[1] ? load.calls[1].url.slice(-12) : 'none');

  // the LRU has to actually bound memory, or a long flight is a slow leak
  const load2 = makeLoader();
  const c2 = T.create({ load: load2, maxLive: 16, maxInFlight: 999 });
  for (let i = 0; i < 100; i++) c2.request(6, i, 1, D, 0);
  load2.settleAll(IMG('t'), 200);
  check('the cache is bounded however far you fly', c2.size() <= 16,
    c2.size() + ' tiles held of 100 fetched');
  check('and the evictions were counted', c2.stats.evicted >= 80, c2.stats.evicted + ' evicted');
}

// ---------------------------------------------------------------------------
console.log('\n--- a revisit works with no network ---');
{
  // The persistent store is what makes the second visit to a place work on a
  // train. It is injected, so its absence is also testable — and absence is
  // the normal case in private browsing, on an old WebView and on a full disk.
  const mem = new Map();
  const store = { get: (k) => mem.get(k) || null, put: (k, v) => mem.set(k, v) };
  const load = makeLoader();
  const c = T.create({ load, store, maxInFlight: 99 });
  const D = '2026-08-01';
  c.request(3, 5, 2, D, 0);
  load.settleAll(IMG('stored'), 200);
  check('a fetched tile is written to the store', mem.size === 1, mem.size + ' stored');

  // now a completely fresh session, and a loader that always fails
  const deadLoad = makeLoader();
  const c2 = T.create({ load: deadLoad, store, maxInFlight: 99 });
  c2.request(3, 5, 2, D, 0);
  check('a revisit is served from the store, with the network down',
    c2.has(3, 5, 2, D) && deadLoad.calls.length === 0,
    c2.stats.fromStore + ' from store, ' + deadLoad.calls.length + ' network calls');
  check('and it is not written back again', mem.size === 1, mem.size + ' stored');

  // no store at all must be ordinary, not fatal
  const c3 = T.create({ load: makeLoader(), store: null });
  c3.request(3, 5, 2, D, 0);
  check('no store at all is merely a cache miss', c3.size() === 0);
}

console.log('\n=== tiles failures: ' + fails + ' ===');
console.log(fails === 0 ? 'TILES TEST PASSED' : 'TILES TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
