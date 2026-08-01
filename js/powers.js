/* =========================================================================
   PIXEL DEITY — powers.js
   The god's toolbox. Each power defines cost, brush, and an apply() that
   mutates the world / simulation and spawns juicy FX.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;
  const Sim = PD.Sim;
  const FX = PD.FX;
  const B = W.B;

  // helper to play sound
  function snd(n) { if (PD.Audio8) PD.Audio8.sfx(n); }

  // Each power: apply(G, wx, wy) -> returns faith cost actually spent (0 if noop/free)
  const POWERS = [
    // ---- Observe ----
    { id: 'inspect', name: 'Inspect', icon: '🔍', cat: 'god', cost: 0, radius: 0, cont: false, pan: true,
      color: 'rgba(255,255,255,0.8)',
      desc: 'Click a creature or town to inspect it. Drag to look around. The eye of the divine sees all.',
      apply(G, wx, wy) { G.selectAt(wx, wy); return 0; } },
    { id: 'pan', name: 'Move Map', icon: '✋', cat: 'god', cost: 0, radius: 0, cont: false, pan: true,
      color: 'rgba(255,255,255,0.6)',
      desc: 'Drag to pan across your world. Scroll or pinch to zoom.',
      apply(G, wx, wy) { return 0; } },

    // ---- Create life ----
    { id: 'spawn_human', name: 'Humans', icon: '🧑', cat: 'life', cost: 8, radius: 2, cont: true,
      color: 'rgba(242,195,154,0.9)', race: 'human',
      desc: 'Breathe life into Humankind — adaptable settlers who build sprawling towns.',
      apply(G, wx, wy) { return spawnRace(G, 'human', wx, wy, this.cost); } },
    { id: 'spawn_elf', name: 'Elves', icon: '🧝', cat: 'life', cost: 10, radius: 2, cont: true,
      color: 'rgba(191,233,160,0.9)', race: 'elf',
      desc: 'Awaken the long-lived Elves, keepers of the deep forests.',
      apply(G, wx, wy) { return spawnRace(G, 'elf', wx, wy, this.cost); } },
    { id: 'spawn_orc', name: 'Orcs', icon: '👹', cat: 'life', cost: 9, radius: 2, cont: true,
      color: 'rgba(143,191,106,0.9)', race: 'orc',
      desc: 'Loose the Orcs — brutal, fast-breeding raiders who covet every land.',
      apply(G, wx, wy) { return spawnRace(G, 'orc', wx, wy, this.cost); } },
    { id: 'spawn_dwarf', name: 'Dwarves', icon: '🧔', cat: 'life', cost: 11, radius: 2, cont: true,
      color: 'rgba(224,168,106,0.9)', race: 'dwarf',
      desc: 'Carve the stout Dwarves from the mountains — hardy and enduring.',
      apply(G, wx, wy) { return spawnRace(G, 'dwarf', wx, wy, this.cost); } },
    { id: 'spawn_critter', name: 'Critters', icon: '🐇', cat: 'life', cost: 2, radius: 2, cont: true,
      color: 'rgba(230,216,176,0.9)', race: 'critter',
      desc: 'Scatter little critters across the grass. Prey for the food chain.',
      apply(G, wx, wy) { return spawnRace(G, 'critter', wx, wy, this.cost); } },
    { id: 'spawn_wolf', name: 'Wolves', icon: '🐺', cat: 'life', cost: 4, radius: 2, cont: true,
      color: 'rgba(154,160,168,0.9)', race: 'wolf',
      desc: 'Release wolves to stalk the wild. Predators keep the balance.',
      apply(G, wx, wy) { return spawnRace(G, 'wolf', wx, wy, this.cost); } },
    { id: 'found', name: 'Settlement', icon: '🏰', cat: 'life', cost: 45, radius: 0, cont: false,
      color: 'rgba(255,220,120,0.9)',
      desc: 'Found an instant settlement of your last-chosen people, ready to grow.',
      apply(G, wx, wy) {
        const race = G.lastRace || 'human';
        if (G.faith < this.cost) { snd('error'); return 0; }
        const v = Sim.foundVillage(G.sim, race, Math.floor(wx), Math.floor(wy));
        if (!v) { snd('error'); return 0; }
        FX.shock(v.x + 0.5, v.y + 0.5, 6, '#ffe066'); snd('levelup');
        return this.cost;
      } },

    // ---- Terraform ----
    { id: 'raise', name: 'Raise Land', icon: '⛰️', cat: 'terra', cost: 3, radius: 3, cont: true,
      color: 'rgba(150,110,70,0.9)',
      desc: 'Lift the earth from the sea. Raise mountains and forge new continents.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.raise(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, 0.06);
        G.world.dirtyMini = true; snd('terra'); return this.cost;
      } },
    { id: 'lower', name: 'Lower Land', icon: '🌊', cat: 'terra', cost: 3, radius: 3, cont: true,
      color: 'rgba(60,130,190,0.9)',
      desc: 'Sink the land beneath the waves. Carve seas, lakes and rivers.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.raise(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, -0.06);
        G.world.dirtyMini = true; snd('terra'); return this.cost;
      } },
    { id: 'forest', name: 'Grow Forest', icon: '🌲', cat: 'terra', cost: 2, radius: 3, cont: true,
      color: 'rgba(47,115,51,0.9)',
      desc: 'Cover the land in verdant woodland, rich with life and fertility.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.paintBiome(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, B.FOREST, 0.7, 2);
        G.world.dirtyMini = true; snd('terra'); return this.cost;
      } },
    { id: 'grass', name: 'Grow Grass', icon: '🌱', cat: 'terra', cost: 2, radius: 3, cont: true,
      color: 'rgba(90,160,60,0.9)',
      desc: 'Spread fertile grassland, ideal for farms and grazing herds.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.paintBiome(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, B.GRASS, 0.6, 0);
        G.world.dirtyMini = true; snd('terra'); return this.cost;
      } },
    { id: 'desert', name: 'Desertify', icon: '🏜️', cat: 'terra', cost: 2, radius: 3, cont: true,
      color: 'rgba(220,180,90,0.9)',
      desc: 'Bake the land into barren desert. Little grows in the burning sands.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.paintBiome(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, B.DESERT, 0.04, 0);
        G.world.dirtyMini = true; snd('terra'); return this.cost;
      } },
    { id: 'mountain', name: 'Raise Peaks', icon: '🗻', cat: 'terra', cost: 4, radius: 2, cont: true,
      color: 'rgba(125,127,136,0.9)',
      desc: 'Thrust jagged rock into the sky — the cradle of the Dwarves.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.raise(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, 0.12);
        W.paintBiome(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, B.ROCK, 0.05, 0);
        G.world.dirtyMini = true; snd('terra'); return this.cost;
      } },

    // ---- Blessings ----
    { id: 'bless', name: 'Bless', icon: '✨', cat: 'bless', cost: 6, radius: 4, cont: true,
      color: 'rgba(255,240,160,0.95)',
      desc: 'Heal and nourish all creatures in the light. The faithful are restored.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        Sim.blessArea(G.sim, wx, wy, G.power.radius);
        for (let i = 0; i < 10; i++) FX.spawn(wx + (Math.random() - 0.5) * G.power.radius * 2, wy + (Math.random() - 0.5) * G.power.radius * 2, 0, -0.05, 26, '#fff2a0', 2, -0.002);
        FX.shock(wx, wy, G.power.radius, '#fff2a0'); snd('bless'); return this.cost;
      } },
    { id: 'rain', name: 'Rain', icon: '🌧️', cat: 'bless', cost: 4, radius: 6, cont: true,
      color: 'rgba(120,170,220,0.9)',
      desc: 'Summon rain to douse flames and enrich the soil.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.extinguish(G.world, Math.floor(wx), Math.floor(wy), G.power.radius);
        G.setWeather('rain', 240);
        for (let i = 0; i < 12; i++) FX.spawn(wx + (Math.random() - 0.5) * G.power.radius * 2, wy - G.power.radius, 0.05, 0.25, 20, '#9ac0f0', 1, 0.004);
        G.world.dirtyMini = true; snd('rain'); return this.cost;
      } },

    // ---- Wrath ----
    { id: 'lightning', name: 'Lightning', icon: '⚡', cat: 'wrath', cost: 12, radius: 2, cont: false,
      color: 'rgba(200,230,255,0.95)',
      desc: 'Hurl a bolt of divine lightning. Smites the living, ignites the land.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        FX.bolt(wx, wy - 30, wx, wy);
        FX.lightning(wx, wy); FX.shock(wx, wy, 3, '#cfe8ff');
        Sim.damageArea(G.sim, wx, wy, this.radius + 0.5, 40, null);
        if (Math.random() < 0.6) W.ignite(G.world, Math.floor(wx), Math.floor(wy), 1);
        G.flash = 0.5; snd('lightning'); return this.cost;
      } },
    { id: 'fire', name: 'Ignite', icon: '🔥', cat: 'wrath', cost: 5, radius: 2, cont: true,
      color: 'rgba(255,120,40,0.95)',
      desc: 'Set the world ablaze. Fire spreads through forest and field.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.ignite(G.world, Math.floor(wx), Math.floor(wy), G.power.radius);
        FX.fireBurst(wx, wy); snd('fire'); return this.cost;
      } },
    { id: 'meteor', name: 'Meteor', icon: '☄️', cat: 'wrath', cost: 30, radius: 4, cont: false,
      color: 'rgba(255,140,40,0.95)',
      desc: 'Call down a blazing meteor. It craters the earth and scorches all near.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        FX.explosion(wx, wy, true); FX.shock(wx, wy, this.radius + 2, '#ffb060');
        W.raise(G.world, Math.floor(wx), Math.floor(wy), this.radius, -0.1);
        W.paintBiome(G.world, Math.floor(wx), Math.floor(wy), Math.max(1, this.radius - 2), B.ASH, 0.05, 0);
        W.ignite(G.world, Math.floor(wx), Math.floor(wy), this.radius);
        Sim.damageArea(G.sim, wx, wy, this.radius + 1, 100, null);
        G.world.dirtyMini = true; G.flash = 0.7; G.shake = 12; snd('meteor'); return this.cost;
      } },
    { id: 'plague', name: 'Plague', icon: '🦠', cat: 'wrath', cost: 15, radius: 4, cont: false,
      color: 'rgba(120,220,80,0.9)',
      desc: 'Unleash a creeping plague that spreads from soul to soul.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        Sim.infectArea(G.sim, wx, wy, this.radius);
        for (let i = 0; i < 12; i++) FX.spawn(wx + (Math.random() - 0.5) * this.radius * 2, wy + (Math.random() - 0.5) * this.radius * 2, 0, -0.02, 30, '#78dc50', 2);
        snd('plague'); return this.cost;
      } },
    { id: 'quake', name: 'Earthquake', icon: '🌋', cat: 'wrath', cost: 22, radius: 6, cont: false,
      color: 'rgba(180,120,60,0.9)',
      desc: 'Rend the ground. Buildings crumble and the earth swallows the unlucky.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        // damage structures in radius
        const world = G.world, R = this.radius;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const x = Math.floor(wx) + dx, y = Math.floor(wy) + dy;
          if (!W.inBounds(world, x, y) || dx * dx + dy * dy > R * R) continue;
          const i = W.idx(world, x, y);
          if (world.struct[i] && Math.random() < 0.5) { world.struct[i] = W.S.RUIN; world.owner[i] = -1; W.markTile(world, i); }
        }
        Sim.damageArea(G.sim, wx, wy, R, 55, null);
        FX.shock(wx, wy, R, '#c8a060'); FX.shock(wx, wy, R * 0.6, '#e0c080');
        G.world.dirtyMini = true; G.shake = 20; snd('quake'); return this.cost;
      } },
    { id: 'freeze', name: 'Freeze', icon: '❄️', cat: 'wrath', cost: 10, radius: 5, cont: true,
      color: 'rgba(190,220,255,0.9)',
      desc: 'Cast a deep frost, turning the land to snow and chilling the weather.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.paintBiome(G.world, Math.floor(wx), Math.floor(wy), G.power.radius, B.SNOW, 0.08, 0);
        W.extinguish(G.world, Math.floor(wx), Math.floor(wy), G.power.radius);
        G.setWeather('snow', 240);
        G.world.dirtyMini = true; snd('rain'); return this.cost;
      } },
    { id: 'raise_dead', name: 'Raise Dead', icon: '💀', cat: 'wrath', cost: 14, radius: 2, cont: true,
      color: 'rgba(183,199,201,0.9)',
      desc: 'Tear the veil and raise the Undead — a plague of hungering corpses.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        for (let i = 0; i < 4; i++) {
          const s = W.nearestLand(G.world, wx + (Math.random() * 4 - 2), wy + (Math.random() * 4 - 2), 6);
          if (s) { Sim.spawnUnit(G.sim, 'undead', s.x, s.y); FX.puff(s.x, s.y, '#6a2a6a'); n++; }
        }
        if (!n) { snd('error'); return 0; }
        snd('plague'); return this.cost;
      } },

    // ---- Godhead: powers of the One True God ----
    { id: 'voice', name: 'Divine Voice', icon: '🗣️', cat: 'godhead', cost: 5, radius: 0, cont: false,
      color: 'rgba(255,240,200,0.95)',
      desc: 'Speak into a mortal mind. They are changed by hearing you — and may spread the word.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const u = nearestUnit(G, wx, wy, 2.5);
        if (!u) { snd('error'); return 0; }
        u.karma += 5;
        const R = Sim.RACES[u.race];
        if (PD.Society) {
          PD.Society.hist(G.sim, `You spoke to ${u.name}. They fell to their knees.`, 'faith');
          if (R.sentient && Math.random() < 0.3) {
            PD.Society.hist(G.sim, `${u.name} now preaches of the Voice they heard.`, 'faith');
            u.prof = 3; // priest
          }
        }
        FX.shock(u.x, u.y, 2, '#fff2a0'); snd('bless'); return this.cost;
      } },
    { id: 'empower', name: 'Empower Hero', icon: '🦸', cat: 'godhead', cost: 60, radius: 0, cont: false,
      color: 'rgba(255,220,80,0.95)',
      desc: 'Fill a mortal with divine might. They become a Paragon — a hero of legend who hunts monsters.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const u = nearestUnit(G, wx, wy, 2.5);
        if (!u || !Sim.RACES[u.race].sentient) { snd('error'); return 0; }
        PD.Society.empower(G.sim, u, 1);
        snd('levelup'); return this.cost;
      } },
    { id: 'miracle', name: 'Miracle', icon: '🌟', cat: 'godhead', cost: 25, radius: 6, cont: false,
      color: 'rgba(255,250,220,0.95)',
      desc: 'A great working: the sick healed, the hungry fed, the fields made fertile, the dying saved.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        Sim.blessArea(G.sim, wx, wy, this.radius);
        const world = G.world, R = this.radius;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = Math.floor(wx) + dx, y = Math.floor(wy) + dy;
          if (!W.inBounds(world, x, y)) continue;
          const i = W.idx(world, x, y);
          if (W.isLand(world.biome[i])) world.fert[i] = PD.clamp(world.fert[i] + 0.2, 0, 1);
          world.fire[i] = 0;
        }
        for (const v of G.sim.villages) {
          if (W.wdist(world, v.x, v.y, wx, wy) < R + 3) v.food += 40;
        }
        if (PD.Society) { PD.Society.hist(G.sim, 'A miracle. The people will tell of this for generations.', 'faith'); PD.Society.reactToMiracle(G.sim, 'bless'); }
        FX.shock(wx, wy, R, '#fff8d0'); FX.shock(wx, wy, R * 0.5, '#ffe680'); snd('levelup'); return this.cost;
      } },
    { id: 'stabilize', name: 'Calm the Core', icon: '🌍', cat: 'godhead', cost: 200, radius: 0, cont: false,
      color: 'rgba(120,220,160,0.95)',
      desc: 'Reach into a doomed planet and still its dying heart. Costly — but a whole world lives.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const p = PD.Cosmos.active();
        if (!p || p.meta.doom == null) { snd('error'); return 0; }
        PD.Cosmos.stabilize(p);
        FX.shock(wx, wy, 12, '#78dca0'); snd('levelup'); return this.cost;
      } },
    { id: 'evolve', name: 'Guide Evolution', icon: '🧬', cat: 'godhead', cost: 30, radius: 0, cont: false,
      color: 'rgba(140,220,200,0.95)',
      desc: 'On a primordial world: nudge the soup toward sapience. You created evolution, after all.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const p = PD.Cosmos.active();
        if (!p || p.meta.evo == null) { snd('error'); return 0; }
        PD.Cosmos.advanceEvolution(p);
        FX.shock(wx, wy, 8, '#8cdcc8'); snd('levelup'); return this.cost;
      } },

    // ---- Dominion: political meddling ----
    { id: 'crown', name: 'Install Leader', icon: '👑', cat: 'politic', cost: 20, radius: 0, cont: false,
      color: 'rgba(240,208,64,0.95)',
      desc: 'Depose a nation\'s leader and raise a devout soul in their place.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const n = nationAt(G, wx, wy);
        if (!n) { snd('error'); return 0; }
        const old = n.leaderName;
        n.leaderName = Sim.personName(n.race, G.sim.rng);
        n.leaderTrait = 'devout';
        PD.Society.hist(G.sim, `By divine decree, ${old} falls. ${n.leaderName} the devout now leads ${n.name}.`, 'politics');
        snd('levelup'); return this.cost;
      } },
    { id: 'peace', name: 'Force Peace', icon: '🕊️', cat: 'politic', cost: 30, radius: 0, cont: false,
      color: 'rgba(200,230,255,0.95)',
      desc: 'End every war a nation is waging. Swords into ploughshares — whether they like it or not.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const n = nationAt(G, wx, wy);
        if (!n) { snd('error'); return 0; }
        const soc = PD.Society.ensure(G.sim);
        for (const m of soc.nations) {
          m.warWith = m.warWith.filter(id => id !== n.id);
          if (n.relations[m.id] != null) n.relations[m.id] = Math.max(n.relations[m.id], 10);
        }
        n.warWith = [];
        for (const vid of n.villages) { const v = Sim.villageById(G.sim, vid); if (v) v.rival = -1; }
        PD.Society.hist(G.sim, `A stillness falls over ${n.name}'s armies. The war is simply… over.`, 'politics');
        snd('bless'); return this.cost;
      } },
    { id: 'incite', name: 'Incite War', icon: '⚔️', cat: 'politic', cost: 25, radius: 0, cont: false,
      color: 'rgba(224,80,58,0.95)',
      desc: 'Whisper grievances into a nation\'s ear. They will find an enemy.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const n = nationAt(G, wx, wy);
        const soc = PD.Society.ensure(G.sim);
        if (!n || soc.nations.length < 2) { snd('error'); return 0; }
        let foe = null, fd = 1e9;
        for (const m of soc.nations) {
          if (m.id === n.id || n.warWith.indexOf(m.id) >= 0) continue;
          const d = Math.abs(m.id - n.id);
          if (d < fd) { fd = d; foe = m; }
        }
        if (!foe) { snd('error'); return 0; }
        n.relations[foe.id] = -100; foe.relations[n.id] = -100;
        n.warWith.push(foe.id); foe.warWith.push(n.id);
        PD.Society.hist(G.sim, `WAR! Whipped to fury by whispers, ${n.name} marches on ${foe.name}.`, 'war');
        snd('war'); return this.cost;
      } },
    { id: 'revolt', name: 'Revolution', icon: '🔥', cat: 'politic', cost: 25, radius: 0, cont: false,
      color: 'rgba(255,140,60,0.95)',
      desc: 'Overturn a nation\'s government. Monarchy, republic, theocracy — spin the wheel of history.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const n = nationAt(G, wx, wy);
        if (!n) { snd('error'); return 0; }
        n.gov = (n.gov + 1 + (Math.random() * 2 | 0)) % PD.Society.GOVERNMENTS.length;
        n.leaderName = Sim.personName(n.race, G.sim.rng);
        PD.Society.hist(G.sim, `REVOLUTION in ${n.name}! It is now a ${PD.Society.GOVERNMENTS[n.gov]} under ${n.leaderName}.`, 'politics');
        snd('war'); return this.cost;
      } },

    // ---- Testament: biblical workings ----
    { id: 'flood', name: 'Great Flood', icon: '🌊', cat: 'bible', cost: 120, radius: 0, cont: false,
      color: 'rgba(60,120,220,0.95)',
      desc: 'Drown the world for its wickedness. The waters rise for a season — the righteous are spared.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        if (G.floodT > 0) { snd('error'); return 0; }
        G.startFlood();
        snd('quake'); return this.cost;
      } },
    { id: 'plagues', name: 'Ten Plagues', icon: '🐸', cat: 'bible', cost: 60, radius: 8, cont: false,
      color: 'rgba(150,200,80,0.95)',
      desc: 'Visit a full suite of plagues on a land: pestilence, blight, darkness, and worse.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const R = this.radius, world = G.world;
        Sim.infectArea(G.sim, wx, wy, R);
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = Math.floor(wx) + dx, y = Math.floor(wy) + dy;
          if (!W.inBounds(world, x, y)) continue;
          const i = W.idx(world, x, y);
          world.fert[i] = Math.max(0, world.fert[i] - 0.3); // locusts
          W.markTile(world, i);
        }
        for (const v of G.sim.villages) {
          if (W.wdist(world, v.x, v.y, wx, wy) < R + 3) { v.food = Math.max(0, v.food - 80); }
        }
        if (PD.Society) { PD.Society.hist(G.sim, 'Plagues upon plagues. The land groans under judgement.', 'war'); PD.Society.reactToMiracle(G.sim, 'plague'); }
        FX.shock(wx, wy, R, '#96c850'); snd('plague'); return this.cost;
      } },
    { id: 'prophet', name: 'Anoint Prophet', icon: '📜', cat: 'bible', cost: 30, radius: 0, cont: false,
      color: 'rgba(230,210,160,0.95)',
      desc: 'Choose a mortal to carry your word. Faith spreads in their footsteps.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const u = nearestUnit(G, wx, wy, 2.5);
        if (!u || !Sim.RACES[u.race].sentient) { snd('error'); return 0; }
        const soc = PD.Society.ensure(G.sim);
        let f = soc.faiths[0];
        if (!f) {
          f = { id: 1, name: 'The Word of the One', race: u.race, followers: 0, fervor: 0.8, prophetName: u.name, commandments: 0 };
          soc.faiths.push(f);
        } else { f.prophetName = u.name; f.fervor = PD.clamp(f.fervor + 0.3, 0, 1); }
        u.karma += 10; u.prof = 3;
        const n = u.village >= 0 ? PD.Society.nationOf(G.sim, u.village) : null;
        if (n) n.faithId = f.id;
        PD.Society.hist(G.sim, `${u.name} is anointed Prophet of the ${f.name}. Their eyes burn with purpose.`, 'faith');
        FX.shock(u.x, u.y, 3, '#e6d2a0'); snd('bless'); return this.cost;
      } },
    { id: 'commandments', name: 'Commandments', icon: '🪨', cat: 'bible', cost: 50, radius: 0, cont: false,
      color: 'rgba(200,200,210,0.95)',
      desc: 'Hand down the law on tablets of stone. Every faith remembers — and tithes.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const soc = PD.Society.ensure(G.sim);
        if (!soc.faiths.length) { snd('error'); return 0; }
        for (const f of soc.faiths) { f.commandments++; f.fervor = PD.clamp(f.fervor + 0.15, 0, 1); }
        PD.Society.hist(G.sim, 'Stone tablets descend from the sky. The law is written. Faith income rises.', 'faith');
        FX.shock(wx, wy, 5, '#c8c8d2'); snd('levelup'); return this.cost;
      } },
    { id: 'babel', name: 'Confusion', icon: '🗼', cat: 'bible', cost: 40, radius: 0, cont: false,
      color: 'rgba(210,170,120,0.95)',
      desc: 'They grew proud. Scatter a nation into squabbling successor states, each speaking differently.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const n = nationAt(G, wx, wy);
        if (!n || n.villages.length < 2) { snd('error'); return 0; }
        const soc = PD.Society.ensure(G.sim);
        const kept = n.villages.slice(0, 1);
        const scattered = n.villages.slice(1);
        n.villages = kept;
        for (const vid of scattered) {
          const v = Sim.villageById(G.sim, vid);
          if (!v) continue;
          soc.nations.push({
            id: soc.nextNationId++, name: Sim.villageName(v.race, G.sim.rng) + ' Splinter', race: v.race,
            gov: 0, leaderName: Sim.personName(v.race, G.sim.rng), leaderTrait: 'proud',
            villages: [vid], era: Math.max(0, n.era - 1), science: 0, relations: {}, warWith: [], revolCd: 300, faithId: -1
          });
        }
        PD.Society.hist(G.sim, `${n.name} wakes speaking many tongues. The nation shatters into ${scattered.length + 1} peoples.`, 'politics');
        snd('quake'); return this.cost;
      } },

    // ---- Tempest: weather mastery ----
    { id: 'storm', name: 'Thunderstorm', icon: '⛈️', cat: 'wrath', cost: 15, radius: 8, cont: false,
      color: 'rgba(140,160,220,0.95)',
      desc: 'Roll a storm over the land: rain, wind, and wandering bolts of lightning.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        G.setWeather('rain', 400);
        G.storm = { x: wx, y: wy, r: this.radius, t: 200 };
        snd('lightning'); return this.cost;
      } },
    { id: 'tornado', name: 'Tornado', icon: '🌪️', cat: 'wrath', cost: 35, radius: 2, cont: false,
      color: 'rgba(180,190,200,0.95)',
      desc: 'Spin up a wandering vortex that chews through everything in its path.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        G.tornado = { x: wx, y: wy, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.2, t: 350 };
        snd('quake'); return this.cost;
      } }
  ];

  // helpers for targeted powers
  function nearestUnit(G, wx, wy, r) {
    let best = null, bd = r;
    for (const u of G.sim.units) {
      if (u.dead) continue;
      const d = W.wdist(G.world, u.x + 0.5, u.y + 0.5, wx, wy);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  function nationAt(G, wx, wy) {
    if (!PD.Society) return null;
    const ix = Math.floor(wx), iy = Math.floor(wy);
    if (!W.inBounds(G.world, ix, iy)) return null;
    const o = G.world.owner[W.idx(G.world, ix, iy)];
    if (o >= 0) { const n = PD.Society.nationOf(G.sim, o); if (n) return n; }
    // fall back to nearest village's nation
    let bv = null, bd = 10;
    for (const v of G.sim.villages) {
      const d = W.wdist(G.world, v.x, v.y, wx, wy);
      if (d < bd) { bd = d; bv = v; }
    }
    return bv ? PD.Society.nationOf(G.sim, bv.id) : null;
  }

  function spawnRace(G, race, wx, wy, cost) {
    if (G.faith < cost) { snd('error'); return 0; }
    const s = W.nearestLand(G.world, wx + (Math.random() * 2 - 1), wy + (Math.random() * 2 - 1), 8);
    if (!s) { snd('error'); return 0; }
    const u = Sim.spawnUnit(G.sim, race, s.x + (Math.random() - 0.5), s.y + (Math.random() - 0.5));
    if (!u) return 0;
    if (Sim.RACES[race].sentient) G.lastRace = race;
    FX.puff(s.x, s.y, Sim.RACES[race].col);
    snd('spawn');
    return cost;
  }

  const BY_ID = {};
  for (const p of POWERS) BY_ID[p.id] = p;

  const CATEGORIES = [
    { id: 'god', name: 'Divine' },
    { id: 'life', name: 'Life' },
    { id: 'terra', name: 'Terraform' },
    { id: 'bless', name: 'Blessings' },
    { id: 'wrath', name: 'Wrath' },
    { id: 'godhead', name: 'Godhead' },
    { id: 'politic', name: 'Dominion' },
    { id: 'bible', name: 'Testament' }
  ];

  global.PD.Powers = { POWERS, BY_ID, CATEGORIES };
})(window);
