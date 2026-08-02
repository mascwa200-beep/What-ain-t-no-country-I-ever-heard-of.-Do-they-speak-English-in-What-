// Headless test for the GENESIS expansion: multiverse, society, afterlife,
// wrap-world, codec round-trips, powers, evolution, doom.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.argv[2];

const ctx = {};
ctx.window = ctx; ctx.globalThis = ctx; ctx.console = console;
ctx.performance = { now: () => Date.now() };
ctx.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
ctx.atob = (s) => Buffer.from(s, 'base64').toString('binary');
ctx.devicePixelRatio = 1;
ctx.setInterval = () => 0; ctx.clearInterval = () => {};
ctx.setTimeout = () => 0; ctx.clearTimeout = () => {};
ctx.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (t,p)=> p==='createImageData'? ((w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h})) : (()=>{}) }) }) };
vm.createContext(ctx);

const files = ['util.js','codec.js','world.js','sim.js','render.js','society.js','afterlife.js','cosmos.js','powers.js'];
for (const f of files) vm.runInContext(fs.readFileSync(path.join(base,'js',f),'utf8'), ctx, { filename: f });
const PD = ctx.PD;
console.log('modules loaded:', Object.keys(PD).join(','));

// ---- codec round trips ----
{
  const u8 = new Uint8Array(21600); for (let i=0;i<u8.length;i++) u8[i] = (i/97|0)%18;
  const enc = PD.Codec.packU8(u8); const dec = PD.Codec.unpackU8(enc, u8.length);
  let mm=0; for (let i=0;i<u8.length;i++) if (dec[i]!==u8[i]) mm++;
  console.log('codec u8 roundtrip mismatches:', mm, 'packed len:', enc.length, '(raw would be ~28800)');
  const f32 = new Float32Array(21600); for (let i=0;i<f32.length;i++) f32[i] = (i%255)/255;
  const fe = PD.Codec.packF01(f32); const fd = PD.Codec.unpackF01(fe, f32.length);
  let fm=0; for (let i=0;i<f32.length;i++) if (Math.abs(fd[i]-f32[i])>1/254) fm++;
  console.log('codec f01 roundtrip out-of-tolerance:', fm);
  const i16 = new Int16Array(21600); i16.fill(-1); i16[5]=1200; i16[600]=42;
  const ie = PD.Codec.packI16(i16); const id = PD.Codec.unpackI16(ie, i16.length);
  let im=0; for (let i=0;i<i16.length;i++) if (id[i]!==i16[i]) im++;
  console.log('codec i16 roundtrip mismatches:', im, 'packed len:', ie.length);
}

// ---- wrap math ----
{
  const w = PD.World.createWorld(180, 120, 'wraptest');
  console.log('wrapX(-1)=', PD.World.wrapX(w,-1), 'wrapX(180)=', PD.World.wrapX(w,180));
  console.log('wdist(1,60,179,60)=', PD.World.wdist(w,1,60,179,60).toFixed(2), '(should be 2)');
  // seam continuity: biomes at x=0 and x=179 shouldn't be a hard wall of ocean vs land systematically
  let landAt0=0, landAt179=0;
  for (let y=0;y<120;y++){ if (PD.World.isLand(w.biome[PD.World.idx(w,0,y)])) landAt0++; if (PD.World.isLand(w.biome[PD.World.idx(w,179,y)])) landAt179++; }
  console.log('land tiles at x=0:', landAt0, 'at x=179:', landAt179, '(nonzero both = continents cross the seam)');
}

// ---- multiverse & long sim ----
const Cosmos = PD.Cosmos;
const p1 = Cosmos.createPlanet('verdant', 'g-seed-1');
Cosmos.C.activeId = p1.id;
// seed life
const sim = p1.sim, world = p1.world;
for (let k=0;k<30;k++){ const s=PD.World.nearestLand(world,(sim.rng()*180)|0,(sim.rng()*120)|0,12); if(s) PD.Sim.spawnUnit(sim,'critter',s.x,s.y); }
const seedRaces=['human','elf','dwarf','orc','gnome','halfling','merfolk','fairy'];
let vplaced=0;
for (let a=0;a<400&&vplaced<6;a++){
  const x=(sim.rng()*180)|0,y=(sim.rng()*120)|0;
  const i=PD.World.idx(world,x,y);
  if (PD.World.isLand(world.biome[i])&&world.fert[i]>0.3){ if(PD.Sim.foundVillage(sim,seedRaces[vplaced%seedRaces.length],x,y)) vplaced++; }
}
console.log('villages seeded:', sim.villages.length);

const t0=Date.now();
for (let s2=0;s2<6000;s2++){
  PD.Sim.step(sim,1);
  Cosmos.tickAll(sim);
  Cosmos.checkStarchild(sim);
  if (s2%1500===0){
    PD.Sim.recount(sim);
    const soc=sim.soc||{nations:[],faiths:[],prayers:[],feed:[]};
    console.log(`step ${s2}: units=${sim.units.length} vills=${sim.villages.length} nations=${soc.nations.length} faiths=${soc.faiths.length} prayers=${soc.prayers.length} eras=[${soc.nations.map(n=>n.era).join(',')}]`);
  }
}
console.log('6000 steps in', Date.now()-t0, 'ms');
PD.Sim.recount(sim);
const soc = sim.soc;
console.log('history entries:', soc.history.length, 'sample:', soc.history.slice(0,3).map(h=>h.text));
console.log('counts:', JSON.stringify(Object.fromEntries(Object.entries(sim.counts).filter(([k,v])=>v>0))));

// ---- prayers answer path ----
if (soc.prayers.length){
  const before=soc.prayers.length;
  const refund=PD.Society.answerPrayer(sim, soc.prayers[0].id, false);
  console.log('answered a prayer, refund:', refund, 'queue:', before, '->', soc.prayers.length);
} else console.log('no prayers queued (ok if world is content)');

// ---- empower + hero ----
const mortal = sim.units.find(u=>!u.dead&&PD.Sim.RACES[u.race].sentient);
if (mortal){ PD.Society.empower(sim, mortal, 2); console.log('empowered:', mortal.name, 'paragon', mortal.paragon, 'hp', mortal.maxHp); }

// ---- afterlife ----
PD.Afterlife.init();
const stats1 = PD.Afterlife.stats();
console.log('afterlife totals:', stats1.map(p=>p.id+':'+p.total).join(' '));
const anySoul = stats1.find(p=>PD.Afterlife.AL.planes[p.id].souls.length);
if (anySoul){
  const sname = PD.Afterlife.AL.planes[anySoul.id].souls[0].name;
  const res = PD.Afterlife.resurrect(sname, sim, 90, 60);
  console.log('resurrected:', res? res.name : 'FAILED');
}
const plane = PD.Afterlife.materialize('elysium');
console.log('elysium materialized:', plane.world.W+'x'+plane.world.H, 'units:', plane.sim.units.length);
for (let s3=0;s3<50;s3++) PD.Sim.step(plane.sim,1);
console.log('elysium stepped 50 ok, units now:', plane.sim.units.filter(u=>!u.dead).length);

// ---- doomed planet fast-forward ----
const pd = Cosmos.createPlanet('doomed','doom-seed');
for (let k=0;k<3;k++){ const s=PD.World.nearestLand(pd.world,(pd.sim.rng()*180)|0,(pd.sim.rng()*120)|0,12); if(s) PD.Sim.foundVillage(pd.sim,'human',s.x,s.y); }
pd.meta.doom = 650; // just above rocket threshold
for (let s4=0;s4<700;s4++){ PD.Sim.step(pd.sim,1); Cosmos.tickAll(pd.sim); }
console.log('doomed planet type now:', pd.type, '(expect shattered), rocketFired:', !!pd.meta.rocketFired);
const starchildSim = Cosmos.C.planets.filter(p=>p._starchild!=null||p.sim._starchild!=null);
console.log('a starchild exists somewhere:', Cosmos.C.planets.some(p=>p.sim._starchild!=null));

// ---- primordial evolution ----
const pp = Cosmos.createPlanet('primordial','evo-seed');
Cosmos.C.activeId = pp.id;
for (let e=0;e<5;e++) Cosmos.advanceEvolution(pp);
console.log('evolution complete: type=', pp.type, 'villages:', pp.sim.villages.length, 'units:', pp.sim.units.length);

// ---- custom race ----
const ok = Cosmos.registerRace({key:'x_moss',name:'Mosskin',one:'Mosskin',emoji:'🌿',col:'#9ad0a0',col2:'#3a6a8a',aggr:0.2,breed:1.0,dmg:5,hp:26,spd:0.1,lifespan:2600,flags:['healer']});
console.log('custom race registered:', ok, 'in RACES:', !!PD.Sim.RACES.x_moss, 'sentient list len:', PD.Sim.SENTIENT.length);
const cs = PD.World.nearestLand(pp.world, 90,60, 20);
if (cs){ const cu = PD.Sim.spawnUnit(pp.sim,'x_moss',cs.x,cs.y); console.log('custom unit spawned:', !!cu); }
for (let s5=0;s5<100;s5++) PD.Sim.step(pp.sim,1);
console.log('custom race survived 100 steps:', pp.sim.units.some(u=>!u.dead&&u.race==='x_moss'));

// ---- powers on fake G ----
let weatherSet=null;
let genesisCalls = 0, sabbathCalls = 0, undoCalls = 0;
const fakeG = {
  world: p1.world, sim: p1.sim, faith: 100000, lastRace:'human', power:null,
  setWeather:(t)=>{weatherSet=t;}, selectAt:()=>{}, flash:0, shake:0,
  floodT:0, startFlood(){ this.floodT=700; PD.Society.hist(this.sim,'flood test','fall'); },
  // game-layer hooks the Genesis/Godhead powers call
  view: { kind: 'planet', id: p1.id },
  creationStage: 0, dissolve: 0, omniscient: false, sabbath: false,
  genesisStep(stage){ genesisCalls++; this.creationStage = stage + 1; return 0; },
  setSabbath(on){ sabbathCalls++; },
  undoUnmaking(){ undoCalls++; return true; }
};
ctx.G = fakeG;
let perrs=0;
for (const p of PD.Powers.POWERS){
  try { fakeG.power=Object.assign({},p); const spent=p.apply(fakeG,90,60); if (typeof spent!=='number') throw new Error('bad return'); }
  catch(e){ perrs++; console.error('POWER ERR', p.id, e.message); }
}
console.log('powers tested:', PD.Powers.POWERS.length, 'errors:', perrs);

// ---- THE SECOND WORD: every greater form must survive being invoked ----
// invokeAwe() temporarily swaps a power's cost and radius so the ordinary
// apply() can be reused at scale. If it ever fails to put them back, the
// power is permanently mutated for the rest of the session — free, or with
// a giant radius. That is the failure mode worth pinning.
let aerrs = 0, adone = 0, arestore = 0;
for (const p of PD.Powers.POWERS) {
  const a = PD.Powers.aweOf(p.id);
  if (!a) continue;
  const c0 = p.cost, r0 = p.radius;
  fakeG.power = Object.assign({}, p);
  fakeG.faith = 1e6;
  try {
    const spent = PD.Powers.invokeAwe(fakeG, p, 90, 60);
    if (typeof spent !== 'number') throw new Error('non-numeric return');
    if (spent !== a.cost) throw new Error('spent ' + spent + ' != declared ' + a.cost);
    adone++;
  } catch (e) {
    aerrs++; console.error('AWE ERR', p.id, e.message);
  }
  if (p.cost !== c0 || p.radius !== r0) {
    arestore++;
    console.error('AWE LEAK', p.id, 'cost', c0, '->', p.cost, 'radius', r0, '->', p.radius);
  }
}
console.log('greater forms invoked:', adone, 'errors:', aerrs, 'cost/radius leaks:', arestore);

// a greater form must be refused, not half-applied, when faith is short
let refused = 0;
for (const p of PD.Powers.POWERS) {
  const a = PD.Powers.aweOf(p.id);
  if (!a || a.cost <= 0) continue;
  fakeG.faith = a.cost - 1;
  fakeG.power = Object.assign({}, p);
  if (PD.Powers.invokeAwe(fakeG, p, 90, 60) === 0) refused++;
}
console.log('greater forms correctly refused when faith is short:', refused);
perrs += aerrs + arestore;
if (refused < adone) { console.error('SOME GREATER FORMS FIRED WITHOUT PAYING'); perrs++; }
console.log('genesis hooks fired:', genesisCalls, '| sabbath toggles:', sabbathCalls, '| unmaking undos:', undoCalls);

// ---- every people must have a way into the world ----
// Nine of the thirteen sentient races had no spawn power. The only other
// route was evolution stage 4 picking one of thirteen at random, behind a
// Primordial planet and five advances — so Fairies and Giants were a lottery
// most players would never win, while the intro card promised sixteen
// peoples. Custom races are excluded: they get their power at registration.
{
  const spawnable = new Set();
  for (const p of PD.Powers.POWERS) if (p.race) spawnable.add(p.race);
  const unreachable = PD.Sim.SENTIENT.filter(k => !spawnable.has(k) && !PD.Sim.RACES[k].custom);
  console.log('sentient races:', PD.Sim.SENTIENT.length, '| with a spawn power:',
    PD.Sim.SENTIENT.filter(k => spawnable.has(k)).length,
    '| unreachable:', unreachable.join(', ') || '(none)');
  if (unreachable.length) {
    console.error('REACH ERR: no power can create ' + unreachable.join(', '));
    perrs++;
  }
  // and each one must actually place a living unit, not merely not throw
  let placed = 0, failed = [];
  for (const p of PD.Powers.POWERS) {
    if (!p.race || !PD.Sim.RACES[p.race] || !PD.Sim.RACES[p.race].sentient) continue;
    const before = pp.sim.units.filter(u => !u.dead && u.race === p.race).length;
    fakeG.world = pp.world; fakeG.sim = pp.sim; fakeG.faith = 1e6;
    const spot = PD.World.nearestLand(pp.world, 90, 60, 25);
    if (spot) p.apply(fakeG, spot.x, spot.y);
    const after = pp.sim.units.filter(u => !u.dead && u.race === p.race).length;
    if (after > before) placed++; else failed.push(p.race);
  }
  fakeG.world = p1.world; fakeG.sim = p1.sim;
  console.log('spawn powers that placed a living soul:', placed, failed.length ? '| failed: ' + failed.join(', ') : '');
  if (failed.length) { console.error('REACH ERR: these powers placed nobody: ' + failed.join(', ')); perrs++; }
}

// ---- toggles must toggle ONCE ----
// Sabbath and Omniscience flip a flag. Their greater forms carried reps:3,
// so invokeAwe fired apply() three times and the flag landed exactly where a
// single press would have put it — for four times the faith. A toggle
// repeated is a toggle undone, and no unit test caught it because every other
// greater form is idempotent-ish under repetition.
{
  for (const id of ['sabbath', 'omniscience']) {
    const p = PD.Powers.BY_ID[id];
    const a = PD.Powers.aweOf(id);
    const flag = a && a.flag;
    if (!p || !a || !flag) { console.error('TOGGLE ERR', id, 'no awe entry or no flag'); perrs++; continue; }
    // from OFF, the greater form must leave it ON
    fakeG[flag] = false; fakeG.faith = 1e6;
    PD.Powers.invokeAwe(fakeG, p, 90, 60);
    if (fakeG[flag] !== true) { console.error('TOGGLE ERR', id, 'greater form left it off'); perrs++; }
    // from ON, it must still be ON — never silently switch the player off
    fakeG.faith = 1e6;
    PD.Powers.invokeAwe(fakeG, p, 90, 60);
    if (fakeG[flag] !== true) { console.error('TOGGLE ERR', id, 'greater form turned it back off'); perrs++; }
    fakeG[flag] = false;
  }
  fakeG.omniAll = false;
  console.log('toggle greater forms land ON and stay ON: ok');
}

// ---- Unmake From History must erase one soul, not everyone who shares a
// fragment of their name. Names are GIVEN+GIVEN2 concatenations, so indexOf
// made 'Ala' a match inside 'Alan'. ----
{
  // On its OWN planet. unmake targets the NEAREST living unit, and by this
  // point p1.sim is full of souls the 66-greater-form loop scattered around
  // (90,60) with Math.random() jitter — so which one got erased was never
  // deterministic. It picked the planted victim locally and someone else on
  // CI, and the test reported that the target survived. The claim under test
  // is the name matcher, so give it a world where the target is unambiguous.
  const unP = Cosmos.createPlanet('verdant', 'unmake-seed');
  const soc = PD.Society.ensure(unP.sim);
  soc.history.push({ t: 0, text: 'Alan built a wall.', kind: 'event' });
  soc.history.push({ t: 0, text: 'Ala the quiet died.', kind: 'event' });
  soc.history.push({ t: 0, text: 'Alanna sang.', kind: 'event' });
  const spot = PD.World.nearestLand(unP.world, 90, 60, 25) || { x: 90, y: 60 };
  const victim = PD.Sim.spawnUnit(unP.sim, 'human', spot.x, spot.y);
  const unG = Object.assign({}, fakeG, {
    world: unP.world, sim: unP.sim, faith: 1e6, view: { kind: 'planet', id: unP.id }
  });
  let targeted = null;
  if (victim) {
    victim.name = 'Ala';
    // the only living soul on this world, so it is the one unmake will find
    targeted = unP.sim.units.filter(u => !u.dead).length;
    PD.Powers.BY_ID.unmake.apply(unG, victim.x + 0.1, victim.y + 0.1);
  }
  const left = soc.history.map(h => h.text);
  const survived = left.filter(t => /Alan/.test(t)).length;
  const erased = left.filter(t => /^Ala the/.test(t)).length;
  if (!victim) { console.error('UNMAKE ERR: could not place a victim'); perrs++; }
  if (survived !== 2) { console.error('UNMAKE ERR: strangers erased — expected 2 Alan lines, found', survived, left); perrs++; }
  if (erased !== 0) { console.error('UNMAKE ERR: the target survived (living souls on that world: ' + targeted + ')'); perrs++; }
  console.log('unmake erases whole names only: Alan/Alanna lines left =', survived,
    '(expect 2), target lines left =', erased, '(expect 0), living souls on that world:', targeted);
}

// ---- the hidden act ----
// Breath of Life empties limbo. Under a blood moon, one of them comes back
// wrong — and that is the only way a first vampire has ever been able to
// exist. Nothing in the UI says so, so this is the only thing that will
// notice if it stops working.
{
  // A dedicated planet: p1 has run 6000 steps and sits AT its unit cap, and
  // resurrect() cannot place anyone into a full world — the power refuses
  // before the egg is ever reached. That is real behaviour, not a bug here,
  // but it means this assertion needs a world with room in it.
  const eggP = Cosmos.createPlanet('verdant', 'egg-seed');
  const sim = eggP.sim;
  const deeds = [];
  const eggG = Object.assign({}, fakeG, {
    world: eggP.world, sim: eggP.sim, faith: 1e6,
    view: { kind: 'planet', id: eggP.id },
    deed: (id) => deeds.push(id)
  });
  const vampCount = () => sim.counts.vampire || 0;

  const stock = () => {
    // Put souls in the Grayfields so Breath of Life has something to do.
    // karma must be negative: the Grayfields band is -8..0 and a fresh unit
    // sits at exactly 0, which routes to the Meadows by a hair.
    for (let i = 0; i < 6; i++) {
      const u = PD.Sim.spawnUnit(sim, 'human', 90 + (i % 3), 60 + ((i / 3) | 0));
      if (u) { u.karma = -2; PD.Sim.killUnit(sim, u, 'starve'); }
    }
    PD.Sim.step(sim, 1);
  };

  // (a) no blood moon: an ordinary miracle, and no vampire
  stock();
  sim.bloodMoonT = 0;
  const before = vampCount();
  eggG.faith = 1e6;
  PD.Powers.BY_ID.breath.apply(eggG, 90, 60);
  PD.Sim.step(sim, 1);
  const plain = vampCount() - before;
  console.log('breath of life without a blood moon — vampires created:', plain, '(expect 0)');
  if (plain !== 0) { console.error('EGG ERR: a vampire appeared with no blood moon'); perrs++; }

  // (b) under a blood moon: exactly one, and the deed fires
  stock();
  sim.bloodMoonT = 400;
  eggG.faith = 1e6;
  PD.Powers.BY_ID.breath.apply(eggG, 90, 60);
  PD.Sim.step(sim, 1);
  const made = vampCount();
  console.log('breath of life UNDER a blood moon — vampires now:', made, '| deeds:', deeds.join(',') || '(none)');
  if (made < 1) { console.error('EGG ERR: no patient zero under a blood moon'); perrs++; }
  if (deeds.indexOf('firstthirst') < 0) { console.error('EGG ERR: the hidden deed did not fire'); perrs++; }

  // (c) it happens once. A second casting must not mint a second progenitor.
  stock();
  sim.bloodMoonT = 400;
  const had = vampCount();
  eggG.faith = 1e6;
  PD.Powers.BY_ID.breath.apply(eggG, 90, 60);
  PD.Sim.step(sim, 1);
  const again = vampCount() - had;
  console.log('a second casting under a second blood moon — new progenitors:', again, '(expect 0)');
  if (again > 0) { console.error('EGG ERR: patient zero can be made twice'); perrs++; }

}

// ---- serialization of the whole thing (like game.js does) ----
// minimal replication of packPlanet/unpackPlanet correctness via codec
const w1 = p1.world;
const encB = PD.Codec.packU8(w1.biome);
const decB = PD.Codec.unpackU8(encB, w1.n);
let bm=0; for (let i=0;i<w1.n;i++) if (decB[i]!==w1.biome[i]) bm++;
console.log('planet biome codec mismatches after 6000 steps:', bm);
const afSer = PD.Afterlife.serialize();
console.log('afterlife serializes, planes:', Object.keys(afSer).length);
console.log('cosmos serializes, planets:', Cosmos.serialize().planets.length);

// This suite signals most failures by throwing, which exits non-zero on its
// own — but power errors were CAUGHT into `perrs`, reported, and then the
// script printed PASSED and exited 0 regardless. A broken power would have
// shown a green check. Make the counted failures actually fail the run.
if (perrs > 0) {
  console.error('\n=== core failures: ' + perrs + ' power(s) threw ===');
  console.error('CORE TEST FAILED');
  process.exitCode = 1;
} else {
  console.log('\nALL GENESIS CORE TESTS PASSED (no exceptions).');
}
