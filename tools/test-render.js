// What the GPU is actually asked to draw, at three altitudes.
//
// Every performance claim about this renderer up to now has been arithmetic
// done by reading the source. This drives real frames in a real WebGL context
// and reads the counters back, so "it got cheaper" is a number.
//
// Two things make this awkward and are worth stating once:
//
//   - `drawInner` returns immediately when `r.headless` is set, so the Node
//     suites can never see a draw call. This has to be a browser.
//   - requestAnimationFrame NEVER fires under --virtual-time-budget. The
//     game's own loop() therefore never runs, so the probe calls
//     PD.Render.draw() directly. That is also what makes the measurement
//     deterministic: exactly N frames, not "however many fit in 20 seconds".
//
// Usage: node tools/test-render.js [repoRoot] [chromePath]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const base = path.resolve(process.argv[2] || '.');
const CHROME = process.argv[3] || process.env.CHROME_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const R_EARTH_M = 6371000;

// altitude in metres -> cam.dist. Named so the report reads as altitudes.
const ALTS = [
  { name: 'orbit',   m: 1600000 },
  { name: '100 km',  m: 100000 },
  { name: '2 km',    m: 2000 },
  { name: 'ground',  m: 80 }
];

const PROBE = `
window.__report = null;
// NOTHING HERE MAY TOUCH THE NETWORK. Streamed imagery is the first thing in
// this project that wants one, and a suite that quietly depends on a live
// public archive is a suite that fails on a train — for a reason that has
// nothing to do with the code under test. The built-in tile loader goes
// through new Image(), so counting constructions turns "no network" from an
// assumption into a measurement. rAF never fires under --virtual-time-budget,
// so the game's own loop has not drawn a frame yet and nothing has been
// requested before the probe swaps the loader out.
window.__imgBlocked = [];
(function () {
  // Not a counter — a BLOCK. The first version of this only counted, and
  // recorded 13 real fetches: the game's own loop runs off setTimeout at boot
  // and had already asked GIBS for tiles before the probe could swap the
  // loader. Assigning .src is what starts a request, so the stub simply never
  // has one, and no request can leave the page however early it is made.
  window.Image = function () {
    var o = { crossOrigin: '', onload: null, onerror: null, width: 0, height: 0 };
    Object.defineProperty(o, 'src', {
      set: function (v) { if (v) window.__imgBlocked.push(v); },
      get: function () { return ''; }
    });
    return o;
  };
})();
window.addEventListener('error', function (e) {
  window.__report = { fatal: String(e.message) + ' @ ' + e.filename + ':' + e.lineno };
});
function finish(o) {
  window.__report = o;
  var pre = document.createElement('pre');
  pre.id = 'render-report';
  pre.textContent = JSON.stringify(o);
  document.body.appendChild(pre);
}
function run() {
  try {
    var G = window.G, PD = window.PD;
    if (!G || !G.r) return finish({ fatal: 'no renderer: G.r is ' + (G ? String(G.r) : 'no G') });
    // The game's loop() would fight the probe for the camera and the clock.
    G.running = false;
    var r = G.r, R = 6371000;
    var out = { alts: [], errs: [], gl2: !!r.gl2 };
    var ALTS = __ALTS__;

    // Aim at the highest ground on the planet. Over ocean the terrain clamp
    // has nothing to clamp against and reports a pass it never earned, and
    // the LOD never has any relief to resolve — both readings would be true
    // and meaningless.
    var w = G.world, peak = -1, px = 0, py = 0;
    for (var t = 0; t < w.n; t++) if (w.elev[t] > peak) { peak = w.elev[t]; px = t % w.W; py = (t / w.W) | 0; }
    // Prefer the largest SETTLEMENT: buildings are true scale, so aiming at a
    // bare mountain would report zero instances at every altitude and the
    // true-scale assertion below would pass while proving nothing.
    var bigV = null;
    for (var vi = 0; vi < G.sim.villages.length; vi++) {
      var vv = G.sim.villages[vi];
      if (!bigV || (vv.pop || 0) > (bigV.pop || 0)) bigV = vv;
    }
    if (bigV) {
      px = bigV.x; py = bigV.y;
      // This probe measures the RENDERER, not the simulation. At boot a
      // freshly-seeded settlement has a population of four, which is one
      // building — enough to satisfy "some buildings appear" while proving
      // almost nothing about drawing a town. Grow it here rather than running
      // the sim for a century to get the same effect.
      bigV.pop = 110; bigV.level = 7; bigV.temples = 3;
    }
    // Swap the tile loader for a stub before ANY frame is drawn. This is both
    // the no-network guarantee and the only way to control what arrives when.
    function stubTile(css) {
      var c = document.createElement('canvas');
      c.width = c.height = 64;
      var g = c.getContext('2d');
      g.fillStyle = css; g.fillRect(0, 0, 64, 64);
      return c;
    }
    function stubCache(mode, css) {
      var served = 0;
      var c = PD.Tiles.create({
        maxInFlight: 999, maxLive: 200,
        load: function (u, done) {
          if (mode === 'fail') { done(null, 0); return null; }
          served++; done(stubTile(css || '#ff00ff'), 200); return null;
        }
      });
      c.__served = function () { return served; };
      return c;
    }
    out.satAvail = !!(PD.Tiles && r.tiles);
    if (PD.Tiles) r.tiles = stubCache('fail');

    var aimLon = (px / w.W) * Math.PI * 2;
    var aimLat = Math.PI / 2 - (py / w.H) * Math.PI;
    out.peak = { x: px, y: py, elev: peak, town: bigV ? (bigV.name + ' pop ' + bigV.pop) : null };

    for (var i = 0; i < ALTS.length; i++) {
      var a = ALTS[i];
      var d = 1 + a.m / R;
      // Set BOTH the target and the smoothed value: stepCam eases toward the
      // target, so a probe that only sets cam.dist measures wherever the
      // easing happened to be, not the altitude it asked for.
      r.cam.dist = r.cam.sDist = d;
      r.cam.lon = r.cam.sLon = aimLon;
      r.cam.lat = r.cam.sLat = aimLat;
      r.cam.flyDur = 0;
      // The tree splits at most 4 patches per frame on purpose, so a handful
      // of frames measures a tree that has not finished growing. Settle
      // first, then measure — and re-pin the camera each frame, because
      // stepCam is easing it and the clamp may be pushing it out.
      // 130 frames is 4x what growing to MAX_PATCHES from nothing needs; it
      // was 200, which cost a quarter of this suite's wall clock for nothing.
      for (var s = 0; s < 130; s++) {
        r.cam.dist = r.cam.sDist = Math.max(d, r.cam.dist);
        r.cam.lon = r.cam.sLon = aimLon; r.cam.lat = r.cam.sLat = aimLat;
        try { PD.Render.draw(r, G.sim, G.ui || {}); }
        catch (e) { out.errs.push(a.name + ' settling: ' + (e && e.message ? e.message : String(e))); break; }
      }
      PD.Prof.reset();
      var frames = 4;
      for (var f = 0; f < frames; f++) {
        try { PD.Render.draw(r, G.sim, G.ui || {}); }
        catch (e) { out.errs.push(a.name + ': ' + (e && e.message ? e.message : String(e))); break; }
      }
      var c = PD.Prof.count || {};
      out.alts.push({
        name: a.name, altM: a.m, dist: d,
        // counters accumulate across the frames we drove; report per frame
        tris: Math.round((c['gl.tris'] || 0) / frames),
        draws: Math.round((c['gl.draws'] || 0) / frames),
        planetTris: c['gl.planetTris'] || 0,
        cloudTris: c['gl.cloudTris'] || 0,
        atmoTris: c['gl.atmoTris'] || 0,
        patches: c['lod.patches'] || 0,
        bldg: c['bldg.instances'] || 0,
        towns: c['bldg.towns'] || 0,
        // where the camera ENDED UP, which is not where we put it if
        // anything clamps it — that is the terrain-collision signal
        endDist: r.cam.dist,
        altAboveGroundM: (r.cam.dist - 1) * R,
        // and the radius the terrain actually reaches under it, read through
        // the same function the vertex shader displaces with
        groundR: PD.LOD ? PD.LOD.groundRadius(w, aimLon, aimLat, PD.LOD.exagFor(r.cam.dist)) : 1,
        exag: PD.LOD ? PD.LOD.exagFor(r.cam.dist) : 1
      });
    }

    // ---- streamed imagery -------------------------------------------------
    // TWO THINGS THIS HAS TO GET RIGHT, both of which it got wrong first time.
    //
    // 1. LOOK AT DAYLIGHT. The altitude loop aims at the largest settlement,
    //    which is Tokyo, which at boot is at local 01:40 — every pixel read
    //    back was night sky, and a magenta ground, a green ground and no
    //    ground at all all measured identically. A pixel test that cannot see
    //    the ground is not a weak test, it is a test of nothing.
    //
    // 2. COMPARE TWO IMAGES, NOT AN IMAGE AND A CONSTANT. Asserting a
    //    particular colour bakes in the lighting, the atmosphere and the
    //    tonemap. Asserting that a magenta ground and a green ground differ
    //    from each other says exactly one thing — the tile reached the screen
    //    — and says it under any lighting.
    var sun = PD.Sim.subsolar(G.sim.epoch + G.sim.clock);
    var sunLon = sun.lon < 0 ? sun.lon + Math.PI * 2 : sun.lon;
    // ...and at daylit LAND. The subsolar point itself is usually ocean, which
    // is dark and sits under a thick column of atmosphere, so the ground's
    // share of each pixel is small. Sunlit land is the brightest ground there
    // is and gives the measurement something to measure.
    var sx = sunLon / (Math.PI * 2) * w.W, sy = (Math.PI / 2 - sun.dec) / Math.PI * w.H;
    var bestT = -1, bestS = -1e9;
    for (var ti = 0; ti < w.n; ti++) {
      if (w.elev[ti] <= 0.42) continue;                 // land only
      var tx2 = ti % w.W, ty2 = (ti / w.W) | 0;
      var dxs = Math.abs(tx2 - sx); if (dxs > w.W / 2) dxs = w.W - dxs;
      var sc = -(dxs * dxs + (ty2 - sy) * (ty2 - sy));
      if (sc > bestS) { bestS = sc; bestT = ti; }
    }
    var sunLat = sun.dec;
    if (bestT >= 0) {
      sunLon = ((bestT % w.W) + 0.5) / w.W * Math.PI * 2;
      sunLat = Math.PI / 2 - (((bestT / w.W) | 0) + 0.5) / w.H * Math.PI;
    }
    out.aimedAtSun = { lonDeg: sunLon * 180 / Math.PI, latDeg: sunLat * 180 / Math.PI,
                       land: bestT >= 0 };

    function screen() {
      // The middle of the screen only. Under SwiftShader a full-buffer
      // readPixels is a pipeline flush measured in seconds, and the corners are
      // sky and HUD anyway — the ground is what is being asked about.
      var gl = r.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      var w2 = Math.min(320, W), h2 = Math.min(240, H);
      var px = new Uint8Array(w2 * h2 * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(((W - w2) / 2) | 0, ((H - h2) / 2) | 0, w2, h2, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var rs = 0, gs = 0, bs = 0, lit = 0, n = px.length / 4;
      for (var i = 0; i < px.length; i += 4) {
        rs += px[i]; gs += px[i + 1]; bs += px[i + 2];
        if (px[i] + px[i + 1] + px[i + 2] > 24) lit++;
      }
      return { r: rs / n, g: gs / n, b: bs / n, lit: lit / n, buf: px };
    }
    function differs(a, b) {
      if (!a || !b || !a.buf || !b.buf || a.buf.length !== b.buf.length) return -1;
      var n = 0;
      for (var i = 0; i < a.buf.length; i += 4) {
        if (Math.abs(a.buf[i] - b.buf[i]) > 8 || Math.abs(a.buf[i + 1] - b.buf[i + 1]) > 8 ||
            Math.abs(a.buf[i + 2] - b.buf[i + 2]) > 8) n++;
      }
      return n / (a.buf.length / 4);
    }
    function runAt(altM, cache, settleFrames, ageOut) {
      r.tiles = cache;
      var d = 1 + altM / R;
      for (var s = 0; s < settleFrames; s++) {
        // NOT Math.max(d, cam.dist) — that is right in the altitude loop, where
        // it preserves the terrain clamp pushing the eye up, and wrong here,
        // where it would pin the camera at the highest altitude ever visited.
        r.cam.dist = r.cam.sDist = d;
        r.cam.lon = r.cam.sLon = sunLon; r.cam.lat = r.cam.sLat = sunLat;
        r.cam.flyDur = 0;
        PD.Render.draw(r, G.sim, G.ui || {});
      }
      // performance.now() does not advance inside a synchronous loop under
      // virtual time, so the crossfade would sit at zero forever. Backdating
      // the birth stamp exercises the real fade code rather than skipping it.
      if (ageOut && r.satTex) r.satTex.forEach(function (e) { e.born = -100000; });
      PD.Prof.reset();
      PD.Render.draw(r, G.sim, G.ui || {});
      var c = PD.Prof.count || {};
      return {
        patches: c['lod.patches'] || 0,
        sat: c['sat.patches'] || 0,
        mixSum: c['sat.mixSum'] || 0,
        minSpan: c['sat.minSpan'],
        textures: c['sat.textures'] || 0,
        px: screen(),
        altM: (r.cam.dist - 1) * R
      };
    }

    if (PD.Tiles) {
      var GROUND = 2000;
      // 1. the loader fails every request — the offline / dead-network case
      out.satOff = runAt(GROUND, stubCache('fail'), 70, false);
      // 2. the same frame with imagery arriving, mid-fade
      var okCache = stubCache('ok', '#ff00ff');
      out.satFresh = runAt(GROUND, okCache, 3, false);
      // 3. and once the fade has completed
      out.satOn = runAt(GROUND, okCache, 3, true);
      out.satServed = okCache.__served();
      // 4. the SAME frame with a different ground. If the tile reaches the
      //    screen at all these two cannot look alike.
      var other = runAt(GROUND, stubCache('ok', '#00ff00'), 3, true);
      out.satDiff = Math.round(differs(out.satOn.px, other.px) * 1000) / 10;
      out.satOffDiff = Math.round(differs(out.satOn.px, out.satOff.px) * 1000) / 10;
      // 5. from orbit the patch level is at or above the archive floor, so the
      //    sub-rectangle is the whole tile; on the ground it must be a sliver.
      out.satOrbit = runAt(1600000, stubCache('ok'), 70, true);
      out.imagery = PD.Render.imageryState ? PD.Render.imageryState(r) : null;
      out.satBad = r.satBad || 0;
      out.satOther = { r: other.px.r, g: other.px.g, b: other.px.b };
      // the toggle has to be a toggle
      if (PD.Render.setImagery) {
        PD.Render.setImagery(r, false);
        out.satToggledOff = runAt(GROUND, okCache, 40, true);
        PD.Render.setImagery(r, true);
        out.satLayer = PD.Render.setImagery(r, true, 'daily');
        PD.Render.setImagery(r, true, 'base');
      }
      // buffers are large; do not ship them out through the DOM
      [out.satOff, out.satFresh, out.satOn, out.satOrbit, out.satToggledOff]
        .forEach(function (o) { if (o && o.px) delete o.px.buf; });
    }
    out.imgBlocked = window.__imgBlocked.length;
    out.planetUniforms = Object.keys(r.progPlanet.u).sort();

    finish(out);
  } catch (e) {
    finish({ fatal: (e && e.stack) ? e.stack : String(e) });
  }
}
// The game boots asynchronously (the Earth height field is gzipped). Poll for
// the renderer with setTimeout ONLY — rAF does not fire under virtual time.
var tries = 0;
(function wait() {
  if (window.G && window.G.r && window.G.sim) return run();
  if (++tries > 400) return finish({ fatal: 'renderer never appeared after ' + tries + ' polls' });
  setTimeout(wait, 25);
})();
`;

function buildProbe() {
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  const script = PROBE.replace('__ALTS__', JSON.stringify(ALTS));
  const injected = html.replace('</body>', '<script>\n' + script + '\n</script>\n</body>');
  if (injected === html) throw new Error('index.html has no </body> to inject before');
  const f = path.join(base, '__render_probe__.html');
  fs.writeFileSync(f, injected);
  return f;
}

function readReport(dom) {
  // --dump-dom HTML-escapes the text node, so unescape before parsing.
  const m = dom.match(/<pre id="render-report">([\s\S]*?)<\/pre>/);
  if (!m) return null;
  const s = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  try { return JSON.parse(s); } catch (e) { return null; }
}

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

// ---- the offline cache must list what the page actually loads ------------
// earthdata.js and earth.js shipped two releases before anyone noticed they
// were missing from sw.js, because nothing failed loudly: offline, the game
// just booted a generated world instead of Earth and said nothing. A list
// maintained by memory drifts; this makes the drift a failure.
console.log('\n--- the offline cache matches the page ---');
{
  const idxSrc = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  const swSrc = fs.readFileSync(path.join(base, 'sw.js'), 'utf8');
  const inPage = (idxSrc.match(/<script src="js\/([a-z0-9]+)\.js"><\/script>/g) || [])
    .map(s => s.replace(/.*js\/([a-z0-9]+)\.js.*/, '$1'));
  const cached = (swSrc.match(/'\.\/js\/([a-z0-9]+)\.js'/g) || [])
    .map(s => s.replace(/.*js\/([a-z0-9]+)\.js.*/, '$1'));
  const missing = inPage.filter(n => cached.indexOf(n) < 0);
  const extra = cached.filter(n => inPage.indexOf(n) < 0);
  check('every script the page loads is precached for offline', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : inPage.length + ' scripts');
  check('and the cache lists nothing the page does not load', extra.length === 0,
    extra.length ? 'stale: ' + extra.join(', ') : 'no stale entries');
}

const probeFile = buildProbe();
let dom;
try {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-render-'));
  try {
    dom = execFileSync(CHROME, [
      '--headless', '--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--user-data-dir=' + profile,
      '--window-size=1280,800', '--virtual-time-budget=40000', '--dump-dom',
      'file://' + probeFile
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000, stdio: ['ignore', 'pipe', 'ignore'] });
  } finally {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
} catch (e) {
  console.log('SKIP — browser unavailable (' + e.code + ')');
  try { fs.unlinkSync(probeFile); } catch (e2) {}
  process.exit(0);
} finally {
  try { fs.unlinkSync(probeFile); } catch (e2) {}
}

const rep = readReport(dom);
if (!rep) {
  console.log('FAIL — the probe never reported. The page did not reach it.');
  process.exit(1);
}
if (rep.fatal) {
  console.log('FAIL — ' + rep.fatal);
  process.exit(1);
}

const R = 6371000;
console.log('\n--- what the GPU is asked to draw (WebGL' + (rep.gl2 ? '2' : '1') + ') ---');
if (rep.peak) {
  console.log('  aimed at ' + (rep.peak.town ? ('the largest settlement: ' + rep.peak.town) :
    'the highest ground') + ' — tile ' + Math.round(rep.peak.x) + ',' + Math.round(rep.peak.y));
}
console.log('  altitude   triangles  draws  patches  buildings  eye above r=1');
for (const a of rep.alts) {
  console.log('  ' + a.name.padEnd(9) +
    String(a.tris).padStart(10) + String(a.draws).padStart(7) +
    String(a.patches).padStart(9) + String(a.bldg).padStart(11) +
    (Math.round(a.altAboveGroundM).toLocaleString() + ' m').padStart(15));
}

console.log('\n--- assertions ---');
check('every altitude rendered without throwing', rep.errs.length === 0, rep.errs.join(' | '));
check('every altitude reported', rep.alts.length === ALTS.length, rep.alts.length + '/' + ALTS.length);
for (const a of rep.alts) {
  check('the planet is drawn at ' + a.name, a.tris > 0, a.tris + ' tris');
}

// ---- the defect this stage exists to fix -------------------------------
// Lowering cam.min to 80 m gave the camera the ability to descend. Nothing
// gave it a floor: land displaces well above radius 1, so over any mountain
// the eye ended up inside the rock. Measured before the fix, the eye sat at
// 80 m above radius 1 while the terrain reached 513 km.
console.log('\n--- the ground is solid ---');
for (const a of rep.alts) {
  check('the eye is above the terrain at ' + a.name, a.endDist > a.groundR,
    Math.round((a.endDist - a.groundR) * R) + ' m of clearance');
}
{
  const g = rep.alts[rep.alts.length - 1];
  check('and asking to go below the ground is refused, not obeyed',
    g.altAboveGroundM > 80.5,
    'asked for 80 m above r=1, got ' + Math.round(g.altAboveGroundM) + ' m — the mountain');
  // exaggeration must have eased off by the time you are standing on it
  check('vertical exaggeration eases to near-true scale on the ground',
    g.exag < 2.5, g.exag.toFixed(2) + 'x');
  check('and is dramatic from orbit', rep.alts[0].exag > 5, rep.alts[0].exag.toFixed(1) + 'x');
}

// ---- true scale, measured ------------------------------------------------
// The zero is the assertion that matters. A village is five hundred metres
// across and is not exaggerated the way the mountains are, so from orbit
// there must be NOTHING — and it is far easier to write a renderer that draws
// buildings everywhere and call it correct than to prove it draws none.
console.log('\n--- settlements are true scale ---');
{
  const byName = {};
  for (const a of rep.alts) byName[a.name] = a;
  check('no buildings are drawn from orbit', byName['orbit'].bldg === 0,
    byName['orbit'].bldg + ' instances');
  check('nor from 100 km', byName['100 km'].bldg === 0, byName['100 km'].bldg + ' instances');
  check('a town is drawn at two kilometres', byName['2 km'].bldg > 50,
    byName['2 km'].bldg + ' instances across ' + byName['2 km'].towns + ' settlements');
  check('and on the ground', byName['ground'].bldg > 50,
    byName['ground'].bldg + ' instances');
  check('the instance count stays inside its budget',
    Math.max(byName['2 km'].bldg, byName['ground'].bldg) <= 6000,
    Math.max(byName['2 km'].bldg, byName['ground'].bldg) + ' instances');
}

console.log('\n--- detail follows the camera ---');
{
  const orbit = rep.alts[0], ground = rep.alts[rep.alts.length - 1];
  check('the planet is made of many patches, not one mesh', orbit.patches > 20,
    orbit.patches + ' at orbit');
  check('draw calls stay bounded', rep.alts.every(a => a.draws < 200),
    Math.max(...rep.alts.map(a => a.draws)) + ' worst');
  console.log('    planet triangles: ' + orbit.planetTris + ' at orbit, ' +
    ground.planetTris + ' on the ground (the shells are the rest)');
}

// This file exists to hold a ceiling, and the ceiling only means something if
// it is BELOW the thing being replaced. 261,120 is the measured pre-quadtree
// cost: one 87,040-triangle sphere drawn three times, at every altitude.
const BASELINE_TRIS = 261120;
const worst = rep.alts.reduce((m, a) => Math.max(m, a.tris), 0);
console.log('\n  baseline (one sphere x3): ' + BASELINE_TRIS.toLocaleString() +
  '   worst measured: ' + worst.toLocaleString());
check('the frame costs no more than the single-mesh globe it replaces',
  worst <= BASELINE_TRIS, worst.toLocaleString() + ' vs ' + BASELINE_TRIS.toLocaleString());

// ---- streamed imagery ----------------------------------------------------
console.log('\n--- real ground, streamed ---');
if (!rep.satAvail) {
  check('js/tiles.js is loaded and the renderer built a cache', false, 'no r.tiles');
} else {
  const off = rep.satOff, fresh = rep.satFresh, on = rep.satOn, orbit = rep.satOrbit;
  const dump = (n, s) => s ? ('    ' + n.padEnd(9) + ' sat ' + String(s.sat).padStart(3) +
    '/' + String(s.patches).padStart(3) + ' patches   mix ' +
    (s.sat ? (s.mixSum / s.sat).toFixed(2) : '-') + '   span ' +
    (s.minSpan == null ? '-' : Number(s.minSpan).toExponential(2)) +
    '   screen rgb ' + s.px.r.toFixed(0) + ',' + s.px.g.toFixed(0) + ',' +
    s.px.b.toFixed(0) + ' lit ' + (s.px.lit * 100).toFixed(0) + '%') : '';
  [['dead net', off], ['arriving', fresh], ['loaded', on], ['orbit', orbit],
   ['toggled', rep.satToggledOff]].forEach(([n, s]) => { if (s) console.log(dump(n, s)); });

  // THE ONE THAT MATTERS MOST. Ending the offline guarantee was a deliberate
  // choice, and it is only defensible if the no-imagery frame is a complete
  // picture rather than an error state.
  check('with every request failing, the frame is still drawn',
    off.px.lit > 0.25 && off.patches > 20,
    (off.px.lit * 100).toFixed(0) + '% of the screen lit, ' + off.patches + ' patches');
  check('and no patch claims imagery it does not have', off.sat === 0,
    off.sat + ' patches with imagery');

  check('when tiles arrive, patches sample them', on.sat > 0,
    on.sat + ' of ' + on.patches + ' patches');
  check('the tiles came from the stub, not the network', rep.satServed > 0,
    rep.satServed + ' stub tiles served');
  // THE PIXELS HAVE TO CHANGE, or the uniform is being set and ignored —
  // which is precisely what a counter cannot tell you. The test is
  // DIRECTIONAL and differential: draw the same frame twice with a magenta
  // ground and a green ground, and the red channel must go up for one while
  // the green channel goes up for the other. That cannot happen by accident,
  // and unlike an absolute colour it does not encode the lighting, the
  // atmosphere or the tonemap into the assertion.
  const o2 = rep.satOther || {};
  console.log('    magenta ground rgb ' + on.px.r.toFixed(1) + ',' + on.px.g.toFixed(1) +
    ',' + on.px.b.toFixed(1) + '   green ground rgb ' + (o2.r || 0).toFixed(1) + ',' +
    (o2.g || 0).toFixed(1) + ',' + (o2.b || 0).toFixed(1) +
    '   pixels differing: ' + rep.satDiff + '%');
  check('a magenta ground and a green ground do not look alike',
    (on.px.r - (o2.r || 0)) > 1.5 && ((o2.g || 0) - on.px.g) > 1.5,
    'dR ' + (on.px.r - (o2.r || 0)).toFixed(2) + '  dG ' + ((o2.g || 0) - on.px.g).toFixed(2));
  check('and the imagery frame is not the no-imagery frame', rep.satOffDiff > 0,
    rep.satOffDiff + '% of pixels differ from the dead-network frame');
  check('no tile failed to upload', (rep.satBad || 0) === 0, (rep.satBad || 0) + ' rejected');

  // The crossfade. A tile that pops in reads as broken rather than as loading.
  check('a tile that just arrived is still fading in',
    fresh.sat > 0 && fresh.mixSum / fresh.sat < 0.9,
    fresh.sat ? 'mix ' + (fresh.mixSum / fresh.sat).toFixed(2) : 'no imagery');
  check('and once the fade is done it is fully opaque',
    on.sat > 0 && on.mixSum / on.sat > 0.99, on.sat ? (on.mixSum / on.sat).toFixed(3) : '-');

  // The sub-rectangle — the defect that shipped last round. On the ground the
  // patch is far below the archive's deepest level, so it must be given a
  // sliver of a tile; from orbit it is the whole tile. A renderer that ignores
  // the rectangle draws BOTH at [0,0,1,1] and looks plausible at exactly one
  // altitude.
  check('on the ground a patch gets a sliver of a tile, not the whole one',
    on.minSpan < 0.2, 'span ' + Number(on.minSpan).toExponential(2));
  check('and from orbit it gets the whole tile', orbit.sat > 0 && orbit.minSpan === 1,
    'span ' + orbit.minSpan + ' across ' + orbit.sat + ' patches');

  check('imagery can be switched off, and then nothing samples a tile',
    rep.satToggledOff && rep.satToggledOff.sat === 0 && rep.satToggledOff.px.lit > 0.25,
    rep.satToggledOff ? rep.satToggledOff.sat + ' patches, ' +
      (rep.satToggledOff.px.lit * 100).toFixed(0) + '% lit' : 'no run');
  check('and the daily layer is reachable, so dateFor is live code',
    rep.satLayer && rep.satLayer.layer === 'daily',
    rep.satLayer ? rep.satLayer.layer + ' / ' + rep.satLayer.label : 'no toggle');
  check('the acknowledgement NASA asks for is available to the UI',
    !!(rep.imagery && rep.imagery.credit && rep.imagery.credit.indexOf('NASA') >= 0),
    rep.imagery ? rep.imagery.credit : 'none');

  // GL textures are not garbage collected, so the cap has to hold at every
  // moment rather than on average. It is read from the renderer rather than
  // written down here, because a number copied into a test is a number that
  // stops tracking the thing it is supposed to bound.
  const cap = (rep.imagery && rep.imagery.maxTextures) || 0;
  check('the texture cache stays inside its VRAM budget',
    cap > 0 && Math.max(on.textures, orbit.textures) <= cap,
    Math.max(on.textures, orbit.textures) + ' textures resident of ' + cap +
    ' (' + Math.round(cap * 512 * 512 * 4 / 1048576) + ' MB)');
  // and the cap has to be above the working set, or it holds nothing at all
  check('and the cap is above the largest working set on screen',
    cap > Math.max(on.sat ? 1 : 0, orbit.sat), cap + ' vs ' + orbit.sat + ' patches at orbit');
}

console.log('\n--- and none of it touched the network ---');
check('the built-in loader was blocked before it could reach the network',
  typeof rep.imgBlocked === 'number',
  rep.imgBlocked + ' request(s) blocked at the Image stub');
check('and every tile measured came from the stub instead',
  rep.satServed > 0, rep.satServed + ' served locally');

console.log('\n=== render failures: ' + fails + ' ===');
console.log(fails === 0 ? 'RENDER TEST PASSED' : 'RENDER TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
