// The past, as three records that are never blended.
//
// The game already had time travel, and it only ever replayed YOUR game:
// ten snapshots taken every ninety seconds, plus a rewind archive that walks
// back through ticks that were actually simulated. Rewind far enough and you
// reach un-creation, not 1492. The world began when you pressed start.
//
// This file is what makes a date a PLACE you can go to.
//
// ---------------------------------------------------------------------------
// THREE RECORDS, LABELLED, NEVER MERGED
//
//   PHYSICAL   sea level, temperature, population. Sourced and cited. This is
//              the one that reshapes the Earth, and it does so through code
//              that already exists: js/earth.js derives everything from real
//              metres, so `water = m <= seaLevelM` and a temperature offset
//              are the whole change. assignBiome already turns cold into
//              SNOW, so the ice sheets grow by themselves.
//
//   SCRIPTURE  the biblical events, at the traditional dates the King James
//              Bible carries in its own margins (Ussher, Annals of the World,
//              1650), each with a place and a chapter and verse.
//
//   RECORD     dated secular events, each with a place.
//
// SCRIPTURE AND PHYSICAL DISAGREE, FAMOUSLY. Ussher puts the creation at
// 4004 BC; the ice sheets this file also describes are twenty thousand years
// older than that. Every entry therefore carries its own `source`, and nothing
// here ever averages them into a single confident claim. In a game where you
// are God, both records being present and named is the point — quietly picking
// one and presenting it as the past would be the dishonest choice.
// ---------------------------------------------------------------------------
//
// No GL and no DOM, so this runs under Node like js/lod.js and js/sim.js do.
(function (global) {
  'use strict';
  const PD = global.PD;

  // Years are signed integers: -4004 means 4004 BC. There is no year zero in
  // the historical calendar, but there is one here — the arithmetic is worth
  // more than the convention, and one year out at this range is invisible.
  const FIRST_YEAR = -20000;      // the deep end of the dial
  const LAST_YEAR = 2300;         // as far forward as the projections reach

  // -------------------------------------------------------------------------
  // PALAEO SEA LEVEL — metres relative to today.
  //
  // NOT FETCHABLE, so it is here rather than in the generated file, and it is
  // a DIGITISATION of a published curve rather than that curve's own table:
  //
  //   Lambeck, Rouby, Purcell, Sun & Sambridge (2014), "Sea level and global
  //   ice volumes from the Last Glacial Maximum to the Holocene", PNAS
  //   111(43):15296-15303.
  //
  // Their Last Glacial Maximum figure is about -134 m at ~21 ka. Read at this
  // resolution the curve is accurate to a few metres, which is far below the
  // 56 km cell of the world grid — a metre of sea level is invisible here, a
  // hundred metres redraws every coastline on Earth.
  //
  // Converted from "before present" (BP is before 1950) to calendar years.
  const SEA_PALAEO = [
    [-20000, -128], [-19000, -125], [-18000, -122], [-17000, -118],
    [-16000, -113], [-15000, -105], [-14000, -96], [-13000, -82],
    [-12500, -75], [-12000, -66], [-11000, -58], [-10000, -48],
    [-9000, -38], [-8000, -28], [-7000, -18], [-6000, -10],
    [-5000, -5], [-4000, -2.5], [-3000, -1.5], [-2000, -0.8],
    [-1000, -0.4], [0, -0.2], [1000, -0.15], [1800, -0.15]
  ];

  // PALAEO TEMPERATURE — degrees C relative to the 1850-1900 baseline.
  //
  //   Tierney, Zhu, King, Malevich, Hakim & Poulsen (2020), "Glacial cooling
  //   and climate sensitivity revisited", Nature 584:569-573 — LGM global mean
  //   6.1 C below pre-industrial.
  //
  // The Holocene is deliberately drawn flat within a few tenths. The Holocene
  // thermal maximum was regionally warm and seasonally biased, and the global
  // annual mean is small and contested; drawing a confident bump would be
  // inventing detail this game has no use for.
  const TEMP_PALAEO = [
    [-20000, -6.1], [-18000, -5.9], [-16000, -5.2], [-15000, -4.4],
    [-14000, -3.2], [-13000, -2.0], [-12500, -1.6], [-12000, -2.2],
    [-11000, -1.4], [-10000, -0.6], [-9000, -0.2], [-8000, 0.0],
    [-6000, 0.2], [-4000, 0.1], [-2000, 0.0], [0, 0.0],
    [1000, 0.0], [1600, -0.3], [1850, 0.0]
  ];

  // FORWARD — projections, not record, and labelled as such wherever shown.
  // Bracketing IPCC AR6 SSP1-2.6 and SSP5-8.5 and taking the middle: about
  // +0.6 m and +2.7 C by 2100, continuing to rise after.
  const SEA_FUTURE = [[2020, 0.06], [2050, 0.22], [2100, 0.62], [2200, 1.7], [2300, 2.9]];
  const TEMP_FUTURE = [[2020, 1.2], [2050, 1.9], [2100, 2.7], [2200, 3.4], [2300, 3.8]];

  // Linear between samples; flat outside. A table this sparse read with
  // anything fancier would invent wiggles it does not have.
  function sample(table, year) {
    if (!table.length) return 0;
    if (year <= table[0][0]) return table[0][1];
    const last = table[table.length - 1];
    if (year >= last[0]) return last[1];
    for (let i = 1; i < table.length; i++) {
      if (year <= table[i][0]) {
        const [x0, y0] = table[i - 1], [x1, y1] = table[i];
        const t = (year - x0) / (x1 - x0);
        return y0 + (y1 - y0) * t;
      }
    }
    return last[1];
  }

  // The instrumental series is real measurement and outranks both the
  // digitised palaeo curve and the projection wherever it exists.
  function seaLevelAt(year) {
    const D = global.PD && PD.HistoryData;
    if (D && D.seaLevel && D.seaLevel.length) {
      const first = D.seaLevel[0], last = D.seaLevel[D.seaLevel.length - 1];
      if (year >= first[0] && year <= last[0]) return sample(D.seaLevel, year);
      if (year > last[0]) {
        // splice the projection onto the measured present rather than letting
        // the two disagree at the join, which would read as a jump in the
        // coastline the moment you crossed the present
        return sample(SEA_FUTURE, year) - sample(SEA_FUTURE, last[0]) + last[1];
      }
    }
    if (year > 1900) return sample(SEA_FUTURE, year);
    return sample(SEA_PALAEO, year);
  }

  // The instrumental record, HadCRUT-like, relative to 1850-1900.
  const TEMP_MODERN = [[1850, 0.0], [1900, -0.05], [1940, 0.2], [1980, 0.35], [2000, 0.75], [2020, 1.2]];

  // Three plain cases, in order. (The first version of this was a nested
  // ternary that could not be read, which is how a curve gets a kink nobody
  // notices.)
  function tempAt(year) {
    if (year < 1850) return sample(TEMP_PALAEO, year);
    if (year <= 2020) return sample(TEMP_MODERN, year);
    return sample(TEMP_FUTURE, year);
  }

  function populationAt(year) {
    const D = global.PD && PD.HistoryData;
    if (!D || !D.population || !D.population.length) return null;
    return Math.round(sample(D.population, year));
  }

  // What era this is, in the physical record's own terms.
  function eraAt(year) {
    if (year <= -18000) return 'the Last Glacial Maximum';
    if (year <= -11700) return 'the deglaciation';
    if (year <= -9700) return 'the Younger Dryas';
    if (year <= -3000) return 'the early Holocene';
    if (year <= 500) return 'antiquity';
    if (year <= 1500) return 'the middle ages';
    if (year <= 1800) return 'the early modern world';
    if (year <= 1945) return 'the industrial age';
    if (year <= 2025) return 'living memory';
    return 'a projected future';
  }

  // The year the game's own Earth already is. Both offsets below are measured
  // FROM here, not from a scientific baseline, because js/earth.js is tuned to
  // the present: handing it "+1.2 C above pre-industrial" for today would add
  // today's warming to a climate that already contains it, and 391 tiles
  // changed biome when it did.
  const PRESENT = 2020;

  // The whole physical record at a moment, in the units js/earth.js wants.
  function stateAt(year) {
    const y = PD.clamp(Math.round(year), FIRST_YEAR, LAST_YEAR);
    return {
      year: y,
      seaLevelM: +seaLevelAt(y).toFixed(2),
      tempOffsetC: +(tempAt(y) - tempAt(PRESENT)).toFixed(2),
      population: populationAt(y),
      era: eraAt(y),
      projected: y > 2023,
      source: y > 2023 ? 'projection' : 'physical'
    };
  }

  // -------------------------------------------------------------------------
  // THE SCRIPTURAL RECORD
  //
  // Dated by Ussher, because the question was about the King James Bible and
  // Ussher's is the chronology printed in its margins. `circa` marks the ones
  // where the traditional dating is a reckoning rather than an anchor.
  //
  // `power` names a power THAT ALREADY EXISTS in js/powers.js and is already
  // tested. None of this needed new machinery: the Flood is the Great Flood
  // the player can already call down, Egypt is the Ten Plagues, Sinai is the
  // Commandments, the six days are the Genesis powers.
  const SCRIPTURE = [
    { year: -4004, name: 'Let there be light', ref: 'Genesis 1:3', power: 'gen_light',
      lat: null, lon: null, world: true, text: 'The first day. Light divided from darkness.' },
    { year: -4004, name: 'The firmament', ref: 'Genesis 1:6', power: 'gen_firmament',
      lat: null, lon: null, world: true, text: 'The second day. The waters divided.' },
    { year: -4004, name: 'Dry land appears', ref: 'Genesis 1:9', power: 'gen_land',
      lat: null, lon: null, world: true, text: 'The third day. The seas gathered, the land revealed.' },
    { year: -4004, name: 'Grass, herb and tree', ref: 'Genesis 1:11', power: 'gen_green',
      lat: null, lon: null, world: true, text: 'Still the third day. The earth brought forth.' },
    { year: -4004, name: 'The sun, the moon, the stars', ref: 'Genesis 1:14', power: 'gen_lights',
      lat: null, lon: null, world: true, text: 'The fourth day. Lights set for signs and seasons.' },
    { year: -4004, name: 'Every living thing', ref: 'Genesis 1:20', power: 'gen_life',
      lat: null, lon: null, world: true, text: 'The fifth and sixth days. The waters and the air and the earth filled.' },
    { year: -4004, name: 'The seventh day', ref: 'Genesis 2:2', power: 'gen_rest',
      lat: null, lon: null, world: true, text: 'He rested, and blessed it, and hallowed it.' },
    { year: -4004, name: 'Eden', ref: 'Genesis 2:8', power: null, circa: true,
      lat: 31.0, lon: 47.4, text: 'A garden eastward in Eden, and a river to water it.' },
    { year: -4004, name: 'The Fall', ref: 'Genesis 3:6', power: null, circa: true,
      lat: 31.0, lon: 47.4, text: 'The fruit taken, and the gate shut behind them.' },
    { year: -3875, name: 'Cain and Abel', ref: 'Genesis 4:8', power: null, circa: true,
      lat: 31.0, lon: 47.4, text: 'The first city is built by the first murderer.' },
    { year: -2348, name: 'The Flood', ref: 'Genesis 7:11', power: 'flood',
      lat: 39.7, lon: 44.3, world: true,
      text: 'The fountains of the great deep broken up, and the windows of heaven opened.' },
    { year: -2348, name: 'The ark rests on Ararat', ref: 'Genesis 8:4', power: null,
      lat: 39.7, lon: 44.3, text: 'And the waters returned from off the earth continually.' },
    { year: -2242, name: 'Babel', ref: 'Genesis 11:9', power: 'babel', circa: true,
      lat: 32.54, lon: 44.42,
      text: 'One language, and one speech — until it was confounded.' },
    { year: -1921, name: 'The call of Abram', ref: 'Genesis 12:1', power: 'prophet',
      lat: 30.96, lon: 46.10, text: 'Get thee out of thy country, unto a land that I will shew thee.' },
    { year: -1897, name: 'Sodom and Gomorrah', ref: 'Genesis 19:24', power: 'fire',
      lat: 31.2, lon: 35.4, text: 'Brimstone and fire out of heaven.' },
    { year: -1728, name: 'Joseph sold into Egypt', ref: 'Genesis 37:28', power: null, circa: true,
      lat: 30.8, lon: 31.8, text: 'Twenty pieces of silver, and a coat of many colours.' },
    { year: -1571, name: 'Moses in the bulrushes', ref: 'Exodus 2:3', power: null, circa: true,
      lat: 30.8, lon: 31.8, text: 'An ark of bulrushes, daubed with slime and with pitch.' },
    { year: -1491, name: 'The plagues of Egypt', ref: 'Exodus 7-12', power: 'plagues',
      lat: 30.8, lon: 31.8, text: 'Blood, frogs, lice, flies, murrain, boils, hail, locusts, darkness, and the firstborn.' },
    { year: -1491, name: 'The Red Sea parts', ref: 'Exodus 14:21', power: null,
      lat: 29.5, lon: 32.6, text: 'And the waters were a wall unto them on their right hand and on their left.' },
    { year: -1491, name: 'The Commandments at Sinai', ref: 'Exodus 20', power: 'commandments',
      lat: 28.54, lon: 33.97, text: 'And God spake all these words, saying…' },
    { year: -1451, name: 'The walls of Jericho', ref: 'Joshua 6:20', power: 'quake',
      lat: 31.87, lon: 35.44, text: 'The wall fell down flat, and the people went up into the city.' },
    { year: -1055, name: 'David king in Israel', ref: '2 Samuel 5:4', power: 'crown', circa: true,
      lat: 31.78, lon: 35.23, text: 'Thirty years old when he began to reign, and he reigned forty years.' },
    { year: -1012, name: "Solomon's Temple begun", ref: '1 Kings 6:1', power: null,
      lat: 31.78, lon: 35.23, text: 'In the fourth year of Solomon’s reign over Israel.' },
    { year: -975, name: 'The kingdom divides', ref: '1 Kings 12:19', power: null, circa: true,
      lat: 31.78, lon: 35.23, text: 'So Israel rebelled against the house of David unto this day.' },
    { year: -862, name: 'Elijah on Carmel', ref: '1 Kings 18:38', power: 'lightning', circa: true,
      lat: 32.73, lon: 35.05, text: 'Then the fire of the LORD fell, and consumed the burnt sacrifice.' },
    { year: -862, name: 'Jonah at Nineveh', ref: 'Jonah 3:4', power: 'prophet', circa: true,
      lat: 36.36, lon: 43.15, text: 'Yet forty days, and Nineveh shall be overthrown.' },
    { year: -721, name: 'The fall of Samaria', ref: '2 Kings 17:6', power: 'judgment',
      lat: 32.28, lon: 35.20, text: 'And carried Israel away into Assyria.' },
    { year: -588, name: 'Jerusalem falls; the Temple burned', ref: '2 Kings 25:9', power: 'judgment',
      lat: 31.78, lon: 35.23, text: 'And he burnt the house of the LORD, and the king’s house.' },
    { year: -536, name: 'The return from exile', ref: 'Ezra 1:3', power: 'bless',
      lat: 31.78, lon: 35.23, text: 'Who is there among you of all his people? let him go up.' },
    { year: -4, name: 'The Nativity', ref: 'Luke 2:7', power: 'miracle',
      lat: 31.70, lon: 35.20, text: 'And she brought forth her firstborn son, and laid him in a manger.' },
    { year: 30, name: 'The ministry begins', ref: 'Luke 3:23', power: 'prophet', circa: true,
      lat: 32.70, lon: 35.30, text: 'And Jesus himself began to be about thirty years of age.' },
    { year: 33, name: 'The Crucifixion', ref: 'Luke 23:44', power: 'voice',
      lat: 31.78, lon: 35.23,
      text: 'And there was a darkness over all the earth until the ninth hour.' },
    { year: 33, name: 'The Resurrection', ref: 'Luke 24:6', power: 'raise_dead',
      lat: 31.78, lon: 35.23, text: 'He is not here, but is risen.' },
    { year: 33, name: 'Pentecost', ref: 'Acts 2:3', power: 'voice',
      lat: 31.78, lon: 35.23, text: 'Cloven tongues like as of fire, and it sat upon each of them.' },
    { year: 96, name: 'The Revelation on Patmos', ref: 'Revelation 1:9', power: null, circa: true,
      lat: 37.31, lon: 26.55, text: 'I was in the isle that is called Patmos, for the word of God.' }
  ];

  // -------------------------------------------------------------------------
  // THE SECULAR RECORD — sparse on purpose. Everything here is a date a
  // schoolchild could check; anything I could not cite is not in it.
  const RECORD = [
    { year: -3100, name: 'Egypt unified', lat: 25.7, lon: 32.6, circa: true },
    { year: -2560, name: 'The Great Pyramid', lat: 29.98, lon: 31.13, circa: true },
    { year: -1754, name: 'The Code of Hammurabi', lat: 32.54, lon: 44.42, circa: true },
    { year: -776, name: 'The first Olympiad', lat: 37.64, lon: 21.63 },
    { year: -753, name: 'Rome founded, by tradition', lat: 41.90, lon: 12.50, circa: true },
    { year: -221, name: 'China unified under Qin', lat: 34.27, lon: 108.95 },
    { year: -44, name: 'Caesar killed', lat: 41.90, lon: 12.48 },
    { year: 79, name: 'Vesuvius buries Pompeii', lat: 40.75, lon: 14.49 },
    { year: 476, name: 'The western empire ends', lat: 41.90, lon: 12.50 },
    { year: 622, name: 'The Hijra', lat: 24.47, lon: 39.61 },
    { year: 1066, name: 'Hastings', lat: 50.91, lon: 0.49 },
    { year: 1206, name: 'Genghis Khan proclaimed', lat: 47.92, lon: 106.92 },
    { year: 1347, name: 'The Black Death reaches Europe', lat: 37.07, lon: 15.29 },
    { year: 1440, name: 'Movable type in Europe', lat: 49.99, lon: 8.27, circa: true },
    // San Salvador is 12 km across against a 111 km grid cell, so this
    // landfall has no land under it at world resolution. Marked rather than
    // moved: the coordinate is right and the grid is coarse, and pretending
    // otherwise by nudging it onto Cuba would put a real event in the wrong
    // place to make a test pass.
    { year: 1492, name: 'Columbus makes landfall', lat: 24.05, lon: -74.50, tiny: true },
    { year: 1687, name: 'The Principia', lat: 51.51, lon: -0.13 },
    { year: 1789, name: 'The Bastille falls', lat: 48.85, lon: 2.37 },
    { year: 1815, name: 'Tambora erupts; the year without a summer', lat: -8.25, lon: 118.00 },
    { year: 1859, name: 'On the Origin of Species', lat: 51.51, lon: -0.13 },
    { year: 1914, name: 'The Great War begins', lat: 43.86, lon: 18.41 },
    { year: 1945, name: 'Hiroshima', lat: 34.39, lon: 132.45 },
    { year: 1969, name: 'Apollo 11', lat: 28.57, lon: -80.65 },
    { year: 1991, name: 'The World Wide Web opens', lat: 46.23, lon: 6.05 }
  ];

  // Tag every entry with its source ONCE, here, so nothing downstream has to
  // remember which list it came from — and so the two can never be quietly
  // concatenated into an undifferentiated "history".
  SCRIPTURE.forEach((e) => { e.source = 'scripture'; });
  RECORD.forEach((e) => { e.source = 'record'; });

  // Everything between two years, oldest first. Half-open at the low end so
  // stepping the clock forward never fires the same event twice.
  function eventsBetween(fromYear, toYear, opt) {
    const lo = Math.min(fromYear, toYear), hi = Math.max(fromYear, toYear);
    const want = (opt && opt.sources) || ['scripture', 'record'];
    const out = [];
    for (const list of [SCRIPTURE, RECORD]) {
      for (const e of list) {
        if (want.indexOf(e.source) < 0) continue;
        if (e.year > lo && e.year <= hi) out.push(e);
      }
    }
    out.sort((a, b) => a.year - b.year);
    return out;
  }

  function eventsAt(year, slackYears) {
    const s = slackYears == null ? 0 : slackYears;
    return eventsBetween(year - s - 1, year + s);
  }

  // 4004 BC reads better than -4004, and the sign is easy to miss on a dial.
  function label(year) {
    return year < 0 ? Math.abs(year) + ' BC' : 'AD ' + year;
  }

  global.PD.History = {
    stateAt, eventsBetween, eventsAt, label,
    seaLevelAt, tempAt, populationAt, eraAt, sample,
    SCRIPTURE, RECORD, SEA_PALAEO, TEMP_PALAEO, SEA_FUTURE, TEMP_FUTURE, PRESENT,
    FIRST_YEAR, LAST_YEAR
  };
})(typeof window !== 'undefined' ? window : globalThis);
