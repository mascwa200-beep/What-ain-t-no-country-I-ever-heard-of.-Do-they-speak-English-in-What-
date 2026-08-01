/* =========================================================================
   PIXEL DEITY — game.js
   The conductor: game loop, faith economy, input, camera, save/load with
   offline progress, and all UI wiring. Infinite play, autosaved.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;
  const Sim = PD.Sim;
  const Render = PD.Render;
  const Powers = PD.Powers;
  const Audio8 = PD.Audio8;

  const WORLD_W = 180, WORLD_H = 120;
  const SAVE_KEY = 'pixeldeity_save_v1';
  const STEP_MS = 1000 / 6;   // base sim step cadence at speed x1
  const $ = (s) => document.querySelector(s);

  const G = {
    world: null, sim: null, r: null,
    faith: 40, faithTotal: 0,
    power: null, lastRace: 'human',
    speed: 1, paused: false,
    acc: 0, lastT: 0,
    selected: null,
    weather: 'clear', weatherT: 0,
    flash: 0, shake: 0,
    era: 0,
    ui: { showLabels: true, overUI: false, mouseW: null, brushRadius: 1, brushColor: '#fff' },
    running: false,
    saveTimer: 0,
    lastSaveTime: 0,
    stats: { born: 0, died: 0, peakPop: 0 }
  };
  global.G = G;

  // ================= World lifecycle =================
  function newWorld(seedStr, keepFaith) {
    seedStr = seedStr || ('' + (Date.now() % 1000000) + Math.floor(performance.now()));
    G.world = W.createWorld(WORLD_W, WORLD_H, seedStr);
    G.sim = Sim.createSim(G.world, PD.makeRNG(PD.hashSeed(seedStr) ^ 0x9e3779b9));
    if (!keepFaith) { G.faith = 40; G.faithTotal = 0; }
    G.selected = null;
    G.world.dirtyMini = true;
    if (G.r) { G.r.world = G.world; Render.renderTerrain(G.r); G.r.cam.x = WORLD_W / 2; G.r.cam.y = WORLD_H / 2; G.r.cam.zoom = 4; }
    seedInitialLife();
    Sim.recount(G.sim);
    refreshHUD();
  }

  function seedInitialLife() {
    // sprinkle starting critters + a few villages for a world that's alive
    // from the very first second
    for (let k = 0; k < 40; k++) {
      const x = (G.sim.rng() * WORLD_W) | 0, y = (G.sim.rng() * WORLD_H) | 0;
      const s = W.nearestLand(G.world, x, y, 12);
      if (s) Sim.spawnUnit(G.sim, G.sim.rng() < 0.15 ? 'wolf' : 'critter', s.x, s.y);
    }
    // seed 3 starter civilizations of different peoples on fertile ground,
    // spaced apart so they each have room to grow before they meet
    const races = ['human', 'elf', 'dwarf', 'orc'];
    let placed = 0; const spots = [];
    for (let attempt = 0; attempt < 300 && placed < 3; attempt++) {
      const x = (G.sim.rng() * WORLD_W) | 0, y = (G.sim.rng() * WORLD_H) | 0;
      if (!W.inBounds(G.world, x, y)) continue;
      const i = W.idx(G.world, x, y);
      if (!(W.isLand(G.world.biome[i]) && G.world.fert[i] > 0.35)) continue;
      let ok = true;
      for (const s of spots) if (PD.dist(s.x, s.y, x, y) < 35) { ok = false; break; }
      if (!ok) continue;
      Sim.foundVillage(G.sim, races[placed % races.length], x, y);
      spots.push({ x, y }); placed++;
    }
  }

  // ================= Faith economy =================
  function faithPerStep() {
    const c = G.sim.counts;
    const pop = c.human + c.elf + c.orc + c.dwarf;
    let temples = 0;
    for (const v of G.sim.villages) temples += v.temples;
    return 0.04 + pop * 0.014 + temples * 0.22;
  }

  // ================= Sim stepping =================
  function simStep() {
    const before = G.sim.units.length;
    Sim.step(G.sim, 1);
    const gain = faithPerStep();
    G.faith = Math.min(999999, G.faith + gain);
    G.faithTotal += gain;
    // era advances with total faith milestones
    const c = G.sim.counts;
    const pop = c.human + c.elf + c.orc + c.dwarf;
    if (pop > G.stats.peakPop) G.stats.peakPop = pop;
  }

  // ================= Offline progress =================
  function runOffline(elapsedSec) {
    const cap = 24 * 3600; // 24h cap
    elapsedSec = Math.min(elapsedSec, cap);
    if (elapsedSec < 20) return null;
    const stepsPerSec = 6;
    let steps = Math.floor(elapsedSec * stepsPerSec);
    const simCap = 6000; // bound compute
    const beforePop = countPop();
    const beforeFaith = G.faith;
    const beforeVills = G.sim.villages.length;
    // Simulate real steps but stop after a wall-clock budget so we never
    // freeze the page for long. Remaining time is credited as idle faith.
    const budgetMs = 1500;
    const start = performance.now();
    let done = 0;
    const target = Math.min(steps, simCap);
    for (let i = 0; i < target; i++) {
      simStep(); done++;
      if ((i & 63) === 0 && performance.now() - start > budgetMs) break;
    }
    // grant faith for the un-simulated remainder at the current rate
    const remaining = steps - done;
    if (remaining > 0) {
      G.faith = Math.min(999999, G.faith + remaining * faithPerStep() * 0.6);
    }
    Sim.recount(G.sim);
    return {
      time: elapsedSec,
      faith: Math.floor(G.faith - beforeFaith),
      popDelta: countPop() - beforePop,
      villDelta: G.sim.villages.length - beforeVills,
      pop: countPop(), vills: G.sim.villages.length
    };
  }
  function countPop() {
    const c = G.sim.counts; return c.human + c.elf + c.orc + c.dwarf + c.undead;
  }

  // ================= Save / Load =================
  function serialize() {
    const w = G.world, s = G.sim;
    return {
      v: 1, t: Date.now(),
      seed: w.seedStr,
      faith: G.faith, faithTotal: G.faithTotal, lastRace: G.lastRace,
      speed: G.speed, stats: G.stats,
      cam: { x: G.r.cam.x, y: G.r.cam.y, zoom: G.r.cam.zoom },
      // terrain deltas: store full arrays compactly (base64 of typed arrays)
      biome: b64(w.biome), elev: f32b64(w.elev), moist: f32b64(w.moist),
      temp: f32b64(w.temp), fert: f32b64(w.fert), tree: b64(w.tree),
      owner: i16b64(w.owner), struct: b64(w.struct),
      tick: s.tick, nextUnitId: s.nextUnitId, nextVillageId: s.nextVillageId,
      villages: s.villages,
      units: s.units.filter(u => !u.dead).map(u => [u.id, u.race, +u.x.toFixed(2), +u.y.toFixed(2), Math.round(u.hp), u.age | 0, u.village, u.sick | 0, +u.food.toFixed(2)])
    };
  }

  function save() {
    try {
      const data = serialize();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      G.lastSaveTime = Date.now();
      flashToast('Saved');
      return true;
    } catch (e) { console.warn('save failed', e); flashToast('Save failed (storage full?)'); return false; }
  }

  function load() {
    let raw;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    let d;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    if (!d || !d.seed) return false;
    try {
      G.world = W.createWorld(WORLD_W, WORLD_H, d.seed);
      const w = G.world;
      w.biome.set(ub64(d.biome)); w.elev.set(uf32b64(d.elev)); w.moist.set(uf32b64(d.moist));
      w.temp.set(uf32b64(d.temp)); w.fert.set(uf32b64(d.fert)); w.tree.set(ub64(d.tree));
      w.owner.set(ui16b64(d.owner)); w.struct.set(ub64(d.struct));
      w.dirty = true; w.dirtyMini = true;
      G.sim = Sim.createSim(w, PD.makeRNG(PD.hashSeed(d.seed) ^ 0x9e3779b9));
      G.sim.tick = d.tick || 0; G.sim.nextUnitId = d.nextUnitId || 1; G.sim.nextVillageId = d.nextVillageId || 1;
      G.sim.villages = d.villages || [];
      G.sim.units = (d.units || []).map(a => {
        const R = Sim.RACES[a[1]] || Sim.RACES.human;
        return { id: a[0], race: a[1], x: a[2], y: a[3], hp: a[4], maxHp: R.hp, age: a[5], village: a[6], sick: a[7], food: a[8],
                 adultAt: 70, lifespan: R.lifespan, state: 'wander', tx: a[2], ty: a[3], cd: 0, breedCd: 40, flip: 1, bob: Math.random() * 6.28 };
      });
      Sim.recount(G.sim);
      G.faith = d.faith != null ? d.faith : 40;
      G.faithTotal = d.faithTotal || 0;
      G.lastRace = d.lastRace || 'human';
      G.speed = d.speed || 1;
      G.stats = d.stats || G.stats;
      if (G.r) { G.r.world = w; Render.renderTerrain(G.r);
        if (d.cam) { G.r.cam.x = d.cam.x; G.r.cam.y = d.cam.y; G.r.cam.zoom = d.cam.zoom; } }
      // offline progress
      const elapsed = (Date.now() - (d.t || Date.now())) / 1000;
      const off = runOffline(elapsed);
      if (off) showOffline(off);
      return true;
    } catch (e) {
      console.warn('load failed', e);
      // a corrupted save could leave world/sim/renderer pointing at
      // different objects — rebuild everything fresh so the game stays sane
      wipeSave();
      newWorld(undefined, false);
      return false;
    }
  }

  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function wipeSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  // typed array <-> base64 helpers (chunked to avoid call-stack overflow)
  function bytesToStr(u8) { let s = ''; const CH = 8192; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return s; }
  function b64(arr) { return btoa(bytesToStr(new Uint8Array(arr.buffer))); }
  function f32b64(arr) { return btoa(bytesToStr(new Uint8Array(arr.buffer))); }
  function i16b64(arr) { return btoa(bytesToStr(new Uint8Array(arr.buffer))); }
  function strToBytes(str) { const u8 = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i); return u8; }
  function ub64(s) { return strToBytes(atob(s)); }
  function uf32b64(s) { return new Float32Array(strToBytes(atob(s)).buffer); }
  function ui16b64(s) { return new Int16Array(strToBytes(atob(s)).buffer); }

  // ================= Selection =================
  G.selectAt = function (wx, wy) {
    // nearest unit within 1.5 tiles
    let best = null, bd = 2.2;
    for (const u of G.sim.units) {
      if (u.dead) continue;
      const d = PD.dist(u.x + 0.5, u.y + 0.5, wx, wy);
      if (d < bd) { bd = d; best = u; }
    }
    if (best) { G.selected = { type: 'unit', ref: best }; Audio8.sfx('select'); refreshPanel(); return; }
    // village by owned tile / center
    const ix = Math.round(wx), iy = Math.round(wy);
    if (W.inBounds(G.world, ix, iy)) {
      const o = G.world.owner[W.idx(G.world, ix, iy)];
      if (o >= 0) { const v = Sim.villageById(G.sim, o); if (v) { G.selected = { type: 'village', ref: v }; Audio8.sfx('select'); refreshPanel(); return; } }
      // nearest village center
      let bv = null, bvd = 6;
      for (const v of G.sim.villages) { const d = PD.dist(v.x, v.y, wx, wy); if (d < bvd) { bvd = d; bv = v; } }
      if (bv) { G.selected = { type: 'village', ref: bv }; Audio8.sfx('select'); refreshPanel(); return; }
    }
    // tile info
    if (W.inBounds(G.world, ix, iy)) { G.selected = { type: 'tile', x: ix, y: iy }; refreshPanel(); }
  };

  // ================= Weather =================
  G.setWeather = function (type, dur) { G.weather = type; G.weatherT = dur; if (G.r) G.r.weather = type; };

  // ================= Powers =================
  function setPower(id) {
    const p = Powers.BY_ID[id];
    if (!p) return;
    G.power = Object.assign({}, p); // clone so radius editable
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

    // camera keyboard pan
    handleKeyPan(dt);

    if (!G.paused && G.speed > 0) {
      G.acc += dt * G.speed;
      let guard = 0;
      while (G.acc >= STEP_MS && guard < 40) { simStep(); G.acc -= STEP_MS; guard++; }
    }

    // weather timer
    if (G.weatherT > 0) { G.weatherT -= dt / STEP_MS; if (G.weatherT <= 0) { G.weather = 'clear'; G.r.weather = 'clear'; } }
    // seasonal auto-weather ambiance
    autoWeather();

    // fx update
    Render.FX.update();
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt / 300);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt / 30);

    // camera shake
    const sc = G.shake;
    if (sc > 0) { G.r.ctx.save(); G.r.ctx.translate((Math.random() - 0.5) * sc, (Math.random() - 0.5) * sc); }
    Render.draw(G.r, G.sim, G.ui);
    if (sc > 0) G.r.ctx.restore();

    // divine flash overlay
    if (G.flash > 0) { const c = G.r.ctx; c.fillStyle = `rgba(255,255,255,${G.flash * 0.5})`; c.fillRect(0, 0, G.r.w, G.r.h); }

    // HUD refresh (throttled)
    G.hudTimer = (G.hudTimer || 0) + dt;
    if (G.hudTimer > 250) { refreshHUD(); if (G.selected) refreshPanel(); G.hudTimer = 0; }

    // autosave
    G.saveTimer += dt;
    if (G.saveTimer > 20000) { save(); G.saveTimer = 0; }

    requestAnimationFrame(loop);
  }

  function autoWeather() {
    // occasionally trigger seasonal weather if clear
    if (G.weather !== 'clear') return;
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
    cam.x = PD.clamp(cam.x, 0, WORLD_W);
    cam.y = PD.clamp(cam.y, 0, WORLD_H);
  }

  function bindInput() {
    const cv = G.r.canvas;
    let dragging = false, panning = false, lastX = 0, lastY = 0, moved = 0, downX = 0, downY = 0;

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
      if (spent > 0) { G.faith -= spent; refreshHUD(); }
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
      lastX = l.x; lastY = l.y; downX = l.x; downY = l.y; moved = 0;
      // minimap takes priority: jump the camera, never fire a power there
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
    global.addEventListener('mouseup', (e) => {
      if (panning && moved < 5 && G.power && G.power.id === 'inspect') applyPower(lastX, lastY);
      dragging = false; panning = false;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const l = localXY(e);
      const before = Render.screenToWorld(G.r, l.x, l.y);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      G.r.cam.zoom = PD.clamp(G.r.cam.zoom * factor, G.r.cam.min, G.r.cam.max);
      const after = Render.screenToWorld(G.r, l.x, l.y);
      G.r.cam.x += before.x - after.x; G.r.cam.y += before.y - after.y;
      clampCam();
    }, { passive: false });

    // ---- touch ----
    let pinchD = 0, touchPanning = false;
    cv.addEventListener('touchstart', (e) => {
      Audio8.unlock();
      if (e.touches.length === 2) {
        pinchD = touchDist(e); touchPanning = false;
      } else {
        const l = localXY(e); lastX = l.x; lastY = l.y; downX = l.x; downY = l.y; moved = 0;
        if (onMinimap(l.x, l.y)) { jumpMinimap(l.x, l.y); e.preventDefault(); return; }
        const p = G.power;
        if (p && p.pan) touchPanning = true;
        else { dragging = true; applyPower(l.x, l.y); }
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const nd = touchDist(e);
        const mid = touchMid(e, cv);
        const before = Render.screenToWorld(G.r, mid.x, mid.y);
        G.r.cam.zoom = PD.clamp(G.r.cam.zoom * (nd / (pinchD || nd)), G.r.cam.min, G.r.cam.max);
        const after = Render.screenToWorld(G.r, mid.x, mid.y);
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
    cv.addEventListener('touchend', (e) => {
      if (touchPanning && moved < 8 && G.power && G.power.id === 'inspect') applyPower(lastX, lastY);
      dragging = false; touchPanning = false;
    });

    // ---- keyboard ----
    global.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase(); keys[k] = true;
      if (k === ' ') { e.preventDefault(); togglePause(); }
      else if (k === '1') setSpeed(1);
      else if (k === '2') setSpeed(2);
      else if (k === '3') setSpeed(4);
      else if (k === '0') setSpeed(0);
      else if (k === '=' || k === '+') zoomBy(1.2);
      else if (k === '-' || k === '_') zoomBy(1 / 1.2);
      else if (k === 'escape') { G.selected = null; refreshPanel(); setPower('pan'); }
      else if (k === 'l') { G.ui.showLabels = !G.ui.showLabels; }
      else if (k === 'm') { toggleMenu(); }
    });
    global.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    // brush radius via bracket keys / wheel+shift
    global.addEventListener('keydown', (e) => {
      if (e.key === '[') { if (G.power) G.power.radius = Math.max(0, G.power.radius - 1); G.ui.brushRadius = G.power.radius; }
      if (e.key === ']') { if (G.power) G.power.radius = Math.min(14, G.power.radius + 1); G.ui.brushRadius = G.power.radius; }
    });

    global.addEventListener('resize', () => G.r.resize());
    // save on unload
    global.addEventListener('beforeunload', () => { try { save(); } catch (e) {} });
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
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

  // ================= UI building =================
  function buildToolbar() {
    const wrap = $('#tools');
    wrap.innerHTML = '';
    for (const cat of Powers.CATEGORIES) {
      const group = document.createElement('div');
      group.className = 'tool-group';
      const h = document.createElement('div'); h.className = 'tool-group-title'; h.textContent = cat.name;
      group.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'tool-grid';
      for (const p of Powers.POWERS.filter(x => x.cat === cat.id)) {
        const btn = document.createElement('button');
        btn.className = 'tool'; btn.dataset.id = p.id;
        btn.innerHTML = `<span class="tool-ico">${p.icon}</span><span class="tool-name">${p.name}</span>` +
          (p.cost > 0 ? `<span class="tool-cost">✦${p.cost}</span>` : '');
        btn.title = p.desc;
        btn.addEventListener('mouseenter', () => updatePowerInfo(p, true));
        btn.addEventListener('mouseleave', () => updatePowerInfo(G.power, false));
        btn.addEventListener('click', () => setPower(p.id));
        grid.appendChild(btn);
      }
      group.appendChild(grid);
      wrap.appendChild(group);
    }
  }
  function highlightPower(id) {
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  }
  function updatePowerInfo(p, hover) {
    if (!p) return;
    $('#power-name').textContent = p.icon + ' ' + p.name;
    $('#power-desc').textContent = p.desc;
    $('#power-cost').textContent = p.cost > 0 ? ('Cost: ✦' + p.cost + (p.cont ? ' / touch' : '')) : 'Free';
  }

  // ================= HUD =================
  const RACE_ORDER = ['human', 'elf', 'orc', 'dwarf', 'undead', 'critter', 'wolf'];
  function refreshHUD() {
    $('#faith-val').textContent = Math.floor(G.faith);
    $('#faith-rate').textContent = '+' + faithPerStep().toFixed(1) + '/t';
    const c = G.sim.counts;
    const rc = $('#race-counts'); rc.innerHTML = '';
    for (const k of RACE_ORDER) {
      if (c[k] === 0 && k !== 'human') continue;
      const R = Sim.RACES[k];
      const el = document.createElement('span'); el.className = 'race-chip';
      el.innerHTML = `<i style="color:${R.col2};background:${R.col}"></i>${R.emoji}${c[k]}`;
      el.title = R.name;
      rc.appendChild(el);
    }
    const year = Math.floor(G.sim.tick / 120);
    $('#year-val').textContent = 'Year ' + year;
    $('#vill-val').textContent = '🏙 ' + G.sim.villages.length;
    $('#season-val').textContent = ['🌱 Spring', '☀ Summer', '🍂 Autumn', '❄ Winter'][G.sim.season];
    // event log
    const log = $('#event-log');
    if (log && G.sim.log.length) {
      log.innerHTML = G.sim.log.slice(0, 12).map(e => `<div class="log-line log-${e.kind}">${e.msg}</div>`).join('');
    }
  }

  // ================= Selection panel =================
  function refreshPanel() {
    const panel = $('#inspect');
    const sel = G.selected;
    if (!sel) { panel.classList.remove('show'); return; }
    panel.classList.add('show');
    let html = '';
    if (sel.type === 'unit') {
      const u = sel.ref;
      if (u.dead) { G.selected = null; panel.classList.remove('show'); return; }
      const R = Sim.RACES[u.race];
      html = `<div class="ins-title">${R.emoji} ${R.name.slice(0, -1) || R.name}</div>
        <div class="ins-row"><span>State</span><b>${u.state}${u.sick ? ' 🤢sick' : ''}</b></div>
        <div class="ins-bar"><span>HP</span>${bar(u.hp / u.maxHp, R.col2)}</div>
        <div class="ins-bar"><span>Food</span>${bar(u.food, '#7ac043')}</div>
        <div class="ins-row"><span>Age</span><b>${(u.age / 120).toFixed(1)} yr</b></div>
        <div class="ins-row"><span>Home</span><b>${u.village >= 0 ? (villName(u.village) || '—') : 'wild'}</b></div>`;
    } else if (sel.type === 'village') {
      const v = sel.ref;
      const R = Sim.RACES[v.race];
      html = `<div class="ins-title" style="color:${v.col}">${R.emoji} ${v.name}</div>
        <div class="ins-row"><span>People</span><b>${R.name}</b></div>
        <div class="ins-row"><span>Population</span><b>${v.pop}</b></div>
        <div class="ins-row"><span>Tier</span><b>${['Hamlet', 'Village', 'Town', 'City', 'Metropolis'][Math.min(4, v.level - 1)]} (lvl ${v.level})</b></div>
        <div class="ins-bar"><span>Prosperity</span>${bar(v.prosperity, '#f0c040')}</div>
        <div class="ins-row"><span>Food store</span><b>${Math.floor(v.food)}</b></div>
        <div class="ins-row"><span>Temples</span><b>${v.temples} ⛪</b></div>
        <div class="ins-row"><span>Founded</span><b>Year ${Math.floor(v.founded / 120)}</b></div>
        ${v.rival >= 0 ? `<div class="ins-row war"><span>At war with</span><b>${villName(v.rival) || '?'}</b></div>` : ''}
        <button class="ins-smite" id="smite-btn">⚡ Smite this town</button>`;
    } else if (sel.type === 'tile') {
      const i = W.idx(G.world, sel.x, sel.y);
      const bn = ['Deep Ocean', 'Water', 'Sand', 'Grassland', 'Forest', 'Dirt', 'Mountain', 'Snow', 'Desert', 'Jungle', 'Swamp', 'Ash'][G.world.biome[i]];
      html = `<div class="ins-title">📍 Tile ${sel.x},${sel.y}</div>
        <div class="ins-row"><span>Biome</span><b>${bn}</b></div>
        <div class="ins-bar"><span>Elevation</span>${bar(G.world.elev[i], '#8a6a48')}</div>
        <div class="ins-bar"><span>Fertility</span>${bar(G.world.fert[i], '#5aa03c')}</div>
        <div class="ins-bar"><span>Moisture</span>${bar(G.world.moist[i], '#245e8f')}</div>
        ${G.world.fire[i] ? '<div class="ins-row war"><span>🔥 On fire</span></div>' : ''}`;
    }
    html += `<button class="ins-close" id="ins-close">✕ close</button>`;
    panel.innerHTML = html;
    const sb = $('#smite-btn'); if (sb) sb.onclick = () => { const v = G.selected.ref; Powers.BY_ID.lightning.apply(G, v.x, v.y); };
    const cb = $('#ins-close'); if (cb) cb.onclick = () => { G.selected = null; panel.classList.remove('show'); };
  }
  function bar(v, col) { v = PD.clamp(v, 0, 1); return `<div class="bar"><div class="bar-fill" style="width:${(v * 100).toFixed(0)}%;background:${col}"></div></div>`; }
  function villName(id) { const v = Sim.villageById(G.sim, id); return v ? v.name : null; }

  // ================= Toasts / modals =================
  let toastT;
  function flashToast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600);
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
    // must create world before renderer
    const started = hasSave();
    // create a temporary world so renderer exists; load() replaces if save present
    newWorld(undefined, false);
    G.r = Render.createRenderer(canvas, G.world);
    G.r.resize();

    buildToolbar();
    setPower('pan');
    G.lastRace = 'human';

    // wire top buttons
    document.querySelectorAll('.speed-btn').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('#btn-menu').addEventListener('click', toggleMenu);
    $('#btn-save').addEventListener('click', () => save());
    $('#btn-labels').addEventListener('click', () => { G.ui.showLabels = !G.ui.showLabels; $('#btn-labels').classList.toggle('off', !G.ui.showLabels); });
    $('#btn-sound').addEventListener('click', () => {
      const on = !Audio8.isEnabled(); Audio8.setEnabled(on); Audio8.setMusic(on);
      $('#btn-sound').textContent = on ? '🔊' : '🔇';
      if (on) Audio8.unlock();
    });

    // menu actions
    $('#menu-new').addEventListener('click', () => {
      if (confirm('Begin a NEW world? Your current world will be overwritten.')) {
        wipeSave(); newWorld(undefined, false); Render.FX.clear(); $('#menu-modal').classList.remove('show'); flashToast('A new world is born');
      }
    });
    $('#menu-resume').addEventListener('click', () => $('#menu-modal').classList.remove('show'));
    $('#menu-save').addEventListener('click', () => { save(); });
    $('#menu-regen-seed').addEventListener('click', () => {
      const s = prompt('Enter a world seed (any text):', G.world.seedStr);
      if (s != null) { wipeSave(); newWorld(s, false); Render.FX.clear(); $('#menu-modal').classList.remove('show'); flashToast('World seed: ' + s); }
    });

    // intro / offline close
    $('#offline-close') && $('#offline-close').addEventListener('click', () => $('#offline-modal').classList.remove('show'));
    $('#intro-start').addEventListener('click', () => {
      $('#intro').classList.add('hide'); Audio8.unlock();
    });

    bindInput();

    // try load save (replaces world + may show offline)
    if (started) {
      const ok = load();
      if (ok) { $('#intro').classList.add('hide'); }
    }
    // if no save, seed already created via newWorld

    setSpeed(G.speed || 1);
    refreshHUD();

    G.running = true; G.lastT = performance.now();
    requestAnimationFrame(loop);
  }

  global.PixelDeity = { boot, save, load, G };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
