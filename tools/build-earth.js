// Build js/earthdata.js — the real shape of the Earth, baked once.
//
// Why this is a BUILD step and not a runtime fetch: the elevation tiles live on
// an S3 bucket that serves no Access-Control-Allow-Origin header, so a browser
// cannot read their pixels. Node has no such restriction. We fetch and decode
// here, embed the result, and the game then has real coastlines and real
// mountains whether or not it ever reaches the network again.
//
// Source: AWS "Terrain Tiles" open dataset, terrarium encoding —
//   elevation_metres = (R * 256 + G + B / 256) - 32768
// built from SRTM/GMTED/ETOPO1/NED etc. Public domain / open licences.
//
// SOURCE ZOOM IS 4 ON PURPOSE, AND GOING DEEPER MAKES THE PLANET WORSE.
// Probed at 72N -40W (interior Greenland) and -80N 0E (interior Antarctica):
//
//     zoom      Greenland   Antarctica        Tibet       Sahara
//     z3           3104 m       2339 m       4856 m        791 m
//     z4           3101 m       2339 m       5008 m        815 m
//     z5            -20 m        -56 m       4881 m        816 m
//     z6            -18 m        -53 m       5000 m        811 m
//     z7            -19 m        -55 m       4942 m        822 m
//
// From z5 down, both ice sheets collapse to sea level — those levels are built
// from a bedrock-under-ice source. Greenland and Antarctica would render as
// ocean. z4 keeps them, and at 4096 px wide it still oversamples a 56 km
// output cell by ~5.7x in each axis, so nothing is actually lost: Tibet reads
// 5008 m at z4 against 5000 m at z6. The reality checks below caught this;
// without them the game would have shipped a planet with no Antarctica.
//
// Usage: node tools/build-earth.js [--zoom 4] [--width 720] [--out js/earthdata.js]
//
// Verified against known coordinates on build (see CHECKS below) so a silently
// corrupt fetch cannot ship a wrong planet.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

const Z = parseInt(argv('zoom', '4'), 10);          // mercator tile zoom to source from
const OUT_W = parseInt(argv('width', '720'), 10);   // equirectangular output width
const OUT_H = OUT_W >> 1;
const OUT = path.resolve(argv('out', path.join(__dirname, '..', 'js', 'earthdata.js')));
const CONCURRENCY = parseInt(argv('jobs', '8'), 10);

const N = 1 << Z;                                    // tiles per axis
const TILE = 256;

// ---------------------------------------------------------------- PNG decode
// Minimal decoder: we only ever see 8-bit RGB/RGBA non-interlaced tiles from
// this one service, so there is no reason to carry a general implementation.
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error('unexpected bit depth ' + bitDepth);
  if (interlace) throw new Error('interlaced PNG not supported');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!ch) throw new Error('unexpected colour type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride), ri = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[ri++];
    const line = Buffer.from(raw.subarray(ri, ri + stride)); ri += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 255;
    }
    line.copy(out, y * stride); prev = line;
  }
  return { w, h, ch, px: out };
}

// ---------------------------------------------------------------- fetch
function get(url, tries) {
  // S3 answers 503 under load. A tile that gives up is a HOLE IN THE EARTH, so
  // retry patiently rather than cheaply — this runs once, at build time.
  tries = tries == null ? 8 : tries;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 45000, headers: { 'User-Agent': 'PixelDeity-build/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        // 404 is a real answer for ocean-only tiles on some pyramids; treat as empty
        if (res.statusCode === 404) return resolve(null);
        return tries > 0
          ? setTimeout(() => get(url, tries - 1).then(resolve, reject), 400 * Math.pow(1.7, 8 - tries))
          : reject(new Error(res.statusCode + ' ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => {
      if (tries > 0) setTimeout(() => get(url, tries - 1).then(resolve, reject), 400 * Math.pow(1.7, 8 - tries));
      else reject(e);
    });
  });
}

const tileURL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// ---------------------------------------------------------------- main
// Mercator y -> latitude, and the inverse. The source pyramid is Web Mercator;
// the game's world is equirectangular (row = latitude), so every output row has
// to be pulled from the right mercator row rather than a linear one.
const mercY2Lat = (yn) => {                 // yn in 0..1 over the full pyramid
  const n = Math.PI - 2 * Math.PI * yn;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const lat2MercY = (lat) => {
  const s = Math.sin(lat * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

// Web Mercator cannot represent the poles; it stops at ~85.05°. Rows beyond
// that are filled from the last representable row rather than left as a hole,
// which is why Antarctica reads as ice rather than as ocean.
const MERC_LAT = 85.0511287798066;

async function main() {
  console.log(`Building Earth: source z${Z} (${N}x${N} tiles), output ${OUT_W}x${OUT_H} equirectangular`);
  const srcW = N * TILE, srcH = N * TILE;
  console.log(`  mercator source grid: ${srcW}x${srcH} px, ${N * N} tiles to fetch`);

  // Which mercator rows do we actually need? One per output row (plus its
  // neighbour for averaging). Fetch whole tile rows, use them, discard them —
  // holding the entire 8192x8192 grid would be 268 MB.
  // Accumulate rather than point-sample. The source is finer than the output,
  // so every output cell averages every source pixel that lands in it — a
  // nearest-neighbour pick would throw away most of the data and make
  // mountains read as whatever single pixel happened to be probed.
  const elev = new Float32Array(OUT_W * OUT_H);
  const acc = new Float64Array(OUT_W * OUT_H);
  const cnt = new Uint32Array(OUT_W * OUT_H);
  // Peaks matter for a planet you look at: keep the highest source pixel per
  // cell too, and blend a little of it back so ranges keep their spine.
  const peak = new Float32Array(OUT_W * OUT_H).fill(-Infinity);
  const t0 = Date.now();
  let fetched = 0, failed = 0;

  for (let ty = 0; ty < N; ty++) {
    // rows of this tile row cover mercator y in [ty*TILE, (ty+1)*TILE)
    const row = new Array(N);
    let inFlight = [];
    for (let tx = 0; tx < N; tx++) {
      const p = get(tileURL(Z, tx, ty))
        .then((buf) => { row[tx] = buf ? decodePNG(buf) : null; fetched++; })
        .catch((e) => { row[tx] = null; failed++; if (failed < 6) console.warn('  tile failed', Z, tx, ty, e.message); });
      inFlight.push(p);
      if (inFlight.length >= CONCURRENCY) { await Promise.all(inFlight); inFlight = []; }
    }
    await Promise.all(inFlight);

    // Push every source pixel of this tile row into the output cell it lands
    // in. Walking the SOURCE (not the output) is what makes this an average
    // instead of a sample, and it is why a 55 km cell over the Himalaya comes
    // out as mountain rather than as whichever pixel we happened to probe.
    for (let sy = 0; sy < TILE; sy++) {
      const yn = (ty * TILE + sy + 0.5) / srcH;
      const lat = mercY2Lat(yn);
      const oy = Math.min(OUT_H - 1, Math.max(0, Math.floor((90 - lat) / 180 * OUT_H)));
      const orow = oy * OUT_W;
      for (let tx = 0; tx < N; tx++) {
        const t = row[tx];
        if (!t) continue;
        const base = sy * t.w * t.ch;
        for (let sx = 0; sx < TILE; sx++) {
          const mx = tx * TILE + sx + 0.5;
          const ox = Math.min(OUT_W - 1, (mx / srcW * OUT_W) | 0);
          const i = base + sx * t.ch;
          const e = (t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256) - 32768;
          const o = orow + ox;
          acc[o] += e; cnt[o]++;
          if (e > peak[o]) peak[o] = e;
        }
      }
    }
    if (ty % 4 === 0 || ty === N - 1) {
      process.stdout.write(`  row ${ty + 1}/${N}  (${fetched} tiles, ${((Date.now() - t0) / 1000).toFixed(0)}s)\r`);
    }
  }
  console.log(`\n  fetched ${fetched} tiles in ${((Date.now() - t0) / 1000).toFixed(0)}s (${failed} failed)`);

  // Resolve each cell: mostly the mean, with a little of the peak mixed back
  // so mountain ranges keep a spine instead of being flattened by averaging.
  // Land only — pulling ocean toward its shallowest pixel would erase trenches
  // and creep coastlines outward.
  for (let i = 0; i < elev.length; i++) {
    if (!cnt[i]) { elev[i] = 0; continue; }
    const mean = acc[i] / cnt[i];
    elev[i] = (mean > 0 && peak[i] > mean) ? mean + (peak[i] - mean) * 0.45 : mean;
  }

  // No cell may be empty. A tile that failed to fetch leaves cnt === 0, which
  // would quietly become sea level — an ocean where a continent should be. The
  // polar rows are legitimately empty (mercator cannot reach them) and are
  // filled below; anything else is a hole and fails the build.
  {
    const capT = Math.floor((90 - MERC_LAT) / 180 * OUT_H);
    const capB = OUT_H - 1 - capT;
    let holes = 0, firstHole = null;
    for (let oy = capT; oy <= capB; oy++)
      for (let ox = 0; ox < OUT_W; ox++)
        if (!cnt[oy * OUT_W + ox]) {
          holes++;
          if (!firstHole) firstHole = { lat: (90 - (oy + 0.5) * 180 / OUT_H).toFixed(1), lon: ((ox + 0.5) / OUT_W * 360 - 180).toFixed(1) };
        }
    if (holes) {
      console.error(`\n  ${holes} cell(s) never received data — first at lat ${firstHole.lat}, lon ${firstHole.lon}.`);
      console.error('  That is a hole in the Earth. Re-run; the source throttles under load.');
      process.exitCode = 1; return;
    }
    console.log('  every cell covered: no holes');
  }

  // Fill the polar caps from the last representable mercator row, so the
  // Arctic and Antarctic are land/ice rather than a band of zeroes.
  const capTop = Math.floor((90 - MERC_LAT) / 180 * OUT_H);
  const capBot = OUT_H - 1 - capTop;
  for (let oy = 0; oy < capTop; oy++)
    for (let ox = 0; ox < OUT_W; ox++) elev[oy * OUT_W + ox] = elev[capTop * OUT_W + ox];
  for (let oy = capBot + 1; oy < OUT_H; oy++)
    for (let ox = 0; ox < OUT_W; ox++) elev[oy * OUT_W + ox] = elev[capBot * OUT_W + ox];

  // ------------------------------------------------------------ sanity
  // A silently corrupt fetch must not ship a wrong planet.
  const at = (lat, lon) => {
    const oy = Math.min(OUT_H - 1, Math.max(0, Math.floor((90 - lat) / 180 * OUT_H)));
    const ox = ((Math.floor((lon + 180) / 360 * OUT_W) % OUT_W) + OUT_W) % OUT_W;
    return elev[oy * OUT_W + ox];
  };
  // These test that the planet IS EARTH, not that it is a survey. A cell here
  // is 55 km across at the shipping resolution and 222 km at low ones, so
  // anything narrower than a cell — the Dead Sea rift is 15 km, Everest's
  // summit is a point — is averaged away by definition and would be a
  // dishonest thing to assert. Every check below is a feature far larger than
  // any cell we will ever use, so it holds at every resolution.
  const cellKm = 40008 / OUT_W;
  const CHECKS = [
    ['Himalaya/Tibet',  32.00,   86.00, (v) => v > 3000,          '> 3000 m'],
    ['Andes',          -20.00,  -68.00, (v) => v > 2000,          '> 2000 m'],
    ['Rockies',         39.00, -106.00, (v) => v > 1500,          '> 1500 m'],
    ['Pacific abyss',    0.00, -160.00, (v) => v < -3000,         '< -3000 m'],
    ['Atlantic abyss',  30.00,  -40.00, (v) => v < -2000,         '< -2000 m'],
    ['Indian Ocean',   -20.00,   80.00, (v) => v < -2000,         '< -2000 m'],
    ['Mediterranean',   35.00,   18.00, (v) => v < 0,             'below sea level'],
    ['Amazon basin',    -3.00,  -60.00, (v) => v > 0 && v < 500,  'low land'],
    ['Sahara',          23.00,   12.00, (v) => v > 0,             'land'],
    ['Congo basin',     -1.00,   22.00, (v) => v > 0 && v < 1200, 'land'],
    ['Greenland',       72.00,  -40.00, (v) => v > 1000,          'ice sheet'],
    ['Antarctica',     -80.00,    0.00, (v) => v > 0,             'ice sheet above sea level'],
    ['Siberia',         65.00,  100.00, (v) => v > 0,             'land'],
    ['Australia',      -25.00,  133.00, (v) => v > 0,             'land']
  ];
  let bad = 0;
  console.log(`\n  reality check  (cell = ${cellKm.toFixed(0)} km across):`);
  for (const [name, la, lo, ok, want] of CHECKS) {
    const v = at(la, lo);
    const pass = ok(v);
    if (!pass) bad++;
    console.log(`    ${pass ? 'ok  ' : 'FAIL'} ${name.padEnd(15)} ${v.toFixed(0).padStart(7)} m   (want ${want})`);
  }
  let land = 0;
  for (let i = 0; i < elev.length; i++) if (elev[i] > 0) land++;
  const landPct = land / elev.length * 100;
  console.log(`    land above sea level: ${landPct.toFixed(1)}%  (Earth is ~29%, plus ice shelves)`);
  if (landPct < 20 || landPct > 45) { console.error('    FAIL land fraction is not Earth-like'); bad++; }
  if (bad) { console.error(`\n${bad} reality check(s) failed — NOT writing ${OUT}`); process.exitCode = 1; return; }

  // ------------------------------------------------------------ encode
  // Two bytes per cell would be 518 KB at 720x360. Quantise instead: the game
  // needs shape, not survey accuracy. Ocean depth is compressed hard (nobody
  // sees the abyssal plain) and land keeps ~40 m steps.
  const q = new Uint8Array(OUT_W * OUT_H);
  for (let i = 0; i < elev.length; i++) {
    const e = elev[i];
    // 0 = deepest ocean .. 63 = sea level .. 255 = 8848 m
    q[i] = e <= 0
      ? Math.max(0, Math.round(63 + e / 11000 * 63))
      : Math.min(255, Math.round(63 + e / 8848 * 192));
  }
  const packed = zlib.gzipSync(Buffer.from(q.buffer), { level: 9 }).toString('base64');

  const js = `/* =========================================================================
   PIXEL DEITY — earthdata.js   GENERATED FILE, DO NOT EDIT BY HAND
   Regenerate with:  node tools/build-earth.js

   The real shape of the Earth: a ${OUT_W}x${OUT_H} equirectangular height field,
   quantised to one byte per cell and gzipped. Sea level is 63; below that is
   ocean (down to ~-11000 m at 0), above it is land (up to 8848 m at 255).

   Built from the AWS "Terrain Tiles" open dataset (terrarium encoding,
   z${Z}), which is assembled from SRTM, GMTED2010, ETOPO1 and national
   elevation datasets. Public domain / open licence.

   Baked at build time rather than fetched at runtime because that bucket
   serves no CORS header, so a browser cannot read the pixels. This is also
   why the Earth still has its real shape with no network at all.
   ========================================================================= */
(function (global) {
  'use strict';
  const PD = global.PD = global.PD || {};
  PD.EarthData = {
    W: ${OUT_W}, H: ${OUT_H},
    SEA: 63,                 // the quantised value of sea level
    MAX_M: 8848, MIN_M: -11000,
    // metres for a quantised value
    metres(q) { return q >= 63 ? (q - 63) / 192 * 8848 : (q - 63) / 63 * 11000; },
    z: '${packed}'
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;
  fs.writeFileSync(OUT, js);
  const kb = (js.length / 1024).toFixed(0);
  console.log(`\nwrote ${OUT}  (${kb} KB, ${OUT_W}x${OUT_H} cells)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
