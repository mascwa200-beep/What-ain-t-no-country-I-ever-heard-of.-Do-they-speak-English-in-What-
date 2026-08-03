// A settlement, as buildings you can fly between.
//
// Until now a village was a colour tint painted into the albedo bake — a
// slightly warmer patch of ground, readable from orbit and meaningless up
// close. This turns one into geometry: individual huts, houses, halls,
// temples and towers, standing on the terrain at the size they would really
// be.
//
// ---------------------------------------------------------------------------
// TRUE SCALE, AND WHAT THAT COSTS
//
// A village is about five hundred metres across and stays five hundred metres
// across. It does not swell on the altitude curve the mountains use. From
// orbit this planet therefore looks like the real Earth from orbit: no
// buildings at all, only the tinted ground that was always there. You have to
// go and look.
//
// That is the honest choice and it has a consequence that is built rather
// than assumed — a thing only visible below a few kilometres is invisible
// unless there is a way down to it. See flyTo, which this stage finally wires
// up after two releases of being exported and called from nowhere.
// ---------------------------------------------------------------------------
//
// FOOTPRINT COMES FROM POPULATION, NOT FROM TERRITORY. A mature settlement
// claims up to 177 tiles, and a tile is 222 km — that is the land it farms
// and defends, not the land it has built on. Sizing the cluster from claimed
// tiles would produce a city four hundred kilometres wide.
//
// There are no GL calls in this file. It builds plain arrays, so the whole
// thing runs under Node exactly like js/lod.js and js/sim.js do — which is
// what lets the layout be asserted rather than eyeballed.
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;

  const R_EARTH_M = 6371000;

  // Building kinds. The index is what the renderer uses to pick a mesh, so
  // the order is part of the contract.
  const HUT = 0, HOUSE = 1, HALL = 2, TEMPLE = 3, TOWER = 4, FARM = 5;
  const KINDS = ['hut', 'house', 'hall', 'temple', 'tower', 'farm'];

  // Real-world dwelling densities, in people per building. A hut holds a
  // family; a city block holds rather more.
  const PER_BUILDING = 4.5;

  // How tightly people build, in buildings per square kilometre. A hamlet
  // sprawls; a city stacks. These are the numbers that decide whether a
  // settlement reads as a real place or as a model village.
  const DENSITY_MIN = 120;     // scattered farmsteads
  const DENSITY_MAX = 2600;    // dense old-town streets

  // Nothing is drawn above this altitude, because at true scale there is
  // nothing to see: a 500 m village is under a pixel from 50 km up.
  const VISIBLE_ALT_M = 55000;

  // A hard ceiling on instances, so that flying into the largest possible
  // city cannot stall a frame.
  const MAX_INSTANCES = 6000;

  // ---- size -------------------------------------------------------------
  // Built radius in METRES, from the population that lives there.
  //
  // Density rises with size, which is why a city is not simply a village
  // scaled up: doubling the people less than doubles the ground.
  function footprintM(pop, level) {
    const n = Math.max(1, buildingCount(pop, level));
    // interpolate density by settlement level (1 hamlet .. 8+ metropolis)
    const t = PD.clamp((level - 1) / 7, 0, 1);
    const density = DENSITY_MIN + (DENSITY_MAX - DENSITY_MIN) * t * t;
    const areaKm2 = n / density;
    return Math.max(60, Math.sqrt(areaKm2 / Math.PI) * 1000);
  }

  // The simulation's `pop` is not a headcount. It is capped at 120 by
  // `v.cap`, so a metropolis and a hamlet differ by a factor of twenty when
  // the real difference is a factor of thousands — and sizing buildings from
  // it directly produced a level-8 city 77 m across, SMALLER than a
  // twenty-person hamlet at 103 m, because density climbed faster than the
  // building count did.
  //
  // Settlement LEVEL is what actually carries scale in this game. Each level
  // is roughly a doubling and a bit of the people a unit of `pop` stands for,
  // so a level-8 town of 120 reads as about twenty thousand souls.
  function realPopulation(pop, level) {
    return Math.max(1, pop) * Math.pow(2.1, Math.max(0, (level || 1) - 1));
  }

  function buildingCount(pop, level) {
    // houses the settlement has actually raised, plus the civic buildings a
    // town of that level has earned
    const homes = Math.max(1, Math.round(realPopulation(pop, level) / PER_BUILDING));
    return Math.min(MAX_INSTANCES, homes + Math.max(0, (level || 1) - 1) * 3);
  }

  // ---- layout -----------------------------------------------------------
  // Deterministic from the settlement's own identity, so a town looks the
  // same every time you visit it and after a reload, with not one byte of
  // per-building state saved.
  //
  // Returns instances in TILE space plus a metre offset, because the caller
  // has to put them on the terrain and only it knows the exaggeration.
  //
  //   out.x, out.y     tile coordinates (fractional)
  //   out.kind         index into KINDS
  //   out.rot          yaw, radians
  //   out.w, out.d     footprint in metres
  //   out.h            height in metres
  function layout(v, world, opts) {
    const cap = (opts && opts.max) || MAX_INSTANCES;
    const pop = v.pop || 1, level = v.level || 1;
    const n = Math.min(cap, buildingCount(pop, level));
    const radM = footprintM(pop, level);

    // The seed is the settlement's identity, not its address: a town that is
    // renamed or grows keeps its streets.
    const rng = PD.makeRNG(((v.id + 1) * 2654435761) >>> 0);

    // metres per tile, which is latitude-dependent in x
    const mPerTileY = (Math.PI * R_EARTH_M) / world.H;
    const lat = Math.PI / 2 - (v.y / world.H) * Math.PI;
    const mPerTileX = Math.max(1, Math.cos(lat)) * (2 * Math.PI * R_EARTH_M) / world.W;

    const out = [];
    // A settlement is not a disc of randomly scattered boxes. It has a centre
    // that is denser than its edge, and the civic buildings are in the middle
    // where they belong — which is the difference between a town and a rash.
    for (let i = 0; i < n; i++) {
      // sqrt keeps the area density uniform; the extra power pulls it inward
      const rr = Math.pow(rng(), 0.65);
      const ang = rng() * Math.PI * 2;
      const dM = rr * radM;

      let kind = HUT;
      if (i === 0 && level >= 2) kind = HALL;                 // the moot hall
      else if (i < (v.temples || 0) + 1 && level >= 2) kind = TEMPLE;
      else if (i < 4 && level >= 3) kind = TOWER;
      else if (rr > 0.72 && rng() < 0.45) kind = FARM;        // fields at the edge
      else kind = (level >= 3 && rr < 0.5) ? HOUSE : (rng() < 0.35 ? HOUSE : HUT);

      const size = kindSize(kind, level, rng);
      out.push({
        x: W.wrapX(world, v.x + (Math.cos(ang) * dM) / mPerTileX),
        y: PD.clamp(v.y + (Math.sin(ang) * dM) / mPerTileY, 0, world.H - 0.001),
        kind,
        // buildings face the centre of town, roughly, because streets radiate
        rot: ang + Math.PI / 2 + (rng() - 0.5) * 0.5,
        w: size.w, d: size.d, h: size.h
      });
    }
    return { items: out, radiusM: radM, count: n };
  }

  function kindSize(kind, level, rng) {
    const j = 0.8 + rng() * 0.4;             // no two the same
    switch (kind) {
      case HALL:   return { w: 14 * j, d: 22 * j, h: 9 * j };
      case TEMPLE: return { w: 16 * j, d: 24 * j, h: (10 + level * 1.6) * j };
      case TOWER:  return { w: 7 * j, d: 7 * j, h: (14 + level * 3.2) * j };
      case FARM:   return { w: 26 * j, d: 26 * j, h: 2.2 * j };
      case HOUSE:  return { w: 8 * j, d: 10 * j, h: (5 + Math.min(level, 6) * 1.4) * j };
      default:     return { w: 6 * j, d: 7 * j, h: 3.4 * j };   // HUT
    }
  }

  // Which settlements are worth building geometry for at this altitude and
  // this camera position. At true scale the answer is usually "none", which
  // is why this exists rather than a blanket loop over every village.
  function visible(sim, world, camTx, camTy, altM, budget) {
    const out = [];
    if (!sim || !sim.villages || altM > VISIBLE_ALT_M) return out;
    // how far away a settlement can be and still be worth drawing: roughly
    // the horizon at this altitude, in tiles
    const horizonM = Math.sqrt(Math.max(0, 2 * R_EARTH_M * altM)) + 20000;
    const mPerTileY = (Math.PI * R_EARTH_M) / world.H;
    const maxTiles = horizonM / mPerTileY;
    for (const v of sim.villages) {
      if (!v || v.pop <= 0) continue;
      const d = W.wdist(world, camTx, camTy, v.x, v.y);
      if (d <= maxTiles) out.push({ v, d });
    }
    out.sort((a, b) => a.d - b.d);
    // nearest first, to the instance budget
    let total = 0;
    const keep = [];
    for (const e of out) {
      const n = buildingCount(e.v.pop, e.v.level);
      if (total + n > (budget || MAX_INSTANCES)) break;
      total += n; keep.push(e.v);
    }
    return keep;
  }

  // Is (tx, ty) inside a settlement's built area? The quadtree asks this so
  // it can stop inventing sub-tile relief under a town — see lod.js. People
  // build on level ground, and a building placed against a smooth
  // interpolated surface would otherwise sink into a hill that the patch
  // geometry invented after the fact.
  function builtRadiusTiles(v, world) {
    const mPerTileY = (Math.PI * R_EARTH_M) / world.H;
    return footprintM(v.pop || 1, v.level || 1) / mPerTileY;
  }

  global.PD.Buildings = {
    layout, footprintM, buildingCount, realPopulation, visible, builtRadiusTiles, kindSize,
    KINDS, HUT, HOUSE, HALL, TEMPLE, TOWER, FARM,
    VISIBLE_ALT_M, MAX_INSTANCES, PER_BUILDING, R_EARTH_M
  };
})(window);
