// The profiler has to actually measure, and the two defects it was added
// alongside have to stay fixed.
//
// This project had no timing instrumentation of any kind, which meant every
// performance claim about it was an argument rather than a measurement. A
// profiler that silently records nothing would be worse than none at all, so
// the first thing asserted here is that it notices work.
//
// Usage: node tools/test-perf.js [repoRoot]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.argv[2] || '.';

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, Date, Error,
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer,
  setTimeout: () => 0, clearTimeout: () => 0, setInterval: () => 0, clearInterval: () => 0,
  performance: { now: () => Number(process.hrtime.bigint()) / 1e6 }
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(ctx);
for (const f of ['util.js', 'world.js', 'sim.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'js', f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD, Prof = PD.Prof, W = PD.World;

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

console.log('\n--- the profiler measures ---');
Prof.reset();
check('starts empty', Prof.lines().length === 0);

// burn a known, unmistakable amount of time
function burn(ms) {
  const t = Number(process.hrtime.bigint()) / 1e6;
  let x = 0;
  while (Number(process.hrtime.bigint()) / 1e6 - t < ms) x += Math.sqrt(x + 1);
  return x;
}
Prof.begin('slow'); burn(12); Prof.end();
Prof.begin('fast'); burn(1); Prof.end();
Prof.frame();

check('records a span it was given', Prof.ema.slow != null, JSON.stringify(Prof.ema.slow));
check('the measured time is real, not zero', Prof.ema.slow > 1,
  Prof.ema.slow.toFixed(2) + 'ms for a 12ms burn');
check('it can tell a slow span from a fast one', Prof.ema.slow > Prof.ema.fast,
  Prof.ema.slow.toFixed(2) + ' vs ' + Prof.ema.fast.toFixed(2));
check('lines() reports slowest first', Prof.lines()[0].indexOf('slow') === 0, Prof.lines().join(' | '));

// nesting must not corrupt the stack
Prof.reset();
Prof.begin('outer'); burn(2); Prof.begin('inner'); burn(4); Prof.end(); Prof.end();
Prof.frame();
check('nested spans both record', Prof.ema.outer != null && Prof.ema.inner != null);
check('the inner span is inside the outer one', Prof.ema.inner > 1, Prof.ema.inner.toFixed(2) + 'ms');

// counters
Prof.reset();
Prof.add('tiles'); Prof.add('tiles'); Prof.add('tiles', 5); Prof.n('live', 42);
check('counters accumulate', Prof.count.tiles === 7, String(Prof.count.tiles));
check('counters can be set outright', Prof.count.live === 42, String(Prof.count.live));

// an unbalanced end() must not throw or poison later spans — a renderer that
// returns early through a path without its end() should degrade, not crash
Prof.reset();
Prof.end(); Prof.end();
Prof.begin('after'); burn(2); Prof.end(); Prof.frame();
check('survives an unbalanced end()', Prof.ema.after > 0.5, String(Prof.ema.after));

console.log('\n--- it measures the real simulation ---');
{
  Prof.reset();
  const world = W.createWorld(180, 120, 'perf', {});
  let s = 5; const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const sim = PD.Sim.createSim(world, rng);
  for (let i = 0; i < 40; i++) PD.Sim.spawnUnit(sim, 'human', 40 + (i % 8), 40 + ((i / 8) | 0));
  Prof.begin('sim'); for (let t = 0; t < 300; t++) PD.Sim.step(sim, 1); Prof.end();
  Prof.frame();
  check('300 sim steps take a measurable time', Prof.ema.sim > 5,
    Prof.ema.sim.toFixed(0) + 'ms for 300 steps');
  console.log('    (' + (Prof.ema.sim / 300).toFixed(2) + ' ms/step at ' + sim.units.length + ' units)');
}

// ---- the two defects Stage 0 fixed --------------------------------------
console.log('\n--- the defects stay fixed ---');
{
  const src = fs.readFileSync(path.join(base, 'js', 'render3d.js'), 'utf8');

  // A structure is looked up by WHICH TILE a pixel is in — a floor, not a
  // round. The + 0.5 shifted every rooftop half a tile off the town it
  // belonged to. The terrain path's - 0.5 is bilinear alignment and is fine.
  check('rooftops are not sampled half a tile off',
    !/struct\[srow \+ \(\(px \* invHD \+ 0\.5\)/.test(src) &&
    /struct\[srow \+ \(\(px \* invHD\) \| 0\)/.test(src));
  check('the structure ROW is floored too',
    !/const sy = \(py \* invHD \+ 0\.5\) \| 0;/.test(src) &&
    /const sy = \(py \* invHD\) \| 0;/.test(src));

  // flyTo framed the antipode of whatever it was asked to look at, which
  // nobody noticed because it was exported and never called.
  const fly = src.slice(src.indexOf('function flyTo'), src.indexOf('function flyTo') + 900);
  check('flyTo no longer aims at the antipode',
    /const lon = \(tx \/ w\.W\) \* Math\.PI \* 2;/.test(fly) && !/\* 2 \+ Math\.PI;/.test(fly));

  // and the profiler must be wired into the paths that actually cost time
  for (const span of ['bake.full', 'bake.tiles', 'upd.clim', 'upd.data', 'draw']) {
    check("the renderer times '" + span + "'", src.indexOf("Prof.begin('" + span + "')") >= 0);
  }
  const gsrc = fs.readFileSync(path.join(base, 'js', 'game.js'), 'utf8');
  check("the game times 'sim.step'", gsrc.indexOf("Prof.begin('sim.step')") >= 0);
}

console.log('\n=== perf failures: ' + fails + ' ===');
console.log(fails === 0 ? 'PERF TEST PASSED' : 'PERF TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
