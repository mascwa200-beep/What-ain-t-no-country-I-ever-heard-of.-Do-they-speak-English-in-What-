/* =========================================================================
   PIXEL DEITY — cosmos.js
   The multiverse. Planets orbit in the void as spinning pixel globes.
   Create worlds, destroy them, watch a doomed core count down to a
   shattering — and, sometimes, an escape rocket carrying a starchild.
   Time flows only where the god gazes; the rest of creation holds its
   breath (doomed cores, alas, do not).
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;

  const PLANET_TYPES = {
    verdant:    { name: 'Verdant',    desc: 'A living world of green continents and blue seas.', opts: {} },
    desert:     { name: 'Desert',     desc: 'A dry world of endless dunes. Hard, but not hopeless.', opts: { moistShift: -0.32, tempShift: 0.25 } },
    frozen:     { name: 'Frozen',     desc: 'An ice world. Only the hardy survive its long winters.', opts: { tempShift: -0.45 } },
    oceanic:    { name: 'Oceanic',    desc: 'A water world of scattered islands. Merfolk paradise.', opts: { seaShift: 0.12 } },
    hellscape:  { name: 'Hellscape',  desc: 'Lava seas and ashen rock. Tieflings feel at home.', opts: { mode: 'hell', tempShift: 0.3 } },
    primordial: { name: 'Primordial', desc: 'A young world of ooze and shallow seas. Guide its evolution.', opts: { mode: 'primordial', seaShift: 0.08 } },
    doomed:     { name: 'Doomed',     desc: 'A beautiful world with an unstable core. It WILL shatter. Unless…', opts: {} }
  };

  const PLANET_NAMES = ['Aeloria', 'Bront', 'Cindral', 'Dawnmere', 'Erebos', 'Feyland', 'Gloamhold', 'Hythera', 'Ionaal', 'Jorvan', 'Kaldrun', 'Lumen', 'Morrow', 'Nyxis', 'Oberon', 'Pyrros', 'Quellon', 'Rimeworld', 'Solyn', 'Thessa', 'Umbra', 'Vernal', 'Wyrd', 'Xanthe', 'Ythil', 'Zephyria'];

  const C = {
    planets: [],      // {id,name,type,seed,world,sim,meta,orbit,col}
    nextId: 1,
    activeId: -1,
    inPlane: null     // afterlife plane id if the god is visiting the Beyond
  };

  function planetName(rng) {
    return PLANET_NAMES[(rng() * PLANET_NAMES.length) | 0] + '-' + ((rng() * 90 + 10) | 0);
  }

  function createPlanet(type, seedStr, name) {
    if (C.planets.length >= 10) return null; // the void holds only so much
    const t = PLANET_TYPES[type] || PLANET_TYPES.verdant;
    seedStr = seedStr || ('' + Date.now() + (Math.random() * 1e6 | 0));
    const rng = PD.makeRNG(PD.hashSeed(seedStr));
    const world = W.createWorld(180, 120, seedStr, t.opts);
    const sim = PD.Sim.createSim(world, PD.makeRNG(PD.hashSeed(seedStr) ^ 0x9e3779b9));
    const p = {
      id: C.nextId++, name: name || planetName(rng), type,
      seed: seedStr, world, sim,
      meta: {},
      orbit: { r: 60 + C.planets.length * 34, a: rng() * 6.28, spd: 0.0006 + rng() * 0.0008 },
      rot: rng() * 1
    };
    sim.planetName = p.name;
    if (type === 'doomed') p.meta.doom = 4800 + (rng() * 1200 | 0); // ~40 min of watched time
    if (type === 'primordial') p.meta.evo = 0;
    C.planets.push(p);
    return p;
  }

  function destroyPlanet(id) {
    const i = C.planets.findIndex(p => p.id === id);
    if (i < 0) return false;
    const p = C.planets[i];
    // every living soul on it dies (they flood into the Beyond)
    for (const u of p.sim.units) {
      if (!u.dead) PD.Sim.killUnit(p.sim, u, 'apocalypse');
    }
    C.planets.splice(i, 1);
    if (C.activeId === id) C.activeId = C.planets.length ? C.planets[0].id : -1;
    return true;
  }

  function getPlanet(id) { return C.planets.find(p => p.id === id) || null; }
  function active() { return getPlanet(C.activeId); }

  // ---- doomed core & background fate (ticked once per active sim step) --
  function tickAll(activeSim) {
    for (const p of C.planets) {
      if (p.meta.doom != null && p.meta.doom > 0) {
        p.meta.doom--;
        const sim = p.sim, world = p.world;
        // the core convulses as the end nears
        if (p.meta.doom < 900 && sim.rng() < 0.01) {
          const x = (sim.rng() * world.W) | 0, y = (sim.rng() * world.H) | 0;
          W.raise(world, x, y, 3, -0.08);
          if (p.id === C.activeId && PD.FX) { PD.FX.shock(x, y, 5, '#e04a10'); if (global.G) global.G.shake = 8; }
        }
        // the escape rocket: one child is saved, and becomes a starchild
        if (p.meta.doom === 600 && !p.meta.rocketFired) {
          p.meta.rocketFired = true;
          fireEscapeRocket(p);
        }
        if (p.meta.doom <= 0) shatter(p);
      }
      // primordial evolution creeps forward on the watched world
      if (p.meta.evo != null && p.id === C.activeId) {
        p.meta.evoProg = (p.meta.evoProg || 0) + 0.02;
        if (p.meta.evoProg >= 100) { p.meta.evoProg = 0; advanceEvolution(p); }
      }
    }
  }

  function fireEscapeRocket(p) {
    const others = C.planets.filter(o => o.id !== p.id && o.type !== 'doomed' && o.type !== 'hellscape');
    const sim = p.sim;
    // find a sentient family to launch their child
    const parent = sim.units.find(u => !u.dead && PD.Sim.RACES[u.race] && PD.Sim.RACES[u.race].sentient);
    if (!others.length || !parent) {
      if (PD.Society) PD.Society.hist(sim, 'A rocket was built, but there was nowhere to send it.', 'legend');
      return;
    }
    const dest = others[(sim.rng() * others.length) | 0];
    const spot = W.nearestLand(dest.world, (dest.sim.rng() * dest.world.W) | 0, (dest.sim.rng() * dest.world.H) | 0, 20);
    if (!spot) return;
    const child = PD.Sim.spawnUnit(dest.sim, parent.race, spot.x, spot.y);
    if (child) {
      child.name = parent.name + "'s child";
      child.age = 0; child.karma = 5;
      dest.sim._starchild = child.id; // empowered on coming of age
      if (PD.Society) {
        PD.Society.hist(sim, `${parent.name} seals their child into a rocket as the core fails. It rises on a pillar of fire toward ${dest.name}.`, 'legend');
        PD.Society.hist(dest.sim, `A tiny rocket falls from the sky. Inside: a child of doomed ${p.name}. They seem… unusual.`, 'legend');
      }
      if (PD.FX && dest.id === C.activeId) PD.FX.explosion(spot.x, spot.y, false);
    }
  }

  // a starchild raised under a foreign sun comes into their power
  function checkStarchild(sim) {
    if (!sim._starchild) return;
    const u = sim.units.find(x => x.id === sim._starchild && !x.dead);
    if (!u) { sim._starchild = null; return; }
    if (u.age > u.adultAt && !u.paragon) {
      PD.Society.empower(sim, u, 3);
      PD.Society.hist(sim, `${u.name}, the child from the stars, discovers what they can do.`, 'legend');
      sim._starchild = null;
    }
  }

  function shatter(p) {
    const sim = p.sim, world = p.world;
    p.meta.doom = null;
    p.type = 'shattered';
    // the world burns and breaks
    for (let i = 0; i < world.n; i++) {
      const b = world.biome[i];
      if (W.isWater(b)) { world.biome[i] = (i % 7 === 0) ? W.B.LAVA : W.B.DEEP; }
      else { world.biome[i] = (i % 3 === 0) ? W.B.LAVA : W.B.ASH; world.tree[i] = 0; }
      world.struct[i] = 0; world.owner[i] = -1; world.fert[i] = 0;
    }
    world.mode = 'hell';
    world.dirty = true; world.dirtyMini = true; world.dirtyGlobe = true;
    for (const u of sim.units) if (!u.dead) PD.Sim.killUnit(sim, u, 'apocalypse');
    sim.villages.length = 0;
    if (PD.Society) PD.Society.hist(sim, `${p.name} HAS SHATTERED. ${p.name} is no more. The Beyond weeps with new souls.`, 'fall');
    if (p.id === C.activeId && global.G) { global.G.flash = 1; global.G.shake = 30; }
    if (PD.Audio8) PD.Audio8.sfx('meteor');
  }

  // "Stabilize Core" — the god's mercy (called by a power)
  function stabilize(p) {
    if (p.meta.doom == null) return false;
    p.meta.doom = null;
    p.type = 'verdant';
    if (PD.Society) PD.Society.hist(p.sim, `The core quiets. ${p.name} will live. The people feel it, and weep with joy.`, 'legend');
    return true;
  }

  // ---- primordial evolution -------------------------------------------
  const EVO_STAGES = [
    'Microbial soup', 'Sea life blooms', 'Green colonizes land',
    'Beasts roam', 'Proto-sapients gather', 'SAPIENCE'
  ];
  function advanceEvolution(p) {
    const sim = p.sim, world = p.world;
    p.meta.evo = Math.min(5, (p.meta.evo || 0) + 1);
    const stage = p.meta.evo;
    if (PD.Society) PD.Society.hist(sim, `Evolution: ${EVO_STAGES[stage]}.`, 'era');
    if (stage === 2) {
      // life greens the ooze
      for (let i = 0; i < world.n; i++) {
        if (world.biome[i] === W.B.OOZE && sim.rng() < 0.5) {
          world.biome[i] = sim.rng() < 0.3 ? W.B.FOREST : W.B.GRASS;
          world.fert[i] = 0.6; world.tree[i] = world.biome[i] === W.B.FOREST ? 2 : 0;
        }
      }
      world.dirty = true; world.dirtyMini = true;
    } else if (stage === 3) {
      for (let k = 0; k < 25; k++) {
        const s = W.nearestLand(world, (sim.rng() * world.W) | 0, (sim.rng() * world.H) | 0, 12);
        if (s) PD.Sim.spawnUnit(sim, sim.rng() < 0.8 ? 'critter' : 'wolf', s.x, s.y);
      }
    } else if (stage === 4) {
      const race = PD.Sim.SENTIENT[(sim.rng() * PD.Sim.SENTIENT.length) | 0];
      p.meta.evoRace = race;
      for (let k = 0; k < 8; k++) {
        const s = W.nearestLand(world, (sim.rng() * world.W) | 0, (sim.rng() * world.H) | 0, 12);
        if (s) PD.Sim.spawnUnit(sim, race, s.x, s.y);
      }
    } else if (stage === 5) {
      world.mode = 'normal';
      p.type = 'verdant';
      const race = p.meta.evoRace || 'human';
      const s = W.nearestLand(world, (world.W / 2) | 0, (world.H / 2) | 0, 40);
      if (s) PD.Sim.foundVillage(sim, race, s.x, s.y);
      if (PD.Society) PD.Society.hist(sim, `The ${PD.Sim.RACES[race].name} light their first fire. History begins.`, 'era');
      p.meta.evo = null;
    }
  }

  // ---- Genesis Lab: custom races ---------------------------------------
  // push a #rrggbb toward the red end without blowing out — horned peoples
  // read hotter on the globe, which is the only channel a point sprite has
  function warmer(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return hex;
    const v = parseInt(m[1], 16);
    const r = PD.clamp(((v >> 16) & 255) + 40, 0, 255);
    const g = PD.clamp(((v >> 8) & 255) - 12, 0, 255);
    const b = PD.clamp((v & 255) - 20, 0, 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  const customRaces = [];
  function registerRace(def) {
    // def: {key,name,one,emoji,col,col2,aggr,breed,dmg,hp,spd,lifespan,flags:{}}
    if (PD.Sim.RACES[def.key]) return false;
    const R = {
      name: def.name, one: def.one || def.name, col: def.col, col2: def.col2,
      emoji: def.emoji || '🧬', aggr: def.aggr, breed: def.breed, dmg: def.dmg,
      hp: def.hp, spd: def.spd, lifespan: def.lifespan,
      likes: def.likes || [W.B.GRASS, W.B.FOREST], sentient: true, custom: true
    };
    for (const f of (def.flags || [])) R[f] = true;
    // Horns, Tail and Garb were read only by render.js, which render3d.js
    // overwrites on load — three of the eight Lab options were sold at ✦150
    // and did nothing at all. The 3D renderer draws each creature as one point
    // sprite, so give them meaning it can actually express: horns hit harder
    // and burn warmer, a tail carries you faster, and the garb colour is what
    // a paragon of this people wears when you raise one.
    if (R.horns) { R.dmg = Math.round(R.dmg * 1.35); R.col = warmer(R.col); }
    if (R.tail) R.spd = Math.round(R.spd * 1.3);
    PD.Sim.RACES[def.key] = R;
    if (PD.Sim.SENTIENT.indexOf(def.key) < 0) PD.Sim.SENTIENT.push(def.key);
    customRaces.push(Object.assign({ key: def.key }, def));
    return true;
  }

  // ---- globe rendering (orthographic pixel sphere) ----------------------
  const globeLUT = {}; // size -> [{px,py,lonFrac,latFrac,shade}]
  function getLUT(size) {
    if (globeLUT[size]) return globeLUT[size];
    const lut = [];
    const R2 = size / 2;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const nx = (px - R2) / R2, ny = (py - R2) / R2;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const lat = Math.asin(ny);              // -pi/2..pi/2
        const lon = Math.atan2(nx, nz);         // -pi/2..pi/2 visible
        lut.push({
          px, py,
          lonFrac: lon / (2 * Math.PI),         // add rotation, wrap
          latFrac: lat / Math.PI + 0.5,         // 0..1
          shade: 0.55 + nz * 0.45               // limb darkening
        });
      }
    }
    globeLUT[size] = lut;
    return lut;
  }

  // color cache per planet for globe sampling
  function planetColors(p) {
    const world = p.world;
    if (!p._cols || Math.abs(p.sim.tick - (p._colsTick || 0)) > 60 || world.dirtyGlobe) {
      const cols = p._cols || (p._cols = new Uint8Array(world.n * 3));
      for (let i = 0; i < world.n; i++) {
        const c = PD.Render.hexToRgb(W.BIOME_COLORS[world.biome[i]]);
        let r = c[0], g = c[1], b = c[2];
        if (world.fire[i] > 0) { r = 255; g = 120; b = 20; }
        cols[i * 3] = r; cols[i * 3 + 1] = g; cols[i * 3 + 2] = b;
      }
      p._colsTick = p.sim.tick; world.dirtyGlobe = false;
    }
    return p._cols;
  }

  // draw a spinning globe of planet p into ctx at (cx,cy) with pixel size
  function drawGlobe(ctx, p, cx, cy, size, timeMs) {
    const lut = getLUT(size);
    const world = p.world;
    const cols = planetColors(p);
    const rot = (timeMs * 0.00002 + p.rot) % 1;
    const img = p._img && p._img.width === size ? p._img : (p._img = ctx.createImageData(size, size));
    const data = img.data;
    data.fill(0);
    for (const s of lut) {
      let lf = (s.lonFrac + rot) % 1; if (lf < 0) lf += 1;
      const tx = (lf * world.W) | 0;
      const ty = PD.clamp((s.latFrac * world.H) | 0, 0, world.H - 1);
      const i = ty * world.W + tx;
      const o = (s.py * size + s.px) * 4;
      data[o] = cols[i * 3] * s.shade;
      data[o + 1] = cols[i * 3 + 1] * s.shade;
      data[o + 2] = cols[i * 3 + 2] * s.shade;
      data[o + 3] = 255;
    }
    ctx.putImageData(img, Math.round(cx - size / 2), Math.round(cy - size / 2));
  }

  function serialize() {
    return {
      nextId: C.nextId, activeId: C.activeId,
      customRaces,
      planets: C.planets.map(p => ({
        id: p.id, name: p.name, type: p.type, seed: p.seed,
        meta: p.meta, orbit: p.orbit, rot: p.rot
      }))
    };
  }

  global.PD.Cosmos = {
    C, PLANET_TYPES, EVO_STAGES, customRaces,
    createPlanet, destroyPlanet, getPlanet, active, tickAll, checkStarchild,
    stabilize, shatter, advanceEvolution, registerRace, drawGlobe, serialize,
    planetName
  };
})(window);
