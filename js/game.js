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
  const $ = (s) => document.querySelector(s);

  const BIOME_NAMES = ['Deep Ocean', 'Water', 'Sand', 'Grassland', 'Forest', 'Dirt', 'Mountain', 'Snow', 'Desert', 'Jungle', 'Swamp', 'Ash', 'Hellrock', 'Lava', 'Cloudfield', 'Golden Meadow', 'Primordial Ooze', 'Voidstone'];

  const G = {
    world: null, sim: null, r: null,
    view: { kind: 'planet', id: -1 },       // or {kind:'plane', id:'elysium'}
    faith: 60, faithTotal: 0,
    power: null, lastRace: 'human',
    speed: 1, paused: false,
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
    let temples = 0;
    for (const v of G.sim.villages) temples += v.temples;
    let f = 0.04 + pop * 0.014 + temples * 0.22;
    if (PD.Society) f += PD.Society.faithBonus(G.sim);
    return f;
  }

  // ================= Sim stepping =================
  function simStep() {
    Sim.step(G.sim, 1);
    if (G.view.kind === 'planet') {
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
    const cap = 24 * 3600;
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
      units: s.units.filter(u => !u.dead).map(u => [
        u.id, u.race, +u.x.toFixed(2), +u.y.toFixed(2), Math.round(u.hp),
        u.age | 0, u.village, u.sick | 0, +u.food.toFixed(2),
        Math.round(u.lifespan), u.adultAt | 0, u.name, u.trait, u.prof,
        Math.round(u.karma * 10) / 10, u.paragon | 0
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
    sim.planetName = d.name;
    sim.units = (d.units || []).map(a => {
      const R = Sim.RACES[a[1]] || Sim.RACES.human;
      return {
        id: a[0], race: Sim.RACES[a[1]] ? a[1] : 'human', x: a[2], y: a[3],
        hp: a[4], maxHp: a[15] > 0 ? R.hp * (1 + a[15] * 2) : R.hp,
        age: a[5], village: a[6], sick: a[7], food: a[8],
        lifespan: a[9] != null ? a[9] : Math.max(R.lifespan * 1.2, a[5] + 200),
        adultAt: a[10] != null ? a[10] : 70,
        name: a[11] || Sim.personName(a[1], Math.random), trait: a[12] || 0,
        prof: a[13] || 0, karma: a[14] || 0, paragon: a[15] || 0,
        state: 'wander', tx: a[2], ty: a[3], cd: 0, breedCd: 40,
        raidT: 0, raidX: 0, raidY: 0, flip: 1, bob: Math.random() * 6.28
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
      view: G.view, floodT: G.floodT,
      cam: G.r ? { x: G.r.cam.x, y: G.r.cam.y, zoom: G.r.cam.zoom } : null,
      cosmos: { nextId: Cosmos.C.nextId, activeId: Cosmos.C.activeId, customRaces: Cosmos.customRaces },
      planets: Cosmos.C.planets.map(packPlanet),
      afterlife: PD.Afterlife.serialize()
    };
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
      flashToast('Multiverse saved');
      return true;
    } catch (e) { console.warn('save failed', e); flashToast('Save failed (storage full?)'); return false; }
  }

  function load() {
    let raw;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    let d;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (!d || d.v !== 2 || !d.planets || !d.planets.length) return false;
    try {
      // custom races must exist before units referencing them are unpacked
      for (const cr of (d.cosmos && d.cosmos.customRaces) || []) Cosmos.registerRace(cr);
      Cosmos.C.planets.length = 0;
      for (const pd of d.planets) Cosmos.C.planets.push(unpackPlanet(pd));
      Cosmos.C.nextId = (d.cosmos && d.cosmos.nextId) || (Cosmos.C.planets.length + 1);
      Cosmos.C.activeId = (d.cosmos && d.cosmos.activeId) || Cosmos.C.planets[0].id;
      PD.Afterlife.load(d.afterlife);
      G.faith = d.faith != null ? d.faith : 60;
      G.faithTotal = d.faithTotal || 0;
      G.lastRace = d.lastRace || 'human';
      G.speed = (typeof d.speed === 'number') ? d.speed : 1;
      G.stats = d.stats || G.stats;
      G.story = d.story || G.story;
      G.floodT = 0; // floods don't survive reload (waters recede in our absence)
      G.view = (d.view && d.view.kind === 'planet' && Cosmos.getPlanet(d.view.id)) ? d.view : { kind: 'planet', id: Cosmos.C.activeId };
      bindView();
      if (d.cam && G.r) { G.r.cam.x = d.cam.x; G.r.cam.y = d.cam.y; G.r.cam.zoom = d.cam.zoom; }
      if (G.speed !== 0) {
        const off = runOffline((Date.now() - (d.t || Date.now())) / 1000);
        if (off) showOffline(off);
      }
      return true;
    } catch (e) {
      console.warn('load failed', e);
      newMultiverse();
      return false;
    }
  }
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function wipeSave() { try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(OLD_KEY); } catch (e) {} }

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
      // a new universe forks from the old moment
      pd.id = Cosmos.C.nextId++;
      pd.name = snap.planetName + ' ⧗';
      pd.orbit = { r: 60 + Cosmos.C.planets.length * 34, a: Math.random() * 6.28, spd: 0.001 };
      if (Cosmos.C.planets.length >= 8) { flashToast('The void is full — destroy a world first'); return; }
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
  }

  // ================= Testament story =================
  const CHAPTERS = [
    { id: 'genesis', title: 'I. Genesis', text: 'In the beginning you hovered over the face of the waters. Shape the land. Raise mountains, plant forests.', hint: 'Use Raise Land or Grow Forest anywhere.', check: () => G._usedTerra },
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

  // ================= Game loop =================
  function loop(t) {
    if (!G.running) return;
    const dt = Math.min(100, t - G.lastT);
    G.lastT = t;
    handleKeyPan(dt);

    if (!G.paused && G.speed > 0) {
      G.acc += dt * G.speed;
      let guard = 0;
      while (G.acc >= STEP_MS && guard < 40) { simStep(); G.acc -= STEP_MS; guard++; }
    }

    if (G.weatherT > 0) { G.weatherT -= dt / STEP_MS; if (G.weatherT <= 0) { G.weather = 'clear'; G.r.weather = 'clear'; } }
    autoWeather();

    Render.FX.update();
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt / 300);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt / 30);

    const sc = G.shake;
    if (sc > 0) { G.r.ctx.save(); G.r.ctx.translate((Math.random() - 0.5) * sc, (Math.random() - 0.5) * sc); }
    Render.draw(G.r, G.sim, G.ui);
    drawOverlays();
    if (sc > 0) G.r.ctx.restore();
    if (G.flash > 0) { const c = G.r.ctx; c.fillStyle = `rgba(255,255,255,${G.flash * 0.5})`; c.fillRect(0, 0, G.r.w, G.r.h); }

    G.hudTimer = (G.hudTimer || 0) + dt;
    if (G.hudTimer > 250) {
      refreshHUD(); if (G.selected) refreshPanelSel();
      refreshOpenPanel();
      stepStory();
      G.hudTimer = 0;
    }

    G.saveTimer += dt;
    if (G.saveTimer > 20000) { save(); G.saveTimer = 0; }
    G.snapTimer += dt;
    if (G.snapTimer > 90000) { takeSnapshot(); G.snapTimer = 0; }

    if (G.openPanel === 'cosmos') drawCosmos(t);

    requestAnimationFrame(loop);
  }

  function drawOverlays() {
    // tornado funnel
    if (G.tornado) {
      const ctx = G.r.ctx, s = Render.worldToScreen(G.r, G.tornado.x, G.tornado.y);
      const cz = G.r.cam.zoom;
      for (let k = 0; k < 5; k++) {
        const w2 = (1 + k * 0.8) * cz, off = Math.sin(G.lastT * 0.01 + k) * cz * 0.4;
        ctx.fillStyle = `rgba(180,188,200,${0.5 - k * 0.08})`;
        ctx.fillRect(s.x - w2 / 2 + off, s.y - k * cz * 0.9, w2, cz * 0.9);
      }
    }
    // doomed core countdown
    const p = G.view.kind === 'planet' ? Cosmos.active() : null;
    if (p && p.meta.doom != null) {
      const ctx = G.r.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(G.r.w / 2 - 130, 58, 260, 26);
      ctx.fillStyle = p.meta.doom < 900 ? '#ff5030' : '#f0a040';
      ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`⚠ CORE COLLAPSE IN ${Math.ceil(p.meta.doom / 120)} YEARS ⚠`, G.r.w / 2, 75);
      ctx.textAlign = 'left';
    }
    // primordial progress
    if (p && p.meta.evo != null) {
      const ctx = G.r.ctx;
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
    const cam = G.r.cam; const spd = (14 / cam.zoom) * (dt / 16);
    if (keys['w'] || keys['arrowup']) cam.y -= spd;
    if (keys['s'] || keys['arrowdown']) cam.y += spd;
    if (keys['a'] || keys['arrowleft']) cam.x -= spd;
    if (keys['d'] || keys['arrowright']) cam.x += spd;
    clampCam();
  }
  function clampCam() {
    const cam = G.r.cam;
    cam.zoom = PD.clamp(cam.zoom, cam.min, cam.max);
    cam.x = W.wrapX(G.world, cam.x); // roundworld: x never clamps, only wraps
    cam.y = PD.clamp(cam.y, 0, G.world.H);
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
      if (!p) return;
      const spent = p.apply(G, wc.x, wc.y);
      if (spent > 0) {
        G.faith -= spent; refreshHUD();
        if (p.cat === 'terra') G._usedTerra = true;
        if (p.cat === 'wrath' || p.id === 'flood' || p.id === 'plagues') G._usedWrath = true;
        if (PD.Society && ['meteor', 'lightning', 'quake', 'plague'].indexOf(p.id) >= 0) PD.Society.reactToMiracle(G.sim, p.id === 'plague' ? 'plague' : p.id);
      }
    }
    function onMinimap(x, y) {
      const m = G.r._mini;
      return m && x >= m.mx && x <= m.mx + m.MW && y >= m.my && y <= m.my + m.MH;
    }
    function jumpMinimap(x, y) {
      const m = G.r._mini;
      G.r.cam.x = (x - m.mx) / m.scale; G.r.cam.y = (y - m.my) / m.scale; clampCam();
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
      if (panning) { G.r.cam.x -= dx / G.r.cam.zoom; G.r.cam.y -= dy / G.r.cam.zoom; clampCam(); }
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
      const l = localXY(e);
      const before = Render.screenToWorldRaw(G.r, l.x, l.y);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      G.r.cam.zoom = PD.clamp(G.r.cam.zoom * factor, G.r.cam.min, G.r.cam.max);
      const after = Render.screenToWorldRaw(G.r, l.x, l.y);
      G.r.cam.x += before.x - after.x; G.r.cam.y += before.y - after.y;
      clampCam();
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
        const mid = touchMid(e, cv);
        const before = Render.screenToWorldRaw(G.r, mid.x, mid.y);
        G.r.cam.zoom = PD.clamp(G.r.cam.zoom * (nd / (pinchD || nd)), G.r.cam.min, G.r.cam.max);
        const after = Render.screenToWorldRaw(G.r, mid.x, mid.y);
        G.r.cam.x += before.x - after.x; G.r.cam.y += before.y - after.y;
        pinchD = nd; clampCam();
      } else {
        const l = localXY(e); const dx = l.x - lastX, dy = l.y - lastY; moved += Math.abs(dx) + Math.abs(dy);
        G.ui.mouseW = Render.screenToWorld(G.r, l.x, l.y);
        if (touchPanning) { G.r.cam.x -= dx / G.r.cam.zoom; G.r.cam.y -= dy / G.r.cam.zoom; clampCam(); }
        else if (dragging && G.power && G.power.cont) applyPower(l.x, l.y);
        lastX = l.x; lastY = l.y;
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', () => {
      if (touchPanning && moved < 8 && G.power && G.power.id === 'inspect') applyPower(lastX, lastY);
      dragging = false; touchPanning = false;
    });

    // keyboard
    global.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase(); keys[k] = true;
      if (k === ' ') { e.preventDefault(); togglePause(); }
      else if (k === '1') setSpeed(1);
      else if (k === '2') setSpeed(2);
      else if (k === '3') setSpeed(4);
      else if (k === '0') setSpeed(0);
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

    global.addEventListener('resize', () => G.r.resize());
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
  function zoomBy(f) { G.r.cam.zoom = PD.clamp(G.r.cam.zoom * f, G.r.cam.min, G.r.cam.max); }

  // ================= Speed / pause =================
  function setSpeed(s) {
    G.speed = s; G.paused = (s === 0);
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', +b.dataset.speed === s));
    Audio8.sfx('click');
  }
  function togglePause() { setSpeed(G.paused ? (G._lastSpeed || 1) : (G._lastSpeed = G.speed, 0)); }
  function toggleLabels() {
    G.ui.showLabels = !G.ui.showLabels;
    $('#btn-labels').classList.toggle('off', !G.ui.showLabels);
  }

  // ================= Toolbar =================
  function buildToolbar() {
    const wrap = $('#tools');
    wrap.innerHTML = '';
    for (const cat of Powers.CATEGORIES) {
      const powers = Powers.POWERS.filter(x => x.cat === cat.id);
      if (!powers.length) continue;
      const group = document.createElement('div');
      group.className = 'tool-group';
      const h = document.createElement('div'); h.className = 'tool-group-title'; h.textContent = cat.name;
      group.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'tool-grid';
      for (const p of powers) {
        const btn = document.createElement('button');
        btn.className = 'tool'; btn.dataset.id = p.id;
        btn.innerHTML = `<span class="tool-ico">${p.icon}</span><span class="tool-name">${p.name}</span>` +
          (p.cost > 0 ? `<span class="tool-cost">✦${p.cost}</span>` : '');
        btn.title = p.desc;
        btn.addEventListener('mouseenter', () => updatePowerInfo(p));
        btn.addEventListener('mouseleave', () => updatePowerInfo(G.power));
        btn.addEventListener('click', () => setPower(p.id));
        grid.appendChild(btn);
      }
      group.appendChild(grid);
      wrap.appendChild(group);
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
  function refreshHUD() {
    $('#faith-val').textContent = Math.floor(G.faith);
    $('#faith-rate').textContent = '+' + faithPerStep().toFixed(1) + '/t';
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
        <div class="ins-row"><span>Soul</span><b>${Sim.TRAITS[u.trait] || '—'} ${Sim.RACES[u.race].sentient ? Sim.PROFESSIONS[u.prof] : ''}</b></div>
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
      const spent = Powers.BY_ID.lightning.apply(G, v.x, v.y);
      if (spent > 0) { G.faith -= spent; refreshHUD(); }
      return;
    }
    const act = btn.dataset.act;
    if (act && G.selected && G.selected.type === 'unit') {
      const u = G.selected.ref;
      let spent = 0;
      if (act === 'blessone') { if (G.faith >= 4) { u.hp = u.maxHp; u.food = 1; u.sick = 0; u.karma += 1; PD.FX.spark(u.x, u.y); Audio8.sfx('bless'); spent = 4; } }
      else if (act === 'voiceone') spent = Powers.BY_ID.voice.apply(G, u.x, u.y);
      else if (act === 'empowerone') spent = Powers.BY_ID.empower.apply(G, u.x, u.y);
      else if (act === 'smiteone') spent = Powers.BY_ID.lightning.apply(G, u.x, u.y);
      if (spent > 0) { G.faith -= spent; refreshHUD(); }
    }
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
        if (refund) { G.faith += refund; G._prayersAnswered = (G._prayersAnswered || 0) + 1; }
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
        const u = PD.Afterlife.resurrect(soul, G.sim, G.r.cam.x, G.r.cam.y);
        if (u) { G.faith -= 50; G._resurrected = true; flashToast(soul + ' lives again!'); Audio8.sfx('levelup'); }
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
    $('#cosmos-controls').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('cosmos-new')) {
        if (G.faith < 150) { flashToast('Creating a world needs ✦150'); Audio8.sfx('error'); return; }
        const p = Cosmos.createPlanet(b.dataset.type);
        if (!p) { flashToast('The void holds at most 8 worlds'); return; }
        G.faith -= 150;
        if (b.dataset.type !== 'primordial' && b.dataset.type !== 'hellscape') seedInitialLife(p.sim, p.world);
        Sim.recount(p.sim);
        flashToast('Let there be ' + p.name);
        Audio8.sfx('levelup');
        renderCosmosControls();
      } else if (b.id === 'cosmos-visit' && cosmosSel >= 0) {
        gotoPlanet(cosmosSel); closePanel();
      } else if (b.id === 'cosmos-rename' && cosmosSel >= 0) {
        const p = Cosmos.getPlanet(cosmosSel);
        const name = prompt('Name this world:', p.name);
        if (name) { p.name = name; p.sim.planetName = name; refreshHUD(); renderCosmosControls(); }
      } else if (b.id === 'cosmos-destroy' && cosmosSel >= 0) {
        if (Cosmos.C.planets.length <= 1) { flashToast('You cannot unmake the last world'); return; }
        if (G.faith < 100) { flashToast('Unmaking needs ✦100'); return; }
        if (confirm('Unmake this world and every soul on it?')) {
          G.faith -= 100;
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

    document.querySelectorAll('.speed-btn').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('#btn-menu').addEventListener('click', toggleMenu);
    $('#btn-save').addEventListener('click', () => save());
    $('#btn-labels').addEventListener('click', toggleLabels);
    $('#btn-sound').addEventListener('click', () => {
      const on = !Audio8.isEnabled(); Audio8.setEnabled(on); Audio8.setMusic(on);
      $('#btn-sound').textContent = on ? '🔊' : '🔇';
      if (on) Audio8.unlock();
    });

    $('#menu-new').addEventListener('click', () => {
      if (confirm('Begin a NEW multiverse? Everything will be overwritten.')) {
        wipeSave(); newMultiverse(); Render.FX.clear(); $('#menu-modal').classList.remove('show'); flashToast('In the beginning…');
      }
    });
    $('#menu-resume').addEventListener('click', () => $('#menu-modal').classList.remove('show'));
    $('#menu-save').addEventListener('click', () => { save(); });
    $('#menu-regen-seed').addEventListener('click', () => {
      const s = prompt('Enter a world seed (any text):', G.world.seedStr);
      if (s != null) { wipeSave(); newMultiverse(s); Render.FX.clear(); $('#menu-modal').classList.remove('show'); flashToast('World seed: ' + s); }
    });

    $('#offline-close') && $('#offline-close').addEventListener('click', () => $('#offline-modal').classList.remove('show'));
    $('#intro-start').addEventListener('click', () => { $('#intro').classList.add('hide'); Audio8.unlock(); });

    bindInput();

    if (started) {
      const ok = load();
      if (ok) $('#intro').classList.add('hide');
    }

    setSpeed(typeof G.speed === 'number' ? G.speed : 1);
    refreshHUD();
    renderTestament();

    G.running = true; G.lastT = performance.now();
    requestAnimationFrame(loop);
  }

  global.PixelDeity = { boot, save, load, G, timeTravel, gotoPlanet, gotoPlane };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
