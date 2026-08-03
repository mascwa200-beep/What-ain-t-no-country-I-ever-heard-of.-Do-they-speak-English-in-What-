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
    { year: -4004, name: 'Let there be light', ref: 'Genesis 1:3', power: 'gen_light', world: true, lat: null, lon: null, text: 'The first day. Light divided from darkness.' },
    { year: -4004, name: 'The firmament', ref: 'Genesis 1:6', power: 'gen_firmament', world: true, lat: null, lon: null, text: 'The second day. The waters divided from the waters.' },
    { year: -4004, name: 'Dry land appears', ref: 'Genesis 1:9', power: 'gen_land', world: true, lat: null, lon: null, text: 'The third day. The seas gathered, and the dry land seen.' },
    { year: -4004, name: 'Grass, herb and tree', ref: 'Genesis 1:11', power: 'gen_green', world: true, lat: null, lon: null, text: 'Still the third day. The earth brought forth.' },
    { year: -4004, name: 'The sun, the moon, the stars', ref: 'Genesis 1:14', power: 'gen_lights', world: true, lat: null, lon: null, text: 'The fourth day. Lights set for signs and for seasons.' },
    { year: -4004, name: 'Every living thing', ref: 'Genesis 1:20', power: 'gen_life', world: true, lat: null, lon: null, text: 'The fifth and sixth days. The waters and the air and the earth filled.' },
    { year: -4004, name: 'The seventh day', ref: 'Genesis 2:2', power: 'gen_rest', world: true, lat: null, lon: null, text: 'He rested, and blessed it, and hallowed it.' },
    { year: -4004, name: 'Eden', ref: 'Genesis 2:8', power: null, circa: true, lat: 31.0, lon: 47.4, text: 'A garden eastward in Eden, and a river to water it.' },
    { year: -4004, name: 'The Fall', ref: 'Genesis 3:6', power: null, circa: true, lat: 31.0, lon: 47.4, text: 'The fruit taken, and the gate shut behind them.' },
    { year: -3875, name: 'Cain and Abel', ref: 'Genesis 4:8', power: null, circa: true, lat: 31.0, lon: 47.4, text: 'The first city is built by the first murderer.' },
    { year: -3017, name: 'Enoch walks with God', ref: 'Genesis 5:24', power: null, circa: true, lat: 31.0, lon: 47.4, text: 'And he was not; for God took him.' },
    { year: -2469, name: 'Noah is told to build', ref: 'Genesis 6:14', power: null, circa: true, lat: 39.7, lon: 44.3, text: 'Make thee an ark of gopher wood.' },
    { year: -2348, name: 'The Flood', ref: 'Genesis 7:11', power: 'flood', world: true, lat: 39.7, lon: 44.3, text: 'The fountains of the great deep broken up, and the windows of heaven opened.' },
    { year: -2348, name: 'The ark rests on Ararat', ref: 'Genesis 8:4', power: null, lat: 39.7, lon: 44.3, text: 'And the waters returned from off the earth continually.' },
    { year: -2347, name: 'The bow in the cloud', ref: 'Genesis 9:13', power: 'bless', circa: true, lat: 39.7, lon: 44.3, text: 'I do set my bow in the cloud, for a token of a covenant.' },
    { year: -2242, name: 'Babel', ref: 'Genesis 11:9', power: 'babel', circa: true, lat: 32.54, lon: 44.42, text: 'One language, and one speech — until it was confounded.' },
    { year: -1921, name: 'The call of Abram', ref: 'Genesis 12:1', power: 'prophet', lat: 30.96, lon: 46.1, text: 'Get thee out of thy country, unto a land that I will shew thee.' },
    { year: -1913, name: 'Abram and Lot part', ref: 'Genesis 13:9', power: null, circa: true, lat: 31.93, lon: 35.22, text: 'Is not the whole land before thee?' },
    { year: -1898, name: 'The covenant of circumcision', ref: 'Genesis 17:10', power: null, circa: true, lat: 31.53, lon: 35.1, text: 'And thou shalt be a father of many nations.' },
    { year: -1897, name: 'Sodom and Gomorrah', ref: 'Genesis 19:24', power: 'fire', lat: 31.2, lon: 35.4, text: 'Brimstone and fire out of heaven.' },
    { year: -1896, name: 'Isaac is born', ref: 'Genesis 21:2', power: 'bless', circa: true, lat: 31.53, lon: 35.1, text: 'God hath made me to laugh, so that all that hear will laugh with me.' },
    { year: -1871, name: 'The binding of Isaac', ref: 'Genesis 22:12', power: null, circa: true, lat: 31.78, lon: 35.24, text: 'Lay not thine hand upon the lad.' },
    { year: -1760, name: 'Jacob\'s ladder', ref: 'Genesis 28:12', power: null, circa: true, lat: 31.93, lon: 35.22, text: 'A ladder set up on the earth, and the top of it reached to heaven.' },
    { year: -1739, name: 'Jacob wrestles until the breaking of the day', ref: 'Genesis 32:28', power: null, circa: true, lat: 32.2, lon: 35.6, text: 'Thy name shall be called no more Jacob, but Israel.' },
    { year: -1728, name: 'Joseph sold into Egypt', ref: 'Genesis 37:28', power: null, circa: true, lat: 30.8, lon: 31.8, text: 'Twenty pieces of silver, and a coat of many colours.' },
    { year: -1715, name: 'Pharaoh\'s dream, and the seven years', ref: 'Genesis 41:29', power: 'prophet', circa: true, lat: 30.8, lon: 31.8, text: 'Seven years of great plenty, and seven years of famine.' },
    { year: -1706, name: 'Israel goes down into Egypt', ref: 'Genesis 46:6', power: null, circa: true, lat: 30.8, lon: 31.8, text: 'And all his seed with him.' },
    { year: -1571, name: 'Moses in the bulrushes', ref: 'Exodus 2:3', power: null, circa: true, lat: 30.8, lon: 31.8, text: 'An ark of bulrushes, daubed with slime and with pitch.' },
    { year: -1491, name: 'The burning bush', ref: 'Exodus 3:2', power: 'voice', lat: 28.54, lon: 33.97, text: 'The bush burned with fire, and the bush was not consumed.' },
    { year: -1491, name: 'The plagues of Egypt', ref: 'Exodus 7:1', power: 'plagues', lat: 30.8, lon: 31.8, text: 'Blood, frogs, lice, flies, murrain, boils, hail, locusts, darkness, and the firstborn.' },
    { year: -1491, name: 'The Passover', ref: 'Exodus 12:13', power: null, lat: 30.8, lon: 31.8, text: 'When I see the blood, I will pass over you.' },
    { year: -1491, name: 'The Red Sea parts', ref: 'Exodus 14:21', power: null, lat: 29.5, lon: 32.6, text: 'The waters were a wall unto them on their right hand and on their left.' },
    { year: -1491, name: 'Manna in the wilderness', ref: 'Exodus 16:15', power: 'bless', lat: 28.54, lon: 33.97, text: 'It is manna: for they wist not what it was.' },
    { year: -1491, name: 'The Commandments at Sinai', ref: 'Exodus 20:1', power: 'commandments', lat: 28.54, lon: 33.97, text: 'And God spake all these words, saying...' },
    { year: -1491, name: 'The golden calf', ref: 'Exodus 32:19', power: 'judgment', lat: 28.54, lon: 33.97, text: 'He cast the tables out of his hands, and brake them.' },
    { year: -1490, name: 'Nadab and Abihu', ref: 'Leviticus 10:2', power: 'fire', circa: true, lat: 28.54, lon: 33.97, text: 'There went out fire from the LORD, and devoured them.' },
    { year: -1490, name: 'The tabernacle raised', ref: 'Exodus 40:34', power: null, circa: true, lat: 28.54, lon: 33.97, text: 'A cloud covered the tent, and the glory of the LORD filled the tabernacle.' },
    { year: -1490, name: 'The twelve spies', ref: 'Numbers 13:27', power: null, circa: true, lat: 30.68, lon: 34.5, text: 'It floweth with milk and honey; nevertheless the people be strong.' },
    { year: -1471, name: 'Korah swallowed up', ref: 'Numbers 16:32', power: 'quake', circa: true, lat: 30.68, lon: 34.5, text: 'The earth opened her mouth, and swallowed them up.' },
    { year: -1452, name: 'The brasen serpent', ref: 'Numbers 21:9', power: 'miracle', circa: true, lat: 30.68, lon: 34.5, text: 'When he beheld the serpent of brass, he lived.' },
    { year: -1451, name: 'Moses sees the land from Nebo', ref: 'Deuteronomy 34:4', power: null, lat: 31.77, lon: 35.73, text: 'I have caused thee to see it with thine eyes, but thou shalt not go over.' },
    { year: -1451, name: 'Jordan stands still', ref: 'Joshua 3:16', power: null, lat: 31.84, lon: 35.55, text: 'The waters which came down from above stood and rose up upon an heap.' },
    { year: -1451, name: 'The walls of Jericho', ref: 'Joshua 6:20', power: 'quake', lat: 31.87, lon: 35.44, text: 'The wall fell down flat, and the people went up into the city.' },
    { year: -1450, name: 'The sun stands still upon Gibeon', ref: 'Joshua 10:13', power: 'miracle', circa: true, lat: 31.78, lon: 35.23, text: 'And the sun stood still, and the moon stayed.' },
    { year: -1427, name: 'The covenant at Shechem', ref: 'Joshua 24:15', power: null, circa: true, lat: 32.21, lon: 35.28, text: 'As for me and my house, we will serve the LORD.' },
    { year: -1296, name: 'Deborah and Barak', ref: 'Judges 4:14', power: null, circa: true, lat: 32.69, lon: 35.39, text: 'Is not the LORD gone out before thee?' },
    { year: -1249, name: 'Gideon\'s three hundred', ref: 'Judges 7:7', power: null, circa: true, lat: 32.21, lon: 35.28, text: 'By the three hundred men will I save you.' },
    { year: -1136, name: 'Samson and the temple of Dagon', ref: 'Judges 16:30', power: 'quake', circa: true, lat: 31.5, lon: 34.47, text: 'Let me die with the Philistines.' },
    { year: -1120, name: 'Ruth gleans in the field of Boaz', ref: 'Ruth 1:16', power: null, circa: true, lat: 31.7, lon: 35.2, text: 'Whither thou goest, I will go.' },
    { year: -1116, name: 'Samuel hears his name in the night', ref: '1 Samuel 3:10', power: 'voice', circa: true, lat: 32.06, lon: 35.29, text: 'Speak; for thy servant heareth.' },
    { year: -1095, name: 'Saul anointed king', ref: '1 Samuel 10:1', power: 'crown', circa: true, lat: 31.87, lon: 35.18, text: 'Is it not because the LORD hath anointed thee?' },
    { year: -1063, name: 'David and Goliath', ref: '1 Samuel 17:49', power: null, circa: true, lat: 31.78, lon: 35.23, text: 'The stone sunk into his forehead.' },
    { year: -1056, name: 'Saul falls on Gilboa', ref: '1 Samuel 31:4', power: null, circa: true, lat: 32.5, lon: 35.4, text: 'How are the mighty fallen.' },
    { year: -1055, name: 'David king in Israel', ref: '2 Samuel 5:4', power: 'crown', lat: 31.78, lon: 35.23, text: 'Thirty years old when he began to reign, and he reigned forty years.' },
    { year: -1042, name: 'Uzzah and the ark', ref: '2 Samuel 6:7', power: 'judgment', circa: true, lat: 31.78, lon: 35.23, text: 'God smote him there for his error.' },
    { year: -1034, name: 'Nathan: thou art the man', ref: '2 Samuel 12:7', power: 'prophet', circa: true, lat: 31.78, lon: 35.23, text: 'And David said unto Nathan, I have sinned against the LORD.' },
    { year: -1015, name: 'Solomon asks for wisdom', ref: '1 Kings 3:9', power: 'crown', circa: true, lat: 31.78, lon: 35.23, text: 'Give therefore thy servant an understanding heart.' },
    { year: -1012, name: 'Solomon\'s Temple begun', ref: '1 Kings 6:1', power: null, lat: 31.78, lon: 35.23, text: 'In the fourth year of Solomon’s reign over Israel.' },
    { year: -1004, name: 'The glory fills the house', ref: '1 Kings 8:11', power: 'bless', circa: true, lat: 31.78, lon: 35.23, text: 'The glory of the LORD had filled the house of the LORD.' },
    { year: -992, name: 'The queen of Sheba', ref: '1 Kings 10:7', power: null, circa: true, lat: 31.78, lon: 35.23, text: 'The half was not told me.' },
    { year: -975, name: 'The kingdom divides', ref: '1 Kings 12:19', power: null, lat: 32.21, lon: 35.28, text: 'So Israel rebelled against the house of David unto this day.' },
    { year: -910, name: 'Elijah and the widow of Zarephath', ref: '1 Kings 17:22', power: 'raise_dead', circa: true, lat: 32.73, lon: 35.05, text: 'And the soul of the child came into him again.' },
    { year: -906, name: 'Elijah on Carmel', ref: '1 Kings 18:38', power: 'lightning', circa: true, lat: 32.73, lon: 35.05, text: 'Then the fire of the LORD fell, and consumed the burnt sacrifice.' },
    { year: -906, name: 'The still small voice', ref: '1 Kings 19:12', power: 'voice', circa: true, lat: 28.54, lon: 33.97, text: 'And after the fire a still small voice.' },
    { year: -896, name: 'Elijah taken up by a whirlwind', ref: '2 Kings 2:11', power: 'miracle', circa: true, lat: 31.84, lon: 35.55, text: 'And Elijah went up by a whirlwind into heaven.' },
    { year: -894, name: 'Elisha and the Shunammite’s son', ref: '2 Kings 4:35', power: 'raise_dead', circa: true, lat: 32.28, lon: 35.2, text: 'And the child opened his eyes.' },
    { year: -892, name: 'Naaman washes seven times in Jordan', ref: '2 Kings 5:14', power: 'miracle', circa: true, lat: 31.84, lon: 35.55, text: 'His flesh came again like unto the flesh of a little child.' },
    { year: -862, name: 'Jonah at Nineveh', ref: 'Jonah 3:4', power: 'prophet', circa: true, lat: 36.36, lon: 43.15, text: 'Yet forty days, and Nineveh shall be overthrown.' },
    { year: -760, name: 'Amos among the herdmen of Tekoa', ref: 'Amos 5:24', power: 'prophet', circa: true, lat: 31.7, lon: 35.2, text: 'Let judgment run down as waters.' },
    { year: -755, name: 'Hosea and the unfaithful wife', ref: 'Hosea 6:6', power: 'prophet', circa: true, lat: 32.28, lon: 35.2, text: 'I desired mercy, and not sacrifice.' },
    { year: -740, name: 'Isaiah sees the Lord high and lifted up', ref: 'Isaiah 6:8', power: 'prophet', circa: true, lat: 31.78, lon: 35.23, text: 'Here am I; send me.' },
    { year: -734, name: 'Micah of Moresheth', ref: 'Micah 6:8', power: 'prophet', circa: true, lat: 31.78, lon: 35.23, text: 'To do justly, and to love mercy, and to walk humbly with thy God.' },
    { year: -721, name: 'The fall of Samaria', ref: '2 Kings 17:6', power: 'judgment', lat: 32.28, lon: 35.2, text: 'And carried Israel away into Assyria.' },
    { year: -710, name: 'Sennacherib\'s army turned back', ref: '2 Kings 19:35', power: 'judgment', circa: true, lat: 31.78, lon: 35.23, text: 'And when they arose early in the morning, behold, they were all dead corpses.' },
    { year: -624, name: 'Josiah finds the book of the law', ref: '2 Kings 22:11', power: null, circa: true, lat: 31.78, lon: 35.23, text: 'He rent his clothes.' },
    { year: -627, name: 'Jeremiah called before he was born', ref: 'Jeremiah 1:5', power: 'prophet', circa: true, lat: 31.78, lon: 35.23, text: 'Before I formed thee in the belly I knew thee.' },
    { year: -612, name: 'Nahum: the burden of Nineveh', ref: 'Nahum 1:1', power: 'prophet', circa: true, lat: 36.36, lon: 43.15, text: 'The burden of Nineveh.' },
    { year: -605, name: 'Daniel taken to Babylon', ref: 'Daniel 1:6', power: null, circa: true, lat: 32.54, lon: 44.42, text: 'Children in whom was no blemish.' },
    { year: -603, name: 'Nebuchadnezzar\'s image of gold and clay', ref: 'Daniel 2:31', power: 'prophet', circa: true, lat: 32.54, lon: 44.42, text: 'This great image, whose brightness was excellent.' },
    { year: -594, name: 'Ezekiel by the river Chebar', ref: 'Ezekiel 1:4', power: 'prophet', circa: true, lat: 32.54, lon: 44.42, text: 'A whirlwind came out of the north, a great cloud, and a fire infolding itself.' },
    { year: -588, name: 'Jerusalem falls; the Temple burned', ref: '2 Kings 25:9', power: 'judgment', lat: 31.78, lon: 35.23, text: 'And he burnt the house of the LORD, and the king’s house.' },
    { year: -587, name: 'By the rivers of Babylon', ref: 'Psalms 137:1', power: null, circa: true, lat: 32.54, lon: 44.42, text: 'There we sat down, yea, we wept, when we remembered Zion.' },
    { year: -586, name: 'The valley of dry bones', ref: 'Ezekiel 37:4', power: 'raise_dead', circa: true, lat: 32.54, lon: 44.42, text: 'O ye dry bones, hear the word of the LORD.' },
    { year: -580, name: 'The fiery furnace', ref: 'Daniel 3:25', power: 'miracle', circa: true, lat: 32.54, lon: 44.42, text: 'And the form of the fourth is like the Son of God.' },
    { year: -538, name: 'The writing on the wall', ref: 'Daniel 5:25', power: 'judgment', circa: true, lat: 32.54, lon: 44.42, text: 'MENE, MENE, TEKEL, UPHARSIN.' },
    { year: -537, name: 'Daniel in the lions’ den', ref: 'Daniel 6:22', power: 'miracle', circa: true, lat: 32.54, lon: 44.42, text: 'My God hath sent his angel, and hath shut the lions’ mouths.' },
    { year: -536, name: 'The return from exile', ref: 'Ezra 1:3', power: 'bless', lat: 31.78, lon: 35.23, text: 'Who is there among you of all his people? let him go up.' },
    { year: -520, name: 'Haggai: build the house', ref: 'Haggai 1:8', power: 'prophet', circa: true, lat: 31.78, lon: 35.23, text: 'Go up to the mountain, and bring wood, and build the house.' },
    { year: -519, name: 'Zechariah: not by might, nor by power', ref: 'Zechariah 4:6', power: 'prophet', circa: true, lat: 31.78, lon: 35.23, text: 'Not by might, nor by power, but by my spirit.' },
    { year: -515, name: 'The second Temple finished', ref: 'Ezra 6:15', power: 'bless', circa: true, lat: 31.78, lon: 35.23, text: 'And this house was finished.' },
    { year: -478, name: 'Esther before the king', ref: 'Esther 4:16', power: null, circa: true, lat: 32.19, lon: 48.26, text: 'And if I perish, I perish.' },
    { year: -445, name: 'Nehemiah builds the wall', ref: 'Nehemiah 6:15', power: null, circa: true, lat: 31.78, lon: 35.23, text: 'So the wall was finished in fifty and two days.' },
    { year: -425, name: 'Job answered out of the whirlwind', ref: 'Job 38:4', power: 'voice', circa: true, lat: 31.0, lon: 36.5, text: 'Where wast thou when I laid the foundations of the earth?' },
    { year: -397, name: 'Malachi, and then silence', ref: 'Malachi 4:2', power: 'prophet', circa: true, lat: 31.78, lon: 35.23, text: 'The Sun of righteousness arise with healing in his wings.' },
    { year: -4, name: 'The Nativity', ref: 'Luke 2:7', power: 'miracle', lat: 31.7, lon: 35.2, text: 'And she brought forth her firstborn son, and laid him in a manger.' },
    { year: -4, name: 'Wise men from the east', ref: 'Matthew 2:2', power: null, lat: 31.7, lon: 35.2, text: 'We have seen his star in the east.' },
    { year: 27, name: 'The baptism in Jordan', ref: 'Matthew 3:17', power: 'voice', circa: true, lat: 31.84, lon: 35.55, text: 'This is my beloved Son, in whom I am well pleased.' },
    { year: 27, name: 'Forty days in the wilderness', ref: 'Matthew 4:4', power: null, circa: true, lat: 30.68, lon: 34.5, text: 'Man shall not live by bread alone.' },
    { year: 28, name: 'Water into wine at Cana', ref: 'John 2:9', power: 'miracle', circa: true, lat: 32.75, lon: 35.34, text: 'Thou hast kept the good wine until now.' },
    { year: 28, name: 'The Sermon on the Mount', ref: 'Matthew 5:3', power: null, circa: true, lat: 32.83, lon: 35.59, text: 'Blessed are the poor in spirit.' },
    { year: 29, name: 'The storm on Galilee stilled', ref: 'Mark 4:39', power: 'miracle', circa: true, lat: 32.83, lon: 35.59, text: 'Peace, be still.' },
    { year: 29, name: 'Five loaves and two fishes', ref: 'John 6:11', power: 'miracle', circa: true, lat: 32.88, lon: 35.57, text: 'And they were all filled.' },
    { year: 30, name: 'The ministry begins', ref: 'Luke 3:23', power: 'prophet', circa: true, lat: 32.7, lon: 35.3, text: 'And Jesus himself began to be about thirty years of age.' },
    { year: 32, name: 'Lazarus, come forth', ref: 'John 11:43', power: 'raise_dead', circa: true, lat: 31.77, lon: 35.26, text: 'And he that was dead came forth.' },
    { year: 33, name: 'The Last Supper', ref: 'Luke 22:19', power: null, lat: 31.78, lon: 35.23, text: 'This do in remembrance of me.' },
    { year: 33, name: 'The Crucifixion', ref: 'Luke 23:44', power: 'voice', lat: 31.78, lon: 35.23, text: 'And there was a darkness over all the earth until the ninth hour.' },
    { year: 33, name: 'The Resurrection', ref: 'Luke 24:6', power: 'raise_dead', lat: 31.78, lon: 35.23, text: 'He is not here, but is risen.' },
    { year: 33, name: 'The Ascension', ref: 'Acts 1:9', power: null, lat: 31.78, lon: 35.23, text: 'And a cloud received him out of their sight.' },
    { year: 33, name: 'Pentecost', ref: 'Acts 2:3', power: 'voice', lat: 31.78, lon: 35.23, text: 'Cloven tongues like as of fire, and it sat upon each of them.' },
    { year: 34, name: 'Stephen stoned', ref: 'Acts 7:59', power: null, circa: true, lat: 31.78, lon: 35.23, text: 'Lord, lay not this sin to their charge.' },
    { year: 35, name: 'The road to Damascus', ref: 'Acts 9:4', power: 'voice', circa: true, lat: 33.51, lon: 36.29, text: 'Saul, Saul, why persecutest thou me?' },
    { year: 44, name: 'Peter delivered from prison', ref: 'Acts 12:7', power: 'miracle', circa: true, lat: 31.78, lon: 35.23, text: 'And his chains fell off from his hands.' },
    { year: 48, name: 'Called Christians first in Antioch', ref: 'Acts 11:26', power: null, circa: true, lat: 36.2, lon: 36.16, text: 'And the disciples were called Christians first in Antioch.' },
    { year: 51, name: 'Paul on Mars’ hill', ref: 'Acts 17:23', power: 'prophet', circa: true, lat: 37.98, lon: 23.73, text: 'Whom therefore ye ignorantly worship, him declare I unto you.' },
    { year: 55, name: 'Though I speak with the tongues of men', ref: '1 Corinthians 13:1', power: null, circa: true, lat: 37.91, lon: 22.88, text: 'And have not charity, I am become as sounding brass.' },
    { year: 57, name: 'Nothing shall separate us', ref: 'Romans 8:38', power: null, circa: true, lat: 41.9, lon: 12.5, text: 'Nor height, nor depth, nor any other creature.' },
    { year: 62, name: 'The whole armour of God', ref: 'Ephesians 6:11', power: null, circa: true, lat: 37.94, lon: 27.34, text: 'That ye may be able to stand against the wiles of the devil.' },
    { year: 64, name: 'Rome burns; the first persecution', ref: '1 Peter 4:12', power: 'fire', circa: true, lat: 41.9, lon: 12.5, text: 'Think it not strange concerning the fiery trial.' },
    { year: 70, name: 'The Temple thrown down', ref: 'Matthew 24:2', power: 'judgment', circa: true, lat: 31.78, lon: 35.23, text: 'There shall not be left here one stone upon another.' },
    { year: 96, name: 'The Revelation on Patmos', ref: 'Revelation 1:9', power: null, circa: true, lat: 37.31, lon: 26.55, text: 'I was in the isle that is called Patmos, for the word of God.' },
    { year: 96, name: 'The Second Coming', ref: 'Matthew 24:30', power: 'rapture', circa: true, prophecy: true, lat: 31.78, lon: 35.23, text: 'And they shall see the Son of man coming in the clouds of heaven.' },
    { year: 96, name: 'The dead shall be raised', ref: '1 Corinthians 15:52', power: 'raise_dead', circa: true, prophecy: true, lat: 31.78, lon: 35.23, text: 'In a moment, in the twinkling of an eye, at the last trump.' },
    { year: 96, name: 'Armageddon', ref: 'Revelation 16:16', power: 'armageddon', circa: true, prophecy: true, lat: 32.58, lon: 35.18, text: 'He gathered them together into a place called Armageddon.' },
    { year: 96, name: 'Babylon is fallen', ref: 'Revelation 18:2', power: 'judgment', circa: true, prophecy: true, lat: 32.54, lon: 44.42, text: 'Babylon the great is fallen, is fallen.' },
    { year: 96, name: 'The thousand years', ref: 'Revelation 20:2', power: 'bless', circa: true, prophecy: true, lat: 31.78, lon: 35.23, text: 'And bound him a thousand years.' },
    { year: 96, name: 'The judgment of the nations', ref: 'Matthew 25:32', power: 'judgment', circa: true, prophecy: true, lat: 31.78, lon: 35.23, text: 'And he shall separate them one from another.' },
    { year: 96, name: 'A new heaven and a new earth', ref: 'Revelation 21:1', power: 'miracle', circa: true, prophecy: true, lat: 31.78, lon: 35.23, text: 'For the first heaven and the first earth were passed away.' }
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
    { year: 1991, name: 'The World Wide Web opens', lat: 46.23, lon: 6.05 },
    // ...and enough of the rest that the game does not read as scripture with
    // a few footnotes. Everything here is a date a schoolchild could check.
    { year: -9000, name: 'Jericho, among the oldest walled towns', lat: 31.87, lon: 35.44, circa: true },
    { year: -6500, name: 'Catalhoyuk', lat: 37.67, lon: 32.83, circa: true },
    { year: -3200, name: 'Writing at Uruk', lat: 31.32, lon: 45.64, circa: true },
    { year: -2600, name: 'Stonehenge raised', lat: 51.18, lon: -1.83, circa: true },
    { year: -1600, name: 'Thera erupts', lat: 36.40, lon: 25.40, circa: true },
    { year: -1274, name: 'Kadesh: the first battle with a surviving plan', lat: 34.57, lon: 36.52 },
    { year: -1200, name: 'The Bronze Age collapse', lat: 35.00, lon: 33.00, circa: true },
    { year: -509, name: 'The Roman Republic', lat: 41.89, lon: 12.49 },
    { year: -490, name: 'Marathon', lat: 38.15, lon: 23.96 },
    { year: -399, name: 'Socrates drinks the hemlock', lat: 37.97, lon: 23.72 },
    { year: -336, name: 'Alexander takes the throne', lat: 40.75, lon: 22.52 },
    { year: -300, name: "Euclid's Elements", lat: 31.20, lon: 29.92, circa: true },
    { year: -240, name: 'Eratosthenes measures the Earth', lat: 31.20, lon: 29.92, circa: true },
    { year: -146, name: 'Carthage destroyed', lat: 36.85, lon: 10.32 },
    { year: 105, name: 'Paper in Han China', lat: 34.62, lon: 112.45, circa: true },
    { year: 313, name: 'Christianity made lawful in Rome', lat: 45.07, lon: 7.69 },
    { year: 537, name: 'Hagia Sophia', lat: 41.01, lon: 28.98 },
    { year: 800, name: 'Charlemagne crowned', lat: 41.90, lon: 12.45 },
    { year: 1040, name: 'Gunpowder written down in China', lat: 34.27, lon: 108.95, circa: true },
    { year: 1215, name: 'Magna Carta', lat: 51.44, lon: -0.56 },
    { year: 1453, name: 'Constantinople falls', lat: 41.01, lon: 28.98 },
    { year: 1517, name: 'Ninety-five theses', lat: 51.87, lon: 12.65 },
    { year: 1543, name: 'The Earth is not the centre', lat: 54.19, lon: 19.40 },
    { year: 1610, name: "Galileo's moons of Jupiter", lat: 45.41, lon: 11.88 },
    { year: 1666, name: 'London burns', lat: 51.51, lon: -0.09 },
    { year: 1776, name: 'A declaration in Philadelphia', lat: 39.95, lon: -75.15 },
    { year: 1804, name: 'The first steam locomotive runs', lat: 51.68, lon: -3.24 },
    { year: 1858, name: 'The first cable under the Atlantic', lat: 51.88, lon: -10.35 },
    { year: 1879, name: 'The lamp that lasted', lat: 40.54, lon: -74.33 },
    { year: 1903, name: 'Twelve seconds at Kitty Hawk', lat: 36.02, lon: -75.67 },
    { year: 1928, name: 'Penicillin', lat: 51.52, lon: -0.17 },
    { year: 1953, name: 'The shape of the double helix', lat: 52.20, lon: 0.12 },
    { year: 1980, name: 'Smallpox declared eradicated', lat: 46.23, lon: 6.14 },
    { year: 1990, name: 'The pale blue dot', lat: 34.20, lon: -118.17 }
  ];

  // -------------------------------------------------------------------------
  // WHAT THE RECORD IS ALLOWED TO DO ON ITS OWN
  //
  // An allowlist, not "everything that names a power". The seven days are the
  // reason: gen_light .. gen_rest belong to the creationStage flow that
  // un-creation gates, and firing one at a running world would fight machinery
  // that already has its own sequence. They are announced and never enacted.
  //
  // Everything here is a power that already exists, already tested, and takes
  // a place — so enacting the record is a call, not a new system.
  const ENACTABLE = new Set([
    'flood', 'plagues', 'babel', 'commandments', 'prophet', 'judgment',
    'fire', 'quake', 'lightning', 'voice', 'raise_dead', 'miracle',
    'bless', 'crown',
    // Used ONLY by prophecy, which eventsBetween never returns — so the end of
    // days is reachable and can never arrive on its own while you watch the
    // clock. It has to be something you choose to do.
    'rapture', 'armageddon'
  ]);
  function enactable(e) {
    return !!(e && e.power && ENACTABLE.has(e.power) && (e.world || e.lat != null));
  }

  // Did this act FULFIL the record rather than break it?
  //
  // Same power, near enough the right moment, near enough the right place. The
  // windows are named rather than felt: too tight and nobody ever hits one,
  // too loose and every act is a fulfilment.
  const FULFIL_YEARS = 30;      // the clock runs in centuries per second
  const FULFIL_DEG = 8;         // ~900 km — the record's places are regions
  function matchAct(power, year, lat, lon) {
    if (!power) return null;
    let best = null, bestD = Infinity;
    for (const list of [SCRIPTURE, RECORD]) {
      for (const e of list) {
        if (e.power !== power) continue;
        if (Math.abs(e.year - year) > FULFIL_YEARS) continue;
        if (e.lat == null) { if (!best) best = e; continue; }   // world-wide
        if (lat == null || lon == null) continue;
        let dLon = Math.abs(e.lon - lon); if (dLon > 180) dLon = 360 - dLon;
        const d = Math.hypot(e.lat - lat, dLon);
        if (d > FULFIL_DEG) continue;
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  // The sixty-six books of the King James Bible, in order. This exists so a
  // citation can be CHECKED: in a record this size, written out by hand, a
  // mistyped or invented reference is the likeliest defect there is, and it is
  // the one a reader would take at face value.
  const BOOKS = ('Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|' +
    '1 Samuel|2 Samuel|1 Kings|2 Kings|1 Chronicles|2 Chronicles|Ezra|Nehemiah|Esther|' +
    'Job|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|' +
    'Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|' +
    'Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|1 Corinthians|' +
    '2 Corinthians|Galatians|Ephesians|Philippians|Colossians|1 Thessalonians|' +
    '2 Thessalonians|1 Timothy|2 Timothy|Titus|Philemon|Hebrews|James|1 Peter|2 Peter|' +
    '1 John|2 John|3 John|Jude|Revelation').split('|');
  const BOOK_SET = new Set(BOOKS);

  // "1 Kings 6:1" -> "1 Kings". Book names carry a leading numeral and spaces,
  // so this cannot just split on the first space.
  function bookOf(ref) {
    if (!ref) return null;
    const m = String(ref).match(/^((?:[123]\s)?[A-Za-z][A-Za-z ]*?)\s+\d/);
    return m ? m[1].trim() : null;
  }
  function citesRealBook(ref) { return BOOK_SET.has(bookOf(ref)); }

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
        // PROPHECY HAS NO DATE, so nothing in time can reach it. The nominal
        // year on a prophetic entry is where it SITS in the book, not when it
        // happens, and the Bible is explicit that the second is unknown:
        // "But of that day and hour knoweth no man" (Matthew 24:36). Letting
        // the clock fire the end of the world on a year I picked would be the
        // game inventing the one thing its own source refuses to state.
        // It can still come to pass — but only by your hand, through matchAct.
        if (e.prophecy && !(opt && opt.includeProphecy)) continue;
        if (e.year > lo && e.year <= hi) out.push(e);
      }
    }
    out.sort((a, b) => a.year - b.year);
    return out;
  }

  // Everything foretold and not yet done, for the panel that lists it.
  function prophecies() {
    return SCRIPTURE.filter((e) => e.prophecy);
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
    stateAt, eventsBetween, eventsAt, label, enactable, matchAct, ENACTABLE,
    prophecies, BOOKS, bookOf, citesRealBook,
    FULFIL_YEARS, FULFIL_DEG,
    seaLevelAt, tempAt, populationAt, eraAt, sample,
    SCRIPTURE, RECORD, SEA_PALAEO, TEMP_PALAEO, SEA_FUTURE, TEMP_FUTURE, PRESENT,
    FIRST_YEAR, LAST_YEAR
  };
})(typeof window !== 'undefined' ? window : globalThis);
