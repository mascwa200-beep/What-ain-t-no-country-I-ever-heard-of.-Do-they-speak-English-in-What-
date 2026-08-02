/* =========================================================================
   PIXEL DEITY — game.js
   The conductor: game loop over a whole multiverse, faith economy, input,
   camera, floods/storms/tornadoes, time travel, the Testament story, and
   every panel of the divine interface. Infinite play, autosaved.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;
  const Sim = PD.Sim;
  const Render = PD.Render;
  const Powers = PD.Powers;
  const Audio8 = PD.Audio8;
  const Cosmos = PD.Cosmos;
  const Codec = PD.Codec;

  const SAVE_KEY = 'pixeldeity_save_v2';
  const OLD_KEY = 'pixeldeity_save_v1';
  const STEP_MS = 1000 / 6;

  // ================= The time dial =================
  // One scale spanning reverse -> forward. Reverse speeds play recorded
  // history backwards; past the record they un-create the world itself.
  const TIME_SCALES = [
    { v: -1000, label: '⧏⧏⧏', name: 'Unmaking' },
    { v: -100,  label: '⧏⧏',  name: 'Ages Reversed' },
    { v: -10,   label: '⧏',   name: 'Rewind' },
    { v: -1,    label: '◀',   name: 'Backwards' },
    { v: 0,     label: '❚❚', name: 'Paused' },
    { v: 0.1,   label: '▷',   name: 'Bullet Time' },
    { v: 0.25,  label: '▷',   name: 'Slow' },
    { v: 1,     label: '▶',   name: 'Normal' },
    { v: 5,     label: '▶▶', name: 'Fast' },
    { v: 25,    label: '▶▶', name: 'Very Fast' },
    { v: 100,   label: '▶▶▶', name: 'Centuries' },
    { v: 1000,  label: '▶▶▶', name: 'Millennia' }
  ];
  const IDX_PAUSE = 4, IDX_NORMAL = 7;
  const IDX_UNMAKING = 0;   // only this notch may un-create the world
  // ticks per displayed year (the HUD has always divided by 120)
  const TICKS_PER_YEAR = 120;

  // A world remembers how un-created it is; the god's own progress through
  // creation does not survive a reload on its own. This maps one back to the
  // other so a save can always be resumed at the right word.
  const CREATION_STAGE_BY_MODE = { nothing: 0, deep: 1, firmament: 2 };
  const $ = (s) => document.querySelector(s);

  const BIOME_NAMES = ['Deep Ocean', 'Water', 'Sand', 'Grassland', 'Forest', 'Dirt', 'Mountain', 'Snow', 'Desert', 'Jungle', 'Swamp', 'Ash', 'Hellrock', 'Lava', 'Cloudfield', 'Golden Meadow', 'Primordial Ooze', 'Voidstone'];

  const G = {
    world: null, sim: null, r: null,
    view: { kind: 'planet', id: -1 },       // or {kind:'plane', id:'elysium'}
    faith: 60, faithTotal: 0,
    power: null, lastRace: 'human',
    speed: 1, speedIdx: 7, paused: false,
    acc: 0, lastT: 0,
    selected: null,
    weather: 'clear', weatherT: 0,
    flash: 0, shake: 0,
    floodT: 0, storm: null, tornado: null,
    ui: { showLabels: true, overUI: false, mouseW: null, brushRadius: 1, brushColor: '#fff' },
    running: false,
    saveTimer: 0, snapTimer: 0,
    timeline: [],                            // time-travel snapshots
    story: { done: {}, active: 0 },
    stats: { born: 0, died: 0, peakPop: 0 },
    ach: {},                                 // achievement counters
    divinity: 0,                             // prestige: permanent faith multiplier
    armageddon: 0,
    openPanel: null
  };
  global.G = G;
  PD.Game = G;

  // ================= View management =================
  function bindView() {
    // point G.world/G.sim (and the renderer) at whatever is being gazed upon
    if (G.view.kind === 'plane') {
      const plane = PD.Afterlife.materialize(G.view.id);
      G.world = plane.world; G.sim = plane.sim;
    } else {
      const p = Cosmos.getPlanet(G.view.id) || Cosmos.C.planets[0];
      if (!p) return;
      G.view.id = p.id; Cosmos.C.activeId = p.id;
      G.world = p.world; G.sim = p.sim;
    }
    if (G.r) Render.setWorld(G.r, G.world);
    G.selected = null;
    refreshPanelSel();
    refreshHUD();
  }

  function gotoPlanet(id) { G.view = { kind: 'planet', id }; bindView(); flashToast('You gaze upon ' + (Cosmos.getPlanet(id) || {}).name); }
  function gotoPlane(id) { G.view = { kind: 'plane', id }; bindView(); flashToast('You descend into ' + PD.Afterlife.AL.planes[id].meta.name); }

  // ================= World / multiverse lifecycle =================
  function newMultiverse(seedStr) {
    Cosmos.C.planets.length = 0;
    Cosmos.C.nextId = 1;
    G.faith = 60; G.faithTotal = 0;
    G.timeline.length = 0;
    initRewind();
    G.creationStage = null; G.dissolve = 0;
    G.story = { done: {}, active: 0 };
    const p = Cosmos.createPlanet('verdant', seedStr);
    Cosmos.C.activeId = p.id;
    seedInitialLife(p.sim, p.world);
    Sim.recount(p.sim);
    G.view = { kind: 'planet', id: p.id };
    bindView();
  }

  function seedInitialLife(sim, world) {
    for (let k = 0; k < 40; k++) {
      const x = (sim.rng() * world.W) | 0, y = (sim.rng() * world.H) | 0;
      const s = W.nearestLand(world, x, y, 12);
      if (s) Sim.spawnUnit(sim, sim.rng() < 0.15 ? 'wolf' : 'critter', s.x, s.y);
    }
    const races = ['human', 'elf', 'dwarf'];
    let placed = 0; const spots = [];
    for (let attempt = 0; attempt < 300 && placed < 3; attempt++) {
      const x = (sim.rng() * world.W) | 0, y = (sim.rng() * world.H) | 0;
      if (!W.inBounds(world, x, y)) continue;
      const i = W.idx(world, x, y);
      if (!(W.isLand(world.biome[i]) && world.fert[i] > 0.35)) continue;
      let ok = true;
      for (const s of spots) if (W.wdist(world, s.x, s.y, x, y) < 35) { ok = false; break; }
      if (!ok) continue;
      Sim.foundVillage(sim, races[placed % races.length], x, y);
      spots.push({ x, y }); placed++;
    }
  }

  // ================= Faith economy =================
  function faithPerStep() {
    const c = G.sim.counts;
    let pop = 0;
    for (const k of Sim.SENTIENT) pop += c[k] || 0;
    let temples = 0, wonders = 0;
    for (const v of G.sim.villages) { temples += v.temples; wonders += v.wonders || 0; }
    let f = 0.04 + pop * 0.014 + temples * 0.22 + wonders * 0.8;
    if (PD.Society) f += PD.Society.faithBonus(G.sim);
    // Divinity: each transcendence permanently multiplies the flow of faith
    return f * (1 + G.divinity * 0.25);
  }

  // ---- Transcendence (prestige): trade a multiverse for permanent power
  // ================= Themed ask / confirm =================
  // Native confirm() and prompt() are unstyleable, and they broke the frame
  // at exactly the moments that should feel weightiest — unmaking a world,
  // transcending, starting over. Promise-based so the call sites read the
  // same way they did.
  function ask(opts) {
    return new Promise((resolve) => {
      const m = $('#ask-modal');
      if (!m) { resolve(opts.input != null ? global.prompt(opts.body, opts.input) : global.confirm(opts.body)); return; }
      const input = $('#ask-input'), okBtn = $('#ask-ok'), cancel = $('#ask-cancel');
      $('#ask-title').textContent = opts.title || 'Are you certain?';
      $('#ask-body').textContent = opts.body || '';
      okBtn.textContent = opts.ok || 'Confirm';
      cancel.textContent = opts.cancel || 'Cancel';
      m.classList.toggle('has-input', opts.input != null);
      m.classList.toggle('danger', !!opts.danger);
      if (opts.input != null) { input.value = opts.input; }
      m.classList.add('show');
      if (opts.input != null) setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 30);

      const done = (val) => {
        m.classList.remove('show');
        okBtn.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };
      const onOk = () => done(opts.input != null ? input.value : true);
      const onCancel = () => done(opts.input != null ? null : false);
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
        else if (e.key === 'Enter' && opts.input != null) { e.stopPropagation(); onOk(); }
      };
      okBtn.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey, true);
    });
  }

  function transcendCost() { return 2000 * Math.pow(3, G.divinity); }
  async function transcend() {
    const cost = transcendCost();
    if (G.faithTotal < cost) {
      flashToast(`Transcendence needs ${Math.floor(cost)} total faith earned (you: ${Math.floor(G.faithTotal)})`);
      Audio8.sfx('error'); return;
    }
    const yes = await ask({
      title: 'Transcend',
      body: `Your multiverse dissolves into pure divinity. You begin again — but every world you make from now on yields 25% more faith, forever, for each transcendence.\n\nDivinity: ${G.divinity} → ${G.divinity + 1}`,
      ok: 'Dissolve it all', danger: true
    });
    if (!yes) return;
    G.divinity++;
    ach('transcends');
    const d = G.divinity;
    wipeSave();
    newMultiverse();
    G.divinity = d;
    G.faith = 60 + d * 100; // ascended gods start richer
    Render.FX.clear();
    $('#menu-modal').classList.remove('show');
    flashToast(`DIVINITY ${d}. All faith flows ${25 * d}% faster, forever.`);
    Audio8.sfx('levelup');
    save();
  }

  // ---- Achievements ----
  const ACHIEVEMENTS = [
    { id: 'smites', name: 'Thunderer', desc: 'Cast 25 lightning bolts', need: 25 },
    { id: 'meteors', name: 'Sky-Breaker', desc: 'Call down 10 meteors', need: 10 },
    { id: 'blessings', name: 'The Gentle Hand', desc: 'Bless 50 times', need: 50 },
    { id: 'prayers', name: 'The Listener', desc: 'Answer 20 prayers', need: 20 },
    { id: 'worlds', name: 'Worldsmith', desc: 'Create 3 planets', need: 3 },
    { id: 'unmade', name: 'The Unmaker', desc: 'Destroy a planet', need: 1 },
    { id: 'resurrections', name: 'Deathless', desc: 'Resurrect 5 souls', need: 5 },
    { id: 'heroes', name: 'Mythmaker', desc: 'Empower 5 paragons', need: 5 },
    { id: 'races', name: 'Genesis Engine', desc: 'Design a custom race', need: 1 },
    { id: 'floods', name: 'Deluge', desc: 'Flood the world', need: 1 },
    { id: 'timetravels', name: 'Chronarch', desc: 'Bend time 3 times', need: 3 },
    { id: 'transcends', name: 'BEYOND', desc: 'Transcend reality itself', need: 1 }
  ];
  function ach(id, n) {
    G.ach[id] = (G.ach[id] || 0) + (n || 1);
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a && G.ach[id] === a.need) {
      flashToast(`🏆 Achievement: ${a.name}`);
      G.faith += 100;
      Audio8.sfx('levelup');
    }
  }

  // ================= Sim stepping =================
  function simStep() {
    Sim.step(G.sim, 1);
    if (G.view.kind === 'planet' && G.speed > 0) {
      const ap = Cosmos.active();
      if (ap) recordRewind(ap);
    }
    if (G.view.kind === 'planet' && G.speed > 0) {
      Cosmos.tickAll(G.sim);
      Cosmos.checkStarchild(G.sim);
    }
    const gain = faithPerStep();
    G.faith = Math.min(9999999, G.faith + gain);
    G.faithTotal += gain;
    stepEvents();
    let pop = 0; for (const k of Sim.SENTIENT) pop += G.sim.counts[k] || 0;
    if (pop > G.stats.peakPop) G.stats.peakPop = pop;
  }

  // ---- flood / storm / tornado (divine weather events) ----
  G.startFlood = function () {
    const world = G.world;
    world._preFlood = world.elev.slice();
    // spare the most righteous village: raise its ground first
    let best = null, bk = -1e9;
    for (const v of G.sim.villages) {
      let k = 0, n = 0;
      for (const u of G.sim.units) if (!u.dead && u.village === v.id) { k += u.karma; n++; }
      if (n > 0 && k / n > bk) { bk = k / n; best = v; }
    }
    if (best) W.raise(world, best.x, best.y, best.radius + 2, 0.15);
    for (let i = 0; i < world.n; i++) world.elev[i] = Math.max(0, world.elev[i] - 0.1);
    W.classify(world);
    world.dirty = true; world.dirtyMini = true; world.dirtyGlobe = true;
    G.floodT = 700;
    if (PD.Society) {
      PD.Society.hist(G.sim, 'THE GREAT FLOOD. The waters swallow the world.' + (best ? ` Only righteous ${best.name} stands above the waves.` : ''), 'fall');
      PD.Society.reactToMiracle(G.sim, 'flood');
    }
    G.setWeather('rain', 700);
  };
  function endFlood() {
    const world = G.world;
    if (world._preFlood) {
      // waters recede (spared ground keeps its height)
      for (let i = 0; i < world.n; i++) world.elev[i] = Math.max(world.elev[i], world._preFlood[i]);
      world._preFlood = null;
      W.classify(world);
      world.dirty = true; world.dirtyMini = true; world.dirtyGlobe = true;
      if (PD.Society) PD.Society.hist(G.sim, 'The waters recede. A rainbow arcs over the mud. Never again — probably.', 'faith');
    }
    G.floodT = 0;
  }
  function stepEvents() {
    if (G.floodT > 0) { G.floodT--; if (G.floodT <= 0) endFlood(); }
    if (G.storm) {
      G.storm.t--;
      if (G.storm.t % 30 === 0 && Math.random() < 0.8) {
        const sx = G.storm.x + (Math.random() - 0.5) * G.storm.r * 2;
        const sy = G.storm.y + (Math.random() - 0.5) * G.storm.r * 2;
        PD.FX.bolt(sx, sy - 25, sx, sy); PD.FX.lightning(sx, sy);
        Sim.damageArea(G.sim, sx, sy, 2, 30, null);
        if (Math.random() < 0.3) W.ignite(G.world, Math.floor(sx), Math.floor(sy), 1);
        Audio8.sfx('lightning'); G.flash = 0.3;
      }
      if (G.storm.t <= 0) G.storm = null;
    }
    if (G.armageddon > 0) {
      G.armageddon--;
      // meteors hammer random points across the whole round world
      if (G.armageddon % 10 === 0) {
        const world = G.world;
        const mx = Math.random() * world.W, my = 4 + Math.random() * (world.H - 8);
        PD.FX.explosion(mx, my, Math.random() < 0.3);
        PD.FX.shock(mx, my, 3, '#ffb060');
        W.raise(world, Math.floor(mx), Math.floor(my), 2, -0.06);
        W.ignite(world, Math.floor(mx), Math.floor(my), 2);
        Sim.damageArea(G.sim, mx, my, 3, 80, null);
        world.dirtyMini = true;
        if (Math.random() < 0.4) { Audio8.sfx('meteor'); G.shake = Math.max(G.shake, 6); }
      }
      if (G.armageddon <= 0 && PD.Society) PD.Society.hist(G.sim, 'The last meteor falls. What remains, rebuilds.', 'event');
    }
    if (G.tornado) {
      const t = G.tornado;
      t.t--;
      t.vx += (Math.random() - 0.5) * 0.06; t.vy += (Math.random() - 0.5) * 0.04;
      t.vx = PD.clamp(t.vx, -0.4, 0.4); t.vy = PD.clamp(t.vy, -0.3, 0.3);
      t.x = W.wrapX(G.world, t.x + t.vx); t.y = PD.clamp(t.y + t.vy, 2, G.world.H - 2);
      Sim.damageArea(G.sim, t.x, t.y, 2, 6, null);
      const ix = Math.floor(t.x), iy = Math.floor(t.y);
      const i = W.idx(G.world, ix, iy);
      if (G.world.struct[i] && Math.random() < 0.3) { G.world.struct[i] = W.S.RUIN; W.markTile(G.world, i); }
      if (G.world.tree[i] && Math.random() < 0.4) { G.world.tree[i] = 0; W.markTile(G.world, i); }
      for (let k = 0; k < 4; k++) PD.FX.spawn(t.x + (Math.random() - 0.5) * 2, t.y - Math.random() * 2, (Math.random() - 0.5) * 0.3, -0.1, 16, '#b8bcc4', 2);
      if (t.t <= 0) G.tornado = null;
    }
  }

  // ================= Offline progress =================
  function runOffline(elapsedSec) {
    const cap = (24 + G.divinity * 12) * 3600; // ascended gods idle longer
    elapsedSec = Math.min(elapsedSec, cap);
    if (elapsedSec < 20) return null;
    let steps = Math.floor(elapsedSec * 6);
    const beforePop = countPop(), beforeFaith = G.faith, beforeVills = G.sim.villages.length;
    const budgetMs = 1500, start = performance.now();
    let done = 0;
    const target = Math.min(steps, 6000);
    for (let i = 0; i < target; i++) {
      simStep(); done++;
      if ((i & 63) === 0 && performance.now() - start > budgetMs) break;
    }
    const remaining = steps - done;
    if (remaining > 0) G.faith = Math.min(9999999, G.faith + remaining * faithPerStep() * 0.6);
    Sim.recount(G.sim);
    return {
      time: elapsedSec, faith: Math.floor(G.faith - beforeFaith),
      popDelta: countPop() - beforePop, villDelta: G.sim.villages.length - beforeVills,
      pop: countPop(), vills: G.sim.villages.length
    };
  }
  function countPop() {
    let n = 0; for (const k of Sim.SENTIENT) n += G.sim.counts[k] || 0;
    return n + (G.sim.counts.undead || 0);
  }

  // ================= Serialization (v2: whole multiverse) ==============
  function packPlanet(p) {
    const w = p.world, s = p.sim;
    return {
      id: p.id, name: p.name, type: p.type, seed: p.seed, meta: p.meta,
      orbit: p.orbit, rot: p.rot, mode: w.mode,
      seaShift: w.seaShift, tempShift: w.tempShift, moistShift: w.moistShift,
      biome: Codec.packU8(w.biome), elev: Codec.packF01(w.elev),
      moist: Codec.packF01(w.moist), temp: Codec.packF01(w.temp),
      fert: Codec.packF01(w.fert), tree: Codec.packU8(w.tree),
      owner: Codec.packI16(w.owner), struct: Codec.packU8(w.struct),
      fire: Codec.packU8(w.fire), structHp: Codec.packU8(w.structHp),
      tick: s.tick, nextUnitId: s.nextUnitId, nextVillageId: s.nextVillageId,
      villages: s.villages, soc: s.soc || null, starchild: s._starchild || null,
      bloodMoon: s.bloodMoonT || 0,
      // the pre-flood heightmap: lose this mid-flood and the drowning is permanent
      preFlood: w._preFlood ? Codec.packF01(w._preFlood) : null,
      units: s.units.filter(u => !u.dead).map(u => [
        u.id, u.race, +u.x.toFixed(2), +u.y.toFixed(2), Math.round(u.hp),
        u.age | 0, u.village, u.sick | 0, +u.food.toFixed(2),
        Math.round(u.lifespan), u.adultAt | 0, u.name, u.trait, u.prof,
        Math.round(u.karma * 10) / 10, u.paragon | 0, u.big || 0, Math.round(u.maxHp)
      ])
    };
  }

  function unpackPlanet(d) {
    const world = W.createWorld(180, 120, d.seed, { mode: d.mode, seaShift: d.seaShift, tempShift: d.tempShift, moistShift: d.moistShift });
    const n = world.n;
    world.biome.set(Codec.unpackU8(d.biome, n));
    world.elev.set(Codec.unpackF01(d.elev, n));
    world.moist.set(Codec.unpackF01(d.moist, n));
    world.temp.set(Codec.unpackF01(d.temp, n));
    world.fert.set(Codec.unpackF01(d.fert, n));
    world.tree.set(Codec.unpackU8(d.tree, n));
    world.owner.set(Codec.unpackI16(d.owner, n));
    world.struct.set(Codec.unpackU8(d.struct, n));
    if (d.fire) world.fire.set(Codec.unpackU8(d.fire, n));
    if (d.structHp) world.structHp.set(Codec.unpackU8(d.structHp, n));
    world.dirty = true; world.dirtyMini = true;
    const sim = Sim.createSim(world, PD.makeRNG(PD.hashSeed(d.seed) ^ 0x9e3779b9));
    sim.tick = d.tick || 0;
    sim.nextUnitId = d.nextUnitId || 1; sim.nextVillageId = d.nextVillageId || 1;
    sim.villages = d.villages || [];
    sim.soc = d.soc || null;
    sim._starchild = d.starchild || null;
    sim.bloodMoonT = d.bloodMoon || 0;
    sim.planetName = d.name;
    if (d.preFlood) world._preFlood = Codec.unpackF01(d.preFlood, n);
    sim.units = (d.units || []).map(a => {
      const R = Sim.RACES[a[1]] || Sim.RACES.human;
      return {
        id: a[0], race: Sim.RACES[a[1]] ? a[1] : 'human', x: a[2], y: a[3],
        hp: a[4], maxHp: a[17] || (a[15] > 0 ? R.hp * (1 + a[15] * 2) : R.hp),
        age: a[5], village: a[6], sick: a[7], food: a[8],
        lifespan: a[9] != null ? a[9] : Math.max(R.lifespan * 1.2, a[5] + 200),
        adultAt: a[10] != null ? a[10] : 70,
        name: a[11] || Sim.personName(a[1], Math.random), trait: a[12] || 0,
        prof: a[13] || 0, karma: a[14] || 0, paragon: a[15] || 0,
        state: 'wander', tx: a[2], ty: a[3], cd: 0, breedCd: 40,
        raidT: 0, raidX: 0, raidY: 0, flip: 1, bob: Math.random() * 6.28,
        big: a[16] || 0
      };
    });
    Sim.recount(sim);
    return {
      id: d.id, name: d.name, type: d.type, seed: d.seed, meta: d.meta || {},
      orbit: d.orbit, rot: d.rot || 0, world, sim
    };
  }

  function serialize() {
    return {
      v: 2, t: Date.now(),
      faith: G.faith, faithTotal: G.faithTotal, lastRace: G.lastRace,
      speed: G.speed, stats: G.stats, story: G.story,
      divinity: G.divinity, ach: G.ach,
      view: G.view, floodT: G.floodT,
      // in-flight divine events: without these a 250-faith Armageddon just
      // stops on reload, and a mid-flood save loses _preFlood forever
      armageddon: G.armageddon, storm: G.storm, tornado: G.tornado,
      weather: G.weather, weatherT: G.weatherT,
      // where we are in un-creation / creation. packPlanet already persists
      // world.mode, so without these a save taken in the Deep or in Nothing
      // reloads as a black empty sphere with the Genesis powers hidden.
      speedIdx: G.speedIdx, creationStage: G.creationStage, dissolve: G.dissolve,
      omniscient: !!G.omniscient, sabbath: !!G.sabbath, preSabbathIdx: G._preSabbathIdx,
      cam: G.r ? { lon: G.r.cam.lon, lat: G.r.cam.lat, dist: G.r.cam.dist } : null,
      cosmos: { nextId: Cosmos.C.nextId, activeId: Cosmos.C.activeId, customRaces: Cosmos.customRaces },
      planets: Cosmos.C.planets.map(packPlanet),
      afterlife: PD.Afterlife.serialize()
    };
  }

  function save() {
    try {
      PD.store.setItem(SAVE_KEY, JSON.stringify(serialize()));
      flashToast('Multiverse saved');
      return true;
    } catch (e) { console.warn('save failed', e); flashToast('Save failed (storage full?)'); return false; }
  }

  function backupBrokenSave(raw) {
    // a save we can't read must never be clobbered by the next autosave
    try { PD.store.setItem(SAVE_KEY + '_backup', raw); } catch (e) {}
  }

  function load() {
    let raw;
    try { raw = PD.store.getItem(SAVE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    let d;
    try { d = JSON.parse(raw); } catch (e) { backupBrokenSave(raw); return false; }
    if (!d || d.v !== 2 || !d.planets || !d.planets.length) { backupBrokenSave(raw); return false; }
    try {
      // custom races must exist before units referencing them are unpacked
      for (const cr of (d.cosmos && d.cosmos.customRaces) || []) Cosmos.registerRace(cr);
      // ...and give them their toolbar buttons back (registerRace alone
      // restores the race but not the power to place it)
      for (const cr of (d.cosmos && d.cosmos.customRaces) || []) addCustomSpawnPower(cr.key);
      Cosmos.C.planets.length = 0;
      for (const pd of d.planets) Cosmos.C.planets.push(unpackPlanet(pd));
      Cosmos.C.nextId = (d.cosmos && d.cosmos.nextId) || (Cosmos.C.planets.length + 1);
      Cosmos.C.activeId = (d.cosmos && d.cosmos.activeId) || Cosmos.C.planets[0].id;
      PD.Afterlife.load(d.afterlife);
      G.faith = d.faith != null ? d.faith : 60;
      G.faithTotal = d.faithTotal || 0;
      G.lastRace = d.lastRace || 'human';

      // ---- creation state, and the guard that rescues soft-locked saves ----
      G.creationStage = (d.creationStage != null) ? d.creationStage : null;
      G.dissolve = d.dissolve || 0;
      G.omniscient = !!d.omniscient;
      G.sabbath = !!d.sabbath;
      G._preSabbathIdx = d.preSabbathIdx;
      // Builds before this one never stored creationStage, so their saves can
      // come back as an un-created world with no way to create it again. The
      // world's own mode is the one witness that survived — trust it over the
      // absent field, and hand the player back the right word to speak.
      const lp = Cosmos.getPlanet(Cosmos.C.activeId) || Cosmos.C.planets[0];
      const lw = lp && lp.world;
      if (G.creationStage == null && lw && CREATION_STAGE_BY_MODE[lw.mode] != null) {
        G.creationStage = CREATION_STAGE_BY_MODE[lw.mode];
        if (lw.mode === 'nothing') G.dissolve = 1;
      }
      // a restored game must never rewind against whatever buffer was lying
      // around from the boot world
      initRewind();

      // never resume a save mid-rewind. Route through setSpeedIdx so the dial,
      // G.speed and G.paused can't disagree — and so creation still holds time.
      let si = (typeof d.speedIdx === 'number') ? d.speedIdx : null;
      if (si == null) si = nearestScaleIdx(typeof d.speed === 'number' ? d.speed : 1);
      setSpeedIdx(Math.max(IDX_PAUSE, si), true);

      G.stats = d.stats || G.stats;
      G.story = d.story || G.story;
      G.divinity = d.divinity || 0;
      G.ach = d.ach || {};
      // in-flight events resume where they left off
      G.armageddon = d.armageddon || 0;
      G.storm = d.storm || null;
      G.tornado = d.tornado || null;
      if (d.weather) G.setWeather(d.weather, d.weatherT || 0);
      G.floodT = d.floodT || 0;
      G.view = (d.view && d.view.kind === 'planet' && Cosmos.getPlanet(d.view.id)) ? d.view : { kind: 'planet', id: Cosmos.C.activeId };
      bindView();
      if (d.cam && d.cam.lon != null && G.r) { G.r.cam.lon = d.cam.lon; G.r.cam.lat = d.cam.lat; G.r.cam.dist = d.cam.dist; }
      if (G.speed !== 0) {
        const off = runOffline((Date.now() - (d.t || Date.now())) / 1000);
        if (off) showOffline(off);
      }
      return true;
    } catch (e) {
      console.warn('load failed', e);
      backupBrokenSave(raw);
      newMultiverse();
      return false;
    }
  }
  function hasSave() { try { return !!PD.store.getItem(SAVE_KEY); } catch (e) { return false; } }
  function wipeSave() { try { PD.store.removeItem(SAVE_KEY); PD.store.removeItem(OLD_KEY); } catch (e) {} }

  // ================= Time travel =================
  function takeSnapshot() {
    if (G.view.kind !== 'planet') return;
    const p = Cosmos.active(); if (!p) return;
    G.timeline.push({
      when: Date.now(), tick: p.sim.tick, year: Math.floor(p.sim.tick / 120),
      planetId: p.id, planetName: p.name, data: JSON.stringify(packPlanet(p))
    });
    if (G.timeline.length > 10) G.timeline.shift();
  }
  function timeTravel(idx, branch) {
    const snap = G.timeline[idx]; if (!snap) return;
    const pd = JSON.parse(snap.data);
    if (branch) {
      // a new universe forks from the old moment — check capacity BEFORE
      // consuming an id, or a failed branch leaks one
      if (Cosmos.C.planets.length >= 10) { flashToast('The void is full — destroy a world first'); return; }
      pd.id = Cosmos.C.nextId++;
      pd.name = snap.planetName + ' ⧗';
      pd.orbit = { r: 60 + Cosmos.C.planets.length * 34, a: Math.random() * 6.28, spd: 0.001 };
      const p = unpackPlanet(pd);
      Cosmos.C.planets.push(p);
      gotoPlanet(p.id);
      flashToast('A new timeline branches from Year ' + snap.year);
    } else {
      const i = Cosmos.C.planets.findIndex(x => x.id === snap.planetId);
      if (i < 0) { flashToast('That world no longer exists — branch instead'); return; }
      const p = unpackPlanet(pd);
      Cosmos.C.planets[i] = p;
      gotoPlanet(p.id);
      flashToast('Time rewinds to Year ' + snap.year + '. It never happened.');
    }
    if (PD.Society) PD.Society.hist(G.sim, branch ? 'You forked time itself.' : 'You turned back time itself.', 'legend');
    ach('timetravels');
  }

  // ================= Rewind: time running backwards =================
  // A full snapshot is ~310KB, so a naive dense buffer would cost tens of
  // megabytes. Instead we keep two tiers:
  //   fine  — packed unit motion only (~13KB), for smooth reverse movement
  //   full  — real restore points (terrain, villages, society, souls)
  // Between full frames the fine frames drive what you SEE; crossing a full
  // frame restores what actually IS.
  const REWIND = {
    fineEvery: 4,      // sim ticks between motion frames
    fullEvery: 60,     // sim ticks between true restore points
    fineCap: 400,      // ~27 min of 1x play, ~6.6MB
    fullCap: 24,       // ~14MB at full population (a mature snapshot measures 610KB,
                       // not the 311KB a young world costs — measured, not estimated)
    // The deep archive. fine+full together only span ~13 in-game years, which
    // is nothing against a world that has been running for centuries. These
    // are the same snapshots, kept at 5-year intervals and then THINNED
    // GEOMETRICALLY — dense in living memory, sparse in antiquity — so a
    // fixed 28 slots reach all the way back to the world's first morning.
    archEvery: 600,    // 5 years. A multiple of fullEvery: the snapshot is shared, not re-taken
    archCap: 28        // ~17MB. Spacing grows with age, so 28 slots cover a world of ANY age
                       // (measured: 500 ages thin to 28, spanning year 0 → 2500).
                       // Whole-engine rewind residency tops out near 38MB.
  };

  // Drop the snapshot that is packed tighter than its age warrants, so the
  // archive relaxes into a geometric series. The oldest entry is never a
  // candidate: whatever else goes, the beginning is kept.
  function thinArchive(arch, now) {
    while (arch.length > REWIND.archCap) {
      let victim = -1, best = Infinity;
      for (let i = 1; i < arch.length - 1; i++) {
        const age = Math.max(1, now - arch[i].tick);
        const cost = (arch[i + 1].tick - arch[i - 1].tick) / age;
        if (cost < best) { best = cost; victim = i; }
      }
      if (victim < 0) { arch.shift(); continue; }
      arch.splice(victim, 1);
    }
  }

  // How long the ⧏⧏⧏ notch must be held, once the record runs out, before
  // the world actually starts coming apart. Un-creation is the one act in the
  // game that can't be walked back tile by tile, so it asks first.
  const UNMAKE_ARM_MS = 2000;

  function initRewind() {
    G.rewind = {
      fine: [], full: [], arch: [], stage: 0, prog: 0,
      undo: null,      // the last moment before the unmaking — the way home
      armed: false,    // un-creation has actually begun
      arm: 0,          // 0..1 progress through the arming hold
      atFloor: false,  // the record is exhausted; only ⧏⧏⧏ goes further
      inArchive: false,// walking back through whole ages
      archT: 0         // paces how fast the ages blur past
    };
  }

  // Put the world back the way it was the instant before it started to come
  // apart. Reachable by key, and as the first power offered in the void.
  function undoUnmaking() {
    const rw = G.rewind;
    if (!rw || !rw.undo) { flashToast('There is nothing to undo'); Audio8.sfx('error'); return false; }
    restoreFull(rw.undo);
    rw.undo = null; rw.armed = false; rw.arm = 0; rw.stage = 0; rw.prog = 0;
    rw.atFloor = false; rw.inArchive = false; rw.archT = 0;
    rw.fine.length = 0; rw.full.length = 0; rw.arch.length = 0;
    G.creationStage = null; G.dissolve = 0;
    setSpeedIdx(IDX_PAUSE, true);
    buildToolbar();
    if (PD.Society) PD.Society.hist(G.sim, 'You thought better of it. The world is as it was.', 'legend');
    flashToast('The unmaking is undone');
    Audio8.sfx('levelup');
    return true;
  }
  G.undoUnmaking = undoUnmaking;

  // Motion-only frame: ids + positions + hp as typed arrays (no JSON).
  function captureFine(sim) {
    const live = [];
    for (const u of sim.units) if (!u.dead) live.push(u);
    const n = live.length;
    const ids = new Int32Array(n), xy = new Float32Array(n * 2), hp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ids[i] = live[i].id;
      xy[i * 2] = live[i].x; xy[i * 2 + 1] = live[i].y;
      hp[i] = live[i].hp;
    }
    return { tick: sim.tick, ids, xy, hp, faith: G.faith };
  }

  // Full restore point. Extends packPlanet with the state it drops, so a
  // restore doesn't scramble everyone's movement or strand souls.
  function captureFull(p) {
    const d = packPlanet(p);
    const motion = [];
    for (const u of p.sim.units) {
      if (u.dead) continue;
      motion.push([u.id, u.state, +u.tx.toFixed(2), +u.ty.toFixed(2), u.cd, u.breedCd, u.raidT, u.flip]);
    }
    return {
      tick: p.sim.tick, planetId: p.id, data: d, motion,
      souls: PD.Afterlife.serialize(),
      faith: G.faith, faithTotal: G.faithTotal,
      stats: JSON.parse(JSON.stringify(G.stats)),
      ach: JSON.parse(JSON.stringify(G.ach)),
      ev: { armageddon: G.armageddon, storm: G.storm, tornado: G.tornado, floodT: G.floodT }
    };
  }

  function recordRewind(p) {
    const rw = G.rewind; if (!rw) return;
    const t = p.sim.tick;
    if (t % REWIND.fineEvery === 0) {
      rw.fine.push(captureFine(p.sim));
      if (rw.fine.length > REWIND.fineCap) rw.fine.shift();
    }
    if (t % REWIND.fullEvery === 0) {
      const f = captureFull(p);
      rw.full.push(f);
      if (rw.full.length > REWIND.fullCap) rw.full.shift();
      // archEvery is a multiple of fullEvery, so the deep archive keeps the
      // very same snapshot object — remembering an age costs nothing extra
      if (t % REWIND.archEvery === 0) { rw.arch.push(f); thinArchive(rw.arch, t); }
      // fine frames older than the oldest restore point are unusable
      const floor = rw.full[0].tick;
      while (rw.fine.length && rw.fine[0].tick < floor) rw.fine.shift();
    }
  }

  // Apply a full restore point in place.
  function restoreFull(f) {
    const i = Cosmos.C.planets.findIndex(x => x.id === f.planetId);
    if (i < 0) return false;
    const p = unpackPlanet(f.data);
    // put movement back the way it was — packPlanet resets it
    const byId = new Map();
    for (const u of p.sim.units) byId.set(u.id, u);
    for (const m of f.motion || []) {
      const u = byId.get(m[0]);
      if (!u) continue;
      u.state = m[1]; u.tx = m[2]; u.ty = m[3];
      u.cd = m[4]; u.breedCd = m[5]; u.raidT = m[6]; u.flip = m[7];
    }
    Cosmos.C.planets[i] = p;
    if (G.view.kind === 'planet' && G.view.id === f.planetId) {
      G.world = p.world; G.sim = p.sim;
      if (G.r) Render.setWorld(G.r, G.world);
    }
    PD.Afterlife.load(f.souls);
    G.faith = f.faith; G.faithTotal = f.faithTotal;
    G.stats = f.stats; G.ach = f.ach;
    if (f.ev) { G.armageddon = f.ev.armageddon; G.storm = f.ev.storm; G.tornado = f.ev.tornado; G.floodT = f.ev.floodT; }
    p.world.dirty = p.world.dirtyMini = p.world.dirtyGlobe = true;
    return true;
  }

  // Apply a motion-only frame to the live sim: people walk backwards.
  function applyFine(sim, f) {
    const byId = new Map();
    for (const u of sim.units) if (!u.dead) byId.set(u.id, u);
    for (let i = 0; i < f.ids.length; i++) {
      const u = byId.get(f.ids[i]);
      if (!u) continue;
      u.x = f.xy[i * 2]; u.y = f.xy[i * 2 + 1]; u.hp = f.hp[i];
    }
    sim.tick = f.tick;
    G.faith = f.faith;
    sim.season = Math.floor((sim.tick % 480) / 120);
    sim.isNight = Math.cos(((sim.tick % 480) / 480) * 6.283) * 0.5 + 0.15 > 0.3;
  }

  // Driven from loop() whenever G.speed < 0.
  function stepRewind(dt) {
    const rw = G.rewind; if (!rw) return;
    G._reversed = true;   // the Testament notices, however you got here
    if (G.view.kind !== 'planet') { flashToast('Only living worlds can be rewound'); setSpeedIdx(IDX_PAUSE); return; }
    let p = Cosmos.active(); if (!p) return;
    const rate = Math.abs(G.speed);
    // how many recorded ticks to unwind this frame
    let budget = Math.max(1, Math.round(rate * 6 * dt / 1000 * REWIND.fineEvery));

    while (budget > 0 && rw.fine.length) {
      const f = rw.fine[rw.fine.length - 1];
      // crossing a restore point: put the world itself back
      const full = rw.full.length ? rw.full[rw.full.length - 1] : null;
      if (full && f.tick <= full.tick) {
        rw.full.pop();
        restoreFull(full);
        // restoreFull swaps in a NEW planet object; without this the rest of
        // the frame would walk people around a world no longer on the map
        p = Cosmos.active(); if (!p) return;
      } else {
        applyFine(p.sim, f);
      }
      rw.fine.pop();
      budget -= REWIND.fineEvery;
    }

    // The detailed record is spent, but the world is older than the record.
    // Walk back through the deep archive — whole ages at a time — before
    // anything is allowed to come apart.
    if (!rw.fine.length && rw.arch.length) {
      while (rw.arch.length && rw.arch[rw.arch.length - 1].tick >= p.sim.tick) rw.arch.pop();
      if (rw.arch.length) {
        const stepMs = Math.max(60, 4000 / Math.max(1, rate));
        rw.archT += dt;
        let moved = false;
        while (rw.arch.length && rw.archT >= stepMs) {
          rw.archT -= stepMs;
          restoreFull(rw.arch.pop());
          p = Cosmos.active(); if (!p) return;
          moved = true;
        }
        rw.inArchive = true;
        rw.atFloor = false;
        if (moved) Audio8.sfx('terra');
        p.world.dirtyMini = true;
        return;
      }
    }
    rw.inArchive = false;
    rw.archT = 0;

    if (!rw.fine.length) {
      // Past the beginning of the record. This is where the world itself comes
      // apart — so it takes a deliberate act, not the tail end of a scrub.
      rw.atFloor = true;
      if (!rw.armed) {
        if (G.speedIdx !== IDX_UNMAKING) {
          // any other reverse speed simply stops at the oldest recorded moment
          rw.arm = 0;
          p.world.dirtyMini = true;
          return;
        }
        rw.arm = Math.min(1, rw.arm + dt / UNMAKE_ARM_MS);
        if (rw.arm < 1) { p.world.dirtyMini = true; return; }
        // the point of no return — take the one snapshot that can undo it
        rw.armed = true;
        rw.undo = captureFull(p);
        if (PD.Society) PD.Society.hist(p.sim, 'The unmaking begins.', 'legend');
        flashToast('The unmaking begins — press U to undo');
        Audio8.sfx('quake');
      }
      stepUncreate(p, dt, rate);
    }
    p.world.dirtyMini = true;
  }

  // ---- Un-creation: the world unmakes itself, stage by stage ----
  const UNCREATE_STAGES = [
    { id: 'unbuild', name: 'THE WORKS UNDONE', sub: 'cities unbuild · nations forget' },
    { id: 'unshape', name: 'THE LAND UNSHAPES', sub: 'mountains sink · forests recede' },
    { id: 'deep',    name: 'THE FORMLESS DEEP', sub: 'darkness upon the face of the deep' },
    { id: 'nothing', name: 'NOTHING',           sub: 'before the beginning' }
  ];

  function stepUncreate(p, dt, rate) {
    const rw = G.rewind, world = p.world, sim = p.sim;
    rw.prog += (dt / 1000) * Math.min(4, 0.35 + rate * 0.02);
    const stage = rw.stage;

    if (stage === 0) {           // ---- Unbuilding ----
      const frac = Math.min(1, rw.prog / 3);
      let cleared = 0;
      for (let k = 0; k < 900; k++) {
        const i = (Math.random() * world.n) | 0;
        if (world.struct[i] || world.owner[i] >= 0) {
          world.struct[i] = 0; world.owner[i] = -1; W.markTile(world, i); cleared++;
        }
      }
      // people fade out of existence
      const live = sim.units.filter(u => !u.dead);
      const target = Math.floor(live.length * (1 - frac));
      for (let i = live.length - 1; i > target; i--) {
        const u = live[i];
        if (PD.FX) PD.FX.puff(u.x, u.y, '#8fb4e0');
        u.dead = true;
      }
      sim.villages.length = Math.floor(sim.villages.length * (1 - frac));
      if (frac >= 1 || (!cleared && !live.length)) { rw.stage = 1; rw.prog = 0; sim.soc = null; }

    } else if (stage === 1) {    // ---- Unshaping ----
      const t = Math.min(1, rw.prog / 4);
      for (let i = 0; i < world.n; i++) {
        // every height eases toward a featureless sphere at sea level
        world.elev[i] += (0.40 - world.elev[i]) * 0.06;
        world.fert[i] *= 0.94;
        if (world.tree[i] && Math.random() < 0.06) world.tree[i]--;
      }
      W.classify(world);
      world.dirty = world.dirtyMini = world.dirtyGlobe = true;
      if (t >= 1) { rw.stage = 2; rw.prog = 0; }

    } else if (stage === 2) {    // ---- The Deep ----
      world.mode = 'deep';
      for (let i = 0; i < world.n; i++) {
        world.elev[i] += (0.10 - world.elev[i]) * 0.10;
        world.biome[i] = W.B.DEEP; world.fert[i] = 0; world.tree[i] = 0;
        world.struct[i] = 0; world.owner[i] = -1;
      }
      world.dirty = world.dirtyMini = world.dirtyGlobe = true;
      sim.units.length = 0; sim.villages.length = 0; sim.tick = 0;
      if (rw.prog > 3.5) { rw.stage = 3; rw.prog = 0; }

    } else {                     // ---- Nothing ----
      world.mode = 'nothing';
      G.dissolve = Math.min(1, (G.dissolve || 0) + dt / 2500);
      if (G.dissolve >= 1) {
        // time itself stops; only Genesis can start it again
        G.creationStage = 0;
        G._sawNothing = true;
        setSpeedIdx(IDX_PAUSE, true);
        buildToolbar();
        flashToast('In the beginning…');
      }
    }
  }

  function rewindBannerText() {
    const rw = G.rewind;
    if (!rw) return null;
    const year = Math.floor(G.sim.tick / TICKS_PER_YEAR);
    if (rw.fine.length) return { t: '⟲ REWINDING', s: 'Year ' + year };
    if (rw.inArchive) {
      // whole ages at a time, back toward the world's first morning
      return {
        t: '⟲ THE AGES REVERSED',
        s: rw.arch.length ? 'Year ' + year + '  ·  ' + rw.arch.length + ' ages remain'
                          : 'Year ' + year + '  ·  the first morning'
      };
    }
    if (!rw.armed) {
      // the record is spent. Say so honestly — this is not the whole of history
      // running backwards, it is the edge of what was written down.
      if (G.speedIdx !== IDX_UNMAKING) {
        return { t: '⟲ THE FIRST MORNING', s: 'there is no earlier · to go further, hold ⧏⧏⧏ · the Unmaking' };
      }
      const bar = '█'.repeat(Math.round(rw.arm * 12)).padEnd(12, '░');
      return { t: 'UNMAKING', s: bar + '  release to stop' };
    }
    const st = UNCREATE_STAGES[Math.min(rw.stage, UNCREATE_STAGES.length - 1)];
    return { t: st.name, s: st.sub + '  ·  press U to undo' };
  }

  // ================= Genesis: creation, step by step =================
  // Reached only by rewinding past the beginning. Each step is a real
  // world-shaping operation on the empty sphere, in order.
  const GENESIS_NAMES = ['light', 'firmament', 'land', 'green', 'lights', 'life', 'rest'];

  G.genesisStep = function (stage) {
    if (G.creationStage !== stage) { Audio8.sfx('error'); return 0; }
    const p = Cosmos.active();
    if (!p) { Audio8.sfx('error'); return 0; }
    const world = p.world, sim = p.sim;

    if (stage === 0) {              // Let there be light
      G.dissolve = 0;
      world.mode = 'deep';
      G.flash = 1;
      if (PD.Society) PD.Society.hist(sim, 'And there was light. The darkness upon the face of the deep is parted.', 'era');

    } else if (stage === 1) {       // Separate the waters — a sky
      world.mode = 'firmament';
      for (let i = 0; i < world.n; i++) { world.elev[i] = 0.30; world.biome[i] = W.B.DEEP; }
      W.classify(world);
      if (PD.Society) PD.Society.hist(sim, 'A firmament divides the waters. There is a sky, and weather in it.', 'era');

    } else if (stage === 2) {       // Dry land appears
      world.mode = 'normal';
      const seed = p.seed + '-genesis';
      const fresh = W.createWorld(world.W, world.H, seed, {});
      world.elev.set(fresh.elev); world.moist.set(fresh.moist); world.temp.set(fresh.temp);
      // land rises but nothing grows on it yet
      W.classify(world);
      for (let i = 0; i < world.n; i++) { world.tree[i] = 0; if (W.isLand(world.biome[i])) world.fert[i] = 0.05; }
      if (PD.Society) PD.Society.hist(sim, 'The waters gather. Dry land appears, bare and new.', 'era');

    } else if (stage === 3) {       // Vegetation
      for (let i = 0; i < world.n; i++) {
        if (!W.isLand(world.biome[i])) continue;
        const m = world.moist[i], t = world.temp[i];
        if (t > 0.28 && m > 0.5) { world.biome[i] = m > 0.68 && t > 0.68 ? W.B.JUNGLE : W.B.FOREST; world.tree[i] = 2; world.fert[i] = 0.75; }
        else if (t > 0.28 && m > 0.3) { world.biome[i] = W.B.GRASS; world.fert[i] = 0.6; }
      }
      if (PD.Society) PD.Society.hist(sim, 'The earth brings forth grass, and the herb, and the fruit tree.', 'era');

    } else if (stage === 4) {       // Lights in the firmament — time starts
      sim.tick = 0;
      if (PD.Society) PD.Society.hist(sim, 'Lights in the firmament, for signs and for seasons. Time begins to move.', 'era');

    } else if (stage === 5) {       // Life
      for (let k = 0; k < 60; k++) {
        const spot = W.nearestLand(world, (sim.rng() * world.W) | 0, (sim.rng() * world.H) | 0, 14);
        if (spot) Sim.spawnUnit(sim, sim.rng() < 0.8 ? 'critter' : 'wolf', spot.x, spot.y);
      }
      seedInitialLife(sim, world);
      Sim.recount(sim);
      if (PD.Society) PD.Society.hist(sim, 'The waters teem, the earth brings forth the living creature — and someone to name them.', 'era');

    } else if (stage === 6) {       // Rest
      G.faith += 500;
      G.creationStage = null;
      G._recreated = true;          // a whole creation, spoken start to finish
      p.type = 'verdant';
      if (PD.Society) PD.Society.hist(sim, 'And on the seventh day: rest. It is good. +500 ✦', 'legend');
      flashToast('Creation complete · +500 ✦');
      initRewind();
      setSpeedIdx(IDX_NORMAL);
      buildToolbar();
      world.dirty = world.dirtyMini = world.dirtyGlobe = true;
      Audio8.sfx('levelup');
      return 0;
    }

    world.dirty = world.dirtyMini = world.dirtyGlobe = true;
    if (G.r) Render.setWorld(G.r, world);
    G.creationStage = stage + 1;
    if (stage === 4) setSpeedIdx(IDX_NORMAL, true);  // time may flow again
    buildToolbar();
    Audio8.sfx('levelup');
    PD.FX.shock(world.W / 2, world.H / 2, 20, '#ffffff');
    return 0;
  };

  // Sabbath: the world holds still, but the god does not.
  G.setSabbath = function (on) {
    if (on) { G._preSabbathIdx = G.speedIdx; setSpeedIdx(IDX_PAUSE, true); }
    else setSpeedIdx(G._preSabbathIdx != null ? G._preSabbathIdx : IDX_NORMAL, true);
  };

  // ================= Testament story =================
  const CHAPTERS = [
    { id: 'genesis', title: 'I. The Shaping', text: 'In the beginning you hovered over the face of the waters. Shape the land. Raise mountains, plant forests.', hint: 'Use Raise Land or Grow Forest anywhere.', check: () => G._usedTerra },
    { id: 'life', title: 'II. Breath of Life', text: 'Breathe life into the dust. Let peoples walk your world.', hint: 'Spawn any sentient race from the Life tab.', check: () => { let n = 0; for (const k of Sim.SENTIENT) n += G.sim.counts[k] || 0; return n >= 10; } },
    { id: 'watch', title: 'III. The Watchers', text: 'They build without your hand. Watch a village become a town.', hint: 'Wait, or feed a village with Bless/Miracle. A village must reach level 2.', check: () => G.sim.villages.some(v => v.level >= 2) },
    { id: 'prayer', title: 'IV. The First Prayer', text: 'They are starting to look up. Answer them.', hint: 'Open the Prayers tab (🙏) and answer 3 prayers.', check: () => (G._prayersAnswered || 0) >= 3 },
    { id: 'faith', title: 'V. Organized Faith', text: 'Let them build a church around the answering.', hint: 'A faith forms on its own once temples exist — or use Anoint Prophet.', check: () => PD.Society && PD.Society.ensure(G.sim).faiths.length > 0 },
    { id: 'law', title: 'VI. The Law', text: 'Faith without law is a fire without a hearth. Hand down commandments.', hint: 'Use the Commandments power (Testament tab).', check: () => PD.Society && PD.Society.ensure(G.sim).faiths.some(f => f.commandments > 0) },
    { id: 'wrath', title: 'VII. Wrath', text: 'They must know both sides of you. Show them judgement.', hint: 'Use Lightning, Meteor, Plague, or the Great Flood.', check: () => G._usedWrath },
    { id: 'hero', title: 'VIII. The Chosen', text: 'Raise up a mortal as your champion against the dark.', hint: 'Use Empower Hero (Godhead tab) on any citizen.', check: () => PD.Society && PD.Society.ensure(G.sim).heroes.length > 0 },
    { id: 'beyond', title: 'IX. The Beyond', text: 'Where do they go when they die? Walk your own heavens and hells.', hint: 'Open the Souls tab (👻) and Visit any plane.', check: () => G._visitedPlane },
    { id: 'return', title: 'X. Resurrection', text: 'Death answers to you. Bring one back.', hint: 'In the Souls tab, resurrect any soul.', check: () => G._resurrected },
    { id: 'cosmos', title: 'XI. Many Worlds', text: 'One world is a garden. Many is a cosmos. Create a second planet.', hint: 'Open the Cosmos tab (🪐) and create a planet.', check: () => Cosmos.C.planets.length >= 2 },
    { id: 'modern', title: 'XII. The Wired Age', text: 'Let a nation grow until it wires itself together and posts about you.', hint: 'A nation must reach the Modern era. Prosperous big nations advance faster.', check: () => PD.Society && PD.Society.ensure(G.sim).internetOn },
    // The dial goes the other way too — and nothing in the game said so.
    { id: 'turnback', title: 'XIII. Turn Back', text: 'Time has only ever run one way for them. It has never had to, for you. Take an hour of history back.', hint: 'The time dial runs left of the pause bar: ◀ ⧏ ⧏⧏ ⧏⧏⧏. Press R, or tap any arrow left of ❚❚.', check: () => G._reversed },
    { id: 'before', title: 'XIV. Before the Beginning', text: 'Keep going. Past the first city, past the first breath, past the first morning — to the night that had no evening before it.', hint: 'Hold the leftmost notch (⧏⧏⧏ · Unmaking) once the record runs out. The works undo, the land unshapes, the deep goes dark. Press U at any point to take it all back.', check: () => G._sawNothing },
    { id: 'recreate', title: 'XV. Let There Be Light', text: 'There is nothing, and you are still here. That was always the difference between you and everything else. Now say it again, from the first word.', hint: 'From Nothing, the Genesis powers appear one at a time: light, firmament, dry land, grass, the lights, life — then rest.', check: () => G._recreated },
    { id: 'eternity', title: '∞. Eternity', text: 'There is no ending. Shatter worlds, fork time, seed primordial oceans, and watch it all rise again. You are what remains.', hint: 'Everything. Forever.', check: () => false }
  ];
  function stepStory() {
    const ch = CHAPTERS[G.story.active];
    if (!ch || G.story.done[ch.id]) return;
    let ok = false;
    try { ok = !!ch.check(); } catch (e) {}
    if (ok) {
      G.story.done[ch.id] = true;
      G.faith += 40;
      flashToast(ch.title + ' complete · +40 ✦');
      Audio8.sfx('levelup');
      if (G.story.active < CHAPTERS.length - 1) G.story.active++;
      renderTestament();
    }
  }

  // ================= Selection =================
  G.selectAt = function (wx, wy) {
    let best = null, bd = 2.2;
    for (const u of G.sim.units) {
      if (u.dead) continue;
      const d = W.wdist(G.world, u.x + 0.5, u.y + 0.5, wx, wy);
      if (d < bd) { bd = d; best = u; }
    }
    if (best) { G.selected = { type: 'unit', ref: best }; Audio8.sfx('select'); refreshPanelSel(); return; }
    const ix = Math.floor(wx), iy = Math.floor(wy);
    if (W.inBounds(G.world, ix, iy)) {
      const o = G.world.owner[W.idx(G.world, ix, iy)];
      if (o >= 0) { const v = Sim.villageById(G.sim, o); if (v) { G.selected = { type: 'village', ref: v }; Audio8.sfx('select'); refreshPanelSel(); return; } }
      let bv = null, bvd = 6;
      for (const v of G.sim.villages) { const d = W.wdist(G.world, v.x, v.y, wx, wy); if (d < bvd) { bvd = d; bv = v; } }
      if (bv) { G.selected = { type: 'village', ref: bv }; Audio8.sfx('select'); refreshPanelSel(); return; }
      G.selected = { type: 'tile', x: ix, y: iy };
      refreshPanelSel();
    }
  };

  G.setWeather = function (type, dur) { G.weather = type; G.weatherT = dur; if (G.r) G.r.weather = type; };
  G.onPrayer = function () { updateTabBadges(); };

  // ================= Powers =================
  function setPower(id) {
    const p = Powers.BY_ID[id];
    if (!p) return;
    G.power = Object.assign({}, p);
    G.power.radius = p.radius;
    G.ui.brushColor = p.color;
    G.ui.brushRadius = p.radius;
    highlightPower(id);
    updatePowerInfo(p);
    Audio8.sfx('click');
  }

  // Every power declares its own hooks (ach / story / react), so adding a
  // power no longer means editing three hardcoded lists in this file.
  function onPowerUsed(p, spent) {
    if (spent != null) G.faith -= spent;
    refreshHUD();
    const story = p.story || (p.cat === 'terra' ? 'terra' : (p.cat === 'wrath' ? 'wrath' : null));
    if (story === 'terra') G._usedTerra = true;
    else if (story === 'wrath') G._usedWrath = true;
    if (p.ach) ach(p.ach);
    if (p.react && PD.Society) PD.Society.reactToMiracle(G.sim, p.react);
  }

  // ================= Game loop =================
  function loop(t) {
    if (!G.running) return;
    const dt = Math.min(100, t - G.lastT);
    G.lastT = t;
    handleKeyPan(dt);

    if (!G.paused && G.speed > 0) {
      G.acc += dt * G.speed;
      // step against a wall-clock budget rather than a fixed count, so
      // 1000x self-tunes to the device instead of pegging at 40/frame
      const budgetStart = performance.now();
      let steps = 0;
      while (G.acc >= STEP_MS) {
        simStep(); G.acc -= STEP_MS; steps++;
        if ((steps & 7) === 0 && performance.now() - budgetStart > 12) break;
      }
      // never let the accumulator run away: unspent time is dropped, not banked
      if (G.acc > STEP_MS * 4) G.acc = STEP_MS * 4;
    } else if (G.speed < 0) {
      stepRewind(dt);
    }

    if (G.weatherT > 0) { G.weatherT -= dt / STEP_MS; if (G.weatherT <= 0) { G.weather = 'clear'; G.r.weather = 'clear'; } }
    autoWeather();

    Render.FX.update();
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt / 300);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt / 30);

    // Shake is a real camera kick now (render3d stepCam), not a CSS transform
    // on the DOM canvas — which used to move the element out from under the
    // pointer and desync picking against getBoundingClientRect.
    Render.draw(G.r, G.sim, G.ui);
    drawOverlays();
    if (G.flash > 0 && G.r.octx) { const c = G.r.octx; c.fillStyle = `rgba(255,255,255,${G.flash * 0.5})`; c.fillRect(0, 0, G.r.w, G.r.h); }

    G.hudTimer = (G.hudTimer || 0) + dt;
    if (G.hudTimer > 250) {
      refreshHUD(); if (G.selected) refreshPanelSel();
      refreshOpenPanel();
      // the story advances whichever way time is running — the chapters about
      // reversal and un-creation would otherwise only land once you went
      // forward again, long after the moment they describe
      stepStory();
      G.hudTimer = 0;
    }

    // autosave and the chronicle only advance while time moves forward —
    // never persist or bookmark a world mid-unmaking
    if (G.speed > 0) {
      G.saveTimer += dt;
      if (G.saveTimer > 20000) { save(); G.saveTimer = 0; }
      G.snapTimer += dt;
      if (G.snapTimer > 90000) { takeSnapshot(); G.snapTimer = 0; }
    }

    if (G.openPanel === 'cosmos') drawCosmos(t);

    requestAnimationFrame(loop);
  }

  function drawOverlays() {
    if (!G.r.octx) return;
    // ---- time running backwards: grade the whole frame ----
    const ban = $('#rewind-banner');
    if (G.speed < 0) {
      const ctx = G.r.octx, w = G.r.w, h = G.r.h;
      ctx.fillStyle = 'rgba(40,90,160,0.13)';
      ctx.fillRect(0, 0, w, h);
      // scanline tear sweeping upward — reality skipping in reverse
      const sweep = (1 - ((G.lastT * 0.0006) % 1)) * h;
      const g = ctx.createLinearGradient(0, sweep - 60, 0, sweep + 60);
      g.addColorStop(0, 'rgba(150,200,255,0)');
      g.addColorStop(0.5, 'rgba(180,220,255,0.16)');
      g.addColorStop(1, 'rgba(150,200,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, sweep - 60, w, 120);
      ctx.fillStyle = 'rgba(200,230,255,0.05)';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
      if (ban) {
        const txt = rewindBannerText();
        if (txt) {
          ban.classList.add('show');
          // only touch the DOM when the words actually change — this used to
          // rewrite innerHTML on every single frame of a rewind
          const html = `<div class="rw-title">${txt.t}</div><div class="rw-sub">${txt.s}</div>`;
          if (html !== G._banHtml) { ban.innerHTML = html; G._banHtml = html; }
        }
      }
    } else if (ban && ban.classList.contains('show')) {
      ban.classList.remove('show');
      G._banHtml = null;
    }
    // tornado funnel: a rising spiral of dust in true 3D
    if (G.tornado) {
      const t = G.tornado;
      for (let k = 0; k < 3; k++) {
        const a = G.lastT * 0.02 + k * 2.1;
        PD.FX.spawn(t.x + Math.cos(a) * (0.5 + k * 0.5), t.y + Math.sin(a) * (0.5 + k * 0.5),
          Math.cos(a + 1.57) * 0.3, Math.sin(a + 1.57) * 0.3, 14, '#b8bcc4', 1.6, -0.004);
      }
    }
    // doomed core countdown
    const p = G.view.kind === 'planet' ? Cosmos.active() : null;
    if (p && p.meta.doom != null) {
      const ctx = G.r.octx;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(G.r.w / 2 - 130, 58, 260, 26);
      ctx.fillStyle = p.meta.doom < 900 ? '#ff5030' : '#f0a040';
      ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`⚠ CORE COLLAPSE IN ${Math.ceil(p.meta.doom / 120)} YEARS ⚠`, G.r.w / 2, 75);
      ctx.textAlign = 'left';
    }
    // primordial progress
    if (p && p.meta.evo != null) {
      const ctx = G.r.octx;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(G.r.w / 2 - 130, 58, 260, 26);
      ctx.fillStyle = '#8cdcc8'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`🧬 ${Cosmos.EVO_STAGES[p.meta.evo]} ${(p.meta.evoProg || 0).toFixed(0)}%`, G.r.w / 2, 75);
      ctx.textAlign = 'left';
    }
  }

  function autoWeather() {
    if (G.weather !== 'clear' || G.world.mode !== 'normal') return;
    if (G.sim.tick % 200 === 0) {
      const r = G.sim.rng();
      if (G.sim.season === 3 && r < 0.4) G.setWeather('snow', 300);
      else if (r < 0.2) G.setWeather('rain', 300);
    }
  }

  // ================= Camera / input =================
  let keys = {};
  function handleKeyPan(dt) {
    const cam = G.r.cam;
    const spd = 0.022 * (dt / 16) * Math.max(0.35, (cam.dist - 1) / 1.6);
    let moved = false;
    if (keys['w'] || keys['arrowup']) { cam.lat += spd; moved = true; }
    if (keys['s'] || keys['arrowdown']) { cam.lat -= spd; moved = true; }
    if (keys['a'] || keys['arrowleft']) { cam.lon -= spd; moved = true; }
    if (keys['d'] || keys['arrowright']) { cam.lon += spd; moved = true; }
    if (moved) { cam.idle = 0; clampCam(); }
  }
  function clampCam() {
    const cam = G.r.cam;
    cam.dist = PD.clamp(cam.dist, cam.min, cam.max);
    cam.lat = PD.clamp(cam.lat, -1.45, 1.45);
    const T = Math.PI * 2;
    cam.lon = ((cam.lon % T) + T) % T;
  }

  function bindInput() {
    const cv = G.r.canvas;
    let dragging = false, panning = false, lastX = 0, lastY = 0, moved = 0;

    function localXY(e) {
      const rect = cv.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      return { x: cx, y: cy };
    }
    function applyPower(sx, sy) {
      const wc = Render.screenToWorld(G.r, sx, sy);
      G.ui.mouseW = wc;
      const p = G.power;
      if (!p || !wc) return; // clicked past the planet's limb into space
      if (Powers.soundAt) Powers.soundAt(wc.x, wc.y, G.world.W, G.world.H);
      const spent = p.apply(G, wc.x, wc.y);
      if (Powers.soundAt) Powers.soundAt(null);
      if (spent > 0) onPowerUsed(p);
    }
    function onMinimap(x, y) {
      const m = G.r._mini;
      return m && x >= m.mx && x <= m.mx + m.MW && y >= m.my && y <= m.my + m.MH;
    }
    function jumpMinimap(x, y) {
      const m = G.r._mini, cam = G.r.cam, world = G.world;
      const tx = (x - m.mx) / m.scale, ty = (y - m.my) / m.scale;
      cam.lon = (tx / world.W) * Math.PI * 2;
      cam.lat = Math.PI / 2 - (ty / world.H) * Math.PI;
      cam.idle = 0; clampCam();
    }

    cv.addEventListener('mousedown', (e) => {
      Audio8.unlock();
      const l = localXY(e);
      lastX = l.x; lastY = l.y; moved = 0;
      if (onMinimap(l.x, l.y)) { jumpMinimap(l.x, l.y); e.preventDefault(); return; }
      const p = G.power;
      if (e.button === 2 || e.button === 1 || (p && p.pan)) { panning = true; }
      else { dragging = true; applyPower(l.x, l.y); }
      e.preventDefault();
    });
    global.addEventListener('mousemove', (e) => {
      const rect = cv.getBoundingClientRect();
      const l = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      G.ui.mouseW = Render.screenToWorld(G.r, l.x, l.y);
      const dx = l.x - lastX, dy = l.y - lastY; moved += Math.abs(dx) + Math.abs(dy);
      if (panning) {
        const cam = G.r.cam, k = 0.0035 * Math.max(0.35, (cam.dist - 1) / 1.6);
        cam.lon -= dx * k; cam.lat += dy * k; cam.idle = 0; clampCam();
      }
      else if (dragging && G.power && G.power.cont) applyPower(l.x, l.y);
      lastX = l.x; lastY = l.y;
    });
    global.addEventListener('mouseup', () => {
      if (panning && moved < 5 && G.power && G.power.id === 'inspect') applyPower(lastX, lastY);
      dragging = false; panning = false;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cam = G.r.cam;
      cam.dist *= e.deltaY < 0 ? (1 / 1.12) : 1.12;
      cam.idle = 0; clampCam();
    }, { passive: false });

    // touch
    let pinchD = 0, touchPanning = false;
    cv.addEventListener('touchstart', (e) => {
      Audio8.unlock();
      if (e.touches.length >= 2) {
        pinchD = touchDist(e); touchPanning = false; dragging = false;
      } else {
        const l = localXY(e); lastX = l.x; lastY = l.y; moved = 0;
        if (onMinimap(l.x, l.y)) { jumpMinimap(l.x, l.y); e.preventDefault(); return; }
        const p = G.power;
        if (p && p.pan) touchPanning = true;
        else { dragging = true; applyPower(l.x, l.y); }
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      if (e.touches.length >= 2) {
        const nd = touchDist(e);
        const cam = G.r.cam;
        cam.dist *= (pinchD || nd) / nd;
        cam.idle = 0;
        pinchD = nd; clampCam();
      } else {
        const l = localXY(e); const dx = l.x - lastX, dy = l.y - lastY; moved += Math.abs(dx) + Math.abs(dy);
        G.ui.mouseW = Render.screenToWorld(G.r, l.x, l.y);
        if (touchPanning) {
          const cam = G.r.cam, k = 0.0035 * Math.max(0.35, (cam.dist - 1) / 1.6);
          cam.lon -= dx * k; cam.lat += dy * k; cam.idle = 0; clampCam();
        }
        else if (dragging && G.power && G.power.cont) applyPower(l.x, l.y);
        lastX = l.x; lastY = l.y;
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', () => {
      if (touchPanning && moved < 8 && G.power && G.power.id === 'inspect') applyPower(lastX, lastY);
      dragging = false; touchPanning = false;
    });

    // Typing into any field must never fire a hotkey — 'r' should not reverse
    // time while you are naming a race in the Genesis Lab.
    const inField = (e) => {
      const t = e.target;
      if (!t || !t.tagName) return false;
      const tag = t.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
    };

    // keyboard
    global.addEventListener('keydown', (e) => {
      if (inField(e)) return;
      const k = e.key.toLowerCase(); keys[k] = true;
      if (k === ' ') { e.preventDefault(); togglePause(); }
      else if (k === '1') setSpeedIdx(IDX_NORMAL);
      else if (k === '2') setSpeedIdx(IDX_NORMAL + 1);
      else if (k === '3') setSpeedIdx(IDX_NORMAL + 2);
      else if (k === '4') setSpeedIdx(IDX_NORMAL + 3);
      else if (k === '5') setSpeedIdx(IDX_NORMAL + 4);
      else if (k === '0') setSpeedIdx(IDX_PAUSE);
      else if (k === ',') setSpeedIdx(G.speedIdx - 1);
      else if (k === '.') setSpeedIdx(G.speedIdx + 1);
      else if (k === 'r') setSpeedIdx(G.speed < 0 ? Math.max(0, G.speedIdx - 1) : IDX_PAUSE - 1);
      else if (k === 'u') undoUnmaking();
      else if (k === '=' || k === '+') zoomBy(1.2);
      else if (k === '-' || k === '_') zoomBy(1 / 1.2);
      else if (k === 'escape') {
        if (G.openPanel) closePanel();
        else { G.selected = null; refreshPanelSel(); setPower('pan'); }
      }
      else if (k === 'l') toggleLabels();
      else if (k === 'm') toggleMenu();
      else if (k === 'c') togglePanel('cosmos');
      else if (k === 'p') togglePanel('prayers');
      else if (k === 'h') togglePanel('history');
    });
    global.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    global.addEventListener('keydown', (e) => {
      if (!G.power || Powers.BY_ID[G.power.id].radius === 0) return;
      if (e.key === '[') { G.power.radius = Math.max(1, G.power.radius - 1); G.ui.brushRadius = G.power.radius; }
      if (e.key === ']') { G.power.radius = Math.min(14, G.power.radius + 1); G.ui.brushRadius = G.power.radius; }
    });

    // Resize was the only hook, and it fires neither on an orientation flip nor
    // when the system bars slide in and change the usable height. Coalesce all
    // three into one rAF-debounced pass so a drag-resize can't thrash the
    // weather particle reallocation inside resize().
    let resizeRaf = 0;
    const onViewportChange = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; G.r.resize(); });
    };
    global.addEventListener('resize', onViewportChange);
    global.addEventListener('orientationchange', onViewportChange);
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', onViewportChange);
      global.visualViewport.addEventListener('scroll', onViewportChange);
    }
    global.addEventListener('blur', () => { keys = {}; });
    global.addEventListener('beforeunload', () => { try { save(); } catch (e) {} });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { keys = {}; save(); Audio8.suspend(); }
      else Audio8.resumeAll();
    });
    $('#inspect').addEventListener('click', onInspectClick);
  }
  function touchDist(e) { const a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  function touchMid(e, cv) { const r = cv.getBoundingClientRect(); const a = e.touches[0], b = e.touches[1]; return { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top }; }
  function zoomBy(f) { const cam = G.r.cam; cam.dist /= f; cam.idle = 0; clampCam(); }

  // ================= Speed / pause =================
  function setSpeedIdx(i, quiet) {
    i = PD.clamp(i | 0, 0, TIME_SCALES.length - 1);
    // creation is not yet finished: time cannot run until there is a world
    if (G.creationStage != null && G.creationStage < 5 && TIME_SCALES[i].v !== 0) {
      flashToast('Time does not flow yet. Finish the creation.');
      i = IDX_PAUSE;
    }
    const prev = G.speed;
    G.speedIdx = i;
    G.speed = TIME_SCALES[i].v;
    G.paused = (G.speed === 0);
    if (G.speed <= 0) G.acc = 0;
    if (G.speed < 0) G._reversed = true;   // the Testament notices
    // letting go of reverse abandons a half-finished arming hold
    if (G.speed >= 0 && G.rewind) { G.rewind.arm = 0; G.rewind.atFloor = false; }
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', +b.dataset.idx === i));
    // audio follows the arrow of time
    if (Audio8.setTimeDirection && (prev < 0) !== (G.speed < 0)) Audio8.setTimeDirection(G.speed < 0 ? -1 : 1);
    if (!quiet) Audio8.sfx('click');
    refreshHUD();
  }
  // snap a raw multiplier to the nearest stop on the dial
  function nearestScaleIdx(v) {
    let best = IDX_PAUSE, bd = Infinity;
    for (let i = 0; i < TIME_SCALES.length; i++) {
      const d = Math.abs(TIME_SCALES[i].v - v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // numeric entry point (hotkeys, saves): snap to the nearest scale stop
  function setSpeed(v) { setSpeedIdx(nearestScaleIdx(v)); }
  function togglePause() {
    if (G.paused) setSpeedIdx(G._lastIdx || IDX_NORMAL);
    else { G._lastIdx = G.speedIdx; setSpeedIdx(IDX_PAUSE); }
  }
  function toggleLabels() {
    G.ui.showLabels = !G.ui.showLabels;
    $('#btn-labels').classList.toggle('off', !G.ui.showLabels);
  }

  // ================= Toolbar =================
  function buildTimeDial() {
    const wrap = $('#time-dial');
    if (!wrap) return;
    let html = '';
    for (let i = 0; i < TIME_SCALES.length; i++) {
      const sc = TIME_SCALES[i];
      if (i === IDX_PAUSE) html += '<button class="speed-btn sep" tabindex="-1">│</button>';
      const cls = 'speed-btn' + (sc.v < 0 ? ' rev' : '') + (i === G.speedIdx ? ' active' : '');
      const mag = Math.abs(sc.v);
      const tip = sc.name + (sc.v === 0 ? '' : ' (' + (sc.v < 0 ? '−' : '') + (mag < 1 ? mag : mag) + '×)');
      html += `<button class="${cls}" data-idx="${i}" title="${tip}">${sc.label}</button>`;
    }
    wrap.innerHTML = html;
  }

  // which categories the player has folded away, remembered across rebuilds
  const collapsedCats = {};
  G.toolQuery = '';

  function buildToolbar() {
    const wrap = $('#tools');
    wrap.innerHTML = '';
    const creating = G.creationStage != null;
    const q = (G.toolQuery || '').trim().toLowerCase();
    let shown = 0;

    for (const cat of Powers.CATEGORIES) {
      let powers = Powers.POWERS.filter(x => x.cat === cat.id);
      if (cat.id === 'genesis') {
        // one word at a time, in order — plus the way back, while there is one
        powers = creating ? powers.filter(x => x.stage === G.creationStage &&
          (x.id !== 'gen_undo' || (G.rewind && G.rewind.undo))) : [];
      } else if (creating) {
        // nothing else can be done to a world that does not yet exist
        powers = powers.filter(x => x.cat === 'god');
      }
      // search matches name, description and category — 59 powers is too many
      // to find anything in by scrolling
      if (q) {
        powers = powers.filter(x =>
          x.name.toLowerCase().includes(q) ||
          (x.desc || '').toLowerCase().includes(q) ||
          cat.name.toLowerCase().includes(q));
      }
      if (!powers.length) continue;
      shown += powers.length;

      const group = document.createElement('div');
      group.className = 'tool-group' + (!q && collapsedCats[cat.id] ? ' collapsed' : '');
      // a real button: keyboard-reachable, and it announces its own state
      const h = document.createElement('button');
      h.className = 'tool-group-title';
      h.textContent = cat.name + '  (' + powers.length + ')';
      h.setAttribute('aria-expanded', String(!collapsedCats[cat.id]));
      h.addEventListener('click', () => {
        collapsedCats[cat.id] = !collapsedCats[cat.id];
        buildToolbar();
      });
      group.appendChild(h);

      const grid = document.createElement('div'); grid.className = 'tool-grid';
      for (const p of powers) {
        const btn = document.createElement('button');
        btn.className = 'tool'; btn.dataset.id = p.id;
        btn.innerHTML = `<span class="tool-ico">${p.icon}</span><span class="tool-name">${p.name}</span>` +
          (p.cost > 0 ? `<span class="tool-cost">✦${p.cost}</span>` : '');
        btn.title = p.desc;
        btn.setAttribute('aria-label', p.name + (p.cost > 0 ? ', costs ' + p.cost + ' faith' : ', free'));
        // Hover previews the power. On a touch screen mouseenter never fires,
        // so without the pointerdown/focus paths you had to SELECT a power to
        // find out what it did or cost — on the platform this ships to.
        btn.addEventListener('mouseenter', () => updatePowerInfo(p));
        btn.addEventListener('mouseleave', () => updatePowerInfo(G.power));
        btn.addEventListener('pointerdown', () => updatePowerInfo(p));
        btn.addEventListener('focus', () => updatePowerInfo(p));
        btn.addEventListener('click', () => setPower(p.id));
        grid.appendChild(btn);
      }
      group.appendChild(grid);
      wrap.appendChild(group);
    }

    if (!shown) {
      const none = document.createElement('div');
      none.className = 'tool-empty';
      none.textContent = q ? 'No power by that name.' : 'Nothing can be done yet.';
      wrap.appendChild(none);
    }
    highlightPower(G.power ? G.power.id : 'pan');
  }
  function highlightPower(id) {
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  }
  function updatePowerInfo(p) {
    if (!p) return;
    $('#power-name').textContent = p.icon + ' ' + p.name;
    $('#power-desc').textContent = p.desc;
    $('#power-cost').textContent = p.cost > 0 ? ('Cost: ✦' + p.cost + (p.cont ? ' / touch' : '')) : 'Free';
  }

  // register a spawn power for a custom race and rebuild the toolbar
  function addCustomSpawnPower(key) {
    const R = Sim.RACES[key];
    if (!R || Powers.BY_ID['spawn_' + key]) return;
    const p = {
      id: 'spawn_' + key, name: R.name, icon: R.emoji, cat: 'life', cost: 10, radius: 2, cont: true,
      color: 'rgba(255,255,255,0.9)', race: key,
      desc: `Your own creation: the ${R.name}. Made in whatever image you chose.`,
      apply(G2, wx, wy) {
        if (G2.faith < this.cost) { Audio8.sfx('error'); return 0; }
        const s = W.nearestLand(G2.world, wx, wy, 8);
        if (!s) { Audio8.sfx('error'); return 0; }
        const u = Sim.spawnUnit(G2.sim, key, s.x, s.y);
        if (!u) return 0;
        G2.lastRace = key;
        PD.FX.puff(s.x, s.y, R.col);
        Audio8.sfx('spawn');
        return this.cost;
      }
    };
    Powers.POWERS.push(p); Powers.BY_ID[p.id] = p;
    buildToolbar();
  }

  // ================= HUD =================
  // ---- the score listens to the world --------------------------------
  // The music was four chords on a timer, identical whether the world below
  // was a paradise or a graveyard. Read the state of creation and tell the
  // audio engine what it is looking at. Cheap: aggregates already computed.
  let lastMood = '', moodCd = 0;
  function updateMood() {
    if (!Audio8.setMood || --moodCd > 0) return;
    moodCd = 40;                     // re-evaluate about twice a second
    const s = G.sim; if (!s) return;
    let pop = 0, sick = 0, atWar = 0, prosperity = 0, temples = 0;
    for (const v of s.villages) {
      pop += v.pop; temples += v.temples || 0;
      prosperity += v.prosperity || 0;
      sick += v.sickCount || 0;
      if (v.rival >= 0) atWar++;
    }
    const nV = Math.max(1, s.villages.length);
    prosperity /= nV;
    let m;
    if (pop === 0) m = 'empty';
    else if (sick > pop * 0.22) m = 'plague';
    else if (atWar > 0 || s.bloodMoonT > 0) m = 'war';
    else if (prosperity > 0.7 && temples >= 2) m = 'glory';
    else m = 'calm';
    if (m !== lastMood) { lastMood = m; Audio8.setMood(m); }
  }

  function refreshHUD() {
    updateMood();
    $('#faith-val').textContent = Math.floor(G.faith);
    $('#faith-rate').textContent = '+' + faithPerStep().toFixed(1) + '/t' + (G.divinity > 0 ? ' ⍟' + G.divinity : '');
    const ts = $('#time-scale');
    if (ts) {
      const sc = TIME_SCALES[G.speedIdx] || TIME_SCALES[IDX_NORMAL];
      // 6 sim steps per real second at 1x, TICKS_PER_YEAR ticks per year
      const yps = Math.abs(sc.v) * 6 / TICKS_PER_YEAR;
      const rate = sc.v === 0 ? 'held' :
        (yps >= 1 ? yps.toFixed(0) + ' yr/s' : (1 / yps).toFixed(0) + ' s/yr');
      ts.textContent = sc.name + ' · ' + rate;
      ts.classList.toggle('reversing', sc.v < 0);
      // mark the container too, so the border can be styled without :has()
      // (unsupported on the older WebViews this ships down to)
      const tstat = $('#time-stat');
      if (tstat) tstat.classList.toggle('reversing', sc.v < 0);
    }
    const c = G.sim.counts;
    const rc = $('#race-counts'); rc.innerHTML = '';
    const shown = Object.keys(Sim.RACES).filter(k => (c[k] || 0) > 0).slice(0, 8);
    for (const k of shown) {
      const R = Sim.RACES[k];
      const el = document.createElement('span'); el.className = 'race-chip';
      el.innerHTML = `<i style="color:${R.col2};background:${R.col}"></i>${R.emoji}${c[k]}`;
      el.title = R.name;
      rc.appendChild(el);
    }
    $('#year-val').textContent = 'Year ' + Math.floor(G.sim.tick / 120);
    $('#vill-val').textContent = '🏙 ' + G.sim.villages.length;
    $('#season-val').textContent = ['🌱 Spring', '☀ Summer', '🍂 Autumn', '❄ Winter'][G.sim.season];
    const pname = $('#planet-name');
    if (G.view.kind === 'plane') pname.textContent = '👻 ' + PD.Afterlife.AL.planes[G.view.id].meta.name;
    else { const p = Cosmos.active(); pname.textContent = '🪐 ' + (p ? p.name : '—'); }
    const log = $('#event-log');
    if (log && G.sim.log.length) {
      log.innerHTML = G.sim.log.slice(0, 12).map(e => `<div class="log-line log-${e.kind}">${e.msg}</div>`).join('');
    }
    updateTabBadges();
  }
  function updateTabBadges() {
    const soc = G.sim.soc;
    const n = soc ? soc.prayers.length : 0;
    const b = $('#tab-prayers .tab-badge');
    if (b) { b.textContent = n; b.style.display = n > 0 ? 'flex' : 'none'; }
  }

  // ================= Inspect panel =================
  function refreshPanelSel() {
    const panel = $('#inspect');
    const sel = G.selected;
    if (!sel) { panel.classList.remove('show'); return; }
    panel.classList.add('show');
    let html = '';
    if (sel.type === 'unit') {
      const u = sel.ref;
      if (u.dead) { G.selected = null; panel.classList.remove('show'); return; }
      const R = Sim.RACES[u.race];
      html = `<div class="ins-title">${R.emoji} ${u.name}${u.paragon ? ' ⭐' : ''}</div>
        <div class="ins-row"><span>Kind</span><b>${R.one || R.name}${u.paragon ? ' · Paragon ' + u.paragon : ''}</b></div>
        <div class="ins-row"><span>Nature</span><b>${Sim.TRAITS[u.trait] || '—'}</b></div>
        ${R.sentient ? `<div class="ins-row"><span>Trade</span><b>${Sim.PROFESSIONS[u.prof]}</b></div>` : ''}
        <div class="ins-row"><span>Bearing</span><b>${describeNature(u)}</b></div>
        <div class="ins-row"><span>Karma</span><b style="color:${u.karma >= 0 ? '#5ad06a' : '#e0503a'}">${u.karma >= 0 ? '+' : ''}${Math.round(u.karma)}</b></div>
        <div class="ins-bar"><span>HP</span>${bar(u.hp / u.maxHp, R.col2)}</div>
        <div class="ins-bar"><span>Food</span>${bar(u.food, '#7ac043')}</div>
        <div class="ins-row"><span>Age</span><b>${(u.age / 120).toFixed(1)} yr</b></div>
        <div class="ins-row"><span>Home</span><b>${u.village >= 0 ? (villName(u.village) || '—') : 'wild'}</b></div>
        <div class="ins-actions">
          <button data-act="blessone">✨ Bless</button>
          <button data-act="voiceone">🗣 Speak</button>
          <button data-act="empowerone">🦸 Empower</button>
          <button data-act="smiteone">⚡ Smite</button>
        </div>`;
    } else if (sel.type === 'village') {
      const v = sel.ref;
      if (!Sim.villageById(G.sim, v.id)) { G.selected = null; panel.classList.remove('show'); return; }
      const R = Sim.RACES[v.race];
      const n = PD.Society ? PD.Society.nationOf(G.sim, v.id) : null;
      const soc = G.sim.soc;
      const faith = n && soc && n.faithId >= 0 ? soc.faiths.find(f => f.id === n.faithId) : null;
      html = `<div class="ins-title" style="color:${v.col}">${R.emoji} ${v.name}</div>
        <div class="ins-row"><span>People</span><b>${R.name}</b></div>
        ${n ? `<div class="ins-row"><span>Nation</span><b>${n.name}</b></div>
        <div class="ins-row"><span>Rule</span><b>${PD.Society.GOVERNMENTS[n.gov]} · ${n.leaderName}</b></div>
        <div class="ins-row"><span>Era</span><b>${PD.Society.ERAS[n.era]}</b></div>` : ''}
        ${faith ? `<div class="ins-row"><span>Faith</span><b>${faith.name}</b></div>` : ''}
        <div class="ins-row"><span>Population</span><b>${v.pop}</b></div>
        <div class="ins-row"><span>Tier</span><b>${['Hamlet', 'Village', 'Town', 'City', 'Metropolis'][Math.min(4, v.level - 1)]} (lvl ${v.level})</b></div>
        <div class="ins-bar"><span>Prosperity</span>${bar(v.prosperity, '#f0c040')}</div>
        <div class="ins-row"><span>Food store</span><b>${Math.floor(v.food)}</b></div>
        <div class="ins-row"><span>Temples</span><b>${v.temples} ⛪</b></div>
        ${describeTrades(v)}
        ${v.rival >= 0 ? `<div class="ins-row war"><span>At war with</span><b>${villName(v.rival) || '?'}</b></div>` : ''}
        <button class="ins-smite" id="smite-btn">⚡ Smite this town</button>`;
    } else if (sel.type === 'tile') {
      const i = W.idx(G.world, sel.x, sel.y);
      html = `<div class="ins-title">📍 Tile ${sel.x},${sel.y}</div>
        <div class="ins-row"><span>Biome</span><b>${BIOME_NAMES[G.world.biome[i]] || '?'}</b></div>
        <div class="ins-bar"><span>Elevation</span>${bar(G.world.elev[i], '#8a6a48')}</div>
        <div class="ins-bar"><span>Fertility</span>${bar(G.world.fert[i], '#5aa03c')}</div>
        <div class="ins-bar"><span>Moisture</span>${bar(G.world.moist[i], '#245e8f')}</div>
        ${G.world.fire[i] ? '<div class="ins-row war"><span>🔥 On fire</span></div>' : ''}`;
    }
    html += `<button class="ins-close" id="ins-close">✕ close</button>`;
    panel.innerHTML = html;
  }
  function onInspectClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'ins-close') { G.selected = null; $('#inspect').classList.remove('show'); return; }
    if (btn.id === 'smite-btn' && G.selected && G.selected.type === 'village') {
      const v = G.selected.ref;
      if (Powers.soundAt) Powers.soundAt(v.x, v.y, G.world.W, G.world.H);
      const spent = Powers.BY_ID.lightning.apply(G, v.x, v.y);
      if (Powers.soundAt) Powers.soundAt(null);
      if (spent > 0) onPowerUsed(Powers.BY_ID.lightning, spent);
      return;
    }
    const act = btn.dataset.act;
    if (act && G.selected && G.selected.type === 'unit') {
      const u = G.selected.ref;
      let spent = 0, pw = null;
      if (act === 'blessone') { if (G.faith >= 4) { u.hp = u.maxHp; u.food = 1; u.sick = 0; u.karma += 1; PD.FX.spark(u.x, u.y); Audio8.sfx('bless'); spent = 4; pw = Powers.BY_ID.bless; } }
      else if (act === 'voiceone' || act === 'empowerone' || act === 'smiteone') {
        pw = act === 'voiceone' ? Powers.BY_ID.voice
           : act === 'empowerone' ? Powers.BY_ID.empower : Powers.BY_ID.lightning;
        if (Powers.soundAt) Powers.soundAt(u.x, u.y, G.world.W, G.world.H);
        spent = pw.apply(G, u.x, u.y);
        if (Powers.soundAt) Powers.soundAt(null);
      }
      if (spent > 0) onPowerUsed(pw || { cat: 'god' }, spent);
    }
  }
  // A town's roster of trades — who is actually here, and what that buys it.
  function describeTrades(v) {
    if (!v.jobs || !Sim.PROFESSIONS) return '';
    const pairs = [];
    for (let i = 0; i < v.jobs.length; i++) if (v.jobs[i] > 0) pairs.push([Sim.PROFESSIONS[i], v.jobs[i]]);
    if (!pairs.length) return '';
    pairs.sort((a, b) => b[1] - a[1]);
    const L = v.labour || {};
    const roster = pairs.slice(0, 6).map(p => `${p[1]}&nbsp;${p[0]}`).join(', ');
    return `<div class="ins-row"><span>Trades</span><b style="text-align:right">${roster}</b></div>` +
      `<div class="ins-row"><span>Harvest</span><b>+${(L.food || 0).toFixed(2)}/t</b></div>` +
      (L.science > 0.01 ? `<div class="ins-row"><span>Study</span><b>${(L.science || 0).toFixed(2)}/t</b></div>` : '') +
      (v.order != null ? `<div class="ins-bar"><span>Order</span>${bar(v.order, '#7aa0e0')}</div>` : '') +
      (v.morale != null ? `<div class="ins-bar"><span>Morale</span>${bar(v.morale, '#c48ae0')}</div>` : '');
  }

  // Say in plain words what this soul's nature will actually make it do, so
  // the trait is a promise about behaviour and not a decorative adjective.
  function describeNature(u) {
    const tf = Sim.traitFx ? Sim.traitFx(u) : null;
    if (!tf) return '—';
    const notes = [];
    if (tf.bravery >= 1.35) notes.push('holds the line');
    else if (tf.bravery <= 0.75) notes.push('runs early');
    if (tf.warmth >= 1.5) notes.push('tends the hurt');
    else if (tf.warmth <= 0.55) notes.push('walks past the dying');
    if (tf.work >= 1.2) notes.push('works hard');
    else if (tf.work <= 0.7) notes.push('shirks');
    if (tf.greed >= 1.5) notes.push('eats more than its share');
    if (tf.piety >= 1.5) notes.push('prays often');
    if (tf.roam >= 1.5) notes.push('strays far');
    return notes.length ? notes.join(' · ') : 'unremarkable';
  }

  function bar(v, col) { v = PD.clamp(v, 0, 1); return `<div class="bar"><div class="bar-fill" style="width:${(v * 100).toFixed(0)}%;background:${col}"></div></div>`; }
  function villName(id) { const v = Sim.villageById(G.sim, id); return v ? v.name : null; }

  // ================= Side panels (tabs) =================
  const PANELS = ['cosmos', 'history', 'prayers', 'feed', 'souls', 'genesis', 'time', 'testament'];
  function togglePanel(name) {
    if (G.openPanel === name) { closePanel(); return; }
    closePanel();
    G.openPanel = name;
    $('#panel-' + name).classList.add('show');
    $('#tab-' + name) && $('#tab-' + name).classList.add('active');
    $('#chronicle').style.display = 'none'; // panels own that corner
    refreshOpenPanel(true);
    Audio8.sfx('select');
  }
  function closePanel() {
    if (!G.openPanel) return;
    $('#panel-' + G.openPanel).classList.remove('show');
    $('#tab-' + G.openPanel) && $('#tab-' + G.openPanel).classList.remove('active');
    $('#chronicle').style.display = '';
    G.openPanel = null;
  }
  function refreshOpenPanel(force) {
    if (!G.openPanel) return;
    switch (G.openPanel) {
      case 'history': renderHistory(); break;
      case 'prayers': renderPrayers(); break;
      case 'feed': renderFeed(); break;
      case 'souls': renderSouls(force); break;
      case 'time': renderTime(force); break;
      case 'testament': if (force) renderTestament(); break;
      case 'cosmos': if (force) renderCosmosControls(); break;
      case 'genesis': break; // static form
    }
  }

  // ---- History panel ----
  function renderHistory() {
    const el = $('#history-list');
    const soc = G.sim.soc;
    if (!soc || !soc.history.length) { el.innerHTML = '<div class="empty">History is still unwritten.</div>'; return; }
    el.innerHTML = soc.history.slice(0, 60).map(h =>
      `<div class="hist-line hist-${h.kind}"><span class="hist-year">Y${Math.floor(h.t / 120)}</span> ${h.text}</div>`).join('');
    // nations summary
    const ns = $('#nations-list');
    if (soc.nations.length) {
      ns.innerHTML = '<div class="panel-subtitle">Nations</div>' + soc.nations.map(n => {
        const R = Sim.RACES[n.race];
        return `<div class="nation-line">${R ? R.emoji : '?'} <b>${n.name}</b> · ${PD.Society.ERAS[n.era]} · ${PD.Society.GOVERNMENTS[n.gov]}<br>
          <small>${n.leaderName} the ${n.leaderTrait} · pop ${n.pop || 0}${n.warWith.length ? ' · ⚔ AT WAR' : ''}</small></div>`;
      }).join('');
    } else ns.innerHTML = '';
    // legends
    const lg = $('#legends-list');
    if (soc.legends.length) {
      lg.innerHTML = '<div class="panel-subtitle">Legends</div>' + soc.legends.slice(0, 8).map(l => `<div class="legend-line">⭐ ${l.deed}</div>`).join('');
    } else lg.innerHTML = '';
  }

  // ---- Prayers panel ----
  function renderPrayers() {
    const el = $('#prayers-list');
    const soc = G.sim.soc;
    if (!soc || !soc.prayers.length) { el.innerHTML = '<div class="empty">The heavens are quiet. No one prays… yet.</div>'; return; }
    el.innerHTML = soc.prayers.map(p =>
      `<div class="prayer">
        <div class="prayer-text">${p.text}</div>
        <div class="prayer-btns">
          <button class="pr-answer" data-pid="${p.id}">✨ Answer (+8✦)</button>
          <button class="pr-refuse" data-pid="${p.id}">🌑 Refuse</button>
        </div>
      </div>`).join('');
  }
  $('#prayers-list') && $('#prayers-list').addEventListener('click', () => {});

  // ---- PixelNet feed ----
  function renderFeed() {
    const el = $('#feed-list');
    const soc = G.sim.soc;
    if (!soc || !soc.internetOn) {
      el.innerHTML = '<div class="empty">📡 No signal.<br><small>A nation must reach the Modern era to invent the internet. Then the posting begins.</small></div>';
      return;
    }
    if (!soc.feed.length) { el.innerHTML = '<div class="empty">PixelNet is live, but nobody has posted yet.</div>'; return; }
    el.innerHTML = soc.feed.map(f =>
      `<div class="post">
        <div class="post-head"><b>${f.author}</b> <span>· Y${Math.floor(f.t / 120)}</span></div>
        <div class="post-body">${f.text}</div>
        <div class="post-foot">♥ ${f.likes} · 💬 ${(f.likes / 7) | 0} · ⟳ ${(f.likes / 11) | 0}</div>
      </div>`).join('');
  }

  // ---- Souls / afterlife panel ----
  function renderSouls(force) {
    const el = $('#souls-list');
    const stats = PD.Afterlife.stats();
    let html = '';
    for (const p of stats) {
      const plane = PD.Afterlife.AL.planes[p.id];
      html += `<div class="plane">
        <div class="plane-head"><b>${p.name}</b><button class="plane-visit" data-plane="${p.id}">Visit →</button></div>
        <div class="plane-desc">${p.desc}</div>
        <div class="plane-count">${p.total} souls</div>
        ${plane.souls.slice(0, 4).map(s => `
          <div class="soul-line">👻 ${s.name} <small>(${s.race}, karma ${s.karma >= 0 ? '+' : ''}${s.karma})</small>
            <span class="soul-btns">
              <button class="soul-res" data-soul="${s.name}" title="Resurrect near camera">⚕</button>
              <button class="soul-asc" data-soul="${s.name}" title="Make an angel">👼</button>
              <button class="soul-con" data-soul="${s.name}" title="Condemn to hell">🔥</button>
            </span>
          </div>`).join('')}
      </div>`;
    }
    if (G.view.kind === 'plane') {
      html = `<button class="big-btn" id="leave-plane" style="width:100%;margin-bottom:10px">🪐 Return to the living</button>` + html;
    }
    el.innerHTML = html;
  }

  // ---- Time travel panel ----
  function renderTime(force) {
    const el = $('#time-list');
    if (!G.timeline.length) {
      el.innerHTML = '<div class="empty">No moments recorded yet.<br><small>The chronicle takes a snapshot of the watched world every ~90 seconds. Come back soon, time traveler.</small></div>';
      return;
    }
    el.innerHTML = G.timeline.map((s, i) =>
      `<div class="snap">
        <div><b>${s.planetName}</b> · Year ${s.year}</div>
        <div class="snap-btns">
          <button class="snap-restore" data-i="${i}">⏪ Rewind</button>
          <button class="snap-branch" data-i="${i}">⑂ Branch timeline</button>
        </div>
      </div>`).join('') +
      '<div class="panel-note">Rewind replaces the world with its past. Branch forks a parallel universe from that moment.</div>';
  }

  // ---- Testament panel ----
  function renderTestament() {
    const el = $('#testament-list');
    if (!el) return;
    let html = '';
    for (let i = 0; i < CHAPTERS.length; i++) {
      const ch = CHAPTERS[i];
      const done = !!G.story.done[ch.id];
      const current = i === G.story.active && !done;
      if (i > G.story.active && !done) {
        html += `<div class="chapter locked">🔒 ${ch.title}</div>`;
        continue;
      }
      html += `<div class="chapter ${done ? 'done' : ''} ${current ? 'current' : ''}">
        <div class="chapter-title">${done ? '✅' : '📖'} ${ch.title}</div>
        <div class="chapter-text">${ch.text}</div>
        ${current ? `<div class="chapter-hint hidden" id="hint-${ch.id}">💡 ${ch.hint}</div>
        <button class="hint-btn" data-ch="${ch.id}">Show hint</button>` : ''}
      </div>`;
    }
    // deeds of the god (achievements)
    html += '<div class="panel-subtitle">Deeds</div>';
    for (const a of ACHIEVEMENTS) {
      const have = G.ach[a.id] || 0;
      const done2 = have >= a.need;
      html += `<div class="deed ${done2 ? 'deed-done' : ''}">${done2 ? '🏆' : '▫'} <b>${a.name}</b> — ${a.desc} <small>(${Math.min(have, a.need)}/${a.need})</small></div>`;
    }
    // transcendence status
    html += `<div class="panel-subtitle">Transcendence</div>
      <div class="panel-note">Divinity ⍟${G.divinity} · all faith ×${(1 + G.divinity * 0.25).toFixed(2)}.<br>
      Next transcendence: ${Math.floor(transcendCost())} total faith earned (you: ${Math.floor(G.faithTotal)}). Use ☰ Menu → Transcend.</div>`;
    el.innerHTML = html;
  }

  // ---- Cosmos panel (canvas of orbiting globes) ----
  let cosmosSel = -1;
  function drawCosmos(t) {
    const cvs = $('#cosmos-canvas');
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const cw = cvs.width = cvs.clientWidth, chh = cvs.height = cvs.clientHeight;
    ctx.fillStyle = '#04060e'; ctx.fillRect(0, 0, cw, chh);
    // starfield
    for (let i = 0; i < 80; i++) {
      const sx = (i * 137.5) % cw, sy = (i * 89.3) % chh;
      ctx.fillStyle = i % 7 === 0 ? '#8a93b8' : '#3a4674';
      ctx.fillRect(sx, sy, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1);
    }
    const cx = cw / 2, cy = chh / 2;
    // the sun (a god's hearth)
    const sg = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
    sg.addColorStop(0, '#fff8d0'); sg.addColorStop(0.5, '#f0c040'); sg.addColorStop(1, 'rgba(240,192,64,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 6.283); ctx.fill();
    // planets
    for (const p of Cosmos.C.planets) {
      p.orbit.a += p.orbit.spd;
      const px = cx + Math.cos(p.orbit.a) * p.orbit.r;
      const py = cy + Math.sin(p.orbit.a) * p.orbit.r * 0.55;
      ctx.strokeStyle = 'rgba(60,70,110,0.35)';
      ctx.beginPath(); ctx.ellipse(cx, cy, p.orbit.r, p.orbit.r * 0.55, 0, 0, 6.283); ctx.stroke();
      const size = p.id === Cosmos.C.activeId ? 56 : 44;
      Cosmos.drawGlobe(ctx, p, px, py, size, t);
      // doomed pulse
      if (p.meta.doom != null) {
        ctx.strokeStyle = `rgba(255,80,40,${0.4 + Math.sin(t * 0.005) * 0.3})`;
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, size / 2 + 4, 0, 6.283); ctx.stroke();
      }
      if (p.id === cosmosSel) {
        ctx.strokeStyle = '#f0d040'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, size / 2 + 7, 0, 6.283); ctx.stroke();
      }
      ctx.fillStyle = p.id === Cosmos.C.activeId ? '#f0d040' : '#8a93b8';
      ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText(p.name + (p.meta.doom != null ? ' ⚠' : ''), px, py + size / 2 + 18);
      p._cosPos = { x: px, y: py, r: size / 2 + 8 };
    }
    ctx.textAlign = 'left';
  }
  function renderCosmosControls() {
    const el = $('#cosmos-controls');
    const sel = Cosmos.getPlanet(cosmosSel);
    let html = '<div class="panel-subtitle">Create a world · ✦150</div><div class="cosmos-create">';
    for (const key in Cosmos.PLANET_TYPES) {
      if (key === 'shattered') continue;
      const t = Cosmos.PLANET_TYPES[key];
      html += `<button class="cosmos-new" data-type="${key}" title="${t.desc}">${t.name}</button>`;
    }
    html += '</div>';
    if (sel) {
      html += `<div class="panel-subtitle">${sel.name} · ${Cosmos.PLANET_TYPES[sel.type] ? Cosmos.PLANET_TYPES[sel.type].name : sel.type}</div>
        <div class="cosmos-sel-btns">
          <button id="cosmos-visit">👁 Gaze upon it</button>
          <button id="cosmos-rename">✏ Rename</button>
          <button id="cosmos-destroy" class="danger">💥 Unmake (✦100)</button>
        </div>`;
    } else {
      html += '<div class="panel-note">Click a planet to select it. Time flows only on the world you gaze upon.</div>';
    }
    el.innerHTML = html;
  }

  // ---- panel event delegation (one listener each) ----
  function bindPanels() {
    document.querySelectorAll('.side-tab').forEach(b => {
      b.addEventListener('click', () => togglePanel(b.dataset.panel));
    });
    document.querySelectorAll('.panel-close').forEach(b => b.addEventListener('click', closePanel));

    $('#panel-prayers').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const pid = +b.dataset.pid;
      if (b.classList.contains('pr-answer')) {
        const refund = PD.Society.answerPrayer(G.sim, pid, false);
        if (refund) { G.faith += refund; G._prayersAnswered = (G._prayersAnswered || 0) + 1; ach('prayers'); }
        renderPrayers(); refreshHUD();
      } else if (b.classList.contains('pr-refuse')) {
        PD.Society.answerPrayer(G.sim, pid, true);
        renderPrayers(); refreshHUD();
      }
    });

    $('#panel-souls').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'leave-plane') { gotoPlanet(Cosmos.C.activeId); closePanel(); return; }
      if (b.classList.contains('plane-visit')) { G._visitedPlane = true; gotoPlane(b.dataset.plane); closePanel(); return; }
      const soul = b.dataset.soul;
      if (!soul) return;
      if (b.classList.contains('soul-res')) {
        if (G.faith < 50) { flashToast('Resurrection needs ✦50'); return; }
        if (G.view.kind !== 'planet') { flashToast('Return to a living world first'); return; }
        const ct = Render.centerTile(G.r);
        const u = PD.Afterlife.resurrect(soul, G.sim, ct.x, ct.y);
        if (u) { G.faith -= 50; G._resurrected = true; ach('resurrections'); flashToast(soul + ' lives again!'); Audio8.sfx('levelup'); }
      } else if (b.classList.contains('soul-asc')) {
        if (G.faith < 30) { flashToast('Ascension needs ✦30'); return; }
        if (PD.Afterlife.judgeSoul(soul, 'ascend')) { G.faith -= 30; flashToast(soul + ' has wings now'); Audio8.sfx('bless'); }
      } else if (b.classList.contains('soul-con')) {
        if (PD.Afterlife.judgeSoul(soul, 'condemn')) { flashToast(soul + ' descends. Harsh.'); Audio8.sfx('plague'); }
      }
      renderSouls(true);
    });

    $('#panel-time').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('snap-restore')) timeTravel(+b.dataset.i, false);
      else if (b.classList.contains('snap-branch')) timeTravel(+b.dataset.i, true);
      renderTime(true);
    });

    $('#panel-testament').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('hint-btn')) {
        const h = $('#hint-' + b.dataset.ch);
        if (h) { h.classList.toggle('hidden'); b.textContent = h.classList.contains('hidden') ? 'Show hint' : 'Hide hint'; }
      }
    });

    // cosmos canvas interaction
    $('#cosmos-canvas').addEventListener('click', (e) => {
      const rect = e.target.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      cosmosSel = -1;
      for (const p of Cosmos.C.planets) {
        if (p._cosPos && Math.hypot(x - p._cosPos.x, y - p._cosPos.y) < p._cosPos.r) { cosmosSel = p.id; break; }
      }
      renderCosmosControls();
    });
    $('#cosmos-controls').addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('cosmos-new')) {
        if (G.faith < 150) { flashToast('Creating a world needs ✦150'); Audio8.sfx('error'); return; }
        const p = Cosmos.createPlanet(b.dataset.type);
        if (!p) { flashToast('The void holds at most 10 worlds'); return; }
        G.faith -= 150;
        ach('worlds');
        if (b.dataset.type !== 'primordial' && b.dataset.type !== 'hellscape') seedInitialLife(p.sim, p.world);
        Sim.recount(p.sim);
        flashToast('Let there be ' + p.name);
        Audio8.sfx('levelup');
        renderCosmosControls();
      } else if (b.id === 'cosmos-visit' && cosmosSel >= 0) {
        gotoPlanet(cosmosSel); closePanel();
      } else if (b.id === 'cosmos-rename' && cosmosSel >= 0) {
        const p = Cosmos.getPlanet(cosmosSel);
        const name = await ask({ title: 'Name this world', body: 'What shall it be called?', input: p.name, ok: 'Name it' });
        if (name) { p.name = name; p.sim.planetName = name; refreshHUD(); renderCosmosControls(); }
      } else if (b.id === 'cosmos-destroy' && cosmosSel >= 0) {
        if (Cosmos.C.planets.length <= 1) { flashToast('You cannot unmake the last world'); return; }
        if (G.faith < 100) { flashToast('Unmaking needs ✦100'); return; }
        if (await ask({ title: 'Unmake this world', body: 'This world and every soul on it will cease to have been. There is no undo for this one.', ok: 'Unmake it', danger: true })) {
          G.faith -= 100;
          ach('unmade');
          Cosmos.destroyPlanet(cosmosSel);
          cosmosSel = -1;
          bindView();
          flashToast('It is undone. The Beyond swells with souls.');
          Audio8.sfx('meteor');
          renderCosmosControls();
        }
      }
    });

    // genesis lab
    $('#genesis-create').addEventListener('click', () => {
      const name = ($('#gen-name').value || 'Newkin').trim().slice(0, 16);
      const key = 'x_' + name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!key || Sim.RACES[key]) { flashToast('They already exist — new name?'); return; }
      if (G.faith < 150) { flashToast('Creating a race needs ✦150'); Audio8.sfx('error'); return; }
      const flags = [];
      document.querySelectorAll('.gen-flag:checked').forEach(f => flags.push(f.value));
      const def = {
        key, name, one: name, emoji: $('#gen-emoji').value,
        col: $('#gen-col1').value, col2: $('#gen-col2').value,
        aggr: +$('#gen-aggr').value / 100, breed: +$('#gen-breed').value / 100,
        dmg: +$('#gen-dmg').value, hp: +$('#gen-hp').value,
        spd: +$('#gen-spd').value / 100, lifespan: +$('#gen-life').value,
        flags
      };
      if (Cosmos.registerRace(def)) {
        G.faith -= 150;
        ach('races');
        addCustomSpawnPower(key);
        setPower('spawn_' + key);
        flashToast(`The ${name} exist now. Go place them.`);
        Audio8.sfx('levelup');
        if (PD.Society) PD.Society.hist(G.sim, `A new people is dreamed into being: the ${name}.`, 'legend');
        closePanel();
      }
    });
  }

  // ================= Toasts / modals =================
  let toastT;
  function flashToast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2000);
  }
  function showOffline(off) {
    const m = $('#offline-modal'); if (!m) return;
    const hrs = Math.floor(off.time / 3600), mins = Math.floor((off.time % 3600) / 60);
    $('#offline-body').innerHTML = `
      <p>You were away for <b>${hrs}h ${mins}m</b>.</p>
      <div class="off-grid">
        <div><span class="off-num">+${off.faith}</span><span>✦ Faith gathered</span></div>
        <div><span class="off-num">${off.popDelta >= 0 ? '+' : ''}${off.popDelta}</span><span>population change</span></div>
        <div><span class="off-num">${off.vills}</span><span>settlements now</span></div>
        <div><span class="off-num">${off.pop}</span><span>total souls</span></div>
      </div>
      <p class="off-note">The world turned without you. Civilizations rose and fell.</p>`;
    m.classList.add('show');
  }
  function toggleMenu() { $('#menu-modal').classList.toggle('show'); }

  // ================= Boot =================
  function boot() {
    const canvas = $('#game');
    PD.Afterlife.init();
    const started = hasSave();
    newMultiverse();
    G.r = Render.createRenderer(canvas, G.world);
    G.r.resize();

    setPower('pan');
    buildToolbar();
    bindPanels();

    buildTimeDial();
    // delegated: the dial is re-rendered, so per-button listeners would go stale
    $('#time-dial').addEventListener('click', (e) => {
      const b = e.target.closest('.speed-btn');
      if (b && b.dataset.idx != null) setSpeedIdx(+b.dataset.idx);
    });
    $('#btn-menu').addEventListener('click', toggleMenu);
    $('#btn-save').addEventListener('click', () => save());
    const search = $('#tool-search');
    if (search) {
      search.addEventListener('input', () => { G.toolQuery = search.value; buildToolbar(); });
      // typing in the box must not drive the game's hotkeys
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { search.value = ''; G.toolQuery = ''; buildToolbar(); search.blur(); }
      });
    }
    $('#btn-labels').addEventListener('click', toggleLabels);
    $('#btn-sound').addEventListener('click', () => {
      const on = !Audio8.isEnabled(); Audio8.setEnabled(on); Audio8.setMusic(on);
      $('#btn-sound').textContent = on ? '🔊' : '🔇';
      if (on) Audio8.unlock();
    });

    $('#menu-new').addEventListener('click', async () => {
      if (await ask({ title: 'A new multiverse', body: 'Everything you have made will be overwritten. Your transcendences are kept.', ok: 'Begin again', danger: true })) {
        wipeSave(); newMultiverse(); Render.FX.clear(); $('#menu-modal').classList.remove('show'); flashToast('In the beginning…');
      }
    });
    $('#menu-resume').addEventListener('click', () => $('#menu-modal').classList.remove('show'));
    $('#menu-transcend').addEventListener('click', transcend);
    $('#menu-save').addEventListener('click', () => { save(); });
    $('#menu-regen-seed').addEventListener('click', async () => {
      const s = await ask({ title: 'A world from a word', body: 'Any text becomes a world. The same word always makes the same world.', input: G.world.seedStr, ok: 'Make it' });
      if (s != null) { wipeSave(); newMultiverse(s); Render.FX.clear(); $('#menu-modal').classList.remove('show'); flashToast('World seed: ' + s); }
    });

    $('#offline-close') && $('#offline-close').addEventListener('click', () => $('#offline-modal').classList.remove('show'));
    $('#intro-start').addEventListener('click', () => { $('#intro').classList.add('hide'); Audio8.unlock(); });

    bindInput();

    if (started) {
      const ok = load();
      if (ok) $('#intro').classList.add('hide');
    }

    setSpeed(typeof G.speed === 'number' ? Math.max(0, G.speed) : 1);
    refreshHUD();
    renderTestament();

    G.running = true; G.lastT = performance.now();
    requestAnimationFrame(loop);
  }

  global.PixelDeity = {
    boot, save, load, G, timeTravel, gotoPlanet, gotoPlane,
    // exposed for the headless suites in tools/ — they drive the sim directly
    // rather than at the mercy of a frame budget
    newMultiverse, recordRewind, setSpeedIdx, undoUnmaking, thinArchive, REWIND
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
