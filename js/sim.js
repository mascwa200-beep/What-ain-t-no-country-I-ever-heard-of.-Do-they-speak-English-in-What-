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
  // flags: sentient (builds civilizations), raider (attacks other civs on
  // sight), monster (attacks all living), holy (attacks monsters), animal,
  // predator/prey (food chain), flies (ignores terrain), aquatic (swims),
  // nocturnal (empowered at night), big (sprite scale), fiery (burns land)
  const RACES = {
    human:      { name: 'Humans',      one: 'Human',      col: '#f2c39a', col2: '#3a5fb0', emoji: '🧑', aggr: 0.35, breed: 1.2,  dmg: 6,  hp: 30, spd: 0.10, lifespan: 2600, likes: [B.GRASS, B.FOREST, B.DIRT], sentient: true },
    elf:        { name: 'Elves',       one: 'Elf',        col: '#bfe9a0', col2: '#2f8a4a', emoji: '🧝', aggr: 0.20, breed: 0.95, dmg: 8,  hp: 26, spd: 0.12, lifespan: 4200, likes: [B.FOREST, B.JUNGLE],        sentient: true },
    orc:        { name: 'Orcs',        one: 'Orc',        col: '#8fbf6a', col2: '#4a5a24', emoji: '👹', aggr: 0.85, breed: 1.5,  dmg: 9,  hp: 38, spd: 0.11, lifespan: 1900, likes: [B.DIRT, B.DESERT, B.ROCK],  sentient: true, raider: true },
    dwarf:      { name: 'Dwarves',     one: 'Dwarf',      col: '#e0a86a', col2: '#8a5a2a', emoji: '🧔', aggr: 0.45, breed: 1.05, dmg: 7,  hp: 46, spd: 0.08, lifespan: 3600, likes: [B.ROCK, B.SNOW, B.DIRT],    sentient: true },
    gnome:      { name: 'Gnomes',      one: 'Gnome',      col: '#e8c8e0', col2: '#8a4a8a', emoji: '🍄', aggr: 0.15, breed: 1.0,  dmg: 4,  hp: 20, spd: 0.11, lifespan: 3000, likes: [B.FOREST, B.GRASS],         sentient: true, tinker: true },
    halfling:   { name: 'Halflings',   one: 'Halfling',   col: '#f0d8a8', col2: '#7a8a3a', emoji: '🥧', aggr: 0.10, breed: 1.35, dmg: 4,  hp: 22, spd: 0.10, lifespan: 2400, likes: [B.GRASS, B.DIRT],           sentient: true },
    goblin:     { name: 'Goblins',     one: 'Goblin',     col: '#a8c860', col2: '#3a5a1a', emoji: '👺', aggr: 0.8,  breed: 1.7,  dmg: 5,  hp: 18, spd: 0.13, lifespan: 1400, likes: [B.SWAMP, B.DIRT, B.ASH],    sentient: true, raider: true },
    tiefling:   { name: 'Tieflings',   one: 'Tiefling',   col: '#d88a7a', col2: '#7a2040', emoji: '😈', aggr: 0.5,  breed: 1.0,  dmg: 8,  hp: 30, spd: 0.11, lifespan: 2800, likes: [B.ASH, B.HELLROCK, B.DIRT], sentient: true, horns: true },
    dragonborn: { name: 'Dragonborn',  one: 'Dragonborn', col: '#c8a040', col2: '#8a3a10', emoji: '🐲', aggr: 0.6,  breed: 0.85, dmg: 11, hp: 44, spd: 0.10, lifespan: 3200, likes: [B.DESERT, B.ROCK],          sentient: true, tail: true },
    lizardfolk: { name: 'Lizardfolk',  one: 'Lizardfolk', col: '#7ab060', col2: '#2a5a3a', emoji: '🦎', aggr: 0.55, breed: 1.2,  dmg: 7,  hp: 32, spd: 0.11, lifespan: 2200, likes: [B.SWAMP, B.JUNGLE],         sentient: true, tail: true },
    merfolk:    { name: 'Merfolk',     one: 'Merfolk',    col: '#7ac8d8', col2: '#1a5a8a', emoji: '🧜', aggr: 0.25, breed: 1.0,  dmg: 6,  hp: 28, spd: 0.12, lifespan: 3400, likes: [B.SAND, B.WATER],           sentient: true, aquatic: true },
    fairy:      { name: 'Fairies',     one: 'Fairy',      col: '#f0c8f8', col2: '#a040c0', emoji: '🧚', aggr: 0.05, breed: 1.1,  dmg: 3,  hp: 12, spd: 0.16, lifespan: 5000, likes: [B.FOREST, B.JUNGLE],        sentient: true, flies: true, healer: true },
    giant:      { name: 'Giants',      one: 'Giant',      col: '#d8b090', col2: '#6a4a8a', emoji: '🗿', aggr: 0.5,  breed: 0.4,  dmg: 20, hp: 120, spd: 0.06, lifespan: 4800, likes: [B.ROCK, B.SNOW],           sentient: true, big: 1.8 },
    vampire:    { name: 'Vampires',    one: 'Vampire',    col: '#d8d0e0', col2: '#5a1030', emoji: '🧛', aggr: 0.9,  breed: 0.0,  dmg: 10, hp: 40, spd: 0.12, lifespan: 9000, likes: [B.ASH, B.DIRT],             sentient: false, monster: true, nocturnal: true, turns: 'vampire' },
    werewolf:   { name: 'Werewolves',  one: 'Werewolf',   col: '#8a7a5a', col2: '#3a2a1a', emoji: '🐾', aggr: 0.75, breed: 0.5,  dmg: 9,  hp: 36, spd: 0.14, lifespan: 2000, likes: [B.FOREST, B.SNOW],          sentient: false, animal: true, predator: true, nocturnal: true },
    troll:      { name: 'Trolls',      one: 'Troll',      col: '#90a878', col2: '#3a4a2a', emoji: '🧌', aggr: 0.85, breed: 0.45, dmg: 14, hp: 90, spd: 0.07, lifespan: 3000, likes: [B.SWAMP, B.ROCK],           sentient: false, predator: true, big: 1.5, regen: true },
    dragon:     { name: 'Dragons',     one: 'Dragon',     col: '#d84a30', col2: '#6a1010', emoji: '🐉', aggr: 1.0,  breed: 0.1,  dmg: 26, hp: 260, spd: 0.15, lifespan: 9000, likes: [B.ROCK, B.DESERT],         sentient: false, monster: true, flies: true, big: 2.2, fiery: true },
    angel:      { name: 'Angels',      one: 'Angel',      col: '#f8f0d0', col2: '#c8a020', emoji: '👼', aggr: 0.3,  breed: 0.0,  dmg: 14, hp: 80, spd: 0.14, lifespan: 99999, likes: [B.CLOUD, B.GOLDMEAD],      sentient: false, holy: true, flies: true, healer: true },
    demon:      { name: 'Demons',      one: 'Demon',      col: '#c05030', col2: '#4a0a0a', emoji: '👿', aggr: 1.0,  breed: 0.2,  dmg: 15, hp: 70, spd: 0.12, lifespan: 99999, likes: [B.HELLROCK, B.ASH],        sentient: false, monster: true, horns: true, fiery: true },
    undead:     { name: 'Undead',      one: 'Undead',     col: '#b7c7c9', col2: '#4a2a4a', emoji: '💀', aggr: 1.0,  breed: 0.0,  dmg: 7,  hp: 34, spd: 0.09, lifespan: 5000, likes: [B.ASH, B.DIRT, B.ROCK],     sentient: false, monster: true },
    spirit:     { name: 'Spirits',     one: 'Spirit',     col: '#cfe0e8', col2: '#7a90a8', emoji: '👻', aggr: 0.0,  breed: 0.0,  dmg: 1,  hp: 20, spd: 0.07, lifespan: 99999, likes: [B.CLOUD, B.VOIDSTONE],      sentient: false, ghost: true, flies: true },
    kraken:     { name: 'Krakens',     one: 'Kraken',     col: '#5a8aa0', col2: '#1a3a5a', emoji: '🐙', aggr: 1.0,  breed: 0.05, dmg: 22, hp: 300, spd: 0.10, lifespan: 9000, likes: [B.DEEP, B.WATER],           sentient: false, monster: true, aquatic: true, big: 2.4 },
    critter:    { name: 'Critters',    one: 'Critter',    col: '#e6d8b0', col2: '#b09060', emoji: '🐇', aggr: 0.0,  breed: 1.6,  dmg: 1,  hp: 8,  spd: 0.09, lifespan: 900,  likes: [B.GRASS, B.FOREST],         sentient: false, animal: true, prey: true },
    wolf:       { name: 'Wolves',      one: 'Wolf',       col: '#9aa0a8', col2: '#40444a', emoji: '🐺', aggr: 0.7,  breed: 0.7,  dmg: 5,  hp: 18, spd: 0.13, lifespan: 1300, likes: [B.FOREST, B.SNOW, B.GRASS], sentient: false, animal: true, predator: true }
  };
  const SENTIENT = Object.keys(RACES).filter(k => RACES[k].sentient);

  // hostility: does A attack B on sight? (flag-driven)
  function hostile(a, b) {
    if (a === b) return false;
    const ra = RACES[a], rb = RACES[b];
    if (!ra || !rb) return false;
    if (ra.monster !== rb.monster) {
      // monsters vs the living; angels (holy) hunt monsters extra-eagerly
      return true;
    }
    if (ra.monster && rb.monster) return false;     // dark powers tolerate each other
    if (ra.holy && rb.monster) return true;
    if (rb.holy && ra.monster) return true;
    if ((ra.raider && rb.sentient) || (rb.raider && ra.sentient)) return true;
    if ((ra.predator && (rb.prey || rb.sentient)) || (rb.predator && (ra.prey || ra.sentient))) return true;
    return false;
  }

  // ---- Name generation -------------------------------------------------
  const NAME_PARTS = {
    human: ['Ald','Bre','Cor','Dun','El','Fair','Green','Haven','Iron','Kings','Lake','Mill','North','Oak','Port','River','Stone','West'],
    elf:   ['Ael','Cael','Elar','Fael','Glin','Ithil','Lor','Myr','Nael','Sylv','Thae','Ylth'],
    orc:   ['Gor','Grum','Kaz','Mor','Nar','Rok','Skul','Ugg','Zag','Grish','Drak'],
    dwarf: ['Kaz','Bar','Dur','Khaz','Thar','Grim','Bal','Nog','Zin','Karak'],
    gnome: ['Fizz','Tink','Wob','Nim','Glim','Pip','Snor','Bim'],
    halfling: ['Apple','Berry','Bramble','Green','Honey','Mead','Puddle','Tea'],
    goblin: ['Snik','Grub','Mux','Zik','Rat','Skab','Nix','Yag'],
    tiefling: ['Ash','Cinder','Dusk','Ember','Mal','Nox','Vex','Zar'],
    dragonborn: ['Bala','Dor','Karn','Rha','Sarr','Torr','Vyx','Zol'],
    lizardfolk: ['Ssha','Xul','Zess','Ka','Issk','Tza','Ssol'],
    merfolk: ['Coral','Pearl','Tide','Brine','Wave','Nerei','Mar'],
    fairy: ['Dew','Glimmer','Moth','Petal','Thistle','Wisp','Bloom'],
    giant: ['Bould','Crag','Fjell','Grond','Skarn','Thund'],
    tiefl: ['Mal']
  };
  const NAME_SUFFIX = {
    human: ['ton','ford','burg','vale','field','haven','mere','wick','gate','holm'],
    elf:   ['ael','wyn','dor','lith','ariel','endil','thil','oria'],
    orc:   ['gash','nak','dush','grod','maw','fang','skar','bash'],
    dwarf: ['heim','dun','delve','forge','hold','mir','rock','barim'],
    gnome: ['whistle','gear','burrow','spark','cap','warren'],
    halfling: ['bottom','foot','hollow','pie','shire','dale'],
    goblin: ['pit','den','warren','heap','hole','nest'],
    tiefling: ['spire','reach','fall','march','hollow'],
    dragonborn: ['roost','scale','peak','maw','throne'],
    lizardfolk: ['marsh','fen','pool','nest','mire'],
    merfolk: ['reef','shoal','deep','cove','lagoon'],
    fairy: ['glade','ring','hollow','glen','dell'],
    giant: ['step','fell','cairn','watch','throne']
  };
  function villageName(race, rng) {
    const a = NAME_PARTS[race] || NAME_PARTS.human;
    const b = NAME_SUFFIX[race] || NAME_SUFFIX.human;
    return a[(rng() * a.length) | 0] + b[(rng() * b.length) | 0];
  }

  // Personal names, personality traits, professions — every soul is someone
  const GIVEN = ['Al','Bel','Cass','Dov','Ela','Fen','Gal','Hild','Ilo','Jun','Kel','Lor','Mira','Ned','Ola','Pip','Quin','Ren','Sera','Tam','Ulf','Vera','Wynn','Xan','Yara','Zeph'];
  const GIVEN2 = ['a','ah','an','ar','ella','en','ette','ia','ic','in','is','on','or','ric','ula','us','wen','wyn'];
  const TRAITS = ['brave','kind','greedy','curious','devout','cruel','wise','lazy','zealous','gentle','proud','sly','stoic','merry','grim','dreamy'];
  const PROFESSIONS = ['farmer','builder','hunter','priest','soldier','healer','scholar','artisan','merchant','bard'];
  function personName(race, rng) {
    return GIVEN[(rng() * GIVEN.length) | 0] + GIVEN2[(rng() * GIVEN2.length) | 0];
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
      // aggregate stats (covers every race incl. runtime-created ones)
      counts: {},
      season: 0, // 0 spring 1 summer 2 autumn 3 winter
      isNight: false,
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
    const world = sim.world;
    const gw = Math.ceil(world.W / CELL); // cells wrap around the planet
    const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    const rc = Math.ceil(r / CELL);
    const r2 = r * r;
    for (let dy = -rc; dy <= rc; dy++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const kx = (((cx + dx) % gw) + gw) % gw;
        const arr = g.get(kx + ',' + (cy + dy));
        if (!arr) continue;
        for (const u of arr) {
          if (u.dead) continue;
          // narrow phase: the coarse cell walk over-scans up to a whole
          // cell-block, so enforce the true (wrap-aware) radius here
          const ddx = W.wrapDX(world, x, u.x), ddy = u.y - y;
          if (ddx * ddx + ddy * ddy <= r2) cb(u);
        }
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
      cd: 0, sick: 0, breedCd: 40, raidT: 0, raidX: 0, raidY: 0,
      flip: sim.rng() < 0.5 ? 1 : -1,
      bob: sim.rng() * 6.28,
      // identity: every creature is somebody
      name: personName(race, sim.rng),
      trait: (sim.rng() * TRAITS.length) | 0,
      prof: (sim.rng() * PROFESSIONS.length) | 0,
      karma: 0,
      paragon: 0 // >0: an empowered hero (grants stats & powers)
    };
    sim.units.push(u);
    if (PD.Society) PD.Society.initUnit(sim, u, opts);
    return u;
  }

  function foundVillage(sim, race, x, y) {
    const world = sim.world;
    // hard cap on settlements (all callers respect a null return), and no
    // ghost villages: founding needs room for at least one starter settler
    if (sim.villages.length >= 80) return null;
    if (sim.units.length >= sim.UNIT_CAP) return null;
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
        W.markTile(world, i);
      }
    }
    world.dirtyMini = true;
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
    W.markTile(world, i);
  }

  // ---- Movement helpers ------------------------------------------------
  // Can this race stand on this tile? Fliers go anywhere, merfolk swim.
  function walkable(world, R, x, y) {
    if (!W.inBounds(world, x, y)) return false;
    if (R.flies) return true;
    const b = world.biome[W.idx(world, x, y)];
    if (R.aquatic) return b !== W.B.LAVA; // merfolk cross land & sea alike
    return W.isLand(b);
  }

  function pickWander(sim, u) {
    const world = sim.world;
    const R = RACES[u.race];
    for (let tries = 0; tries < 6; tries++) {
      const ang = sim.rng() * 6.283;
      const dr = 3 + sim.rng() * 6;
      const nx = u.x + Math.cos(ang) * dr;
      const ny = u.y + Math.sin(ang) * dr;
      if (walkable(world, R, Math.floor(nx), Math.floor(ny))) {
        u.tx = nx; u.ty = ny; return;
      }
    }
    u.tx = u.x; u.ty = u.y;
  }

  function moveToward(sim, u, spd) {
    const world = sim.world;
    const R = RACES[u.race];
    // wrap-aware direction: the world is round, take the short way
    let dx = W.wrapDX(world, u.x, u.tx), dy = u.ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return true;
    dx /= d; dy /= d;
    let nx = u.x + dx * spd, ny = u.y + dy * spd;
    if (walkable(world, R, Math.floor(nx), Math.floor(ny))) {
      if (dx > 0.1) u.flip = 1; else if (dx < -0.1) u.flip = -1;
      u.x = W.wrapX(world, nx); u.y = ny;
    } else {
      // blocked: try sliding along axes
      if (walkable(world, R, Math.floor(u.x + dx * spd), Math.floor(u.y))) {
        u.x = W.wrapX(world, u.x + dx * spd);
      } else if (walkable(world, R, Math.floor(u.x), Math.floor(u.y + dy * spd))) {
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

    // drowning / burning: floods and terraforming can strand the land-bound
    if (!R.flies && !R.aquatic && !R.ghost) {
      const tb = world.biome[W.idx(world, u.x, u.y)];
      if (W.isWater(tb)) {
        u.hp -= tb === B.LAVA ? 4 : 0.8;
        if (u.hp <= 0) { killUnit(sim, u, tb === B.LAVA ? 'lava' : 'drown'); return; }
        // scramble for shore
        const s = W.nearestLand(world, u.x, u.y, 6);
        if (s) { u.tx = s.x; u.ty = s.y; moveToward(sim, u, R.spd * 0.7); }
      }
    }

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

    // hunger (the undead do not eat, and ghosts are past such things)
    const v = u.village >= 0 ? villageById(sim, u.village) : null;
    if (!R.monster && !R.ghost) {
      if (v && v.food > 0) {
        u.food = PD.clamp(u.food + 0.02, 0, 1);
        v.food -= 0.018;
      } else {
        // wild units forage from the land they stand on
        const ti = W.idx(world, PD.clamp(Math.floor(u.x), 0, world.W - 1), PD.clamp(Math.floor(u.y), 0, world.H - 1));
        const forage = world.fert[ti];
        if (forage > 0.15) u.food = PD.clamp(u.food + forage * 0.012, 0, 1);
        else u.food -= (R.animal ? 0.003 : 0.005);
      }
      if (u.food <= 0) {
        u.hp -= 0.3;
        if (u.hp <= 0) { killUnit(sim, u, 'starve'); return; }
      } else if (u.hp < u.maxHp && u.food > 0.5) {
        u.hp = PD.clamp(u.hp + 0.15, 0, u.maxHp);
      }
    }

    // ---- combat / hunting: scan neighbors ----
    // village rivalry makes same-species-tolerant races fight each other
    const rivalId = v && v.rival >= 0 ? v.rival : -1;
    let enemy = null, enemyD = 99;
    forNeighbors(sim, u.x, u.y, 3.2, (o) => {
      if (o === u) return;
      let isFoe = hostile(u.race, o.race);
      if (!isFoe && rivalId >= 0 && o.village === rivalId) isFoe = true;
      if (!isFoe && u.village >= 0 && o.village >= 0 && o.village !== u.village) {
        const ov = villageById(sim, o.village);
        if (ov && ov.rival === u.village) isFoe = true; // they declared on us
      }
      if (isFoe) {
        const d = W.wdist(world, u.x, u.y, o.x, o.y);
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
        if (u.cd === 0 && !shielded(sim, enemy)) {
          // night empowers the nocturnal; paragons hit like gods' chosen;
          // under a blood moon every monster is a nightmare
          let mult = 0.6 + sim.rng() * 0.8;
          if (R.nocturnal) mult *= sim.isNight ? 1.6 : 0.7;
          if (R.monster && sim.bloodMoonT > 0) mult *= 1.6;
          if (u.paragon) mult *= 1 + u.paragon;
          if (u.big) mult *= u.big;
          enemy.hp -= R.dmg * mult;
          u.cd = 18;
          if (PD.FX) PD.FX.hit(enemy.x, enemy.y);
          if (enemy.hp <= 0) {
            killUnit(sim, enemy, u.race, u);
            // hunters and monsters feed on the kill
            if (R.predator || R.monster) u.food = PD.clamp(u.food + 0.6, 0, 1);
            // slaying the innocent stains the soul; slaying monsters shines it
            const RE = RACES[enemy.race];
            if (RE.sentient && !R.monster) u.karma -= 2;
            else if (RE.monster) u.karma += 2;
            if (sim.rng() < 0.15 && PD.Audio8) PD.Audio8.sfx('war');
          }
        }
      } else {
        moveToward(sim, u, R.spd * 1.15);
      }
      return;
    }

    // ---- racial gifts ----
    if (R.regen && u.hp < u.maxHp) u.hp = PD.clamp(u.hp + 0.4, 0, u.maxHp); // trolls knit flesh
    if (R.fiery && u.race === 'dragon' && sim.rng() < 0.01) {
      // dragons scorch the land beneath them
      W.ignite(world, Math.floor(u.x), Math.floor(u.y), 1);
      if (PD.FX) PD.FX.fireBurst(u.x, u.y);
    }
    if (R.healer && sim.tick % 8 === 0) {
      forNeighbors(sim, u.x, u.y, 3, (o) => {
        if (o !== u && !RACES[o.race].monster && o.hp < o.maxHp) { o.hp = PD.clamp(o.hp + 2, 0, o.maxHp); if (o.sick) o.sick = 0; }
      });
      u.karma += 0.002;
    }

    // ---- raiding: march on the rival village ----
    if (u.raidT > 0) {
      u.raidT--;
      u.state = 'raid';
      u.tx = u.raidX; u.ty = u.raidY;
      moveToward(sim, u, R.spd * 1.05);
      if (W.wdist(world, u.x, u.y, u.raidX, u.raidY) < 2) u.raidT = 0; // arrived; fight or go home
      return;
    }

    // ---- non-combat behavior ----
    // predator seeks prey even if not adjacent-hostile flagged strongly
    if (R.predator && u.food < 0.6) {
      let prey = null, pd = 99;
      forNeighbors(sim, u.x, u.y, 8, (o) => {
        if (o.race === 'critter' || (RACES[o.race].sentient && sim.rng() < 0.02)) {
          const d = W.wdist(world, u.x, u.y, o.x, o.y);
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
      const dh = W.wdist(world, u.x, u.y, v.x, v.y);
      if (dh > v.radius + 5) { u.state = 'goHome'; u.tx = v.x; u.ty = v.y; moveToward(sim, u, R.spd); return; }
    }

    // wander
    if (W.wdist(world, u.x, u.y, u.tx, u.ty) < 0.4 || sim.rng() < 0.02) pickWander(sim, u);
    u.state = 'wander';
    moveToward(sim, u, R.spd * (0.6 + 0.4 * (u.food)));
  }

  function killUnit(sim, u, byRace, killer) {
    if (u.dead) return;
    u.dead = true;
    if (PD.FX) PD.FX.blood(u.x, u.y);
    const R = RACES[u.race];
    // dark conversions: the plague-dead rise, vampire victims turn
    if (!R.monster) {
      if ((byRace === 'undead' || byRace === 'plague') && sim.rng() < 0.28 && sim.units.length < sim.UNIT_CAP) {
        sim._raise = sim._raise || [];
        sim._raise.push({ x: u.x, y: u.y, as: 'undead' });
      } else if (byRace === 'vampire' && R.sentient && sim.rng() < 0.35 && sim.units.length < sim.UNIT_CAP) {
        sim._raise = sim._raise || [];
        sim._raise.push({ x: u.x, y: u.y, as: 'vampire' });
      }
    }
    // the soul departs — Society records it and routes it to an afterlife
    if (PD.Society) PD.Society.onDeath(sim, u, byRace, killer);
  }

  function villageById(sim, id) {
    // O(1) map, rebuilt each recount; falls back to a scan if stale
    if (sim.vmap) { const v = sim.vmap.get(id); if (v) return v; }
    for (const v of sim.villages) if (v.id === id) return v;
    return null;
  }

  // ---- Village behavior ------------------------------------------------
  function updateVillage(sim, v, dt) {
    const world = sim.world;
    const R = RACES[v.race];
    v.age++;
    if (v.shieldT > 0) {
      v.shieldT--;
      if (PD.FX && sim.rng() < 0.1) PD.FX.spawn(v.x + (sim.rng() - 0.5) * v.radius * 2, v.y + (sim.rng() - 0.5) * v.radius * 2, 0, -0.04, 20, '#ffe680', 1);
    }

    // Food production: scan owned tiles for fertility + farms.
    // Carrying capacity is derived from the land the village works, giving
    // logistic growth: towns grow toward a stable size, then plateau.
    // The same scan re-derives temple/house counts from the map, so fire,
    // quakes and floods that destroy structures are always reflected.
    let fertSum = 0, farms = 0, ownedLand = 0, temples = 0, houses = 0;
    const rad = v.radius;
    const seasonMul = [1.1, 1.25, 1.0, 0.65][sim.season]; // winter is lean
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = v.x + dx, y = v.y + dy;
        if (!W.inBounds(world, x, y)) continue;
        const i = W.idx(world, x, y);
        if (world.owner[i] !== v.id) continue;
        ownedLand++;
        if (world.struct[i] === S.TEMPLE) temples++;
        else if (world.struct[i] === S.HOUSE) houses++;
        if (world.fire[i] > 0) continue;
        let f = world.fert[i];
        if (world.struct[i] === S.FARM) { f += 0.5; farms++; }
        fertSum += f;
      }
    }
    v.temples = temples; v.houses = houses;
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
          else if (roll < 0.78) { world.struct[i] = S.HOUSE; }
          else if (roll < 0.88 && v.level >= 2 && v.temples < 3) { world.struct[i] = S.TEMPLE; v.temples++; }
          else if (roll < 0.94 && v.level >= 2) { world.struct[i] = S.TOWER; }
          world.structHp[i] = 100; W.markTile(world, i); world.dirtyMini = true;
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
        const d = W.wdist(sim.world, v.x, v.y, o.x, o.y);
        if (d < v.radius + o.radius + 6 && d < rd) { rd = d; rival = o; }
      }
      if (rival && (v.race === 'orc' || rival.race === 'orc' || v.prosperity < 0.35 || sim.rng() < 0.2)) {
        if (v.rival !== rival.id) {
          v.rival = rival.id;
          if (sim.rng() < 0.3) logEvent(sim, `War! ${v.name} clashes with ${rival.name}.`, 'war');
        }
        // muster a raiding party: a few citizens march on the enemy
        if (v.pop >= 5 && sim.rng() < 0.5) {
          let sent = 0;
          for (const u of sim.units) {
            if (sent >= 3) break;
            if (u.dead || u.village !== v.id || u.age < u.adultAt || u.raidT > 0) continue;
            if (sim.rng() < 0.5) continue;
            u.raidT = 300;
            u.raidX = rival.x + (sim.rng() * 4 - 2);
            u.raidY = rival.y + (sim.rng() * 4 - 2);
            sent++;
          }
        }
      } else v.rival = -1;
    }
  }

  // ---- Global recount & cleanup ---------------------------------------
  function recount(sim) {
    for (const k in RACES) sim.counts[k] = 0;
    for (const k in sim.counts) sim.counts[k] = 0;
    sim.vmap = new Map();
    for (const v of sim.villages) { v.pop = 0; sim.vmap.set(v.id, v); }
    for (const u of sim.units) {
      if (u.dead) continue;
      sim.counts[u.race] = (sim.counts[u.race] || 0) + 1;
      if (u.village >= 0) { const v = villageById(sim, u.village); if (v) v.pop++; else u.village = -1; }
    }
  }

  // ---- Main step -------------------------------------------------------
  function step(sim, dt) {
    sim.tick++;
    sim.season = Math.floor((sim.tick % 480) / 120); // 4 seasons per ~year
    // night falls when the day-cycle cosine dips (matches the renderer)
    sim.isNight = Math.cos(((sim.tick % 480) / 480) * 6.283) * 0.5 + 0.15 > 0.3;
    if (sim.bloodMoonT > 0) sim.bloodMoonT--;
    buildGrid(sim);

    // units
    for (let i = 0; i < sim.units.length; i++) {
      const u = sim.units[i];
      if (u.dead) continue;
      updateUnit(sim, u, dt);
    }

    // process raises (undead rising, vampire spawn)
    if (sim._raise && sim._raise.length) {
      for (const r of sim._raise) {
        const u = spawnUnit(sim, r.as || 'undead', r.x, r.y);
        if (u && PD.FX) PD.FX.puff(r.x, r.y, r.as === 'vampire' ? '#5a1030' : '#6a2a6a');
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

    // society layer: nations, religion, tech, prayers, history, heroes
    if (PD.Society) PD.Society.step(sim);
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
      for (const vv of sim.villages) { if (W.wdist(world, vv.x, vv.y, u.x, u.y) < 12) { near = true; break; } }
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
          W.markTile(world, i);
        }
      }
    }
    world.dirtyMini = true;
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
    // rare monsters keep the world dangerous (heroes need something to slay)
    if (world.mode === 'normal' || !world.mode) {
      const roll = sim.rng();
      if ((sim.counts.troll || 0) < 3 && roll < 0.12) {
        const s = W.nearestLand(world, (sim.rng() * world.W) | 0, (sim.rng() * world.H) | 0, 10);
        if (s) { spawnUnit(sim, 'troll', s.x, s.y); }
      } else if ((sim.counts.werewolf || 0) < 4 && roll < 0.2) {
        const s = W.nearestLand(world, (sim.rng() * world.W) | 0, (sim.rng() * world.H) | 0, 10);
        if (s) spawnUnit(sim, 'werewolf', s.x, s.y);
      } else if ((sim.counts.dragon || 0) < 1 && roll < 0.03 && sim.tick > 2000) {
        const s = W.nearestLand(world, (sim.rng() * world.W) | 0, (sim.rng() * world.H) | 0, 10);
        if (s) { spawnUnit(sim, 'dragon', s.x, s.y); logEvent(sim, 'A DRAGON has awoken! The skies burn.', 'war'); }
      }
    }
  }

  // A unit under a village's Divine Shield cannot be harmed
  function shielded(sim, u) {
    if (u.village < 0) return false;
    const v = villageById(sim, u.village);
    return !!(v && v.shieldT > 0);
  }

  // ---- Area effects invoked by divine powers --------------------------
  function damageArea(sim, cx, cy, radius, dmg, byRace) {
    forNeighbors(sim, cx, cy, radius + 1, (u) => {
      if (W.wdist(sim.world, u.x, u.y, cx, cy) <= radius && !shielded(sim, u)) {
        u.hp -= dmg;
        if (u.hp <= 0) killUnit(sim, u, byRace);
      }
    });
  }
  function blessArea(sim, cx, cy, radius) {
    forNeighbors(sim, cx, cy, radius + 1, (u) => {
      if (W.wdist(sim.world, u.x, u.y, cx, cy) <= radius) {
        u.hp = u.maxHp; u.food = 1; u.sick = 0;
      }
    });
  }
  function infectArea(sim, cx, cy, radius) {
    forNeighbors(sim, cx, cy, radius + 1, (u) => {
      if (!RACES[u.race].monster && W.wdist(sim.world, u.x, u.y, cx, cy) <= radius) u.sick = 1;
    });
  }

  global.PD.Sim = {
    RACES, SENTIENT, hostile, createSim, spawnUnit, foundVillage,
    step, recount, villageById, logEvent, killUnit,
    damageArea, blessArea, infectArea, buildGrid, forNeighbors,
    villageName, personName, TRAITS, PROFESSIONS, walkable, shielded
  };
})(window);
