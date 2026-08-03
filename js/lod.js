// The globe, subdivided where you are looking.
//
// Until now the planet was one static mesh: 256x170 segments, 87,040
// triangles, drawn identically whether the camera was 1,600 km up or 80 m up.
// At the equator that is 156 km per quad. Standing on the ground the horizon
// is 32 km away, so the entire visible world sat inside a single triangle.
//
// This is a geographic (equirectangular) quadtree. NOT a cube-sphere: every
// surface field in this codebase is already equirectangular — tileToSphere /
// sphereToTile, texData and texClim at one texel per tile, the world arrays
// themselves — and a cube-sphere would force a reprojection on all of it for
// a benefit (uniform patch shape) that only matters near the poles, which
// here are ocean.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES NOT DO, said up front so nothing downstream over-claims it:
//
// The world grid is 180x120 — 222 km per tile. With a 17x17 patch grid, a
// LEVEL 2 patch already puts one quad on one tile. Everything below level 2
// is interpolation and synthesis, NOT data. This tree does not reveal terrain
// the game already has; it culls what you cannot see, and it invents
// believable relief below tile scale. That invention is `detail()` below and
// it is deliberately conservative: masked to land, scaled by local slope, so
// plains stay flat and only mountains grow ridges.
// ---------------------------------------------------------------------------
//
// There are no GL calls in this file. It builds plain Float32Arrays and plain
// objects, so the whole thing is testable under Node exactly like sim.js is —
// which matters, because split/merge hysteresis is the kind of logic that is
// impossible to eyeball and trivial to assert.
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;

  // ---- constants ---------------------------------------------------------
  const R_EARTH_M = 6371000;
  const SEA = 0.38;                 // the same sea level VS_PLANET uses

  // 17x17 vertices = 16x16 quads = 512 triangles, plus a 128-triangle skirt
  // ring, = 640 per patch. A 128-patch budget is 82k triangles worst case,
  // against 87k for the single sphere this replaces — and unlike that sphere,
  // they are all in front of you.
  //
  // 33x33 was the first choice and it is wrong: 2,048 + 256 = 2,304 per patch
  // is 295k at the same patch count, i.e. MORE than the mesh being replaced.
  const N = 17;
  const NQ = N - 1;

  const MAX_PATCHES = 128;
  const MAX_LEVEL = 19;             // 20,038 km / 2^19 = 38 m per patch
  const POLE_LAT = 80 * Math.PI / 180;
  const POLE_MAX_LEVEL = 6;         // above 80 deg the poles are ocean

  // Split when the patch projects larger than SPLIT_PX; merge when it falls
  // below SPLIT_PX * MERGE_K.
  //
  // Both tests are on the SAME patch's projected size, so any MERGE_K < 1
  // gives a hysteresis band: between those two sizes a split patch stays
  // split and an unsplit one stays unsplit. Since size scales as 1/distance,
  // 0.45 makes that band a factor of 2.2 in camera distance.
  //
  // (An earlier version of this comment claimed 0.45 rather than 0.5 was what
  // stopped the tree thrashing. That is not true and the fault-injection run
  // proved it: 0.5 gives a factor-2.0 band and is perfectly stable. What
  // actually matters is that MERGE_K is below 1 at all — at 1.0 the two
  // thresholds coincide and a camera sitting on one splits and merges the
  // same patch on alternate frames forever. The margin between 0.45 and 0.5
  // is comfort, not correctness, and it is asserted as such.)
  const SPLIT_PX = 340;
  const MERGE_K = 0.45;

  const SPLITS_PER_FRAME = 4;
  const MERGES_PER_FRAME = 8;

  // ---- vertical exaggeration --------------------------------------------
  // The shader displaced land by 0.13 * (elev - 0.38), reaching radius 1.0806
  // — Everest as a 513 km mountain, 58x. That reads well from orbit and is
  // absurd standing on it, and it is why the camera could fly through the
  // ground: cam.min was 80 m above radius 1, half a million metres inside the
  // rock.
  //
  // So exaggeration becomes a function of altitude: dramatic from far away,
  // honest up close. It is a per-frame UNIFORM rather than baked into the
  // geometry, which is why patch vertices store true height separately from
  // position (see buildPatch). Everything that needs to agree with the
  // terrain — the camera clamp, picking — calls this same function.
  // 12x, not the 58x the fixed 0.13 displacement produced. Two reasons, and
  // the second only showed up when it was measured:
  //
  //   - 58x makes Everest 513 km tall. That is not a dramatic mountain, it is
  //     a spike sticking eighty times further out than the atmosphere.
  //   - a patch's bounding sphere contains its relief, so at 40x a level-6
  //     patch 312 km wide carries a 354 km height allowance and the split
  //     test starts subdividing for ALTITUDE rather than for width. The tree
  //     then spends its whole budget uniformly and orbit ends up tessellated
  //     to 1.3 pixels per quad while the ground goes short.
  //
  // 12x is still firmly cinematic — Everest reads at 106 km from orbit, which
  // is a mountain you can see from space, which is the point.
  const EXAG_FAR = 12, EXAG_NEAR = 1.4;
  function exagFor(dist) {
    const altM = Math.max(0, (dist - 1) * R_EARTH_M);
    // 20 km .. 600 km, smoothstepped so the transition tracks your own
    // descent instead of snapping at a threshold
    const t = PD.clamp((altM - 20000) / (600000 - 20000), 0, 1);
    const s = t * t * (3 - 2 * t);
    return EXAG_NEAR + (EXAG_FAR - EXAG_NEAR) * s;
  }

  // true displacement of a tile-space elevation, in Earth radii, at exag 1.
  // elev is 0..1 with sea at 0.38; the land range 0.38..1 maps to 0..8.85 km.
  const MAX_LAND_M = 8850;
  function liftOf(elev) {
    return Math.max(0, elev - SEA) / (1 - SEA) * (MAX_LAND_M / R_EARTH_M);
  }

  // ---- sampling the world ------------------------------------------------
  // Bilinear elevation at fractional tile coordinates, wrapping in x and
  // clamping at the poles. The nearest-neighbour lookup updateHeights used
  // gave every patch a staircase; at 38 m quads that would be a cliff every
  // 222 km and flat glass between.
  function elevAtTile(w, tx, ty) {
    const W2 = w.W, H2 = w.H;
    const x0 = Math.floor(tx), y0f = Math.floor(ty);
    const fx = tx - x0, fy = ty - y0f;
    const y0 = PD.clamp(y0f, 0, H2 - 1), y1 = PD.clamp(y0f + 1, 0, H2 - 1);
    const xa = ((x0 % W2) + W2) % W2, xb = ((x0 + 1) % W2 + W2) % W2;
    const e = w.elev;
    const top = e[y0 * W2 + xa] + (e[y0 * W2 + xb] - e[y0 * W2 + xa]) * fx;
    const bot = e[y1 * W2 + xa] + (e[y1 * W2 + xb] - e[y1 * W2 + xa]) * fx;
    return top + (bot - top) * fy;
  }

  // lon/lat (radians) -> fractional tile coords, matching tileToSphere exactly
  function lonLatToTile(w, lon, lat) {
    let l = lon % (Math.PI * 2);
    if (l < 0) l += Math.PI * 2;
    return {
      tx: (l / (Math.PI * 2)) * w.W,
      ty: PD.clamp((Math.PI / 2 - lat) / Math.PI * w.H, 0, w.H - 0.001)
    };
  }

  function elevAt(w, lon, lat) {
    const t = lonLatToTile(w, lon, lat);
    return elevAtTile(w, t.tx, t.ty);
  }

  // The radius the terrain actually reaches at this point, at this
  // exaggeration. This is the function the camera clamp and picking both use,
  // so they cannot disagree with the geometry.
  function groundRadius(w, lon, lat, exag) {
    return 1 + liftOf(elevAt(w, lon, lat)) * exag;
  }

  // ---- the highest thing in a region ------------------------------------
  // A patch's bounding sphere needs the tallest terrain the patch contains.
  // Sampling for it does not work: the first version took a 9x9 net, and a
  // level-0 patch covers a quarter of the planet, so 81 points miss every
  // mountain on it. Measured, that estimate came in up to 75x under the truth
  // — and a bounding sphere that is too small culls patches you are looking
  // at, which is the one LOD failure that cannot be diagnosed from a
  // screenshot.
  //
  // A max-pyramid answers it exactly instead, for 1.33x the memory of the
  // elevation grid and one O(n) pass. Each level holds the max of a 2x2 block
  // below it, so any rectangle can be covered by a handful of cells at the
  // right level. Cells overhang the rectangle, so the answer is exact or too
  // big — never too small, which is the only direction that matters.
  function buildElevPyramid(w) {
    const levels = [{ W: w.W, H: w.H, d: w.elev }];
    let W2 = w.W, H2 = w.H, src = w.elev;
    while (W2 > 1 || H2 > 1) {
      const nW = Math.max(1, W2 >> 1), nH = Math.max(1, H2 >> 1);
      const d = new Float32Array(nW * nH);
      for (let y = 0; y < nH; y++) for (let x = 0; x < nW; x++) {
        let m = -Infinity;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(W2 - 1, x * 2 + dx), sy = Math.min(H2 - 1, y * 2 + dy);
          const v = src[sy * W2 + sx];
          if (v > m) m = v;
        }
        d[y * nW + x] = m;
      }
      levels.push({ W: nW, H: nH, d });
      W2 = nW; H2 = nH; src = d;
    }
    return levels;
  }

  // The rect is grown by one tile on every side because the patch is sampled
  // with BILINEAR elevation, whose footprint reaches one tile past the
  // patch's own corners. Without that the bound is short by exactly the
  // neighbour that happens to be a mountain — measured at 1.3x under, on 37
  // patches, which is enough to cull one while it is on screen.
  function maxElevIn(pyr, tx0, ty0, tx1, ty1) {
    tx0 -= 1; ty0 -= 1; tx1 += 1; ty1 += 1;
    const span = Math.max(tx1 - tx0, ty1 - ty0);
    let L = 0;
    while (L < pyr.length - 1 && span / (1 << L) > 4) L++;
    const lv = pyr[L], s = 1 << L;
    const x0 = Math.floor(tx0 / s), x1 = Math.floor(tx1 / s);
    const y0 = Math.max(0, Math.floor(ty0 / s)), y1 = Math.min(lv.H - 1, Math.floor(ty1 / s));
    let m = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * lv.W;
      for (let x = x0; x <= x1; x++) {
        const v = lv.d[row + (((x % lv.W) + lv.W) % lv.W)];
        if (v > m) m = v;
      }
    }
    return m;
  }

  // ---- sub-tile relief ---------------------------------------------------
  // Between two tiles 222 km apart, bilinear elevation is a perfectly smooth
  // ramp — correct at the scale it has data for, and dead at 38 m. This adds
  // fBm that only exists below tile scale.
  //
  // Two masks keep it honest:
  //   - land only. Bumps on the open ocean would be visible nonsense.
  //   - scaled by local slope. Flat ground stays flat; the Himalaya get
  //     ridges. Otherwise the Great Plains grow a rash.
  // The ceiling on invented relief, in metres. bound() adds this to every
  // patch's height allowance, so it is not a comment — it is a contract, and
  // detail() clamps itself to it rather than being trusted to stay under.
  const DETAIL_MAX = 600;
  function makeDetail(seed) {
    const nz = PD.makeNoise((seed ^ 0x5EA17E) >>> 0);
    const cap = DETAIL_MAX / MAX_LAND_M * (1 - SEA);   // in elevation units
    return function (w, lon, lat, level, elev) {
      if (level <= 2 || elev <= SEA) return 0;
      const t = lonLatToTile(w, lon, lat);
      // local slope from the tile field, in elevation units per tile
      const W2 = w.W, H2 = w.H, e = w.elev;
      const xi = Math.floor(t.tx), yi = PD.clamp(Math.floor(t.ty), 1, H2 - 2);
      const xr = ((xi + 1) % W2 + W2) % W2, xl = ((xi - 1) % W2 + W2) % W2;
      const slope = Math.abs(e[yi * W2 + xr] - e[yi * W2 + xl]) +
                    Math.abs(e[(yi + 1) * W2 + xi % W2] - e[(yi - 1) * W2 + xi % W2]);
      // rises with level (0 at 2, full by ~8) so the shape only appears once
      // the geometry is fine enough to carry it
      const lk = PD.clamp((level - 2) / 6, 0, 1);
      // amplitude in elevation units — deliberately small. This is texture,
      // not topography; inventing mountains would be lying.
      const amp = 0.035 * lk * PD.clamp(slope * 3.0, 0.05, 1);
      const f = Math.pow(2, level) * 1.7;
      const d = (nz.fbm(t.tx * f * 0.01, t.ty * f * 0.01, 4) - 0.5) * 2 * amp;
      return PD.clamp(d, -cap, cap);
    };
  }

  // ---- shared grid -------------------------------------------------------
  // One (u,v) array for every patch that will ever exist, plus one index
  // buffer with the skirt ring already in it. The patch itself only ever owns
  // its position and normal data.
  //
  // The skirt is a border ring of vertices duplicated and pushed DOWN along
  // the local up vector. Where a coarse patch meets a fine one the heights
  // disagree by up to the coarse patch's own error; the skirt is a vertical
  // curtain that fills the gap. It costs 128 of the 640 triangles and needs
  // no neighbour bookkeeping at all, which is why it comes before edge
  // stitching rather than after.
  function buildGrid() {
    const uv = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = (j * N + i) * 2;
      uv[k] = i / NQ; uv[k + 1] = j / NQ;
    }
    const idx = [];
    for (let j = 0; j < NQ; j++) for (let i = 0; i < NQ; i++) {
      const a = j * N + i, b = a + N;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    // skirt: vertices N*N .. N*N + 4*N-4, one per border vertex, in ring order
    const ring = [];
    for (let i = 0; i < N; i++) ring.push(i);                       // top
    for (let j = 1; j < N; j++) ring.push(j * N + N - 1);            // right
    for (let i = N - 2; i >= 0; i--) ring.push((N - 1) * N + i);     // bottom
    for (let j = N - 2; j >= 1; j--) ring.push(j * N);               // left
    const skirtBase = N * N;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const as = skirtBase + k, bs = skirtBase + ((k + 1) % ring.length);
      idx.push(a, as, b, b, as, bs);
    }
    return { uv, idx: new Uint16Array(idx), ring, nVerts: skirtBase + ring.length, nIdx: idx.length };
  }

  const GRID = buildGrid();

  // ---- patches -----------------------------------------------------------
  // A patch covers [lon0, lon0+lonSpan] x [lat0, lat0+latSpan] in radians.
  // Its vertices are stored RELATIVE TO ITS OWN CENTRE, in two parts:
  //
  //   base — the point on the unit sphere, minus the patch centre
  //   up   — the unit up vector times the TRUE height (<= 0.0014 radii)
  //
  // so the shader is `pos = base + up * uExag + (centre - eye)`. Three things
  // fall out of that:
  //
  //   1. Exaggeration is a free uniform. Changing it does not rebuild a
  //      single buffer, which is what makes the altitude curve affordable.
  //   2. Precision scales with PATCH size, not planet radius. float32 near
  //      1.0 quantises to 0.38 m — visible jitter when a metre matters. A
  //      level-8 patch spans 78 km, so the same float32 resolves 2.3 mm.
  //   3. `centre - eye` is computed in JS doubles and handed over as a small
  //      float32, so the eye-relative transform never forms the catastrophic
  //      difference of two near-equal large numbers on the GPU.
  function makePatch(tree, level, lon0, lat0, lonSpan, latSpan) {
    return {
      level, lon0, lat0, lonSpan, latSpan,
      children: null, parent: null,
      base: null, up: null, nrm: null,
      centre: null, radius: 0, spread: 0, drop: 0,
      maxLift: 0,                  // largest lift in the patch, for the bound
      bounded: false,              // has a centre + bounding sphere
      built: false,                // has vertex buffers (leaves only)
      version: -1
    };
  }

  // The cheap half: centre and bounding sphere only. Interior nodes need
  // these every frame to be size-tested, but they are never drawn, so giving
  // them the full 10 KB of vertex buffers would be paying for geometry that
  // is by definition hidden behind its own children.
  function bound(tree, p) {
    const clon = p.lon0 + p.lonSpan * 0.5, clat = p.lat0 + p.latSpan * 0.5;
    const ccl = Math.cos(clat);
    p.centre = [ccl * Math.sin(clon), Math.sin(clat), ccl * Math.cos(clon)];
    // A patch's corners are its farthest points from the centre on the
    // sphere; the mid-edge of the equator-facing side can beat them for wide
    // patches, so sample the whole border coarsely rather than guessing.
    let maxD2 = 0;
    for (let s = 0; s <= 8; s++) {
      for (let e = 0; e < 4; e++) {
        const t = s / 8;
        const lon = p.lon0 + p.lonSpan * (e === 0 ? t : e === 1 ? 1 : e === 2 ? t : 0);
        const lat = p.lat0 + p.latSpan * (e === 0 ? 0 : e === 1 ? t : e === 2 ? 1 : t);
        const cl = Math.cos(lat);
        const dx = cl * Math.sin(lon) - p.centre[0];
        const dy = Math.sin(lat) - p.centre[1];
        const dz = cl * Math.cos(lon) - p.centre[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD2) maxD2 = d2;
      }
    }
    p.spread = Math.sqrt(maxD2);
    p.drop = Math.max(p.lonSpan, p.latSpan) * 0.06;
    // A 3x3 net of unit vectors over the patch, kept for horizon culling.
    // Testing the bounding SPHERE against the horizon is correct but hopeless
    // in practice: on the ground a coarse patch's sphere has a 60 km radius,
    // so it clears a 32 km horizon from 878 km away and nothing is ever
    // culled. Testing points that are actually on the patch is tight enough
    // to matter, and nine of them cost nine dot products.
    p.net = [];
    for (let j = 0; j <= 2; j++) {
      const lat = p.lat0 + p.latSpan * (j / 2), cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i <= 2; i++) {
        const lon = p.lon0 + p.lonSpan * (i / 2);
        p.net.push(cl * Math.sin(lon), sl, cl * Math.cos(lon));
      }
    }
    // The height allowance has to come from the terrain the patch actually
    // covers, not from the worst case the planet allows.
    //
    // The first version used `maxLand * EXAG_FAR` here, which is 354 km of
    // slack on every patch including a 39 km one. That does not merely waste
    // a little culling — it makes projectedSize report the bounding sphere
    // instead of the patch, so every patch on the globe wants to split, the
    // budget saturates at MAX_PATCHES spread evenly over the sphere, and the
    // tree stops subdividing no matter how low the camera goes. The symptom
    // looked like "the LOD does nothing"; the cause was one constant.
    const w = tree.world;
    const a = lonLatToTile(w, p.lon0, p.lat0 + p.latSpan);   // lat0+span is NORTH, ty smaller
    const b = lonLatToTile(w, p.lon0 + p.lonSpan, p.lat0);
    // lon0 + lonSpan can land exactly on 2pi and wrap to 0; use the unwrapped
    // span rather than the wrapped endpoint, or a root patch reports width 0.
    const tx1 = a.tx + (p.lonSpan / (Math.PI * 2)) * w.W;
    p.maxLift = liftOf(maxElevIn(tree.pyr, a.tx, a.ty, tx1, b.ty)) +
      DETAIL_MAX / R_EARTH_M;      // plus whatever detail() is allowed to add
    p.bounded = true;
  }

  // The bounding radius at a given vertical exaggeration. Exaggeration is a
  // per-frame uniform, so the bound has to be evaluated per frame too —
  // holding a single `p.radius` sized for EXAG_FAR is exactly the mistake
  // described above, in slower motion.
  function radiusAt(p, exag) {
    return p.spread + p.maxLift * exag + p.drop;
  }

  function buildPatch(tree, p) {
    const w = tree.world;
    const nv = GRID.nVerts;
    const base = new Float32Array(nv * 3);
    const up = new Float32Array(nv * 3);
    const nrm = new Float32Array(nv * 3);
    const lift = new Float32Array(nv);

    if (!p.bounded) bound(tree, p);
    const cx = p.centre[0], cy = p.centre[1], cz = p.centre[2];

    let maxLift = 0, maxD2 = 0;
    // grid vertices
    for (let j = 0; j < N; j++) {
      const lat = p.lat0 + p.latSpan * (j / NQ);
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i < N; i++) {
        const lon = p.lon0 + p.lonSpan * (i / NQ);
        const k = j * N + i;
        const ux = cl * Math.sin(lon), uy = sl, uz = cl * Math.cos(lon);
        const t = lonLatToTile(w, lon, lat);
        const e = elevAtTile(w, t.tx, t.ty);
        // detail() speaks in ELEVATION units (0..1, sea at 0.38); liftOf
        // converts to Earth radii. Adding the two directly — which the first
        // version did — is out by a factor of about 160,000, and turns 200 m
        // of invented texture into a 220 km spike. The self-sizing bounding
        // sphere hid it perfectly, because it grew to fit whatever it was
        // given.
        const hh = Math.max(0, liftOf(e + tree.detail(w, lon, lat, p.level, e)));
        lift[k] = hh;
        if (hh > maxLift) maxLift = hh;
        const bx = ux - cx, by = uy - cy, bz = uz - cz;
        base[k * 3] = bx; base[k * 3 + 1] = by; base[k * 3 + 2] = bz;
        up[k * 3] = ux * hh; up[k * 3 + 1] = uy * hh; up[k * 3 + 2] = uz * hh;
        const d2 = bx * bx + by * by + bz * bz;
        if (d2 > maxD2) maxD2 = d2;
      }
    }

    // Vertex normals from finite differences on the patch's own lift field,
    // in the local east/south tangent frame — the same construction
    // FS_PLANET already uses to decode the normal map, so the two agree.
    // Done here on the CPU because OES_standard_derivatives is optional on
    // WebGL1 and a normal atlas would cost more memory than the geometry.
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const il = i > 0 ? i - 1 : i, ir = i < N - 1 ? i + 1 : i;
        const jl = j > 0 ? j - 1 : j, jr = j < N - 1 ? j + 1 : j;
        const lat = p.lat0 + p.latSpan * (j / NQ);
        // metres per grid step, east and south
        const dEast = Math.max(1, p.lonSpan / NQ * Math.cos(lat) * R_EARTH_M) * (ir - il);
        const dSouth = Math.max(1, p.latSpan / NQ * R_EARTH_M) * (jr - jl);
        const gx = (lift[j * N + ir] - lift[j * N + il]) * R_EARTH_M / dEast;
        const gy = (lift[jr * N + i] - lift[jl * N + i]) * R_EARTH_M / dSouth;
        // tangent-space normal, matching the uNorm convention (xy in -1..1)
        const nl = Math.sqrt(gx * gx + gy * gy + 1);
        nrm[k * 3] = -gx / nl; nrm[k * 3 + 1] = -gy / nl; nrm[k * 3 + 2] = 1 / nl;
      }
    }

    // skirt vertices: copy the ring, drop them along their own up vector.
    // The drop must exceed the height error a coarse neighbour can have, so
    // it scales with patch size rather than being a constant.
    const drop = p.drop;
    for (let k = 0; k < GRID.ring.length; k++) {
      const src = GRID.ring[k], dst = GRID.nVerts - GRID.ring.length + k;
      // reconstruct the unit vector from base + centre (exact, no trig)
      const ux = base[src * 3] + cx, uy = base[src * 3 + 1] + cy, uz = base[src * 3 + 2] + cz;
      base[dst * 3] = base[src * 3] - ux * drop;
      base[dst * 3 + 1] = base[src * 3 + 1] - uy * drop;
      base[dst * 3 + 2] = base[src * 3 + 2] - uz * drop;
      up[dst * 3] = up[src * 3]; up[dst * 3 + 1] = up[src * 3 + 1]; up[dst * 3 + 2] = up[src * 3 + 2];
      nrm[dst * 3] = nrm[src * 3]; nrm[dst * 3 + 1] = nrm[src * 3 + 1]; nrm[dst * 3 + 2] = nrm[src * 3 + 2];
    }

    p.base = base; p.up = up; p.nrm = nrm;
    // The real relief is known now, so both halves of the bound tighten: the
    // measured spread (which includes the skirt) and the measured peak. Only
    // ever downward from the sampled estimate — a bound that is a little too
    // big costs a patch that did not need drawing, while one that is too
    // small pops geometry out of existence, which is the failure nobody can
    // debug from a screenshot.
    p.spread = Math.max(p.spread, Math.sqrt(maxD2));
    p.maxLift = maxLift;
    p.built = true;
    p.version = tree.version;
    return p;
  }

  // ---- the tree ----------------------------------------------------------
  function createTree(world, seed) {
    const tree = {
      world,
      detail: makeDetail(seed != null ? seed : (world.seed || 1)),
      pyr: buildElevPyramid(world),
      roots: null,
      visible: [],
      version: 0,          // bumped on world edit; patches rebuild lazily
      stats: { patches: 0, tris: 0, splits: 0, merges: 0, culled: 0 }
    };
    // Two roots of 180x180 degrees, split at lon 0 and lon 180. Because the
    // roots divide THERE, no patch ever spans the antimeridian — the seam
    // that forced bakeDirtyTiles to abandon wrapping rects simply has no
    // patch to appear on.
    tree.roots = [
      makePatch(tree, 0, 0, -Math.PI / 2, Math.PI, Math.PI),
      makePatch(tree, 0, Math.PI, -Math.PI / 2, Math.PI, Math.PI)
    ];
    return tree;
  }

  // A patch above the polar cap latitude stops subdividing early. cam.lat is
  // already clamped to +-83 degrees and both caps are ocean, so the only
  // thing extra levels there would buy is patches shaped like slivers.
  function maxLevelFor(p) {
    const top = p.lat0, bot = p.lat0 + p.latSpan;
    const worst = Math.max(Math.abs(top), Math.abs(bot));
    return worst > POLE_LAT ? POLE_MAX_LEVEL : MAX_LEVEL;
  }

  function split(tree, p) {
    if (p.children || p.level >= maxLevelFor(p)) return false;
    const hl = p.lonSpan * 0.5, ha = p.latSpan * 0.5;
    p.children = [
      makePatch(tree, p.level + 1, p.lon0, p.lat0, hl, ha),
      makePatch(tree, p.level + 1, p.lon0 + hl, p.lat0, hl, ha),
      makePatch(tree, p.level + 1, p.lon0, p.lat0 + ha, hl, ha),
      makePatch(tree, p.level + 1, p.lon0 + hl, p.lat0 + ha, hl, ha)
    ];
    for (const c of p.children) c.parent = p;
    tree.stats.splits++;
    return true;
  }

  function merge(tree, p) {
    if (!p.children) return false;
    // free the children's buffers explicitly; they are the bulk of the memory
    for (const c of p.children) { c.base = c.up = c.nrm = null; c.children = null; }
    p.children = null;
    tree.stats.merges++;
    return true;
  }

  // How large this patch projects, in pixels. `cam` is {eye, tanHalfFov,
  // screenH}. A patch behind you still has a positive distance, so this is
  // paired with a frustum test rather than relied on alone.
  function projectedSize(p, eye, tanHalfFov, screenH, exag) {
    const rad = radiusAt(p, exag == null ? 1 : exag);
    const dx = p.centre[0] - eye[0], dy = p.centre[1] - eye[1], dz = p.centre[2] - eye[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Never divide by a distance smaller than the patch itself: inside its
    // own bounding sphere the projection is unbounded and the tree would
    // split to MAX_LEVEL in one frame.
    return (rad * 2) / Math.max(d, rad * 0.5 + 1e-9) * (screenH * 0.5 / tanHalfFov);
  }

  // Behind the horizon? The far hemisphere is more than half the sphere and
  // backface rejection still pays to transform every one of its vertices.
  // This is what actually removes it.
  //
  // Standard test: from an eye at radius R, the horizon plane for a unit
  // sphere has any surface point p visible iff dot(p, eye) >= 1. A patch is
  // hidden when its whole bounding sphere fails that, with the patch's own
  // relief added to the allowance so a mountain over the limb still shows.
  // The occluder is the unit sphere, so for an eye at e the horizon plane is
  // {x : dot(x, e) = 1} and any point with dot(p, e) >= 1 is visible. Test
  // the patch's own nine points, each pushed out to the tallest thing the
  // patch contains, and cull only if every one of them fails.
  //
  // Nine samples can all dip below the plane while the sphere bulges above it
  // between them. The first version exempted patches wider than 11 degrees
  // for that reason, which was worse than the problem: it made the whole far
  // hemisphere — covered by exactly those coarse patches — permanently
  // unculled, and the budget they ate is budget the ground never got.
  //
  // The bulge is not a mystery, it is geometry: between two samples separated
  // by angle phi the arc rises 1 - cos(phi/2) ~= phi^2/8 above the chord. So
  // allow for it and test every patch.
  function beyondHorizon(p, eye, eyeLen, exag) {
    if (eyeLen <= 1) return false;           // at or below the surface
    if (!p.net) return false;
    const span = Math.max(p.lonSpan, p.latSpan) * 0.5;   // 3x3 net -> half spans
    const bulge = span * span / 8 * 2;                   // x2 margin
    const r = 1 + p.maxLift * (exag == null ? 1 : exag) + bulge;
    const n = p.net;
    for (let k = 0; k < n.length; k += 3) {
      if ((n[k] * eye[0] + n[k + 1] * eye[1] + n[k + 2] * eye[2]) * r >= 1) return false;
    }
    return true;
  }

  // Frustum cull against the bounding sphere. `planes` is 6 x [a,b,c,d] with
  // outward-negative convention (a point is inside when ax+by+cz+d >= 0).
  //
  // IMPORTANT: the renderer's view-projection is EYE-RELATIVE — its view
  // matrix carries no translation, because that is what buys the precision
  // this whole file is built around. Planes extracted from it therefore live
  // in eye-relative space, and testing a world-space centre against them is
  // silently wrong in a way that culls the patch you are standing on. So the
  // eye is subtracted here, at the one place that knows both conventions.
  function outsideFrustum(p, planes, eye, exag) {
    const cx = p.centre[0] - (eye ? eye[0] : 0);
    const cy = p.centre[1] - (eye ? eye[1] : 0);
    const cz = p.centre[2] - (eye ? eye[2] : 0);
    const rad = radiusAt(p, exag == null ? 1 : exag);
    for (let i = 0; i < planes.length; i++) {
      const pl = planes[i];
      if (pl[0] * cx + pl[1] * cy + pl[2] * cz + pl[3] < -rad) return true;
    }
    return false;
  }

  // Extract the six frustum planes from a view-projection matrix (column
  // major, the layout mat4Mul produces).
  function framePlanes(m) {
    const pl = [];
    const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
    const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    const add = (a, b, s) => {
      const v = [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]];
      const n = Math.hypot(v[0], v[1], v[2]) || 1;
      pl.push([v[0] / n, v[1] / n, v[2] / n, v[3] / n]);
    };
    add(r3, r0, 1); add(r3, r0, -1);
    add(r3, r1, 1); add(r3, r1, -1);
    add(r3, r2, 1); add(r3, r2, -1);
    return pl;
  }

  // ---- the per-frame update ---------------------------------------------
  // Walks the tree, collects the leaves that should be drawn, and queues at
  // most SPLITS_PER_FRAME splits and MERGES_PER_FRAME merges. The budget is
  // what keeps a fast descent from rebuilding a thousand patches in one
  // frame; the tree simply catches up over the next few.
  function update(tree, view) {
    const eye = view.eye;
    const eyeLen = Math.hypot(eye[0], eye[1], eye[2]);
    const planes = view.vp ? framePlanes(view.vp) : null;
    const th = Math.tan(view.fov * 0.5), sh = view.screenH;
    // The exaggeration the frame will actually draw with. Every bound in this
    // pass is sized against it, so culling and subdivision agree with the
    // geometry rather than with a worst case nobody is looking at.
    const exag = view.exag != null ? view.exag : exagFor(eyeLen);
    const out = tree.visible;
    out.length = 0;
    let culled = 0;
    const wantSplit = [], wantMerge = [];

    function walk(p) {
      if (!p.bounded) bound(tree, p);

      const size = projectedSize(p, eye, th, sh, exag);

      if (p.children) {
        // A parent whose children are all off-screen still wants merging, so
        // the visibility test must not short-circuit the recursion.
        if (size < SPLIT_PX * MERGE_K) wantMerge.push(p);
        for (const c of p.children) walk(c);
        return;
      }

      // Cull BEFORE building. A patch behind the horizon that gets built
      // anyway has paid the entire cost of being visible.
      if (beyondHorizon(p, eye, eyeLen, exag) ||
          (planes && outsideFrustum(p, planes, eye, exag))) {
        culled++; return;
      }
      if (!p.built || p.version !== tree.version) buildPatch(tree, p);

      if (size > SPLIT_PX && p.level < maxLevelFor(p)) wantSplit.push({ p, size });
      out.push(p);
    }

    for (const r of tree.roots) walk(r);

    // Largest first: the patch that is worst on screen is the one worth the
    // frame's split budget.
    wantSplit.sort((a, b) => b.size - a.size);
    let budget = SPLITS_PER_FRAME;
    // Each split turns one leaf into four, so the leaf count grows by three.
    // Projecting that forward is what makes MAX_PATCHES a real ceiling
    // instead of a hope: the budget alone only bounds the RATE of growth.
    let projected = out.length;
    for (const s of wantSplit) {
      if (budget <= 0 || projected + 3 > MAX_PATCHES) break;
      if (split(tree, s.p)) { budget--; projected += 3; }
    }
    // Merge deepest-first so a subtree collapses from the bottom in one pass
    // rather than one level per frame.
    wantMerge.sort((a, b) => b.level - a.level);
    let mbudget = MERGES_PER_FRAME;
    for (const p of wantMerge) {
      if (mbudget <= 0) break;
      if (p.children && !p.children.some(c => c.children) && merge(tree, p)) mbudget--;
    }

    tree.stats.patches = out.length;
    tree.stats.tris = out.length * (GRID.nIdx / 3);
    tree.stats.culled = culled;
    tree.stats.exag = exag;
    return out;
  }

  // The world was edited: every patch's height data is stale. Bumping the
  // version makes them rebuild the next time they are walked, which spreads
  // the cost over the frames that actually need them rather than paying for
  // the whole tree at the moment of the edit.
  // The world was edited: every patch's height data is stale, and so is the
  // max-elevation pyramid the bounding spheres are sized from. Rebuilding the
  // pyramid here rather than lazily is deliberate — it is one O(n) pass over
  // a field the simulation already owns, and a stale pyramid under-bounds a
  // raised mountain, which culls it while you are looking at it.
  function invalidate(tree) {
    tree.version++;
    tree.pyr = buildElevPyramid(tree.world);
    for (const r of tree.roots) rebound(r);
  }
  function rebound(p) {
    p.bounded = false;
    if (p.children) for (const c of p.children) rebound(c);
  }

  // Global equirect UV for a patch corner, so the fragment shader can keep
  // sampling texTerra / texData / texClim exactly as it does today. This is
  // what lets FS_PLANET, updateClim and updateDataTex go completely unchanged.
  // Returns the UV at grid coordinate (0,0) and the span across the patch, so
  // the vertex shader is `vUV = vec2(u0, v0) + aUV * vec2(du, dv)`.
  //
  // dv is NEGATIVE, and that is not a slip. The grid's j=0 row sits at lat0 —
  // the patch's SOUTHERN edge — while equirect v runs 0 at the north pole. A
  // positive dv here flips every patch's texture upside down, which reads as
  // "the terrain map is broken" rather than as an orientation bug.
  function patchUV(p) {
    return {
      u0: p.lon0 / (Math.PI * 2),
      v0: (Math.PI / 2 - p.lat0) / Math.PI,
      du: p.lonSpan / (Math.PI * 2),
      dv: -p.latSpan / Math.PI
    };
  }

  global.PD.LOD = {
    createTree, update, invalidate, split, merge, buildPatch, bound, radiusAt,
    projectedSize, beyondHorizon, outsideFrustum, framePlanes,
    exagFor, liftOf, elevAt, elevAtTile, groundRadius, lonLatToTile,
    patchUV, maxLevelFor,
    GRID, N, NQ, MAX_PATCHES, MAX_LEVEL, SPLIT_PX, MERGE_K,
    POLE_LAT, POLE_MAX_LEVEL, SEA, R_EARTH_M, EXAG_FAR, EXAG_NEAR
  };
})(window);
