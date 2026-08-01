/* =========================================================================
   PIXEL DEITY — sim.js
   The living world: races, creatures, villages, ecology, war, plague.
   Emergent rise-and-fall of civilizations. Pure simulation (no drawing).
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;
  const B = W.B, S = W.S;

  // ---- Race definitions ------------------------------------------------
  // aggr: base aggression, breed: breeding tempo, dmg, hp, spd (tiles/step)
  const RACES = {
    human:   { name: 'Humans',   col: '#f2c39a', col2: '#3a5fb0', emoji: '🧑', aggr: 0.35, breed: 1.2,  dmg: 6,  hp: 30, spd: 0.10, lifespan: 2600, likes: [B.GRASS, B.FOREST, B.DIRT], sentient: true },
    elf:     { name: 'Elves',    col: '#bfe9a0', col2: '#2f8a4a', emoji: '🧝', aggr: 0.20, breed: 0.95, dmg: 8,  hp: 26, spd: 0.12, lifespan: 4200, likes: [B.FOREST, B.JUNGLE],        sentient: true },
    orc:     { name: 'Orcs',     col: '#8fbf6a', col2: '#4a5a24', emoji: '👹', aggr: 0.85, breed: 1.5,  dmg: 9,  hp: 38, spd: 0.11, lifespan: 1900, likes: [B.DIRT, B.DESERT, B.ROCK],  sentient: true },
    dwarf:   { name: 'Dwarves',  col: '#e0a86a', col2: '#8a5a2a', emoji: '🧔', aggr: 0.45, breed: 1.05, dmg: 7,  hp: 46, spd: 0.08, lifespan: 3600, likes: [B.ROCK, B.SNOW, B.DIRT],    sentient: true },
    undead:  { name: 'Undead',   col: '#b7c7c9', col2: '#4a2a4a', emoji: '💀', aggr: 1.0,  breed: 0.0,  dmg: 7,  hp: 34, spd: 0.09, lifespan: 5000, likes: [B.ASH, B.DIRT, B.ROCK],     sentient: false, monster: true },
    critter: { name: 'Critters', col: '#e6d8b0', col2: '#b09060', emoji: '🐇', aggr: 0.0,  breed: 1.6,  dmg: 1,  hp: 8,  spd: 0.09, lifespan: 900,  likes: [B.GRASS, B.FOREST],         sentient: false, animal: true, prey: true },
    wolf:    { name: 'Wolves',   col: '#9aa0a8', col2: '#40444a', emoji: '🐺', aggr: 0.7,  breed: 0.7,  dmg: 5,  hp: 18, spd: 0.13, lifespan: 1300, likes: [B.FOREST, B.SNOW, B.GRASS], sentient: false, animal: true, predator: true }
  };
  const SENTIENT = ['human', 'elf', 'orc', 'dwarf'];

  // hostility: does A attack B on sight?
  function hostile(a, b) {
    if (a === b) return false;
    const ra = RACES[a], rb = RACES[b];
    if (ra.monster && !rb.monster) return true;      // undead attack all living
    if (rb.monster && !ra.monster) return true;
    if (a === 'wolf' && (b === 'critter' || RACES[b].sentient)) return true;
    if (b === 'wolf' && (a === 'critter' || RACES[a].sentient)) return true;
    if (a === 'orc' && RACES[b].sentient) return true;   // orcs raid everyone
    if (b === 'orc' && RACES[a].sentient) return true;
    if (ra.sentient && rb.sentient) {
      // civilized races: mostly wary; hostility emerges via village rivalry
      return false;
    }
    return false;
  }

  // ---- Name generation -------------------------------------------------
  const NAME_PARTS = {
    human: ['Ald','Bre','Cor','Dun','El','Fair','Green','Haven','Iron','Kings','Lake','Mill','North','Oak','Port','River','Stone','West'],
    elf:   ['Ael','Cael','Elar','Fael','Glin','Ithil','Lor','Myr','Nael','Sylv','Thae','Ylth'],
    orc:   ['Gor','Grum','Kaz','Mor','Nar','Rok','Skul','Ugg','Zag','Grish','Drak'],
    dwarf: ['Kaz','Bar','Dur','Khaz','Thar','Grim','Bal','Nog','Zin','Karak']
  };
  const NAME_SUFFIX = {
    human: ['ton','ford','burg','vale','field','haven','mere','wick','gate','holm'],
    elf:   ['ael','wyn','dor','lith','ariel','endil','thil','oria'],
    orc:   ['gash','nak','dush','grod','maw','fang','skar','bash'],
    dwarf: ['heim','dun','delve','forge','hold','mir','rock','barim']
  };
  function villageName(race, rng) {
    const a = NAME_PARTS[race] || NAME_PARTS.human;
    const b = NAME_SUFFIX[race] || NAME_SUFFIX.human;
    return a[(rng() * a.length) | 0] + b[(rng() * b.length) | 0];
  }

  // ---- Simulation container -------------------------------------------
  function createSim(world, rng) {
    return {
      world, rng,
      units: [],
      villages: [],
      nextUnitId: 1,
      nextVillageId: 1,
      tick: 0,
      // aggregate stats
      counts: { human: 0, elf: 0, orc: 0, dwarf: 0, undead: 0, critter: 0, wolf: 0 },
      season: 0, // 0 spring 1 summer 2 autumn 3 winter
      log: [],
      grid: null,
      UNIT_CAP: 1100
    };
  }

  function logEvent(sim, msg, kind) {
    sim.log.unshift({ t: sim.tick, msg, kind: kind || 'info' });
    if (sim.log.length > 60) sim.log.pop();
  }

  // ---- Spatial hash for neighbor queries ------------------------------
  const CELL = 5;
  function buildGrid(sim) {
    const g = new Map();
    for (const u of sim.units) {
      if (u.dead) continue;
      const key = ((u.x / CELL) | 0) + ',' + ((u.y / CELL) | 0);
      let arr = g.get(key); if (!arr) { arr = []; g.set(key, arr); }
      arr.push(u);
    }
    sim.grid = g;
  }
  function forNeighbors(sim, x, y, r, cb) {
    const g = sim.grid; if (!g) return;
    const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    const rc = Math.ceil(r / CELL);
    for (let dy = -rc; dy <= rc; dy++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const arr = g.get((cx + dx) + ',' + (cy + dy));
        if (!arr) continue;
        for (const u of arr) if (!u.dead) cb(u);
      }
    }
  }

  // ---- Spawning --------------------------------------------------------
  function spawnUnit(sim, race, x, y, opts) {
    const R = RACES[race];
    // animals get headroom above the cap so civilization at max size can't
    // permanently crowd the ecology out of existence
    const cap = R.animal ? sim.UNIT_CAP + 120 : sim.UNIT_CAP;
    if (sim.units.length >= cap) return null;
    const u = {
      id: sim.nextUnitId++, race, x, y,
      hp: R.hp, maxHp: R.hp, age: 0,
      adultAt: 60 + (sim.rng() * 30 | 0),
      lifespan: R.lifespan * (0.8 + sim.rng() * 0.4),
      state: 'wander', tx: x, ty: y,
      food: 0.8, village: (opts && opts.village != null) ? opts.village : -1,
      cd: 0, sick: 0, breedCd: 40,
      flip: sim.rng() < 0.5 ? 1 : -1,
      bob: sim.rng() * 6.28
    };
    sim.units.push(u);
    return u;
  }

  function foundVillage(sim, race, x, y) {
    const world = sim.world;
    const spot = W.nearestLand(world, x, y, 20);
    if (!spot) return null;
    const R = RACES[race];
    const v = {
      id: sim.nextVillageId++, race, x: spot.x, y: spot.y,
      name: villageName(race, sim.rng),
      food: 70, pop: 0, level: 1, radius: 4,
      col: R.col2, prosperity: 0.6, aggro: R.aggr,
      buildTimer: 0, colonizeCd: 400 + (sim.rng() * 300 | 0),
      temples: 0, houses: 0, age: 0, rival: -1,
      founded: sim.tick
    };
    sim.villages.push(v);
    // town center
    claimTile(world, v, spot.x, spot.y, S.TOWN);
    // claim an initial ring of land so the village can feed itself right away
    let farms = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = spot.x + dx, y = spot.y + dy;
        if ((dx === 0 && dy === 0) || !W.inBounds(world, x, y)) continue;
        const i = W.idx(world, x, y);
        if (W.isWater(world.biome[i]) || world.owner[i] !== -1) continue;
        world.owner[i] = v.id;
        if (world.fert[i] > 0.2 && farms < 3 && (dx * dx + dy * dy) <= 4) { world.struct[i] = S.FARM; world.structHp[i] = 100; farms++; }
        else if (sim.rng() < 0.3) { world.struct[i] = S.HOUSE; world.structHp[i] = 100; v.houses++; }
      }
    }
    world.dirty = true;
    // starter settlers
    for (let k = 0; k < 4; k++) {
      spawnUnit(sim, race, spot.x + (sim.rng() * 2 - 1), spot.y + (sim.rng() * 2 - 1), { village: v.id });
    }
    logEvent(sim, `${v.name} founded by the ${R.name}.`, 'found');
    return v;
  }

  function claimTile(world, v, x, y, struct) {
    if (!W.inBounds(world, x, y)) return;
    const i = W.idx(world, x, y);
    if (W.isWater(world.biome[i])) return;
    world.owner[i] = v.id;
    if (struct != null) { world.struct[i] = struct; world.structHp[i] = 100; }
    world.dirty = true;
  }

  // ---- Movement helpers ------------------------------------------------
  function pickWander(sim, u) {
    const world = sim.world;
    for (let tries = 0; tries < 6; tries++) {
      const ang = sim.rng() * 6.283;
      const dr = 3 + sim.rng() * 6;
      const nx = u.x + Math.cos(ang) * dr;
      const ny = u.y + Math.sin(ang) * dr;
      const ix = Math.round(nx), iy = Math.round(ny);
      if (W.inBounds(world, ix, iy) && W.isLand(world.biome[W.idx(world, ix, iy)])) {
        u.tx = nx; u.ty = ny; return;
      }
    }
    u.tx = u.x; u.ty = u.y;
  }

  function moveToward(sim, u, spd) {
    const world = sim.world;
    let dx = u.tx - u.x, dy = u.ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return true;
    dx /= d; dy /= d;
    let nx = u.x + dx * spd, ny = u.y + dy * spd;
    const ix = Math.round(nx), iy = Math.round(ny);
    if (W.inBounds(world, ix, iy) && W.isLand(world.biome[W.idx(world, ix, iy)])) {
      if (dx > 0.1) u.flip = 1; else if (dx < -0.1) u.flip = -1;
      u.x = nx; u.y = ny;
    } else {
      // blocked by water/edge: try sliding along axes
      if (W.inBounds(world, Math.round(u.x + dx * spd), Math.round(u.y)) &&
          W.isLand(world.biome[W.idx(world, Math.round(u.x + dx * spd), Math.round(u.y))])) {
        u.x += dx * spd;
      } else if (W.inBounds(world, Math.round(u.x), Math.round(u.y + dy * spd)) &&
          W.isLand(world.biome[W.idx(world, Math.round(u.x), Math.round(u.y + dy * spd))])) {
        u.y += dy * spd;
      } else {
        u.tx = u.x; u.ty = u.y; // give up, repick next tick
      }
    }
    return false;
  }

  // ---- Unit behavior ---------------------------------------------------
  function updateUnit(sim, u, dt) {
    const world = sim.world;
    const R = RACES[u.race];
    u.age += 1;
    u.bob += 0.3;
    if (u.cd > 0) u.cd--;
    if (u.breedCd > 0) u.breedCd--;

    // aging death
    if (u.age > u.lifespan) { killUnit(sim, u, null); return; }

    // sickness
    if (u.sick > 0) {
      u.sick++;
      u.hp -= 0.25;
      // spread
      if (u.sick % 12 === 0) {
        forNeighbors(sim, u.x, u.y, 2.5, (o) => {
          if (o !== u && o.sick === 0 && !RACES[o.race].monster && sim.rng() < 0.25) o.sick = 1;
        });
      }
      if (u.hp <= 0) { killUnit(sim, u, 'plague'); return; }
      if (u.sick > 200 && sim.rng() < 0.02) u.sick = 0; // recover
    }

    // hunger
    const v = u.village >= 0 ? villageById(sim, u.village) : null;
    if (v && v.food > 0) {
      u.food = PD.clamp(u.food + 0.02, 0, 1);
      v.food -= 0.018;
    } else {
      // wild units forage from the land they stand on
      const ti = W.idx(world, PD.clamp(Math.round(u.x), 0, world.W - 1), PD.clamp(Math.round(u.y), 0, world.H - 1));
      const forage = world.fert[ti];
      if (!RACES[u.race].monster && forage > 0.15) u.food = PD.clamp(u.food + forage * 0.012, 0, 1);
      else u.food -= (R.animal ? 0.003 : 0.005);
    }
    if (u.food <= 0) {
      u.hp -= 0.3;
      if (u.hp <= 0) { killUnit(sim, u, 'starve'); return; }
    } else if (u.hp < u.maxHp && u.food > 0.5) {
      u.hp = PD.clamp(u.hp + 0.15, 0, u.maxHp);
    }

    // ---- combat / hunting: scan neighbors ----
    let enemy = null, enemyD = 99;
    forNeighbors(sim, u.x, u.y, 3.2, (o) => {
      if (o === u) return;
      if (hostile(u.race, o.race)) {
        const d = PD.dist(u.x, u.y, o.x, o.y);
        if (d < enemyD) { enemyD = d; enemy = o; }
      }
    });

    if (enemy) {
      // prey flees
      if (R.prey) {
        u.state = 'flee';
        u.tx = u.x + (u.x - enemy.x); u.ty = u.y + (u.y - enemy.y);
        moveToward(sim, u, R.spd * 1.3);
        return;
      }
      u.state = 'fight';
      u.tx = enemy.x; u.ty = enemy.y;
      if (enemyD < 1.2) {
        if (u.cd === 0) {
          enemy.hp -= R.dmg * (0.6 + sim.rng() * 0.8);
          u.cd = 18;
          if (PD.FX) PD.FX.hit(enemy.x, enemy.y);
          if (enemy.hp <= 0) { killUnit(sim, enemy, u.race); if (sim.rng() < 0.15 && PD.Audio8) PD.Audio8.sfx('war'); }
        }
      } else {
        moveToward(sim, u, R.spd * 1.15);
      }
      return;
    }

    // ---- non-combat behavior ----
    // predator seeks prey even if not adjacent-hostile flagged strongly
    if (R.predator && u.food < 0.6) {
      let prey = null, pd = 99;
      forNeighbors(sim, u.x, u.y, 8, (o) => {
        if (o.race === 'critter' || (RACES[o.race].sentient && sim.rng() < 0.02)) {
          const d = PD.dist(u.x, u.y, o.x, o.y);
          if (d < pd) { pd = d; prey = o; }
        }
      });
      if (prey) { u.tx = prey.x; u.ty = prey.y; moveToward(sim, u, R.spd * 1.2); return; }
    }

    // breeding (animals breed in the wild)
    if (R.animal && R.breed > 0 && u.age > u.adultAt && u.breedCd === 0 && u.food > 0.5) {
      const cap = u.race === 'critter' ? 260 : 90;
      if (sim.counts[u.race] < cap && sim.units.length < sim.UNIT_CAP) {
        forNeighbors(sim, u.x, u.y, 2, (o) => {
          if (o !== u && o.race === u.race && o.age > o.adultAt && u.breedCd === 0) {
            const b = world.biome[W.idx(world, Math.round(u.x), Math.round(u.y))];
            if (R.likes.indexOf(b) >= 0 || sim.rng() < 0.3) {
              spawnUnit(sim, u.race, u.x + sim.rng() - 0.5, u.y + sim.rng() - 0.5);
              u.breedCd = 120; u.food -= 0.3;
            }
          }
        });
      }
    }

    // homing toward village if far (settlers/citizens stay near home)
    if (v) {
      const dh = PD.dist(u.x, u.y, v.x, v.y);
      if (dh > v.radius + 5) { u.state = 'goHome'; u.tx = v.x; u.ty = v.y; moveToward(sim, u, R.spd); return; }
    }

    // wander
    if (PD.dist(u.x, u.y, u.tx, u.ty) < 0.4 || sim.rng() < 0.02) pickWander(sim, u);
    u.state = 'wander';
    moveToward(sim, u, R.spd * (0.6 + 0.4 * (u.food)));
  }

  function killUnit(sim, u, byRace) {
    if (u.dead) return;
    u.dead = true;
    if (PD.FX) PD.FX.blood(u.x, u.y);
    // undead raising: living killed by undead/plague may rise
    const R = RACES[u.race];
    if (!R.monster && (byRace === 'undead' || byRace === 'plague')) {
      if (sim.rng() < 0.28 && sim.units.length < sim.UNIT_CAP) {
        // convert into an undead in place (defer so we don't mutate mid-iterate weirdly)
        sim._raise = sim._raise || [];
        sim._raise.push({ x: u.x, y: u.y });
      }
    }
  }

  function villageById(sim, id) {
    for (const v of sim.villages) if (v.id === id) return v;
    return null;
  }

  // ---- Village behavior ------------------------------------------------
  function updateVillage(sim, v, dt) {
    const world = sim.world;
    const R = RACES[v.race];
    v.age++;

    // Food production: scan owned tiles for fertility + farms.
    // Carrying capacity is derived from the land the village works, giving
    // logistic growth: towns grow toward a stable size, then plateau.
    let fertSum = 0, farms = 0, ownedLand = 0;
    const rad = v.radius;
    const seasonMul = [1.1, 1.25, 1.0, 0.65][sim.season]; // winter is lean
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = v.x + dx, y = v.y + dy;
        if (!W.inBounds(world, x, y)) continue;
        const i = W.idx(world, x, y);
        if (world.owner[i] !== v.id) continue;
        ownedLand++;
        if (world.fire[i] > 0) continue;
        let f = world.fert[i];
        if (world.struct[i] === S.FARM) { f += 0.5; farms++; }
        fertSum += f;
      }
    }
    // base forage keeps small settlements alive; land+farms scale it up
    const production = (0.7 + fertSum + farms * 0.6) * 0.06 * seasonMul;
    v.food += production;
    // consumption is handled per-unit (citizens draw from the store); add a
    // small upkeep so sprawling empty claims aren't free
    v.food -= ownedLand * 0.004;

    // carrying capacity from worked land (this is what stops runaway growth)
    v.cap = Math.min(120, 5 + Math.floor(fertSum * 2.2) + farms * 2 + v.level * 3);

    // prosperity from food per capita
    const perCap = v.pop > 0 ? v.food / v.pop : v.food;
    v.prosperity = PD.clamp(v.prosperity * 0.94 + PD.clamp(perCap / 6, 0, 1) * 0.06, 0, 1);

    // ---- growth: birth a citizen (logistic toward capacity) ----
    if (v.pop < v.cap && v.food > 8 + v.pop * 0.6 && sim.units.length < sim.UNIT_CAP) {
      const room = 1 - v.pop / Math.max(1, v.cap);
      if (sim.rng() < 0.22 * R.breed * (0.3 + room)) {
        spawnUnit(sim, v.race, v.x + (sim.rng() * 2 - 1), v.y + (sim.rng() * 2 - 1), { village: v.id });
        v.food -= 5;
      }
    }

    // starvation: too many mouths for the land
    if (v.food < -3) {
      v.food = 0;
      const cit = sim.units.find(u => !u.dead && u.village === v.id);
      if (cit) killUnit(sim, cit, 'starve');
    }

    // ---- expansion: claim adjacent land, build ----
    v.buildTimer--;
    if (v.buildTimer <= 0) {
      v.buildTimer = 16;
      // grow radius with pop
      const wantRad = Math.min(15, 3 + Math.floor(v.pop / 3));
      if (v.radius < wantRad) v.radius++;
      // claim tiles near edge, sometimes build a structure. Claim more per
      // cycle while the town is still finding its footing.
      const claims = v.pop < 6 ? 3 : 1;
      for (let c = 0; c < claims; c++) {
        const ang = sim.rng() * 6.283, dr = 1 + sim.rng() * v.radius;
        const x = Math.round(v.x + Math.cos(ang) * dr);
        const y = Math.round(v.y + Math.sin(ang) * dr);
        if (!W.inBounds(world, x, y)) continue;
        const i = W.idx(world, x, y);
        if (!W.isWater(world.biome[i]) && (world.owner[i] === -1 || world.owner[i] === v.id) && world.struct[i] === 0) {
          world.owner[i] = v.id;
          const roll = sim.rng();
          if (roll < 0.45 && world.fert[i] > 0.1) { world.struct[i] = S.FARM; }
          else if (roll < 0.78) { world.struct[i] = S.HOUSE; v.houses++; }
          else if (roll < 0.88 && v.level >= 2 && v.temples < 3) { world.struct[i] = S.TEMPLE; v.temples++; }
          else if (roll < 0.94 && v.level >= 2) { world.struct[i] = S.TOWER; }
          world.structHp[i] = 100; world.dirty = true; world.dirtyMini = true;
          v.food -= 1.5;
        }
      }
    }

    // ---- level up ----
    const nextLvl = v.level * 10;
    if (v.pop >= nextLvl && v.food > 15) {
      v.level++;
      logEvent(sim, `${v.name} grew to a ${v.level >= 4 ? 'metropolis' : v.level >= 3 ? 'city' : 'town'} (lvl ${v.level}).`, 'grow');
      if (PD.Audio8) PD.Audio8.sfx('build');
    }

    // ---- colonization: send out settlers to found a new village ----
    v.colonizeCd--;
    if (v.colonizeCd <= 0 && v.pop >= 8 && v.food > 25 && sim.villages.length < 80) {
      v.colonizeCd = 500 + (sim.rng() * 400 | 0);
      // find a spot away from home
      const ang = sim.rng() * 6.283, dr = 18 + sim.rng() * 22;
      const tx = Math.round(v.x + Math.cos(ang) * dr);
      const ty = Math.round(v.y + Math.sin(ang) * dr);
      const spot = W.nearestLand(world, tx, ty, 16);
      if (spot && world.owner[W.idx(world, spot.x, spot.y)] === -1) {
        const nv = foundVillage(sim, v.race, spot.x, spot.y);
        if (nv) { v.food -= 20; }
      }
    }

    // ---- war: rivalry with an overlapping enemy village ----
    if (v.age % 30 === 0) {
      let rival = null, rd = 99;
      for (const o of sim.villages) {
        if (o.id === v.id || o.race === v.race) continue;
        const d = PD.dist(v.x, v.y, o.x, o.y);
        if (d < v.radius + o.radius + 6 && d < rd) { rd = d; rival = o; }
      }
      if (rival && (v.race === 'orc' || rival.race === 'orc' || v.prosperity < 0.35 || sim.rng() < 0.2)) {
        if (v.rival !== rival.id) {
          v.rival = rival.id;
          if (sim.rng() < 0.3) logEvent(sim, `War! ${v.name} clashes with ${rival.name}.`, 'war');
        }
      } else v.rival = -1;
    }
  }

  // ---- Global recount & cleanup ---------------------------------------
  function recount(sim) {
    for (const k in sim.counts) sim.counts[k] = 0;
    for (const v of sim.villages) v.pop = 0;
    for (const u of sim.units) {
      if (u.dead) continue;
      sim.counts[u.race]++;
      if (u.village >= 0) { const v = villageById(sim, u.village); if (v) v.pop++; else u.village = -1; }
    }
  }

  // ---- Main step -------------------------------------------------------
  function step(sim, dt) {
    sim.tick++;
    sim.season = Math.floor((sim.tick % 480) / 120); // 4 seasons per ~year
    buildGrid(sim);

    // units
    for (let i = 0; i < sim.units.length; i++) {
      const u = sim.units[i];
      if (u.dead) continue;
      updateUnit(sim, u, dt);
    }

    // process raises (undead rising)
    if (sim._raise && sim._raise.length) {
      for (const r of sim._raise) {
        const u = spawnUnit(sim, 'undead', r.x, r.y);
        if (u && PD.FX) PD.FX.puff(r.x, r.y, '#6a2a6a');
      }
      sim._raise.length = 0;
    }

    // compact dead units periodically
    if (sim.tick % 20 === 0) {
      sim.units = sim.units.filter(u => !u.dead);
    }

    // villages
    for (let i = 0; i < sim.villages.length; i++) {
      updateVillage(sim, sim.villages[i], dt);
    }

    // remove fallen villages (no pop, no town tile)
    recount(sim);
    for (let i = sim.villages.length - 1; i >= 0; i--) {
      const v = sim.villages[i];
      if (v.pop === 0 && v.age > 60) {
        // village falls -> ruins
        ruinVillage(sim, v);
        logEvent(sim, `${v.name} has fallen to ruin.`, 'fall');
        sim.villages.splice(i, 1);
      }
    }

    // world fire spread (every other tick)
    if (sim.tick % 2 === 0) W.stepFire(sim.world, sim.rng);

    // ambient wildlife spawns to keep ecology alive
    if (sim.tick % 120 === 0) ambientSpawns(sim);

    // emergent civilization: clusters of wild folk settle down
    if (sim.tick % 90 === 0) emergentFounding(sim);
  }

  // Wild sentient units that gather on good, unclaimed land found a village.
  function emergentFounding(sim) {
    if (sim.villages.length >= 80) return;
    const world = sim.world;
    let founded = 0;
    for (const u of sim.units) {
      if (founded >= 2) break;
      if (u.dead || u.village >= 0) continue;
      const R = RACES[u.race];
      if (!R.sentient || u.age < u.adultAt) continue;
      const ix = Math.round(u.x), iy = Math.round(u.y);
      if (!W.inBounds(world, ix, iy)) continue;
      const i = W.idx(world, ix, iy);
      if (W.isWater(world.biome[i]) || world.owner[i] !== -1 || world.fert[i] < 0.25) continue;
      // no existing village too close
      let near = false;
      for (const vv of sim.villages) { if (PD.dist(vv.x, vv.y, u.x, u.y) < 12) { near = true; break; } }
      if (near) continue;
      // count wild same-race adults nearby
      const kin = [];
      forNeighbors(sim, u.x, u.y, 4, (o) => {
        if (o.race === u.race && o.village < 0 && o.age > o.adultAt) kin.push(o);
      });
      if (kin.length >= 4) {
        const v = foundVillage(sim, u.race, ix, iy);
        if (v) {
          for (const k of kin) k.village = v.id;
          founded++;
        }
      }
    }
  }

  function ruinVillage(sim, v) {
    const world = sim.world;
    const rad = v.radius + 2;
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = v.x + dx, y = v.y + dy;
        if (!W.inBounds(world, x, y)) continue;
        const i = W.idx(world, x, y);
        if (world.owner[i] === v.id) {
          world.owner[i] = -1;
          if (world.struct[i] !== 0) world.struct[i] = (sim.rng() < 0.5 ? S.RUIN : S.NONE);
        }
      }
    }
    world.dirty = true;
  }

  function ambientSpawns(sim) {
    const world = sim.world;
    // keep some critters around
    if (sim.counts.critter < 40) {
      for (let k = 0; k < 6; k++) {
        const x = (sim.rng() * world.W) | 0, y = (sim.rng() * world.H) | 0;
        const spot = W.nearestLand(world, x, y, 10);
        if (spot) spawnUnit(sim, 'critter', spot.x, spot.y);
      }
    }
    if (sim.counts.wolf < 12 && sim.counts.critter > 20 && sim.rng() < 0.6) {
      const x = (sim.rng() * world.W) | 0, y = (sim.rng() * world.H) | 0;
      const spot = W.nearestLand(world, x, y, 10);
      if (spot) spawnUnit(sim, 'wolf', spot.x, spot.y);
    }
  }

  // ---- Area effects invoked by divine powers --------------------------
  function damageArea(sim, cx, cy, radius, dmg, byRace) {
    forNeighbors(sim, cx, cy, radius + 1, (u) => {
      if (PD.dist(u.x, u.y, cx, cy) <= radius) {
        u.hp -= dmg;
        if (u.hp <= 0) killUnit(sim, u, byRace);
      }
    });
  }
  function blessArea(sim, cx, cy, radius) {
    forNeighbors(sim, cx, cy, radius + 1, (u) => {
      if (PD.dist(u.x, u.y, cx, cy) <= radius) {
        u.hp = u.maxHp; u.food = 1; u.sick = 0;
      }
    });
  }
  function infectArea(sim, cx, cy, radius) {
    forNeighbors(sim, cx, cy, radius + 1, (u) => {
      if (!RACES[u.race].monster && PD.dist(u.x, u.y, cx, cy) <= radius) u.sick = 1;
    });
  }

  global.PD.Sim = {
    RACES, SENTIENT, hostile, createSim, spawnUnit, foundVillage,
    step, recount, villageById, logEvent,
    damageArea, blessArea, infectArea, buildGrid, forNeighbors,
    villageName
  };
})(window);
