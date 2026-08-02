// Regression tests for Stage 3: traits and professions that actually do
// something. Every one of these would have passed vacuously before the
// change, because nothing read u.trait or u.prof at all.
//
// Runs headless against the real sim — no DOM, no canvas, no rendering.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.argv[2] || '.';

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set,
  parseInt, parseFloat, isNaN, isFinite, Date,
  Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer,
  setTimeout: () => 0, clearTimeout: () => 0,
  performance: { now: () => Date.now() }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['util.js', 'world.js', 'sim.js', 'society.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'js', f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD, Sim = PD.Sim;

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

function freshSim(seed) {
  const world = PD.World.createWorld(180, 120, seed || 4242, {});
  let s = (seed || 4242) >>> 0;
  const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const sim = Sim.createSim(world, rng);
  sim.UNIT_CAP = 900;
  return sim;
}

// ---------------------------------------------------------------- traits
console.log('\n--- a soul\'s nature is read, not just printed ---');
{
  check('every trait has a behaviour vector',
    Sim.TRAITS.every(t => Sim.TRAIT_FX[t]),
    Sim.TRAITS.length + ' traits');

  const vecOf = (name) => Sim.traitFx({ trait: Sim.TRAITS.indexOf(name) });
  const brave = vecOf('brave'), gentle = vecOf('gentle'), lazy = vecOf('lazy');
  const kind = vecOf('kind'), cruel = vecOf('cruel'), greedy = vecOf('greedy');
  const curious = vecOf('curious'), devout = vecOf('devout');

  check('the brave stand where the gentle run',
    brave.bravery > gentle.bravery * 2, brave.bravery + ' vs ' + gentle.bravery);
  check('the lazy do less work than the stoic',
    lazy.work < vecOf('stoic').work, lazy.work + ' vs ' + vecOf('stoic').work);
  check('the kind tend others; the cruel do not',
    kind.warmth > cruel.warmth * 5, kind.warmth + ' vs ' + cruel.warmth);
  check('the greedy take more than their share',
    greedy.greed > 1.8, String(greedy.greed));
  check('the curious stray furthest from home',
    curious.roam > 1.5 && curious.roam > devout.roam);
  check('the devout are the most pious', devout.piety >= 2.0, String(devout.piety));
  check('an unknown trait index falls back to neutral, not a crash',
    Sim.traitFx({ trait: 999 }).bravery === 1);

  // the fight/flight decision must actually differ between two identical
  // units that differ ONLY in nature
  const sim = freshSim(7);
  const mk = (traitName) => {
    const u = Sim.spawnUnit(sim, 'human', 40, 40);
    u.trait = Sim.TRAITS.indexOf(traitName);
    u.hp = u.maxHp * 0.3;   // badly hurt: the decision point
    return u;
  };
  const b = mk('brave'), g = mk('gentle');
  const fleeThreshold = (u) => 0.34 / Math.max(0.25, Sim.traitFx(u).bravery);
  check('at 30% health the gentle flee and the brave do not',
    (0.3 < fleeThreshold(g)) && (0.3 >= fleeThreshold(b)),
    'brave<' + fleeThreshold(b).toFixed(2) + ' gentle<' + fleeThreshold(g).toFixed(2));
}

// ----------------------------------------------------------- professions
console.log('\n--- a trade is work the town actually receives ---');
{
  check('every profession contributes something',
    Sim.PROFESSIONS.every(p => Sim.PROF_FX[p] && Object.keys(Sim.PROF_FX[p]).length > 0));
  check('farmers and hunters are the food trades',
    Sim.PROF_FX.farmer.food > 0 && Sim.PROF_FX.hunter.food > 0);
  check('only scholars advance science',
    Sim.PROFESSIONS.filter(p => (Sim.PROF_FX[p].science || 0) > 0.1).join() === 'scholar');
  check('soldiers keep the most order',
    Sim.PROF_FX.soldier.order >= Sim.PROF_FX.hunter.order);

  const sim = freshSim(11);
  const v = Sim.foundVillage(sim, 'human', 60, 50);
  check('a village was founded to test with', !!v);

  // populate with a known roster and confirm the census reflects it
  const add = (profName, traitName, n) => {
    for (let i = 0; i < n; i++) {
      const u = Sim.spawnUnit(sim, 'human', v.x, v.y, { village: v.id });
      if (!u) continue;
      u.prof = Sim.PROFESSIONS.indexOf(profName);
      u.trait = Sim.TRAITS.indexOf(traitName);
      u.age = u.adultAt + 10;  // adults: children do not work
      u.food = 1;
    }
  };
  add('farmer', 'stoic', 6);
  add('scholar', 'wise', 3);
  add('bard', 'merry', 2);
  Sim.recount(sim);

  const F = Sim.PROFESSIONS.indexOf('farmer');
  const SC = Sim.PROFESSIONS.indexOf('scholar');
  check('the census counts the town\'s trades',
    v.jobs[F] === 6 && v.jobs[SC] === 3,
    'farmers ' + v.jobs[F] + ' scholars ' + v.jobs[SC]);
  check('farm labour reaches the village store', v.labour.food > 0.5,
    v.labour.food.toFixed(3));
  check('scholarship is produced only where scholars live', v.labour.science > 0.5,
    v.labour.science.toFixed(3));

  // a town of bards produces materially less food than a town of farmers
  const simA = freshSim(21), simB = freshSim(21);
  const build = (s, profName) => {
    const vv = Sim.foundVillage(s, 'human', 60, 50);
    for (let i = 0; i < 10; i++) {
      const u = Sim.spawnUnit(s, 'human', vv.x, vv.y, { village: vv.id });
      if (!u) continue;
      u.prof = Sim.PROFESSIONS.indexOf(profName);
      u.trait = Sim.TRAITS.indexOf('stoic');
      u.age = u.adultAt + 10; u.food = 1;
    }
    Sim.recount(s);
    return vv;
  };
  const vFarm = build(simA, 'farmer'), vBard = build(simB, 'bard');
  check('ten farmers out-produce ten bards',
    vFarm.labour.food > vBard.labour.food * 2,
    vFarm.labour.food.toFixed(2) + ' vs ' + vBard.labour.food.toFixed(2));
  check('ten bards out-cheer ten farmers',
    vBard.labour.morale > vFarm.labour.morale);

  // children and the sick do not pull a full shift
  const simC = freshSim(31);
  const vc = Sim.foundVillage(simC, 'human', 60, 50);
  const kid = Sim.spawnUnit(simC, 'human', vc.x, vc.y, { village: vc.id });
  kid.prof = F; kid.trait = Sim.TRAITS.indexOf('stoic'); kid.age = 1; kid.food = 1;
  Sim.recount(simC);
  check('a child works no fields', vc.labour.food === 0, vc.labour.food.toFixed(3));
  kid.age = kid.adultAt + 5;
  Sim.recount(simC);
  const wellFed = vc.labour.food;
  kid.sick = 1;
  Sim.recount(simC);
  check('the sick work less than the well',
    vc.labour.food < wellFed && vc.labour.food > 0,
    vc.labour.food.toFixed(3) + ' vs ' + wellFed.toFixed(3));
}

// ------------------------------------------------------ need drives trade
console.log('\n--- a trade is chosen by the town\'s need ---');
{
  const sim = freshSim(51);
  const v = Sim.foundVillage(sim, 'human', 60, 50);
  const F = Sim.PROFESSIONS.indexOf('farmer');
  const SOL = Sim.PROFESSIONS.indexOf('soldier');

  v.food = 1; v.pop = 10;   // starving
  let farmers = 0;
  for (let i = 0; i < 200; i++) if (Sim.chooseProfession(sim, v.id) === F) farmers++;
  check('a starving town raises farmers', farmers > 100, farmers + '/200');

  v.food = 500; v.pop = 10; v.underAttack = 30;   // besieged
  let soldiers = 0;
  for (let i = 0; i < 200; i++) if (Sim.chooseProfession(sim, v.id) === SOL) soldiers++;
  check('a besieged town raises soldiers', soldiers > 80, soldiers + '/200');

  check('a wild birth with no village still gets a valid trade',
    (() => {
      for (let i = 0; i < 50; i++) {
        const p = Sim.chooseProfession(sim, -1);
        if (!(p >= 0 && p < Sim.PROFESSIONS.length)) return false;
      }
      return true;
    })());
}

// ------------------------------------------------------------- granaries
console.log('\n--- grain does not keep forever ---');
{
  const sim = freshSim(61);
  const v = Sim.foundVillage(sim, 'human', 60, 50);
  for (let i = 0; i < 12; i++) {
    const u = Sim.spawnUnit(sim, 'human', v.x, v.y, { village: v.id });
    if (u) { u.age = u.adultAt + 10; u.food = 1; u.prof = Sim.PROFESSIONS.indexOf('farmer'); }
  }
  Sim.recount(sim);
  v.food = 50000;                       // absurd hoard
  for (let i = 0; i < 400; i++) Sim.step(sim, 1);
  check('an absurd hoard spoils back to what the town can store',
    v.food < 3000, 'food ' + v.food.toFixed(0));
  check('but the town does not starve itself doing it',
    v.food > 20, 'food ' + v.food.toFixed(0));
}

// --------------------------------------------------------------- healers
console.log('\n--- a town with healers treats its people ---');
{
  const mkPlagueTown = (profName, seed) => {
    const sim = freshSim(seed);
    const v = Sim.foundVillage(sim, 'human', 60, 50);
    for (let i = 0; i < 14; i++) {
      const u = Sim.spawnUnit(sim, 'human', v.x, v.y, { village: v.id });
      if (!u) continue;
      u.prof = Sim.PROFESSIONS.indexOf(profName);
      u.trait = Sim.TRAITS.indexOf('stoic');
      u.age = u.adultAt + 10; u.food = 1; u.sick = 1; u.hp = u.maxHp;
    }
    Sim.recount(sim);
    v.food = 400;
    // the cohort that started sick — everyone born later is not the measure
    const cohort = sim.units.filter(u => !u.dead && u.village === v.id).map(u => u.id);
    // 150 ticks, deliberately: the pre-existing spontaneous recovery cannot
    // fire until sick > 200, so inside this window every cure is a healer's
    // doing and nothing else. Running longer measured the old timer instead.
    //
    // The roster is pinned every tick because otherwise the control group
    // cures itself: a plague town RAISES healers by design, so the bard
    // town had trained its own within a hundred ticks and the comparison
    // measured nothing. Pinning isolates the variable under test.
    const pin = Sim.PROFESSIONS.indexOf(profName);
    for (let i = 0; i < 150; i++) {
      for (const u of sim.units) if (!u.dead && u.village === v.id) u.prof = pin;
      Sim.step(sim, 1);
    }
    const byId = new Map(sim.units.map(u => [u.id, u]));
    let cured = 0, died = 0, hp = 0;
    for (const id of cohort) {
      const u = byId.get(id);
      if (!u || u.dead) died++;
      else { if (u.sick === 0) cured++; hp += u.hp / u.maxHp; }
    }
    return { sim, v, cured, died, hp, cohort: cohort.length };
  };
  const withHealers = mkPlagueTown('healer', 71);
  const withBards = mkPlagueTown('bard', 71);
  check('healers cure the sick that bards leave to die',
    withHealers.cured > withBards.cured,
    withHealers.cured + '/' + withHealers.cohort + ' cured vs ' +
    withBards.cured + '/' + withBards.cohort);
  // Nobody dies of plague inside 150 ticks — sickness drains slower than a
  // fed citizen regenerates — so death count is not the observable here.
  // The proximate effect of care is that the afflicted stay healthier.
  check('and the afflicted are healthier where there are healers',
    withHealers.hp > withBards.hp * 1.05,
    withHealers.hp.toFixed(1) + ' vs ' + withBards.hp.toFixed(1) + ' total health');
  check('the care labour is what makes the difference',
    withHealers.v.labour.care > withBards.v.labour.care);
}

// --------------------------------------------------------------- science
console.log('\n--- discovery is the work of scholars ---');
{
  const mkNation = (profName, seed) => {
    const sim = freshSim(seed);
    const v = Sim.foundVillage(sim, 'human', 60, 50);
    for (let i = 0; i < 16; i++) {
      const u = Sim.spawnUnit(sim, 'human', v.x, v.y, { village: v.id });
      if (!u) continue;
      u.prof = Sim.PROFESSIONS.indexOf(profName);
      u.trait = Sim.TRAITS.indexOf('wise');
      u.age = u.adultAt + 10; u.food = 1;
    }
    Sim.recount(sim);
    v.food = 600; v.prosperity = 0.9;
    for (let i = 0; i < 900; i++) {
      // hold the roster fixed so we measure scholarship, not demographics
      for (const u of sim.units) {
        if (!u.dead && u.village === v.id) u.prof = Sim.PROFESSIONS.indexOf(profName);
      }
      Sim.step(sim, 1);
    }
    const n = PD.Society.nationOf(sim, v.id);
    return { era: n ? n.era : 0, science: n ? n.science : 0, scholars: n ? n.scholars : 0 };
  };
  const learned = mkNation('scholar', 81);
  const unlettered = mkNation('farmer', 81);
  check('a nation of scholars has scholars counted',
    learned.scholars > 10, String(learned.scholars));
  check('a nation of farmers has far fewer (its colonies pick their own trades)',
    unlettered.scholars * 8 < learned.scholars,
    unlettered.scholars + ' vs ' + learned.scholars);
  check('the learned nation advances further than the unlettered one',
    (learned.era * 10000 + learned.science) > (unlettered.era * 10000 + unlettered.science),
    'era ' + learned.era + '/sci ' + learned.science.toFixed(0) +
    ' vs era ' + unlettered.era + '/sci ' + unlettered.science.toFixed(0));
}

// ------------------------------------------------------------ durability
console.log('\n--- the new state survives a round trip ---');
{
  const sim = freshSim(91);
  const v = Sim.foundVillage(sim, 'human', 60, 50);
  for (let i = 0; i < 8; i++) {
    const u = Sim.spawnUnit(sim, 'human', v.x, v.y, { village: v.id });
    if (u) { u.age = u.adultAt + 10; u.food = 1; }
  }
  Sim.recount(sim);
  for (let i = 0; i < 60; i++) Sim.step(sim, 1);
  const clone = JSON.parse(JSON.stringify(sim.villages));
  check('villages serialize with their labour and trades',
    !!clone[0].jobs && !!clone[0].labour && clone[0].order != null);
  // a loaded village whose derived fields are missing must not throw
  delete clone[0].jobs; delete clone[0].labour;
  sim.villages = clone;
  sim.vmap = null;
  let threw = null;
  try { Sim.recount(sim); Sim.step(sim, 1); } catch (e) { threw = e; }
  check('an old save with no census fields rebuilds instead of throwing',
    !threw, threw ? threw.message : '');
  check('and the census is repopulated after the rebuild',
    !!sim.villages[0].jobs && !!sim.villages[0].labour);
}

console.log('\n=== lives failures: ' + fails + ' ===');
console.log(fails === 0 ? 'LIVES TEST PASSED' : 'LIVES TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
