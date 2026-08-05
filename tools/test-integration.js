// Full integration test: run boot() + several frames against a stub DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const base = process.argv[2];

function makeCtx2D() {
  const noop = () => {};
  const handler = {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'createImageData' || prop === 'getImageData')
        return (w, h) => ({ data: new Uint8ClampedArray((Math.abs(w|0)||1) * (Math.abs(h|0)||1) * 4), width: w, height: h });
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient')
        return () => ({ addColorStop: noop });
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'putImageData') return noop;
      return noop; // any other method
    },
    set(t, p, v) { t[p] = v; return true; }
  };
  return new Proxy({ canvas: null }, handler);
}

function makeEl(tag) {
  const el = {
    tagName: tag, _html: '', _text: '',
    classList: { _s: new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, toggle(c,f){ if(f===undefined) f=!this._s.has(c); f?this._s.add(c):this._s.delete(c); return f;}, contains(c){return this._s.has(c);} },
    style: {}, dataset: {},
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    addEventListener: () => {}, removeEventListener: () => {},
    appendChild: (c) => c, removeChild: () => {}, setAttribute: () => {}, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    querySelector: () => makeEl('div'),
    querySelectorAll: () => [],
    focus: () => {}, blur: () => {}, remove: () => {},
    getContext: () => { const c = makeCtx2D(); return c; }
  };
  Object.defineProperty(el, 'innerHTML', { get(){return this._html;}, set(v){this._html=v;} });
  Object.defineProperty(el, 'textContent', { get(){return this._text;}, set(v){this._text=v;} });
  Object.defineProperty(el, 'onclick', { get(){return this._onclick;}, set(v){this._onclick=v;} });
  return el;
}

const elCache = {};
function query(sel) {
  if (!elCache[sel]) { const e = makeEl('div'); if (sel === '#game') e.getContext = () => makeCtx2D(); elCache[sel] = e; }
  return elCache[sel];
}

// speed buttons + tools need arrays with forEach and dataset
function queryAll(sel) {
  if (sel === '.speed-btn') return [0,1,2,4].map(s => { const e = makeEl('button'); e.dataset.speed = String(s); return e; });
  if (sel === '.tool') return []; // rebuilt dynamically; highlight loop tolerates empty
  return [];
}

const ctx = {};
ctx.window = ctx; ctx.globalThis = ctx; ctx.console = console;
ctx.performance = { now: () => Date.now() };
ctx.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
ctx.atob = (s) => Buffer.from(s, 'base64').toString('binary');
ctx.devicePixelRatio = 1;
ctx.setInterval = () => 0; ctx.clearInterval = () => {};
ctx.setTimeout = (fn) => 0; ctx.clearTimeout = () => {};
ctx.alert = () => {}; ctx.confirm = () => true; ctx.prompt = () => 'seed-xyz';
const store = {};
ctx.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = '' + v; }, removeItem: (k) => { delete store[k]; } };
let rafQueue = [];
ctx.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
ctx.cancelAnimationFrame = () => {};
ctx.addEventListener = () => {};
ctx.document = {
  readyState: 'complete',
  querySelector: query,
  querySelectorAll: queryAll,
  createElement: (t) => { const e = makeEl(t); if (t === 'canvas') e.getContext = () => makeCtx2D(); return e; },
  addEventListener: (ev, fn) => {},
  getElementById: (id) => query('#' + id),
  body: makeEl('body'), hidden: false
};
vm.createContext(ctx);

// DERIVED FROM THE PAGE, not maintained by hand.
//
// This list was written out by hand and had drifted badly: it was missing
// earth.js, earthdata.js, tiles.js, lod.js, buildings.js and history.js. So
// the suite that claims to test "boot, loop, powers, save/load" had never once
// booted the world the game actually ships — with no earth.js the Earth type
// falls back to a generated planet, silently, exactly as the sw.js omission
// did two releases ago. tools/test-render.js already asserts sw.js against
// these same tags; this reads them.
const indexSrc = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
const files = (indexSrc.match(/<script src="js\/([a-z0-9]+)\.js"><\/script>/g) || [])
  .map((t) => t.replace(/.*js\/([a-z0-9]+)\.js.*/, '$1') + '.js');
if (files.length < 10) throw new Error('could not read the script list from index.html');
// game.js boots on evaluation, and boot() DEFERS on the Earth height field:
// it is gzipped and decodes through DecompressionStream, which this sandbox
// does not have, so the world would still be null when the next line reads it.
// Seed the decoded grid first and boot takes the synchronous path — which also
// means this suite finally boots the real Earth instead of a generated stand-in.
for (const f of files) {
  if (f === 'game.js') {
    try {
      const D = ctx.PD.EarthData;
      const raw = new Uint8Array(zlib.gunzipSync(Buffer.from(D.z, 'base64')));
      if (!ctx.PD.Earth.useGrid(raw, D.W, D.H)) throw new Error('grid rejected');
      console.log('earth height field seeded:', D.W + 'x' + D.H);
    } catch (e) {
      console.log('earth height field unavailable (' + e.message + ') — booting generated');
    }
  }
  const code = fs.readFileSync(path.join(base, 'js', f), 'utf8');
  vm.runInContext(code, ctx, { filename: f });
}
console.log('all files loaded, boot() ran');
const G = ctx.G;
console.log('world:', !!G.world, 'sim units:', G.sim.units.length, 'villages:', G.sim.villages.length, 'faith:', Math.floor(G.faith));

// pump animation frames
let frames = 0;
for (let f = 0; f < 20 && rafQueue.length; f++) {
  const cb = rafQueue.shift();
  cb(Date.now() + f * 16);
  frames++;
}
console.log('pumped frames:', frames);

// exercise powers via the game path (set power + apply)
const PD = ctx.PD;
let applied = 0;
for (const p of PD.Powers.POWERS) {
  G.power = Object.assign({}, p);
  const spent = p.apply(G, 90, 60);
  applied++;
}
console.log('powers applied via game path:', applied);

// test save then load roundtrip through localStorage
const okSave = ctx.PixelDeity.save();
console.log('save ok:', okSave, 'bytes:', (store['pixeldeity_save_v2']||'').length);
// simulate reload: re-run load
const okLoad = ctx.PixelDeity.load();
console.log('load ok:', okLoad, 'units after load:', G.sim.units.length, 'villages:', G.sim.villages.length);

// pump a few more frames post-load
for (let f = 0; f < 10 && rafQueue.length; f++) { const cb = rafQueue.shift(); cb(Date.now()); }
console.log('post-load frames pumped, units:', G.sim.units.length);


// ============ TIME DIAL / REWIND / GENESIS ============
function countWater(w) {
  let n = 0;
  for (let i = 0; i < w.n; i++) if (w.biome[i] === PD.World.B.WATER || w.biome[i] === PD.World.B.DEEP) n++;
  return n;
}

console.log('\n--- time dial ---');
const G2 = ctx.G;
const scales = [];
for (let i=0;i<12;i++){ ctx.PixelDeity.G && null; }
// sweep every stop on the dial
let dialErrs=0;
for (let i=0;i<12;i++){
  try{
    // setSpeedIdx is internal; drive it the way the UI does
    G2.speedIdx=i; 
    const cb=rafQueue.shift(); if(cb) cb(Date.now());
  }catch(e){ dialErrs++; console.error('dial idx',i,e.message); }
}
console.log('dial sweep errors:', dialErrs);

// record rewind frames by running forward
console.log('\n--- rewind ---');
G2.speed = 1; G2.paused=false; G2.speedIdx=7;
const tickBefore = G2.sim.tick;
for (let i=0;i<400;i++){ const cb=rafQueue.shift(); if(cb) cb(Date.now()+i*100); else break; }
console.log('ticks advanced:', G2.sim.tick - tickBefore,
            '| fine frames:', G2.rewind.fine.length, '| full frames:', G2.rewind.full.length);
const peakTick = G2.sim.tick, peakFaith = G2.faith;
// now reverse
G2.speed = -10; G2.speedIdx = 2;
let reverseErr=null;
try{ for (let i=0;i<200;i++){ const cb=rafQueue.shift(); if(cb) cb(Date.now()+40000+i*100); else break; } }
catch(e){ reverseErr=e; }
console.log('reverse errors:', reverseErr?reverseErr.message:'none');
console.log('tick went', peakTick, '->', G2.sim.tick, '(decreased:', G2.sim.tick < peakTick, ')');
console.log('faith went', Math.floor(peakFaith), '->', Math.floor(G2.faith));

// ---- invariants a rewind must never violate ----
let invFails = 0;
function icheck(name, cond) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) invFails++;
}
icheck('no exception while reversing', !reverseErr);
icheck('time actually moved backwards', G2.sim.tick < peakTick);
// restoring a snapshot rebuilds every unit; a bad merge shows up as clones
const ids = new Set(); let dupes = 0;
for (const u of G2.sim.units) { if (ids.has(u.id)) dupes++; ids.add(u.id); }
icheck('no duplicated unit ids after restore (' + dupes + ' dupes)', dupes === 0);
// fine frames older than the oldest restore point are unusable — they must
// never outlive it, or rewinding walks people around a world that moved on
icheck('fine frames never outlive the restore points',
       !(G2.rewind.fine.length && !G2.rewind.full.length));
if (G2.rewind.fine.length && G2.rewind.full.length) {
  icheck('oldest fine frame is not older than the oldest restore point',
         G2.rewind.fine[0].tick >= G2.rewind.full[0].tick);
}
icheck('every living unit is on the map',
       G2.sim.units.every(u => u.dead || (u.x >= 0 && u.x <= G2.world.W && u.y >= 0 && u.y <= G2.world.H)));
console.log('rewind invariant failures:', invFails);

// ============ FX RIBBONS ============
// gl.lineWidth(>1) is a no-op in modern browsers, so lightning and shockwaves
// used to draw as 1px hairlines. They are camera-facing quads now — pure
// geometry, so it is checkable without a GPU.
// ---------------------------------------------------------------------------
// AND IT CAME TO PASS
//
// The record does not merely announce itself: an event that names a power
// invokes it. The two assertions that matter are the ones that could each be
// true while the feature is broken —
//
//   * the world must actually CHANGE (an announcement is not an event), and
//   * the world must NOT be marked forked (the record acting is not the god
//     acting, and if those are confused then travelling anywhere instantly
//     ends the timeline you went to see).
console.log('\n--- and it came to pass ---');
let recFails = 0;
function recCheck(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) recFails++;
}
{
  const check = recCheck;
  const H = PD.History;
  if (!H) { recCheck('js/history.js loaded', false); }
  else {
    // Every enactable event must name a power the game really has, and none of
    // them may be one of the seven days: those belong to the creationStage
    // sequence that un-creation gates, and firing one at a running world would
    // fight machinery that already has its own order.
    let unknown = 0, genesisDay = 0;
    for (const e of H.SCRIPTURE.concat(H.RECORD)) {
      if (!H.enactable(e)) continue;
      if (!PD.Powers.BY_ID[e.power]) unknown++;
      if (/^gen_/.test(e.power)) genesisDay++;
    }
    check('every enactable event names a power the game has', unknown === 0, unknown + ' unknown');
    check('and the seven days are announced, never enacted', genesisDay === 0,
      genesisDay + ' would fire');

    // Travel to just before the Flood and let the clock cross it.
    const before = G.world ? countWater(G.world) : 0;
    const p = G.travelToYear ? G.travelToYear(-2360) : null;
    check('travelling to a year produces a world', !!p, p ? p.name : 'none');
    if (p) {
      check('and it is not forked on arrival', p.forked === false, String(p.forked));
      const flood = H.SCRIPTURE.find((e) => e.power === 'flood');
      flood.done = false;                       // a fresh run of the record
      // WITH AN EMPTY PURSE. The first version of this left the player's faith
      // wherever it happened to be — 173, against the Flood's cost of 120 — so
      // the Flood fired out of the player's own faith and the assertion could
      // not tell that apart from the record lending itself the cost. Removing
      // the lending entirely changed nothing and the suite said PASS.
      G.faith = 0;
      // step the clock across 2348 BC the way the dial does
      G.sim.clock += PD.Sim.YEAR * 20;
      G._histSeen = -2360;
      G.fireHistory && G.fireHistory();
      check('the Flood happens even with no faith to pay for it',
        G.floodT > 0 || flood.done === true,
        'floodT ' + (G.floodT || 0) + ', done ' + flood.done + ', faith ' + G.faith);
      // THE ONE THAT MATTERS: the record is not the god.
      check('and the record acting did NOT fork the timeline', p.forked === false,
        String(p.forked));
      check('and what was written cost you nothing', G.faith === 0, 'faith ' + G.faith);
    }

    // Doing it yourself, at the right time and place, FULFILS rather than forks.
    {
      const q = G.travelToYear ? G.travelToYear(-1491) : null;   // Sinai
      if (q) {
        const sinai = H.SCRIPTURE.find((e) => e.power === 'commandments');
        sinai.done = false;
        const x = Math.floor(((sinai.lon + 180) / 360) * G.world.W);
        const y = Math.floor(((90 - sinai.lat) / 180) * G.world.H);
        const pw = PD.Powers.BY_ID.commandments;
        G.faith = 5000;
        G._lastActAt = { x, y };
        G.power = Object.assign({}, pw);
        const spent = pw.apply(G, x, y);
        G.onPowerUsed && G.onPowerUsed(pw, spent);
        check('the right act at the right time and place fulfils the record',
          q.forked === false, q.forked ? 'forked' : 'held the true timeline');

        // ...and the wrong moment does not.
        const r2 = G.travelToYear ? G.travelToYear(1800) : null;
        if (r2) {
          const px = 90, py = 60;
          G.faith = 5000;
          G._lastActAt = { x: px, y: py };
          G.power = Object.assign({}, pw);
          const s2 = pw.apply(G, px, py);
          G.onPowerUsed && G.onPowerUsed(pw, s2);
          check('but the same act in the wrong age forks it', r2.forked === true,
            r2.forked ? 'forked' : 'still on the record');
        }
      }
    }
  }
}

console.log('record failures:', recFails);

console.log('\n--- fx ribbons ---');
let ribFails = 0;
function rcheck(name, cond) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) ribFails++;
}
{
  const RQ = PD.Render.ribbonQuad;
  const eye = [0, 0, 4];
  const mk = () => ({ verts: [], cols: [], edges: [] });
  let o = mk();
  const ok = RQ(o, [-1, 0, 0], [1, 0, 0], eye, [1, 1, 1], 1, 8);
  rcheck('a segment produces a quad', ok === true);
  rcheck('two triangles, six vertices', o.verts.length === 18 && o.edges.length === 6);
  rcheck('every coordinate is finite', o.verts.every(v => Number.isFinite(v)));
  rcheck('edges span -1..1 for the soft shoulder',
         Math.min(...o.edges) === -1 && Math.max(...o.edges) === 1);
  // the quad must be perpendicular to the view, i.e. offset along y here
  const spread = Math.max(...o.verts.filter((_, i) => i % 3 === 1)) -
                 Math.min(...o.verts.filter((_, i) => i % 3 === 1));
  rcheck('the ribbon has real width (' + spread.toFixed(4) + ')', spread > 1e-4);
  // width must grow with distance so apparent thickness stays constant
  let o2 = mk();
  RQ(o2, [-1, 0, 0], [1, 0, 0], [0, 0, 40], [1, 1, 1], 1, 8);
  const spread2 = Math.max(...o2.verts.filter((_, i) => i % 3 === 1)) -
                  Math.min(...o2.verts.filter((_, i) => i % 3 === 1));
  rcheck('width scales with camera distance (' + spread.toFixed(3) + ' -> ' + spread2.toFixed(3) + ')',
         spread2 > spread * 5);
  // a segment pointing straight at the camera has no valid facing quad
  let o3 = mk();
  const degen = RQ(o3, [0, 0, 0], [0, 0, 1], [0, 0, 4], [1, 1, 1], 1, 8);
  rcheck('a view-aligned segment is skipped, not NaN', degen === false && o3.verts.length === 0);
  let o4 = mk();
  const zero = RQ(o4, [1, 2, 3], [1, 2, 3], eye, [1, 1, 1], 1, 8);
  rcheck('a zero-length segment is skipped', zero === false && o4.verts.length === 0);
}
console.log('fx ribbon failures:', ribFails);

// ---- ONE monotonic clock for every section below ----
// rAF timestamps never run backwards in a real browser, and loop() computes
// dt from them. A section that runs its own clock ahead of this one leaves
// every later section feeding the loop a NEGATIVE dt, which silently freezes
// the HUD timer and the story. Everything past here shares `pump`.
let clock = Date.now() + 80000;
function pump(n, stepMs) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift(); if (!cb) break;
    clock += (stepMs || 100); cb(clock);
  }
}

// ============ DEEP ARCHIVE: reversal must reach the first morning ============
// The fine+full buffers only span ~13 in-game years. A world that has run for
// centuries must still rewind all the way back, through the thinned archive.
console.log('\n--- deep archive ---');
let archFails = 0;
function acheck(name, cond) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) archFails++;
}
{
  // run a fresh world hard enough to age it well past the detailed record
  ctx.PixelDeity.newMultiverse('archive-seed');
  const A = ctx.G;
  A.speed = 1; A.paused = false; A.speedIdx = 7;
  // drive the sim directly so the test isn't at the mercy of the frame budget
  for (let i = 0; i < 9000; i++) {
    PD.Sim.step(A.sim, 1);
    ctx.PixelDeity.recordRewind(PD.Cosmos.active());
  }
  const peakTick = A.sim.tick, peakYear = Math.floor(peakTick / 120);
  console.log('aged world to year', peakYear, '| fine', A.rewind.fine.length,
              'full', A.rewind.full.length, 'arch', A.rewind.arch.length);
  acheck('archive filled and stayed within its cap', A.rewind.arch.length > 8 && A.rewind.arch.length <= 28);
  acheck('archive is ordered oldest-first',
         A.rewind.arch.every((f,i,a) => i === 0 || f.tick > a[i-1].tick));
  // the detailed record alone cannot reach anywhere near the beginning
  const detailedSpan = peakTick - (A.rewind.full[0] ? A.rewind.full[0].tick : peakTick);
  acheck('detailed record spans far less than the world\'s life (' +
         Math.floor(detailedSpan/120) + 'y of ' + peakYear + 'y)', detailedSpan < peakTick / 2);
  const arch = A.rewind.arch;
  acheck('the world\'s earliest recorded moment is kept',
         arch.length > 0 && arch[0].tick <= 1200);

  // Thinning only bites past the cap, which needs a world older than any test
  // wants to simulate — so exercise it directly on synthetic ticks. This is
  // the property that lets 28 slots cover a world of any age.
  {
    const CAP = ctx.PixelDeity.REWIND.archCap, EVERY = ctx.PixelDeity.REWIND.archEvery;
    const a = [];
    for (let t = 0; t <= EVERY * 500; t += EVERY) {   // a 2500-year world
      a.push({ tick: t });
      ctx.PixelDeity.thinArchive(a, t);
    }
    const now = a[a.length - 1].tick;
    console.log('  thinned 500 ages ->', a.length, 'slots, spanning year 0 to',
                Math.floor(now / 120));
    acheck('thinning holds the cap', a.length <= CAP);
    acheck('the first morning is never thinned away', a[0].tick === 0);
    acheck('the present is never thinned away', a[a.length - 1].tick === now);
    acheck('entries stay ordered', a.every((f,i) => i === 0 || f.tick > a[i-1].tick));
    const oldGap = a[1].tick - a[0].tick;
    const newGap = a[a.length-1].tick - a[a.length-2].tick;
    console.log('  spacing: oldest gap', oldGap, 'ticks | newest gap', newGap, 'ticks');
    acheck('antiquity is stored more sparsely than living memory (' +
           oldGap + ' vs ' + newGap + ')', oldGap > newGap);
  }

  // now actually rewind: it must walk back through the ages, not un-create
  A.speed = -100; A.speedIdx = 1;
  let guard = 0;
  while (A.rewind.arch.length && guard++ < 4000) pump(1, 100);
  console.log('after reversing: year', Math.floor(A.sim.tick/120),
              '| arch left', A.rewind.arch.length, '| mode', A.world.mode,
              '| inArchive', A.rewind.inArchive);
  acheck('reversal consumed the whole archive', A.rewind.arch.length === 0);
  acheck('reversal reached the world\'s first years',
         Math.floor(A.sim.tick / 120) < Math.max(20, peakYear * 0.15));
  acheck('the world was NOT un-created along the way', A.world.mode !== 'nothing' && A.world.mode !== 'deep');
  acheck('units survived every archive restore', A.sim.units.length > 0);
  const aids = new Set(); let adup = 0;
  for (const u of A.sim.units) { if (aids.has(u.id)) adup++; aids.add(u.id); }
  acheck('no duplicated unit ids after archive restores (' + adup + ')', adup === 0);
}
console.log('deep archive failures:', archFails);

// ---- un-creation must be armed, not stumbled into ----
console.log('\n--- un-creation gate ---');
let gateFails = 0;
function gcheck(name, cond) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) gateFails++;
}
// the record is already spent from the reverse run above
gcheck('record is exhausted', G2.rewind.fine.length === 0);
// 1. a non-Unmaking reverse speed must stop at the floor, not destroy anything
G2.speed = -10; G2.speedIdx = 2;
pump(40);
gcheck('reverse at -10x stops at the floor', G2.rewind.atFloor === true);
gcheck('reverse at -10x does NOT begin un-creation', G2.rewind.armed === false);
gcheck('the world is untouched at the floor', G2.world.mode !== 'deep' && G2.world.mode !== 'nothing');

// 2. the Unmaking notch arms, but only after a sustained hold
G2.speed = -1000; G2.speedIdx = 0;
pump(8);   // ~0.8s of a 2s hold
gcheck('a short hold only partly arms', G2.rewind.arm > 0 && G2.rewind.arm < 1);
gcheck('a short hold destroys nothing', G2.rewind.armed === false);

// 3. letting go of the notch abandons the hold
G2.speed = -10; G2.speedIdx = 2;
pump(2);
gcheck('leaving the notch resets the hold', G2.rewind.arm === 0);

// 4. hold it properly — the world comes apart, and an undo is banked
G2.speed = -1000; G2.speedIdx = 0;
pump(30);
gcheck('a sustained hold arms the unmaking', G2.rewind.armed === true);
gcheck('an undo snapshot was taken before anything was lost', !!G2.rewind.undo);

console.log('\n--- un-creation ---');
pump(600, 200);
console.log('rewind stage:', G2.rewind.stage, '| world.mode:', G2.world.mode,
            '| dissolve:', (G2.dissolve||0).toFixed(2), '| creationStage:', G2.creationStage);
gcheck('un-creation reaches Nothing', G2.world.mode === 'nothing' && G2.creationStage === 0);

// 5. and it can be taken back
console.log('\n--- undo the unmaking ---');
const undoOk = G2.undoUnmaking();
console.log('after undo: mode', G2.world.mode, 'creationStage', G2.creationStage,
            'living units', G2.sim.units.filter(u=>!u.dead).length);
gcheck('undo succeeded', undoOk === true);
gcheck('the world is restored', G2.world.mode !== 'nothing' && G2.world.mode !== 'deep');
gcheck('creation is no longer in progress', G2.creationStage == null);
gcheck('the world has living things again', G2.sim.units.filter(u=>!u.dead).length > 0);
gcheck('undo is spent, not reusable', G2.rewind.undo === null);
console.log('un-creation gate failures:', gateFails);

// put it back in the void for the save tests below
G2.speed = -1000; G2.speedIdx = 0;
pump(700, 200);
console.log('re-unmade: mode', G2.world.mode, 'creationStage', G2.creationStage);

// ============ SOFT-LOCK REGRESSION ============
// Saving while the world is un-created must not strand the player in an empty
// universe with no Genesis powers and no time. packPlanet persists world.mode,
// so if G.creationStage isn't persisted (or recovered) the save is unplayable.
console.log('\n--- soft-lock regression ---');
let softFails = 0;
function genesisPowersFor(stage) {
  return PD.Powers.POWERS.filter(x => x.cat === 'genesis' && x.stage === stage);
}
// the exact gate buildToolbar() uses
function toolbarHasGenesis() {
  return G2.creationStage != null && genesisPowersFor(G2.creationStage).length > 0;
}
function check(name, cond) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) softFails++;
}

// make sure we really are in the un-created state before testing the save
if (G2.world.mode !== 'nothing') { G2.world.mode = 'nothing'; }
if (G2.creationStage == null) { G2.creationStage = 0; G2.dissolve = 1; }
console.log('pre-save: mode', G2.world.mode, 'creationStage', G2.creationStage,
            'toolbar has Genesis:', toolbarHasGenesis());

const savedOk = ctx.PixelDeity.save();
const rawSave = store['pixeldeity_save_v2'] || '';
check('save() succeeded during un-creation', savedOk && rawSave.length > 0);

// Case 1 — a save written by THIS build must reload playable.
// Simulate a cold boot: the fields a fresh G starts with.
G2.creationStage = null; G2.dissolve = 0; G2.omniscient = false;
G2.speed = 1; G2.speedIdx = 7; G2.paused = false;
ctx.PixelDeity.load();
console.log('after reload: mode', G2.world.mode, 'creationStage', G2.creationStage,
            'speed', G2.speed, 'speedIdx', G2.speedIdx);
check('creationStage survives the reload', G2.creationStage != null);
check('Genesis powers are reachable after reload', toolbarHasGenesis());
// the dial and the clock must never disagree: speedIdx is the source of truth
const TS = [-1000,-100,-10,-1,0,0.1,0.25,1,5,25,100,1000];
check('speedIdx agrees with speed after reload', TS[G2.speedIdx] === G2.speed);
check('paused flag agrees with speed', G2.paused === (G2.speed === 0));
check('time is held still until creation finishes', G2.speed === 0);
let g0 = null;
try { g0 = G2.genesisStep(0); } catch (e) { g0 = 'threw: ' + e.message; }
check('genesisStep(0) works on the reloaded save', g0 === 0 && G2.creationStage === 1);

// Case 2 — a save written by the ALREADY-SHIPPED build (no new fields at all)
// must be rescued by the world.mode recovery guard.
console.log('  -- legacy save (no creation fields) --');
const legacy = JSON.parse(rawSave);
delete legacy.creationStage; delete legacy.dissolve;
delete legacy.omniscient; delete legacy.sabbath; delete legacy.speedIdx;
store['pixeldeity_save_v2'] = JSON.stringify(legacy);
G2.creationStage = null; G2.dissolve = 0;
G2.speed = 1; G2.speedIdx = 7; G2.paused = false;
ctx.PixelDeity.load();
console.log('legacy reload: mode', G2.world.mode, 'creationStage', G2.creationStage);
check('legacy soft-locked save is recovered from world.mode', G2.creationStage != null);
check('legacy save reaches the Genesis toolbar', toolbarHasGenesis());
check('legacy save has time held still', G2.speed === 0);
check('rewind buffer is valid after any load', !!(G2.rewind && G2.rewind.fine));

console.log('soft-lock regression failures:', softFails);

// ---- Genesis: speak it all back into being ----
console.log('\n--- genesis ---');
if (G2.creationStage == null) { G2.creationStage = 0; G2.dissolve = 1; }
let genErr=null;
try{
  for (let st=0; st<7; st++){
    const before = G2.creationStage;
    G2.genesisStep(st);
    console.log('  step',st,'->creationStage',G2.creationStage,'mode',G2.world.mode);
    if (st<6 && G2.creationStage === before) throw new Error('stage did not advance at '+st);
  }
}catch(e){ genErr=e; }
console.log('genesis errors:', genErr?genErr.message:'none');
PD.Sim.recount(G2.sim);
const pop = Object.entries(G2.sim.counts).filter(([k,v])=>v>0);
console.log('after creation: villages', G2.sim.villages.length, '| living:', JSON.stringify(Object.fromEntries(pop)));
console.log('creationStage now:', G2.creationStage, '(null = done)');

// ============ TESTAMENT: the new chapters ============
// The flags below are set ONLY by real gameplay paths — setSpeedIdx when the
// dial goes negative, stepUncreate when the world dissolves, genesisStep(6)
// when creation finishes. The test never sets them.
console.log('\n--- testament ---');
let storyFails = 0;
function scheck(name, cond) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) storyFails++;
}
scheck('XIII trigger fired from reversing time', G2._reversed === true);
scheck('XIV trigger fired from reaching Nothing', G2._sawNothing === true);
scheck('XV trigger fired from completing creation', G2._recreated === true);

// drive the story to chapter XIII and let the loop unlock the last three
G2.story.active = 12; G2.story.done = {};
G2.speed = 1; G2.speedIdx = 7; G2.paused = false;
pump(120);   // shared monotonic clock — rAF timestamps never run backwards
const done = Object.keys(G2.story.done);
console.log('chapters unlocked by the loop:', done.join(', ') || '(none)');
scheck('XIII. Turn Back unlocks', !!G2.story.done.turnback);
scheck('XIV. Before the Beginning unlocks', !!G2.story.done.before);
scheck('XV. Let There Be Light unlocks', !!G2.story.done.recreate);
console.log('testament failures:', storyFails);

const totalFails = invFails + ribFails + archFails + softFails + gateFails + storyFails + recFails;
console.log('\n=== assertion failures: ' + totalFails + ' ===');
console.log('INTEGRATION TEST ' + (totalFails ? 'FAILED' : 'PASSED') +
            ' — boot, loop, powers, save/load, rewind, un-creation, genesis, story.');
if (totalFails) process.exitCode = 1;
