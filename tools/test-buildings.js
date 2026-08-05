// Settlements as buildings, and the rule that nothing floats.
//
// Two things are asserted here and they are different in kind.
//
// The first is the LAYOUT: that a town is laid out from what it is rather
// than from what it owns, that it looks the same every time you visit it, and
// that a metropolis is bigger than a hamlet. That last one sounds too obvious
// to test until you learn it was FALSE on the first attempt — the game's
// `pop` caps at 120, so density climbed faster than the building count and a
// level-8 city came out 77 m across against a twenty-person hamlet's 103 m.
//
// The second is that EVERYTHING STANDS ON THE GROUND. Six places used to lift
// things off the sphere by a constant between 0.010 and 0.029 Earth radii —
// 64 km to 185 km — chosen when the camera could not get closer than 1,593 km.
// The camera now stands at 80 m, so every person, label, ring and bolt was
// SEVENTY-SEVEN KILOMETRES ABOVE THE SUMMIT OF EVEREST. That shipped, twice,
// and no test in this project would have noticed.
//
// Usage: node tools/test-buildings.js [repoRoot]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.argv[2] || '.';

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, Date, Error,
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Int32Array,
  Uint32Array, Float32Array, Float64Array, ArrayBuffer,
  setTimeout: () => 0, clearTimeout: () => 0,
  performance: { now: () => 0 }
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(ctx);
for (const f of ['util.js', 'world.js', 'sim.js', 'lod.js', 'buildings.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'js', f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD, B = PD.Buildings, LOD = PD.LOD, W = PD.World, Sim = PD.Sim;

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}
const R = 6371000;
const world = W.createWorld(180, 120, 'bldg', {});

// ---------------------------------------------------------------------------
console.log('\n--- a town is sized by its people, not by its territory ---');
{
  // A mature settlement claims up to 177 tiles and a tile is 222 km. Sizing
  // the built area from claimed land would put a city 400 km across.
  const rows = [[6, 1], [20, 1], [40, 2], [60, 3], [80, 4], [100, 6], [120, 8]];
  console.log('     pop  lvl     people  buildings     across    per km2');
  let prev = -1, monotonic = true;
  for (const [pop, lvl] of rows) {
    const f = B.footprintM(pop, lvl), n = B.buildingCount(pop, lvl);
    const dens = n / (Math.PI * Math.pow(f / 1000, 2));
    console.log('    ' + String(pop).padStart(4) + String(lvl).padStart(5) +
      Math.round(B.realPopulation(pop, lvl)).toLocaleString().padStart(11) +
      String(n).padStart(11) + ((f / 1000).toFixed(2) + ' km').padStart(11) +
      Math.round(dens).toLocaleString().padStart(11));
    if (f < prev) monotonic = false;
    prev = f;
  }
  check('a bigger settlement is a bigger settlement', monotonic,
    'footprint never shrinks as a town grows');

  const hamlet = B.footprintM(8, 1), city = B.footprintM(120, 8);
  check('a hamlet is a few hundred metres, not a few hundred kilometres',
    hamlet > 40 && hamlet < 400, Math.round(hamlet) + ' m');
  check('a city is under two kilometres across, not four hundred',
    city > 400 && city < 2000, Math.round(city) + ' m');
  check('and a city is much larger than a hamlet', city > hamlet * 3,
    (city / hamlet).toFixed(1) + 'x');

  // density has to land in the range real places occupy, or the whole thing
  // is arbitrary numbers that happen to be monotonic
  const dens = (p, l) => B.buildingCount(p, l) / (Math.PI * Math.pow(B.footprintM(p, l) / 1000, 2));
  check('a village is sparse, a city is dense, both plausibly so',
    dens(20, 1) < 400 && dens(120, 8) > 1500 && dens(120, 8) < 6000,
    Math.round(dens(20, 1)) + ' vs ' + Math.round(dens(120, 8)) + ' buildings/km2');

  // the instance ceiling has to actually bind
  check('the largest imaginable settlement stays inside the instance budget',
    B.buildingCount(999, 20) <= B.MAX_INSTANCES, B.buildingCount(999, 20) + ' instances');
}

// ---------------------------------------------------------------------------
console.log('\n--- a town looks the same every time you visit it ---');
{
  const v = { id: 7, x: 60, y: 45, pop: 60, level: 3, temples: 2 };
  const a = B.layout(v, world), b = B.layout(v, world);
  check('the same settlement lays out identically twice',
    JSON.stringify(a.items) === JSON.stringify(b.items), a.count + ' buildings');
  const other = B.layout({ id: 8, x: 60, y: 45, pop: 60, level: 3, temples: 2 }, world);
  check('and a different settlement does not', JSON.stringify(other.items) !== JSON.stringify(a.items));
  // identity, not address: a town that is renamed or moved keeps its streets
  const moved = B.layout({ id: 7, x: 60, y: 45, pop: 60, level: 3, temples: 2, name: 'X' }, world);
  check('layout depends on identity, so nothing is saved per building',
    JSON.stringify(moved.items) === JSON.stringify(a.items));

  check('a town of any size has civic buildings in it',
    a.items.some(i => i.kind === B.TEMPLE) && a.items.some(i => i.kind === B.HALL),
    [...new Set(a.items.map(i => B.KINDS[i.kind]))].join(','));

  // every building has to be inside its own town
  const mPerTileY = (Math.PI * R) / world.H;
  let outside = 0, worst = 0;
  for (const it of a.items) {
    const dM = Math.hypot((it.x - v.x) * mPerTileY * Math.cos(0), (it.y - v.y) * mPerTileY);
    if (dM > a.radiusM * 1.05) { outside++; worst = Math.max(worst, dM); }
  }
  check('no building stands outside its own settlement', outside === 0,
    outside + ' strays' + (outside ? ', worst ' + Math.round(worst) + ' m' : ''));

  // and be a building, not a monolith
  let bad = 0;
  for (const it of a.items) {
    if (!(it.w > 1 && it.w < 60 && it.d > 1 && it.d < 60 && it.h > 1 && it.h < 80)) bad++;
  }
  check('every building is building-sized', bad === 0, bad + ' wrong');
}

// ---------------------------------------------------------------------------
console.log('\n--- true scale is a measurement, not a claim ---');
{
  // The whole point of the decision: from anywhere you would normally be,
  // there is nothing to draw.
  const sim = Sim.createSim(world, () => 0.5);
  sim.villages = [{ id: 1, x: 60, y: 45, pop: 80, level: 4, temples: 1 }];
  const at = (altM) => B.visible(sim, world, 60, 45, altM, B.MAX_INSTANCES).length;
  console.log('    altitude        settlements drawn');
  for (const a of [1600000, 200000, 55001, 20000, 2000, 80]) {
    console.log('    ' + (a.toLocaleString() + ' m').padStart(14) + String(at(a)).padStart(10));
  }
  check('nothing is drawn from orbit', at(1600000) === 0);
  check('nothing is drawn from 200 km', at(200000) === 0);
  check('nor from just above the threshold', at(55001) === 0);
  check('but a town is drawn from two kilometres', at(2000) === 1);
  check('and from the ground', at(80) === 1);
  // a village on the far side of the planet is not drawn from 2 km either
  const far = B.visible(sim, world, 10, 100, 2000, B.MAX_INSTANCES).length;
  check('and only the one you are standing near', far === 0, far + ' distant towns drawn');
}

// ---------------------------------------------------------------------------
console.log('\n--- NOTHING FLOATS ---');
{
  // This is the assertion the six constants would have failed for two
  // releases. It is written against the arithmetic the renderer uses, so that
  // reintroducing any one of them fails here.
  const src = fs.readFileSync(path.join(base, 'js', 'render3d.js'), 'utf8');

  check('there is one surface function and everything calls it',
    /function surfaceRadius\(world, tx, ty, exag\)/.test(src) &&
    /function onSurface\(world, tx, ty, out, liftM, exag\)/.test(src));
  check('and no fixed fraction-of-a-planet lift survives',
    !/tileToSphere\([^)]*,\s*0\.0[0-9]+\s*\)/.test(src),
    'no tileToSphere(..., 0.0xx) anywhere');
  for (const [what, re] of [
    ['units', /onSurface\(r\.world, u\.x, u\.y, _upos, R\.flies \? 120 : 1, uExag\)/],
    ['labels', /onSurface\(r\.world, wx, wy, \[0, 0, 0\], 40, exagOf\(r\)\)/],
    ['FX particles', /onSurface\(world, x, y, tmp, 20, curExag\)/],
    ['shockwave rings', /onSurface\(r\.world, ring\.x, ring\.y, _rtmp, 15, exagOf\(r\)\)/],
    ['bolt anchors', /onSurface\(r\.world, t\[0\], t\[1\], \[0, 0, 0\], 0, exagOf\(r\)\)/],
    ['buildings', /onSurface\(world, b\.x, b\.y, P, 0, exag\)/]
  ]) check(what + ' stand on the terrain', re.test(src));

  // and the numbers: what the constants meant, against what the ground does
  let land = -1, lx = 0, ly = 0;
  for (let i = 0; i < world.n; i++) if (world.elev[i] > land) { land = world.elev[i]; lx = i % world.W; ly = (i / world.W) | 0; }
  const lon = (lx / world.W) * Math.PI * 2, lat = Math.PI / 2 - (ly / world.H) * Math.PI;
  console.log('    exag   terrain reaches   the old 0.014 lift sat at   error');
  let worstOld = 0;
  for (const exag of [LOD.EXAG_FAR, 5, LOD.EXAG_NEAR]) {
    const g = (LOD.groundRadius(world, lon, lat, exag) - 1) * R;
    const old = 0.014 * R;
    worstOld = Math.max(worstOld, Math.abs(old - g));
    console.log('    ' + exag.toFixed(1).padStart(5) + ((g / 1000).toFixed(1) + ' km').padStart(18) +
      ((old / 1000).toFixed(0) + ' km').padStart(27) + ((old - g) / 1000).toFixed(1).padStart(8) + ' km');
  }
  check('the constant it replaced was wrong by tens of kilometres',
    worstOld > 50000, (worstOld / 1000).toFixed(0) + ' km at worst');

  // Each building must sit at the height of the ground UNDER ITSELF, not at
  // the height of the town centre — otherwise a settlement on a slope is a
  // row of houses hanging in the air at one end.
  //
  // (The first version of this compared (g-1)*R against (g-1)*R and reported
  // 0.000 m. It asserted nothing at all. That is the fifth time in this
  // project a measurement has been written next to the claim instead of on
  // it, so it is worth the extra lines to measure the real thing.)
  const v2 = { id: 2, x: lx, y: ly, pop: 60, level: 3, temples: 1 };
  const lay = B.layout(v2, world);
  const heightAt = (it, exag) => {
    const ln = (it.x / world.W) * Math.PI * 2, lt = Math.PI / 2 - (it.y / world.H) * Math.PI;
    return (LOD.groundRadius(world, ln, lt, exag) - 1) * R;
  };
  const centreH = (LOD.groundRadius(world, lon, lat, LOD.EXAG_NEAR) - 1) * R;
  let spread = 0, anyDiff = false;
  for (const it of lay.items) {
    const h = heightAt(it, LOD.EXAG_NEAR);
    spread = Math.max(spread, Math.abs(h - centreH));
    if (Math.abs(h - centreH) > 0.01) anyDiff = true;
  }
  check('a building follows the ground under itself, not the town centre',
    anyDiff, 'foundations vary by up to ' + spread.toFixed(1) + ' m across the town');
  // and that variation must be a SLOPE, not noise: neighbouring buildings
  // should differ far less than opposite ends of the settlement
  {
    const sorted = lay.items.slice().sort((p, q) => p.x - q.x);
    const near = Math.abs(heightAt(sorted[0], LOD.EXAG_NEAR) - heightAt(sorted[1], LOD.EXAG_NEAR));
    const far = Math.abs(heightAt(sorted[0], LOD.EXAG_NEAR) -
                         heightAt(sorted[sorted.length - 1], LOD.EXAG_NEAR));
    check('and the variation is terrain, not noise', far >= near,
      near.toFixed(2) + ' m between neighbours vs ' + far.toFixed(2) + ' m across the town');
  }
}

// ---------------------------------------------------------------------------
console.log('\n--- towns stand on level ground ---');
{
  // detail() invents up to 600 m of relief that groundRadius does not know
  // about, so a building placed against the smooth surface would sink into a
  // hillside the patch geometry made up afterwards.
  const tree = LOD.createTree(world, 5);
  const v = { id: 1, x: 60, y: 45, pop: 80, level: 4 };
  const lon = (v.x / world.W) * Math.PI * 2, lat = Math.PI / 2 - (v.y / world.H) * Math.PI;
  const e = LOD.elevAt(world, lon, lat);
  const before = tree.detail(world, lon, lat, 14, e);
  const rt = B.builtRadiusTiles(v, world) * 1.35;
  tree.detail.setTowns([{ x: v.x, y: v.y, r2: rt * rt }]);
  const after = tree.detail(world, lon, lat, 14, e);
  check('the quadtree can be told where the towns are', typeof tree.detail.setTowns === 'function');
  check('and it stops inventing hillsides under them', after === 0,
    'was ' + before.toFixed(5) + ', now ' + after);
  // But ONLY under them. A mask that suppressed everything would pass the
  // check above and quietly flatten the planet, so this has to find real
  // ground outside the town that still has relief. (`|| true` was how the
  // first version of this line ended, which is to say it passed always.)
  tree.detail.setTowns([{ x: v.x, y: v.y, r2: rt * rt }]);
  let reliefElsewhere = 0, sampled = 0;
  for (let i = 0; i < 400; i++) {
    const tx = (i * 37) % world.W, ty = 10 + (i * 17) % (world.H - 20);
    const ln = (tx / world.W) * Math.PI * 2, lt = Math.PI / 2 - (ty / world.H) * Math.PI;
    const ee = LOD.elevAt(world, ln, lt);
    if (ee <= LOD.SEA) continue;
    sampled++;
    if (tree.detail(world, ln, lt, 14, ee) !== 0) reliefElsewhere++;
  }
  check('while land outside the towns keeps its invented relief',
    sampled > 20 && reliefElsewhere > sampled * 0.5,
    reliefElsewhere + ' of ' + sampled + ' land samples still have relief');
  tree.detail.setTowns([]);
  check('and clearing the list restores it',
    tree.detail(world, lon, lat, 14, e) === before);
}

// ---------------------------------------------------------------------------
console.log('\n--- the way down exists ---');
{
  // A feature only visible below 55 km, reachable only by holding a zoom key
  // over exactly the right spot, is not a feature. flyTo sat exported and
  // called from nowhere for three releases; this is the assertion that stops
  // it going back to sleep.
  const gsrc = fs.readFileSync(path.join(base, 'js', 'game.js'), 'utf8');
  check('double-clicking the world flies the camera somewhere',
    /cv\.addEventListener\('dblclick'/.test(gsrc) && /Render\.flyTo\(G\.r,/.test(gsrc));
  check('and it aims at the settlement you clicked, not the raw point',
    /const v = nearestVillage\(wc\.x, wc\.y, 14\);/.test(gsrc));
  check('arriving low enough that the buildings are visible',
    /PD\.Buildings\.footprintM\(v\.pop \|\| 1, v\.level \|\| 1\) \* 2\.2/.test(gsrc));
  {
    // the altitude it picks must actually be under the visibility threshold
    const alt = Math.max(400, B.footprintM(120, 8) * 2.2);
    check('the altitude it flies to is inside the visible range',
      alt < B.VISIBLE_ALT_M, Math.round(alt) + ' m vs a ' + B.VISIBLE_ALT_M + ' m threshold');
  }
  const rsrc = fs.readFileSync(path.join(base, 'js', 'render3d.js'), 'utf8');
  check('instancing is probed, never assumed',
    /gl\.getExtension\('ANGLE_instanced_arrays'\)/.test(rsrc) &&
    /gl\.drawElementsInstanced\(/.test(rsrc));
  check('and there is a path for devices that have neither',
    /No instancing anywhere on this device/.test(rsrc));
  check('instance divisors are reset, or the terrain collapses after them',
    /r\.inst\.divisor\(loc, 0\)/.test(rsrc));
}

console.log('\n=== buildings failures: ' + fails + ' ===');
console.log(fails === 0 ? 'BUILDINGS TEST PASSED' : 'BUILDINGS TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
