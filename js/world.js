/* =========================================================================
   PIXEL DEITY — world.js
   Procedural world: elevation, moisture, temperature -> biomes.
   Tile-array data model + helpers for terrain queries and mutation.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;

  // Biome ids
  const B = {
    DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, FOREST: 4,
    DIRT: 5, ROCK: 6, SNOW: 7, DESERT: 8, JUNGLE: 9, SWAMP: 10, ASH: 11
  };

  // Base biome palette (8-bit-ish, cohesive)
  const BIOME_COLORS = {
    0:  '#12224a', // deep ocean
    1:  '#245e8f', // shallow water
    2:  '#e2cd82', // sand
    3:  '#5aa03c', // grass
    4:  '#2f7333', // forest
    5:  '#8a6a48', // dirt
    6:  '#7d7f88', // rock/mountain
    7:  '#eef4fb', // snow
    8:  '#dcb45c', // desert
    9:  '#237d3b', // jungle
    10: '#4c6a3a', // swamp
    11: '#3a3436'  // ash / scorched
  };
  // Secondary shade for dithered texture
  const BIOME_COLORS2 = {
    0:  '#0d1a3c', 1: '#1d4f7c', 2: '#d4bd6f', 3: '#4b8c31', 4: '#276128',
    5: '#79593c', 6: '#6c6e77', 7: '#dbe6f2', 8: '#cfa54c', 9: '#1c6b31',
    10: '#3f5a30', 11: '#2c2729'
  };

  // Struct ids
  const S = { NONE: 0, HOUSE: 1, TOWN: 2, FARM: 3, ROAD: 4, RUIN: 5, TOWER: 6, TEMPLE: 7 };

  function inBounds(w, x, y) { return x >= 0 && y >= 0 && x < w.W && y < w.H; }
  function idx(w, x, y) { return y * w.W + x; }

  function isWater(b) { return b === B.DEEP || b === B.WATER || b === B.SWAMP; }
  function isLand(b) { return !(b === B.DEEP || b === B.WATER); }

  function createWorld(W, H, seedStr) {
    const seed = PD.hashSeed(seedStr);
    const n = W * H;
    const w = {
      W, H, n, seedStr, seed,
      biome: new Uint8Array(n),
      elev: new Float32Array(n),
      moist: new Float32Array(n),
      temp: new Float32Array(n),
      fert: new Float32Array(n),   // 0..1 fertility (food potential)
      fire: new Uint8Array(n),     // 0..255 fire intensity
      tree: new Uint8Array(n),     // tree density 0..3
      owner: new Int16Array(n),    // village id or -1
      struct: new Uint8Array(n),   // structure id
      structHp: new Uint8Array(n),
      dirty: true                  // terrain needs re-render
    };
    w.owner.fill(-1);
    generate(w);
    return w;
  }

  function generate(w) {
    const nElev = PD.makeNoise(w.seed ^ 0x1111);
    const nMoist = PD.makeNoise(w.seed ^ 0x2222);
    const nTemp = PD.makeNoise(w.seed ^ 0x3333);
    const nWarp = PD.makeNoise(w.seed ^ 0x4444);
    const W = w.W, H = w.H;
    const cx = W / 2, cy = H / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const es = 0.045, ms = 0.03, ts = 0.02;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(w, x, y);
        // domain warp for more organic coasts
        const wx = x + (nWarp.fbm(x * 0.05, y * 0.05, 3) - 0.5) * 18;
        const wy = y + (nWarp.fbm(x * 0.05 + 40, y * 0.05 + 40, 3) - 0.5) * 18;
        let e = nElev.fbm(wx * es, wy * es, 6, 2.0, 0.52);
        // radial falloff -> island-ish continents, oceans at edges
        const r = PD.dist(x, y, cx, cy) / maxR;
        const fall = PD.clamp(1.15 - Math.pow(r, 1.9) * 1.35, 0, 1);
        e = e * 0.72 + fall * 0.42 - 0.14;
        e = PD.clamp(e, 0, 1);
        w.elev[i] = e;

        let m = nMoist.fbm(x * ms, y * ms, 5);
        w.moist[i] = m;
        // temperature: latitude gradient + noise, colder at poles & high elevation
        const lat = 1 - Math.abs((y / H) - 0.5) * 2; // 1 equator .. 0 poles
        let t = lat * 0.8 + nTemp.fbm(x * ts, y * ts, 4) * 0.3 - e * 0.35;
        w.temp[i] = PD.clamp(t, 0, 1);
      }
    }
    classify(w);
  }

  function classify(w) {
    const W = w.W, H = w.H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(w, x, y);
        assignBiome(w, i, x, y);
      }
    }
    w.dirty = true;
  }

  function assignBiome(w, i, x, y) {
    const e = w.elev[i], m = w.moist[i], t = w.temp[i];
    let b, fert = 0.2, tree = 0;
    if (e < 0.30) { b = B.DEEP; fert = 0; }
    else if (e < 0.38) { b = B.WATER; fert = 0.1; }
    else if (e < 0.42) { b = B.SAND; fert = 0.15; }
    else if (e > 0.82) { b = t < 0.35 ? B.SNOW : B.ROCK; fert = 0.02; }
    else if (e > 0.72) { b = t < 0.3 ? B.SNOW : B.ROCK; fert = 0.05; }
    else {
      // mid elevations: biome by temp & moisture
      if (t < 0.28) { b = B.SNOW; fert = 0.08; }
      else if (t > 0.72 && m < 0.35) { b = B.DESERT; fert = 0.04; }
      else if (t > 0.68 && m > 0.6) { b = B.JUNGLE; fert = 0.85; tree = 3; }
      else if (m > 0.68 && e < 0.5) { b = B.SWAMP; fert = 0.5; tree = 1; }
      else if (m > 0.5) { b = B.FOREST; fert = 0.7; tree = 2; }
      else if (m > 0.3) { b = B.GRASS; fert = 0.6; }
      else { b = B.DIRT; fert = 0.3; }
    }
    w.biome[i] = b;
    w.fert[i] = fert;
    w.tree[i] = tree;
  }

  // Recompute biome for a single tile from its current elevation/moist/temp
  function reclassTile(w, x, y) {
    if (!inBounds(w, x, y)) return;
    const i = idx(w, x, y);
    // preserve structures on land; clear if turned to water
    assignBiome(w, i, x, y);
    if (isWater(w.biome[i])) { w.struct[i] = 0; w.owner[i] = -1; w.tree[i] = 0; }
    w.dirty = true;
  }

  // Raise / lower elevation in a radius (terraform)
  function raise(w, cx, cy, radius, amount) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!inBounds(w, x, y)) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > radius) continue;
        const i = idx(w, x, y);
        const f = (1 - d / radius);
        w.elev[i] = PD.clamp(w.elev[i] + amount * f, 0, 1);
        reclassTile(w, x, y);
      }
    }
    w.dirty = true;
  }

  function paintBiome(w, cx, cy, radius, biome, fert, tree) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!inBounds(w, x, y)) continue;
        if (dx * dx + dy * dy > radius * radius) continue;
        const i = idx(w, x, y);
        if (biome === B.FOREST || biome === B.JUNGLE) {
          // only grow forest on land above water level
          if (isWater(w.biome[i])) continue;
          w.biome[i] = biome; w.fert[i] = fert; w.tree[i] = tree;
        } else {
          w.biome[i] = biome; w.fert[i] = fert; w.tree[i] = tree;
          if (isWater(biome)) { w.struct[i] = 0; w.owner[i] = -1; w.tree[i] = 0; }
        }
      }
    }
    w.dirty = true;
  }

  // Fire simulation step: spread & burn
  function stepFire(w, rng) {
    let anyFire = false;
    const W = w.W, H = w.H;
    // iterate sparsely for perf; use a scan with random offset
    for (let i = 0; i < w.n; i++) {
      const f = w.fire[i];
      if (f === 0) continue;
      anyFire = true;
      const x = i % W, y = (i / W) | 0;
      // fuel: forest/jungle/grass burn; reduce over time
      const b = w.biome[i];
      let fuel = (b === B.FOREST || b === B.JUNGLE) ? 3 : (b === B.GRASS || b === B.SWAMP ? 1 : 0);
      // spread to neighbors
      if (f > 60 && rng() < 0.35) {
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(w, nx, ny)) continue;
          const ni = idx(w, nx, ny);
          const nb = w.biome[ni];
          if ((nb === B.FOREST || nb === B.JUNGLE || nb === B.GRASS || nb === B.SWAMP) && w.fire[ni] === 0 && rng() < 0.5) {
            w.fire[ni] = 120;
          }
        }
      }
      // decay & consume
      const dec = 12 + (fuel === 0 ? 40 : 0);
      let nf = f - dec;
      if (nf <= 0) {
        w.fire[i] = 0;
        // burned tile becomes ash/dirt, trees gone
        if (b === B.FOREST || b === B.JUNGLE) { w.biome[i] = B.DIRT; w.fert[i] = 0.35; }
        else if (b === B.GRASS) { w.biome[i] = B.DIRT; w.fert[i] = 0.25; }
        else if (b === B.SWAMP) { w.biome[i] = B.DIRT; w.fert[i] = 0.2; }
        w.tree[i] = 0;
        if (w.struct[i] !== 0 && rng() < 0.5) { w.struct[i] = S.RUIN; w.owner[i] = -1; }
        w.dirty = true;
      } else {
        w.fire[i] = nf;
      }
    }
    return anyFire;
  }

  function ignite(w, cx, cy, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!inBounds(w, x, y)) continue;
        if (dx * dx + dy * dy > radius * radius) continue;
        const i = idx(w, x, y);
        const b = w.biome[i];
        if (b === B.FOREST || b === B.JUNGLE || b === B.GRASS || b === B.SWAMP) w.fire[i] = 200;
      }
    }
  }

  function extinguish(w, cx, cy, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!inBounds(w, x, y)) continue;
        const i = idx(w, x, y);
        w.fire[i] = 0;
        // rain boosts fertility a touch
        if (isLand(w.biome[i])) w.fert[i] = PD.clamp(w.fert[i] + 0.03, 0, 1);
      }
    }
  }

  // Count of land tiles (used by stats)
  function countLand(w) {
    let c = 0; for (let i = 0; i < w.n; i++) if (isLand(w.biome[i])) c++; return c;
  }

  // find nearest walkable land tile from x,y (spiral search)
  function nearestLand(w, x, y, maxR) {
    maxR = maxR || 30;
    x = Math.round(x); y = Math.round(y);
    if (inBounds(w, x, y) && isLand(w.biome[idx(w, x, y)])) return { x, y };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (inBounds(w, nx, ny) && isLand(w.biome[idx(w, nx, ny)])) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  global.PD.World = {
    B, S, BIOME_COLORS, BIOME_COLORS2,
    createWorld, generate, classify, reclassTile,
    raise, paintBiome, stepFire, ignite, extinguish,
    inBounds, idx, isWater, isLand, countLand, nearestLand
  };
})(window);
