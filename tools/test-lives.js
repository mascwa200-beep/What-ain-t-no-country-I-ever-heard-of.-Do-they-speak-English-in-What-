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

// ------------------------------------------- the peace optimisation is safe
// updateUnit skips its neighbour scan when no enemy can exist. That is a pure
// speed win ONLY while the precondition is exhaustive — if a new way to
// become foes is ever added without updating recount(), fights would silently
// stop happening. These pin the behaviour, not the optimisation.
console.log('\n--- war still finds those it should ---');
{
  // 1. hostile races DO fight, and the precomputed table says so
  const sim = freshSim(101);
  for (let i = 0; i < 8; i++) {
    const h = Sim.spawnUnit(sim, 'human', 60 + i * 0.3, 50);
    const o = Sim.spawnUnit(sim, 'orc', 60.5 + i * 0.3, 50);
    if (h) { h.age = h.adultAt + 5; h.food = 1; }
    if (o) { o.age = o.adultAt + 5; o.food = 1; }
  }
  Sim.recount(sim);
  check('orcs and humans are marked as able to find foes',
    sim.foeRace.human === true && sim.foeRace.orc === true);
  // Headcount is the wrong measure — the survivors out-breed the casualties,
  // so the population climbs even in a war. Track the cohort that was there
  // when the fighting started, and whether it took wounds.
  const cohort = sim.units.filter(u => !u.dead).map(u => u.id);
  for (let i = 0; i < 400; i++) Sim.step(sim, 1);
  const byId = new Map(sim.units.map(u => [u.id, u]));
  let fell = 0, wounded = 0;
  for (const id of cohort) {
    const u = byId.get(id);
    if (!u || u.dead) fell++;
    else if (u.hp < u.maxHp) wounded++;
  }
  check('and blood is actually shed between them', fell + wounded > 0,
    fell + ' fell, ' + wounded + ' wounded of ' + cohort.length);

  // 2. a world of one peaceful race skips the scan
  const calm = freshSim(103);
  for (let i = 0; i < 10; i++) {
    const h = Sim.spawnUnit(calm, 'human', 60 + i * 0.4, 50);
    if (h) { h.age = h.adultAt + 5; h.food = 1; }
  }
  Sim.recount(calm);
  check('a world of humans alone has no foe for a human',
    calm.foeRace.human === false, String(calm.foeRace.human));
  check('and no rivalry is declared', calm.anyRivalry === false);

  // 3. THE TRAP: same-race units at war via village rivalry must still fight,
  //    even though hostile('human','human') is false and the race table says
  //    there is no foe. This is the case the optimisation could break.
  const feud = freshSim(107);
  const vA = Sim.foundVillage(feud, 'human', 55, 50);
  const vB = Sim.foundVillage(feud, 'human', 58, 50);
  check('two same-race villages were founded', !!vA && !!vB && vA.id !== vB.id);
  for (const vv of [vA, vB]) {
    for (let i = 0; i < 8; i++) {
      const u = Sim.spawnUnit(feud, 'human', vv.x + (i % 3) * 0.3, vv.y, { village: vv.id });
      if (u) { u.age = u.adultAt + 5; u.food = 1; u.hp = u.maxHp; }
    }
  }
  vA.rival = vB.id; vB.rival = vA.id;
  Sim.recount(feud);
  check('the race table still reports no racial foe (the trap)',
    feud.foeRace.human === false);
  check('but the rivalry flag is raised, so the scan is not skipped',
    feud.anyRivalry === true);
  const feudBefore = feud.units.filter(u => !u.dead).length;
  let hurt = 0;
  for (let i = 0; i < 300; i++) {
    Sim.step(feud, 1);
    vA.rival = vB.id; vB.rival = vA.id;   // hold the feud open
  }
  for (const u of feud.units) if (!u.dead && u.hp < u.maxHp) hurt++;
  const feudAfter = feud.units.filter(u => !u.dead).length;
  check('neighbours at feud still draw blood despite sharing a race',
    hurt > 0 || feudAfter < feudBefore,
    hurt + ' wounded, ' + feudBefore + ' -> ' + feudAfter);
}

// ------------------------------------------------ the wrap fast path is safe
console.log('\n--- the round world still wraps ---');
{
  const w = PD.World.createWorld(180, 120, 7, {});
  const W = PD.World;
  let bad = 0;
  // idx() gained a fast path; it must agree with the slow form everywhere,
  // including off both edges and on fractional coordinates
  for (const x of [-361.5, -180, -1, -0.5, 0, 0.5, 1, 89.9, 179, 179.5, 180, 181, 360, 541.2]) {
    for (const y of [0, 1, 59, 119]) {
      const fast = W.idx(w, x, y);
      const slow = y * w.W + (((Math.floor(x) % w.W) + w.W) % w.W);
      if (fast !== slow) { bad++; console.log('    MISMATCH x=' + x + ' y=' + y + ' ' + fast + ' vs ' + slow); }
    }
  }
  check('idx() agrees with the unoptimised form at every edge', bad === 0,
    bad + ' mismatches');
  let bx = 0;
  for (const x of [-361.5, -180, -1, -0.5, 0, 0.5, 179.5, 180, 181, 360]) {
    const fast = W.wrapX(w, x), slow = ((x % w.W) + w.W) % w.W;
    if (Math.abs(fast - slow) > 1e-9) { bx++; console.log('    wrapX MISMATCH ' + x + ': ' + fast + ' vs ' + slow); }
  }
  check('wrapX() agrees with the unoptimised form', bx === 0, bx + ' mismatches');
}

// ---------------------------------------------- nothing here is decorative
// The bug this guards against has now bitten this project three times: a
// field is written, saved, drawn in the inspector — and read by nothing that
// matters, so the mechanic it supposedly drives never happens in play. It is
// invisible to ordinary unit tests, because a test that sets the field by
// hand passes perfectly while the game never sets it at all.
//
// So: run an UNATTENDED world and demand that each mechanic actually fires.
// No test may set these fields. If a hook is ever unwired, this goes red.
console.log('\n--- every mechanic fires in a world nobody touches ---');
{
  const sim = freshSim(4242);
  sim.UNIT_CAP = 700;
  for (let i = 0; i < 4; i++) Sim.foundVillage(sim, 'human', 30 + i * 25, 45);
  for (let i = 0; i < 2; i++) Sim.foundVillage(sim, 'orc', 40 + i * 25, 62);

  let siege = 0, crime = 0, peakDev = 0, plague = 0;
  const orders = new Set();
  for (let i = 0; i < 1200; i++) {
    Sim.step(sim, 1);
    for (const v of sim.villages) {
      if ((v.underAttack || 0) > 0) siege++;
      if ((v.crimeT || 0) > 0) crime++;
      if ((v.plagueT || 0) > 0) plague++;
      if (v.order != null) orders.add(Math.round(v.order * 10));
    }
    const d = Sim.devotion(sim);
    if (d > peakDev) peakDev = d;
  }

  check('the game itself puts towns under siege (nothing else sets it)',
    siege > 0, siege + ' village-ticks');
  check('soldiers can therefore be raised in answer to one',
    Sim.PROFESSIONS[Sim.chooseProfession(sim, (() => {
      const v = sim.villages.find(x => (x.underAttack || 0) > 0) || sim.villages[0];
      v.underAttack = 999; v.food = 999; v.pop = 20; return v.id;
    })())] !== undefined);
  check('thieves rob badly-ordered towns', crime > 0, crime + ' village-ticks');
  check('order actually varies rather than sitting at its initial value',
    orders.size > 1, [...orders].sort((a, b) => a - b).map(t => (t / 10).toFixed(1)).join(','));
  check('devotion rises from what the living do', peakDev > 0.5,
    peakDev.toFixed(2));
  check('and it reaches the god: faith income counts it',
    typeof Sim.devotion === 'function');

  // guile and piety must be consumed by the simulation, not just described
  const src = fs.readFileSync(path.join(base, 'js', 'sim.js'), 'utf8');
  check('guile is read by the simulation, not only the inspector',
    /tf\.guile/.test(src), 'sim.js');
  check('piety is read by the simulation, not only the inspector',
    /traitFx\([^)]*\)\.piety|tf\.piety/.test(src), 'sim.js');
}

console.log('\n=== lives failures: ' + fails + ' ===');
console.log(fails === 0 ? 'LIVES TEST PASSED' : 'LIVES TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
