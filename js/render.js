/* =========================================================================
   PIXEL DEITY — render.js
   Retro renderer: cached terrain layer, structures, unit sprites, weather,
   day/night, and a particle FX system. Everything drawn as chunky pixels.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;
  const B = W.B, S = W.S;

  const TILE = 8; // offscreen pixels per tile

  // ---- Particle FX -----------------------------------------------------
  const FX = (function () {
    const parts = [];
    const MAX = 1400;
    function add(p) { if (parts.length < MAX) parts.push(p); }
    return {
      parts,
      spawn(x, y, vx, vy, life, color, size, grav) {
        add({ x, y, vx, vy, life, max: life, color, size: size || 1, grav: grav || 0 });
      },
      blood(x, y) {
        for (let i = 0; i < 4; i++) this.spawn(x, y, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15 - 0.05, 16 + Math.random() * 10, '#b02a2a', 1, 0.006);
      },
      hit(x, y) {
        for (let i = 0; i < 3; i++) this.spawn(x, y, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 8, '#ffe066', 1);
      },
      puff(x, y, col) {
        for (let i = 0; i < 8; i++) this.spawn(x, y, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12 - 0.03, 22, col || '#cfd6df', 2);
      },
      spark(x, y, col) {
        for (let i = 0; i < 10; i++) this.spawn(x, y, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 18, col || '#ffe680', 1);
      },
      fireBurst(x, y) {
        for (let i = 0; i < 14; i++) this.spawn(x, y, (Math.random() - 0.5) * 0.25, -Math.random() * 0.25, 20 + Math.random() * 14, ['#ff5722', '#ffb020', '#ffe066'][(Math.random() * 3) | 0], 2, -0.004);
      },
      explosion(x, y, big) {
        const n = big ? 60 : 26;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * 6.28, s = Math.random() * (big ? 0.6 : 0.35);
          this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 22 + Math.random() * 22, ['#fff2a0', '#ff9a20', '#ff4020', '#7a2a10'][(Math.random() * 4) | 0], big ? 3 : 2, 0.002);
        }
      },
      lightning(x, y) {
        for (let i = 0; i < 22; i++) this.spawn(x, y, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 12, '#d0e8ff', 2);
      },
      ring: [], // expanding shockwave rings
      shock(x, y, r, col) { this.ring.push({ x, y, r: 0, max: r, life: 22, max2: 22, color: col || '#ffffff' }); },
      bolts: [], // lightning bolt polylines {pts, life}
      bolt(x0, y0, x1, y1) {
        const pts = [[x0, y0]];
        const seg = 8;
        for (let i = 1; i < seg; i++) {
          const t = i / seg;
          pts.push([PD.lerp(x0, x1, t) + (Math.random() - 0.5) * 1.5, PD.lerp(y0, y1, t) + (Math.random() - 0.5) * 1.5]);
        }
        pts.push([x1, y1]);
        this.bolts.push({ pts, life: 8, max: 8 });
      },
      update() {
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.life--;
          if (p.life <= 0) parts.splice(i, 1);
        }
        for (let i = this.ring.length - 1; i >= 0; i--) {
          const r = this.ring[i]; r.r += r.max / r.max2; r.life--;
          if (r.life <= 0) this.ring.splice(i, 1);
        }
        for (let i = this.bolts.length - 1; i >= 0; i--) { if (--this.bolts[i].life <= 0) this.bolts.splice(i, 1); }
      },
      clear() { parts.length = 0; this.ring.length = 0; this.bolts.length = 0; }
    };
  })();
  PD.FX = FX;

  // ---- Renderer --------------------------------------------------------
  function createRenderer(canvas, world) {
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;

    // offscreen terrain buffer at TILE px/tile
    const terra = document.createElement('canvas');
    terra.width = world.W * TILE; terra.height = world.H * TILE;
    const tctx = terra.getContext('2d');
    tctx.imageSmoothingEnabled = false;

    const cam = { x: world.W / 2, y: world.H / 2, zoom: 4, min: 1.2, max: 22 };

    const r = {
      ctx, canvas, world, terra, tctx, cam,
      w: 0, h: 0, dpr: 1,
      weather: 'clear', // clear | rain | snow
      rainDrops: [], snowFlakes: [],
      resize() {
        this.dpr = Math.min(2, global.devicePixelRatio || 1);
        this.w = canvas.clientWidth; this.h = canvas.clientHeight;
        canvas.width = Math.floor(this.w * this.dpr);
        canvas.height = Math.floor(this.h * this.dpr);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
        this.initWeather();
      },
      initWeather() {
        this.rainDrops = [];
        for (let i = 0; i < 220; i++) this.rainDrops.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: 3 + Math.random() * 4 });
        this.snowFlakes = [];
        for (let i = 0; i < 160; i++) this.snowFlakes.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: 0.5 + Math.random() * 1, d: Math.random() * 6.28 });
      }
    };

    renderTerrain(r);
    r.resize();
    return r;
  }

  // Paint one tile (terrain + structure) into the offscreen terrain cache.
  // Everything a tile draws stays inside its own TILE x TILE cell, which is
  // what makes cheap per-tile invalidation possible.
  function renderTileAt(w, t, x, y) {
    const i = W.idx(w, x, y);
    const b = w.biome[i];
    const px = x * TILE, py = y * TILE;
    t.fillStyle = W.BIOME_COLORS[b];
    t.fillRect(px, py, TILE, TILE);
    // dither speckle for texture (Bayer 2x2-ish via tile parity)
    if ((x + y) & 1) {
      t.fillStyle = W.BIOME_COLORS2[b];
      t.fillRect(px, py, TILE / 2, TILE / 2);
      t.fillRect(px + TILE / 2, py + TILE / 2, TILE / 2, TILE / 2);
    }
    // coastline highlight on shallow water
    if (b === B.WATER && (x + y) % 3 === 0) {
      t.fillStyle = 'rgba(255,255,255,0.05)';
      t.fillRect(px, py + TILE - 2, TILE, 1);
    }
    // subtle relief on land
    if (W.isLand(b)) {
      if (w.elev[i] > 0.7) { t.fillStyle = 'rgba(255,255,255,0.10)'; t.fillRect(px, py, TILE, 1); }
      t.fillStyle = 'rgba(0,0,0,0.06)';
      t.fillRect(px, py + TILE - 1, TILE, 1);
    }
    if (w.tree[i] > 0) drawTree(t, px, py, b, w.tree[i]);
    if (w.struct[i]) drawStruct(t, px, py, w.struct[i], w.owner[i]);
  }

  function renderTerrain(r) {
    const w = r.world, t = r.tctx;
    for (let y = 0; y < w.H; y++) {
      for (let x = 0; x < w.W; x++) renderTileAt(w, t, x, y);
    }
    w.dirty = false;
    w.dirtyTiles.length = 0;
  }

  // Repaint only invalidated tiles (the common case each frame)
  function renderDirtyTiles(r) {
    const w = r.world, t = r.tctx;
    const tiles = w.dirtyTiles;
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k];
      renderTileAt(w, t, i % w.W, (i / w.W) | 0);
    }
    tiles.length = 0;
  }

  function drawTree(t, px, py, biome, dens) {
    const trunk = '#5a3a20';
    const leaf = biome === B.JUNGLE ? '#1c6b31' : biome === B.SWAMP ? '#3f5a30' : '#276128';
    const leaf2 = biome === B.JUNGLE ? '#2f8f45' : '#3a8a3c';
    // a couple of little pixel trees per tile
    const spots = dens >= 3 ? [[1, 3], [4, 1], [5, 4]] : dens === 2 ? [[2, 2], [5, 4]] : [[3, 3]];
    for (const [ox, oy] of spots) {
      t.fillStyle = trunk; t.fillRect(px + ox + 1, py + oy + 2, 1, 2);
      t.fillStyle = leaf; t.fillRect(px + ox, py + oy, 3, 3);
      t.fillStyle = leaf2; t.fillRect(px + ox, py + oy, 1, 1);
    }
  }

  function ownerTint(owner) {
    // deterministic-ish subtle tint by owner id
    return null;
  }

  function drawStruct(t, px, py, s, owner) {
    switch (s) {
      case S.HOUSE:
        t.fillStyle = '#7a4a28'; t.fillRect(px + 1, py + 3, 6, 4);
        t.fillStyle = '#a86a3a'; t.fillRect(px + 1, py + 2, 6, 1);
        t.fillStyle = '#c98a4a'; t.fillRect(px, py + 2, 8, 1);
        t.fillStyle = '#3a2414'; t.fillRect(px + 3, py + 5, 2, 2); // door
        break;
      case S.TOWN:
        t.fillStyle = '#8a5a30'; t.fillRect(px, py + 2, 8, 5);
        t.fillStyle = '#caa060'; t.fillRect(px, py + 1, 8, 1);
        t.fillStyle = '#d94a3a'; t.fillRect(px + 3, py, 2, 3); // banner
        t.fillStyle = '#2a1a0a'; t.fillRect(px + 3, py + 4, 2, 3);
        break;
      case S.FARM:
        t.fillStyle = '#7a5a2a'; t.fillRect(px, py + 1, 8, 6);
        t.fillStyle = '#b89a3a';
        t.fillRect(px, py + 2, 8, 1); t.fillRect(px, py + 4, 8, 1); t.fillRect(px, py + 6, 8, 1);
        break;
      case S.TEMPLE:
        t.fillStyle = '#e8e2d0'; t.fillRect(px + 1, py + 2, 6, 5);
        t.fillStyle = '#c8c0a8'; t.fillRect(px, py + 2, 8, 1);
        t.fillStyle = '#f0d040'; t.fillRect(px + 3, py, 2, 2); // gold top
        t.fillStyle = '#9a9078'; t.fillRect(px + 2, py + 4, 1, 3); t.fillRect(px + 5, py + 4, 1, 3);
        break;
      case S.TOWER:
        t.fillStyle = '#7d7f88'; t.fillRect(px + 2, py, 4, 8);
        t.fillStyle = '#9a9ca6'; t.fillRect(px + 2, py, 4, 1);
        t.fillStyle = '#40444a'; t.fillRect(px + 2, py + 1, 1, 1); t.fillRect(px + 4, py + 1, 1, 1);
        break;
      case S.RUIN:
        t.fillStyle = '#6a6258'; t.fillRect(px + 1, py + 4, 2, 3); t.fillRect(px + 5, py + 3, 2, 4);
        t.fillStyle = '#4a4238'; t.fillRect(px + 3, py + 5, 1, 2);
        break;
    }
  }

  // world -> screen transform (wrap-aware: entities near the seam appear on
  // the side nearest the camera — the world is round)
  function worldToScreen(r, wx, wy) {
    const cz = r.cam.zoom;
    return {
      x: W.wrapDX(r.world, r.cam.x, wx) * cz + r.w / 2,
      y: (wy - r.cam.y) * cz + r.h / 2
    };
  }
  function screenToWorld(r, sx, sy) {
    const cz = r.cam.zoom;
    return {
      x: W.wrapX(r.world, (sx - r.w / 2) / cz + r.cam.x),
      y: (sy - r.h / 2) / cz + r.cam.y
    };
  }
  // unwrapped variant for viewport range loops (x may exceed [0,W))
  function screenToWorldRaw(r, sx, sy) {
    const cz = r.cam.zoom;
    return {
      x: (sx - r.w / 2) / cz + r.cam.x,
      y: (sy - r.h / 2) / cz + r.cam.y
    };
  }

  // ---- unit sprite drawing (chunky pixel figures) ----------------------
  function drawUnit(ctx, r, u, sim) {
    const R = PD.Sim.RACES[u.race];
    const s = worldToScreen(r, u.x + 0.5, u.y + 0.5);
    const cz = r.cam.zoom;
    if (s.x < -20 || s.y < -20 || s.x > r.w + 20 || s.y > r.h + 20) return;
    const px = cz / TILE; // pixel unit size (scale)
    let P = Math.max(1, cz * 0.14); // sprite pixel size
    if (R.big) P *= R.big;          // giants, trolls, dragons loom
    const flying = R.flies;
    const bob = Math.sin(u.bob) * P * (flying ? 0.7 : 0.35);
    const bx = s.x, by = s.y - P * 2 + bob - (flying ? P * 1.2 : 0);
    const fl = u.flip;
    function rect(ox, oy, w2, h2, col) {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(bx + ox * P * fl - (fl < 0 ? w2 * P : 0)), Math.round(by + oy * P), Math.max(1, w2 * P), Math.max(1, h2 * P));
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round(bx - P * 1.2), Math.round(s.y + P * 0.6), Math.max(2, P * 2.4), Math.max(1, P));

    const body = R.col, dark = R.col2;
    if (R.ghost) ctx.globalAlpha = 0.55; // spirits shimmer, half-here
    if (u.race === 'critter') {
      rect(-1, 0, 2, 1.5, body); rect(-1.5, -0.5, 1, 1, body); // head bump
      rect(1, -0.2, 0.6, 0.6, body); // ear
      rect(-1.6, 0.2, 0.4, 0.4, '#222');
    } else if (u.race === 'wolf' || u.race === 'werewolf') {
      rect(-1.5, 0, 3, 1.2, body); rect(1, -0.4, 1, 1, body); rect(-2, 0.4, 0.6, 0.8, dark);
      rect(1.4, -0.2, 0.4, 0.4, '#e33');
    } else if (u.race === 'dragon') {
      // long body, wings, snout, tail
      rect(-2, 0, 4, 1.4, body); rect(1.6, -0.6, 1.4, 1.2, body); rect(2.8, -0.3, 0.6, 0.5, dark); // head/snout
      rect(-2.8, 0.2, 1, 0.7, dark); // tail
      const wingBeat = Math.sin(u.bob * 2) * 0.8;
      rect(-1, -1.4 - wingBeat, 2.2, 1, dark); // wing
      rect(2.2, -0.5, 0.3, 0.3, '#ffe066'); // eye
    } else {
      // wings behind the body (fairies, angels, demons)
      if (R.flies && !R.ghost) {
        const wingBeat = Math.sin(u.bob * 3) * 0.5;
        const wcol = u.race === 'demon' ? '#5a1a1a' : 'rgba(255,255,255,0.8)';
        rect(-1.8, -1.2 - wingBeat, 0.9, 1.6, wcol);
        rect(0.9, -1.2 + wingBeat, 0.9, 1.6, wcol);
      }
      // bipedal: legs, body, head
      rect(-0.7, 1, 0.6, 1, dark); rect(0.2, 1, 0.6, 1, dark); // legs
      rect(-0.9, -0.4, 1.8, 1.6, body); // torso
      const headCol = u.race === 'undead' ? '#cdd6d8' : R.ghost ? '#e8f0f4' : (R.custom ? body : '#f0c8a0');
      rect(-0.6, -1.6, 1.2, 1.2, headCol); // head
      if (u.race === 'undead') { rect(-0.4, -1.3, 0.3, 0.3, '#711'); rect(0.2, -1.3, 0.3, 0.3, '#711'); }
      if (R.horns) { rect(-0.7, -2.1, 0.3, 0.6, dark); rect(0.4, -2.1, 0.3, 0.6, dark); }
      if (R.tail) rect(-1.4, 0.4, 0.6, 0.4, dark);
      // paragon cape + glow
      if (u.paragon > 0) {
        rect(-1.1, -0.4, 0.4, 2, '#d43a3a');
        if (sim.tick & 8) { ctx.fillStyle = 'rgba(255,224,102,0.35)'; ctx.fillRect(Math.round(bx - P * 1.4), Math.round(by - P * 2), Math.max(2, P * 2.8), Math.max(2, P * 4)); }
      }
      // weapon when fighting
      if (u.state === 'fight') rect(0.9, -0.8, 0.35, 1.8, '#cfd6df');
      // village banner color accent
      rect(-0.9, -0.4, 1.8, 0.4, dark);
    }
    if (R.ghost) ctx.globalAlpha = 1;
    // sickness tint
    if (u.sick > 0) { ctx.fillStyle = 'rgba(120,220,80,0.35)'; ctx.fillRect(Math.round(bx - P * 1.2), Math.round(by - P * 1.8), Math.max(2, P * 2.4), Math.max(2, P * 3.4)); }
    // low hp flash
    if (u.hp < u.maxHp * 0.3 && (sim.tick & 4)) { ctx.fillStyle = 'rgba(255,60,40,0.3)'; ctx.fillRect(Math.round(bx - P), Math.round(by - P * 1.6), Math.max(2, P * 2), Math.max(2, P * 3)); }
  }

  // ---- main frame draw -------------------------------------------------
  function draw(r, sim, ui) {
    const ctx = r.ctx, cam = r.cam, world = r.world;
    if (world.dirty) renderTerrain(r);
    else if (world.dirtyTiles.length) renderDirtyTiles(r);

    // background void
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, r.w, r.h);

    // draw terrain (scaled) — three copies so the round world wraps
    // seamlessly past the antimeridian
    const cz = cam.zoom;
    const scale = cz / TILE;
    const sw = world.W * TILE * scale, sh = world.H * TILE * scale;
    const ox = r.w / 2 - cam.x * cz;
    const oy = r.h / 2 - cam.y * cz;
    ctx.imageSmoothingEnabled = false;
    for (let k = -1; k <= 1; k++) {
      const kx = ox + k * sw;
      if (kx > r.w || kx + sw < 0) continue;
      ctx.drawImage(r.terra, 0, 0, r.terra.width, r.terra.height, kx, oy, sw, sh);
    }

    // territory borders (thin owner outlines) — only when zoomed enough
    if (cz > 3) drawBorders(r, sim);

    // fire glow overlay
    drawFire(r);

    // units sorted by y for pseudo-depth
    const vis = [];
    for (const u of sim.units) { if (!u.dead) vis.push(u); }
    vis.sort((a, b) => a.y - b.y);
    for (const u of vis) drawUnit(ctx, r, u, sim);

    // particles
    drawParticles(r);

    // village labels
    if (cz > 2.4 && ui.showLabels) drawLabels(r, sim);

    // selection / brush cursor
    drawCursor(r, ui);

    // weather + day/night
    drawWeather(r, sim);
    drawDayNight(r, sim, ui);

    // minimap
    drawMinimap(r, sim);
  }

  function drawBorders(r, sim) {
    const ctx = r.ctx, world = r.world, cz = r.cam.zoom;
    const topLeft = screenToWorldRaw(r, 0, 0), botRight = screenToWorldRaw(r, r.w, r.h);
    const x0 = Math.floor(topLeft.x), y0 = Math.max(0, Math.floor(topLeft.y));
    const x1 = Math.ceil(botRight.x), y1 = Math.min(world.H - 1, Math.ceil(botRight.y));
    // precompute owner-id -> rgba string once per frame instead of per edge
    const cols = new Map();
    for (const v of sim.villages) cols.set(v.id, hexA(v.col, 0.5));
    const fallback = 'rgba(255,255,255,0.2)';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = W.idx(world, x, y);
        const o = world.owner[i];
        if (o < 0) continue;
        // draw edge where neighbor differs (x neighbor wraps the seam)
        const right = world.owner[W.idx(world, x + 1, y)];
        const down = y < world.H - 1 ? world.owner[i + world.W] : -2;
        if (right !== o || down !== o) {
          ctx.fillStyle = cols.get(o) || fallback;
          const s = worldToScreen(r, x, y);
          if (right !== o) ctx.fillRect(Math.round(s.x + cz - 1), Math.round(s.y), 1, Math.ceil(cz));
          if (down !== o) ctx.fillRect(Math.round(s.x), Math.round(s.y + cz - 1), Math.ceil(cz), 1);
        }
      }
    }
  }

  function drawFire(r) {
    const ctx = r.ctx, world = r.world, cz = r.cam.zoom;
    const topLeft = screenToWorldRaw(r, 0, 0), botRight = screenToWorldRaw(r, r.w, r.h);
    const x0 = Math.floor(topLeft.x), y0 = Math.max(0, Math.floor(topLeft.y));
    const x1 = Math.ceil(botRight.x), y1 = Math.min(world.H - 1, Math.ceil(botRight.y));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const f = world.fire[W.idx(world, x, y)];
        if (f === 0) continue;
        const s = worldToScreen(r, x, y);
        const a = f / 255;
        ctx.fillStyle = `rgba(255,${80 + (a * 120) | 0},20,${0.35 + a * 0.4})`;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.ceil(cz), Math.ceil(cz));
        if (Math.random() < 0.25 * a) FX.spawn(x + Math.random(), y + Math.random(), 0, -0.04 - Math.random() * 0.05, 14, ['#ff7020', '#ffc040'][(Math.random() * 2) | 0], 1, -0.003);
      }
    }
  }

  function drawParticles(r) {
    const ctx = r.ctx, cz = r.cam.zoom;
    for (const p of FX.parts) {
      const s = worldToScreen(r, p.x, p.y);
      const a = p.life / p.max;
      ctx.globalAlpha = Math.min(1, a * 1.4);
      ctx.fillStyle = p.color;
      const sz = Math.max(1, p.size * cz * 0.12);
      ctx.fillRect(Math.round(s.x), Math.round(s.y), sz, sz);
    }
    ctx.globalAlpha = 1;
    // shock rings
    for (const rg of FX.ring) {
      const s = worldToScreen(r, rg.x, rg.y);
      ctx.strokeStyle = hexA(rg.color, rg.life / rg.max2 * 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, rg.r * cz, 0, 6.283); ctx.stroke();
    }
    // bolts
    for (const bl of FX.bolts) {
      ctx.strokeStyle = hexA('#dcefff', bl.life / bl.max);
      ctx.lineWidth = Math.max(2, cz * 0.25);
      ctx.beginPath();
      for (let i = 0; i < bl.pts.length; i++) {
        const s = worldToScreen(r, bl.pts[i][0], bl.pts[i][1]);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
    }
  }

  function drawLabels(r, sim) {
    const ctx = r.ctx;
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    for (const v of sim.villages) {
      const s = worldToScreen(r, v.x + 0.5, v.y - 0.5);
      if (s.x < 0 || s.y < 0 || s.x > r.w || s.y > r.h) continue;
      const label = v.name + ' ' + v.pop;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const wpx = label.length * 5 + 6;
      ctx.fillRect(s.x - wpx / 2, s.y - 14, wpx, 11);
      ctx.fillStyle = v.col;
      ctx.fillRect(s.x - wpx / 2, s.y - 14, 3, 11);
      ctx.fillStyle = '#fff';
      ctx.font = '7px monospace';
      ctx.fillText(label, s.x, s.y - 5);
    }
    ctx.textAlign = 'left';
  }

  function drawCursor(r, ui) {
    if (!ui.mouseW || ui.overUI) return;
    const ctx = r.ctx, cz = r.cam.zoom;
    const s = worldToScreen(r, ui.mouseW.x, ui.mouseW.y);
    const rad = (ui.brushRadius || 1);
    ctx.strokeStyle = ui.brushColor || 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, rad * cz, 0, 6.283); ctx.stroke();
    // crosshair
    ctx.fillStyle = ui.brushColor || 'rgba(255,255,255,0.7)';
    ctx.fillRect(s.x - 1, s.y - 6, 2, 12); ctx.fillRect(s.x - 6, s.y - 1, 12, 2);
  }

  function drawWeather(r, sim) {
    if (r.weather === 'clear') return;
    const ctx = r.ctx;
    if (r.weather === 'rain') {
      ctx.strokeStyle = 'rgba(150,180,220,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of r.rainDrops) {
        d.y += d.s * 4; d.x += 1.2;
        if (d.y > r.h) { d.y = -5; d.x = Math.random() * r.w; }
        if (d.x > r.w) d.x = 0;
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - 2, d.y - 6);
      }
      ctx.stroke();
    } else if (r.weather === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const f of r.snowFlakes) {
        f.d += 0.03; f.y += f.s * 1.2; f.x += Math.sin(f.d) * 0.6;
        if (f.y > r.h) { f.y = -5; f.x = Math.random() * r.w; }
        ctx.fillRect(f.x, f.y, 2, 2);
      }
    }
  }

  function drawDayNight(r, sim, ui) {
    const ctx = r.ctx;
    const mode = r.world.mode;
    if (mode === 'hell') {
      // hell pulses with furnace light and knows no day
      const pulse = 0.06 + Math.sin(sim.tick * 0.05) * 0.03;
      ctx.fillStyle = `rgba(255,60,10,${pulse})`;
      ctx.fillRect(0, 0, r.w, r.h);
    } else if (mode === 'heaven') {
      ctx.fillStyle = 'rgba(255,240,180,0.07)'; // eternal golden hour
      ctx.fillRect(0, 0, r.w, r.h);
    } else if (mode === 'void') {
      ctx.fillStyle = 'rgba(30,20,60,0.18)'; // the cold dark between
      ctx.fillRect(0, 0, r.w, r.h);
    } else {
      // day-night cycle tied to tick; also seasonal tint
      const cyc = (sim.tick % 480) / 480; // 0..1
      const night = Math.max(0, Math.cos(cyc * 6.283) * 0.5 + 0.15); // darkness
      if (night > 0.02) {
        ctx.fillStyle = `rgba(10,14,40,${night * 0.6})`;
        ctx.fillRect(0, 0, r.w, r.h);
      }
      const seasonTints = ['rgba(120,220,120,0.04)', 'rgba(255,220,120,0.05)', 'rgba(220,150,80,0.06)', 'rgba(180,210,255,0.08)'];
      ctx.fillStyle = seasonTints[sim.season];
      ctx.fillRect(0, 0, r.w, r.h);
    }
    // vignette
    const g = ctx.createRadialGradient(r.w / 2, r.h / 2, Math.min(r.w, r.h) * 0.35, r.w / 2, r.h / 2, Math.max(r.w, r.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, r.w, r.h);
  }

  // ---- minimap ---------------------------------------------------------
  let miniCanvas = null, miniCtx = null, miniDirtyTick = -1, miniImg = null;
  let biomeLUT = null; // biome id -> [r,g,b], built once
  function drawMinimap(r, sim) {
    const world = r.world;
    const MW = 120, scale = MW / world.W, MH = Math.round(world.H * scale);
    if (!miniCanvas || miniCanvas.width !== world.W || miniCanvas.height !== world.H) {
      miniCanvas = document.createElement('canvas');
      miniCanvas.width = world.W; miniCanvas.height = world.H;
      miniCtx = miniCanvas.getContext('2d');
      miniDirtyTick = -1;
    }
    if (!biomeLUT) {
      biomeLUT = [];
      for (const k in W.BIOME_COLORS) biomeLUT[+k] = hexToRgb(W.BIOME_COLORS[k]);
    }
    // redraw minimap terrain occasionally
    if (world.dirtyMini || miniDirtyTick < 0 || (sim.tick - miniDirtyTick) > 30) {
      if (!miniImg || miniImg.width !== world.W || miniImg.height !== world.H) {
        miniImg = miniCtx.createImageData(world.W, world.H);
      }
      // owner id -> rgb, computed once per regen instead of per tile
      const ownerRGB = new Map();
      for (const v of sim.villages) ownerRGB.set(v.id, hexToRgb(v.col));
      const img = miniImg;
      for (let i = 0; i < world.n; i++) {
        const c = biomeLUT[world.biome[i]];
        let rr = c[0], gg = c[1], bb = c[2];
        const o = world.owner[i];
        if (o >= 0) {
          const vc = ownerRGB.get(o);
          if (vc) { rr = (rr + vc[0] * 2) / 3; gg = (gg + vc[1] * 2) / 3; bb = (bb + vc[2] * 2) / 3; }
        }
        if (world.fire[i] > 0) { rr = 255; gg = 120; bb = 20; }
        const p = i * 4; img.data[p] = rr; img.data[p + 1] = gg; img.data[p + 2] = bb; img.data[p + 3] = 255;
      }
      miniCtx.putImageData(img, 0, 0);
      miniDirtyTick = sim.tick; world.dirtyMini = false;
    }
    const ctx = r.ctx;
    const mx = r.w - MW - 10, my = r.h - MH - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(mx - 3, my - 3, MW + 6, MH + 6);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(miniCanvas, mx, my, MW, MH);
    // viewport rect, clipped so it never spills outside the minimap
    const tl = screenToWorld(r, 0, 0), br = screenToWorld(r, r.w, r.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(mx, my, MW, MH); ctx.clip();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + tl.x * scale, my + tl.y * scale, (br.x - tl.x) * scale, (br.y - tl.y) * scale);
    ctx.restore();
    ctx.strokeStyle = '#2a2f45'; ctx.strokeRect(mx - 3, my - 3, MW + 6, MH + 6);
    r._mini = { mx, my, MW, MH, scale };
  }

  // ---- color helpers ---------------------------------------------------
  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function hexA(h, a) {
    const c = hexToRgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  // point the renderer at a different world (planet switch / plane visit)
  function setWorld(r, world) {
    r.world = world;
    if (r.terra.width !== world.W * TILE || r.terra.height !== world.H * TILE) {
      r.terra.width = world.W * TILE; r.terra.height = world.H * TILE;
      r.tctx.imageSmoothingEnabled = false;
    }
    renderTerrain(r);
    world.dirtyMini = true;
    r.cam.x = world.W / 2; r.cam.y = world.H / 2;
  }

  global.PD.Render = {
    createRenderer, draw, renderTerrain, worldToScreen, screenToWorld,
    screenToWorldRaw, setWorld, TILE, FX, hexToRgb
  };
})(window);
