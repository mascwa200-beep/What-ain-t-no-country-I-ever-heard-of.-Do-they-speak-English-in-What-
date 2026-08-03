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
    for (var i = 0; i < ALTS.length; i++) {
      var a = ALTS[i];
      var d = 1 + a.m / R;
      // Set BOTH the target and the smoothed value: stepCam eases toward the
      // target, so a probe that only sets cam.dist measures wherever the
      // easing happened to be, not the altitude it asked for.
      r.cam.dist = r.cam.sDist = d;
      r.cam.lon = r.cam.sLon = 1.5;      // over land, not mid-Pacific
      r.cam.lat = r.cam.sLat = 0.5;
      r.cam.flyDur = 0;
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
        // where the camera ENDED UP, which is not where we put it if
        // anything clamps it — that is the terrain-collision signal
        endDist: r.cam.dist,
        altAboveGroundM: (r.cam.dist - 1) * R
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

console.log('\n--- what the GPU is asked to draw (WebGL' + (rep.gl2 ? '2' : '1') + ') ---');
console.log('  altitude     triangles   draws   patches   eye above r=1');
for (const a of rep.alts) {
  console.log('  ' + a.name.padEnd(11) +
    String(a.tris).padStart(9) + String(a.draws).padStart(8) +
    String(a.patches).padStart(10) +
    ('  ' + Math.round(a.altAboveGroundM).toLocaleString() + ' m').padStart(18));
}

console.log('\n--- assertions ---');
check('every altitude rendered without throwing', rep.errs.length === 0, rep.errs.join(' | '));
check('all three altitudes reported', rep.alts.length === ALTS.length, rep.alts.length + '/' + ALTS.length);
for (const a of rep.alts) {
  check('the planet is drawn at ' + a.name, a.tris > 0, a.tris + ' tris');
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
