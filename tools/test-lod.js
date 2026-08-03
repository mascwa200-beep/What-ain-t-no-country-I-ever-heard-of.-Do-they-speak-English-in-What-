// The quadtree, exercised directly.
//
// js/lod.js makes no GL calls precisely so this can exist. Split/merge
// hysteresis, horizon culling and bounding-sphere containment are the kind of
// logic that is impossible to eyeball in a moving picture and trivial to
// assert here — and every one of them fails silently in a way that looks like
// "the renderer is a bit slow" or "there was a flicker".
//
// Usage: node tools/test-lod.js [repoRoot]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.argv[2] || '.';

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, Date, Error,
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, ArrayBuffer,
  setTimeout: () => 0, clearTimeout: () => 0,
  performance: { now: () => Number(process.hrtime.bigint()) / 1e6 }
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(ctx);
for (const f of ['util.js', 'world.js', 'lod.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'js', f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD, LOD = PD.LOD, W = PD.World;

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

const R = LOD.R_EARTH_M;
const world = W.createWorld(180, 120, 'lodtest', {});

// A view at a given altitude over a given lon/lat. No frustum matrix: these
// tests are about the tree, and passing planes:null exercises the horizon
// cull on its own, which is the part that removes the far hemisphere.
function viewAt(lon, lat, altM, screenH) {
  const d = 1 + altM / R;
  const cl = Math.cos(lat);
  return {
    eye: [d * cl * Math.sin(lon), d * Math.sin(lat), d * cl * Math.cos(lon)],
    fov: 0.9, screenH: screenH || 800, vp: null
  };
}
function settle(tree, view, frames) {
  let last = [];
  for (let i = 0; i < (frames || 80); i++) last = LOD.update(tree, view);
  return last;
}

// ---------------------------------------------------------------------------
console.log('\n--- the grid ---');
{
  const G = LOD.GRID;
  const N = LOD.N;
  check('17x17 interior grid', N === 17, N + 'x' + N);
  // This used to assert G.uv.length === N*N*2 — which is the DEFECT, written
  // down as the specification. The draw indexes up to nVerts, so a UV buffer
  // that stops at the interior grid leaves every skirt vertex reading past the
  // end and getting (0,0). WebGL's robust access makes that silent, and against
  // a 27 km/pixel bake it was invisible; against real imagery it is a
  // mis-coloured band along every LOD boundary.
  check('every vertex the draw touches has a UV, skirt included',
    G.uv.length === G.nVerts * 2 && G.nVerts === Math.max(...G.idx) + 1,
    G.uv.length / 2 + ' uvs for ' + G.nVerts + ' vertices, max index ' + Math.max(...G.idx));
  {
    // and a skirt vertex must sample the same texel as the edge vertex it
    // hangs from, or the curtain is a different colour from the ground
    let bad = 0;
    for (let k = 0; k < G.ring.length; k++) {
      const s = G.ring[k] * 2, d = (N * N + k) * 2;
      if (G.uv[s] !== G.uv[d] || G.uv[s + 1] !== G.uv[d + 1]) bad++;
    }
    check('the skirt samples what it hangs from', bad === 0, bad + ' of ' + G.ring.length + ' wrong');
  }
  check('the ring visits every border vertex exactly once',
    G.ring.length === 4 * N - 4 && new Set(G.ring).size === 4 * N - 4,
    G.ring.length + ' of ' + (4 * N - 4));
  const tris = G.nIdx / 3;
  check('640 triangles per patch (512 surface + 128 skirt)', tris === 640, String(tris));
  // 16-bit indices are the WebGL1 floor; a grid that overflows them would
  // render as garbage on exactly the devices least able to report it.
  check('every index fits in 16 bits', G.nVerts <= 65535 && G.idx instanceof ctx.Uint16Array,
    G.nVerts + ' verts');
  // The whole triangle budget rests on this arithmetic.
  check('the patch budget stays under the 87,040-triangle mesh it replaces',
    LOD.MAX_PATCHES * tris <= 87040 * 1.0,
    (LOD.MAX_PATCHES * tris).toLocaleString() + ' vs 87,040');
}

// ---------------------------------------------------------------------------
console.log('\n--- the tree covers the sphere, once ---');
{
  const tree = LOD.createTree(world, 7);
  settle(tree, viewAt(1.2, 0.3, 400000), 60);

  // Collect ALL leaves, not just the visible ones — coverage is a property of
  // the tree, and the visible list is deliberately a subset of it.
  const leaves = [];
  (function walk(p) { if (p.children) p.children.forEach(walk); else leaves.push(p); })
    ({ children: tree.roots });

  let area = 0;
  for (const p of leaves) area += p.lonSpan * p.latSpan;
  // 2pi x pi is the whole equirectangular domain
  check('the leaves tile the entire lon/lat domain',
    Math.abs(area - Math.PI * Math.PI * 2) < 1e-9,
    area.toFixed(6) + ' vs ' + (Math.PI * Math.PI * 2).toFixed(6));

  // Sample points must land in exactly one leaf. Equal area could still hide
  // a gap paired with an overlap, so this is not the same assertion twice.
  let bad = 0, worst = null;
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 4000; i++) {
    const lon = rnd() * Math.PI * 2, lat = (rnd() - 0.5) * Math.PI;
    let hits = 0;
    for (const p of leaves) {
      if (lon >= p.lon0 && lon < p.lon0 + p.lonSpan &&
          lat >= p.lat0 && lat < p.lat0 + p.latSpan) hits++;
    }
    if (hits !== 1) { bad++; if (!worst) worst = { lon, lat, hits }; }
  }
  check('every point is in exactly one leaf — no gap, no overlap', bad === 0,
    bad + '/4000' + (worst ? ' e.g. ' + worst.hits + ' hits' : ''));

  // The seam this design deletes rather than fixes.
  const straddles = leaves.filter(p =>
    (p.lon0 < 0 && p.lon0 + p.lonSpan > 0) ||
    (p.lon0 < Math.PI && p.lon0 + p.lonSpan > Math.PI) ||
    (p.lon0 < Math.PI * 2 && p.lon0 + p.lonSpan > Math.PI * 2));
  check('no patch spans the antimeridian or the prime meridian',
    straddles.length === 0, straddles.length + ' straddling');
}

// ---------------------------------------------------------------------------
console.log('\n--- the polar cap holds ---');
{
  const tree = LOD.createTree(world, 7);
  // stare straight down at the north pole from low altitude — the case that
  // would otherwise subdivide slivers forever
  settle(tree, viewAt(0, Math.PI / 2 - 0.01, 20000), 120);
  const leaves = [];
  (function walk(p) { if (p.children) p.children.forEach(walk); else leaves.push(p); })
    ({ children: tree.roots });
  const over = leaves.filter(p => {
    const worst = Math.max(Math.abs(p.lat0), Math.abs(p.lat0 + p.latSpan));
    return worst > LOD.POLE_LAT && p.level > LOD.POLE_MAX_LEVEL;
  });
  check('nothing above 80 deg subdivides past level ' + LOD.POLE_MAX_LEVEL,
    over.length === 0, over.length + ' too deep');
}

// ---------------------------------------------------------------------------
console.log('\n--- the hysteresis band is real, and it is measured ---');
{
  // The first version of this block flew a camera in and out by half a
  // percent and asserted the tree did not churn. It passed — and it passed
  // just as happily with the hysteresis removed, because a drifting camera
  // never reliably lands on any particular patch's threshold. It asserted
  // nothing. Same fault as every other proxy measurement in this project:
  // watching a symptom that has more than one cause.
  //
  // So measure the band directly. A patch splits above SPLIT_PX and merges
  // below SPLIT_PX * MERGE_K; size goes as 1/distance, so those two sizes are
  // two distances, and the ratio between them IS the hysteresis.
  const tree = LOD.createTree(world, 7);
  settle(tree, viewAt(1.2, 0.3, 300000), 60);
  const p = tree.visible[0];
  const dirn = [p.centre[0], p.centre[1], p.centre[2]];
  const sizeAtDist = (d) => LOD.projectedSize(
    p, [dirn[0] * d, dirn[1] * d, dirn[2] * d], Math.tan(0.45), 800, 1);
  const solve = (target) => {          // size is monotonic in distance
    let lo = 1.0000001, hi = 40;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (sizeAtDist(mid) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const dSplit = solve(LOD.SPLIT_PX);
  const dMerge = solve(LOD.SPLIT_PX * LOD.MERGE_K);
  const band = (dMerge - 1) / (dSplit - 1);
  console.log('    splits closer than ' + Math.round((dSplit - 1) * R / 1000) +
    ' km, merges beyond ' + Math.round((dMerge - 1) * R / 1000) + ' km');
  check('there is a band where nothing happens at all', band > 1.5,
    band.toFixed(2) + 'x in camera distance');
  check('and it matches 1/MERGE_K, so the constant is the thing controlling it',
    Math.abs(band - 1 / LOD.MERGE_K) < 0.25,
    band.toFixed(2) + ' vs ' + (1 / LOD.MERGE_K).toFixed(2));

  // Now the behavioural half, driven to the thresholds rather than near them:
  // a camera parked anywhere strictly inside the band must not move the tree.
  const lonlat = LOD.lonLatToTile(world, 0, 0);   // (unused, kept for clarity)
  const at = (d) => {
    const v = { eye: [dirn[0] * d, dirn[1] * d, dirn[2] * d], fov: 0.9, screenH: 800, vp: null, exag: 1 };
    return v;
  };
  // Different patches have their thresholds at different distances, so this
  // has to settle over the WHOLE wander range before it measures — otherwise
  // it counts the tree still converging and calls that thrash. With
  // hysteresis a settled state over the range exists; without it (MERGE_K 1)
  // none does and the churn never stops, which is the difference being
  // asserted.
  const t2 = LOD.createTree(world, 7);
  const wander = (i) => at(dSplit + (dMerge - dSplit) * (0.5 + 0.5 * Math.sin(i * 1.1)) * 0.95);
  for (let i = 0; i < 400; i++) LOD.update(t2, wander(i));
  const before = t2.stats.splits + t2.stats.merges;
  for (let i = 0; i < 80; i++) LOD.update(t2, wander(i));
  const churn = t2.stats.splits + t2.stats.merges - before;
  check('once settled, a camera wandering inside the band changes nothing',
    churn === 0, churn + ' split/merge events in 80 frames');

  // and leaving the band must move it, or the check above is vacuous
  const b2 = t2.stats.splits + t2.stats.merges;
  for (let i = 0; i < 40; i++) LOD.update(t2, at(i % 2 ? dMerge * 4 : dSplit * 0.4));
  check('but crossing both thresholds does move it',
    t2.stats.splits + t2.stats.merges - b2 > 0,
    (t2.stats.splits + t2.stats.merges - b2) + ' events');
}

// ---------------------------------------------------------------------------
console.log('\n--- a descent from orbit to the ground ---');
{
  const tree = LOD.createTree(world, 7);
  let maxPatches = 0, maxTris = 0, minPatches = 1e9;
  const rows = [];
  const alts = [1600000, 800000, 400000, 200000, 100000, 40000, 10000, 2000, 400, 80];
  for (const altM of alts) {
    const v = viewAt(1.2, 0.3, altM);
    const vis = settle(tree, v, 40);
    maxPatches = Math.max(maxPatches, vis.length);
    minPatches = Math.min(minPatches, vis.length);
    maxTris = Math.max(maxTris, tree.stats.tris);
    let deepest = 0;
    for (const p of vis) deepest = Math.max(deepest, p.level);
    rows.push({ altM, n: vis.length, tris: tree.stats.tris, deepest, culled: tree.stats.culled });
  }
  console.log('    altitude      patches      tris   deepest   culled');
  for (const r of rows) {
    console.log('    ' + (r.altM.toLocaleString() + ' m').padStart(12) +
      String(r.n).padStart(11) + String(r.tris).padStart(10) +
      String(r.deepest).padStart(10) + String(r.culled).padStart(9));
  }
  check('the patch count never exceeds the budget', maxPatches <= LOD.MAX_PATCHES,
    maxPatches + ' / ' + LOD.MAX_PATCHES);
  check('something is always visible', minPatches > 0, String(minPatches));
  check('the frame is cheaper than the 261,120-triangle globe it replaces',
    maxTris < 261120, maxTris.toLocaleString() + ' worst');
  check('and cheaper than the single 87,040-triangle sphere too',
    maxTris <= 87040, maxTris.toLocaleString());
  // The point of the whole exercise, in metres rather than in levels. The
  // mesh being replaced was 156,000 m per quad at every altitude — from
  // orbit and standing on the ground alike.
  const quadAt = (lvl) => 20038000 / Math.pow(2, lvl) / LOD.NQ;
  const ground = rows[rows.length - 1], orbit = rows[0];
  const gq = quadAt(ground.deepest), oq = quadAt(orbit.deepest);
  console.log('    (one quad: ' + oq.toFixed(0) + ' m from orbit, ' + gq.toFixed(0) +
    ' m on the ground — it was 156,000 m at both before)');
  check('detail follows the camera down', ground.deepest >= orbit.deepest + 4,
    'level ' + orbit.deepest + ' -> ' + ground.deepest +
    ' (' + (oq / gq).toFixed(0) + 'x finer)');
  check('a quad on the ground is under 200 m', gq < 200, gq.toFixed(0) + ' m');
  // No altitude may be WORSE than the mesh being replaced. The bar is not
  // higher than that on purpose: from 1,600 km a 19.5 km quad already lands
  // at roughly one pixel, so demanding more there would be demanding waste.
  // The gain is meant to be where the camera is, and the line above measures
  // that.
  let worstQuad = 0;
  for (const r of rows) worstQuad = Math.max(worstQuad, quadAt(r.deepest));
  check('no altitude is coarser than the old uniform mesh',
    worstQuad < 156000, (156000 / worstQuad).toFixed(0) + 'x finer at worst');
}

// ---------------------------------------------------------------------------
console.log('\n--- the horizon cull actually removes the far side ---');
{
  const tree = LOD.createTree(world, 7);
  const v = viewAt(1.2, 0.3, 300000);
  settle(tree, v, 60);
  const eyeLen = Math.hypot(v.eye[0], v.eye[1], v.eye[2]);
  // The exaggeration matters: the cull ran at the frame's exag, so asking the
  // question at exag 1 is a different question and the mismatch reads as a
  // leak that is not there.
  const ex = tree.stats.exag;
  let leaked = 0;
  for (const p of tree.visible) if (LOD.beyondHorizon(p, v.eye, eyeLen, ex)) leaked++;
  check('no drawn patch is behind the horizon', leaked === 0, leaked + ' leaked');
  check('and the cull is doing real work', tree.stats.culled > 0,
    tree.stats.culled + ' patches culled');

  // the antipode must always be culled — if this passes trivially the test
  // above is worth nothing
  const u = [-v.eye[0] / eyeLen, -v.eye[1] / eyeLen, -v.eye[2] / eyeLen];
  const anti = {
    centre: u, net: [u[0], u[1], u[2]], maxLift: 0.001,
    spread: 0.01, drop: 0.001, lonSpan: 0.02, latSpan: 0.02
  };
  check('the point directly opposite the camera is culled',
    LOD.beyondHorizon(anti, v.eye, eyeLen, 1));
  // and the point directly beneath it is not
  const below = {
    centre: [-u[0], -u[1], -u[2]], net: [-u[0], -u[1], -u[2]], maxLift: 0.001,
    spread: 0.01, drop: 0.001, lonSpan: 0.02, latSpan: 0.02
  };
  check('the point directly beneath the camera is not culled',
    !LOD.beyondHorizon(below, v.eye, eyeLen, 1));
}

// ---------------------------------------------------------------------------
console.log('\n--- bounding spheres contain what they claim to ---');
{
  const tree = LOD.createTree(world, 7);
  settle(tree, viewAt(2.4, -0.4, 150000), 60);
  // The bound is a function of exaggeration, so containment has to hold at
  // every exaggeration the camera can produce — not just the one this frame
  // happened to use.
  let bad = 0, worstOver = 0;
  for (const exag of [LOD.EXAG_NEAR, 1, 5, 20, LOD.EXAG_FAR]) {
    const rad = (p) => LOD.radiusAt(p, exag);
    for (const p of tree.visible) {
      for (let k = 0; k < p.base.length / 3; k++) {
        const x = p.base[k * 3] + p.up[k * 3] * exag;
        const y = p.base[k * 3 + 1] + p.up[k * 3 + 1] * exag;
        const z = p.base[k * 3 + 2] + p.up[k * 3 + 2] * exag;
        const d = Math.sqrt(x * x + y * y + z * z);   // base is centre-relative
        if (d > rad(p)) { bad++; worstOver = Math.max(worstOver, d / rad(p)); }
      }
    }
  }
  check('no vertex escapes its own bounding sphere, at any exaggeration', bad === 0,
    bad + ' escapees' + (bad ? ', worst ' + worstOver.toFixed(3) + 'x' : ''));

  // An unbuilt patch estimates its peak from a 9x9 sample of the world, then
  // buildPatch replaces that estimate with the truth — including the relief
  // the patch invents. If the estimate can come in UNDER the truth, then for
  // as long as a patch is unbuilt its bounding sphere is too small and it can
  // be culled while visible. That failure is invisible in every other
  // assertion here, because they all run after the estimate is overwritten.
  let short = 0, worstShort = 1;
  const probe = LOD.createTree(world, 7);
  (function collect(p, depth) {
    if (depth > 7) return;
    LOD.bound(probe, p);
    const est = p.maxLift;
    LOD.buildPatch(probe, p);
    if (p.maxLift > est) { short++; worstShort = Math.max(worstShort, p.maxLift / est); }
    if (depth < 7) {
      LOD.split(probe, p);
      if (p.children) for (const c of p.children) collect(c, depth + 1);
    }
  })(probe.roots[0], 0);
  check('the sampled height estimate never underestimates the real peak',
    short === 0, short + ' too small' + (short ? ', worst ' + worstShort.toFixed(2) + 'x' : ''));
}

// ---------------------------------------------------------------------------
console.log('\n--- exaggeration, and the ground being solid ---');
{
  // From orbit the silhouette should be dramatic; on the ground it should be
  // honest. Both are what the request asked for, and they are the same knob.
  const far = LOD.exagFor(1 + 1600000 / R);
  const near = LOD.exagFor(1 + 80 / R);
  // Dramatic, but not a sea urchin. The upper bound is as much a requirement
  // as the lower one: past ~20x the relief starts dominating every patch's
  // bounding sphere and the tree subdivides for height instead of for width.
  check('orbit keeps a dramatic vertical exaggeration', far > 5 && far < 20,
    far.toFixed(1) + 'x');
  check('the ground is nearly true scale', near < 2.5, near.toFixed(2) + 'x');
  {
    const everestKm = LOD.liftOf(1.0) * R * far / 1000;
    check('Everest reads as a mountain from orbit, not as a spike',
      everestKm > 50 && everestKm < 150, everestKm.toFixed(0) + ' km (was 513 km)');
  }
  check('and it is monotonic in between', (() => {
    let prev = 1e9;
    for (const a of [2e6, 1e6, 6e5, 3e5, 1e5, 3e4, 1e4, 1e3, 80]) {
      const e = LOD.exagFor(1 + a / R);
      if (e > prev + 1e-9) return false;
      prev = e;
    }
    return true;
  })());

  // Everest at 8,850 m must not become a mountain from space at close range.
  const everestM = LOD.liftOf(1.0) * R;
  check('full elevation is the real height of the tallest mountain',
    Math.abs(everestM - 8850) < 1, everestM.toFixed(0) + ' m');
  check('and at ground exaggeration it stays believable',
    everestM * near < 25000, Math.round(everestM * near) + ' m');
  // the number the old renderer produced, for contrast
  console.log('    (the fixed 0.13 displacement made it ' +
    Math.round(0.13 * (1 - 0.38) * R) + ' m — a 513 km mountain)');

  // groundRadius is the function the camera clamp uses. If it can ever return
  // less than 1 over land, the clamp lets the camera under the terrain.
  let under = 0, hi = 0;
  for (let i = 0; i < 2000; i++) {
    const lon = (i / 2000) * Math.PI * 2, lat = ((i * 7919) % 1000 / 1000 - 0.5) * 3;
    const g = LOD.groundRadius(world, lon, lat, LOD.EXAG_FAR);
    if (g < 1) under++;
    hi = Math.max(hi, g);
  }
  check('the ground is never below the sphere', under === 0, under + ' below');
  check('and never above the bound the patches were sized for',
    hi <= 1 + (8850 / R) * LOD.EXAG_FAR + 1e-9, ((hi - 1) * R / 1000).toFixed(0) + ' km peak');
}

// ---------------------------------------------------------------------------
console.log('\n--- the UV mapping the fragment shader depends on ---');
{
  // FS_PLANET, updateClim and updateDataTex all sample a GLOBAL equirect UV.
  // If a patch hands over the wrong one, the terrain map is fine and the
  // planet still renders — with the wrong ground in the wrong place.
  const tree = LOD.createTree(world, 7);
  settle(tree, viewAt(1.2, 0.3, 300000), 40);
  let bad = 0;
  for (const p of tree.visible) {
    const uv = LOD.patchUV(p);
    // grid (0,0) is at (lon0, lat0); grid (1,1) is at the far corner
    const expect = (lon, lat) => [
      lon / (Math.PI * 2), (Math.PI / 2 - lat) / Math.PI
    ];
    const a = expect(p.lon0, p.lat0);
    const b = expect(p.lon0 + p.lonSpan, p.lat0 + p.latSpan);
    if (Math.abs(uv.u0 - a[0]) > 1e-12 || Math.abs(uv.v0 - a[1]) > 1e-12) bad++;
    if (Math.abs((uv.u0 + uv.du) - b[0]) > 1e-12 ||
        Math.abs((uv.v0 + uv.dv) - b[1]) > 1e-12) bad++;
  }
  check('patch UV corners match the global equirect mapping', bad === 0, bad + ' wrong');
  check('dv is negative — the grid runs south to north, v runs north to south',
    tree.visible.every(p => LOD.patchUV(p).dv < 0));
  // every UV stays in [0,1], which is what makes CLAMP_TO_EDGE harmless
  let oob = 0;
  for (const p of tree.visible) {
    const uv = LOD.patchUV(p);
    for (const u of [uv.u0, uv.u0 + uv.du]) if (u < -1e-9 || u > 1 + 1e-9) oob++;
    for (const v of [uv.v0, uv.v0 + uv.dv]) if (v < -1e-9 || v > 1 + 1e-9) oob++;
  }
  check('and every UV stays inside [0,1]', oob === 0, oob + ' out of range');
}

// ---------------------------------------------------------------------------
console.log('\n--- sub-tile relief is invention, and stays modest ---');
{
  // The honest part of this stage: below level 2 the tree has no data, so it
  // synthesises. That synthesis must not put hills in the sea or turn plains
  // into badlands, or the planet stops being Earth.
  const tree = LOD.createTree(world, 7);
  let seaBump = 0, maxBumpM = 0;
  for (let i = 0; i < 3000; i++) {
    const lon = (i / 3000) * Math.PI * 2;
    const lat = ((i * 7919) % 997 / 997 - 0.5) * 2.8;
    const e = LOD.elevAt(world, lon, lat);
    const d = tree.detail(world, lon, lat, 12, e);
    if (e <= LOD.SEA && d !== 0) seaBump++;
    maxBumpM = Math.max(maxBumpM, Math.abs(d) / (1 - LOD.SEA) * 8850);
  }
  check('the ocean gets no invented relief', seaBump === 0, seaBump + ' bumps at sea');
  check('invented relief stays under 600 m', maxBumpM < 600, maxBumpM.toFixed(0) + ' m worst');

  // DETAIL_MAX is not a comment, it is the height headroom every bounding
  // sphere is sized with. So it has to hold at EVERY level, not just the one
  // sampled above — a future amplitude tweak that only misbehaves at level 18
  // would silently under-bound every deep patch.
  let over = 0, worstLvl = 0, worstM = 0;
  for (let lvl = 3; lvl <= LOD.MAX_LEVEL; lvl++) {
    for (let i = 0; i < 400; i++) {
      const lon = (i / 400) * Math.PI * 2;
      const lat = ((i * 7919) % 997 / 997 - 0.5) * 2.8;
      const e = LOD.elevAt(world, lon, lat);
      const m = Math.abs(tree.detail(world, lon, lat, lvl, e)) / (1 - LOD.SEA) * 8850;
      if (m > 600) { over++; if (m > worstM) { worstM = m; worstLvl = lvl; } }
    }
  }
  check('and holds at every level from 3 to ' + LOD.MAX_LEVEL, over === 0,
    over ? worstM.toFixed(0) + ' m at level ' + worstLvl : 'ceiling respected throughout');
  check('coarse patches get none at all',
    tree.detail(world, 1.2, 0.3, 2, 0.8) === 0 && tree.detail(world, 1.2, 0.3, 0, 0.8) === 0);
  check('fine patches over land do get some',
    tree.detail(world, 1.2, 0.3, 14, 0.9) !== 0 ||
    tree.detail(world, 2.2, -0.3, 14, 0.9) !== 0);
}

// ---------------------------------------------------------------------------
console.log('\n--- elevation is interpolated, not stepped ---');
{
  // The mesh being replaced sampled `w.elev[idx(tx|0, ty|0)]` — nearest
  // neighbour. At 156 km per quad nobody could tell. At 76 m per quad it is a
  // 222 km-wide plateau with a cliff at every tile edge, and the ground looks
  // like a staircase made of continents.
  const w2 = W.createWorld(180, 120, 'interp', {});
  // Sample across the STEEPEST adjacent pair rather than the first one over
  // some threshold — a threshold that no pair happens to clear leaves the
  // rest of this block asserting things about a flat patch of ocean, which is
  // the sort of test that passes because it is measuring nothing.
  let x = 1, y = 1, best = -1;
  for (let ty = 1; ty < 118; ty++) {
    for (let tx = 1; tx < 178; tx++) {
      const d = Math.abs(w2.elev[ty * 180 + tx] - w2.elev[(ty + 1) * 180 + tx]);
      if (d > best) { best = d; x = tx; y = ty; }
    }
  }
  check('found a real step to sample across', best > 0.02,
    'tile ' + x + ',' + y + ', step ' + best.toFixed(3));
  const a = LOD.elevAtTile(w2, x, y), b = LOD.elevAtTile(w2, x, y + 1);
  const mid = LOD.elevAtTile(w2, x, y + 0.5);
  check('a sample halfway between two tiles is halfway between their heights',
    Math.abs(mid - (a + b) / 2) < 1e-5,
    mid.toFixed(4) + ' vs ' + ((a + b) / 2).toFixed(4));
  const midX = LOD.elevAtTile(w2, x + 0.5, y);
  const rightV = LOD.elevAtTile(w2, x + 1, y);
  check('and the same holds across x', Math.abs(midX - (a + rightV) / 2) < 1e-5,
    midX.toFixed(4) + ' vs ' + ((a + rightV) / 2).toFixed(4));
  // x must wrap: the last column's right neighbour is column 0
  const wrapMid = LOD.elevAtTile(w2, 179.5, y);
  const c0 = LOD.elevAtTile(w2, 0, y), c179 = LOD.elevAtTile(w2, 179, y);
  check('and x wraps around the planet', Math.abs(wrapMid - (c0 + c179) / 2) < 1e-5,
    wrapMid.toFixed(4) + ' vs ' + ((c0 + c179) / 2).toFixed(4));
}

// ---------------------------------------------------------------------------
console.log('\n--- editing the world rebuilds the terrain ---');
{
  const tree = LOD.createTree(world, 7);
  const v = viewAt(1.2, 0.3, 200000);
  settle(tree, v, 60);
  const p = tree.visible[0];
  const before = p.up.slice(0, 12);
  const t = LOD.lonLatToTile(world, p.lon0 + p.lonSpan / 2, p.lat0 + p.latSpan / 2);
  // raise(w, cx, cy, RADIUS, AMOUNT) — radius comes first. Getting that
  // backwards raises exactly one tile by a clamped 1.0 and the patch corner
  // never moves, which reads as "invalidate is broken".
  W.raise(world, t.tx | 0, t.ty | 0, 12, 0.4);
  LOD.invalidate(tree);
  settle(tree, v, 3);
  let moved = false;
  for (let i = 0; i < 12; i++) if (Math.abs(p.up[i] - before[i]) > 1e-9) moved = true;
  check('a raised mountain shows up in the geometry', moved);
  check('and the patch version tracks the world', p.version === tree.version,
    p.version + ' vs ' + tree.version);
}

console.log('\n=== lod failures: ' + fails + ' ===');
console.log(fails === 0 ? 'LOD TEST PASSED' : 'LOD TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
