/* =========================================================================
   PIXEL DEITY — earth.js
   The real Earth: real coastlines, real mountains, real ocean trenches, and a
   climate derived from where things actually are rather than from noise.

   The height field comes from js/earthdata.js, which is baked at build time
   from public-domain elevation data (see tools/build-earth.js). It is embedded
   rather than fetched because the source serves no CORS header — and because
   the shape of the Earth should not depend on a network.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD;
  const W = PD.World;
  const B = W.B;

  // ---- decode -----------------------------------------------------------
  // The payload is gzipped. DecompressionStream is the only thing here that
  // could be missing on an old WebView; if it is, the caller falls back to a
  // generated world and says so rather than showing a blank planet.
  let grid = null, gridW = 0, gridH = 0, pending = null;

  function b64ToBytes(s) {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function supported() {
    return !!(PD.EarthData && typeof global.DecompressionStream === 'function' && global.atob);
  }

  // Resolves to true once the real Earth is in memory, false if it cannot be.
  function ready() {
    if (grid) return Promise.resolve(true);
    if (pending) return pending;
    if (!supported()) return Promise.resolve(false);
    const D = PD.EarthData;
    pending = (async () => {
      try {
        const gz = b64ToBytes(D.z);
        const ds = new global.DecompressionStream('gzip');
        const stream = new global.Response(new global.Blob([gz]).stream().pipeThrough(ds));
        const buf = new Uint8Array(await stream.arrayBuffer());
        if (buf.length !== D.W * D.H) throw new Error('earth data is ' + buf.length + ', expected ' + (D.W * D.H));
        grid = buf; gridW = D.W; gridH = D.H;
        return true;
      } catch (e) {
        if (global.console) console.warn('Earth data unavailable:', e && e.message);
        return false;
      }
    })();
    return pending;
  }
  function loaded() { return !!grid; }

  // ---- sampling ---------------------------------------------------------
  // Metres above sea level at a latitude/longitude, bilinear so a world of any
  // resolution gets a smooth surface rather than the source's stair-steps.
  function metresAt(lat, lon) {
    if (!grid) return 0;
    const D = PD.EarthData;
    const fx = ((lon + 180) / 360) * gridW - 0.5;
    const fy = ((90 - lat) / 180) * gridH - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const wrap = (x) => ((x % gridW) + gridW) % gridW;
    const cy = (y) => y < 0 ? 0 : (y >= gridH ? gridH - 1 : y);
    const a = D.metres(grid[cy(y0) * gridW + wrap(x0)]);
    const b = D.metres(grid[cy(y0) * gridW + wrap(x0 + 1)]);
    const c = D.metres(grid[cy(y0 + 1) * gridW + wrap(x0)]);
    const d = D.metres(grid[cy(y0 + 1) * gridW + wrap(x0 + 1)]);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // A world tile's centre, in degrees. The game's grid is equirectangular with
  // x eastward from the antimeridian and y southward from the north pole —
  // the same convention tileToSphere uses in the renderer.
  const tileLat = (w, y) => 90 - ((y + 0.5) / w.H) * 180;
  const tileLon = (w, x) => ((x + 0.5) / w.W) * 360 - 180;

  // ---- elevation into the game's 0..1 space -----------------------------
  // assignBiome reads elev in 0..1 with water below 0.38 and rock above 0.72.
  // Map real metres onto that so the existing classifier — which is good — can
  // be reused untouched. Ocean and land are scaled separately: linear metres
  // would put every continent inside two hundredths of the range.
  const SEA01 = 0.38;
  function elev01(m) {
    if (m <= 0) return PD.clamp(SEA01 * (1 - Math.min(1, -m / 8000) * 0.92), 0, 1);
    // land: a mild curve so plains stay distinct and only real mountains
    // reach the rock/snow bands
    return PD.clamp(SEA01 + Math.pow(Math.min(1, m / 6500), 0.72) * (1 - SEA01), 0, 1);
  }

  // ---- climate ----------------------------------------------------------
  // Real precipitation, approximately: the equatorial rain belt, the
  // subtropical desert belts at ~25 degrees that make the Sahara, Arabia,
  // the Kalahari and the Australian interior, the temperate storm tracks, and
  // the polar deserts. Then continentality — the middle of a landmass is dry —
  // and orographic drying in the lee of high ground.
  // The amplitudes are chosen so the sum never reaches its own clamps. A first
  // pass had the equator at exactly 1.00 and the desert belt at exactly 0.00,
  // which reads fine as a number and is wrong as a climate: assignBiome splits
  // on moisture at 0.30 / 0.50 / 0.60 / 0.68, so a saturated tropics turns
  // rainforest and savanna into the same biome everywhere.
  function baseRain(lat) {
    const a = Math.abs(lat);
    const itcz = Math.exp(-Math.pow(a / 11, 2)) * 0.48;          // equatorial belt
    const horse = -Math.exp(-Math.pow((a - 26) / 11, 2)) * 0.34; // subtropical dry
    const mid = Math.exp(-Math.pow((a - 52) / 15, 2)) * 0.28;    // storm tracks
    const polar = -Math.exp(-Math.pow((a - 90) / 18, 2)) * 0.22; // polar desert
    return PD.clamp(0.40 + itcz + horse + mid + polar, 0, 1);
  }

  // How far this tile is from open water, in tiles, capped. Cheap multi-source
  // BFS over the whole grid — one pass, not per-tile search.
  function seaDistance(w, isWater) {
    const n = w.W * w.H, dist = new Uint16Array(n).fill(65535);
    const q = new Int32Array(n);
    let head = 0, tail = 0;
    for (let i = 0; i < n; i++) if (isWater[i]) { dist[i] = 0; q[tail++] = i; }
    while (head < tail) {
      const i = q[head++], d = dist[i] + 1;
      if (d > 60) continue;
      const x = i % w.W, y = (i / w.W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = W.wrapX(w, x + (k === 0 ? 1 : k === 1 ? -1 : 0));
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (ny < 0 || ny >= w.H) continue;
        const j = ny * w.W + nx;
        if (dist[j] > d) { dist[j] = d; q[tail++] = j; }
      }
    }
    return dist;
  }

  // ---- build ------------------------------------------------------------
  // Fill a world with the real Earth. The world can be any size; the height
  // field is resampled to it.
  function build(w) {
    if (!grid) return false;
    const n = w.W * w.H;
    const metres = new Float32Array(n);
    const water = new Uint8Array(n);

    for (let y = 0; y < w.H; y++) {
      const lat = tileLat(w, y);
      for (let x = 0; x < w.W; x++) {
        const i = y * w.W + x;
        const m = metresAt(lat, tileLon(w, x));
        metres[i] = m;
        water[i] = m <= 0 ? 1 : 0;
        w.elev[i] = elev01(m);
      }
    }

    const sea = seaDistance(w, water);
    for (let y = 0; y < w.H; y++) {
      const lat = tileLat(w, y);
      const absLat = Math.abs(lat);
      for (let x = 0; x < w.W; x++) {
        const i = y * w.W + x;
        const m = metres[i];

        // temperature: real lapse rate with altitude on top of the latitude
        // gradient, which is what puts snow on the Andes at the equator
        const seaLevelC = 30 - Math.pow(absLat / 90, 1.35) * 68;
        const c = seaLevelC - Math.max(0, m) * 0.0065;
        w.temp[i] = PD.clamp((c + 30) / 75, 0, 1);

        if (water[i]) { w.moist[i] = 1; continue; }
        // continentality: dry in the deep interior of a landmass
        const inland = Math.min(1, sea[i] / 26);
        // orography: high ground wrings the air out, and the far side stays dry
        const relief = Math.min(1, Math.max(0, m) / 3500);
        let r = baseRain(lat) * (1 - inland * 0.55) * (1 - relief * 0.35);
        // monsoon-ish: warm coasts in the tropics are wet
        if (absLat < 30 && sea[i] < 6) r += 0.18;
        w.moist[i] = PD.clamp(r, 0, 1);
      }
    }

    // the existing classifier does the rest — real elevation and real climate
    // through the same rules the generated worlds use
    W.classify(w);
    w.isEarth = true;
    return true;
  }

  // ---- real places ------------------------------------------------------
  // Enough of them that the world reads as inhabited, chosen for spread rather
  // than for size alone. [name, lat, lon, millions]
  const CITIES = [
    ['Cairo', 30.0, 31.2, 22], ['Lagos', 6.5, 3.4, 15], ['Kinshasa', -4.3, 15.3, 17],
    ['Johannesburg', -26.2, 28.0, 6], ['Nairobi', -1.3, 36.8, 5], ['Addis Ababa', 9.0, 38.7, 5],
    ['Casablanca', 33.6, -7.6, 4], ['Khartoum', 15.5, 32.5, 6],
    ['London', 51.5, -0.1, 9], ['Paris', 48.9, 2.4, 11], ['Madrid', 40.4, -3.7, 7],
    ['Rome', 41.9, 12.5, 4], ['Berlin', 52.5, 13.4, 4], ['Moscow', 55.8, 37.6, 13],
    ['Istanbul', 41.0, 29.0, 16], ['Kyiv', 50.5, 30.5, 3], ['Stockholm', 59.3, 18.1, 2],
    ['Delhi', 28.6, 77.2, 33], ['Mumbai', 19.1, 72.9, 21], ['Karachi', 24.9, 67.0, 17],
    ['Dhaka', 23.8, 90.4, 23], ['Tehran', 35.7, 51.4, 9], ['Baghdad', 33.3, 44.4, 8],
    ['Riyadh', 24.7, 46.7, 8], ['Kabul', 34.5, 69.2, 5],
    ['Beijing', 39.9, 116.4, 22], ['Shanghai', 31.2, 121.5, 29], ['Tokyo', 35.7, 139.7, 37],
    ['Seoul', 37.6, 127.0, 10], ['Bangkok', 13.8, 100.5, 11], ['Jakarta', -6.2, 106.8, 11],
    ['Manila', 14.6, 121.0, 14], ['Hanoi', 21.0, 105.8, 8], ['Chengdu', 30.6, 104.1, 21],
    ['Novosibirsk', 55.0, 82.9, 2], ['Vladivostok', 43.1, 131.9, 1],
    ['New York', 40.7, -74.0, 19], ['Los Angeles', 34.1, -118.2, 13], ['Chicago', 41.9, -87.6, 9],
    ['Mexico City', 19.4, -99.1, 22], ['Toronto', 43.7, -79.4, 6], ['Vancouver', 49.3, -123.1, 3],
    ['Havana', 23.1, -82.4, 2], ['Anchorage', 61.2, -149.9, 1],
    ['Sao Paulo', -23.6, -46.6, 22], ['Buenos Aires', -34.6, -58.4, 15], ['Lima', -12.0, -77.0, 11],
    ['Bogota', 4.7, -74.1, 11], ['Rio de Janeiro', -22.9, -43.2, 13], ['Santiago', -33.5, -70.7, 7],
    ['Manaus', -3.1, -60.0, 2], ['La Paz', -16.5, -68.1, 2],
    ['Sydney', -33.9, 151.2, 5], ['Melbourne', -37.8, 145.0, 5], ['Perth', -32.0, 115.9, 2],
    ['Auckland', -36.9, 174.8, 2], ['Port Moresby', -9.5, 147.2, 1], ['Honolulu', 21.3, -157.9, 1],
    ['Reykjavik', 64.1, -21.9, 0.2], ['Nuuk', 64.2, -51.7, 0.02]
  ];

  // Tile coordinates for a city on this world, nudged onto land if the coarse
  // grid puts a coastal city in the sea.
  function cityTile(w, lat, lon) {
    const x = Math.floor(((lon + 180) / 360) * w.W);
    const y = Math.floor(((90 - lat) / 180) * w.H);
    if (!W.inBounds(w, x, y)) return null;
    if (W.isLand(w.biome[W.idx(w, x, y)])) return { x, y };
    return W.nearestLand(w, x, y, 4);
  }

  function places(w) {
    const out = [];
    for (const [name, lat, lon, pop] of CITIES) {
      const t = cityTile(w, lat, lon);
      if (t) out.push({ name, x: t.x, y: t.y, pop, lat, lon });
    }
    return out;
  }

  global.PD.Earth = {
    ready, loaded, supported, build, places, metresAt, elev01, baseRain,
    tileLat, tileLon, CITIES, SEA01
  };
})(typeof window !== 'undefined' ? window : globalThis);
