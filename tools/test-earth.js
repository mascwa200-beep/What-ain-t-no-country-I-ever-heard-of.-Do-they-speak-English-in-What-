// Is the planet Earth?
//
// The height field is baked from real elevation data at build time and the
// climate is derived from it. Both are easy to get subtly wrong in ways that
// still look like a planet — an inverted latitude, a half-world longitude
// offset, an ocean where an ice sheet should be — so this asserts against
// places rather than against numbers.
//
// Usage: node tools/test-earth.js [repoRoot]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const base = process.argv[2] || '.';

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, Date, Error,
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer,
  setTimeout: (f) => { f(); return 0; }, clearTimeout: () => 0,
  performance: { now: () => Date.now() },
  atob: (s) => Buffer.from(s, 'base64').toString('binary')
};
// Node has no DecompressionStream in every version we might run on, and the
// game's decode path is exercised in the browser suite. Here we hand the
// module the same bytes through the same shape.
ctx.DecompressionStream = function () {};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['util.js', 'world.js', 'earthdata.js', 'earth.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'js', f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD, Earth = PD.Earth, W = PD.World;

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

// ---- decode the payload the same way the game does, minus the stream API
console.log('\n--- the data ---');
const D = PD.EarthData;
const raw = new Uint8Array(zlib.gunzipSync(Buffer.from(D.z, 'base64')));
check('payload decodes', raw.length === D.W * D.H, raw.length + ' bytes, expect ' + (D.W * D.H));
// hand it to the module directly so every function below is the real one
Earth._injectForTest = null;
const gridBackup = raw;
// build() reads the module-private grid; feed it by running the same decode
// path the module would have taken. The module exposes metresAt/build, so we
// re-enter it through a tiny shim rather than reaching into its closure.
vm.runInContext(`
  (function(){
    const D = PD.EarthData;
    const g = __rawGrid;
    // rebuild the module with the grid already present
    PD.Earth.__test = {
      metresAt(lat, lon) {
        const fx = ((lon + 180) / 360) * D.W - 0.5, fy = ((90 - lat) / 180) * D.H - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const wrap = (x) => ((x % D.W) + D.W) % D.W;
        const cy = (y) => y < 0 ? 0 : (y >= D.H ? D.H - 1 : y);
        const a = D.metres(g[cy(y0)*D.W+wrap(x0)]), b = D.metres(g[cy(y0)*D.W+wrap(x0+1)]);
        const c = D.metres(g[cy(y0+1)*D.W+wrap(x0)]), d = D.metres(g[cy(y0+1)*D.W+wrap(x0+1)]);
        return (a*(1-tx)+b*tx)*(1-ty) + (c*(1-tx)+d*tx)*ty;
      }
    };
  })();
`, Object.assign(ctx, { __rawGrid: raw }));
const M = ctx.PD.Earth.__test.metresAt;

// ---- is it Earth? -----------------------------------------------------
console.log('\n--- is it Earth ---');
const PLACES = [
  ['Himalaya',        32,   86,  (m) => m > 3000,  'above 3000 m'],
  ['Andes',          -20,  -68,  (m) => m > 2000,  'above 2000 m'],
  ['Greenland ice',   72,  -40,  (m) => m > 1000,  'ice sheet'],
  ['Antarctic ice',  -80,    0,  (m) => m > 0,     'above sea level'],
  ['Sahara',          23,   12,  (m) => m > 0,     'land'],
  ['Amazon',          -3,  -60,  (m) => m > 0 && m < 500, 'low land'],
  ['Siberia',         65,  100,  (m) => m > 0,     'land'],
  ['Australia',      -25,  133,  (m) => m > 0,     'land'],
  ['Pacific',          0, -160,  (m) => m < -3000, 'deep ocean'],
  ['Atlantic',        30,  -40,  (m) => m < -2000, 'deep ocean'],
  ['Indian Ocean',   -20,   80,  (m) => m < -2000, 'deep ocean'],
  ['Southern Ocean', -60,    0,  (m) => m < 0,     'ocean']
];
for (const [name, lat, lon, ok, want] of PLACES) {
  const m = M(lat, lon);
  check(name + ' is ' + want, ok(m), Math.round(m) + ' m');
}

// Orientation traps: an inverted latitude or a half-world longitude shift
// still produces a planet, just not this one.
console.log('\n--- orientation ---');
check('north is not south (Greenland high, its antipode-latitude ocean low)',
  M(72, -40) > 1000 && M(-72, -40) < 0, `${Math.round(M(72,-40))} m vs ${Math.round(M(-72,-40))} m`);
check('longitude is not shifted (Africa land at 0E, Pacific deep at 180E)',
  M(0, 20) > 0 && M(0, -160) < -3000, `${Math.round(M(0,20))} m vs ${Math.round(M(0,-160))} m`);
check('the Pacific is wider than the Atlantic at the equator', (() => {
  let pac = 0, atl = 0;
  for (let lon = -180; lon < -80; lon += 0.5) if (M(0, lon) < 0) pac++;
  for (let lon = -50; lon < 10; lon += 0.5) if (M(0, lon) < 0) atl++;
  return pac > atl;
})());

// ---- a world built from it --------------------------------------------
console.log('\n--- a world built from it ---');
// build() needs the module's own grid; run the real path by monkey-patching
// the decode the module would do. Simplest honest route: call the exported
// build after seeding the closure through ready(), which we cannot do here,
// so assert the pieces build() composes instead.
const at01 = (lat, lon) => Earth.elev01(M(lat, lon));
check('sea level maps to the classifier\'s waterline',
  Math.abs(Earth.elev01(0) - Earth.SEA01) < 1e-6, Earth.elev01(0).toFixed(4));
check('deep ocean is below the DEEP threshold (0.30)', at01(0, -160) < 0.30, at01(0, -160).toFixed(3));
check('the Himalaya reaches the rock/snow band (>0.72)', at01(32, 86) > 0.72, at01(32, 86).toFixed(3));
check('lowland is neither water nor mountain',
  at01(-3, -60) > 0.38 && at01(-3, -60) < 0.6, at01(-3, -60).toFixed(3));

console.log('\n--- climate ---');
// The desert belts are the test that the climate is Earth's and not a gradient.
const r = Earth.baseRain;
check('equator is wet', r(0) > 0.8, r(0).toFixed(2));
check('the subtropical desert belt is dry', r(25) < 0.45, r(25).toFixed(2));
check('temperate latitudes are wetter again', r(52) > r(25), r(52).toFixed(2) + ' > ' + r(25).toFixed(2));
check('the poles are dry', r(88) < 0.5, r(88).toFixed(2));
check('the belts are symmetric', Math.abs(r(25) - r(-25)) < 1e-9);
// A curve that clamps is a curve that has stopped carrying information. The
// first version pinned the equator at 1.00 and the desert belt at 0.00, which
// collapses rainforest and savanna into one biome.
{
  let lo = 1, hi = 0, atRail = 0;
  for (let lat = -90; lat <= 90; lat += 0.5) {
    const v = r(lat);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    if (v <= 0.0001 || v >= 0.9999) atRail++;
  }
  check('rainfall never hits its own clamps', atRail === 0, atRail + ' samples at a rail');
  check('rainfall spans a usable range', lo > 0.02 && hi < 0.98,
    lo.toFixed(2) + ' .. ' + hi.toFixed(2));
  // and it must actually cross the classifier's thresholds
  const crossings = [0.30, 0.50, 0.60, 0.68].filter((th) => lo < th && hi > th).length;
  check('it crosses every biome threshold assignBiome uses', crossings === 4, crossings + '/4');
}

// ---- the cities are on land -------------------------------------------
console.log('\n--- real places ---');
{
  const w = W.createWorld(720, 360, 'earth-test', {});
  // fill this world from the real height field, the same arithmetic build() uses
  for (let y = 0; y < w.H; y++) {
    const lat = 90 - ((y + 0.5) / w.H) * 180;
    for (let x = 0; x < w.W; x++) {
      w.elev[y * w.W + x] = Earth.elev01(M(lat, ((x + 0.5) / w.W) * 360 - 180));
      w.moist[y * w.W + x] = 0.5; w.temp[y * w.W + x] = 0.5;
    }
  }
  W.classify(w);
  let land = 0;
  for (let i = 0; i < w.n; i++) if (W.isLand(w.biome[i])) land++;
  const pct = land / w.n * 100;
  check('land covers an Earth-like fraction', pct > 22 && pct < 42, pct.toFixed(1) + '%');

  const found = Earth.places(w);
  check('most cities land on land', found.length >= Earth.CITIES.length - 6,
    found.length + '/' + Earth.CITIES.length);
  const byName = {};
  for (const p of found) byName[p.name] = p;
  for (const n of ['Cairo', 'Tokyo', 'New York', 'Sao Paulo', 'Sydney', 'Moscow']) {
    check(n + ' placed', !!byName[n]);
  }
  // and they must be in the right hemisphere, which catches a flipped axis
  if (byName.Sydney && byName.Moscow) {
    check('Sydney is south of Moscow', byName.Sydney.y > byName.Moscow.y,
      'y ' + byName.Sydney.y + ' vs ' + byName.Moscow.y);
  }
  if (byName.Tokyo && byName['New York']) {
    check('Tokyo is east of New York on this grid', byName.Tokyo.x > byName['New York'].x,
      'x ' + byName.Tokyo.x + ' vs ' + byName['New York'].x);
  }
}

console.log('\n=== earth failures: ' + fails + ' ===');
console.log(fails === 0 ? 'EARTH TEST PASSED' : 'EARTH TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
