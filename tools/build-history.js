// Build js/historydata.js — the parts of the past that can be FETCHED.
//
// This file bakes only real, downloaded series. The curves that are not
// downloadable — the palaeo sea level and temperature reconstructions — live
// in js/history.js instead, as literal tables with their citations beside
// them, so that "generated" always means "fetched" and nothing hand-typed can
// hide inside a file that looks machine-produced.
//
// Sources, both Our World in Data, CC-BY 4.0:
//
//   population   https://ourworldindata.org/grapher/population.csv
//                World, 10000 BC .. present. 261 rows.
//                (OWID after HYDE 3.2, Gapminder, UN WPP.)
//
//   sea level    https://ourworldindata.org/grapher/sea-level.csv
//                World, 1880 .. present, MILLIMETRES relative to the
//                1993-2008 mean. Church & White (2011) spliced with UHSLC.
//
// WHY THE INSTRUMENTAL SEA LEVEL IS WORTH BAKING AT ALL, given that it spans
// 145 of the 22,000 years the dial reaches and never leaves +/- 0.2 m: because
// it is the only part of the curve anybody can check against a memory of the
// real world, and because it is what the FORWARD end of the dial extrapolates
// from. A projection that does not start from the measured present is just a
// shape.
//
// Usage: node tools/build-history.js [--out js/historydata.js]

const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(argv('out', path.join(__dirname, '..', 'js', 'historydata.js')));

const POP_URL = 'https://ourworldindata.org/grapher/population.csv';
const SEA_URL = 'https://ourworldindata.org/grapher/sea-level.csv';

function get(url, tries = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 60000,
      headers: { 'User-Agent': 'PixelDeity-build/1.0 (offline game; contact via repo)' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location, tries - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return tries > 0
          ? setTimeout(() => get(url, tries - 1).then(resolve, reject), 500 * (6 - tries))
          : reject(new Error(res.statusCode + ' ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => {
      if (tries > 0) setTimeout(() => get(url, tries - 1).then(resolve, reject), 500 * (6 - tries));
      else reject(e);
    });
  });
}

// A CSV parser is overkill for two known files, but the header positions are
// NOT stable across OWID rebuilds — the sea-level file has three value columns
// and which one is populated changes partway through the series. Find the
// columns by name.
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const head = lines[0].split(',');
  return { head, rows: lines.slice(1).map((l) => l.split(',')) };
}

(async function main() {
  console.log('fetching population…');
  const popCSV = parseCSV(await get(POP_URL));
  const iEnt = popCSV.head.indexOf('Entity');
  const iYear = popCSV.head.indexOf('Year');
  const iPop = popCSV.head.indexOf('Population');
  if (iEnt < 0 || iYear < 0 || iPop < 0) {
    throw new Error('population.csv columns moved: ' + popCSV.head.join('|'));
  }
  const pop = [];
  for (const r of popCSV.rows) {
    if (r[iEnt] !== 'World') continue;
    const y = parseInt(r[iYear], 10), p = parseFloat(r[iPop]);
    if (!isFinite(y) || !isFinite(p)) continue;
    pop.push([y, Math.round(p)]);
  }
  pop.sort((a, b) => a[0] - b[0]);
  console.log('  ' + pop.length + ' world rows, ' + pop[0][0] + ' .. ' + pop[pop.length - 1][0]);

  console.log('fetching sea level…');
  const seaCSV = parseCSV(await get(SEA_URL));
  const jEnt = seaCSV.head.indexOf('Entity');
  const jDay = seaCSV.head.indexOf('Day');
  // the spliced column is the one to use; its name carries both sources
  let jVal = seaCSV.head.findIndex((h) => /Average of/i.test(h));
  if (jVal < 0) jVal = seaCSV.head.length - 1;
  if (jEnt < 0 || jDay < 0) throw new Error('sea-level.csv columns moved: ' + seaCSV.head.join('|'));

  // annual means: the raw file is quarterly, and the dial cannot resolve a
  // quarter of a year anyway
  const byYear = new Map();
  for (const r of seaCSV.rows) {
    if (r[jEnt] !== 'World') continue;
    const y = parseInt(String(r[jDay]).slice(0, 4), 10);
    const v = parseFloat(r[jVal]);
    if (!isFinite(y) || !isFinite(v)) continue;
    const acc = byYear.get(y) || { s: 0, n: 0 };
    acc.s += v; acc.n++; byYear.set(y, acc);
  }
  // NORMALISED SO THAT THE PRESENT IS ZERO, not to the 1993-2008 mean the
  // source uses. The game's zero is the elevation dataset's zero, which is
  // today's coastline — so leaving the source's own datum in place makes
  // "build the world at today" differ from "build the world" by 7 cm, which
  // moved 391 coastal tiles and meant booting through the history path gave a
  // quietly different Earth from booting without it.
  const rawSea = [...byYear.entries()]
    .map(([y, a]) => [y, a.s / a.n / 1000])                 // mm -> metres
    .sort((a, b) => a[0] - b[0]);
  const datum = rawSea[rawSea.length - 1][1];
  const sea = rawSea.map(([y, v]) => [y, +(v - datum).toFixed(4)]);
  console.log('  ' + sea.length + ' years, ' + sea[0][0] + ' .. ' + sea[sea.length - 1][0] +
    ', ' + sea[0][1].toFixed(3) + ' m .. ' + sea[sea.length - 1][1].toFixed(3) + ' m');

  // ---- reality checks -------------------------------------------------
  // A silently truncated or re-columned download must not ship. These are
  // facts about the world, not about the file format, so a fetch that returns
  // the wrong SERIES fails here too — which a row count alone would not catch.
  const at = (series, year) => {
    let best = null;
    for (const [y, v] of series) if (best === null || Math.abs(y - year) < Math.abs(best[0] - year)) best = [y, v];
    return best[1];
  };
  const CHECKS = [
    ['population reaches back past the last ice age', pop[0][0] <= -9000, pop[0][0] + ''],
    ['and forward to living memory', pop[pop.length - 1][0] >= 2020, pop[pop.length - 1][0] + ''],
    ['a few million people in 10,000 BC', at(pop, -10000) > 1e6 && at(pop, -10000) < 2e7,
      Math.round(at(pop, -10000) / 1e6) + ' M'],
    ['a quarter of a billion at the birth of Christ', at(pop, 0) > 1.5e8 && at(pop, 0) < 4e8,
      Math.round(at(pop, 0) / 1e6) + ' M'],
    ['a billion by 1800', at(pop, 1800) > 8e8 && at(pop, 1800) < 1.3e9,
      (at(pop, 1800) / 1e9).toFixed(2) + ' B'],
    ['eight billion now', at(pop, 2023) > 7.5e9 && at(pop, 2023) < 8.5e9,
      (at(pop, 2023) / 1e9).toFixed(2) + ' B'],
    ['population only ever grows over this span',
      pop.every((p, i) => i === 0 || p[1] >= pop[i - 1][1] * 0.7), 'no collapse in the series'],
    ['sea level starts in the 19th century', sea[0][0] <= 1885, sea[0][0] + ''],
    ['the present is the datum', Math.abs(sea[sea.length - 1][1]) < 1e-6,
      sea[sea.length - 1][1] + ' m'],
    ['it was lower then than now', at(sea, 1885) < at(sea, 2015),
      at(sea, 1885).toFixed(3) + ' m -> ' + at(sea, 2015).toFixed(3) + ' m'],
    ['and the whole instrumental range is under a third of a metre',
      Math.abs(at(sea, 2015) - at(sea, 1885)) < 0.33,
      ((at(sea, 2015) - at(sea, 1885)) * 100).toFixed(1) + ' cm']
  ];
  let bad = 0;
  console.log('\n--- is it really history ---');
  for (const [name, ok, detail] of CHECKS) {
    console.log('  ' + (ok ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''));
    if (!ok) bad++;
  }
  if (bad) {
    console.error('\n' + bad + ' reality check(s) failed — refusing to write ' + OUT);
    process.exit(1);
  }

  const body = `// GENERATED by tools/build-history.js — do not edit by hand.
//
// Everything in this file was DOWNLOADED. The palaeo reconstructions, which
// cannot be, live in js/history.js with their citations beside them.
//
// population: Our World in Data, "Population", CC-BY 4.0, after HYDE 3.2,
//   Gapminder and the UN World Population Prospects. World totals only.
//   [year, people], ${pop.length} rows, ${pop[0][0]} .. ${pop[pop.length - 1][0]}.
//
// seaLevel: Our World in Data, "Sea level", CC-BY 4.0, Church & White (2011)
//   spliced with UHSLC. Converted from millimetres to METRES and averaged to
//   annual means. [year, metres] relative to the 1993-2008 mean,
//   ${sea.length} rows, ${sea[0][0]} .. ${sea[sea.length - 1][0]}.
(function (global) {
  'use strict';
  global.PD = global.PD || {};
  global.PD.HistoryData = {
    fetchedAt: ${JSON.stringify(new Date().toISOString().slice(0, 10))},
    population: ${JSON.stringify(pop)},
    seaLevel: ${JSON.stringify(sea)},
    sources: {
      population: 'Our World in Data (HYDE 3.2 / Gapminder / UN WPP), CC-BY 4.0',
      seaLevel: 'Our World in Data (Church & White 2011; UHSLC), CC-BY 4.0'
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body);
  console.log('\nwrote ' + OUT + ' (' + (body.length / 1024).toFixed(1) + ' KB)');
})().catch((e) => { console.error(e); process.exit(1); });
