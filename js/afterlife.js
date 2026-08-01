/* =========================================================================
   PIXEL DEITY — afterlife.js
   The Beyond: five planes shared by every universe. Souls are routed by
   karma — Elysium, the Meadows, the Grayfields, the Ashen Hell, and the
   Frozen Deep. Visit them, meet the dead, resurrect the worthy, and watch
   angels and demons keep their eternal watch.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;

  const PLANES = [
    { id: 'elysium',    name: 'Elysium',        mode: 'heaven', min: 8,    max: 1e9,  host: 'angel',
      desc: 'The highest heaven. Golden meadows for the truly good.' },
    { id: 'meadows',    name: 'The Meadows',    mode: 'heaven', min: 0,    max: 8,    host: 'angel',
      desc: 'A gentle heaven of soft light, for decent souls.' },
    { id: 'grayfields', name: 'The Grayfields', mode: 'void',   min: -8,   max: 0,    host: null,
      desc: 'Limbo. Neither warm nor cold. The unremarkable wander here.' },
    { id: 'ashenhell',  name: 'The Ashen Hell', mode: 'hell',   min: -25,  max: -8,   host: 'demon',
      desc: 'Fire and regret. The cruel are tenanted here.' },
    { id: 'frozendeep', name: 'The Frozen Deep', mode: 'void',  min: -1e9, max: -25,  host: 'demon',
      desc: 'The deepest hell. Cold beyond meaning, for the worst of all.' }
  ];

  const AL = {
    planes: {},   // id -> {meta, souls: [], total: 0, world: null, sim: null}
    ready: false
  };

  function init() {
    if (AL.ready) return;
    for (const p of PLANES) {
      AL.planes[p.id] = { meta: p, souls: [], total: 0, world: null, sim: null };
    }
    AL.ready = true;
  }

  function routePlane(karma) {
    for (const p of PLANES) if (karma >= p.min && karma < p.max) return p.id;
    return 'grayfields';
  }

  function receiveSoul(soul) {
    init();
    const pid = routePlane(soul.karma);
    const plane = AL.planes[pid];
    plane.total++;
    soul.plane = pid;
    plane.souls.unshift(soul);
    if (plane.souls.length > 400) plane.souls.pop(); // recent souls kept by name
    // if the plane is materialized, the soul walks in
    if (plane.sim && plane.sim.units.length < 400) {
      const s = W.nearestLand(plane.world, (plane.sim.rng() * plane.world.W) | 0, (plane.sim.rng() * plane.world.H) | 0, 15);
      if (s) {
        const u = PD.Sim.spawnUnit(plane.sim, 'spirit', s.x, s.y);
        if (u) { u.name = soul.name; u.karma = soul.karma; u.soulRef = soul; }
      }
    }
  }

  // Build the actual world for a plane the first time the god visits
  function materialize(pid) {
    init();
    const plane = AL.planes[pid];
    if (plane.world) return plane;
    const meta = plane.meta;
    plane.world = W.createWorld(120, 80, 'plane-' + pid, { mode: meta.mode, seaShift: meta.mode === 'heaven' ? 0.05 : 0 });
    plane.sim = PD.Sim.createSim(plane.world, PD.makeRNG(PD.hashSeed(pid) ^ 0x5eed));
    plane.sim.planetName = meta.name;
    plane.sim.isPlane = true;
    // hosts: angels patrol heavens, demons prowl hells
    if (meta.host) {
      for (let k = 0; k < 10; k++) {
        const s = W.nearestLand(plane.world, (plane.sim.rng() * plane.world.W) | 0, (plane.sim.rng() * plane.world.H) | 0, 15);
        if (s) PD.Sim.spawnUnit(plane.sim, meta.host, s.x, s.y);
      }
    }
    // recent souls wander in
    for (const soul of plane.souls.slice(0, 120)) {
      const s = W.nearestLand(plane.world, (plane.sim.rng() * plane.world.W) | 0, (plane.sim.rng() * plane.world.H) | 0, 15);
      if (s) {
        const u = PD.Sim.spawnUnit(plane.sim, 'spirit', s.x, s.y);
        if (u) { u.name = soul.name; u.karma = soul.karma; u.soulRef = soul; }
      }
    }
    return plane;
  }

  // Pull a soul back to the living world (resurrection). Returns the unit or null.
  function resurrect(soulName, targetSim, x, y) {
    init();
    for (const pid in AL.planes) {
      const plane = AL.planes[pid];
      const i = plane.souls.findIndex(s => s.name === soulName);
      if (i >= 0) {
        const soul = plane.souls.splice(i, 1)[0];
        plane.total = Math.max(0, plane.total - 1);
        // remove materialized spirit if present
        if (plane.sim) {
          const su = plane.sim.units.find(u => !u.dead && u.soulRef === soul);
          if (su) su.dead = true;
        }
        const spot = W.nearestLand(targetSim.world, x, y, 12);
        if (!spot) return null;
        const u = PD.Sim.spawnUnit(targetSim, PD.Sim.RACES[soul.race] ? soul.race : 'human', spot.x, spot.y);
        if (u) {
          u.name = soul.name; u.karma = soul.karma; u.trait = soul.trait || 0;
          if (PD.FX) { PD.FX.shock(spot.x, spot.y, 4, '#fff2a0'); PD.FX.puff(spot.x, spot.y, '#f8f0d0'); }
          if (PD.Society) PD.Society.hist(targetSim, `${soul.name} returns from ${AL.planes[soul.plane].meta.name}! A resurrection!`, 'legend');
        }
        return u;
      }
    }
    return null;
  }

  // Promote a (heaven) soul to angelhood or condemn/redeem between planes
  function judgeSoul(soulName, verdict) {
    init();
    for (const pid in AL.planes) {
      const plane = AL.planes[pid];
      const i = plane.souls.findIndex(s => s.name === soulName);
      if (i < 0) continue;
      const soul = plane.souls.splice(i, 1)[0];
      plane.total = Math.max(0, plane.total - 1);
      if (plane.sim) {
        const su = plane.sim.units.find(u => !u.dead && u.soulRef === soul);
        if (su) su.dead = true;
      }
      if (verdict === 'ascend') {
        // becomes an angel in Elysium
        const el = materialize('elysium');
        const s = W.nearestLand(el.world, (el.sim.rng() * el.world.W) | 0, (el.sim.rng() * el.world.H) | 0, 15);
        if (s) { const a = PD.Sim.spawnUnit(el.sim, 'angel', s.x, s.y); if (a) a.name = soul.name; }
        return 'ascended';
      }
      const target = verdict === 'redeem' ? 'meadows' : 'ashenhell';
      soul.karma = verdict === 'redeem' ? 2 : -12;
      soul.plane = target;
      AL.planes[target].souls.unshift(soul);
      AL.planes[target].total++;
      return verdict + 'ed';
    }
    return null;
  }

  function stats() {
    init();
    return PLANES.map(p => ({
      id: p.id, name: p.name, desc: p.desc,
      total: AL.planes[p.id].total, recent: AL.planes[p.id].souls.length
    }));
  }

  function serialize() {
    init();
    const out = {};
    for (const pid in AL.planes) {
      const pl = AL.planes[pid];
      out[pid] = { total: pl.total, souls: pl.souls.slice(0, 150) };
    }
    return out;
  }
  function load(data) {
    init();
    if (!data) return;
    for (const pid in data) {
      if (!AL.planes[pid]) continue;
      AL.planes[pid].total = data[pid].total || 0;
      AL.planes[pid].souls = data[pid].souls || [];
      AL.planes[pid].world = null; AL.planes[pid].sim = null; // re-materialize on visit
    }
  }

  global.PD.Afterlife = { PLANES, AL, init, receiveSoul, materialize, resurrect, judgeSoul, stats, serialize, load, routePlane };
})(window);
