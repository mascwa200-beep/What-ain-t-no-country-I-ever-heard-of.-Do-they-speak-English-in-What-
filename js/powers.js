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
      } }
  ];

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
    { id: 'wrath', name: 'Wrath' }
  ];

  global.PD.Powers = { POWERS, BY_ID, CATEGORIES };
})(window);
