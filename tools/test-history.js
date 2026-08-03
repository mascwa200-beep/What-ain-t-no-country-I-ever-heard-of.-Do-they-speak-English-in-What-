// The past, and whether it is really the past.
//
// The claim this suite exists to check is a strong one: that dropping the
// waterline by 125 m and the temperature by 6 C turns the present Earth into
// the Ice Age Earth, using nothing but real elevation data and the classifier
// the generated worlds already use. That claim is either true in a way you can
// name places about, or it is a blur that looks plausible in a screenshot.
//
// So the assertions are geography. Britain joins Europe. Beringia surfaces.
// The Persian Gulf is dry. Sundaland appears. And the deep ocean stays deep,
// because a "sea level" that simply floods or drains everything would pass a
// weaker test just as well.
//
// Usage: node tools/test-history.js [repoRoot]
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const base = process.argv[2] || '.';

const ctx = {
  console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise,
  parseInt, parseFloat, isNaN, isFinite, Date, Error, RegExp,
  Uint8Array, Uint16Array, Int8Array, Int16Array, Int32Array, Uint32Array,
  Float32Array, Float64Array, ArrayBuffer, DataView,
  setTimeout: (f) => f, clearTimeout: () => 0
};
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(ctx);
for (const f of ['util.js', 'codec.js', 'world.js', 'earthdata.js', 'historydata.js',
                 'history.js', 'earth.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'js', f), 'utf8'), ctx, { filename: f });
}
const PD = ctx.PD, H = PD.History, E = PD.Earth, W = PD.World;

// Decode the baked height field and hand it straight to the module. Node has
// no DecompressionStream on every version we might run on, and the game's own
// decode path is exercised in the browser suites; what matters here is that
// the REAL build() runs against the REAL Earth.
{
  const D = PD.EarthData;
  const raw = new Uint8Array(zlib.gunzipSync(Buffer.from(D.z, 'base64')));
  if (!E.useGrid(raw, D.W, D.H)) throw new Error('could not seed the height field');
}

let fails = 0;
function check(name, cond, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!cond) fails++;
}

// ---------------------------------------------------------------------------
console.log('\n--- nothing here reached a network ---');
{
  // js/historydata.js is BAKED at build time precisely so this suite, and the
  // game, never depend on a live download. Assert that rather than assume it.
  check('no fetch in the sandbox', typeof ctx.fetch === 'undefined');
  check('no XMLHttpRequest', typeof ctx.XMLHttpRequest === 'undefined');
  check('the fetched series shipped with the game',
    !!(PD.HistoryData && PD.HistoryData.population.length > 100),
    PD.HistoryData ? PD.HistoryData.population.length + ' population rows, baked ' +
      PD.HistoryData.fetchedAt : 'missing');
}

// ---------------------------------------------------------------------------
console.log('\n--- the curves say what the sources say ---');
{
  const lgm = H.stateAt(-18000);
  check('the Last Glacial Maximum is ~125 m down',
    lgm.seaLevelM < -115 && lgm.seaLevelM > -140, lgm.seaLevelM + ' m');
  // ~6 C below PRE-INDUSTRIAL is the published figure; the offset the game
  // gets is measured from TODAY, which is another 1.2 C warmer again.
  check('and about 7 C colder than today',
    lgm.tempOffsetC < -6.5 && lgm.tempOffsetC > -8, lgm.tempOffsetC + ' C below today');
  check('and it is named as what it is', /glacial/i.test(lgm.era), lgm.era);

  const now = H.stateAt(2020);
  check('today is at today\'s sea level', Math.abs(now.seaLevelM) < 0.2, now.seaLevelM + ' m');
  check('and today is, by definition, today', now.tempOffsetC === 0 && now.seaLevelM === 0,
    now.seaLevelM + ' m, ' + now.tempOffsetC + ' C');
  check('while the raw curve still knows today is 1.2 C above pre-industrial',
    H.tempAt(2020) > 0.9 && H.tempAt(2020) < 1.5, H.tempAt(2020) + ' C');

  // The curve must be MONOTONIC out of the ice age. A digitised table with a
  // transposed row would still interpolate smoothly and still look like a
  // curve; it would just run backwards somewhere in the middle.
  let backwards = 0, prev = -Infinity;
  for (let y = -20000; y <= 1800; y += 100) {
    const s = H.seaLevelAt(y);
    if (s < prev - 0.6) backwards++;
    prev = s;
  }
  check('the sea rises out of the ice age without ever running backwards',
    backwards === 0, backwards + ' reversals');

  check('the deep past is clamped rather than extrapolated off a cliff',
    H.seaLevelAt(-999999) === H.seaLevelAt(-20000), H.seaLevelAt(-999999) + ' m');

  // Population is fetched, so this checks the SPLICE rather than the numbers.
  check('five million people in 10,000 BC',
    H.populationAt(-10000) > 1e6 && H.populationAt(-10000) < 2e7,
    Math.round(H.populationAt(-10000) / 1e6) + ' M');
  check('eight billion now',
    H.populationAt(2023) > 7.5e9 && H.populationAt(2023) < 8.5e9,
    (H.populationAt(2023) / 1e9).toFixed(2) + ' B');

  // Forward of the measured present the projection must JOIN the record, not
  // jump off it — a discontinuity here is a coastline that lurches the moment
  // you cross today.
  const d = Math.abs(H.seaLevelAt(2021) - H.seaLevelAt(2019));
  check('the projection joins the measured present without a step',
    d < 0.05, (d * 1000).toFixed(1) + ' mm across the join');
  check('and the future is labelled a projection, not a record',
    H.stateAt(2100).projected === true && H.stateAt(1900).projected === false);
  check('the sea is higher in 2100 than today',
    H.seaLevelAt(2100) > H.seaLevelAt(2020) + 0.3,
    H.seaLevelAt(2100).toFixed(2) + ' m');
}

// ---------------------------------------------------------------------------
console.log('\n--- is it really the Ice Age ---');
{
  // Build the same world twice: once now, once at the glacial maximum. Every
  // difference below comes from two numbers.
  function worldAt(year) {
    const w = W.createWorld(360, 180, 'history-test');
    const st = H.stateAt(year);
    const ok = E.build(w, st);
    if (!ok) throw new Error('Earth data did not build');
    return w;
  }
  const at = (w, lat, lon) => {
    const x = Math.floor(((lon + 180) / 360) * w.W);
    const y = Math.floor(((90 - lat) / 180) * w.H);
    return w.biome[Math.max(0, Math.min(w.n - 1, y * w.W + x))];
  };
  const B = W.B;
  const isWater = (b) => b === B.WATER || b === B.DEEP;
  // A shallow sea is not always classified WATER. The height field stores 0 m
  // for shallow water, and elev01(0) is 0.38 — which is EXACTLY assignBiome's
  // WATER/SAND boundary, so the Persian Gulf and the mid-Channel come out as
  // beach. That is reasonable for a 1-degree cell over a shallow gulf, and it
  // means "did the coastline move" has to be asked as "did sea or shore become
  // real ground", not as a WATER/land flip.
  const isWet = (b) => b === B.WATER || b === B.DEEP || b === B.SAND;
  // ...and that is still not the question. A newly exposed continental shelf
  // is legitimately SAND too, so isWet calls Doggerland "still water" the
  // moment it dries out. The biome simply cannot express "submerged": it maps
  // shallow sea AND coastal plain to the same class.
  //
  // Ask the field build() actually writes. elev01 returns <= 0.38 for m <= 0
  // and > 0.38 above it, so this is exactly the `water[i] = m <= 0` line, read
  // back off the finished world.
  const SEA01 = PD.Earth.SEA01;
  const submerged = (w, lat, lon) => {
    const x = Math.floor(((lon + 180) / 360) * w.W);
    const y = Math.floor(((90 - lat) / 180) * w.H);
    return w.elev[Math.max(0, Math.min(w.n - 1, y * w.W + x))] <= SEA01;
  };
  const now = worldAt(2020);
  const ice = worldAt(-18000);

  // --- the coastlines that only a real seabed can produce -----------------
  // Each of these is a place that IS sea today and WAS land at the glacial
  // maximum, and each is somewhere the real bathymetry is shallow.
  // ON CELL CENTRES. The world samples the middle of each cell, so a
  // coordinate picked off a map lands on whatever the neighbouring cell centre
  // happens to be: 50.0,-1.0 is read at 49.5,-0.5, which is Normandy. The
  // first version of this list failed on the Channel and the Persian Gulf for
  // that reason alone — the geography was right and the sampling was not.
  const DROWNED = [
    ['the Channel, off the Cotentin', 49.5, -2.5],
    ['the North Sea, over Doggerland', 54.5, 3.5],
    ['the Bering Strait', 65.5, -169.5],
    ['the Persian Gulf', 28.5, 50.5],
    ['the Sunda shelf, off Borneo', 2.5, 108.5],
    ['the Gulf of Carpentaria', -12.5, 139.5]
  ];
  let land = 0;
  for (const [name, lat, lon] of DROWNED) {
    const a = submerged(now, lat, lon), b = submerged(ice, lat, lon);
    const ok = a && !b;
    check(name + ' is under water now and dry at the glacial maximum', ok,
      (a ? 'water' : 'land') + ' -> ' + (b ? 'water' : 'land'));
    if (ok) land++;
  }
  check('every shallow shelf came up', land === DROWNED.length,
    land + ' of ' + DROWNED.length);

  // --- and the deep stays deep -------------------------------------------
  // A "sea level" that just drains everything would pass all six of those.
  const DEEP = [
    ['the Pacific abyssal plain', 0.5, -160.5],
    ['the mid Atlantic', 30.5, -40.5],
    ['the Indian Ocean', -20.5, 80.5]
  ];
  for (const [name, lat, lon] of DEEP) {
    check(name + ' is still ocean at the glacial maximum',
      isWater(at(ice, lat, lon)), isWater(at(ice, lat, lon)) ? 'ocean' : 'DRAINED');
  }
  // and the continents did not flood either
  check('the Sahara is still land', !isWater(at(ice, 23.5, 12.5)));
  check('Tibet is still land', !isWater(at(ice, 32.5, 86.5)));

  // --- the ice sheets, which nothing draws --------------------------------
  const SNOW = W.B.SNOW;
  function snowFrac(w, lat0, lat1, lon0, lon1) {
    let n = 0, s = 0;
    for (let lat = lat0; lat <= lat1; lat += 1) {
      for (let lon = lon0; lon <= lon1; lon += 1) {
        const b = at(w, lat, lon);
        if (isWater(b)) continue;
        n++; if (b === SNOW) s++;
      }
    }
    return n ? s / n : 0;
  }
  const canadaNow = snowFrac(now, 50, 68, -120, -75);
  const canadaIce = snowFrac(ice, 50, 68, -120, -75);
  check('an ice sheet grows over Canada', canadaIce > canadaNow + 0.25,
    (canadaNow * 100).toFixed(0) + '% -> ' + (canadaIce * 100).toFixed(0) + '% snow');
  const scanNow = snowFrac(now, 55, 70, 5, 30);
  const scanIce = snowFrac(ice, 55, 70, 5, 30);
  check('and over Scandinavia', scanIce > scanNow + 0.25,
    (scanNow * 100).toFixed(0) + '% -> ' + (scanIce * 100).toFixed(0) + '% snow');
  // ...but the world does not simply freeze over, which a big enough offset
  // applied to the wrong term would also achieve
  const tropicsIce = snowFrac(ice, -10, 10, -70, 30);
  check('the tropics do not freeze', tropicsIce < 0.02,
    (tropicsIce * 100).toFixed(1) + '% snow at the equator');

  // --- and the present is still the present -------------------------------
  // stateAt(2020) must leave the world exactly as the game ships it, or every
  // world booted today is quietly a slightly different Earth.
  const plain = W.createWorld(360, 180, 'history-test');
  E.build(plain);
  let diff = 0;
  for (let i = 0; i < plain.n; i++) if (plain.biome[i] !== now.biome[i]) diff++;
  // The datum is the whole point of normalising the fetched series to the
  // present: booting through the history path at today must give byte-for-byte
  // the Earth the game has always booted.
  check('building at today changes nothing about today', diff === 0, diff + ' tiles differ');
}

// ---------------------------------------------------------------------------
console.log('\n--- two records, never merged ---');
{
  const s = H.SCRIPTURE, r = H.RECORD;
  check('both records exist', s.length > 20 && r.length > 15,
    s.length + ' scripture, ' + r.length + ' record');
  check('every entry knows which record it is from',
    s.every((e) => e.source === 'scripture') && r.every((e) => e.source === 'record'));
  check('and eventsBetween never returns one without a source',
    H.eventsBetween(-5000, 2000).every((e) => e.source === 'scripture' || e.source === 'record'));
  check('the two can be asked for separately',
    H.eventsBetween(-5000, 2000, { sources: ['scripture'] }).every((e) => e.source === 'scripture'));

  // THE DISAGREEMENT IS THE POINT. Ussher's creation is 4004 BC; the ice
  // sheets are twenty thousand years older. If these ever coincide, someone
  // has quietly reconciled them, and that is exactly what must not happen.
  const creation = s.find((e) => /let there be light/i.test(e.name));
  check('scripture dates the creation to 4004 BC', creation && creation.year === -4004,
    creation ? H.label(creation.year) : 'missing');
  check('and the physical record still describes an older world at that date',
    H.stateAt(-4004).seaLevelM > -10 && H.stateAt(-18000).seaLevelM < -100,
    '4004 BC: ' + H.stateAt(-4004).seaLevelM + ' m, 18000 BC: ' + H.stateAt(-18000).seaLevelM + ' m');

  // every scriptural event must be citable and placeable
  let noRef = 0, badPlace = 0, badPower = 0;
  const POWERS = new Set(fs.readFileSync(path.join(base, 'js', 'powers.js'), 'utf8')
    .match(/id: *'([a-z0-9_]+)'/g).map((m) => m.replace(/.*'([a-z0-9_]+)'.*/, '$1')));
  for (const e of s) {
    if (!e.ref || !/\d/.test(e.ref)) noRef++;
    if (!e.world && (typeof e.lat !== 'number' || typeof e.lon !== 'number')) badPlace++;
    if (e.power && !POWERS.has(e.power)) badPower++;
  }
  check('every scriptural event carries chapter and verse', noRef === 0, noRef + ' without');
  check('and a place, unless it is the whole world', badPlace === 0, badPlace + ' unplaced');
  // The whole design rests on these being powers that ALREADY EXIST. A typo
  // here is an event that fires and does nothing, silently.
  check('and every power it fires is a real one', badPower === 0, badPower + ' unknown');

  // the placed ones must be on land — an event in the sea cannot be flown to
  {
    const w = W.createWorld(360, 180, 'history-test');
    E.build(w);
    const at = (lat, lon) => {
      const x = Math.floor(((lon + 180) / 360) * w.W);
      const y = Math.floor(((90 - lat) / 180) * w.H);
      return w.biome[Math.max(0, Math.min(w.n - 1, y * w.W + x))];
    };
    // Asking "is this exact cell land" measures the GRID, not the record: at
    // one degree a cell is 111 km, and Rome, Patmos, Pompeii, Messina, San
    // Salvador, Tambora and Cape Canaveral are all coastal or island places
    // whose cell is mostly sea. Nine of them failed that way, which said
    // nothing about whether the coordinates were right.
    //
    // What actually matters is that flyTo has somewhere to land, so: is there
    // ground within a cell or two of every event?
    const dry = (lat, lon) => {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const b = at(lat + dy, lon + dx);
          if (b !== W.B.WATER && b !== W.B.DEEP) return true;
        }
      }
      return false;
    };
    const adrift = [];
    for (const e of s.concat(r)) {
      if (e.lat == null) continue;
      if (e.tiny) continue;          // smaller than a grid cell, and says so
      if (!dry(e.lat, e.lon)) adrift.push(e.name + ' (' + e.lat + ',' + e.lon + ')');
    }
    check('every event has ground within sight of it',
      adrift.length === 0, adrift.length ? adrift.join('; ') : 'all placed');
  }

  check('the flood is the Flood', s.some((e) => e.power === 'flood' && e.year === -2348));
  check('Sinai hands down the commandments',
    s.some((e) => e.power === 'commandments' && e.year === -1491));
  check('dates read as dates', H.label(-4004) === '4004 BC' && H.label(33) === 'AD 33');

  // stepping the clock must not fire the same event twice
  const a = H.eventsBetween(-2400, -2300).length;
  const b = H.eventsBetween(-2300, -2200).length;
  const both = H.eventsBetween(-2400, -2200).length;
  check('a range is the sum of its halves — no event fires twice', a + b === both,
    a + ' + ' + b + ' = ' + both);
}

// ---------------------------------------------------------------------------
console.log('\n--- the record, unabridged ---');
{
  const s = H.SCRIPTURE, r = H.RECORD;
  const books = [...new Set(s.map((e) => H.bookOf(e.ref)))].filter(Boolean);
  check('the record spans the Bible rather than a corner of it',
    books.length >= 30, books.length + ' of 66 books cited');
  check('and it is not all Genesis',
    s.filter((e) => H.bookOf(e.ref) === 'Genesis').length < s.length * 0.25,
    s.filter((e) => H.bookOf(e.ref) === 'Genesis').length + ' of ' + s.length);
  check('the secular record grew with it, so this is not scripture with footnotes',
    r.length >= 40, r.length + ' entries');

  // EVERY CITATION NAMES A REAL BOOK. In a record this size, written out by
  // hand, a mistyped or invented reference is the likeliest defect there is —
  // and it is the one a reader would take entirely at face value.
  const wrong = s.filter((e) => !H.citesRealBook(e.ref));
  check('every citation names a real book of the King James Bible',
    wrong.length === 0, wrong.length ? wrong.map((e) => e.ref).join(', ') : 'all 66 known');
  check('and the book parser handles the awkward ones',
    H.bookOf('1 Kings 6:1') === '1 Kings' &&
    H.bookOf('Song of Solomon 2:1') === 'Song of Solomon' &&
    H.bookOf('Exodus 7:1') === 'Exodus' &&
    !H.citesRealBook('Hezekiah 3:1'));

  // Every entry has to be reachable by the dial that is supposed to reach it.
  const outside = s.concat(r).filter((e) => e.year < H.FIRST_YEAR || e.year > H.LAST_YEAR);
  check('every event lies inside the range the dial can reach', outside.length === 0,
    outside.length ? outside.map((e) => e.name).join(', ') : 'all reachable');

  // A duplicated entry double-fires and double-counts.
  const seen = new Set(), dupes = [];
  for (const e of s.concat(r)) {
    const k = e.name + '@' + e.year;
    if (seen.has(k)) dupes.push(k); else seen.add(k);
  }
  check('no event appears twice', dupes.length === 0, dupes.join(', ') || 'none');
}

// ---------------------------------------------------------------------------
console.log('\n--- of that day and hour knoweth no man ---');
{
  // Prophecy is IN the record and has no date. The year on a prophetic entry
  // is where it sits in the book, not when it happens — and the Bible refuses
  // to say when, so the game must not either.
  const proph = H.prophecies();
  check('the end of days is in the record', proph.length >= 5, proph.length + ' foretold');
  check('and every one of them is scripture', proph.every((e) => e.source === 'scripture'));

  // THE ASSERTION THAT MATTERS: no span of time can reach one, including a
  // span containing the nominal year it is filed under.
  let leaked = 0;
  for (let y = -20000; y < 2300; y += 50) {
    if (H.eventsBetween(y, y + 50).some((e) => e.prophecy)) leaked++;
  }
  check('no range of years ever returns a prophecy', leaked === 0, leaked + ' ranges leaked');
  check('not even the range around the year it is filed under',
    H.eventsBetween(90, 100).every((e) => !e.prophecy),
    H.eventsBetween(90, 100).length + ' events in AD 90-100, none foretold');
  check('but they can be asked for deliberately',
    H.eventsBetween(-20000, 2300, { includeProphecy: true }).some((e) => e.prophecy));

  // ...and it must still be possible to bring one to pass by hand.
  const arm = proph.find((e) => e.power === 'armageddon');
  check('the end can still be fulfilled by your own hand',
    !!arm && !!H.matchAct('armageddon', arm.year, arm.lat, arm.lon),
    arm ? arm.name + ' · ' + arm.ref : 'missing');
  check('and every prophesied power is one the game really has',
    proph.every((e) => !e.power || H.ENACTABLE.has(e.power)),
    proph.map((e) => e.power).join(', '));
}

// ---------------------------------------------------------------------------
console.log('\n--- how much happens at once ---');
{
  // enactRecord fires for EVERY event in a crossing, not just the six that get
  // announced. Tripling the record tripled that, so it is measured rather than
  // assumed still comfortable.
  const DESTRUCTIVE = new Set(['flood', 'plagues', 'judgment', 'fire', 'quake', 'armageddon']);
  let worst = 0, worstY = 0, worstD = 0;
  for (let y = -20000; y < 2300; y += 100) {
    const e = H.eventsBetween(y, y + 100).filter((x) => H.enactable(x));
    if (e.length > worst) { worst = e.length; worstY = y; }
    const d = e.filter((x) => DESTRUCTIVE.has(x.power)).length;
    if (d > worstD) worstD = d;
  }
  check('a century crossing never fires an unreasonable number of powers',
    worst <= 20, worst + ' at ' + H.label(worstY));
  check('and the destructive ones stay a handful', worstD <= 8, worstD + ' at worst');
}

console.log('\n=== history failures: ' + fails + ' ===');
console.log(fails === 0 ? 'HISTORY TEST PASSED' : 'HISTORY TEST FAILED');
process.exit(fails === 0 ? 0 : 1);
