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
      for (var s = 0; s < 200; s++) {
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
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, stdio: ['ignore', 'pipe', 'ignore'] });
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

console.log('\n=== render failures: ' + fails + ' ===');
console.log(fails === 0 ? 'RENDER TEST PASSED' : 'RENDER TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
