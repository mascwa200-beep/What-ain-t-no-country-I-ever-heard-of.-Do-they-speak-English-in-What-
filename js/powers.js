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

  // What the Voice actually says when it speaks
  const VOICE_LINES = [
    'Be not afraid.', 'I have seen you.', 'Build here.', 'The waters will come — go higher.',
    'Your name is known to me.', 'Do not go east.', 'Feed them before you feed yourself.',
    'I am the one who made the sky.', 'Forgive them, and I will forgive you.',
    'What you buried, I saw.', 'Sing, and I will listen.', 'This land is a gift, not a right.',
    'The stars are older than your grief.', 'Live.'
  ];

  // helper to play sound
  //
  // Every act of god knows exactly where it landed — apply(G, wx, wy) — but
  // all 145 sound calls threw that away and played dead centre at full
  // volume. `at()` is set once by the dispatcher before a power runs, so a
  // meteor dropped on the far limb now arrives quiet, muffled and off to
  // the side, without touching a single call site.
  let sndAt = null;
  function soundAt(x, y, w, h) { sndAt = (x == null) ? null : [x, y, w, h]; }
  function snd(n) {
    if (!PD.Audio8) return;
    if (sndAt) PD.Audio8.sfx(n, sndAt[0], sndAt[1], sndAt[2], sndAt[3]);
    else PD.Audio8.sfx(n);
  }

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
    // Nine of the thirteen sentient peoples had no way into the world at all.
    // The intro card promises "breathe life into 16 peoples"; the toolbar
    // offered four, and the only other route was evolution stage 4 picking
    // one of thirteen at random, behind a Primordial planet and five
    // advances. Prices track hp/dmg/lifespan against the four that existed.
    { id: 'spawn_gnome', name: 'Gnomes', icon: '🍄', cat: 'life', cost: 12, radius: 2, cont: true,
      color: 'rgba(232,200,224,0.9)', race: 'gnome',
      desc: 'Wake the Gnomes — small, curious, and forever taking things apart. Their nations learn fastest.',
      apply(G, wx, wy) { return spawnRace(G, 'gnome', wx, wy, this.cost); } },
    { id: 'spawn_halfling', name: 'Halflings', icon: '🥧', cat: 'life', cost: 7, radius: 2, cont: true,
      color: 'rgba(240,216,168,0.9)', race: 'halfling',
      desc: 'Settle the Halflings in the soft country. They want nothing but a full larder, and they breed for it.',
      apply(G, wx, wy) { return spawnRace(G, 'halfling', wx, wy, this.cost); } },
    { id: 'spawn_goblin', name: 'Goblins', icon: '👺', cat: 'life', cost: 6, radius: 2, cont: true,
      color: 'rgba(168,200,96,0.9)', race: 'goblin',
      desc: 'Let the Goblins out of the swamp. Weak, short-lived, hostile to everything, and there are always more.',
      apply(G, wx, wy) { return spawnRace(G, 'goblin', wx, wy, this.cost); } },
    { id: 'spawn_tiefling', name: 'Tieflings', icon: '😈', cat: 'life', cost: 13, radius: 2, cont: true,
      color: 'rgba(216,138,122,0.9)', race: 'tiefling',
      desc: 'Call the Tieflings up out of the ash. Horned, hard to burn, and at home where nothing else will live.',
      apply(G, wx, wy) { return spawnRace(G, 'tiefling', wx, wy, this.cost); } },
    { id: 'spawn_dragonborn', name: 'Dragonborn', icon: '🐲', cat: 'life', cost: 18, radius: 2, cont: true,
      color: 'rgba(200,160,64,0.9)', race: 'dragonborn',
      desc: 'Raise the Dragonborn from the desert stone — few, slow to breed, and worth three of anyone in a fight.',
      apply(G, wx, wy) { return spawnRace(G, 'dragonborn', wx, wy, this.cost); } },
    { id: 'spawn_lizardfolk', name: 'Lizardfolk', icon: '🦎', cat: 'life', cost: 10, radius: 2, cont: true,
      color: 'rgba(122,176,96,0.9)', race: 'lizardfolk',
      desc: 'Stir the Lizardfolk in the wet heat. They thrive where the swamp defeats everyone else.',
      apply(G, wx, wy) { return spawnRace(G, 'lizardfolk', wx, wy, this.cost); } },
    { id: 'spawn_merfolk', name: 'Merfolk', icon: '🧜', cat: 'life', cost: 14, radius: 2, cont: true,
      color: 'rgba(122,200,216,0.9)', race: 'merfolk',
      desc: 'Give the sea a people. Merfolk cross water and shore alike — the only ones who can.',
      apply(G, wx, wy) { return spawnRace(G, 'merfolk', wx, wy, this.cost); } },
    { id: 'spawn_fairy', name: 'Fairies', icon: '🧚', cat: 'life', cost: 16, radius: 2, cont: true,
      color: 'rgba(240,200,248,0.9)', race: 'fairy',
      desc: 'Let there be Fairies — fragile, near-immortal, tending the hurt wherever they drift.',
      apply(G, wx, wy) { return spawnRace(G, 'fairy', wx, wy, this.cost); } },
    { id: 'spawn_giant', name: 'Giants', icon: '🗿', cat: 'life', cost: 26, radius: 2, cont: true,
      color: 'rgba(216,176,144,0.9)', race: 'giant',
      desc: 'Wake the Giants in the high cold. Almost nothing kills one, and almost nothing makes another.',
      apply(G, wx, wy) { return spawnRace(G, 'giant', wx, wy, this.cost); } },
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
    { id: 'bless', name: 'Bless', ach: 'blessings', icon: '✨', cat: 'bless', cost: 6, radius: 4, cont: true,
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
    { id: 'lightning', name: 'Lightning', ach: 'smites', react: 'lightning', icon: '⚡', cat: 'wrath', cost: 12, radius: 2, cont: false,
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
    { id: 'meteor', name: 'Meteor', ach: 'meteors', react: 'meteor', icon: '☄️', cat: 'wrath', cost: 30, radius: 4, cont: false,
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
    { id: 'plague', name: 'Plague', react: 'plague', icon: '🦠', cat: 'wrath', cost: 15, radius: 4, cont: false,
      color: 'rgba(120,220,80,0.9)',
      desc: 'Unleash a creeping plague that spreads from soul to soul.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        Sim.infectArea(G.sim, wx, wy, this.radius);
        for (let i = 0; i < 12; i++) FX.spawn(wx + (Math.random() - 0.5) * this.radius * 2, wy + (Math.random() - 0.5) * this.radius * 2, 0, -0.02, 30, '#78dc50', 2);
        snd('plague'); return this.cost;
      } },
    { id: 'quake', name: 'Earthquake', react: 'quake', icon: '🌋', cat: 'wrath', cost: 22, radius: 6, cont: false,
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
        const line = VOICE_LINES[(Math.random() * VOICE_LINES.length) | 0];
        if (PD.Society) {
          PD.Society.hist(G.sim, `You spoke to ${u.name}: “${line}” They fell to their knees.`, 'faith');
          if (R.sentient && Math.random() < 0.4) {
            PD.Society.hist(G.sim, `${u.name} repeats it to anyone who will listen: “${line}”`, 'faith');
            u.prof = 3; // priest
            PD.Society.post(G.sim, u.name, u.race, `ok so a VOICE just said "${line}" and i have never been more normal about anything`);
          }
        }
        FX.shock(u.x, u.y, 2, '#fff2a0'); snd('bless'); return this.cost;
      } },
    { id: 'empower', name: 'Empower Hero', ach: 'heroes', icon: '🦸', cat: 'godhead', cost: 60, radius: 0, cont: false,
      color: 'rgba(255,220,80,0.95)',
      desc: 'Fill a mortal with divine might. They become a Paragon — a hero of legend who hunts monsters.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const u = nearestUnit(G, wx, wy, 2.5);
        if (!u || !Sim.RACES[u.race].sentient) { snd('error'); return 0; }
        PD.Society.empower(G.sim, u, 1);
        snd('levelup'); return this.cost;
      } },
    { id: 'miracle', name: 'Miracle', ach: 'blessings', icon: '🌟', cat: 'godhead', cost: 25, radius: 6, cont: false,
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
    { id: 'flood', name: 'Great Flood', ach: 'floods', story: 'wrath', icon: '🌊', cat: 'bible', cost: 120, radius: 0, cont: false,
      color: 'rgba(60,120,220,0.95)',
      desc: 'Drown the world for its wickedness. The waters rise for a season — the righteous are spared.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        if (G.floodT > 0) { snd('error'); return 0; }
        G.startFlood();
        snd('quake'); return this.cost;
      } },
    { id: 'plagues', name: 'Ten Plagues', story: 'wrath', icon: '🐸', cat: 'bible', cost: 60, radius: 8, cont: false,
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
      } },
    { id: 'volcano', name: 'Volcano', icon: '🌋', cat: 'wrath', cost: 45, radius: 4, cont: false,
      color: 'rgba(220,74,16,0.95)',
      desc: 'Punch a mountain of fire through the crust. Lava, ash, and a very bad day.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const x = Math.floor(wx), y = Math.floor(wy), world = G.world;
        W.raise(world, x, y, 3, 0.5);
        W.paintBiome(world, x, y, 1, B.LAVA, 0, 0);
        W.paintBiome(world, x, y, 3, B.ASH, 0.05, 0);
        // lava splatters
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * 6.283, d = 2 + Math.random() * 4;
          const lx = Math.floor(x + Math.cos(a) * d), ly = Math.floor(y + Math.sin(a) * d);
          if (W.inBounds(world, lx, ly)) { W.paintBiome(world, lx, ly, 0, B.LAVA, 0, 0); W.ignite(world, lx, ly, 1); }
        }
        W.ignite(world, x, y, 4);
        Sim.damageArea(G.sim, wx, wy, 5, 70, null);
        FX.explosion(wx, wy, true); FX.shock(wx, wy, 6, '#e04a10');
        world.dirtyMini = true; world.dirtyGlobe = true;
        G.shake = 18; G.flash = 0.4;
        if (PD.Society) PD.Society.hist(G.sim, 'The ground births a volcano. The sky turns to cinders.', 'war');
        snd('meteor'); return this.cost;
      } },
    { id: 'spawn_kraken', name: 'Kraken', icon: '🐙', cat: 'life', cost: 40, radius: 2, cont: false,
      color: 'rgba(90,138,160,0.95)', race: 'kraken',
      desc: 'Wake something vast beneath the waves. The sea is yours; remind them.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const u = Sim.spawnUnit(G.sim, 'kraken', wx, wy);
        if (!u) { snd('error'); return 0; }
        FX.shock(wx, wy, 5, '#5a8aa0'); FX.puff(wx, wy, '#1a3a5a');
        if (PD.Society) PD.Society.hist(G.sim, 'THE KRAKEN WAKES at your command.', 'war');
        snd('quake'); return this.cost;
      } },

    // ---- Omnipotence: the overpowered end of the toolbox ----
    { id: 'midas', name: 'Midas Touch', icon: '👑', cat: 'omni', cost: 55, radius: 5, cont: false,
      color: 'rgba(240,208,64,0.95)',
      desc: 'Turn the land itself to gold. Absurd fertility; nearby towns feast for a generation.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        W.paintBiome(G.world, Math.floor(wx), Math.floor(wy), this.radius, B.GOLDMEAD, 1, 0);
        for (const v of G.sim.villages) if (W.wdist(G.world, v.x, v.y, wx, wy) < this.radius + 4) v.food += 150;
        FX.shock(wx, wy, this.radius, '#f0d040');
        G.world.dirtyMini = true; G.world.dirtyGlobe = true;
        snd('levelup'); return this.cost;
      } },
    { id: 'blackhole', name: 'Black Hole', icon: '🕳️', cat: 'omni', cost: 90, radius: 5, cont: false,
      color: 'rgba(120,80,200,0.95)',
      desc: 'Open a hungry singularity. Everything nearby is pulled in; the land itself is swallowed.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const R = this.radius, world = G.world;
        // drag every nearby creature into the maw
        Sim.forNeighbors(G.sim, wx, wy, R + 4, (u) => {
          const d = W.wdist(world, u.x, u.y, wx, wy);
          if (d < R + 4) {
            u.x = W.wrapX(world, u.x + W.wrapDX(world, u.x, wx) * 0.7);
            u.y = u.y + (wy - u.y) * 0.7;
            if (d < 2 && !Sim.shielded(G.sim, u)) { u.hp = -1; Sim.killUnit(G.sim, u, 'void'); }
          }
        });
        // the terrain collapses into deep void
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const x = Math.floor(wx) + dx, y = Math.floor(wy) + dy;
          if (!W.inBounds(world, x, y)) continue;
          const i = W.idx(world, x, y);
          world.elev[i] = Math.max(0, world.elev[i] - (1 - Math.sqrt(dx * dx + dy * dy) / R) * 0.5);
          W.reclassTile(world, x, y);
        }
        for (let k = 0; k < 30; k++) { const a = Math.random() * 6.283, d = 1 + Math.random() * R; FX.spawn(wx + Math.cos(a) * d, wy + Math.sin(a) * d, -Math.cos(a) * 0.2, -Math.sin(a) * 0.2, 24, '#7850c8', 2); }
        FX.shock(wx, wy, R, '#7850c8'); FX.shock(wx, wy, R * 0.5, '#2a1a4a');
        world.dirtyMini = true; world.dirtyGlobe = true; G.shake = 14;
        if (PD.Society) PD.Society.hist(G.sim, 'A hole opened in the world. It is not spoken of.', 'fall');
        snd('quake'); return this.cost;
      } },
    { id: 'host', name: 'Heaven\'s Host', icon: '👼', cat: 'omni', cost: 70, radius: 3, cont: false,
      color: 'rgba(248,240,208,0.95)',
      desc: 'Summon a host of angels to purge monsters and heal the faithful.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        for (let k = 0; k < 6; k++) {
          const u = Sim.spawnUnit(G.sim, 'angel', wx + (Math.random() - 0.5) * 4, wy + (Math.random() - 0.5) * 4);
          if (u) { u.lifespan = u.age + Sim.YEAR * 15; n++; FX.puff(u.x, u.y, '#f8f0d0'); }
        }
        if (!n) { snd('error'); return 0; }
        FX.shock(wx, wy, 5, '#fff8d0');
        if (PD.Society) PD.Society.hist(G.sim, 'The sky opens. A host of angels descends in terrible glory.', 'legend');
        snd('bless'); return this.cost;
      } },
    { id: 'legion', name: 'Hell\'s Legion', icon: '👿', cat: 'omni', cost: 70, radius: 3, cont: false,
      color: 'rgba(192,80,48,0.95)',
      desc: 'Tear a rift to the Ashen Hell and let a legion of demons through. What could go wrong.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        for (let k = 0; k < 6; k++) {
          const u = Sim.spawnUnit(G.sim, 'demon', wx + (Math.random() - 0.5) * 4, wy + (Math.random() - 0.5) * 4);
          if (u) { u.lifespan = u.age + Sim.YEAR * 15; n++; FX.puff(u.x, u.y, '#c05030'); }
        }
        if (!n) { snd('error'); return 0; }
        W.ignite(G.world, Math.floor(wx), Math.floor(wy), 2);
        FX.shock(wx, wy, 5, '#c05030');
        if (PD.Society) PD.Society.hist(G.sim, 'A rift screams open. Demons pour into the world.', 'war');
        snd('plague'); return this.cost;
      } },
    { id: 'armageddon', name: 'Armageddon', icon: '💥', cat: 'omni', cost: 250, radius: 0, cont: false,
      color: 'rgba(255,80,40,0.95)',
      desc: 'The sky falls. Meteors rain across the ENTIRE world for a full season. The end of days.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        if (G.armageddon > 0) { snd('error'); return 0; }
        G.armageddon = 240;
        if (PD.Society) { PD.Society.hist(G.sim, 'ARMAGEDDON. The heavens themselves fall upon the world.', 'fall'); PD.Society.reactToMiracle(G.sim, 'meteor'); }
        G.flash = 0.8; snd('meteor'); return this.cost;
      } },
    { id: 'zombify', name: 'Necropolis', icon: '🧟', cat: 'omni', cost: 80, radius: 7, cont: false,
      color: 'rgba(150,120,160,0.95)',
      desc: 'Every mortal in the circle dies and rises again. Instant undead apocalypse, locally sourced.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        Sim.forNeighbors(G.sim, wx, wy, this.radius, (u) => {
          const R = Sim.RACES[u.race];
          if (R.sentient && !Sim.shielded(G.sim, u)) { Sim.killUnit(G.sim, u, 'undead'); n++; }
        });
        FX.shock(wx, wy, this.radius, '#9678a0');
        if (n && PD.Society) PD.Society.hist(G.sim, `${n} souls fell and rose again in a single breath.`, 'fall');
        snd('plague'); return n ? this.cost : (snd('error'), 0);
      } },
    { id: 'polymorph', name: 'Polymorph', icon: '🐰', cat: 'omni', cost: 30, radius: 4, cont: false,
      color: 'rgba(230,216,176,0.95)',
      desc: 'Everyone in the circle is now a small fluffy critter. This solves most problems.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        Sim.forNeighbors(G.sim, wx, wy, this.radius, (u) => {
          const R = Sim.RACES[u.race];
          if (u.race !== 'critter' && !R.ghost && !Sim.shielded(G.sim, u)) {
            u.race = 'critter'; u.maxHp = Sim.RACES.critter.hp; u.hp = u.maxHp;
            u.paragon = 0; u.big = 0; u.village = -1; n++;
            FX.puff(u.x, u.y, '#e6d8b0');
          }
        });
        if (!n) { snd('error'); return 0; }
        if (PD.Society) PD.Society.hist(G.sim, `${n} souls are suddenly, profoundly, rabbits.`, 'event');
        snd('spawn'); return this.cost;
      } },
    { id: 'youth', name: 'Fountain of Youth', icon: '⛲', cat: 'omni', cost: 40, radius: 5, cont: false,
      color: 'rgba(140,220,240,0.95)',
      desc: 'Wind back every lifespan in the circle to its dawn. Death, postponed indefinitely.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        Sim.forNeighbors(G.sim, wx, wy, this.radius, (u) => {
          u.age = Math.min(u.age, u.adultAt + 5); u.hp = u.maxHp; u.sick = 0; n++;
        });
        if (!n) { snd('error'); return 0; }
        FX.shock(wx, wy, this.radius, '#8cdcf0');
        snd('bless'); return this.cost;
      } },
    { id: 'fertility', name: 'Fertility Rite', icon: '💞', cat: 'omni', cost: 35, radius: 5, cont: false,
      color: 'rgba(240,160,200,0.95)',
      desc: 'A baby boom, divinely mandated. Villages in the circle burst with newborns.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        for (const v of G.sim.villages) {
          if (W.wdist(G.world, v.x, v.y, wx, wy) > this.radius + 3) continue;
          for (let k = 0; k < 4; k++) {
            const u = Sim.spawnUnit(G.sim, v.race, v.x + (Math.random() - 0.5) * 2, v.y + (Math.random() - 0.5) * 2, { village: v.id });
            if (u) { n++; FX.spark(u.x, u.y, '#f0a0c8'); }
          }
          v.food += 20; // the god provides for the new mouths
        }
        if (!n) { snd('error'); return 0; }
        snd('levelup'); return this.cost;
      } },
    { id: 'rapture', name: 'Rapture', icon: '🌅', cat: 'omni', cost: 60, radius: 6, cont: false,
      color: 'rgba(255,240,180,0.95)',
      desc: 'Call the worthy home. Every good soul in the circle ascends bodily to Elysium.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let n = 0;
        Sim.forNeighbors(G.sim, wx, wy, this.radius, (u) => {
          const R = Sim.RACES[u.race];
          if (R.sentient && u.karma >= 2) {
            u.karma += 20; // guarantee the highest heaven
            Sim.killUnit(G.sim, u, 'rapture'); n++;
            for (let k = 0; k < 6; k++) FX.spawn(u.x, u.y, 0, -0.15 - Math.random() * 0.1, 30, '#fff2a0', 2);
          }
        });
        if (!n) { snd('error'); return 0; }
        FX.shock(wx, wy, this.radius, '#fff2a0');
        if (PD.Society) PD.Society.hist(G.sim, `${n} righteous souls rise bodily into the light. The rest watch, and wonder.`, 'faith');
        snd('levelup'); return this.cost;
      } },
    { id: 'aegis', name: 'Divine Aegis', icon: '🛡️', cat: 'omni', cost: 50, radius: 0, cont: false,
      color: 'rgba(255,230,128,0.95)',
      desc: 'Shield a town in unbreakable golden light. Nothing can harm its people for a long while.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let bv = null, bd = 10;
        for (const v of G.sim.villages) { const d = W.wdist(G.world, v.x, v.y, wx, wy); if (d < bd) { bd = d; bv = v; } }
        if (!bv) { snd('error'); return 0; }
        bv.shieldT = 900;
        FX.shock(bv.x, bv.y, bv.radius + 2, '#ffe680');
        if (PD.Society) PD.Society.hist(G.sim, `${bv.name} glows with divine aegis. Untouchable.`, 'faith');
        snd('bless'); return this.cost;
      } },
    { id: 'titan', name: 'Titanize', ach: 'heroes', icon: '🗽', cat: 'omni', cost: 100, radius: 0, cont: false,
      color: 'rgba(216,176,144,0.95)',
      desc: 'Swell a mortal into a walking colossus — a paragon grown to the size of a hill.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let best = null, bd = 3;
        for (const u of G.sim.units) {
          if (u.dead) continue;
          const d = W.wdist(G.world, u.x + 0.5, u.y + 0.5, wx, wy);
          if (d < bd && Sim.RACES[u.race].sentient) { bd = d; best = u; }
        }
        if (!best) { snd('error'); return 0; }
        PD.Society.empower(G.sim, best, 3);
        best.big = 2.2;
        best.maxHp *= 3; best.hp = best.maxHp;
        FX.shock(best.x, best.y, 6, '#d8b090'); G.shake = 10;
        if (PD.Society) PD.Society.hist(G.sim, `${best.name} GROWS. And grows. And grows. A titan walks the earth.`, 'legend');
        snd('quake'); return this.cost;
      } },

    // ---- Genesis: spoken over the face of the deep ----
    // These appear one at a time, only after time has been reversed past
    // the beginning. An empty world earns no faith, so creation is free.
    // Offered beside the first word, for as long as the void lasts: the way
    // back. Un-creation is the only act in the game with no other reverse.
    { id: 'gen_undo', name: 'Undo the Unmaking', icon: '↩️', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(150,210,255,1)', stage: 0,
      desc: 'Think better of it. The world returns exactly as it stood the moment before it began to come apart.',
      apply(G) { return typeof G.undoUnmaking === 'function' ? (G.undoUnmaking(), 0) : (snd('error'), 0); } },
    { id: 'gen_light', name: 'Let There Be Light', icon: '☀️', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(255,250,220,1)', stage: 0,
      desc: 'The first word. Stars kindle, a sun ignites, and the darkness upon the face of the deep is parted.',
      apply(G) { return typeof G.genesisStep === 'function' ? G.genesisStep(0) : (snd('error'), 0); } },
    { id: 'gen_firmament', name: 'Separate the Waters', icon: '🌫️', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(180,215,255,1)', stage: 1,
      desc: 'Divide the waters from the waters. Sky from sea; a firmament, and clouds within it.',
      apply(G) { return typeof G.genesisStep === 'function' ? G.genesisStep(1) : (snd('error'), 0); } },
    { id: 'gen_land', name: 'Let Dry Land Appear', icon: '🏔️', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(160,130,90,1)', stage: 2,
      desc: 'Let the waters be gathered, and dry land appear. Continents rise out of the deep.',
      apply(G) { return typeof G.genesisStep === 'function' ? G.genesisStep(2) : (snd('error'), 0); } },
    { id: 'gen_green', name: 'Bring Forth Grass', icon: '🌿', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(110,190,90,1)', stage: 3,
      desc: 'Let the earth bring forth grass, and the herb, and the fruit tree. Green floods the world.',
      apply(G) { return typeof G.genesisStep === 'function' ? G.genesisStep(3) : (snd('error'), 0); } },
    { id: 'gen_lights', name: 'Lights in the Firmament', icon: '🌗', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(255,235,180,1)', stage: 4,
      desc: 'Lights to divide the day from the night, for signs and for seasons. Time begins to flow.',
      apply(G) { return typeof G.genesisStep === 'function' ? G.genesisStep(4) : (snd('error'), 0); } },
    { id: 'gen_life', name: 'Bring Forth Life', icon: '🐾', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(230,200,150,1)', stage: 5,
      desc: 'Let the waters teem and the earth bring forth the living creature — and then, someone to name them.',
      apply(G) { return typeof G.genesisStep === 'function' ? G.genesisStep(5) : (snd('error'), 0); } },
    { id: 'gen_rest', name: 'Rest', icon: '🕊️', cat: 'genesis', cost: 0, radius: 0, cont: false,
      color: 'rgba(255,255,255,1)', stage: 6,
      desc: 'On the seventh day, rest — and see that it is good. The world is yours again.',
      apply(G) { return typeof G.genesisStep === 'function' ? G.genesisStep(6) : (snd('error'), 0); } },

    // ---- Godhead: the omnipotence tier ----
    { id: 'judgment', name: 'Judgment Day', icon: '⚖️', cat: 'godhead', cost: 180, radius: 0, cont: false,
      color: 'rgba(255,240,190,0.98)', story: 'wrath',
      desc: 'Weigh every soul at once. The righteous rise in pillars of light; the wicked are cast down. The world empties.',
      apply(G) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        let saved = 0, damned = 0;
        for (const u of G.sim.units) {
          if (u.dead) continue;
          const R = Sim.RACES[u.race];
          if (!R.sentient) continue;
          const good = u.karma >= 0;
          if (good) { u.karma += 12; saved++; for (let i = 0; i < 5; i++) FX.spawn(u.x, u.y, 0, -0.18, 34, '#fff2a0', 2); }
          else { u.karma -= 12; damned++; for (let i = 0; i < 5; i++) FX.spawn(u.x, u.y, 0, 0.14, 30, '#c04020', 2); }
          Sim.killUnit(G.sim, u, good ? 'rapture' : 'judgment');
        }
        if (!saved && !damned) { snd('error'); return 0; }
        if (PD.Society) PD.Society.hist(G.sim, `JUDGMENT. ${saved} raised into light, ${damned} cast down. The world falls silent.`, 'fall');
        G.flash = 1; G.shake = 14; snd('levelup');
        return this.cost;
      } },
    { id: 'omniscience', name: 'Omniscience', icon: '👁️', cat: 'godhead', cost: 40, radius: 0, cont: false,
      color: 'rgba(200,225,255,0.98)',
      desc: 'Know every name, every hidden heart, every nation’s true intent. Toggle the all-seeing eye.',
      apply(G) {
        if (!G.omniscient && G.faith < this.cost) { snd('error'); return 0; }
        G.omniscient = !G.omniscient;
        // the greater form's reach does not outlive the eye that carries it
        if (!G.omniscient) G.omniAll = false;
        if (PD.Society) PD.Society.hist(G.sim, G.omniscient ? 'The eye opens. Nothing is hidden.' : 'The eye closes.', 'faith');
        snd(G.omniscient ? 'bless' : 'click');
        return G.omniscient ? this.cost : 0;
      } },
    { id: 'unmake', name: 'Unmake From History', icon: '🕯️', cat: 'godhead', cost: 70, radius: 0, cont: false,
      color: 'rgba(150,130,180,0.98)',
      desc: 'Erase a soul so utterly they never were — struck from the chronicle, the legends, and the Beyond alike.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        const u = nearestUnit(G, wx, wy, 2.5);
        if (!u) { snd('error'); return 0; }
        const name = u.name;
        u.dead = true;
        // scrub every trace: chronicle, legends, feed, and the afterlife
        if (PD.Society) {
          const soc = PD.Society.ensure(G.sim);
          // Whole names only. Names are GIVEN+GIVEN2 concatenations, so a
          // plain indexOf made 'Ala' a match inside 'Alan' — erasing one soul
          // silently deleted the chronicle, legends and posts of every
          // stranger whose name happened to contain theirs.
          const re = new RegExp('(^|[^A-Za-z])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])');
          const strip = (arr, key) => { for (let i = arr.length - 1; i >= 0; i--) if (re.test(arr[i][key] || '')) arr.splice(i, 1); };
          strip(soc.history, 'text'); strip(soc.legends, 'deed'); strip(soc.feed, 'author'); strip(soc.feed, 'text');
        }
        if (PD.Afterlife) PD.Afterlife.erase && PD.Afterlife.erase(name);
        for (let i = 0; i < 12; i++) FX.spawn(u.x, u.y, (Math.random() - 0.5) * 0.1, -0.05, 30, '#9a86b4', 2);
        if (PD.Society) PD.Society.hist(G.sim, 'Someone is missing. No one can say who.', 'legend');
        snd('plague');
        return this.cost;
      } },
    { id: 'breath', name: 'Breath of Life', icon: '🌬️', cat: 'godhead', cost: 120, radius: 0, cont: false,
      color: 'rgba(190,255,220,0.98)', ach: 'resurrections',
      desc: 'Empty limbo. Every soul wandering the Grayfields is breathed back into living flesh.',
      apply(G, wx, wy) {
        if (G.faith < this.cost) { snd('error'); return 0; }
        if (!PD.Afterlife || !G.view || G.view.kind !== 'planet') { snd('error'); return 0; }
        const plane = PD.Afterlife.AL.planes['grayfields'];
        if (!plane || !plane.souls.length) { snd('error'); return 0; }
        const names = plane.souls.slice(0, 40).map(s => s.name);
        const back = [];
        for (const nm of names) {
          const spot = W.nearestLand(G.world, wx + (Math.random() * 8 - 4), wy + (Math.random() * 8 - 4), 12);
          if (!spot) continue;
          const u = PD.Afterlife.resurrect(nm, G.sim, spot.x, spot.y);
          if (u) back.push(u);
        }
        if (!back.length) { snd('error'); return 0; }
        FX.shock(wx, wy, 8, '#bfffdc');
        if (PD.Society) PD.Society.hist(G.sim, `${back.length} souls are breathed back out of limbo. The Grayfields thin.`, 'legend');
        snd('levelup');
        firstOfTheThirst(G, back);
        return this.cost;
      } },
    { id: 'sabbath', name: 'Sabbath', icon: '⏸️', cat: 'godhead', cost: 25, radius: 0, cont: false,
      color: 'rgba(220,220,240,0.98)',
      desc: 'The world holds its breath. Everything stops but you — act freely in the stillness.',
      apply(G) {
        if (!G.sabbath && G.faith < this.cost) { snd('error'); return 0; }
        if (typeof G.setSabbath !== 'function') { snd('error'); return 0; }
        G.sabbath = !G.sabbath;
        G.setSabbath(G.sabbath);
        if (PD.Society) PD.Society.hist(G.sim, G.sabbath ? 'Everything stops. Only you still move.' : 'The world breathes again.', 'faith');
        snd(G.sabbath ? 'bless' : 'click');
        return G.sabbath ? this.cost : 0;
      } },

  ];

  // ------------------------------------------------------------------
  // Vampires have been fully implemented since the first build — nocturnal,
  // 9000-tick lifespan, their own art, and a bite that turns the bitten. The
  // only line that ever created one required the killer to be a vampire
  // already. No power made them, no omen, no ambient spawn, and they were
  // left out of SENTIENT so evolution could not pick them either. A vampire
  // could only be made by a vampire, so there had never been a first one.
  //
  // That stays true. There is exactly one way to make patient zero, and
  // nothing in the game will tell you what it is: breathe the Grayfields
  // empty while a blood moon is up, and one of them comes back wrong. From
  // there the bite does the rest with no help from anyone.
  //
  // Do not mention this in the power's description, the Testament, or a
  // tooltip. It is meant to be found.
  function firstOfTheThirst(G, returned) {
    const sim = G.sim;
    if (!sim || !(sim.bloodMoonT > 0)) return;
    if ((sim.counts && sim.counts.vampire) > 0) return;   // there is already a first
    if (!returned || !returned.length) return;
    // One of the souls you just breathed back — not an extra body. A mature
    // world sits at UNIT_CAP, so anything that needed headroom of its own
    // would never happen on the worlds where blood moons do.
    const u = returned[(Math.random() * returned.length) | 0];
    if (!u || u.dead) return;
    u.race = 'vampire';
    // The progenitor is not an ordinary vampire. An ordinary one — made by a
    // bite — has 40 hp and dies to the first mob that finds it, which is
    // fine; that is what a vampire is. But this one was breathed out of limbo
    // by a god under a blood moon, and it has to survive long enough to make
    // a second. Only this one is built this way; every vampire it makes is
    // the ordinary kind.
    u.paragon = 2;
    u.maxHp = PD.Sim.RACES.vampire.hp * 5;
    u.hp = u.maxHp;
    u.village = -1;                       // it does not go home
    // a hero is given another century, which is what 9000 ticks meant to say
    u.lifespan = Math.max(u.lifespan || 0, (u.age || 0) + Sim.YEAR * 100);
    PD.Sim.recount(sim);                  // so counts.vampire is true immediately
    if (FX) { FX.shock(u.x, u.y, 5, '#5a1030'); FX.blood && FX.blood(u.x, u.y); }
    if (PD.Society) PD.Society.hist(sim, 'One of them did not come back the same.', 'legend');
    PD.Sim.logEvent(sim, 'One of them did not come back the same.', 'fall');
    // G.ach is the counter map, not the function — the recorder is G.deed
    if (typeof G.deed === 'function') G.deed('firstthirst');
    snd('plague');
  }

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
    { id: 'genesis', name: 'Genesis' },
    { id: 'god', name: 'Divine' },
    { id: 'life', name: 'Life' },
    { id: 'terra', name: 'Terraform' },
    { id: 'bless', name: 'Blessings' },
    { id: 'wrath', name: 'Wrath' },
    { id: 'godhead', name: 'Godhead' },
    { id: 'politic', name: 'Dominion' },
    { id: 'bible', name: 'Testament' },
    { id: 'omni', name: 'Omnipotence' }
  ];


  // =====================================================================
  //  THE SECOND WORD
  //
  //  A god speaks, and the world obeys. A god speaks AND HOLDS, and the
  //  word becomes a Word. Every power below has a greater form: hold the
  //  press until the ring closes and release, and what happens instead is
  //  the same act committed without restraint.
  //
  //  Mechanically this is one trick applied uniformly. Powers read
  //  `this.cost` and `this.radius` off their own object, so the invoker
  //  swaps those for the greater values and calls the ordinary apply()
  //  several times across a wider area. That means every power escalates
  //  correctly without 57 bespoke implementations — and the ones that
  //  deserve something qualitatively different get an `apply` of their own.
  //
  //  Not everything has one. `inspect` and `pan` are navigation, not acts;
  //  the eight genesis steps are a fixed scripted sequence where "more"
  //  would break the ordering of creation itself.
  // =====================================================================
  const AWE = {
    // ---- life: one becomes many ----
    spawn_human:  { name: 'A MULTITUDE',        cost: 44,  rMul: 3.2, reps: 9,
                    desc: 'Not a family. A generation, arriving at once.' },
    spawn_elf:    { name: 'THE LONG COUNCIL',   cost: 55,  rMul: 3.2, reps: 9,
                    desc: 'The forest fills with those who will outlive your regret.' },
    spawn_orc:    { name: 'THE HORDE',          cost: 50,  rMul: 3.4, reps: 11,
                    desc: 'Not warriors. A war, already begun.' },
    spawn_dwarf:  { name: 'THE DEEP HOLDS',     cost: 60,  rMul: 3.0, reps: 9,
                    desc: 'The mountain is opened, and it was always full.' },
    spawn_gnome:  { name: 'THE WORKSHOP AGE',   cost: 66,  rMul: 3.0, reps: 9,
                    desc: 'Every one of them already has an idea.' },
    spawn_halfling:{ name: 'THE HUNDRED HEARTHS', cost: 40, rMul: 3.4, reps: 11,
                    desc: 'The kettles go on across a whole county at once.' },
    spawn_goblin: { name: 'THE SWARM',          cost: 34,  rMul: 3.6, reps: 13,
                    desc: 'You will not count them. Nobody ever has.' },
    spawn_tiefling:{ name: 'THE INFERNAL COMPACT', cost: 72, rMul: 3.0, reps: 9,
                    desc: 'The ash remembers what walked out of it.' },
    spawn_dragonborn:{ name: 'THE SCALED LEGION', cost: 100, rMul: 2.8, reps: 8,
                    desc: 'Few. Enough.' },
    spawn_lizardfolk:{ name: 'THE DROWNED CITIES', cost: 56, rMul: 3.2, reps: 10,
                    desc: 'The swamp was never empty. It was only waiting.' },
    spawn_merfolk:{ name: 'THE TIDE PEOPLE',    cost: 78,  rMul: 3.4, reps: 10,
                    desc: 'Every shore at once, and everything between them.' },
    spawn_fairy:  { name: 'THE GLIMMERING',     cost: 105, rMul: 3.6, reps: 12,
                    desc: 'The air itself goes kind.' },
    spawn_giant:  { name: 'THE OLD HIGH FOLK',  cost: 95,  rMul: 2.6, reps: 6,
                    desc: 'They were here before the mountains had names.' },
    spawn_critter:{ name: 'THE TEEMING',        cost: 12,  rMul: 4.0, reps: 14,
                    desc: 'Every hedge and hollow, all at once, alive.' },
    spawn_wolf:   { name: 'THE LONG WINTER PACK',cost: 22, rMul: 3.4, reps: 10,
                    desc: 'The dark between the trees acquires eyes.' },
    spawn_kraken: { name: 'WHAT SLEEPS BENEATH',cost: 190, rMul: 3.0, reps: 4,
                    desc: 'The deep gives up more than one of its children.' },
    found:        { name: 'A CITY, ENTIRE',     cost: 220, rMul: 1,   reps: 5,
                    desc: 'Not a settlement to grow, but streets that were always there.' },

    // ---- terra: the hand of the sculptor, unrestrained ----
    raise:        { name: 'CONTINENT',          cost: 26,  rMul: 3.6, reps: 8,
                    desc: 'The sea remembers where it used to be.' },
    lower:        { name: 'THE ABYSSAL TRENCH', cost: 26,  rMul: 3.6, reps: 8,
                    desc: 'Open the floor of the world and let the water in.' },
    forest:       { name: 'THE OLD WOOD',       cost: 18,  rMul: 3.8, reps: 10,
                    desc: 'A forest with no memory of having been planted.' },
    grass:        { name: 'THE GREAT PLAIN',    cost: 18,  rMul: 3.8, reps: 10,
                    desc: 'Green to the horizon, and past it.' },
    desert:       { name: 'THE EMPTY QUARTER',  cost: 18,  rMul: 3.8, reps: 10,
                    desc: 'Everything the wind touches, it keeps.' },
    mountain:     { name: 'THE SPINE OF THE WORLD', cost: 34, rMul: 3.4, reps: 9,
                    desc: 'Stone thrown at heaven, and it stays there.' },

    // ---- blessing: mercy at scale ----
    bless:        { name: 'GRACE ABOUNDING',    cost: 48,  rMul: 3.2, reps: 9,
                    desc: 'Every soul in reach, lifted, whether they asked or not.' },
    rain:         { name: 'THE LONG RAINS',     cost: 30,  rMul: 3.2, reps: 8,
                    desc: 'Weeks of it. The rivers will remember this year.' },

    // ---- wrath: the difference between anger and judgement ----
    lightning:    { name: 'THE STORM ENTIRE',   cost: 70,  rMul: 2.6, reps: 12,
                    desc: 'Not a bolt. A sky that has decided.' },
    fire:         { name: 'THE BURNING',        cost: 34,  rMul: 3.6, reps: 12,
                    desc: 'Fire that does not need anything left to want more.' },
    meteor:       { name: 'THE HAMMER FALL',    cost: 190, rMul: 2.6, reps: 7,
                    desc: 'The sky opens in several places at once.' },
    plague:       { name: 'THE PESTILENCE',     cost: 90,  rMul: 3.0, reps: 8,
                    desc: 'It will outlast the ones who first carried it.' },
    quake:        { name: 'THE SUNDERING',      cost: 140, rMul: 2.8, reps: 7,
                    desc: 'The ground stops being a thing that can be trusted.' },
    freeze:       { name: 'THE LONG COLD',      cost: 62,  rMul: 3.2, reps: 9,
                    desc: 'Winter arrives and forgets to leave.' },
    raise_dead:   { name: 'THE RESTLESS DEAD',  cost: 85,  rMul: 3.2, reps: 10,
                    desc: 'Every grave in reach hears you.' },
    storm:        { name: 'THE TEMPEST',        cost: 95,  rMul: 2.4, reps: 6,
                    desc: 'A storm with a shape and an intention.' },
    tornado:      { name: 'THE WHIRLWIND',      cost: 200, rMul: 2.2, reps: 6,
                    desc: 'Speak from inside it, if you have anything to say.' },
    volcano:      { name: 'THE FIRE UNDERNEATH',cost: 260, rMul: 2.6, reps: 5,
                    desc: 'What the world is actually made of, briefly visible.' },

    // ---- godhead ----
    voice:        { name: 'THE VOICE UNVEILED', cost: 32,  rMul: 1, reps: 5,
                    desc: 'Not a whisper to one. A word to everyone alive.' },
    empower:      { name: 'THE CHOSEN',         cost: 300, rMul: 1, reps: 4,
                    desc: 'Not a hero. A generation of them.' },
    miracle:      { name: 'THE AGE OF WONDERS', cost: 140, rMul: 2.8, reps: 8,
                    desc: 'Enough impossible things that they stop counting.' },
    stabilize:    { name: 'THE STILL POINT',    cost: 700, rMul: 1, reps: 3,
                    desc: 'The core forgets it was ever restless.' },
    evolve:       { name: 'THE GREAT LEAP',     cost: 160, rMul: 1, reps: 5,
                    desc: 'A hundred thousand years, spent at once.' },
    judgment:     { name: 'THE FINAL ACCOUNTING', cost: 800, rMul: 1, reps: 3,
                    desc: 'Every ledger, opened, and every one read aloud.' },
    omniscience:  { name: 'THE UNBLINKING EYE', cost: 190, rMul: 1,
                    toggle: true, flag: 'omniscient',
                    desc: 'Nothing is hidden. Nothing was ever hidden.',
                    // the lesser eye only reads what you lean close to; this
                    // one reads the whole world at any remove, and the
                    // nations' private opinions of each other with it
                    after(G) { G.omniAll = true; } },
    unmake:       { name: 'ERASURE',            cost: 340, rMul: 1, reps: 3,
                    desc: 'Not killed. Never having been.' },
    breath:       { name: 'THE FIRST BREATH',   cost: 520, rMul: 1, reps: 4,
                    desc: 'The lungs of the world fill again.' },
    sabbath:      { name: 'THE LONG SABBATH',   cost: 110, rMul: 1,
                    toggle: true, flag: 'sabbath',
                    desc: 'Rest, imposed. The world will thank you later.',
                    // rest that repairs: every fire goes out, every larder
                    // fills, every town breathes easier while nothing moves
                    after(G) {
                      const sim = G.sim; if (!sim) return;
                      const w = sim.world;
                      if (w && w.fire) w.fire.fill(0);
                      for (const v of sim.villages) {
                        v.food += 40;
                        v.prosperity = PD.clamp((v.prosperity || 0) + 0.25, 0, 1);
                      }
                      if (PD.Society) PD.Society.hist(sim, 'The long rest. Fires die, granaries fill, and nothing stirs.', 'faith');
                    } },

    // ---- politics: the thumb on the scale, pressed harder ----
    crown:        { name: 'THE DYNASTY',        cost: 95,  rMul: 1, reps: 5,
                    desc: 'Not a ruler. A line of them, and a claim.' },
    peace:        { name: 'THE GREAT PEACE',    cost: 140, rMul: 1, reps: 5,
                    desc: 'Every blade in the world set down at once.' },
    incite:       { name: 'THE WORLD WAR',      cost: 120, rMul: 1, reps: 6,
                    desc: 'Everyone remembers a grievance simultaneously.' },
    revolt:       { name: 'THE TURNING',        cost: 120, rMul: 1, reps: 6,
                    desc: 'Every throne at once discovers it is only a chair.' },

    // ---- scripture ----
    flood:        { name: 'THE DELUGE',         cost: 560, rMul: 1, reps: 4,
                    desc: 'Forty days was a mercy. This is not that.' },
    plagues:      { name: 'ALL OF THEM, AT ONCE', cost: 280, rMul: 2.4, reps: 8,
                    desc: 'The ten did not have to arrive in order.' },
    prophet:      { name: 'THE PROPHETS',       cost: 140, rMul: 1, reps: 5,
                    desc: 'Many voices, one message, no possible misunderstanding.' },
    commandments: { name: 'THE WHOLE LAW',      cost: 230, rMul: 1, reps: 4,
                    desc: 'Not ten. Everything, carved, and binding.' },
    babel:        { name: 'THE SCATTERING',     cost: 180, rMul: 1, reps: 5,
                    desc: 'Not confusion of tongues. Confusion of intent.' },

    // ---- omnipotence: already excessive; make it absurd ----
    midas:        { name: 'THE GOLDEN AGE',     cost: 250, rMul: 3.0, reps: 8,
                    desc: 'Everything you meant to be beautiful, and it is.' },
    blackhole:    { name: 'THE THROAT OF NIGHT',cost: 420, rMul: 2.6, reps: 5,
                    desc: 'A hole with an appetite and a memory.' },
    host:         { name: 'THE HEAVENLY WAR',   cost: 320, rMul: 3.0, reps: 8,
                    desc: 'The sky is full of wings and none of them are gentle.' },
    legion:       { name: 'THE PIT, OPENED',    cost: 320, rMul: 3.0, reps: 8,
                    desc: 'It was never a metaphor.' },
    armageddon:   { name: 'THE LAST DAY',       cost: 1100, rMul: 1, reps: 4,
                    desc: 'There is no verse after this one.' },
    zombify:      { name: 'THE GREAT NECROPOLIS', cost: 360, rMul: 2.8, reps: 8,
                    desc: 'A city where the census only ever goes up.' },
    polymorph:    { name: 'THE UNSHAPING',      cost: 140, rMul: 3.2, reps: 9,
                    desc: 'Form was only ever a suggestion.' },
    youth:        { name: 'THE UNAGEING',       cost: 180, rMul: 3.2, reps: 9,
                    desc: 'Give back every year you took, and then some.' },
    fertility:    { name: 'THE QUICKENING',     cost: 160, rMul: 3.2, reps: 9,
                    desc: 'Every cradle in the province, filled by morning.' },
    rapture:      { name: 'THE GATHERING',      cost: 270, rMul: 3.0, reps: 8,
                    desc: 'The worthy are taken. The rest look up.' },
    aegis:        { name: 'THE UNBREAKABLE',    cost: 230, rMul: 1, reps: 5,
                    desc: 'Nothing you love can be touched today.' },
    titan:        { name: 'THE COLOSSI',        cost: 450, rMul: 1, reps: 5,
                    desc: 'They will have to invent new words for them.' }
  };

  function aweOf(id) { return AWE[id] || null; }

  // Invoke the greater form. Returns faith spent, 0 if refused.
  function invokeAwe(G, p, wx, wy) {
    const a = AWE[p.id];
    if (!a) return 0;
    if (G.faith < a.cost) { snd('error'); return 0; }

    const baseCost = p.cost, baseRadius = p.radius;
    // The repeats must not each charge; the greater form is priced once.
    p.cost = 0;
    p.radius = Math.max(1, Math.round(baseRadius * (a.rMul || 1)));
    const spread = Math.max(1.2, baseRadius * 1.25);
    // A toggle repeated is a toggle undone. Sabbath and Omniscience flip a
    // flag, so firing them `reps` times landed exactly where one press would
    // — for four times the faith. Toggles fire once, and only to turn ON.
    const reps = a.toggle ? 1 : (a.reps || 5);
    const alreadyOn = a.toggle && a.flag && !!G[a.flag];
    try {
      if (!alreadyOn) {
        for (let i = 0; i < reps; i++) {
          // first at the point itself, the rest in a ring around it
          const ang = (i / Math.max(1, reps - 1)) * 6.2832;
          const d = i === 0 ? 0 : spread * (0.6 + (i % 3) * 0.32);
          p.apply(G, wx + Math.cos(ang) * d, wy + Math.sin(ang) * d);
        }
      }
      // the escalation proper — what makes the greater form greater
      if (typeof a.after === 'function') a.after(G, wx, wy);
    } finally {
      p.cost = baseCost;
      p.radius = baseRadius;
    }
    if (FX) { FX.shock(wx, wy, 9, '#ffe9a8'); FX.shock(wx, wy, 6, '#fff'); }
    snd('levelup');
    return a.cost;
  }

  global.PD.Powers = { soundAt, AWE, aweOf, invokeAwe, POWERS, BY_ID, CATEGORIES };
})(window);
